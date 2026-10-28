// The advisory identity index (ADR-0103 D6): where an identity is defined or used.
//
// A source map is IR-path keyed and exists only for the duration of a parse. The review app needs
// the other direction: a click on `U1` or `VCC` has to name every place that identity appears —
// the board row, the print-page placement, the component file, the footprint, the pin line. This
// module turns the same parse into that index.
//
// It is advisory: derived from the sources, never part of a shard, the manifest, the project hash or
// any build input. The shape is fixed here (ADR-0103 D6): `identity.json` carries
// a version and a map from a namespaced identity key to locations.
import { spanOf, type SchemaKind, type SourceMap } from "@texteda/ir";
import type { Component } from "@texteda/ir/component";
import type { Footprint } from "@texteda/ir/footprint";
import type { Pcb } from "@texteda/ir/pcb";
import type { Schematic } from "@texteda/ir/schematic";
import type { SchematicView } from "@texteda/ir/schematic-view";
import type { Symbol } from "@texteda/ir/symbol";
import type {
  ReviewSourceKind,
  ReviewSourceLocation,
  ReviewSources,
} from "@texteda/viewer";

/** One compiled description, with the source map its parser produced. */
export interface IdentityInput {
  kind: SchemaKind;
  /** Shard path, e.g. `boards/charger-buck/view/buck-5v.json`. */
  path: string;
  /** Source file, relative to the project root. */
  source: string;
  ir: unknown;
  sources?: SourceMap | undefined;
}

/** The advisory document written beside the shards as `identity.json`. */
export interface IdentityDocument {
  /** Shape version of this advisory document, not the IR contract version. */
  version: 1;
  identities: ReviewSources;
}

interface Entry {
  key: string;
  location: ReviewSourceLocation;
}

/**
 * Build the identity index from the descriptions that compiled.
 *
 * Identity keys are namespaced so two boards can both have `U1` and a net named `VCC` does not
 * collide with a component:
 *
 * - `instance:<board>/<instance-id>`
 * - `net:<board>/<net-id>`
 * - `port:<board>/<port-id>`
 * - `component:<component-id>`
 * - `component-pin:<component-id>/<pin-number>`
 * - `symbol:<lib>:<symbol-id>`
 * - `footprint:<lib>:<footprint-id>`
 */
export function buildIdentityDocument(inputs: readonly IdentityInput[]): IdentityDocument {
  const entries: Entry[] = [];
  const seen = new Set<string>();

  const add = (
    key: string,
    kind: ReviewSourceKind,
    label: string,
    input: IdentityInput,
    pointer: string,
  ): void => {
    const span = input.sources === undefined ? undefined : spanOf(input.sources, pointer);
    const location: ReviewSourceLocation = {
      kind,
      label,
      file: span?.file ?? input.source,
      line: span?.line ?? 1,
      col: span?.col ?? 1,
    };
    // The same view record can be reached through two identities (a place and its instance), but
    // within one identity the same location twice is noise.
    const dedupe = `${key}\u0000${location.kind}\u0000${location.label}\u0000${location.file}\u0000${location.line}\u0000${location.col}`;
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    entries.push({ key, location });
  };

  for (const input of inputs) {
    switch (input.kind) {
      case "schematic": {
        const board = (input.ir as Schematic).board;
        const ir = input.ir as Schematic;
        ir.instances.forEach((instance, index) => {
          add(`instance:${board}/${instance.id}`, "instance", "sch instance row", input, `/instances/${index}`);
        });
        ir.nets.forEach((net, index) => {
          add(`net:${board}/${net.id}`, "net", "sch net row", input, `/nets/${index}`);
        });
        (ir.ports ?? []).forEach((port, index) => {
          add(`port:${board}/${port.id}`, "port", "sch port row", input, `/ports/${index}`);
        });
        break;
      }
      case "pcb": {
        const ir = input.ir as Pcb;
        ir.place.forEach((place, index) => {
          add(
            `instance:${ir.board}/${place.instance_id}`,
            "pcb-place",
            "pcb placement",
            input,
            `/place/${index}`,
          );
        });
        break;
      }
      case "schematic-view": {
        const ir = input.ir as SchematicView;
        ir.place.forEach((place, index) => {
          add(
            `instance:${ir.board}/${place.instance_id}`,
            "view-place",
            `view place (${ir.page})`,
            input,
            `/place/${index}`,
          );
        });
        (ir.wire ?? []).forEach((wire, index) => {
          add(
            `net:${ir.board}/${wire.net}`,
            "view-wire",
            `view wire (${ir.page})`,
            input,
            `/wire/${index}`,
          );
        });
        (ir.label ?? []).forEach((label, index) => {
          add(
            `net:${ir.board}/${label.net}`,
            "view-label",
            `view label (${ir.page})`,
            input,
            `/label/${index}`,
          );
        });
        (ir.port ?? []).forEach((port, index) => {
          add(
            `port:${ir.board}/${port.id}`,
            "view-port",
            `view port (${ir.page})`,
            input,
            `/port/${index}`,
          );
        });
        break;
      }
      case "component": {
        const component = (input.ir as Component).component;
        add(`component:${component.id}`, "component", "component file", input, "/component");
        component.pins.forEach((pin, index) => {
          add(
            `component-pin:${component.id}/${pin.number}`,
            "component-pin",
            `pin ${pin.number}`,
            input,
            `/component/pins/${index}`,
          );
        });
        break;
      }
      case "symbol": {
        const id = libraryId(input.path, "symbols");
        if (id === undefined) break;
        add(`symbol:${id}`, "symbol", "symbol file", input, "/symbol");
        break;
      }
      case "footprint": {
        const id = libraryId(input.path, "footprints");
        if (id === undefined) break;
        add(`footprint:${id}`, "footprint", "footprint file", input, "/footprint");
        break;
      }
      case "project":
      case "system":
      case "procurement":
        // Not identities the drawing can select: the review app asks about instances, nets, ports
        // and the devices/symbols/footprints behind them.
        break;
      default:
        break;
    }
  }

  const identities: ReviewSources = {};
  for (const key of [...new Set(entries.map((entry) => entry.key))].sort()) {
    identities[key] = entries
      .filter((entry) => entry.key === key)
      .map((entry) => entry.location)
      .sort(compareLocations);
  }
  return { version: 1, identities };
}

/** `symbols/<lib>/<id>.json` → `<lib>:<id>`; `undefined` when the shard path is not a library shard. */
function libraryId(path: string, prefix: string): string | undefined {
  const match = new RegExp(`^${prefix}/([^/]+)/([^/]+)\\.json$`).exec(path);
  if (match === null) return undefined;
  return `${match[1]}:${match[2]}`;
}

function compareLocations(a: ReviewSourceLocation, b: ReviewSourceLocation): number {
  return (
    a.file.localeCompare(b.file) ||
    a.line - b.line ||
    a.col - b.col ||
    a.kind.localeCompare(b.kind) ||
    a.label.localeCompare(b.label)
  );
}
