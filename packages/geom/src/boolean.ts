// Boolean operations on simple polygons by vertical decomposition (ADR-0054).
//
// The kernel does not trace a single outline. It cuts the plane at every vertex x and every edge
// crossing, asks "which y intervals are inside?" at a sample x in each slab, and emits one
// trapezoid per maximal run of identical intervals. Between two events no edge crosses and no edge
// starts or ends, so an interval sampled inside a slab is the interval for that whole slab.
//
// Invariants this module promises:
// - exact grid input stays exact: a corner is only rounded after being evaluated at the true run
//   end, and rounding (not floor/ceil) makes the two neighbours of a shared edge land on the same
//   nanometre, so pieces neither overlap nor leave a false gap;
// - a cover, never a double count: the output pieces are mutually disjoint (touching only);
// - canonical output: vertex order, piece order, and the ring's starting vertex are all fixed, so
//   the same geometry always serializes to the same bytes (ADR-0054 D5);
// - degenerate input is a `GeometryError`, never a silently "good enough" shape.
//
// Cost control, in the order it matters for a copper fill:
// - one polygon is never decomposed: a single-operand union returns its polygons normalized, so a
//   rounded rect stays one ring instead of becoming a trapezoid per vertex x;
// - union first clusters polygons by bounding box, so two distant pours are never sampled together;
// - difference subtracts one cut at a time and skips pieces whose box cannot reach it, which is the
//   shape of "pour minus hundreds of pads, traces, and keepouts";
// - crossings come from an x-sweep, and each slab samples only the edges alive in that slab.
import { GeometryError, type Bounds, type Point, type Polygon, type Region } from "./types.ts";
import { comparePolygons, isConvex, normalize } from "./polygon.ts";

/** A polygon edge, as two integer endpoints. */
interface Edge {
  readonly a: Point;
  readonly b: Point;
}

/** A polygon of an operand, as the ids of its ring's edges in order. */
interface Shape {
  readonly edges: readonly number[];
}

/** A band of a slab: `[lo, hi]` at the sample x, bounded by the edges that supply each side. */
interface Interval {
  lo: number;
  hi: number;
  loEdge: number;
  hiEdge: number;
}

/** A band that kept the same bounding edges across several slabs, waiting for its right end. */
interface Run {
  readonly loEdge: number;
  readonly hiEdge: number;
  readonly x0: number;
}

const EPSILON = 1e-9;

function boundsOf(polygon: Polygon): Bounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of polygon) {
    if (point.x_nm < minX) minX = point.x_nm;
    if (point.y_nm < minY) minY = point.y_nm;
    if (point.x_nm > maxX) maxX = point.x_nm;
    if (point.y_nm > maxY) maxY = point.y_nm;
  }
  return { min_x_nm: minX, min_y_nm: minY, max_x_nm: maxX, max_y_nm: maxY };
}

/** Boxes that share at least a point; touching shapes can form one connected region. */
function boxesTouch(a: Bounds, b: Bounds): boolean {
  return a.min_x_nm <= b.max_x_nm && b.min_x_nm <= a.max_x_nm && a.min_y_nm <= b.max_y_nm && b.min_y_nm <= a.max_y_nm;
}

function minX(edge: Edge): number {
  return Math.min(edge.a.x_nm, edge.b.x_nm);
}

function maxX(edge: Edge): number {
  return Math.max(edge.a.x_nm, edge.b.x_nm);
}

function yAt(edge: Edge, x: number): number {
  const dx = edge.b.x_nm - edge.a.x_nm;
  if (dx === 0) return edge.a.y_nm;
  return edge.a.y_nm + ((edge.b.y_nm - edge.a.y_nm) * (x - edge.a.x_nm)) / dx;
}

