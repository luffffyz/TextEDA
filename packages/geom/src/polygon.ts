// Polygon normalization and the properties the rest of the kernel relies on: no repeated
// neighbours, counter-clockwise orientation, a positive area, and no self-intersection. A ring that
// cannot be normalized is rejected instead of repaired by guessing.
import { GeometryError, type Bounds, type Point, type Polygon } from "./types.ts";
import { comparePoints, cross, segmentsIntersect } from "./predicates.ts";

export function area2(polygon: Polygon): number {
  let sum = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[j]!;
    const b = polygon[i]!;
    sum += a.x_nm * b.y_nm - b.x_nm * a.y_nm;
  }
  return sum;
}

/** The signed area; positive for a counter-clockwise ring. */
export function area(polygon: Polygon): number {
  return area2(polygon) / 2;
}

/** Drop repeated consecutive points, including the wrap between the last and first point. */
export function dedupe(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const point of points) {
    const last = out[out.length - 1];
    if (last === undefined || last.x_nm !== point.x_nm || last.y_nm !== point.y_nm) out.push(point);
  }
  while (out.length > 1 && out[0]!.x_nm === out[out.length - 1]!.x_nm && out[0]!.y_nm === out[out.length - 1]!.y_nm) {
    out.pop();
  }
  return out;
}

/** Whether `p` is a middle point of the straight run `a`–`b`, i.e. collinear and between. */
function onEdge(p: Point, a: Point, b: Point): boolean {
  if (cross(a, b, p) !== 0) return false;
  return (
    p.x_nm >= Math.min(a.x_nm, b.x_nm) &&
    p.x_nm <= Math.max(a.x_nm, b.x_nm) &&
    p.y_nm >= Math.min(a.y_nm, b.y_nm) &&
    p.y_nm <= Math.max(a.y_nm, b.y_nm)
  );
}

/**
 * Whether the ring is a simple polygon: no two non-adjacent edges meet, and adjacent edges do not
 * fold back onto each other. Adjacent edges sharing one endpoint is normal.
 */
export function isSimple(polygon: Polygon): boolean {
  const n = polygon.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i += 1) {
    const a1 = polygon[i]!;
    const a2 = polygon[(i + 1) % n]!;
    for (let j = i + 1; j < n; j += 1) {
      const adjacent = j === i + 1 || (i === 0 && j === n - 1);
      const b1 = polygon[j]!;
      const b2 = polygon[(j + 1) % n]!;
      if (!adjacent) {
        if (segmentsIntersect(a1, a2, b1, b2)) return false;
        continue;
      }
      // Adjacent edges may meet at the shared vertex only; overlapping back along each other is a
      // fold. Compare the shared endpoint against the far endpoint of the other edge.
      const shared = j === i + 1 ? a2 : a1;
      const far = j === i + 1 ? b2 : b1;
      const other = j === i + 1 ? a1 : a2;
      if (onEdge(far, shared, other) || onEdge(other, shared, far)) return false;
    }
  }
  return true;
}

/**
 * Normalize a ring: drop duplicates and collinear middle points, orient it counter-clockwise,
 * reject a ring that is degenerate or self-intersecting, and rotate it to start at its
 * lexicographically smallest vertex.
 *
 * The canonical start is what makes an operation independent of the operand order and of the
 * input's own vertex order: two rings describing the same square produce the same array, so the
 * same region serializes to the same bytes (ADR-0054 D5).
 */
export function normalize(points: readonly Point[]): Polygon {
  const deduped = canonicalZero(dedupe(points));
  const out: Point[] = [];
  for (let i = 0; i < deduped.length; i += 1) {
    const prev = deduped[(i + deduped.length - 1) % deduped.length]!;
    const point = deduped[i]!;
    const next = deduped[(i + 1) % deduped.length]!;
    if (onEdge(point, prev, next)) continue;
    out.push(point);
  }
  const ring = canonicalZero(dedupe(out));
  if (ring.length < 3) throw new GeometryError("polygon has fewer than three distinct vertices");
  if (!isSimple(ring)) throw new GeometryError("polygon is self-intersecting");
  const signed = area2(ring);
  if (signed === 0) throw new GeometryError("polygon has zero area");
  return rotateToFirst(signed > 0 ? ring : [...ring].reverse());
}

