// The 2D geometry kernel (ADR-0018): integer-nanometre shapes, exact predicates where they decide
// topology, and deterministic output. It knows nothing about nets, layers, rules, or Gerber.
//
// A polygon is a closed ring of points. A region is a set of convex polygons that do not overlap
// (they may share edges or points). Boolean operations return regions, not one outline: copper can
// be drawn as several dark regions, and keeping the pieces disjoint avoids inventing a merge step
// before it is needed.

export interface Point {
  readonly x_nm: number;
  readonly y_nm: number;
}

/** One simple, counter-clockwise ring. The first point is not repeated at the end. */
export type Polygon = readonly Point[];

/** A disjoint cover of a shape by convex polygons. */
export type Region = readonly Polygon[];

export interface Bounds {
  readonly min_x_nm: number;
  readonly min_y_nm: number;
  readonly max_x_nm: number;
  readonly max_y_nm: number;
}

export class GeometryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeometryError";
  }
}
