// Writing a print page back after an explicit view action (ADR-0056 D2, D3; ADR-0043 D3).
//
// What this file may write: `views/<page_id>.view.teda`, and nothing else. Moving a
// symbol on a drawing is a drawing change; the circuit (`design/**`) is not touched, and no IR
// shard, no hash and no manufacturing artifact moves (ADR-0035 D5). The bytes written are the
// formatter's (ADR-0035 D10), so a save leaves a diff that shows the view change and nothing else.
//
// Two write paths live here, and they are not interchangeable:
//   - `planLayout` / `applyLayout` / `commitPlan`: the standalone app's Apply. It moves symbols,
//     applies permitted field/source state, re-anchors the wires that lost their pins, and reseats
//     floating labels and ports.
//   - `planPlaces` / `applyPlaces`: the plugin's places-only write (ADR-0043 D3). It rewrites the
//     `place` rows and nothing else, so the wires whose pins moved go stale; re-anchoring stays with
//     the command line (`texteda view rewire`, ADR-0043 D10).
//
// The re-anchor itself is not a route: the wires whose pins moved keep their shape and get their
// corners back (see `packages/core/src/view/reroute.ts`). The wires of every other net, and every
// hand-made corner, are left exactly as they were.
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { spanOf, type SourceMap } from "@texteda/ir";
import type { Schematic } from "@texteda/ir/schematic";
import type { SchematicView } from "@texteda/ir/schematic-view";
import {
  formatModuleView,
  formatView,
  lex,
  parseModuleView,
  parseSchematic,
  parseView,
  type Cell,
  type Line,
} from "@texteda/parser";
import type { ModuleView } from "@texteda/ir/module-view";
import {
  distanceToSegment,
  nearestOnPath,
  ON_LINE_NM,
  ON_NET_NM,
  reanchorWire,
  reseatOnNet,
  simplifyRun,
  type RunObstacles,
  type WireCorners,
} from "@texteda/core";
import { loadComponents, loadModules, loadSchematic } from "./project.ts";
import { loadModuleFacts, type ModuleFacts } from "./module-facts.ts";
import { LAYOUT } from "./paths.ts";
import { loadSymbolLibrary, schematicInstances, type SchematicInstances } from "./symbols.ts";
import {
  moduleGeometry,
  renderModuleDrawing,
  renderSchematic,
  schematicGeometry,
  toSvgText,
  viewModulePorts,
  type SheetGeometry,
  type SchematicRenderOptions,
  type SvgDoc,
} from "@texteda/renderer";

/**
 * Whether a wire endpoint names a module port (`M1.PORT`) rather than a pin.
 *
 * A module port is the module's interface, not a pin of a placed symbol (spec/schematic-view.md
 * §5): the project binds it to a net and the page draws where it sits (ADR-0067 D4). A project-level
 * refdes never takes the `M<number>` shape (spec/module.md §4), so the shape tells the two apart
 * without guessing — and a module-qualified pin (`M1.U1.5`) keeps its own instance and pin.
 */
const MODULE_PORT_ENDPOINT = /^M[0-9]+\.[A-Za-z0-9_+-]+$/;

/** One placement, as the app sends it. */
export interface LayoutPlace {
  instance_id: string;
  /** Millimetres, sheet coordinates (the origin is the sheet's upper-left corner). */
  x: number;
  y: number;
  /** Degrees, clockwise positive. */
  rot: number;
}
/** A field override, in millimetres and symbol-local coordinates. */
export interface LayoutField {
  instance_id: string;
  name: "Reference" | "Value";
  x: number;
  y: number;
}

/** Remove one field override; absence is the automatic-placement state. */
export interface LayoutFieldRemoval {
  instance_id: string;
  name: "Reference" | "Value";
}

/**
 * A label or a port the app moved, in millimetres and sheet coordinates.
 *
 * They are placed, not wired: a label names a net and a port names a project port, and both have to
 * sit on that net's drawn wiring to be read (spec/schematic-view.md §6, §7). The write stores the
 * coordinates the app sends; `planLayout` reports one that lands off its net rather than silently
 * snapping it somewhere the person did not pick.
 */
export interface LayoutText {
  /** The net a label names, or the port id a port tag shows. */
  id: string;
  kind: "label" | "port";
  x: number;
  y: number;
}

export interface LayoutRequest {
  /** The print page to edit. Exactly one of `page` and `module` is required. */
  page?: string;
  /** The reusable module drawing to edit (its module id). */
  module?: string;
  places: LayoutPlace[];
  /** Field overrides to set, in millimetres relative to the symbol origin. */
  fields?: LayoutField[];
  /** Field overrides to remove; `(instance_id, name)` is the identity. */
  remove_fields?: LayoutFieldRemoval[];
  /** Labels and ports the app moved, in millimetres and sheet coordinates. */
  texts?: LayoutText[];
  /** Place Reference/Value fields around the whole page; defaults to true. */
  automatic_fields?: boolean;
  /** Previous automatic anchors in sheet millimetres; render preferences, never override rows. */
  field_positions?: (LayoutField & { anchor?: "start" | "middle" | "end" })[];
  /** Re-anchor affected wires after moves; defaults to true. This does not search for routes. */
  reanchor_wires?: boolean;

  /**
   * The page's source as it stands in the explicit Source panel, when the panel holds one.
   *
   * The layout is computed on this text and the write is this text with the moved rows applied —
   * not the file on disk. Without it a move would silently discard every unsaved Source edit
   * (ADR-0056 D2). Absent means "use the file", which is what the command line and a plugin's
   * request do.
   */
  text?: string;
}

export interface LayoutOutcome {
  /** The file that was written. */
  file: string;
  /** Whether the file's bytes changed. */
  changed: boolean;
  /** The wires whose shape could not be kept. */
  conflicts: string[];
  /** The labels and ports that were put back on their net. */
  reseated: string[];
}

/** What a placement change would do: the new source, and the page as it would look. */
export interface LayoutPlan extends LayoutOutcome {
  /** The page's new source, in the formatter's form. */
  text: string;
  /** The page as it would be drawn after the change. */
  svg: string;
  /** The page's geometry after the change: where the symbols and texts ended up. */
  geometry: SheetGeometry;
  /** Nets left with wires that no longer reach moved pins or ports, only when repair is disabled. */
  stale?: string[];
}

/** The nets whose wires went stale when the symbols moved: reported, never re-anchored. */
export interface PlacesOutcome {
  /** The file that was (or would be) written. */
  file: string;
  /** Whether the file's bytes changed. */
  changed: boolean;
  /** The nets whose wires no longer reach their pins; their wires were not rewritten. */
  stale: string[];
}

/** What a places-only write would do: the page's new source, and the page as it would look. */
export interface PlacesPlan extends PlacesOutcome {
  /** The page's new source, in the formatter's form. */
  text: string;
  /** The page as it would be drawn after the change: the moved symbols and the stale wires. */
  svg: string;
  /** Where the symbols and texts sit after the change. */
  geometry: SheetGeometry;
}

export class LayoutError extends Error {}

/** The path of a print page, relative to the project root. */
export function pageFile(page: string): string {
  return `${LAYOUT.views}/${page}.view.teda`;
}

/** The path of a reusable module drawing, relative to the project root. */
export function moduleFile(module: string): string {
  return `${LAYOUT.moduleViews}/${module}.module-view.teda`;
}

/** Which view file a layout request edits: one page or one module drawing. */
export interface LayoutTarget {
  readonly kind: "page" | "module";
  /** The page id or the module id. */
  readonly id: string;
  /** The file, relative to the project root. */
  readonly file: string;
}

export function layoutTarget(request: LayoutRequest): LayoutTarget {
  if (request.page !== undefined && request.module !== undefined) {
    throw new LayoutError("a layout request names a page or a module drawing, not both");
  }
  if (request.module !== undefined) return { kind: "module", id: request.module, file: moduleFile(request.module) };
  if (request.page !== undefined) return { kind: "page", id: request.page, file: pageFile(request.page) };
  throw new LayoutError("a layout request needs a page or a module drawing");
}

/**
 * Move the symbols the app asks for and write the page back.
 *
 * The page's source is the input and the output: the placements the app sends are applied to the
 * parsed view, the wires that lost their pins are re-anchored, the rows that changed are rewritten
 * in the source, and the formatter makes the result canonical.
 */
