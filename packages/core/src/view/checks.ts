// Board ↔ print page cross checks (spec/schematic-view.md §9).
//
// A view is a drawing of the board's logical model, not a second description of it: it names the
// board's ids and defines none (ADR-0134, ADR-0111 decision 4). So everything it says about the
// board has to be answerable by the board, and the drawing that says nothing about a net is a
// finding of its own — a board where a two-member net is drawn nowhere is a board whose drawing
// does not show a connection that exists.
//
// Scope is the table in §9.1 / §9.2 and nothing else: readability (overlapping text, a wire crossing
// a symbol body) needs geometry the renderer owns and is a separate item.
//
// Pure: the board's IR and the pages' IR in, diagnostics out.
import type { Diagnostic, DiagnosticLocation } from "@texteda/ir/diagnostics";
import type { Schematic } from "@texteda/ir/schematic";
import type { SchematicView } from "@texteda/ir/schematic-view";

/** One print page of the board. */
export interface ViewPage {
  /** Path of the view file, relative to the project root. */
  readonly file: string;
  readonly view: SchematicView;
  /**
   * A record's IR path (`/place/3`) → where it was written. The view IR carries no line numbers
   * (ADR-0103 D1), so a finding that names a row gets the row's span from the parse.
   */
  readonly locate?: (irPath: string) => DiagnosticLocation | undefined;
}

/** A board net's declaration, for the view findings that contradict it (ADR-0103 D5). */
export type NetLocator = (netId: string) => DiagnosticLocation | undefined;

export interface ViewFacts {
  /** Path of the board's schematic file, for board-level findings. */
  readonly file: string;
  readonly schematic: Schematic;
  /** Every print page of the board; an empty list means "no drawing", which is a legal state. */
  readonly pages: readonly ViewPage[];
  /** A net id → the board row that declares it; the drawing is checked against that row. */
  readonly locateNet?: NetLocator;
}

/** The pin half of a `pin` reference (`U1.3` → `3`), the same shape the nets section uses. */
function pinOf(member: string): string {
  const dot = member.lastIndexOf(".");
  return dot === -1 ? member : member.slice(dot + 1);
}

/**
 * Cross-check every print page of one board, then the board's drawing coverage.
 *
 * IDs are the board's: an instance, a net or a port that the board does not have is an error —
 * the drawing would be showing something the logic does not say. Coverage (D: a net drawn on no
 * page) is a warning, and only once the board has at least one page: a board with logic and no
 * drawing is a legal state, not a defect (ADR-0134).
 */
export function checkViews(facts: ViewFacts): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const { schematic } = facts;

  const instances = new Set(schematic.instances.map((instance) => instance.id));
  const nets = new Map(schematic.nets.map((net) => [net.id, net]));
  const ports = new Set((schematic.ports ?? []).map((port) => port.id));

  const pages = [...facts.pages].sort((a, b) => (a.view.page < b.view.page ? -1 : a.view.page > b.view.page ? 1 : 0));
  /** Net ids that some page draws with a wire or a label. */
  const drawn = new Set<string>();

  /** The board's row for a net: the definition the drawing is checked against (ADR-0103 D5). */
  const netRow = (netId: string): { related?: DiagnosticLocation[] } => {
    const row = facts.locateNet?.(netId);
    return row === undefined ? {} : { related: [row] };
  };

  for (const { file, view, locate } of pages) {
    /** Where a record of this page was written; the file alone when no span came with the parse. */
    const at = (irPath: string): DiagnosticLocation => locate?.(irPath) ?? { file, line: 1, col: 1 };
    for (const [index, place] of view.place.entries()) {
      if (instances.has(place.instance_id)) continue;
      diagnostics.push({
        code: "ref.unknown-instance",
        severity: "error",
        message: `print page ${view.page} places ${place.instance_id}, which the board's instances do not contain`,
        hint: "the view names the board's ids: place an instance the board has, or add it to the board",
        location: at(`/place/${index}`),
        data: { page: view.page, instance: place.instance_id },
      });
    }

    for (const [index, wire] of (view.wire ?? []).entries()) {
      const net = nets.get(wire.net);
      if (!net) {
        diagnostics.push({
          code: "ref.unknown-net",
          severity: "error",
          message: `print page ${view.page} draws a wire on net ${wire.net}, which the board does not have`,
          hint: "the view names the board's nets: a wire cannot invent one",
          location: at(`/wire/${index}`),
          data: { page: view.page, net: wire.net },
        });
        continue;
      }
      drawn.add(net.id);
      const members = new Set(net.members);
      for (const pin of [wire.from_pin, wire.to_pin]) {
        if (members.has(pin)) continue;
        const instance = pin.slice(0, pin.lastIndexOf("."));
        const reason = instances.has(instance)
          ? `pin ${pinOf(pin)} is not a member of that net`
          : `${instance} is not an instance of this board`;
        diagnostics.push({
          code: "view.pin-net-mismatch",
          severity: "error",
          message: `print page ${view.page} draws ${pin} as an endpoint of net ${net.id}: ${reason}`,
          hint: "a wire connects two pins of the net it names; the net's members are decided in the board's nets section",
          location: at(`/wire/${index}`),
          data: { page: view.page, net: net.id, pin },
          ...netRow(net.id),
        });
      }
    }

    for (const [index, label] of (view.label ?? []).entries()) {
      if (!nets.has(label.net)) {
        diagnostics.push({
          code: "ref.unknown-net",
          severity: "error",
          message: `print page ${view.page} labels net ${label.net}, which the board does not have`,
          hint: "the view names the board's nets: a label cannot invent one",
          location: at(`/label/${index}`),
          data: { page: view.page, net: label.net },
        });
        continue;
      }
      drawn.add(label.net);
    }

    for (const [index, port] of (view.port ?? []).entries()) {
      if (ports.has(port.id)) continue;
      diagnostics.push({
        code: "ref.unknown-port",
        severity: "error",
        message: `print page ${view.page} shows port ${port.id}, which the board's ports section does not declare`,
        hint: "a port symbol draws an existing board port: declare the port on the board, or use the net's label",
        location: at(`/port/${index}`),
        data: { page: view.page, port: port.id },
      });
    }
  }

  // Coverage: a net with two or more members that no page draws is a connection the drawing does
  // not show. One finding per board, not per net — a drawing in progress is a normal state, and it
  // has to be *sayable* without turning thirty undrawn nets into thirty warnings
  // (the policy of ADR-0118 D4, applied to the drawing). The names come along so a tool can act.
  if (pages.length > 0) {
    const undrawn = [...nets.values()]
      .filter((net) => net.members.length >= 2 && !drawn.has(net.id))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    if (undrawn.length > 0) {
      const shown = undrawn.slice(0, 10).map((net) => net.id);
      const rest = undrawn.length - shown.length;
      diagnostics.push({
        code: "view.nets-not-drawn",
        severity: "warning",
        message: `${undrawn.length} of ${nets.size} nets are drawn on no print page: ${shown.join(", ")}${rest > 0 ? `, and ${rest} more` : ""}`,
        hint: "draw each as a wire between two of its pins, or put a label on its net: a connection that is on no page is not on the drawing",
        location: { file: facts.file, line: 1, col: 1 },
        // `data` is flat scalars (the diagnostic payload contract): the names are one string.
        data: { count: undrawn.length, nets: undrawn.map((net) => net.id).join(" "), pages: pages.length },
      });
    }
  }

  return diagnostics;
}