/**
 * Turn `-0` into `0`. Angular arithmetic produces `-0` for coordinates that are exactly on an axis,
 * and two rings that differ only by that sign are not the same bytes; every polygon that leaves the
 * kernel passes through here, so the sign cannot leak into a serialized contour.
 */
function canonicalZero(points: readonly Point[]): Point[] {
  return points.map((point) =>
    point.x_nm === 0 && point.y_nm === 0
      ? { x_nm: 0, y_nm: 0 }
      : point.x_nm === 0
        ? { x_nm: 0, y_nm: point.y_nm }
        : point.y_nm === 0
          ? { x_nm: point.x_nm, y_nm: 0 }
          : point,
  );
}

/** Rotate a ring so its lexicographically smallest vertex comes first, keeping the winding. */
function rotateToFirst(ring: Polygon): Polygon {
  let best = 0;
  for (let i = 1; i < ring.length; i += 1) {
    if (comparePoints(ring[i]!, ring[best]!) < 0) best = i;
  }
  return best === 0 ? ring : [...ring.slice(best), ...ring.slice(0, best)];
}

/**
 * Whether a counter-clockwise ring is convex: every turn must go the same way. Collinear runs cannot
 * appear because `normalize` removes their middle points, so a zero turn means a degenerate ring.
 *
 * Convexity matters because a convex ring has an exact offset with no join repair: the Minkowski sum
 * of two convex rings is computed by merging their edge directions, which is closed-form and never
 * needs a boolean (ADR-0054, "offset joins").
 */
export function isConvex(polygon: Polygon): boolean {
  if (polygon.length < 3) return false;
  let sign = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const turn = cross(polygon[i]!, polygon[(i + 1) % polygon.length]!, polygon[(i + 2) % polygon.length]!);
    if (turn === 0) return false;
    const direction = turn > 0 ? 1 : -1;
    if (sign === 0) sign = direction;
    else if (sign !== direction) return false;
  }
  return true;
}

/** Index of the lowest vertex, then leftmost; the standard start of a Minkowski edge merge. */
function lowestVertex(ring: Polygon): number {
  let best = 0;
  for (let i = 1; i < ring.length; i += 1) {
    const point = ring[i]!;
    const current = ring[best]!;
    if (point.y_nm < current.y_nm || (point.y_nm === current.y_nm && point.x_nm < current.x_nm)) best = i;
  }
  return best;
}

/**
 * The convex hull of a point set, as a normalized counter-clockwise ring.
 *
 * Used to make a rounded disc exactly convex: a ring whose vertices were each rounded to the grid can
 * turn by a nanometre in the wrong direction, and a Minkowski merge needs the edge directions of its
 * operands to be sorted by angle. Taking the hull of the rounded rim removes that quantization without
 * dropping any vertex that matters.
 */
export function convexHull(points: readonly Point[]): Polygon {
  const sorted = canonicalZero(dedupe([...points].sort(comparePoints)));
  if (sorted.length < 3) throw new GeometryError("a hull needs at least three distinct points");
  const lower: Point[] = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper: Point[] = [];
  for (const point of [...sorted].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, point) <= 0) upper.pop();
    upper.push(point);
  }
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
  if (hull.length < 3) throw new GeometryError("the points are collinear, so they have no hull");
  return normalize(hull);
}

function edgeOf(ring: Polygon, index: number): Point {
  const a = ring[index]!;
  const b = ring[(index + 1) % ring.length]!;
  return { x_nm: b.x_nm - a.x_nm, y_nm: b.y_nm - a.y_nm };
}

