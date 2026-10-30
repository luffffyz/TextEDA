// Exact orientation and the basic scalar predicates. Coordinates stay integers all the way to the
// sign test; the products are far below Number.MAX_SAFE_INTEGER for board-scale inputs, but callers
// that can exceed that range should split the polygon before calling (ADR-0018 D5).
import type { Point } from "./types.ts";

export function cross(a: Point, b: Point, c: Point): number {
  return (b.x_nm - a.x_nm) * (c.y_nm - a.y_nm) - (b.y_nm - a.y_nm) * (c.x_nm - a.x_nm);
}

/** 1 = counter-clockwise, -1 = clockwise, 0 = collinear. */
export function orientation(a: Point, b: Point, c: Point): 1 | -1 | 0 {
  const value = cross(a, b, c);
  return value > 0 ? 1 : value < 0 ? -1 : 0;
}

export function samePoint(a: Point, b: Point): boolean {
  return a.x_nm === b.x_nm && a.y_nm === b.y_nm;
}

export function comparePoints(a: Point, b: Point): number {
  return a.x_nm - b.x_nm || a.y_nm - b.y_nm;
}

/** The closed segment `a`–`b` contains `p`. */
export function pointOnSegment(p: Point, a: Point, b: Point): boolean {
  if (orientation(a, b, p) !== 0) return false;
  return (
    p.x_nm >= Math.min(a.x_nm, b.x_nm) &&
    p.x_nm <= Math.max(a.x_nm, b.x_nm) &&
    p.y_nm >= Math.min(a.y_nm, b.y_nm) &&
    p.y_nm <= Math.max(a.y_nm, b.y_nm)
  );
}

/**
 * Whether the closed segments intersect, including touching at an endpoint.
 *
 * The four orientation signs decide proper crossings; the on-segment tests cover the cases where
 * an endpoint lies on the other segment.
 */
export function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && pointOnSegment(c, a, b)) return true;
  if (o2 === 0 && pointOnSegment(d, a, b)) return true;
  if (o3 === 0 && pointOnSegment(a, c, d)) return true;
  if (o4 === 0 && pointOnSegment(b, c, d)) return true;
  return false;
}
