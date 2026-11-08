// Board ↔ print page cross checks (spec/schematic-view.md §9).
//
// A view is a drawing of the board's logical model, not a second description of it: it names the
// board's ids and defines none (ADR-0035, ADR-0012 decision 4). So everything it says about the
// board has to be answerable by the board, and the drawing that says nothing about a net is a
// finding of its own — a board where a two-member net is drawn nowhere is a board whose drawing
// does not show a connection that exists.
//
// Scope is the table in §9.1 / §9.2: identity and graph rules live here; renderer-owned pin
// coordinates reject dangling endpoints and junction crossings that should be explicit endpoints.
//
// Pure: the board's IR and the pages' IR in, diagnostics out.
import type { Diagnostic, DiagnosticLocation } from "@texteda/ir/diagnostics";
import type { Schematic } from "@texteda/ir/schematic";
import type { SchematicView } from "@texteda/ir/schematic-view";
import { wirePath, ON_LINE_NM, type Point } from "./geometry.ts";
import type { ReadabilityGeometry } from "./facts.ts";

/** One print page of the board. */
export interface ViewPage {
  /** Path of the view file, relative to the project root. */
  readonly file: string;
  readonly view: SchematicView;
  /** Renderer-owned symbol pin coordinates for this page. */
  readonly geometry?: ReadabilityGeometry;
  /**
   * A record's IR path (`/place/3`) → where it was written. The view IR carries no line numbers
   * (ADR-0004 D1), so a finding that names a row gets the row's span from the parse.
   */
  readonly locate?: (irPath: string) => DiagnosticLocation | undefined;
}

/** A board net's declaration, for the view findings that contradict it (ADR-0004 D5). */
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

function pointOnSegment(point: Point, start: Point, end: Point): boolean {
  const dx = end.x_nm - start.x_nm;
  const dy = end.y_nm - start.y_nm;
  const cross = (point.x_nm - start.x_nm) * dy - (point.y_nm - start.y_nm) * dx;
  if (Math.abs(cross) > ON_LINE_NM * Math.max(Math.abs(dx), Math.abs(dy), 1)) return false;
  return (
    point.x_nm >= Math.min(start.x_nm, end.x_nm) - ON_LINE_NM &&
    point.x_nm <= Math.max(start.x_nm, end.x_nm) + ON_LINE_NM &&
    point.y_nm >= Math.min(start.y_nm, end.y_nm) - ON_LINE_NM &&
    point.y_nm <= Math.max(start.y_nm, end.y_nm) + ON_LINE_NM
  );
}

