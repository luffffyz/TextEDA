// Copper coverage: does the drawing implement the `connect` declarations? (ADR-0020)
//
// The declaration is the truth (invariants 2 and 4): `connect` says "there is continuous copper
// between these two pads", and this check asks whether a chain of copper in the drawing reaches
// both. It never produces connectivity and never repairs it — a disagreement is reported with the
// declaration named as the thing that stands.
//
// Soundness note. Every geometric test here is written so that "no chain found" implies "no
// copper", never the other way round:
//   - a pad is modelled as the **circumscribed circle** of its pad rect (rotation-invariant and
//     larger than the copper), so a trace that grazes a pad corner is not missed;
//   - a trace is a centre line **expanded by half its width**;
//   - zones are the polygons they declare.
// The price is that the check can stay silent about a genuine hairline gap; the alternative
// (inscribed shapes) would report copper that is there, and a diagnostic that cries wolf is worse
// than one that waits for a bigger gap.
//
// Tolerance: 1 nm (ADR-0020 D3) — coordinates are nm integers, rotations are evaluated in
// floating point, and 1 nm is three orders of magnitude below any manufacturing resolution.
import type { Diagnostic } from "@texteda/ir/diagnostics";
import type { Pcb } from "@texteda/ir/pcb";
import type { Schematic } from "@texteda/ir/schematic";

/** One pad of a placed instance, in the footprint's own coordinates. */
export interface PadGeometry {
  /** Pin number (the key `connect` uses). */
  number: string;
  /** Pad centre in footprint space. */
  x_nm: number;
  y_nm: number;
  /** Circumscribed radius of the pad (half the diagonal of its rect): ≥ the copper, never less. */
  radius_nm: number;
  /** Layers the footprint lists; mask and paste layers are not copper and are ignored. */
  layers: string[];
}

/** The pads of one placed instance. */
export interface InstancePads {
  instance_id: string;
  pads: PadGeometry[];
}

export interface CopperFacts {
  /** Path of the pcb description, for locating. */
  file: string;
  schematic: Schematic;
  pcb: Pcb;
  /** Pad geometry per placed instance; an instance with no entry cannot be judged and is skipped. */
  pads: InstancePads[];
}

/** The coverage graph of one net. */
export interface CopperGraph {
  /** Is there a chain of this net's copper that touches both pads? */
  connected(a: string, b: string): boolean;
  /** Does any copper of this net touch this pad? */
  touches(ref: string): boolean;
}

const TOLERANCE_NM = 1;

interface Point {
  x: number;
  y: number;
}

type Primitive =
  | { kind: "pad"; ref: string; layers: string[]; center: Point; radius_nm: number }
  | { kind: "trace"; layer: string; points: Point[]; halfWidth_nm: number }
  | { kind: "via"; layers: string[]; center: Point; radius_nm: number }
  | { kind: "zone"; layer: string; polygon: Point[] };

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Distance from a point to a segment. */
function pointSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return distance(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Distance from a point to a polyline (minimum over its segments). */
function pointPolyline(p: Point, points: Point[]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < points.length; i += 1) {
    best = Math.min(best, pointSegment(p, points[i]!, points[i + 1]!));
  }
  return best;
}

function orientation(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

/** Distance between two segments (0 when they cross). */
function segmentSegment(a1: Point, a2: Point, b1: Point, b2: Point): number {
  const d1 = orientation(a1, a2, b1);
  const d2 = orientation(a1, a2, b2);
  const d3 = orientation(b1, b2, a1);
  const d4 = orientation(b1, b2, a2);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
  return Math.min(
    pointSegment(b1, a1, a2),
    pointSegment(b2, a1, a2),
    pointSegment(a1, b1, b2),
    pointSegment(a2, b1, b2),
  );
}

/** Distance between two polylines. */
function polylinePolyline(a: Point[], b: Point[]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < a.length; i += 1) {
    for (let j = 0; j + 1 < b.length; j += 1) {
      best = Math.min(best, segmentSegment(a[i]!, a[i + 1]!, b[j]!, b[j + 1]!));
      if (best === 0) return 0;
    }
  }
  return best;
}

function ring(polygon: Point[]): Point[] {
  return polygon.length === 0 ? polygon : [...polygon, polygon[0]!];
}

/** Ray casting; a point on the boundary counts as inside. */
function pointInPolygon(p: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    if (pointSegment(p, a, b) <= TOLERANCE_NM) return true;
    if (a.y > p.y !== b.y > p.y) {
      const x = ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
      if (p.x < x) inside = !inside;
    }
  }
  return inside;
}

/** Distance from a point to a filled polygon (0 inside). */
function pointPolygon(p: Point, polygon: Point[]): number {
  if (pointInPolygon(p, polygon)) return 0;
  return pointPolyline(p, ring(polygon));
}