export function applyLayout(root: string, request: LayoutRequest): LayoutOutcome {
  const plan = planLayout(root, request);
  commitPlan(root, plan);
  return { file: plan.file, changed: plan.changed, conflicts: plan.conflicts, reseated: plan.reseated };
}

/** Write a plan's result. The plan is the only thing that decides what is written. */
export function commitPlan(root: string, plan: LayoutPlan): void {
  if (!plan.changed) return;
  writeFile(root, plan.file, plan.text);
}

/**
 * The page's placements after the request, and the instances whose place actually changed.
 *
 * Both write paths compute this the same way — millimetres rounded to whole nanometres, a rotation
 * only when it is a right angle, and an instance the page does not place refused — so a rounding
 * rule, a refusal or a moved instance cannot come out differently on the two paths.
 */
type ViewPlace = NonNullable<SchematicView["place"]>[number];

function computePlacements(
   view: SchematicView,
   request: LayoutRequest,
   file: string,
 ): { places: SchematicView["place"]; moved: Set<string> } {
   const wanted = new Map(request.places.map((place) => [place.instance_id, place]));
   const current = view.place ?? [];
   const places = current.map((place) => {
     const ask = wanted.get(place.instance_id);
     if (ask === undefined) return place;
     const rot = Math.round(ask.rot / 90) * 90;
     if (Math.abs(ask.rot - rot) > 1e-9) {
       throw new LayoutError(`${place.instance_id}: a rotation is a right angle (${ask.rot} is not)`);
     }
     const { rot_mdeg: _previousRotation, ...withoutRotation } = place;
     return {
       ...withoutRotation,
       x_nm: Math.round(ask.x * 1_000_000),
       y_nm: Math.round(ask.y * 1_000_000),
       ...(rot === 0 ? {} : { rot_mdeg: rot * 1000 }),
     };
   });
   for (const ask of request.places) {
     if (!current.some((place) => place.instance_id === ask.instance_id)) {
       throw new LayoutError(`${file}: the page does not place ${ask.instance_id}`);
     }
   }
   const moved = new Set<string>();
   current.forEach((place) => {
     const next = places.find((candidate) => candidate.instance_id === place.instance_id);
     if (next !== undefined && (next.x_nm !== place.x_nm || next.y_nm !== place.y_nm || next.rot_mdeg !== place.rot_mdeg)) {
       moved.add(place.instance_id);
     }
   });
   // Keep an omitted place section omitted: topology-only pages are valid project pages.
   return { places: view.place === undefined ? undefined : places, moved };
 }
type ViewField = NonNullable<SchematicView["field"]>[number];

interface PlannedFields {
  fields: SchematicView["field"];
  changed: boolean;
  set: { index?: number; field: ViewField }[];
  remove: { index: number }[];
}

function fieldKey(field: { instance_id: string; name: string }): string {
  return `${field.instance_id}\u0000${field.name}`;
}

/** Apply field set/remove operations without touching any other view fact. */
function computeFields(view: SchematicView, request: LayoutRequest, file: string): PlannedFields {
  const current = view.field ?? [];
  const byKey = new Map(current.map((field, index) => [fieldKey(field), { field, index }]));
  const set = request.fields ?? [];
  const remove = request.remove_fields ?? [];
  const seen = new Set<string>();
  for (const operation of [...set, ...remove]) {
    if (operation.name !== "Reference" && operation.name !== "Value") {
      throw new LayoutError(`${file}: field name must be Reference or Value: ${String(operation.name)}`);
    }
    const key = fieldKey(operation);
    if (seen.has(key)) throw new LayoutError(`${file}: duplicate field operation for ${operation.instance_id} ${operation.name}`);
    seen.add(key);
  }
  const placed = new Set((view.place ?? []).map((place) => place.instance_id));
  for (const operation of set) {
    if (!placed.has(operation.instance_id)) throw new LayoutError(`${file}: the page does not place ${operation.instance_id}`);
    if (!Number.isFinite(operation.x) || !Number.isFinite(operation.y)) {
      throw new LayoutError(`${file}: ${operation.instance_id} ${operation.name} coordinates must be finite`);
    }
    const x_nm = Math.round(operation.x * 1_000_000);
    const y_nm = Math.round(operation.y * 1_000_000);
    if (x_nm % 10_000 !== 0 || y_nm % 10_000 !== 0) {
      throw new LayoutError(`${file}: ${operation.instance_id} ${operation.name} coordinates are limited to 0.01 mm resolution`);
    }
  }
  for (const operation of remove) {
    if (!placed.has(operation.instance_id)) throw new LayoutError(`${file}: the page does not place ${operation.instance_id}`);
  }
  const next = new Map(current.map((field) => [fieldKey(field), field]));
  const plannedSet: PlannedFields["set"] = [];
  for (const operation of set) {
    const field: ViewField = {
      instance_id: operation.instance_id,
      name: operation.name,
      x_nm: Math.round(operation.x * 1_000_000),
      y_nm: Math.round(operation.y * 1_000_000),
    };
    const before = byKey.get(fieldKey(field));
    if (before?.field.x_nm !== field.x_nm || before.field.y_nm !== field.y_nm) {
      plannedSet.push({ ...(before === undefined ? {} : { index: before.index }), field });
    }
    next.set(fieldKey(field), field);
  }
  const plannedRemove: PlannedFields["remove"] = [];
  for (const operation of remove) {
    const before = byKey.get(fieldKey(operation));
    if (before !== undefined) {
      plannedRemove.push({ index: before.index });
      next.delete(fieldKey(operation));
    }
  }
  const fields = [...next.values()];
  return { fields: fields.length === 0 ? undefined : fields, changed: plannedSet.length > 0 || plannedRemove.length > 0, set: plannedSet, remove: plannedRemove };
}

interface PlannedTexts {
  labels: NonNullable<SchematicView["label"]>;
  ports: NonNullable<SchematicView["port"]>;
  /** The rows whose coordinates changed, with the index they came from. */
  labelsChanged: { index: number; label: NonNullable<SchematicView["label"]>[number] }[];
  portsChanged: { index: number; port: NonNullable<SchematicView["port"]>[number] }[];
  changed: boolean;
}

/**
 * Apply the label and port positions the app sends, without touching any other view fact.
 *
 * A label is identified by the net it names and a port by its `port_id`. Repeats are rejected rather
 * than resolved: two labels of one net sit at two places on the sheet, so "the label of net VOUT"
 * does not name one row, and a write that guessed would move the wrong one.
 */
function computeTexts(view: SchematicView, request: LayoutRequest, file: string): PlannedTexts {
  const asks = request.texts ?? [];
  const labels = view.label ?? [];
  const ports = view.port ?? [];
  if (asks.length === 0) return { labels, ports, labelsChanged: [], portsChanged: [], changed: false };

  const byNet = new Map<string, number[]>();
  labels.forEach((label, index) => {
    const list = byNet.get(label.net);
    if (list === undefined) byNet.set(label.net, [index]);
    else list.push(index);
  });
  const portIds = new Set(ports.map((port) => port.id));
  const seen = new Set<string>();
  for (const ask of asks) {
    if (ask.kind !== "label" && ask.kind !== "port") {
      throw new LayoutError(`${file}: a text row is a label or a port: ${String(ask.kind)}`);
    }
    const key = `${ask.kind}\u0000${ask.id}`;
    if (seen.has(key)) throw new LayoutError(`${file}: duplicate ${ask.kind} move for ${ask.id}`);
    seen.add(key);
    if (!Number.isFinite(ask.x) || !Number.isFinite(ask.y)) {
      throw new LayoutError(`${file}: ${ask.kind} ${ask.id} coordinates must be finite`);
    }
    const x_nm = Math.round(ask.x * 1_000_000);
    const y_nm = Math.round(ask.y * 1_000_000);
    if (x_nm % 10_000 !== 0 || y_nm % 10_000 !== 0) {
      throw new LayoutError(`${file}: ${ask.kind} ${ask.id} coordinates are limited to 0.01 mm resolution`);
    }
    if (ask.kind === "port") {
      if (!portIds.has(ask.id)) throw new LayoutError(`${file}: the page does not draw port ${ask.id}`);
      continue;
    }
    const rows = byNet.get(ask.id) ?? [];
    if (rows.length === 0) throw new LayoutError(`${file}: the page has no label for net ${ask.id}`);
    if (rows.length > 1) {
      throw new LayoutError(`${file}: net ${ask.id} has ${rows.length} labels on this page; a label is moved by its row, not by its net`);
    }
  }

  const nextLabels = labels.map((label) => {
    const ask = asks.find((candidate) => candidate.kind === "label" && candidate.id === label.net);
    if (ask === undefined) return label;
    return { ...label, x_nm: Math.round(ask.x * 1_000_000), y_nm: Math.round(ask.y * 1_000_000) };
  });
  const nextPorts = ports.map((port) => {
    const ask = asks.find((candidate) => candidate.kind === "port" && candidate.id === port.id);
    if (ask === undefined) return port;
    return { ...port, x_nm: Math.round(ask.x * 1_000_000), y_nm: Math.round(ask.y * 1_000_000) };
  });
  const labelsChanged = nextLabels
    .map((label, index) => ({ index, label }))
    .filter(({ index, label }) => label.x_nm !== labels[index]!.x_nm || label.y_nm !== labels[index]!.y_nm);
  const portsChanged = nextPorts
    .map((port, index) => ({ index, port }))
    .filter(({ index, port }) => port.x_nm !== ports[index]!.x_nm || port.y_nm !== ports[index]!.y_nm);
  return {
    labels: nextLabels,
    ports: nextPorts,
    labelsChanged,
    portsChanged,
    changed: labelsChanged.length > 0 || portsChanged.length > 0,
  };
}