/**
 * Cross-check every print page of one board, then the board's drawing coverage.
 *
 * IDs are the board's: an instance, a net or a port that the board does not have is an error —
 * the drawing would be showing something the logic does not say. Coverage (D: a net drawn on no
 * page) is a warning, and only once the board has at least one page: a board with logic and no
 * drawing is a legal state, not a defect (ADR-0035).
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

  /** The board's row for a net: the definition the drawing is checked against (ADR-0004 D5). */
  const netRow = (netId: string): { related?: DiagnosticLocation[] } => {
    const row = facts.locateNet?.(netId);
    return row === undefined ? {} : { related: [row] };
  };

  for (const { file, view, locate, geometry } of pages) {
    /** Where a record of this page was written; the file alone when no span came with the parse. */
    const at = (irPath: string): DiagnosticLocation => locate?.(irPath) ?? { file, line: 1, col: 1 };
    const junctions = new Map((view.junction ?? []).map((junction) => [junction.id, junction]));
    const endpointPoints = new Map<string, Point>([
      ...(view.port ?? []).map((port) => [port.id, { x_nm: port.x_nm, y_nm: port.y_nm }] as const),
      ...(view.junction ?? []).map((junction) => [junction.id, { x_nm: junction.x_nm, y_nm: junction.y_nm }] as const),
    ]);
    const symbols = new Map((geometry?.symbols ?? []).map((symbol) => [symbol.instance_id, symbol]));
    const junctionNets = new Map<string, string>();
    const junctionDegrees = new Map<string, number>();
    const portNets = new Map((schematic.ports ?? []).map((port) => [port.id, port.net]));
    for (const [index, junction] of (view.junction ?? []).entries()) {
      if (!ports.has(junction.id)) continue;
      diagnostics.push({
        code: "value.duplicate-id",
        severity: "error",
        message: `junction ${junction.id} conflicts with a board port id`,
        hint: "give each page junction an id distinct from every board port",
        location: at(`/junction/${index}`),
        data: { page: view.page, id: junction.id },
      });
    }
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

    const placedInstances = new Set(view.place.map((place) => place.instance_id));
    const drawingGraphs = new Map<string, Map<string, Set<string>>>();
    for (const wire of view.wire ?? []) {
      for (const endpoint of [wire.from_pin, wire.to_pin]) {
        if (junctions.has(endpoint) && !junctionNets.has(endpoint)) junctionNets.set(endpoint, wire.net);
      }
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
      let graph = drawingGraphs.get(net.id);
      if (graph === undefined) {
        graph = new Map();
        drawingGraphs.set(net.id, graph);
      }
      const from = wire.from_pin;
      const to = wire.to_pin;
      const adjacent = graph.get(from) ?? new Set<string>();
      adjacent.add(to);
      graph.set(from, adjacent);
      const reverse = graph.get(to) ?? new Set<string>();
      reverse.add(from);
      graph.set(to, reverse);
      if (geometry !== undefined) {
        const path = wirePath(wire, symbols, endpointPoints);
        if (path === null) {
          for (const endpoint of [wire.from_pin, wire.to_pin]) {
            const dot = endpoint.lastIndexOf(".");
            const resolved = dot < 0 ? endpointPoints.has(endpoint) : symbols.get(endpoint.slice(0, dot))?.pins.has(endpoint.slice(dot + 1)) === true;
            if (resolved) continue;
            diagnostics.push({
              code: "view.wire-dangling-endpoint",
              severity: "error",
              message: `wire endpoint ${endpoint} has no rendered connection point on page ${view.page}`,
              hint: "place the referenced pin or declare and draw the page endpoint",
              location: at(`/wire/${index}`),
              data: { page: view.page, net: net.id, endpoint },
            });
          }
        } else {
          for (const [junctionId, junction] of junctions) {
            if (junctionNets.get(junctionId) !== net.id) continue;
            if (wire.from_pin === junctionId || wire.to_pin === junctionId) continue;
            const point = { x_nm: junction.x_nm, y_nm: junction.y_nm };
            if (!path.some((_, pathIndex) => pathIndex + 1 < path.length && pointOnSegment(point, path[pathIndex]!, path[pathIndex + 1]!))) continue;
            diagnostics.push({
              code: "view.wire-gap",
              severity: "error",
              message: `wire on ${net.id} passes through junction ${junctionId} without using it as an endpoint`,
              hint: "split the wire at the junction and use its declared id as the shared endpoint",
              location: at(`/wire/${index}`),
              data: { page: view.page, net: net.id, junction: junctionId, wire: index },
            });
          }
        }
      }
      const members = new Set(net.members);
      for (const pin of [wire.from_pin, wire.to_pin]) {
        if (!pin.includes(".")) {
          if (junctions.has(pin)) {
            const owner = junctionNets.get(pin);
            if (owner !== undefined && owner !== net.id) {
              diagnostics.push({
                code: "view.endpoint-wrong-net",
                severity: "error",
                message: `junction ${pin} is used by both ${owner} and ${net.id}`,
                hint: "a drawing junction can join wires from only one net",
                location: at(`/wire/${index}`),
                data: { page: view.page, junction: pin, net: net.id, other_net: owner },
              });
            } else {
              junctionNets.set(pin, net.id);
            }
            junctionDegrees.set(pin, (junctionDegrees.get(pin) ?? 0) + 1);
          } else if (!ports.has(pin)) {
            diagnostics.push({
              code: "ref.unknown-junction",
              severity: "error",
              message: `wire endpoint ${pin} is neither a declared junction nor a board port`,
              hint: "declare a junction on this page or use a declared page port",
              location: at(`/wire/${index}`),
              data: { page: view.page, endpoint: pin },
            });
          } else if (portNets.get(pin) !== net.id) {
            diagnostics.push({
              code: "view.endpoint-wrong-net",
              severity: "error",
              message: `port ${pin} belongs to ${portNets.get(pin) ?? "no known net"}, not ${net.id}`,
              hint: "connect a page port only to a wire on its declared board net",
              location: at(`/wire/${index}`),
              data: { page: view.page, port: pin, net: net.id },
            });
          }
          continue;
        }
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
    for (const [index, junction] of (view.junction ?? []).entries()) {
      const degree = junctionDegrees.get(junction.id) ?? 0;
      if (degree < 2) {
        diagnostics.push({
          code: "view.junction-isolated",
          severity: "error",
          message: `junction ${junction.id} has only ${degree} wire arm${degree === 1 ? "" : "s"}`,
          hint: "connect the junction to at least two wire rows, or remove it",
          location: at(`/junction/${index}`),
          data: { page: view.page, junction: junction.id, degree },
        });
      } else if (degree > 4) {
        diagnostics.push({
          code: "view.junction-invalid-degree",
          severity: "error",
          message: `junction ${junction.id} has ${degree} wire arms; the maximum is four`,
          hint: "split the drawing into simpler junctions",
          location: at(`/junction/${index}`),
          data: { page: view.page, junction: junction.id, degree },
        });
      }
    }
    for (const [netId, graph] of drawingGraphs) {
      const net = nets.get(netId)!;
      const missingMembers = net.members.filter((member) => {
        const instance = member.slice(0, member.lastIndexOf("."));
        return placedInstances.has(instance) && !graph.has(member);
      });
      const unseen = new Set(graph.keys());
      let components = 0;
      while (unseen.size > 0) {
        components += 1;
        const pending = [unseen.values().next().value as string];
        while (pending.length > 0) {
          const endpoint = pending.pop()!;
          if (!unseen.delete(endpoint)) continue;
          for (const adjacent of graph.get(endpoint) ?? []) if (unseen.has(adjacent)) pending.push(adjacent);
        }
      }
      if (components > 1 || missingMembers.length > 0) {
        diagnostics.push({
          code: "view.wire-disconnected",
          severity: "error",
          message: `print page ${view.page} draws net ${netId} as ${components} wire components${missingMembers.length > 0 ? ` and omits placed members ${missingMembers.join(", ")}` : ""}`,
          hint: "connect the wire components and include every member placed on this page",
          location: at("/wire"),
          data: { page: view.page, net: netId, components, missing_members: missingMembers.join(",") },
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
  // (the policy of ADR-0019 D4, applied to the drawing). The names come along so a tool can act.
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
