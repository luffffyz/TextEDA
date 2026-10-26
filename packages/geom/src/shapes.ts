// Point-in-polygon, distance, and the simple shape builders that fill and checks need.
import { GeometryError, type Point, type Polygon, type Region } from "./types.ts";
import { bounds, normalize } from "./polygon.ts";
import { pointOnSegment } from "./predicates.ts";

/** Ray casting with the boundary counted as inside. */
export function containsPoint(polygon: Polygon, point: Point): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[j]!;
    const b = polygon[i]!;
    if (pointOnSegment(point, a, b)) return true;
    if (a.y_nm > point.y_nm !== b.y_nm > point.y_nm) {
      const x = ((b.x_nm - a.x_nm) * (point.y_nm - a.y_nm)) / (b.y_nm - a.y_nm) + a.x_nm;
      if (point.x_nm < x) inside = !inside;
    }
  }
  return inside;
}

/** Distance from a point to a segment, in nanometres. */
export function pointSegmentDistance(point: Point, a: Point, b: Point): number {
  const dx = b.x_nm - a.x_nm;
  const dy = b.y_nm - a.y_nm;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x_nm - a.x_nm, point.y_nm - a.y_nm);
  const t = Math.max(0, Math.min(1, ((point.x_nm - a.x_nm) * dx + (point.y_nm - a.y_nm) * dy) / lengthSquared));
  return Math.hypot(point.x_nm - (a.x_nm + t * dx), point.y_nm - (a.y_nm + t * dy));
}

/** Distance from a point to a filled polygon; 0 when it is inside. */
export function pointPolygonDistance(polygon: Polygon, point: Point): number {
  if (containsPoint(polygon, point)) return 0;
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < polygon.length; i += 1) {
    best = Math.min(best, pointSegmentDistance(point, polygon[i]!, polygon[(i + 1) % polygon.length]!));
  }
  return best;
}

/** Axis-aligned rectangle from two opposite corners. */
export function rect(x0: number, y0: number, x1: number, y1: number): Polygon {
  const left = Math.min(x0, x1);
  const right = Math.max(x0, x1);
  const top = Math.min(y0, y1);
  const bottom = Math.max(y0, y1);
  return normalize([
    { x_nm: left, y_nm: top },
    { x_nm: right, y_nm: top },
    { x_nm: right, y_nm: bottom },
    { x_nm: left, y_nm: bottom },
  ]);
}

/** A regular axis-aligned rectangle centered on a point. */
export function centeredRect(center: Point, width: number, height: number): Polygon {
  return rect(center.x_nm - width / 2, center.y_nm - height / 2, center.x_nm + width / 2, center.y_nm + height / 2);
}

/**
 * A capsule (stadium) around a segment: the segment's two parallel offsets plus a semicircular cap
 * at each end. Caps are approximated by `segments` points, matching a circle of the same radius, so
 * a capsule's cap and a disc's rim agree at the shared tangent points.
 *
 * A degenerate segment (both ends equal) is just a disc, and a zero radius has no area at all.
 */
export function capsule(a: Point, b: Point, radius: number, segments = 16): Polygon {
  if (radius < 0) throw new GeometryError("capsule radius is negative");
  if (radius === 0) throw new GeometryError("a zero-radius capsule has no area");
  if (segments < 8) throw new GeometryError("a capsule cap needs at least 8 segments");
  const dx = b.x_nm - a.x_nm;
  const dy = b.y_nm - a.y_nm;
  const length = Math.hypot(dx, dy);
  if (length === 0) return circle(a, radius, segments);
  const nx = (-dy / length) * radius;
  const ny = (dx / length) * radius;
  // The outline runs top side -> far cap -> bottom side -> near cap, so both caps sweep clockwise:
  // the far cap goes from `b + n` (angle base + pi/2) down to `b - n`, and the near cap continues
  // from `a - n` down to `a + n`, which closes the ring.
  const base = Math.atan2(dy, dx);
  const sweep = (center: Point, from: number, steps: number): Point[] => {
    const out: Point[] = [];
    for (let i = 1; i <= steps; i += 1) {
      const angle = from - (i / segments) * Math.PI;
      out.push({
        x_nm: Math.round(center.x_nm + Math.cos(angle) * radius),
        y_nm: Math.round(center.y_nm + Math.sin(angle) * radius),
      });
    }
    return out;
  };
  const points: Point[] = [
    { x_nm: Math.round(a.x_nm + nx), y_nm: Math.round(a.y_nm + ny) },
    { x_nm: Math.round(b.x_nm + nx), y_nm: Math.round(b.y_nm + ny) },
    ...sweep(b, base + Math.PI / 2, segments),
    { x_nm: Math.round(a.x_nm - nx), y_nm: Math.round(a.y_nm - ny) },
    ...sweep(a, base + (3 * Math.PI) / 2, segments - 1),
  ];
  return normalize(points);
}