/** The x of a proper segment crossing, or null when the segments are parallel or miss. */
function crossingX(a: Edge, b: Edge): number | null {
  if (maxX(a) < minX(b) || maxX(b) < minX(a)) return null;
  const rx = a.b.x_nm - a.a.x_nm;
  const ry = a.b.y_nm - a.a.y_nm;
  const sx = b.b.x_nm - b.a.x_nm;
  const sy = b.b.y_nm - b.a.y_nm;
  const denominator = rx * sy - ry * sx;
  if (denominator === 0) return null;
  const acx = b.a.x_nm - a.a.x_nm;
  const acy = b.a.y_nm - a.a.y_nm;
  const t = (acx * sy - acy * sx) / denominator;
  const u = (acx * ry - acy * rx) / denominator;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return a.a.x_nm + t * rx;
}

/**
 * Every x where the vertical order of an edge can change: vertices plus edge crossings.
 *
 * Crossings come from a left-to-right sweep, so an edge is only compared with the edges still alive
 * when it starts. Crossing x values are never rounded onto the grid: rounding an event would move a
 * slab boundary and change the area of every slanted edge in that slab.
 */
function eventXs(edges: readonly Edge[]): number[] {
  const xs = new Set<number>();
  for (const edge of edges) {
    xs.add(edge.a.x_nm);
    xs.add(edge.b.x_nm);
  }
  const order = edges.map((_, i) => i).sort((left, right) => minX(edges[left]!) - minX(edges[right]!) || left - right);
  const active: number[] = [];
  for (const index of order) {
    const start = minX(edges[index]!);
    for (let i = active.length - 1; i >= 0; i -= 1) {
      if (maxX(edges[active[i]!]!) <= start) active.splice(i, 1);
    }
    for (const other of active) {
      const x = crossingX(edges[index]!, edges[other]!);
      if (x !== null) xs.add(x);
    }
    active.push(index);
  }
  return [...xs].sort((left, right) => left - right);
}

/** Bands of one polygon at `sample`; a simple ring pairs its crossings in vertical order. */
function shapeIntervals(shape: Shape, edges: readonly Edge[], sample: number): Interval[] {
  const crossed: number[] = [];
  for (const id of shape.edges) {
    const edge = edges[id]!;
    if (sample <= minX(edge) || sample >= maxX(edge)) continue;
    crossed.push(id);
  }
  crossed.sort((left, right) => yAt(edges[left]!, sample) - yAt(edges[right]!, sample) || left - right);
  if (crossed.length % 2 !== 0) throw new GeometryError("vertical line meets an odd number of polygon edges");
  const out: Interval[] = [];
  for (let i = 0; i + 1 < crossed.length; i += 2) {
    const loEdge = crossed[i]!;
    const hiEdge = crossed[i + 1]!;
    const lo = yAt(edges[loEdge]!, sample);
    const hi = yAt(edges[hiEdge]!, sample);
    if (hi - lo > EPSILON) out.push({ lo, hi, loEdge, hiEdge });
  }
  return out;
}

/** Union of bands: overlapping or touching intervals become one. Ties break deterministically. */
function mergeIntervals(intervals: readonly Interval[]): Interval[] {
  const sorted = [...intervals].sort(
    (a, b) => a.lo - b.lo || a.hi - b.hi || a.loEdge - b.loEdge || a.hiEdge - b.hiEdge,
  );
  const out: Interval[] = [];
  for (const interval of sorted) {
    const current = out[out.length - 1];
    if (current === undefined || interval.lo > current.hi + EPSILON) {
      out.push({ ...interval });
      continue;
    }
    if (interval.hi > current.hi || (interval.hi === current.hi && interval.hiEdge < current.hiEdge)) {
      current.hi = interval.hi;
      current.hiEdge = interval.hiEdge;
    }
  }
  return out;
}

function intersectIntervals(left: readonly Interval[], right: readonly Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const a of left) {
    for (const b of right) {
      const lo = Math.max(a.lo, b.lo);
      const hi = Math.min(a.hi, b.hi);
      if (hi - lo <= EPSILON) continue;
      out.push({
        lo,
        hi,
        loEdge: a.lo >= b.lo ? a.loEdge : b.loEdge,
        hiEdge: a.hi <= b.hi ? a.hiEdge : b.hiEdge,
      });
    }
  }
  return mergeIntervals(out);
}