/** Distance between a polyline and a filled polygon (0 when they cross or overlap). */
function polylinePolygon(points: Point[], polygon: Point[]): number {
  let best = Infinity;
  for (const p of points) best = Math.min(best, pointPolygon(p, polygon));
  if (best === 0) return 0;
  for (const p of polygon) best = Math.min(best, pointPolyline(p, points));
  if (best === 0) return 0;
  return Math.min(best, polylinePolyline(points, ring(polygon)));
}

/** Rotate a footprint-space point into board space; a bottom-side part is mirrored in X. */
function toBoard(
  pad: PadGeometry,
  place: { x_nm: number; y_nm: number; rot_mdeg: number; side: string },
): Point {
  const mirrored = place.side === "bottom" ? -pad.x_nm : pad.x_nm;
  const radians = (place.rot_mdeg / 1000) * (Math.PI / 180);
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: place.x_nm + mirrored * cos - pad.y_nm * sin,
    y: place.y_nm + mirrored * sin + pad.y_nm * cos,
  };
}

function isCopper(layer: string): boolean {
  return layer === "*.Cu" || layer.endsWith(".Cu");
}

/** Copper layers of the stackup, in stack order. */
function copperLayers(pcb: Pcb): string[] {
  return pcb.stackup.filter((layer) => layer.type === "copper").map((layer) => layer.layer);
}

/** Layers spanned by a via: the declared span, or every copper layer when none is declared. */
function viaLayers(pcb: Pcb, via: { from_layer?: string; to_layer?: string }): string[] {
  const copper = copperLayers(pcb);
  if (via.from_layer === undefined || via.to_layer === undefined) return copper;
  const from = copper.indexOf(via.from_layer);
  const to = copper.indexOf(via.to_layer);
  if (from === -1 || to === -1) return [via.from_layer, via.to_layer];
  const [lo, hi] = from <= to ? [from, to] : [to, from];
  return copper.slice(lo, hi + 1);
}

/** Disjoint-set over primitive indices. */
class Union {
  private readonly parent: number[];

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_unused, index) => index);
  }

  find(index: number): number {
    let root = index;
    while (this.parent[root] !== root) root = this.parent[root]!;
    let walk = index;
    while (this.parent[walk] !== root) {
      const next = this.parent[walk]!;
      this.parent[walk] = root;
      walk = next;
    }
    return root;
  }

  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[ra] = rb;
  }
}

/** Do two primitives share copper? See the soundness note at the top of the file. */
function touch(a: Primitive, b: Primitive): boolean {
  if (a.kind === "trace" && b.kind === "trace") {
    return (
      a.layer === b.layer &&
      polylinePolyline(a.points, b.points) <= a.halfWidth_nm + b.halfWidth_nm + TOLERANCE_NM
    );
  }
  if (a.kind === "zone" && b.kind === "zone") {
    return a.layer === b.layer && polylinePolygon(a.polygon, b.polygon) <= TOLERANCE_NM;
  }

  // Everything else is "a round thing (pad or via) against something".
  const core = a.kind === "pad" || a.kind === "via" ? a : b.kind === "pad" || b.kind === "via" ? b : undefined;
  if (core === undefined) return false;
  const other = core === a ? b : a;

  if (other.kind === "trace") {
    if (!core.layers.includes(other.layer)) return false;
    return pointPolyline(core.center, other.points) <= core.radius_nm + other.halfWidth_nm + TOLERANCE_NM;
  }
  if (other.kind === "zone") {
    if (!core.layers.includes(other.layer)) return false;
    return pointPolygon(core.center, other.polygon) <= core.radius_nm + TOLERANCE_NM;
  }
  if (other.kind === "pad" || other.kind === "via") {
    const shared = core.layers.some((layer) => other.layers.includes(layer));
    if (!shared) return false;
    return distance(core.center, other.center) <= core.radius_nm + other.radius_nm + TOLERANCE_NM;
  }
  return false;
}

/**
 * Report every `connect` pair that no chain of copper reaches (ADR-0020 D1).
 *
 * One diagnostic per declared pair, at `warning` severity (D5): a layout is a work in progress,
 * and a checker that fails mid-layout is a checker people turn off.
 */
