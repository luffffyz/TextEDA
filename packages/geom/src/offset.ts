// Dilation and erosion of a region by a round tool (ADR-0054 D1).
//
// The set operations are not the way to grow a shape: unioning one capsule per edge and one disc per
// vertex turns a 130-vertex capsule into thousands of overlapping pieces, and every additional piece
// costs the boolean another slab to sample. Instead:
//
// - a region is first cut into convex pieces (the boolean already emits convex trapezoids, and
//   Minkowski distributes over union exactly, so the pieces can be grown one by one);
// - a convex piece grows by an exact Minkowski sum with the tool disc, computed by merging the two
//   sorted edge-direction lists — integer arithmetic throughout, no boolean, no rounding;
// - a single convex polygon shrinks by halfplane offset, which is the closed form of the same
//   operation;
// - anything else shrinks by complementing, growing the complement, and complementing back.
//
// The tool disc is *circumscribed* (its vertices sit on `radius / cos(pi / segments)`), so a
// clearance is never smaller than requested: the error is at most `1 - cos(pi / segments)` in the
// safe direction. The public `circle` primitive is inscribed instead, because a pad declares the
// radius it wants rather than a clearance it promises.
import { GeometryError, type Polygon, type Region } from "./types.ts";
import { convexHull, convexMinkowski, isConvex, normalize, regionBounds } from "./polygon.ts";
import { circle, rect } from "./shapes.ts";
import { convexCover, difference, union } from "./boolean.ts";

const DEFAULT_ARC_SEGMENTS = 16;

function checkTool(radius: number, segments: number): void {
  if (radius < 0) throw new GeometryError("an offset needs a non-negative radius");
  if (!Number.isInteger(segments) || segments < 8) {
    throw new GeometryError("a tool disc needs at least 8 segments");
  }
}

/**
 * The tool disc: a polygon that contains the true disc of `radius`, tangent to it on every edge.
 *
 * The hull step is not cosmetic. Rounding each rim vertex to the nanometre grid can make three
 * neighbouring vertices turn the wrong way by a nanometre, which gives the ring a concave dent exactly
 * at the segment counts a real clearance uses (4096 segments is fine, 4096 rounded is not). A
 * Minkowski merge needs sorted edge directions, so the rim is re-convexified before it is used.
 */
function toolDisc(radius: number, segments: number): Polygon {
  const circumscribed = radius / Math.cos(Math.PI / segments);
  const rim = circle({ x_nm: 0, y_nm: 0 }, circumscribed, segments);
  return convexHull(rim);
}

/**
 * Grow a region by `radius`.
 *
 * Exact for a convex input: the result is the Minkowski sum of the polygon and the tool disc, so a
 * rectangular pour grown by 1 mm is a rectangle with four rounded corners of exactly that radius,
 * not a many-piece approximation of one.
 */
export function dilate(region: Region, radius: number, segments = DEFAULT_ARC_SEGMENTS): Region {
  checkTool(radius, segments);
  if (radius === 0) return union(region);
  const disc = toolDisc(radius, segments);
  const grown = convexCover(region).map((piece) => convexMinkowski(piece, disc));
  return grown.length === 1 ? grown : union(grown);
}

/**
 * Shrink one convex polygon by `radius`.
 *
 * Erosion of a convex set is an intersection of halfplanes, and erosion distributes over
 * intersection: the result is one halfplane per edge, each pushed inward by the tool's support
 * distance in that edge's normal. A square therefore shrinks to a smaller square with sharp
 * corners, not to a rounded one, and the corner is kept exactly.
 *
 * The support distance is the circumscribed tool's `radius / cos(pi / segments)`, i.e. never less
 * than the true disc's `radius`. That makes the erosion the *guarantee* direction: a pour is never
 * left closer than `radius` to the removed area, and dilate-then-erode cannot grow a region. The
 * price is that up to `(sec(pi / segments) - 1) * radius` extra copper is removed — 0.6 % at the
 * default 16 segments, 0.05 % at 64.
 */
function erodeConvex(polygon: Polygon, radius: number, segments: number): Polygon | null {
  if (!isConvex(polygon)) throw new GeometryError("halfplane erosion needs a convex ring");
  if (radius === 0) return polygon;
  const support = radius / Math.cos(Math.PI / segments);
  let current: { x: number; y: number }[] = polygon.map((point) => ({ x: point.x_nm, y: point.y_nm }));
  for (let i = 0; i < polygon.length && current.length >= 3; i += 1) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    const dx = b.x_nm - a.x_nm;
    const dy = b.y_nm - a.y_nm;
    const length = Math.hypot(dx, dy);
    if (length === 0) return null;
    // Inward normal of a counter-clockwise ring, as a unit vector.
    const nx = -dy / length;
    const ny = dx / length;
    const limit = a.x_nm * nx + a.y_nm * ny + support;
    const kept: { x: number; y: number }[] = [];
    for (let j = 0; j < current.length; j += 1) {
      const p = current[j]!;
      const q = current[(j + 1) % current.length]!;
      const dp = p.x * nx + p.y * ny - limit;
      const dq = q.x * nx + q.y * ny - limit;
      if (dp >= 0) kept.push(p);
      if (dp >= 0 !== dq >= 0) {
        const t = dp / (dp - dq);
        kept.push({ x: p.x + t * (q.x - p.x), y: p.y + t * (q.y - p.y) });
      }
    }
    current = kept;
  }
  if (current.length < 3) return null;
  const rounded = current.map((point) => ({ x_nm: Math.round(point.x), y_nm: Math.round(point.y) }));
  try {
    return normalize(rounded);
  } catch (error) {
    if (!(error instanceof GeometryError)) throw error;
    return null;
  }
}

/**
 * Shrink a region by `radius`.
 *
 * A single convex ring uses the closed form. Everything else uses the definition: the erosion of `A`
 * is the complement of the dilation of the complement of `A`, inside a frame that cannot touch the
 * result.
 *
 * This branch exists because erosion does *not* distribute over a union the way dilation does. A
 * region stored as several touching pieces has artificial interior edges; eroding each piece alone
 * would push every one of those edges inward and carve the region apart. Only a genuinely convex
 * ring — one with no interior edge — is safe to shrink edge by edge.
 */
export function erode(region: Region, radius: number, segments = DEFAULT_ARC_SEGMENTS): Region {
  checkTool(radius, segments);
  if (radius === 0) return union(region);
  const cover = union(region);
  if (cover.length === 0) return [];
  if (cover.length === 1 && isConvex(cover[0]!)) {
    const shrunk = erodeConvex(cover[0]!, radius, segments);
    return shrunk === null ? [] : [shrunk];
  }
  const box = regionBounds(cover);
  if (box === null) return [];
  const margin = 4 * radius + 1;
  const frame = rect(box.min_x_nm - margin, box.min_y_nm - margin, box.max_x_nm + margin, box.max_y_nm + margin);
  const outside = difference([frame], cover);
  return difference([frame], dilate(outside, radius, segments));
}

/** Positive `delta` dilates, negative `delta` erodes, zero normalizes. */
export function offset(region: Region, delta: number, segments = DEFAULT_ARC_SEGMENTS): Region {
  if (delta > 0) return dilate(region, delta, segments);
  if (delta < 0) return erode(region, -delta, segments);
  return union(region);
}
