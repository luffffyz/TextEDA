// Shape builders and the point/distance queries the fill layer and the DRC subset both use. The
// polygonal approximations (circle, oval, round rect, capsule) are asserted against their exact
// areas so a wrong segment count or a wrong sweep direction cannot silently pass.
import { describe, expect, test } from "bun:test";
import {
  GeometryError,
  bounds,
  capsule,
  centeredRect,
  circle,
  contains,
  containsPoint,
  isSimple,
  oval,
  pointPolygonDistance,
  pointSegmentDistance,
  polygonBounds,
  rect,
  regionArea,
  rotate,
  roundRect,
} from "../src/index.ts";

const p = (x: number, y: number) => ({ x_nm: x, y_nm: y });
const mm = 1_000_000;

describe("rect", () => {
  test("a rect is oriented counter-clockwise with a positive area", () => {
    const square = rect(0, 0, 10, 10);
    expect(square).toHaveLength(4);
    expect(regionArea([square])).toBe(100);
  });

  test("corner order does not matter", () => {
    expect(rect(10, 10, 0, 0)).toEqual(rect(0, 0, 10, 10));
  });

  test("a degenerate rect is rejected", () => {
    expect(() => rect(0, 0, 0, 10)).toThrow(GeometryError);
  });

  test("centeredRect is centered on the point", () => {
    expect(bounds(centeredRect(p(5, 5), 4, 2))).toEqual({
      min_x_nm: 3,
      min_y_nm: 4,
      max_x_nm: 7,
      max_y_nm: 6,
    });
  });
});

describe("point containment", () => {
  const square = rect(0, 0, 10, 10);

  test("inside, outside, and the boundary counting as inside", () => {
    expect(containsPoint(square, p(5, 5))).toBe(true);
    expect(containsPoint(square, p(-1, 5))).toBe(false);
    expect(containsPoint(square, p(10, 5))).toBe(true);
    expect(containsPoint(square, p(0, 0))).toBe(true);
    expect(containsPoint(square, p(10, 10))).toBe(true);
  });

  test("a concave polygon is not mistaken for its bounding box", () => {
    const lShape = [p(0, 0), p(10, 0), p(10, 2), p(2, 2), p(2, 10), p(0, 10)];
    expect(containsPoint(lShape, p(1, 1))).toBe(true);
    expect(containsPoint(lShape, p(5, 5))).toBe(false);
    expect(containsPoint(lShape, p(1, 9))).toBe(true);
  });

  test("a region contains a point when any member does", () => {
    expect(contains([rect(0, 0, 1, 1), rect(4, 4, 5, 5)], p(4, 4))).toBe(true);
    expect(contains([rect(0, 0, 1, 1), rect(4, 4, 5, 5)], p(2, 2))).toBe(false);
  });
});

describe("distance", () => {
  test("point to segment uses the projection when it lands on the segment", () => {
    expect(pointSegmentDistance(p(0, 5), p(0, 0), p(10, 0))).toBe(5);
    expect(pointSegmentDistance(p(5, 0), p(0, 0), p(10, 0))).toBe(0);
  });

  test("point to segment clamps outside the segment", () => {
    expect(pointSegmentDistance(p(-3, 0), p(0, 0), p(10, 0))).toBe(3);
    expect(pointSegmentDistance(p(13, 4), p(0, 0), p(10, 0))).toBe(5);
  });

  test("a zero-length segment is a point", () => {
    expect(pointSegmentDistance(p(3, 4), p(0, 0), p(0, 0))).toBe(5);
  });

  test("point to polygon is zero inside and the nearest edge outside", () => {
    const square = rect(0, 0, 10, 10);
    expect(pointPolygonDistance(square, p(5, 5))).toBe(0);
    expect(pointPolygonDistance(square, p(-2, -2))).toBe(Math.hypot(2, 2));
    expect(pointPolygonDistance(square, p(5, -3))).toBe(3);
  });
});

describe("circle", () => {
  test("area approaches pi r squared as the segment count rises", () => {
    const r = 10 * mm;
    const coarse = regionArea([circle(p(0, 0), r, 16)]);
    const fine = regionArea([circle(p(0, 0), r, 64)]);
    const exact = Math.PI * r * r;
    expect(coarse / exact).toBeGreaterThan(0.95);
    expect(fine / exact).toBeGreaterThan(0.995);
    expect(fine).toBeGreaterThan(coarse);
  });

  test("the rim stays within a rounded radius of the center", () => {
    const r = 5 * mm;
    const disc = circle(p(100, 200), r, 32);
    for (const point of disc) {
      expect(Math.hypot(point.x_nm - 100, point.y_nm - 200)).toBeLessThanOrEqual(r + 1);
    }
  });

  test("a non-positive radius and a tiny segment count are rejected", () => {
    expect(() => circle(p(0, 0), 0)).toThrow(GeometryError);
    expect(() => circle(p(0, 0), -1)).toThrow(GeometryError);
    expect(() => circle(p(0, 0), 10, 4)).toThrow(GeometryError);
  });
});

