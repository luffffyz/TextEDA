// Plane geometry for the drawing checks (spec/schematic-view.md §9.2).
//
// Everything here works on the renderer's geometry facts: boxes, points, polylines in sheet
// coordinates (nanometres). No file system, no drawing, no judgement — the checks and the metrics
// both read these, so "how far is this label from its net" has one answer in the whole toolchain.
import type { SchematicView } from "@texteda/ir/schematic-view";
import type { ReadabilityBox, ReadabilitySymbol } from "./facts.ts";

export interface Point {
  readonly x_nm: number;
  readonly y_nm: number;
}

/** A point counts as "on" a line when it is this close; drawings are exact, so the tolerance is tiny. */
export const ON_LINE_NM = 1_000;

/** The polyline a wire draws: endpoints are pins (the geometry knows where they are), plus the view's bend points. */
export function wirePath(
  wire: NonNullable<SchematicView["wire"]>[number],
  symbols: ReadonlyMap<string, ReadabilitySymbol>,
): Point[] | null {
  const pointOf = (ref: string): Point | null => {
    const dot = ref.lastIndexOf(".");
    if (dot <= 0) return null;
    return symbols.get(ref.slice(0, dot))?.pins.get(ref.slice(dot + 1)) ?? null;
  };
  const from = pointOf(wire.from_pin);
  const to = pointOf(wire.to_pin);
  if (!from || !to) return null;
  return [from, ...(wire.points ?? []).map((p) => ({ x_nm: p.x_nm, y_nm: p.y_nm })), to];
}

/**
 * The line a pin draws from its connection point to the symbol's body edge.
 *
 * A pin is drawn as a short stroke, not just a point: a wire can cross the stroke without touching
 * the connection point, and the reader still sees it as a line through a pin. Pins sit outside the
 * body and run along an axis, so the stroke is the axis-aligned segment to the nearest body edge.
 * A pin on or inside the body has no stroke to check.
 */
export function pinStroke(symbol: ReadabilitySymbol, pin: Point): [Point, Point] | null {
  const { box } = symbol;
  if (pin.x_nm < box.min_x_nm) return [pin, { x_nm: box.min_x_nm, y_nm: pin.y_nm }];
  if (pin.x_nm > box.max_x_nm) return [{ x_nm: box.max_x_nm, y_nm: pin.y_nm }, pin];
  if (pin.y_nm < box.min_y_nm) return [pin, { x_nm: pin.x_nm, y_nm: box.min_y_nm }];
  if (pin.y_nm > box.max_y_nm) return [{ x_nm: pin.x_nm, y_nm: box.max_y_nm }, pin];
  return null;
}

/** Distance from a point to a polyline (to the nearest segment). */
export function distanceToPolyline(point: Point, path: readonly Point[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i + 1 < path.length; i += 1) {
    best = Math.min(best, distanceToSegment(point, path[i]!, path[i + 1]!));
  }
  return best;
}

export function distanceToSegment(point: Point, a: Point, b: Point): number {
  const dx = b.x_nm - a.x_nm;
  const dy = b.y_nm - a.y_nm;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((point.x_nm - a.x_nm) * dx + (point.y_nm - a.y_nm) * dy) / lengthSquared));
  return Math.hypot(point.x_nm - (a.x_nm + t * dx), point.y_nm - (a.y_nm + t * dy));
}

export function polylineLength(path: readonly Point[]): number {
  let total = 0;
  for (let i = 0; i + 1 < path.length; i += 1) total += Math.hypot(path[i + 1]!.x_nm - path[i]!.x_nm, path[i + 1]!.y_nm - path[i]!.y_nm);
  return total;
}

/** Open boxes overlap only when they share area, not when they touch. */
export function boxesOverlap(a: ReadabilityBox, b: ReadabilityBox): boolean {
  return a.min_x_nm < b.max_x_nm && b.min_x_nm < a.max_x_nm && a.min_y_nm < b.max_y_nm && b.min_y_nm < a.max_y_nm;
}