export function checkCopperCoverage(facts: CopperFacts): Diagnostic[] {
  const { pcb } = facts;
  const diagnostics: Diagnostic[] = [];
  const pairs = pcb.connect ?? [];
  if (pairs.length === 0) return diagnostics;

  // The net of a pad comes from sch: `connect` declares geometry, not nets (spec/pcb.md §5.2).
  const pinNet = new Map<string, string>();
  for (const net of facts.schematic.nets) {
    for (const member of net.members) pinNet.set(member, net.id);
  }

  const placeOf = new Map(pcb.place.map((item) => [item.instance_id, item]));
  const pads = new Map<string, { layers: string[]; center: Point; radius_nm: number }>();
  for (const instance of facts.pads) {
    const place = placeOf.get(instance.instance_id);
    if (!place) continue;
    for (const pad of instance.pads) {
      const layers = pad.layers.filter(isCopper).flatMap((layer) => (layer === "*.Cu" ? copperLayers(pcb) : [layer]));
      pads.set(`${instance.instance_id}.${pad.number}`, {
        layers,
        center: toBoard(pad, place),
        radius_nm: pad.radius_nm,
      });
    }
  }

  const at = { file: facts.file, line: 1, col: 1 };
  const graphs = new Map<string, CopperGraph>();

  for (const pair of pairs) {
    const net = pinNet.get(pair.a);
    const other = pinNet.get(pair.b);
    // Pads outside sch (or a pair spanning a net_tie) are other rules' business.
    if (net === undefined || net !== other) continue;
    const a = pads.get(pair.a);
    const b = pads.get(pair.b);
    // No geometry means the footprint is not in the library: not this check's question.
    if (!a || !b) continue;

    let graph = graphs.get(net);
    if (graph === undefined) {
      graph = copperGraph(pcb, net, pads);
      graphs.set(net, graph);
    }
    if (graph.connected(pair.a, pair.b)) continue;

    diagnostics.push({
      code: "bind.connect-unbacked",
      severity: "warning",
      message: `connect declares copper between ${pair.a} and ${pair.b}, but no chain of ${net} copper reaches both`,
      location: at,
      expected: `a chain of ${net} copper touching both pads`,
      actual:
        graph.touches(pair.a) || graph.touches(pair.b)
          ? "copper touches one pad only"
          : "no copper of this net touches either pad",
      hint: "draw the copper the declaration implies, or declare the pads that the copper actually joins",
      data: { net, a: pair.a, b: pair.b },
    });
  }

  return diagnostics;
}

/**
 * Build the coverage graph of one net: pads and drawn primitives, joined by "same copper".
 * Layers matter: copper joins across layers only through a via (ADR-0020 D2).
 */
function copperGraph(
  pcb: Pcb,
  net: string,
  pads: Map<string, { layers: string[]; center: Point; radius_nm: number }>,
): CopperGraph {
  const named = new Set<string>();
  for (const pair of pcb.connect ?? []) {
    named.add(pair.a);
    named.add(pair.b);
  }

  const primitives: Primitive[] = [];
  for (const [ref, pad] of pads) {
    if (!named.has(ref)) continue;
    primitives.push({ kind: "pad", ref, layers: pad.layers, center: pad.center, radius_nm: pad.radius_nm });
  }
  for (const trace of pcb.trace ?? []) {
    if (trace.net !== net) continue;
    primitives.push({
      kind: "trace",
      layer: trace.layer,
      points: trace.points.map((point) => ({ x: point.x_nm, y: point.y_nm })),
      halfWidth_nm: trace.width_nm / 2,
    });
  }
  for (const via of pcb.via ?? []) {
    if (via.net !== net) continue;
    primitives.push({
      kind: "via",
      layers: viaLayers(pcb, via),
      center: { x: via.x_nm, y: via.y_nm },
      radius_nm: via.size_nm / 2,
    });
  }
  for (const zone of pcb.zone ?? []) {
    if (zone.net !== net) continue;
    primitives.push({
      kind: "zone",
      layer: zone.layer,
      polygon: zone.points.map((point) => ({ x: point.x_nm, y: point.y_nm })),
    });
  }

  const union = new Union(primitives.length);
  const padIndex = new Map<string, number>();
  primitives.forEach((primitive, index) => {
    if (primitive.kind === "pad") padIndex.set(primitive.ref, index);
  });

  const touched = new Set<number>();
  for (let i = 0; i < primitives.length; i += 1) {
    for (let j = i + 1; j < primitives.length; j += 1) {
      if (!touch(primitives[i]!, primitives[j]!)) continue;
      union.union(i, j);
      if (primitives[i]!.kind === "pad") touched.add(i);
      if (primitives[j]!.kind === "pad") touched.add(j);
    }
  }

  return {
    connected: (a, b) => {
      const ia = padIndex.get(a);
      const ib = padIndex.get(b);
      if (ia === undefined || ib === undefined) return false;
      return union.find(ia) === union.find(ib);
    },
    touches: (ref) => {
      const index = padIndex.get(ref);
      return index === undefined ? false : touched.has(index);
    },
  };
}