/** `base - cut`: each piece keeps its own boundaries except where the cut supplies a new one. */
function subtractIntervals(base: readonly Interval[], cut: readonly Interval[]): Interval[] {
  let pieces = base.map((interval) => ({ ...interval }));
  for (const blocker of cut) {
    if (pieces.length === 0) break;
    const next: Interval[] = [];
    for (const piece of pieces) {
      if (blocker.hi <= piece.lo + EPSILON || blocker.lo >= piece.hi - EPSILON) {
        next.push(piece);
        continue;
      }
      if (blocker.lo > piece.lo + EPSILON) {
        next.push({ lo: piece.lo, hi: blocker.lo, loEdge: piece.loEdge, hiEdge: blocker.loEdge });
      }
      if (blocker.hi < piece.hi - EPSILON) {
        next.push({ lo: blocker.hi, hi: piece.hi, loEdge: blocker.hiEdge, hiEdge: piece.hiEdge });
      }
    }
    pieces = next;
  }
  return pieces.filter((piece) => piece.hi - piece.lo > EPSILON);
}

/**
 * Turn one run into a trapezoid.
 *
 * Corners are evaluated at the true run ends and only then rounded. Evaluating at the rounded x
 * would read the bounding edges outside the run, where they have already swapped order, and the
 * trapezoid would come out inside out.
 *
 * Rounding (not floor/ceil) keeps neighbours consistent: the right end of one run and the left end
 * of the next evaluate the same edge at the same x, so they land on the same nanometre and share an
 * edge exactly. A band that rounds to zero height is dropped: it is below what the grid can express,
 * and it is not copper.
 */
function runPolygon(edges: readonly Edge[], x0: number, x1: number, run: Run): Polygon | null {
  const left = Math.round(x0);
  const right = Math.round(x1);
  if (left === right) return null;
  const loFrom = edges[run.loEdge]!;
  const hiFrom = edges[run.hiEdge]!;
  const points: Point[] = [
    { x_nm: left, y_nm: Math.round(yAt(loFrom, x0)) },
    { x_nm: right, y_nm: Math.round(yAt(loFrom, x1)) },
    { x_nm: right, y_nm: Math.round(yAt(hiFrom, x1)) },
    { x_nm: left, y_nm: Math.round(yAt(hiFrom, x0)) },
  ];
  try {
    return normalize(points);
  } catch (error) {
    if (!(error instanceof GeometryError)) throw error;
    return null;
  }
}

/** Normalized, de-duplicated, canonically ordered region. Never samples a slab. */
function canonical(region: Region): Region {
  const polygons = region.map((polygon) => normalize(polygon)).sort(comparePolygons);
  const out: Polygon[] = [];
  for (const polygon of polygons) {
    const previous = out[out.length - 1];
    if (previous !== undefined && comparePolygons(previous, polygon) === 0) continue;
    out.push(polygon);
  }
  return out;
}

type Mode = "union" | "intersection" | "difference";

/** Vertical decomposition of operand regions whose boxes all interact; the only slab sampler. */
function decompose(regions: readonly Region[], mode: Mode): Region {
  const edges: Edge[] = [];
  const perRegion: Shape[][] = [];
  for (const region of regions) {
    const shapes: Shape[] = [];
    for (const polygon of region) {
      const ids: number[] = [];
      for (let i = 0; i < polygon.length; i += 1) {
        ids.push(edges.length);
        edges.push({ a: polygon[i]!, b: polygon[(i + 1) % polygon.length]! });
      }
      shapes.push({ edges: ids });
    }
    perRegion.push(shapes);
  }
  const xs = eventXs(edges);
  if (xs.length < 2) return [];
  const last = xs[xs.length - 1]!;

  const polygons: Polygon[] = [];
  let runs = new Map<string, Run>();
  for (let i = 0; i + 1 < xs.length; i += 1) {
    const x0 = xs[i]!;
    const x1 = xs[i + 1]!;
    if (x1 <= x0) continue;
    const sample = (x0 + x1) / 2;
    const layers = perRegion.map((shapes) => {
      const intervals: Interval[] = [];
      for (const shape of shapes) intervals.push(...shapeIntervals(shape, edges, sample));
      return mergeIntervals(intervals);
    });
    let result: Interval[] = layers[0] ?? [];
    for (let j = 1; j < layers.length; j += 1) {
      const next = layers[j]!;
      if (mode === "union") result = mergeIntervals([...result, ...next]);
      else if (mode === "intersection") result = intersectIntervals(result, next);
      else result = subtractIntervals(result, next);
    }
    const nextRuns = new Map<string, Run>();
    for (const interval of result) {
      const key = `${interval.loEdge}:${interval.hiEdge}`;
      nextRuns.set(key, runs.get(key) ?? { loEdge: interval.loEdge, hiEdge: interval.hiEdge, x0 });
    }
    for (const [key, run] of runs) {
      if (nextRuns.has(key)) continue;
      const polygon = runPolygon(edges, run.x0, x0, run);
      if (polygon !== null) polygons.push(polygon);
    }
    runs = nextRuns;
  }
  for (const run of runs.values()) {
    const polygon = runPolygon(edges, run.x0, last, run);
    if (polygon !== null) polygons.push(polygon);
  }
  return canonical(polygons);
}