/**
 * What a placement change would do, without doing it.
 *
 * The app draws the result before it commits it (ADR-0042 D5: Apply is the commit point), so the
 * plan carries the page's new source *and* the page as it would be drawn.
 */
export function planLayout(root: string, request: LayoutRequest): LayoutPlan {
  const target = layoutTarget(request);
  const file = target.file;
  const path = join(root, file);
  if (!existsSync(path)) {
    throw new LayoutError(target.kind === "module" ? `no such module drawing: ${file}` : `no such print page: ${file}`);
  }
  // The editor's text is the base when there is one; the file on disk is the base otherwise.
  const text = request.text ?? readFileSync(path, "utf8");

  const facts = target.kind === "module" ? loadModuleFacts(root, target.id) : projectFacts(root);
  const netMembers = target.kind === "module"
    ? (facts as ModuleFacts).nets
    : (facts as ProjectFacts).schematic.nets;
  const parsed = target.kind === "module" ? parseModuleView(text, { file }) : parseView(text, { file });
  if (!parsed.ir) {
    const first = parsed.diagnostics.find((diagnostic) => diagnostic.severity === "error");
    throw new LayoutError(`${file}: ${first ? `${first.code}: ${first.message}` : "the page does not parse"}`);
  }
  const view = parsed.ir as unknown as SchematicView;
  const automaticFields = request.automatic_fields === true;
  const fieldPositions: SchematicRenderOptions["fieldPositions"] = request.field_positions === undefined
    ? undefined
    : new Map(request.field_positions.map((field) => [`${field.instance_id}:${field.name}`, {
      x_nm: Math.round(field.x * 1_000_000),
      y_nm: Math.round(field.y * 1_000_000),
      ...(field.anchor === undefined ? {} : { anchor: field.anchor }),
    }]));
  const draw = (candidate: SchematicView) => target.kind === "module"
    ? drawModule(candidate as unknown as ModuleView, facts.instances, automaticFields, fieldPositions)
    : drawPage(candidate, facts.instances, automaticFields, fieldPositions);
  const geometryOf = (candidate: SchematicView) => target.kind === "module"
    ? moduleGeometry(candidate as unknown as ModuleView, facts.instances)
    : schematicGeometry(candidate, facts.instances);
  const repairWires = request.reanchor_wires === true;

  const { places: newPlaces, moved } = computePlacements(view, request, file);
  const plannedFields = computeFields(view, request, file);
  const plannedTexts = computeTexts(view, request, file);
  // drawn port goes through the re-anchor path even when no symbol moved. A page with no run
  // ending at that port needs no re-anchor, and keeps the cheaper path.
  const portEndsMoved =
    plannedTexts.portsChanged.length > 0 &&
    (() => {
      const before = new Map((view.port ?? []).map((port) => [port.id, { x_nm: port.x_nm, y_nm: port.y_nm }]));
      const after = new Map(plannedTexts.ports.map((port) => [port.id, { x_nm: port.x_nm, y_nm: port.y_nm }]));
      return (view.wire ?? []).some((wire) =>
        [wire.from_pin, wire.to_pin].some((end) => {
          if (typeof end !== "string" || end.includes(".")) return false;
          const from = before.get(end);
          const to = after.get(end);
          return from !== undefined && to !== undefined && (from.x_nm !== to.x_nm || from.y_nm !== to.y_nm);
        }),
      );
    })();
  if (moved.size === 0 && !portEndsMoved) {
    if (!plannedFields.changed && !plannedTexts.changed) {
      const drawn = draw(view);
      return {
        file,
        text,
        changed: false,
        conflicts: [],
        reseated: [],
        ...drawn,
        ...(repairWires ? {} : { stale: [] }),
      };
    }
    const edited = rewritePage(text, {
      file,
      sources: parsed.sources ?? new Map(),
      places: [],
      fields: plannedFields.set,
      remove_fields: plannedFields.remove,
      wires: [],
      labels: plannedTexts.labelsChanged,
      ports: plannedTexts.portsChanged,
    });
    const drawn = draw(withTexts(withFields(view, plannedFields.fields), plannedTexts));
    return {
      file,
      text: edited,
      changed: edited !== text,
      conflicts: [],
      reseated: [],
      ...drawn,
      ...(repairWires ? {} : { stale: [] }),
    };
  }
  const before = geometryOf(view);
  const after = geometryOf(withPlaces(view, newPlaces));

  // A module port is an endpoint of its own kind, drawn where the page says it sits. The layout
  // write never moves it (ADR-0067 D4), so the same points serve the page before and after the
  // move.
  const modulePorts = new Map(viewModulePorts(view).map((port) => [port.id, { x_nm: port.x_nm, y_nm: port.y_nm }]));

  // A junction is stationary when symbols move. Ports follow their authored row; pins follow symbols.
  const junctions = new Map((view.junction ?? []).map((junction) => [junction.id, { x_nm: junction.x_nm, y_nm: junction.y_nm }]));
  const portsBefore = new Map([
    ...(view.port ?? []).map((port) => [port.id, { x_nm: port.x_nm, y_nm: port.y_nm }] as const),
    ...junctions,
  ]);
  const portsAfter = new Map([
    ...plannedTexts.ports.map((port) => [port.id, { x_nm: port.x_nm, y_nm: port.y_nm }] as const),
    ...junctions,
  ]);
  const conflicts: string[] = [];
  const newWires = (view.wire ?? []).map((wire) => {
    if (!repairWires) return wire;
    const fromBefore = pinPoint(before, wire.from_pin, portsBefore, modulePorts);
    const toBefore = pinPoint(before, wire.to_pin, portsBefore, modulePorts);
    const fromAfter = pinPoint(after, wire.from_pin, portsAfter, modulePorts);
    const toAfter = pinPoint(after, wire.to_pin, portsAfter, modulePorts);
    if (!fromBefore || !toBefore || !fromAfter || !toAfter) return wire;
    const still =
      fromBefore.x_nm === fromAfter.x_nm &&
      fromBefore.y_nm === fromAfter.y_nm &&
      toBefore.x_nm === toAfter.x_nm &&
      toBefore.y_nm === toAfter.y_nm;
    if (still) return wire;
    const result = reanchorWire({
      net: wire.net,
      from_pin: typeof wire.from_pin === "string" ? wire.from_pin : "@coordinate",
      to_pin: typeof wire.to_pin === "string" ? wire.to_pin : "@coordinate",
      points: wire.points ?? [],
      from: fromBefore,
      to: toBefore,
      newFrom: fromAfter,
      newTo: toAfter,
    });
    if (result.conflict !== undefined) {
      conflicts.push(
        `${wire.net} ${wire.from_pin} → ${wire.to_pin}: the wire's shape could not be kept (${result.conflict})`,
      );
    }
    const kept = result.points.map((point) => ({ x_nm: point.x_nm, y_nm: point.y_nm }));
    // Re-anchoring keeps the shape, and a shape can be longer than the shortest drawing of the same
    // run: a corner that was needed before the move may be unnecessary after it. The shorter
    // drawing is used only when it is legal by the same rules the readability check applies, so a
    // detour drawn around something on purpose survives.
    const simplified = simplifyRun(
      [fromAfter, ...kept, toAfter],
      {
        ...obstaclesFor(wire, after),
        // Anchors are read off the run as it was drawn: where the labels and ports sat before the
        // move. They are the reason a bus keeps its line.
        anchors: anchorsFor(wire, [fromBefore, ...(wire.points ?? []).map((point) => ({ x_nm: point.x_nm, y_nm: point.y_nm })), toBefore], {
          labels: view.label ?? [],
          ports: view.port ?? [],
          portNets: facts.portNets,
          moved: { from: fromBefore, newFrom: fromAfter, to: toBefore, newTo: toAfter },
        }),
      },
    );
    return { ...wire, points: simplified.path.slice(1, -1) };
  });
  const reseated: string[] = [];
  let newLabels = plannedTexts.labels;
  let newPorts = plannedTexts.ports;
  if (repairWires) {
  const disturbed = new Set(
    (view.wire ?? [])
      .filter((wire, index) => newWires[index] !== wire)
      .map((wire) => wire.net),
  );
  // A net whose member pin moved is a net whose drawing moved, even when none of its wires did:
  // a label may sit on that pin instead of on a wire (spec/schematic-view.md §6), and it has to
  // travel with the pin it named.
  const membersOf = new Map<string, string[]>();
  for (const net of netMembers ?? []) membersOf.set(net.id, net.members ?? []);
  for (const [net, members] of membersOf) {
    for (const member of members) {
      const dot = member.lastIndexOf(".");
      if (dot <= 0) continue;
      if (!moved.has(member.slice(0, dot))) continue;
      disturbed.add(net);
      break;
    }
  }

  // A label or a port that the move left in the air is put back on the net it names — except the
  // ones the person placed by hand: an explicit position is a decision, and `reseatOnNet` is a
  // repair for an accident, not a preference over the author.
  const placedLabels = new Set(plannedTexts.labelsChanged.map(({ label }) => label.net));
  const placedPorts = new Set(plannedTexts.portsChanged.map(({ port }) => port.id));
  // Where each net runs, gathered in one pass. Asking per label would rescan every wire on the
  // page each time, which turns a page with many labels on one net into quadratic work for a
  // single move.
  const pathsByNet = new Map<string, WireCorners[][]>();
  for (const wire of newWires) {
    const from = pinPoint(after, wire.from_pin, portsAfter, modulePorts);
    const to = pinPoint(after, wire.to_pin, portsAfter, modulePorts);
    if (from === undefined || to === undefined) continue;
    const bends = (wire.points ?? []).map((point) => ({ x_nm: point.x_nm, y_nm: point.y_nm }));
    const paths = pathsByNet.get(wire.net);
    if (paths === undefined) pathsByNet.set(wire.net, [[from, ...bends, to]]);
    else paths.push([from, ...bends, to]);
  }
  // A net's member pins are part of its drawing: a label may sit on a pin instead of on a wire
  // (spec/schematic-view.md §6), so a move that takes the pin away has to carry the label with it.
  // Only the nets this page draws are completed this way — a page that leaves a net out is a
  // sketch, and the checker says so in its own words.
  const addMemberPins = (
    paths: Map<string, WireCorners[][]>,
    geometry: SheetGeometry,
    ports: ReadonlyMap<string, { x_nm: number; y_nm: number }>,
  ): void => {
    for (const [net, drawn] of paths) {
      for (const member of membersOf.get(net) ?? []) {
        const at = pinPoint(geometry, member, ports, modulePorts);
        if (at === undefined) continue;
        drawn.push([at]);
      }
    }
  };
  addMemberPins(pathsByNet, after, portsAfter);
  const pathsOf = (net: string): WireCorners[][] => pathsByNet.get(net) ?? [];
  // Where each net ran before the move. A label that was already on its net's wiring belongs to
  // that net and follows it; a label the person put somewhere else is a free placement, and a
  // move elsewhere on the page is no reason to pick it up and carry it to the wire.
  const oldPathsByNet = new Map<string, WireCorners[][]>();
  for (const wire of view.wire ?? []) {
    const from = pinPoint(before, wire.from_pin, portsBefore, modulePorts);
    const to = pinPoint(before, wire.to_pin, portsBefore, modulePorts);
    if (from === undefined || to === undefined) continue;
    const bends = (wire.points ?? []).map((point) => ({ x_nm: point.x_nm, y_nm: point.y_nm }));
    const paths = oldPathsByNet.get(wire.net);
    if (paths === undefined) oldPathsByNet.set(wire.net, [[from, ...bends, to]]);
    else paths.push([from, ...bends, to]);
  }
  addMemberPins(oldPathsByNet, before, portsBefore);
  /** Whether a point was sitting on the net's own wiring before the move. */
  const wasOnNet = (net: string, point: { x_nm: number; y_nm: number }): boolean => {
    for (const path of oldPathsByNet.get(net) ?? []) {
      const foot = nearestOnPath(path, point);
      if (foot !== undefined && Math.hypot(foot.x_nm - point.x_nm, foot.y_nm - point.y_nm) <= ON_NET_NM) {
        return true;
      }
    }
    return false;
  };
  newLabels = plannedTexts.labels.map((label) => {
    if (placedLabels.has(label.net)) return label;
    if (!disturbed.has(label.net)) return label;
    const point = { x_nm: label.x_nm, y_nm: label.y_nm };
    if (!wasOnNet(label.net, point)) return label;
    const moved2 = reseatOnNet(pathsOf(label.net), point);
    if (moved2 === undefined) return label;
    reseated.push(`label ${label.net}`);
    return { ...label, x_nm: moved2.x_nm, y_nm: moved2.y_nm };
  });
  newPorts = plannedTexts.ports.map((port) => {
    if (placedPorts.has(port.id)) return port;
    const net = facts.portNets.get(port.id);
    if (net === undefined || !disturbed.has(net)) return port;
    const point = { x_nm: port.x_nm, y_nm: port.y_nm };
    if (!wasOnNet(net, point)) return port;
    const moved2 = reseatOnNet(pathsOf(net), point);
    if (moved2 === undefined) return port;
    reseated.push(`port ${port.id}`);
    return { ...port, x_nm: moved2.x_nm, y_nm: moved2.y_nm };
  });
  }

  const stale = repairWires
    ? undefined
    : staleNets(view, moved, new Set(plannedTexts.portsChanged.map(({ port }) => port.id)));
  const edited = rewritePage(text, {
    file,
    kind: target.kind,
    sources: parsed.sources ?? new Map(),
    places: (newPlaces ?? [])
      .map((place, index) => ({ index, place }))
      .filter(({ index, place }) => {
        const before = (view.place ?? [])[index]!;
        return before.x_nm !== place.x_nm || before.y_nm !== place.y_nm || before.rot_mdeg !== place.rot_mdeg;
      }),
    fields: plannedFields.set,
    remove_fields: plannedFields.remove,
    wires: newWires
      .map((wire, index) => ({ index, wire }))
      .filter(({ index, wire }) => !sameWire(view.wire?.[index], wire)),
    labels: newLabels
      .map((label, index) => ({ index, label }))
      .filter(({ index, label }) => {
        const before = view.label?.[index];
        return before !== undefined && (before.x_nm !== label.x_nm || before.y_nm !== label.y_nm);
      }),
    ports: newPorts
      .map((port, index) => ({ index, port }))
      .filter(({ index, port }) => {
        const before = view.port?.[index];
        return before !== undefined && (before.x_nm !== port.x_nm || before.y_nm !== port.y_nm);
      }),
  });
  if (edited === text) {
    const drawn = draw(view);
    return { file, text, changed: false, conflicts, reseated, ...drawn, ...(stale === undefined ? {} : { stale }) };
  }
  const drawn = draw(withFields(withPlaces({ ...view, wire: newWires, label: newLabels, port: newPorts }, newPlaces), plannedFields.fields));
  return { file, text: edited, changed: true, conflicts, reseated, ...drawn, ...(stale === undefined ? {} : { stale }) };
}