/** Area the two boxes share (0 when they only touch). */
export function overlapArea(a: ReadabilityBox, b: ReadabilityBox): number {
  const width = Math.min(a.max_x_nm, b.max_x_nm) - Math.max(a.min_x_nm, b.min_x_nm);
  const height = Math.min(a.max_y_nm, b.max_y_nm) - Math.max(a.min_y_nm, b.min_y_nm);
  return width > 0 && height > 0 ? width * height : 0;
}

/**
 * Euclidean distance between two boxes: 0 when they overlap or touch, the gap along the only
 * separated axis when they line up, the diagonal otherwise.
 */
export function boxDistance(a: ReadabilityBox, b: ReadabilityBox): number {
  const dx = Math.max(0, Math.max(a.min_x_nm, b.min_x_nm) - Math.min(a.max_x_nm, b.max_x_nm));
  const dy = Math.max(0, Math.max(a.min_y_nm, b.min_y_nm) - Math.min(a.max_y_nm, b.max_y_nm));
  return Math.hypot(dx, dy);
}

/** The slice of a segment inside a box, as a `[t0, t1]` pair of the segment's parameter, or null. */
export function segmentInBox(a: Point, b: Point, box: ReadabilityBox, inset = 0): [number, number] | null {
  // Liang–Barsky clip of the segment against the box, opened by `inset` on each side.
  const left = box.min_x_nm + inset;
  const right = box.max_x_nm - inset;
  const top = box.min_y_nm + inset;
  const bottom = box.max_y_nm - inset;
  if (left >= right || top >= bottom) return null;
  let t0 = 0;
  let t1 = 1;
  const dx = b.x_nm - a.x_nm;
  const dy = b.y_nm - a.y_nm;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  const ok =
    clip(-dx, a.x_nm - left) && clip(dx, right - a.x_nm) && clip(-dy, a.y_nm - top) && clip(dy, bottom - a.y_nm);
  return ok && t1 > t0 ? [t0, t1] : null;
}

/** Whether a segment enters a box's interior (touching an edge does not count). */
export function segmentEntersBox(a: Point, b: Point, box: ReadabilityBox, inset = ON_LINE_NM): boolean {
  return segmentInBox(a, b, box, inset) !== null;
}

/**
 * Where two segments cross, as parameters `[t, u]` of the two segments, or null.
 *
 * Shared endpoints do not count (`t` or `u` at 0/1): wires that meet at a pin or a bend are drawn
 * touching, not crossing.
 */
export function segmentCrossing(a: Point, b: Point, c: Point, d: Point): [number, number] | null {
  const r = { x: b.x_nm - a.x_nm, y: b.y_nm - a.y_nm };
  const s = { x: d.x_nm - c.x_nm, y: d.y_nm - c.y_nm };
  const denominator = r.x * s.y - r.y * s.x;
  if (denominator === 0) return null; // parallel or collinear: overlapping lines are not a crossing
  const ac = { x: c.x_nm - a.x_nm, y: c.y_nm - a.y_nm };
  const t = (ac.x * s.y - ac.y * s.x) / denominator;
  const u = (ac.x * r.y - ac.y * r.x) / denominator;
  const inside = (v: number): boolean => v > 0 && v < 1;
  return inside(t) && inside(u) ? [t, u] : null;
}

/** The smallest box containing every box. */
export function boxUnion(boxes: readonly ReadabilityBox[]): ReadabilityBox | null {
  if (boxes.length === 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const box of boxes) {
    minX = Math.min(minX, box.min_x_nm);
    minY = Math.min(minY, box.min_y_nm);
    maxX = Math.max(maxX, box.max_x_nm);
    maxY = Math.max(maxY, box.max_y_nm);
  }
  return { min_x_nm: minX, min_y_nm: minY, max_x_nm: maxX, max_y_nm: maxY };
}