/**
 * Group polygons whose boxes can interact, so a decomposition only ever sees one neighbourhood.
 *
 * Sampling two distant pours together would shred both into a trapezoid per vertex x of either,
 * which is slower and a worse Gerber output. Touching boxes belong together because their union may
 * be one connected region.
 */
function clusters(region: Region): Polygon[][] {
  const items = region
    .map((polygon) => ({ polygon, box: boundsOf(polygon) }))
    .sort((left, right) => left.box.min_x_nm - right.box.min_x_nm || left.box.min_y_nm - right.box.min_y_nm);
  const groups: { box: Bounds; polygons: Polygon[] }[] = [];
  for (const item of items) {
    const hits: number[] = [];
    for (let i = 0; i < groups.length; i += 1) {
      const group = groups[i]!;
      // Groups are kept disjoint and sorted by min_x, so once a group starts to the right, stop.
      if (group.box.min_x_nm > item.box.max_x_nm) break;
      if (boxesTouch(group.box, item.box)) hits.push(i);
    }
    if (hits.length === 0) {
      groups.push({ box: item.box, polygons: [item.polygon] });
      continue;
    }
    const into = groups[hits[0]!]!;
    into.polygons.push(item.polygon);
    into.box = {
      min_x_nm: Math.min(into.box.min_x_nm, item.box.min_x_nm),
      min_y_nm: Math.min(into.box.min_y_nm, item.box.min_y_nm),
      max_x_nm: Math.max(into.box.max_x_nm, item.box.max_x_nm),
      max_y_nm: Math.max(into.box.max_y_nm, item.box.max_y_nm),
    };
    for (let i = hits.length - 1; i >= 1; i -= 1) {
      const absorbed = groups.splice(hits[i]!, 1)[0]!;
      into.polygons.push(...absorbed.polygons);
      into.box = {
        min_x_nm: Math.min(into.box.min_x_nm, absorbed.box.min_x_nm),
        min_y_nm: Math.min(into.box.min_y_nm, absorbed.box.min_y_nm),
        max_x_nm: Math.max(into.box.max_x_nm, absorbed.box.max_x_nm),
        max_y_nm: Math.max(into.box.max_y_nm, absorbed.box.max_y_nm),
      };
    }
  }
  return groups.map((group) => group.polygons);
}

/**
 * A convex cover of a region: every returned piece is convex, and together they are exactly the
 * input.
 *
 * A convex ring is passed through untouched, because cutting it up would only make the caller's job
 * bigger. A concave ring is cut by the same vertical decomposition the boolean uses, whose output
 * pieces are trapezoids and therefore convex. Callers that need to distribute an operation over a
 * union — dilation, area, distance — start here.
 */
export function convexCover(region: Region): Region {
  const pieces: Polygon[] = [];
  for (const polygon of canonical(region)) {
    if (isConvex(polygon)) pieces.push(polygon);
    else pieces.push(...decompose([[polygon]], "union"));
  }
  return canonical(pieces);
}