/**
 * Move the symbols the app asks for and write back **only** the `place` rows (ADR-0043 D3).
 *
 * This is the plugin's write: a drag moves a symbol and nothing else. The wires whose pins moved
 * keep the corners they were written with, so they go stale; the staleness is reported (`stale`)
 * and the page is drawn as the file now says it is — moved symbols, stale wires, no re-anchor —
 * because that is the honest picture. Re-anchoring stays with the command line (`texteda view
 * rewire`, ADR-0043 D10). `applyLayout` is the standalone app's write: it also re-anchors and
 * reseats.
 */
export function applyPlaces(root: string, request: LayoutRequest): PlacesOutcome {
  const plan = planPlaces(root, request);
  if (plan.changed) writeFile(root, plan.file, plan.text);
  return { file: plan.file, changed: plan.changed, stale: plan.stale };
}

/**
 * What a places-only write would do, without doing it.
 *
 * The page's new source is the formatter's output, and the page is drawn as it would be after the
 * change — the symbols at their new places and the wires as they were written (ADR-0043 D5) — so
 * the drawing shows the staleness instead of hiding it.
 */
export function planPlaces(root: string, request: LayoutRequest): PlacesPlan {
  if (request.page === undefined || request.module !== undefined) {
    throw new LayoutError("a places-only write targets a print page");
  }
  const file = pageFile(request.page);
  const path = join(root, file);
  if (!existsSync(path)) throw new LayoutError(`no such print page: ${file}`);
  // The editor's text is the base when there is one; the file on disk is the base otherwise.
  const text = request.text ?? readFileSync(path, "utf8");

  const facts = projectFacts(root);
  const parsed = parseView(text, { file });
  if (!parsed.ir) {
    const first = parsed.diagnostics.find((diagnostic) => diagnostic.severity === "error");
    throw new LayoutError(`${file}: ${first ? `${first.code}: ${first.message}` : "the page does not parse"}`);
  }
  const view = parsed.ir;
  const { places: newPlaces, moved } = computePlacements(view, request, file);
  if (moved.size === 0) {
    const drawn = drawPage(view, facts.instances);
    return { file, changed: false, stale: [], text, ...drawn };
  }

  const stale = staleNets(view, moved);
  const drawn = drawPage(withPlaces(view, newPlaces), facts.instances);
  const edited = rewritePage(text, {
    file,
    kind: "page",
    sources: parsed.sources ?? new Map(),
    places: (newPlaces ?? [])
      .map((place, index) => ({ index, place }))
      .filter(({ index, place }) => {
        const before = (view.place ?? [])[index]!;
        return before.x_nm !== place.x_nm || before.y_nm !== place.y_nm || before.rot_mdeg !== place.rot_mdeg;
      }),
    wires: [],
    labels: [],
    ports: [],
  });
  return { file, changed: edited !== text, stale, text: edited, ...drawn };
}