/** A circle approximated by a regular polygon. The approximation is explicit and deterministic. */
export function circle(center: Point, radius: number, segments = 16): Polygon {
  if (radius <= 0) throw new GeometryError("circle radius must be positive");
  if (segments < 8) throw new GeometryError("a circle needs at least 8 segments");
  const points: Point[] = [];
  for (let i = 0; i < segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2;
    points.push({
      x_nm: Math.round(center.x_nm + Math.cos(angle) * radius),
      y_nm: Math.round(center.y_nm + Math.sin(angle) * radius),
    });
  }
  return normalize(points);
}

/** An oval: a rectangle with semicircular caps, approximated by the same segment count per cap. */
export function oval(center: Point, width: number, height: number, segments = 8): Polygon {
  if (width <= 0 || height <= 0) throw new GeometryError("oval axes must be positive");
  if (width === height) return circle(center, width / 2, segments * 2);
  const horizontal = width > height;
  const radius = Math.min(width, height) / 2;
  const straight = (horizontal ? width : height) / 2 - radius;
  const points: Point[] = [];
  const addCap = (cx: number, cy: number, start: number, sweep: number): void => {
    for (let i = 0; i <= segments; i += 1) {
      const angle = start + (i / segments) * sweep;
      points.push({
        x_nm: Math.round(cx + Math.cos(angle) * radius),
        y_nm: Math.round(cy + Math.sin(angle) * radius),
      });
    }
  };
  if (horizontal) {
    addCap(center.x_nm + straight, center.y_nm, -Math.PI / 2, Math.PI);
    addCap(center.x_nm - straight, center.y_nm, Math.PI / 2, Math.PI);
  } else {
    addCap(center.x_nm, center.y_nm + straight, 0, Math.PI);
    addCap(center.x_nm, center.y_nm - straight, Math.PI, Math.PI);
  }
  return normalize(points);
}

/** A rounded rectangle, with the corner radius clamped to half the short side. */
export function roundRect(center: Point, width: number, height: number, radius: number, segments = 8): Polygon {
  if (width <= 0 || height <= 0) throw new GeometryError("round rect axes must be positive");
  if (radius < 0) throw new GeometryError("round rect radius is negative");
  const r = Math.min(radius, Math.min(width, height) / 2);
  if (r === 0) return centeredRect(center, width, height);
  const halfW = width / 2 - r;
  const halfH = height / 2 - r;
  const points: Point[] = [];
  const corner = (cx: number, cy: number, start: number): void => {
    for (let i = 0; i <= segments; i += 1) {
      const angle = start + (i / segments) * (Math.PI / 2);
      points.push({
        x_nm: Math.round(cx + Math.cos(angle) * r),
        y_nm: Math.round(cy + Math.sin(angle) * r),
      });
    }
  };
  corner(center.x_nm + halfW, center.y_nm + halfH, 0);
  corner(center.x_nm - halfW, center.y_nm + halfH, Math.PI / 2);
  corner(center.x_nm - halfW, center.y_nm - halfH, Math.PI);
  corner(center.x_nm + halfW, center.y_nm - halfH, Math.PI * 1.5);
  return normalize(points);
}

/** Rotate a point around a center by an angle in millidegrees. */
export function rotate(point: Point, center: Point, mdeg: number): Point {
  const radians = (mdeg / 1000) * (Math.PI / 180);
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = point.x_nm - center.x_nm;
  const dy = point.y_nm - center.y_nm;
  // `Math.round` returns -0 for small negative inputs; canonical coordinates never carry -0.
  const round = (value: number): number => {
    const rounded = Math.round(value);
    return rounded === 0 ? 0 : rounded;
  };
  return {
    x_nm: round(center.x_nm + dx * cos - dy * sin),
    y_nm: round(center.y_nm + dx * sin + dy * cos),
  };
}

/** A polygon's point-in-region test: any member polygon contains it. */
export function contains(region: Region, point: Point): boolean {
  return region.some((polygon) => containsPoint(polygon, point));
}

/** The bounds of a polygon as a rectangle, useful for cheap obstacle pre-checks. */
export function polygonBounds(polygon: Polygon): Polygon {
  const box = bounds(polygon);
  return rect(box.min_x_nm, box.min_y_nm, box.max_x_nm, box.max_y_nm);
}
