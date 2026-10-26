// Normalization and the predicates the boolean code relies on: orientation, touching vs crossing,
// and the rules for what a ring must look like before it is allowed to enter an operation.
import { describe, expect, test } from "bun:test";
import {
  GeometryError,
  area,
  area2,
  bounds,
  comparePoints,
  cross,
  dedupe,
  isSimple,
  normalize,
  orientation,
  pointOnSegment,
  regionBounds,
  segmentsIntersect,
} from "../src/index.ts";

const p = (x: number, y: number) => ({ x_nm: x, y_nm: y });

describe("orientation predicates", () => {
  test("cross sign is the turn direction", () => {
    expect(cross(p(0, 0), p(1, 0), p(0, 1))).toBe(1);
    expect(cross(p(0, 0), p(0, 1), p(1, 0))).toBe(-1);
    expect(cross(p(0, 0), p(2, 2), p(5, 5))).toBe(0);
    expect(orientation(p(0, 0), p(1, 0), p(0, 1))).toBe(1);
    expect(orientation(p(0, 0), p(0, 1), p(1, 0))).toBe(-1);
    expect(orientation(p(3, 3), p(1, 1), p(2, 2))).toBe(0);
  });

  test("point on segment counts the endpoints and rejects collinear points outside", () => {
    expect(pointOnSegment(p(5, 0), p(0, 0), p(10, 0))).toBe(true);
    expect(pointOnSegment(p(0, 0), p(0, 0), p(10, 0))).toBe(true);
    expect(pointOnSegment(p(10, 0), p(0, 0), p(10, 0))).toBe(true);
    expect(pointOnSegment(p(11, 0), p(0, 0), p(10, 0))).toBe(false);
    expect(pointOnSegment(p(5, 1), p(0, 0), p(10, 0))).toBe(false);
    expect(pointOnSegment(p(5, 5), p(0, 0), p(10, 10))).toBe(true);
  });

  test("comparePoints orders by x then y", () => {
    expect(comparePoints(p(0, 0), p(0, 0))).toBe(0);
    expect(comparePoints(p(0, 1), p(0, 0))).toBeGreaterThan(0);
    expect(comparePoints(p(-1, 5), p(0, 0))).toBeLessThan(0);
  });
});

describe("segment intersection", () => {
  test("a proper crossing intersects", () => {
    expect(segmentsIntersect(p(0, 0), p(10, 10), p(0, 10), p(10, 0))).toBe(true);
  });

  test("disjoint segments do not intersect, and parallel segments do not either", () => {
    expect(segmentsIntersect(p(0, 0), p(1, 0), p(0, 1), p(1, 1))).toBe(false);
    expect(segmentsIntersect(p(0, 0), p(10, 0), p(0, 5), p(10, 5))).toBe(false);
  });

  test("touching endpoints intersect but do not cross", () => {
    expect(segmentsIntersect(p(0, 0), p(5, 0), p(5, 0), p(5, 5))).toBe(true);
    expect(segmentsIntersect(p(0, 0), p(5, 0), p(5, 1), p(5, 5))).toBe(false);
  });

  test("a collinear overlap intersects", () => {
    expect(segmentsIntersect(p(0, 0), p(10, 0), p(5, 0), p(15, 0))).toBe(true);
    expect(segmentsIntersect(p(0, 0), p(4, 0), p(5, 0), p(9, 0))).toBe(false);
  });
});

describe("dedupe", () => {
  test("drops repeated neighbours including the wrap", () => {
    expect(dedupe([p(0, 0), p(0, 0), p(1, 0), p(1, 0), p(1, 1)])).toEqual([p(0, 0), p(1, 0), p(1, 1)]);
    expect(dedupe([p(0, 0), p(1, 0), p(1, 1), p(0, 0)])).toEqual([p(0, 0), p(1, 0), p(1, 1)]);
    expect(dedupe([p(0, 0), p(0, 0)])).toEqual([p(0, 0)]);
  });
});

describe("normalize", () => {
  test("orients counter-clockwise and keeps the signed area positive", () => {
    const clockwise = normalize([p(0, 0), p(0, 10), p(10, 10), p(10, 0)]);
    expect(area2(clockwise)).toBeGreaterThan(0);
    expect(area(clockwise)).toBe(100);
  });

  test("drops collinear middle points", () => {
    const ring = normalize([p(0, 0), p(5, 0), p(10, 0), p(10, 10), p(0, 10)]);
    expect(ring).toHaveLength(4);
    expect(area(ring)).toBe(100);
  });

  test("rejects fewer than three vertices, zero area and self-intersection", () => {
    expect(() => normalize([p(0, 0), p(1, 0)])).toThrow(GeometryError);
    expect(() => normalize([p(0, 0), p(1, 0), p(2, 0)])).toThrow(GeometryError);
    expect(() => normalize([p(0, 0), p(10, 0), p(10, 10), p(0, 10), p(10, 0)])).toThrow(
      "polygon is self-intersecting",
    );
  });

  test("a bowtie is self-intersecting and is not repaired", () => {
    expect(isSimple([p(0, 0), p(10, 10), p(10, 0), p(0, 10)])).toBe(false);
    expect(() => normalize([p(0, 0), p(10, 10), p(10, 0), p(0, 10)])).toThrow("polygon is self-intersecting");
  });

  test("input order does not change the normalized ring", () => {
    const square = [p(0, 0), p(10, 0), p(10, 10), p(0, 10)];
    const reversed = normalize([...square].reverse());
    expect(normalize(square)).toEqual(reversed);
  });
});

describe("bounds", () => {
  test("bounds of a ring and of an empty region", () => {
    expect(bounds([p(0, 0), p(10, 0), p(10, -5)])).toEqual({
      min_x_nm: 0,
      min_y_nm: -5,
      max_x_nm: 10,
      max_y_nm: 0,
    });
    expect(regionBounds([])).toBeNull();
  });

  test("region bounds contain every member box", () => {
    const box = regionBounds([
      [p(0, 0), p(1, 0), p(1, 1)],
      [p(-4, -4), p(-2, -4), p(-2, -2)],
    ]);
    expect(box).toEqual({ min_x_nm: -4, min_y_nm: -4, max_x_nm: 1, max_y_nm: 1 });
  });

  test("an empty polygon has no bounds", () => {
    expect(() => bounds([])).toThrow(GeometryError);
  });
});