/**
 * The nets whose wires name a symbol that moved: their pins no longer sit where the wire was drawn.
 */
function staleNets(
  view: SchematicView,
  moved: ReadonlySet<string>,
  movedPorts?: ReadonlySet<string>,
): string[] {
  const stale = new Set<string>();
  for (const wire of view.wire ?? []) {
    for (const ref of [wire.from_pin, wire.to_pin]) {
      if (typeof ref !== "string") continue;
      if (movedPorts?.has(ref)) stale.add(wire.net);
      // A module port names a module's interface, not a placed instance: nothing the layout write
      // moves can leave it behind, so it never makes a net stale (spec/schematic-view.md §5).
      if (MODULE_PORT_ENDPOINT.test(ref)) continue;
      const dot = ref.lastIndexOf(".");
      if (dot > 0 && moved.has(ref.slice(0, dot))) stale.add(wire.net);
    }
  }
  return [...stale].sort();
}
function withFields(view: SchematicView, fields: SchematicView["field"]): SchematicView {
  if (fields !== undefined) return { ...view, field: fields };
  const withoutFields = { ...view };
  delete withoutFields.field;
  return withoutFields;
}
/** The view with the planned component placements, preserving an omitted place section. */
function withPlaces(view: SchematicView, places: SchematicView["place"]): SchematicView {
  if (places !== undefined) return { ...view, place: places };
  const withoutPlaces = { ...view };
  delete withoutPlaces.place;
  return withoutPlaces;
}


/** The view with the planned label and port positions, leaving every other fact alone. */
function withTexts(view: SchematicView, planned: PlannedTexts): SchematicView {
  if (!planned.changed) return view;
  const next = { ...view };
  if (planned.labelsChanged.length > 0) next.label = planned.labels;
  if (planned.portsChanged.length > 0) next.port = planned.ports;
  return next;
}

/** Append the advisory interconnect symbols declared by this page. */
export function renderInterconnects(
  view: SchematicView,
  doc: SvgDoc,
  modulePortPoints: ReadonlyMap<string, { x_nm: number; y_nm: number }> = new Map(),
): SvgDoc {
  if (view.interconnect === undefined || view.interconnect.length === 0) return doc;
  const primitives = [...doc.primitives];
  for (const row of view.interconnect) {
    const from = modulePortPoints.get(row.from);
    const to = modulePortPoints.get(row.to);
    const x = row.x_nm ?? (from !== undefined && to !== undefined ? Math.round((from.x_nm + to.x_nm) / 2) : 0);
    const y = row.y_nm ?? (from !== undefined && to !== undefined ? Math.round((from.y_nm + to.y_nm) / 2) : 0);
    const rotation = row.rot_mdeg ?? 0;
    const rotated = (dx: number, dy: number): { x: number; y: number } => {
      switch (rotation) {
        case 90000:
          return { x: -dy, y: dx };
        case 180000:
          return { x: -dx, y: -dy };
        case 270000:
          return { x: dy, y: -dx };
        default:
          return { x: dx, y: dy };
      }
    };
    const left = rotated(-6_000_000, 0);
    const right = rotated(6_000_000, 0);
    const ref = `interconnect:${row.id}`;
    const identity = { ref, layer: "interconnect" };
    primitives.push(
      {
        kind: "line",
        x1: x + left.x,
        y1: y + left.y,
        x2: x + right.x,
        y2: y + right.y,
        widthNm: 350_000,
        layer: "interconnect",
        ref,
      },
      {
        kind: "circle",
        cx: x + left.x,
        cy: y + left.y,
        rNm: 1_500_000,
        widthNm: 350_000,
        fill: "none",
        ...identity,
      },
      {
        kind: "circle",
        cx: x + right.x,
        cy: y + right.y,
        rNm: 1_500_000,
        widthNm: 350_000,
        fill: "none",
        ...identity,
      },
      {
        kind: "text",
        x,
        y: y + 3_000_000,
        text: row.id,
        sizeNm: 2_000_000,
        anchor: "middle",
        rotateMdeg: rotation,
        role: "text",
        ...identity,
      },
    );
  }
  return { ...doc, primitives };
}

/** The page as it is drawn: the renderer's drawing commands, its SVG and the geometry it was drawn from. */
function drawPage(
  view: SchematicView,
  instances: SchematicInstances,
  automaticFields = true,
  fieldPositions?: SchematicRenderOptions["fieldPositions"],
): { svg: string; geometry: SheetGeometry; doc: SvgDoc | null } {
  const options = { automaticFields, ...(fieldPositions === undefined ? {} : { fieldPositions }) };
  try {
    const doc = renderSchematic(view, instances, options);
    const drawn = renderInterconnects(
      view,
      doc,
      new Map(viewModulePorts(view).map((port) => [port.id, { x_nm: port.x_nm, y_nm: port.y_nm }] as const)),
    );
    return {
      svg: toSvgText(drawn),
      doc: drawn,
      geometry: schematicGeometry(view, instances, options),
    };
  } catch {
    // A page that cannot be drawn is reported by the check; here it is simply not drawn.
    return { svg: "", geometry: { texts: [], fields: [], symbols: [] }, doc: null };
  }
}

/** A module drawing as it is drawn: the renderer's SVG and the geometry it was drawn from. */
function drawModule(
  view: ModuleView,
  instances: SchematicInstances,
  automaticFields = true,
  fieldPositions?: SchematicRenderOptions["fieldPositions"],
): { svg: string; geometry: SheetGeometry } {
  const options = { automaticFields, ...(fieldPositions === undefined ? {} : { fieldPositions }) };
  try {
    return {
      svg: toSvgText(renderModuleDrawing(view, instances, options)),
      geometry: moduleGeometry(view, instances, options),
    };
  } catch {
    // A drawing that cannot be drawn is reported by the check; here it is simply not drawn.
    return { svg: "", geometry: { texts: [], fields: [], symbols: [] } };
  }
}