/**
 * The Minkowski sum of two convex counter-clockwise rings, in closed form.
 *
 * Both rings are rotated to start at their lowest vertex, which makes their edge vectors sorted by
 * polar angle; the sum of two such sorted sequences is their merge. Every coordinate stays an
 * integer, so no rounding happens and the result is exactly the algebraic sum of the two shapes —
 * this is what lets a clearance be a true clearance instead of a many-piece approximation.
 */
export function convexMinkowski(a: Polygon, b: Polygon): Polygon {
  if (!isConvex(a) || !isConvex(b)) throw new GeometryError("a Minkowski sum needs two convex rings");
  const first = rotateToIndex(a, lowestVertex(a));
  const second = rotateToIndex(b, lowestVertex(b));
  const start = {
    x_nm: first[0]!.x_nm + second[0]!.x_nm,
    y_nm: first[0]!.y_nm + second[0]!.y_nm,
  };
  const out: Point[] = [start];
  let i = 0;
  let j = 0;
  while (i < first.length || j < second.length) {
    let step: Point;
    if (i === first.length) {
      step = edgeOf(second, j);
      j += 1;
    } else if (j === second.length) {
      step = edgeOf(first, i);
      i += 1;
    } else {
      const left = edgeOf(first, i);
      const right = edgeOf(second, j);
      const turn = left.x_nm * right.y_nm - left.y_nm * right.x_nm;
      if (turn > 0) {
        step = left;
        i += 1;
      } else if (turn < 0) {
        step = right;
        j += 1;
      } else {
        step = { x_nm: left.x_nm + right.x_nm, y_nm: left.y_nm + right.y_nm };
        i += 1;
        j += 1;
      }
    }
    const last = out[out.length - 1]!;
    out.push({ x_nm: last.x_nm + step.x_nm, y_nm: last.y_nm + step.y_nm });
  }
  out.pop();
  return normalize(out);
}

function rotateToIndex(ring: Polygon, index: number): Polygon {
  return index === 0 ? [...ring] : [...ring.slice(index), ...ring.slice(0, index)];
}

export function bounds(polygon: Polygon): Bounds {
  if (polygon.length === 0) throw new GeometryError("empty polygon has no bounds");
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of polygon) {
    minX = Math.min(minX, point.x_nm);
    minY = Math.min(minY, point.y_nm);
    maxX = Math.max(maxX, point.x_nm);
    maxY = Math.max(maxY, point.y_nm);
  }
  return { min_x_nm: minX, min_y_nm: minY, max_x_nm: maxX, max_y_nm: maxY };
}

/** Bounds, or null for an empty region. */
export function regionBounds(region: ReadonlyArray<Polygon>): Bounds | null {
  let box: Bounds | null = null;
  for (const polygon of region) {
    const next = bounds(polygon);
    box =
      box === null
        ? next
        : {
            min_x_nm: Math.min(box.min_x_nm, next.min_x_nm),
            min_y_nm: Math.min(box.min_y_nm, next.min_y_nm),
            max_x_nm: Math.max(box.max_x_nm, next.max_x_nm),
            max_y_nm: Math.max(box.max_y_nm, next.max_y_nm),
          };
  }
  return box;
}

export function boundsOverlap(a: Bounds, b: Bounds, inset = 0): boolean {
  return (
    a.min_x_nm < b.max_x_nm - inset &&
    b.min_x_nm < a.max_x_nm - inset &&
    a.min_y_nm < b.max_y_nm - inset &&
    b.min_y_nm < a.max_y_nm - inset
  );
}

/** The canonical ordering used everywhere: lower-left bounds, then the point sequence. */
export function comparePolygons(a: Polygon, b: Polygon): number {
  const ba = bounds(a);
  const bb = bounds(b);
  const byBox =
    ba.min_x_nm - bb.min_x_nm ||
    ba.min_y_nm - bb.min_y_nm ||
    ba.max_x_nm - bb.max_x_nm ||
    ba.max_y_nm - bb.max_y_nm;
  if (byBox !== 0) return byBox;
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    const diff = comparePoints(a[i]!, b[i]!);
    if (diff !== 0) return diff;
  }
  return a.length - b.length;
}
