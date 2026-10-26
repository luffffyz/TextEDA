export { GeometryError, type Bounds, type Point, type Polygon, type Region } from "./types.ts";
export {
  area,
  area2,
  bounds,
  boundsOverlap,
  comparePolygons,
  convexHull,
  convexMinkowski,
  dedupe,
  isConvex,
  isSimple,
  normalize,
  regionBounds,
} from "./polygon.ts";
export { comparePoints, cross, orientation, pointOnSegment, samePoint, segmentsIntersect } from "./predicates.ts";
export {
  contains,
  containsPoint,
  centeredRect,
  circle,
  capsule,
  oval,
  pointPolygonDistance,
  pointSegmentDistance,
  polygonBounds,
  rect,
  rotate,
  roundRect,
} from "./shapes.ts";
export { convexCover, difference, intersection, overlaps, regionArea, union } from "./boolean.ts";
export { dilate, erode, offset } from "./offset.ts";