/**
 * Write a page's source, in the formatter's form.
 *
 * The text is checked before it is written: a page that does not parse is a page the person has to
 * fix, and writing it would leave the project in a state the tools cannot read.
 */
export function savePageSource(root: string, page: string, text: string): { file: string; changed: boolean; errors: string[] } {
  const file = pageFile(page);
  const formatted = formatView(text, { file });
  const errors = formatted.diagnostics
    .filter((diagnostic) => diagnostic.severity === "error")
    .map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`);
  if (errors.length > 0 || formatted.text === undefined) return { file, changed: false, errors };
  // The page keeps the module rows and the module-port endpoints it was written with (ADR-0067
  // D4): a save that dropped them would take the overview's boxes away, so it is not made.
  const facts = pageFacts(text);
  const formattedFacts = pageFacts(formatted.text);
  if (facts.moduleRows.join("\n") !== formattedFacts.moduleRows.join("\n")) {
    return { file, changed: false, errors: [...errors, `${file}: the formatter would drop the page's module rows`] };
  }
  if (facts.moduleEndpoints.join("\n") !== formattedFacts.moduleEndpoints.join("\n")) {
    return {
      file,
      changed: false,
      errors: [...errors, `${file}: the formatter would drop the page's module-port wire endpoints`],
    };
  }
  const path = join(root, file);
  const before = existsSync(path) ? readFileSync(path, "utf8") : "";
  if (before === formatted.text) return { file, changed: false, errors: [] };
  writeFile(root, file, formatted.text);
  return { file, changed: true, errors: [] };
}

/**
 * Write a module drawing's source, in the formatter's form.
 *
 * The same rule as a page: the text is checked before it is written, so a drawing that does not
 * parse is never left on disk. A module drawing has no module boxes or module-port endpoints to
 * preserve, so the page-specific formatter guards do not apply.
 */
export function saveModuleSource(root: string, module: string, text: string): { file: string; changed: boolean; errors: string[] } {
  const file = moduleFile(module);
  const formatted = formatModuleView(text, { file });
  const errors = formatted.diagnostics
    .filter((diagnostic) => diagnostic.severity === "error")
    .map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`);
  if (errors.length > 0 || formatted.text === undefined) return { file, changed: false, errors };
  const path = join(root, file);
  const before = existsSync(path) ? readFileSync(path, "utf8") : "";
  if (before === formatted.text) return { file, changed: false, errors: [] };
  writeFile(root, file, formatted.text);
  return { file, changed: true, errors: [] };
}

/**
 * A page's source as it would be drawn, with what the parser says about it.
 *
 * The explicit Source panel shows the source and the drawing of the same text: the browser cannot
 * parse a `.teda` file, so the server draws it (ADR-0056 D3: the file system and the parser stay
 * here).
 */
export function renderPageSource(
  root: string,
  page: string,
  text: string,
  automaticFields = true,
): { svg: string; errors: string[]; anchors: RowAnchor[]; geometry: SheetGeometry; doc: SvgDoc | null } {
  const file = pageFile(page);
  const parsed = parseView(text, { file });
  const errors = parsed.diagnostics
    .filter((diagnostic) => diagnostic.severity === "error")
    .map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`);
  if (!parsed.ir) return { svg: "", errors, anchors: [], geometry: { texts: [], fields: [], symbols: [] }, doc: null };
  const facts = projectFacts(root);
  const drawn = drawPage(parsed.ir, facts.instances, automaticFields);
  return {
    ...drawn,
    errors,
    anchors: rowAnchors(parsed.ir, parsed.sources),
  };
}

/**
 * A module drawing's source as it would be drawn, with what the parser says about it.
 *
 * The Source panel shows the same drawing for a module view that it shows for a page: the browser
 * cannot parse a `.teda` file, so the server draws the draft here.
 */