describe("oval", () => {
  test("a 20x10 oval is a 10-wide stadium, not an ellipse", () => {
    const shape = oval(p(0, 0), 20 * mm, 10 * mm, 64);
    const exact = Math.PI * 25 + 100;
    expect(regionArea([shape]) / 1e12 / exact).toBeGreaterThan(0.99);
    expect(bounds(shape)).toEqual({
      min_x_nm: -10 * mm,
      min_y_nm: -5 * mm,
      max_x_nm: 10 * mm,
      max_y_nm: 5 * mm,
    });
  });

  test("the same oval rotated a quarter turn has the same area and swapped bounds", () => {
    const wide = oval(p(0, 0), 20 * mm, 10 * mm, 32);
    const tall = oval(p(0, 0), 10 * mm, 20 * mm, 32);
    expect(regionArea([wide])).toBeCloseTo(regionArea([tall]), 6);
    expect(bounds(tall)).toEqual({
      min_x_nm: -5 * mm,
      min_y_nm: -10 * mm,
      max_x_nm: 5 * mm,
      max_y_nm: 10 * mm,
    });
  });

  test("a square oval is a circle", () => {
    const shape = oval(p(0, 0), 10 * mm, 10 * mm, 16);
    expect(bounds(shape)).toEqual({
      min_x_nm: -5 * mm,
      min_y_nm: -5 * mm,
      max_x_nm: 5 * mm,
      max_y_nm: 5 * mm,
    });
  });

  test("non-positive axes are rejected", () => {
    expect(() => oval(p(0, 0), 0, 10)).toThrow(GeometryError);
    expect(() => oval(p(0, 0), 10, -1)).toThrow(GeometryError);
  });
});

describe("roundRect", () => {
  test("a 20x10 rect with a 2 radius corner loses the corners and gains the arcs", () => {
    const shape = roundRect(p(0, 0), 20 * mm, 10 * mm, 2 * mm, 64);
    const exact = Math.PI * 4 + (20 - 4) * (10 - 4) + 2 * (20 - 4) * 2 + 2 * (10 - 4) * 2;
    expect(regionArea([shape]) / 1e12 / exact).toBeGreaterThan(0.99);
    expect(bounds(shape)).toEqual({
      min_x_nm: -10 * mm,
      min_y_nm: -5 * mm,
      max_x_nm: 10 * mm,
      max_y_nm: 5 * mm,
    });
  });

  test("a zero radius is a plain rectangle", () => {
    expect(roundRect(p(0, 0), 20, 10, 0)).toEqual(centeredRect(p(0, 0), 20, 10));
  });

  test("the radius is clamped to half the short side", () => {
    const shape = roundRect(p(0, 0), 20 * mm, 10 * mm, 100 * mm, 32);
    expect(bounds(shape)).toEqual({
      min_x_nm: -10 * mm,
      min_y_nm: -5 * mm,
      max_x_nm: 10 * mm,
      max_y_nm: 5 * mm,
    });
  });

  test("negative axes or radius are rejected", () => {
    expect(() => roundRect(p(0, 0), 0, 10, 1)).toThrow(GeometryError);
    expect(() => roundRect(p(0, 0), 10, 10, -1)).toThrow(GeometryError);
  });
});

describe("capsule", () => {
  test("a horizontal capsule is a rectangle plus two round caps", () => {
    const shape = capsule(p(0, 0), p(20 * mm, 0), mm, 64);
    const exact = Math.PI + 40;
    expect(regionArea([shape]) / 1e12 / exact).toBeGreaterThan(0.999);
    expect(bounds(shape)).toEqual({
      min_x_nm: -mm,
      min_y_nm: -mm,
      max_x_nm: 21 * mm,
      max_y_nm: mm,
    });
  });

  test("caps face the segment, so a capsule along y is the same shape turned a quarter turn", () => {
    const horizontal = capsule(p(0, 0), p(20 * mm, 0), mm, 32);
    const vertical = capsule(p(0, 0), p(0, 20 * mm), mm, 32);
    expect(regionArea([horizontal])).toBeCloseTo(regionArea([vertical]), 6);
    expect(bounds(vertical)).toEqual({
      min_x_nm: -mm,
      min_y_nm: -mm,
      max_x_nm: mm,
      max_y_nm: 21 * mm,
    });
  });

  test("a diagonal capsule keeps its area and stays simple", () => {
    const shape = capsule(p(0, 0), p(14 * mm, 14 * mm), mm, 32);
    expect(isSimple(shape)).toBe(true);
    const exact = Math.PI + 2 * Math.hypot(14, 14);
    expect(regionArea([shape]) / 1e12 / exact).toBeGreaterThan(0.999);
  });

  test("a degenerate segment is a disc", () => {
    expect(bounds(capsule(p(0, 0), p(0, 0), mm, 16))).toEqual({
      min_x_nm: -mm,
      min_y_nm: -mm,
      max_x_nm: mm,
      max_y_nm: mm,
    });
  });

  test("a zero or negative radius has no area and is rejected", () => {
    expect(() => capsule(p(0, 0), p(10, 0), 0)).toThrow(GeometryError);
    expect(() => capsule(p(0, 0), p(10, 0), -1)).toThrow(GeometryError);
  });

  test("the winding direction of the segment does not change the shape", () => {
    expect(capsule(p(0, 0), p(10 * mm, 0), mm, 16)).toEqual(capsule(p(10 * mm, 0), p(0, 0), mm, 16));
  });
});

describe("rotate", () => {
  test("quarter turns land on exact multiples of 90 degrees", () => {
    expect(rotate(p(10 * mm, 0), p(0, 0), 90_000)).toEqual({ x_nm: 0, y_nm: 10 * mm });
    expect(rotate(p(0, 10 * mm), p(0, 0), 180_000)).toEqual({ x_nm: 0, y_nm: -10 * mm });
    expect(rotate(p(10 * mm, 0), p(10 * mm, 0), 90_000)).toEqual({ x_nm: 10 * mm, y_nm: 0 });
  });
});

describe("polygonBounds", () => {
  test("returns the bounding rectangle of a slanted polygon", () => {
    const triangle = [p(0, 0), p(10, 0), p(0, 10)];
    expect(bounds(polygonBounds(triangle))).toEqual({
      min_x_nm: 0,
      min_y_nm: 0,
      max_x_nm: 10,
      max_y_nm: 10,
    });
  });
});