/** Union of two or more regions. */
export function union(...regions: readonly Region[]): Region {
  const all: Polygon[] = [];
  for (const region of regions) for (const polygon of canonical(region)) all.push(polygon);
  const merged = canonical(all);
  if (merged.length <= 1) return merged;
  const out: Polygon[] = [];
  for (const cluster of clusters(merged)) {
    if (cluster.length === 1) out.push(cluster[0]!);
    else out.push(...decompose([cluster], "union"));
  }
  return canonical(out);
}

/** Intersection of two or more regions. */
export function intersection(...regions: readonly Region[]): Region {
  const operands = regions.map((region) => canonical(region));
  if (operands.some((operand) => operand.length === 0)) return [];
  if (operands.length === 1) return operands[0]!;
  // Cheap rejection first: the result lies inside every operand, so the operands' whole boxes must
  // overlap. It has to be each operand's **whole** box: taking a minimum over the individual pieces
  // of a cover would reject a multi-piece operand whose pieces are spread apart, and a disjoint
  // cover of convex pieces is how every region in this kernel is stored.
  let box = boundsOf(operands[0]![0]!);
  for (const polygon of operands[0]!.slice(1)) {
    const next = boundsOf(polygon);
    box = {
      min_x_nm: Math.min(box.min_x_nm, next.min_x_nm),
      min_y_nm: Math.min(box.min_y_nm, next.min_y_nm),
      max_x_nm: Math.max(box.max_x_nm, next.max_x_nm),
      max_y_nm: Math.max(box.max_y_nm, next.max_y_nm),
    };
  }
  for (const operand of operands.slice(1)) {
    let own = boundsOf(operand[0]!);
    for (const polygon of operand.slice(1)) {
      const next = boundsOf(polygon);
      own = {
        min_x_nm: Math.min(own.min_x_nm, next.min_x_nm),
        min_y_nm: Math.min(own.min_y_nm, next.min_y_nm),
        max_x_nm: Math.max(own.max_x_nm, next.max_x_nm),
        max_y_nm: Math.max(own.max_y_nm, next.max_y_nm),
      };
    }
    box = {
      min_x_nm: Math.max(box.min_x_nm, own.min_x_nm),
      min_y_nm: Math.max(box.min_y_nm, own.min_y_nm),
      max_x_nm: Math.min(box.max_x_nm, own.max_x_nm),
      max_y_nm: Math.min(box.max_y_nm, own.max_y_nm),
    };
  }
  if (box.min_x_nm > box.max_x_nm || box.min_y_nm > box.max_y_nm) return [];
  // A piece entirely outside that box cannot contribute: the result lies inside it.
  const pruned = operands.map((operand) =>
    operand.filter((polygon) => {
      const own = boundsOf(polygon);
      return own.max_x_nm > box.min_x_nm && own.min_x_nm < box.max_x_nm && own.max_y_nm > box.min_y_nm && own.min_y_nm < box.max_y_nm;
    }),
  );
  if (pruned.some((operand) => operand.length === 0)) return [];
  return decompose(pruned, "intersection");
}

/** `base` with every later region removed. */
export function difference(base: Region, ...cuts: readonly Region[]): Region {
  let result: Region = canonical(base);
  for (const cut of cuts) {
    const blockers = canonical(cut);
    if (blockers.length === 0) continue;
    for (const blocker of blockers) {
      if (result.length === 0) return [];
      const blockerBox = boundsOf(blocker);
      const next: Polygon[] = [];
      for (const piece of result) {
        if (!boxesTouch(boundsOf(piece), blockerBox)) {
          next.push(piece);
          continue;
        }
        next.push(...decompose([[piece], [blocker]], "difference"));
      }
      result = canonical(next);
    }
  }
  return result;
}

/** Area of a region, in square nanometres. */
export function regionArea(region: Region): number {
  let total = 0;
  for (const polygon of region) {
    let sum = 0;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
      const a = polygon[j]!;
      const b = polygon[i]!;
      sum += a.x_nm * b.y_nm - b.x_nm * a.y_nm;
    }
    total += Math.abs(sum) / 2;
  }
  return total;
}

/** Whether the two regions share any area; touching along an edge does not count. */
export function overlaps(a: Region, b: Region): boolean {
  return intersection(a, b).length > 0;
}