export function renderModuleSource(
  root: string,
  module: string,
  text: string,
  automaticFields = true,
): { svg: string; errors: string[]; anchors: RowAnchor[]; geometry: SheetGeometry } {
  const file = moduleFile(module);
  const parsed = parseModuleView(text, { file });
  const errors = parsed.diagnostics
    .filter((diagnostic) => diagnostic.severity === "error")
    .map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`);
  if (!parsed.ir) return { svg: "", errors, anchors: [], geometry: { texts: [], fields: [], symbols: [] } };
  const facts = loadModuleFacts(root, module);
  const drawn = drawModule(parsed.ir, facts.instances, automaticFields);
  return {
    ...drawn,
    errors,
    anchors: rowAnchors(parsed.ir as unknown as SchematicView, parsed.sources),
  };
}

/** One row of a page: what it is about, and the line it is on. */
export interface RowAnchor {
  /** What the row names: an instance id, a net, a port id. */
  key: string;
  kind: "place" | "wire" | "label" | "port";
  line: number;
}

/**
 * Where each row of a page is, so a click on the drawing can put the cursor on the row.
 *
 * The line comes from the parser's source map, so it is the line of the text that was parsed and
 * not of the file on disk (ADR-0004 D2).
 */
function rowAnchors(view: SchematicView, sources: SourceMap | undefined): RowAnchor[] {
  if (sources === undefined) return [];
  const anchors: RowAnchor[] = [];
  const line = (pointer: string): number | undefined => spanOf(sources, pointer)?.line;
  (view.place ?? []).forEach((place, index) => {
    const at = line(`/place/${index}`);
    if (at !== undefined) anchors.push({ key: place.instance_id, kind: "place", line: at });
  });
  (view.wire ?? []).forEach((wire, index) => {
    const at = line(`/wire/${index}`);
    if (at !== undefined) anchors.push({ key: wire.net, kind: "wire", line: at });
  });
  (view.label ?? []).forEach((label, index) => {
    const at = line(`/label/${index}`);
    if (at !== undefined) anchors.push({ key: label.net, kind: "label", line: at });
  });
  (view.port ?? []).forEach((port, index) => {
    const at = line(`/port/${index}`);
    if (at !== undefined) anchors.push({ key: port.id, kind: "port", line: at });
  });
  return anchors;
}

/** The facts a page's drawing needs: the project's schematic and the symbols it places. */
export interface ProjectFacts {
  schematic: Schematic;
  instances: SchematicInstances;
  /** A project port id → the net it names. */
  portNets: Map<string, string>;
}

export function projectFacts(root: string): ProjectFacts {
  const loaded = loadSchematic(root);
  if (!loaded) throw new LayoutError("project root file not found: design/sch/main.teda");
  const { resolver, shards } = loadComponents(root);
  const modules = loadModules(root);
  const symbolLibrary = loadSymbolLibrary(root);
  const componentOf = (componentId: string) => shards.find((shard) => shard.id === componentId)?.ir.component;
  const pinsOf = (componentId: string) => resolver.resolve(componentId)?.pins ?? [];
  const symbolOf = (componentId: string) => componentOf(componentId)?.symbol;
  const deviceOf = (componentId: string) => {
    const component = componentOf(componentId);
    if (component === undefined) return undefined;
    return {
      params: component.params ?? [],
      ...(component.mpn === undefined ? {} : { mpn: component.mpn }),
    };
  };
  const parsed = parseSchematic(loaded.text, {
    file: loaded.file,
    components: resolver,
    modules,
  });
  if (!parsed.ir) throw new LayoutError(`${loaded.file}: the project schematic does not compile`);
  const schematic = parsed.ir as Schematic;
  const instances = schematicInstances(schematic, pinsOf, symbolOf, symbolLibrary, deviceOf);
  const portNets = new Map<string, string>();
  for (const port of schematic.ports ?? []) portNets.set(port.id, port.net);
  return { schematic, instances, portNets };
}
/**
 * What a run must not run through, for the simplification pass.
 *
 * Every placed symbol is an obstacle: its body, and the stroke of each pin other than the run's own
 * ends. The candidate paths are axis-parallel, so one pass over the symbols answers the question the
 * readability check would otherwise answer after a write.
 */
function obstaclesFor(
  wire: NonNullable<SchematicView["wire"]>[number],
  geometry: SheetGeometry,
): RunObstacles {
  // A port end is not a pin, so it never needs exempting: the run's own pins are named here, and a
  // port's point is not in any symbol's pin map.
  const ends = [wire.from_pin, wire.to_pin].filter((ref): ref is string => typeof ref === "string" && ref.includes("."));
  return { symbols: geometry.symbols, ends };
}

/**
 * The labels and ports the drawing sits on a net's runs.
 *
 * They are the anchors a shortening has to keep: a label names a net and lies on that net's wiring,
 * so a shortening that takes the line away from underneath it would either leave it in the air or
 * carry it to whatever line is left. The label at the far end of a bus is exactly what a bus is
 * for, and this is the fact that tells a bus apart from a redundant detour when the two are the
 * same shape on the sheet.
 */
function anchorsFor(
  wire: NonNullable<SchematicView["wire"]>[number],
  drawn: readonly WireCorners[],
  texts: {
    labels: readonly NonNullable<SchematicView["label"]>[number][];
    ports: readonly NonNullable<SchematicView["port"]>[number][];
    portNets: ReadonlyMap<string, string>;
    moved: { from: WireCorners; newFrom: WireCorners; to: WireCorners; newTo: WireCorners };
  },
): { point: WireCorners; slack_nm: number }[] {
  const on = (point: { x_nm: number; y_nm: number }): boolean => {
    for (let i = 0; i + 1 < drawn.length; i += 1) {
      if (distanceToSegment(point, drawn[i]!, drawn[i + 1]!) <= ON_LINE_NM) return true;
    }
    return false;
  };
  const slack = Math.max(
    Math.abs(texts.moved.from.x_nm - texts.moved.newFrom.x_nm),
    Math.abs(texts.moved.from.y_nm - texts.moved.newFrom.y_nm),
    Math.abs(texts.moved.to.x_nm - texts.moved.newTo.x_nm),
    Math.abs(texts.moved.to.y_nm - texts.moved.newTo.y_nm),
  );
  const anchors: { point: WireCorners; slack_nm: number }[] = [];
  for (const label of texts.labels) {
    if (label.net !== wire.net) continue;
    if (on(label)) anchors.push({ point: { x_nm: label.x_nm, y_nm: label.y_nm }, slack_nm: slack });
  }
  for (const port of texts.ports) {
    // A port belongs to a net through the project's ports, not through its own row. A run that ends
    // at the port already has it as an end, and the end is exempt; the ones that matter are the
    // ports of the net that sit on this run.
    const net = texts.portNets.get(port.id);
    if (net !== wire.net) continue;
    if (on(port)) anchors.push({ point: { x_nm: port.x_nm, y_nm: port.y_nm }, slack_nm: slack });
  }
  return anchors;
}
/**
 * Where a run's end sits on the sheet: a pin, a drawn port, a drawn module port, or an absolute
 * coordinate.
 *
 * A module port resolves to where the page draws it and never to a pin of a symbol called `M1`:
 * the two are different kinds of endpoint, and the layout write may not read one as the other
 * (spec/schematic-view.md §5).
 */
export function pinPoint(
  geometry: SheetGeometry,
  ref: string | { x_nm: number; y_nm: number },
  ports?: ReadonlyMap<string, { x_nm: number; y_nm: number }>,
  modulePorts?: ReadonlyMap<string, { x_nm: number; y_nm: number }>,
): { x_nm: number; y_nm: number } | undefined {
  if (typeof ref !== "string") return { x_nm: ref.x_nm, y_nm: ref.y_nm };
  const dot = ref.lastIndexOf(".");
  if (dot <= 0) return ports?.get(ref);
  const modulePort = modulePorts?.get(ref);
  if (modulePort !== undefined) return modulePort;
  if (MODULE_PORT_ENDPOINT.test(ref)) return undefined;
  const instance = geometry.symbols.find((symbol) => symbol.instance_id === ref.slice(0, dot));
  return instance?.pins.get(ref.slice(dot + 1));
}

/** One row of a view file: the line it is on and the cells it is made of. */
interface ViewRow {
  line: Line;
  cells: Cell[];
}

/**
 * The page's source with the changed rows rewritten.
 *
 * The rows are rewritten whole: the number of corners a wire has can change, and a row that is
 * rebuilt from its parts is easier to get right than one whose tail is patched. Each row is found
 * through the parser's source map, so a row is matched by the record it came from and not by its
 * text — two labels of the same net are two different rows. The formatter then aligns the columns.
 */
export function rewritePage(
  text: string,
  changed: {
    file: string;
    /** The formatter and the row guards: a print page or a module drawing. */
    kind?: "page" | "module";
    sources: SourceMap;
    places: { index: number; place: ViewPlace }[];
    fields?: { index?: number; field: ViewField }[];
    remove_fields?: { index: number }[];
    wires: { index: number; wire: NonNullable<SchematicView["wire"]>[number] }[];
    labels: { index: number; label: NonNullable<SchematicView["label"]>[number] }[];
    ports: { index: number; port: NonNullable<SchematicView["port"]>[number] }[];
  },
): string {
  const lines = text.split("\n");
  const edits: { line: number; col: number; old: string; new: string }[] = [];
  // The page is lexed once, not once per changed row: a move that touches many rows would
  // otherwise rescan the whole file for each of them, which is quadratic in the page's size.
  const lexed = new Map(lex(text).map((line) => [line.number, line]));
  const rowOf = (path: string): ViewRow | undefined => {
    const span = spanOf(changed.sources, path);
    if (span === undefined) return undefined;
    const line = lexed.get(span.line);
    if (line === undefined || line.cells.length === 0) return undefined;
    return { line, cells: line.cells };
  };

  changed.places.forEach(({ index, place }) => {
    const row = rowOf(`/place/${index}`);
    if (!row) return;
    const cells = [place.instance_id, point(place.x_nm, place.y_nm)];
    if (place.rot_mdeg !== undefined) cells.push(String(place.rot_mdeg / 1000));
    else if (row.cells[3] !== undefined) cells.push("0");
    const unit = row.cells.find((cell) => cell.text.includes("="));
    if (unit !== undefined) cells.push(unit.text);
    edits.push(rowEdit(row, lines, cells.join("  ")));
  });
  (changed.fields ?? []).forEach(({ index, field }) => {
    if (index === undefined) return;
    const row = rowOf(`/field/${index}`);
    if (!row) return;
    edits.push(rowEdit(row, lines, [field.instance_id, field.name, point(field.x_nm, field.y_nm)].join("  ")));
  });
  (changed.remove_fields ?? []).forEach(({ index }) => {
    const row = rowOf(`/field/${index}`);
    if (!row) return;
    edits.push(rowEdit(row, lines, ""));
  });

  changed.wires.forEach(({ index, wire }) => {
    const row = rowOf(`/wire/${index}`);
    if (!row) return;
    const cells = [wire.net, wire.from_pin, wire.to_pin];
    for (const bend of wire.points ?? []) cells.push(point(bend.x_nm, bend.y_nm));
    edits.push(rowEdit(row, lines, cells.join("  ")));
  });

  changed.labels.forEach(({ index, label }) => {
    const row = rowOf(`/label/${index}`);
    if (!row) return;
    edits.push(rowEdit(row, lines, [label.net, point(label.x_nm, label.y_nm)].join("  ")));
  });

  changed.ports.forEach(({ index, port }) => {
    const row = rowOf(`/port/${index}`);
    if (!row) return;
    const cells = [port.id, point(port.x_nm, port.y_nm)];
    if (port.rot_mdeg !== undefined) cells.push(String(port.rot_mdeg / 1000));
    edits.push(rowEdit(row, lines, cells.join("  ")));
  });

  let edited = applyEdits(lines, edits);
  const newFields = (changed.fields ?? []).filter(({ index }) => index === undefined).map(({ field }) => field);
  if (newFields.length > 0) edited = insertFieldRows(edited, newFields);
  const formatted = changed.kind === "module"
    ? formatModuleView(edited, { file: changed.file })
    : formatView(edited, { file: changed.file });
  if (formatted.text === undefined) {
    const first = formatted.diagnostics.find((diagnostic) => diagnostic.severity === "error");
    throw new LayoutError(`${changed.file}: the rewritten drawing does not parse: ${first ? first.message : "unknown"}`);
  }
  if (changed.kind === "module") {
    // A module drawing has no module rows or module-port endpoints to preserve, and the module
    // formatter has already decided the canonical form.
    return formatted.text;
  }
  // A write is a drawing change and nothing else: the page keeps the language version it was
  // written in (a 0.11 page still reads `sheet`, a 0.12 page still reads `size`; ADR-0067 D6) and
  // keeps the module rows and the module-port endpoints it was drawn with (ADR-0067 D4). A
  // rewrite that lost them would take the overview's boxes away, so it is refused, not written.
  const before = pageFacts(text);
  const after = pageFacts(formatted.text);
  if (before.version !== undefined && after.version !== before.version) {
    throw new LayoutError(
      `${changed.file}: the rewrite changed the page's language version (${before.version} to ${after.version})`,
    );
  }
  if (before.moduleRows.join("\n") !== after.moduleRows.join("\n")) {
    throw new LayoutError(`${changed.file}: the rewrite would drop the page's module rows`);
  }
  if (before.moduleEndpoints.join("\n") !== after.moduleEndpoints.join("\n")) {
    throw new LayoutError(`${changed.file}: the rewrite would drop the page's module-port wire endpoints`);
  }
  return formatted.text;
}

/** What a page's source says about itself: the version it declares and the module facts it draws. */
interface PageFacts {
  /** The version the first line declares (`version 0.12`). */
  version: string | undefined;
  /** The `module` and `module_port` rows, as their cells, sorted. */
  moduleRows: string[];
  /** The module-port endpoints the wire rows name, sorted. */
  moduleEndpoints: string[];
}

/**
 * Read a page's own facts off its source.
 *
 * The rows are read as cells, so a rewrite that only realigns the columns still compares equal: a
 * module box is the same box when its cells are the same, and the canonical form is what decides
 * how they are written (spec/schematic-view.md §11).
 */
function pageFacts(text: string): PageFacts {
  const facts: PageFacts = { version: undefined, moduleRows: [], moduleEndpoints: [] };
  let section = "";
  for (const line of lex(text)) {
    if (line.blank || line.comment) continue;
    const cells = line.cells.map((cell) => cell.text);
    if (facts.version === undefined && cells[0] === "version") {
      facts.version = cells[1];
      continue;
    }
    if (cells.length === 1) {
      section = cells[0]!;
      continue;
    }
    if (section === "module" || section === "module_port") {
      facts.moduleRows.push(`${section} ${cells.join(" ")}`);
      continue;
    }
    if (section === "wire") {
      for (const cell of cells.slice(1, 3)) {
        if (MODULE_PORT_ENDPOINT.test(cell)) facts.moduleEndpoints.push(cell);
      }
    }
  }
  facts.moduleRows.sort();
  facts.moduleEndpoints.sort();
  return facts;
}

/** Insert new field overrides before comments belonging to the following section. */
function insertFieldRows(text: string, fields: readonly ViewField[]): string {
  const lines = text.split("\n");
  const parsed = lex(text);
  const sections = new Set(["place", "field", "module", "module_port", "junction", "wire", "label", "port", "text"]);
  const section = (line: Line): string | undefined =>
    line.cells.length === 1 && sections.has(line.cells[0]!.text) ? line.cells[0]!.text : undefined;
  const ignorable = (line: string | undefined): boolean => line === undefined || line.trim() === "" || line.trimStart().startsWith("#");
  const fieldHeader = parsed.findIndex((line) => section(line) === "field");
  const nextSection = fieldHeader >= 0
    ? parsed.slice(fieldHeader + 1).find((line) => section(line) !== undefined && section(line) !== "field")
    : parsed.find((line) => section(line) !== undefined && section(line) !== "place");
  let insertion = nextSection === undefined ? lines.length - 1 : nextSection.number - 1;
  while (insertion > 0 && ignorable(lines[insertion - 1])) insertion -= 1;
  const rows = fields.map((field) => `  ${field.instance_id}  ${field.name}  ${point(field.x_nm, field.y_nm)}`);
  lines.splice(insertion, 0, ...(fieldHeader < 0 ? ["field", ...rows] : rows));
  return lines.join("\n");
}


function rowEdit(row: ViewRow, lines: string[], next: string): { line: number; col: number; old: string; new: string } {
  const first = row.cells[0]!;
  const original = lines[row.line.number - 1] ?? "";
  const old = original.slice(first.col - 1).replace(/[ \t\r]+$/, "");
  return { line: row.line.number, col: first.col, old, new: next };
}

/** Apply the edits, right to left, so the columns of a line stay valid. */
function applyEdits(lines: string[], edits: readonly { line: number; col: number; old: string; new: string }[]): string {
  const byLine = new Map<number, { line: number; col: number; old: string; new: string }[]>();
  for (const edit of edits) {
    const group = byLine.get(edit.line);
    if (group) group.push(edit);
    else byLine.set(edit.line, [edit]);
  }
  for (const [lineNumber, group] of byLine) {
    const index = lineNumber - 1;
    const original = lines[index];
    if (original === undefined) throw new LayoutError(`internal error: edit on missing line ${lineNumber}`);
    let chars = [...original];
    group.sort((a, b) => b.col - a.col);
    for (const edit of group) {
      const start = edit.col - 1;
      const actual = chars.slice(start, start + [...edit.old].length).join("");
      if (actual !== edit.old) {
        throw new LayoutError(`internal error: line ${lineNumber} is ${JSON.stringify(actual)}, expected ${JSON.stringify(edit.old)}`);
      }
      chars = [...chars.slice(0, start), ...[...edit.new], ...chars.slice(start + [...edit.old].length)];
    }
    lines[index] = chars.join("");
  }
  return lines.join("\n");
}

/** One projected point as the view's own tuple cell: `[10.0,20.0]` (spec/teda.md §4.3, ADR-0065). */
function point(x_nm: number, y_nm: number): string {
  return `[${coord(x_nm)},${coord(y_nm)}]`;
}

/** A coordinate in the view's own notation: millimetres with at least one decimal. */
function coord(nm: number): string {
  const text = (nm / 1_000_000).toFixed(3).replace(/0+$/, "");
  return text.endsWith(".") ? `${text}0` : text;
}

/** Whether two point lists are the same list of points. */
function samePoints(
  before: readonly { x_nm: number; y_nm: number }[] | undefined,
  after: readonly { x_nm: number; y_nm: number }[] | undefined,
): boolean {
  const a = before ?? [];
  const b = after ?? [];
  return a.length === b.length && a.every((point, index) => point.x_nm === b[index]!.x_nm && point.y_nm === b[index]!.y_nm);
}

function sameWire(
  before: NonNullable<SchematicView["wire"]>[number] | undefined,
  after: NonNullable<SchematicView["wire"]>[number],
): boolean {
  if (before === undefined || before.net !== after.net) return false;
  if (before.from_pin !== after.from_pin || before.to_pin !== after.to_pin) return false;
  return samePoints(before.points, after.points);
}

/**
 * Write a file through a temporary name, so a crash cannot leave a half-written page.
 *
 * The temporary name is an implementation detail, not a draft: it is gone the moment the rename
 * lands, and the reader never sees a page that is not yet applied. The rename is what makes the
 * write atomic — a reader sees either the old page or the new one, never a half of each.
 *
 * The previous bytes are kept under `dist/backups/`, so a page that was applied by mistake can be
 * put back. The backup is a derived artifact: it is gitignored, it is not part of the project's
 * identity, and nothing reads it but the person who undoes their own change.
 */
function writeFile(root: string, file: string, text: string): void {
  const path = join(root, file);
  mkdirSync(dirname(path), { recursive: true });
  keepBackup(root, path);
  const temp = join(dirname(path), `.${basename(path)}.texteda-${process.pid}.tmp`);
  try {
    writeFileSync(temp, text);
    renameSync(temp, path);
  } catch (error) {
    try {
      unlinkSync(temp);
    } catch {
      // The temporary file may already be gone; the original is untouched either way.
    }
    throw error;
  }
}

/**
 * Keep the bytes a write is about to replace, under `dist/backups/`.
 *
 * The backup mirrors the file's own path under `dist/backups/`, so a page keeps its place in the
 * tree rather than piling into one directory. A file that does not exist yet has nothing to keep.
 * The write of the backup is itself atomic, so a crash during it cannot leave a torn backup that
 * would be restored over a good file.
 */
function keepBackup(root: string, path: string): void {
  if (!existsSync(path)) return;
  const fromRoot = relative(root, path);
  const backup = join(root, "dist", "backups", fromRoot);
  mkdirSync(dirname(backup), { recursive: true });
  const temp = join(dirname(backup), `.${basename(backup)}.texteda-${process.pid}.tmp`);
  try {
    copyFileSync(path, temp);
    renameSync(temp, backup);
  } catch (error) {
    try {
      unlinkSync(temp);
    } catch {
      // The temporary backup may already be gone; the page itself is untouched either way.
    }
    throw error;
  }
}
