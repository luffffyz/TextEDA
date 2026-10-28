// Offset invariants (ADR-0117 D1/D6): growth is an exact Minkowski sum with the tool disc, shrinkage
// is halfplane offset, and both err in the safe direction — copper is never left closer than the
// requested clearance. The disc is a polygon, so every assertion states its own tolerance instead of
// pretending the result is a circle.
import { describe, expect, test } from "bun:test";
import {
  GeometryError,
  bounds,
  capsule,
  circle,
  contains,
  difference,
  dilate,
  erode,
  intersection,
  offset,
  pointPolygonDistance,
  rect,
  regionArea,
  union,
  type Polygon,
  type Region,
} from "../src/index.ts";

const mm = 1_000_000;
/** A circumscribed `segments`-gon is at most this much larger than the disc it encloses. */
const sec = (segments: number): number => 1 / Math.cos(Math.PI / segments);

const relativeError = (actual: number, expected: number): number => Math.abs(actual - expected) / expected;

describe("dilate", () => {
  const square = [rect(0, 0, 10 * mm, 10 * mm)];
  const r = mm;
  /** Square plus perimeter band plus four quarter discs. */
  const exact = 100 + 40 + Math.PI;

  test("growing a square by r adds the perimeter band and four round corners", () => {
    const grown = dilate(square, r, 64);
    const area = regionArea(grown) / 1e12;
    expect(area).toBeGreaterThan(exact);
    expect(relativeError(area, exact)).toBeLessThan(sec(64) ** 2 - 1 + 1e-4);
  });

  test("the join is round, so the corners are outside the original square", () => {
    const grown = dilate(square, r, 32);
    const box = bounds(grown[0]!);
    // A circumscribed tool reaches r * sec(pi / segments) on the corner normal and exactly r on an
    // axis; both are at least r, which is what a clearance promises.
    expect(box.min_x_nm).toBeLessThanOrEqual(-r);
    expect(box.max_x_nm).toBeGreaterThanOrEqual(10 * mm + r);
    expect(box.min_x_nm).toBeGreaterThan(-r * sec(32) - 1);
    expect(box.max_y_nm).toBeLessThan(10 * mm + r * sec(32) + 1);
  });

  test("area converges to the exact value as the disc gets finer", () => {
    const areas = [8, 16, 32, 64, 256].map((segments) => regionArea(dilate(square, r, segments)) / 1e12);
    for (let i = 1; i < areas.length; i += 1) expect(areas[i]!).toBeLessThan(areas[i - 1]!);
    expect(areas[areas.length - 1]!).toBeGreaterThan(exact);
    expect(relativeError(areas[areas.length - 1]!, exact)).toBeLessThan(1e-4);
  });

  test("a convex input keeps its own round corners: one ring out, not a shred", () => {
    const rounded = [rect(0, 0, 10 * mm, 10 * mm)];
    expect(dilate(rounded, r, 32)).toHaveLength(1);
  });

  test("a zero radius normalizes the region", () => {
    expect(dilate(square, 0)).toEqual(union(square));
  });

  test("an empty region stays empty", () => {
    expect(dilate([], mm)).toEqual([]);
  });

  test("growing two far-apart shapes keeps them apart with the sum of their areas", () => {
    const far = [rect(0, 0, 10 * mm, 10 * mm), rect(100 * mm, 0, 110 * mm, 10 * mm)];
    const grown = dilate(far, mm, 64);
    expect(grown).toHaveLength(2);
    expect(relativeError(regionArea(grown) / 1e12, 2 * exact)).toBeLessThan(1e-3);
  });

  test("growing two shapes that the clearance bridges merges them and removes the double count", () => {
    const near = [rect(0, 0, 10 * mm, 10 * mm), rect(11 * mm, 0, 21 * mm, 10 * mm)];
    // They are 1 mm apart and grow by 1 mm, so they overlap over the 1 mm gap plus the corners.
    // 2 * exact minus the shared middle band (1 mm wide, 12 mm tall) is the ceiling.
    const merged = regionArea(dilate(near, mm, 64)) / 1e12;
    expect(merged).toBeLessThan(2 * exact);
    expect(merged).toBeGreaterThan(2 * exact - 12 - Math.PI);
  });

  test("a negative radius and a coarse disc are rejected", () => {
    expect(() => dilate(square, -1)).toThrow(GeometryError);
    expect(() => dilate(square, 1, 6)).toThrow(GeometryError);
    expect(() => dilate(square, 1, 16.5)).toThrow(GeometryError);
  });
});

describe("erode", () => {
  test("shrinking a square keeps sharp corners, so it removes at least the requested band", () => {
    const square = [rect(0, 0, 10 * mm, 10 * mm)];
    const shrunk = erode(square, mm, 32);
    const exact = 64;
    expect(shrunk).toHaveLength(1);
    // The tool is circumscribed, so each side is pushed back by r * sec(pi / segments).
    const guaranteed = (10 - 2 * sec(32)) ** 2;
    expect(regionArea(shrunk) / 1e12).toBeLessThanOrEqual(exact);
    expect(relativeError(regionArea(shrunk) / 1e12, guaranteed)).toBeLessThan(1e-6);
    expect(bounds(shrunk[0]!)).toEqual({
      min_x_nm: Math.round(mm * sec(32)),
      min_y_nm: Math.round(mm * sec(32)),
      max_x_nm: Math.round(10 * mm - mm * sec(32)),
      max_y_nm: Math.round(10 * mm - mm * sec(32)),
    });
  });

  test("a finer disc converges to the requested erosion", () => {
    const square = [rect(0, 0, 10 * mm, 10 * mm)];
    const coarse = regionArea(erode(square, mm, 8)) / 1e12;
    const fine = regionArea(erode(square, mm, 4096)) / 1e12;
    expect(fine).toBeGreaterThan(coarse);
    expect(relativeError(fine, 64)).toBeLessThan(1e-3);
  });

  test("eroding a thin strip by more than half its width removes it", () => {
    const strip = [rect(0, 0, mm, 20 * mm)];
    expect(erode(strip, 2 * mm, 32)).toEqual([]);
  });

  test("eroding by exactly half the width leaves a line, which has no area and disappears", () => {
    const strip = [rect(0, 0, mm, 20 * mm)];
    expect(regionArea(erode(strip, mm / 2, 32))).toBe(0);
  });

  test("an empty region stays empty", () => {
    expect(erode([], mm)).toEqual([]);
  });

  test("a negative radius is rejected", () => {
    expect(() => erode([rect(0, 0, 10, 10)], -1)).toThrow(GeometryError);
  });

  test("a hole grows outwards while the outer edge moves inwards", () => {
    const ring = difference([rect(0, 0, 20 * mm, 20 * mm)], [rect(5 * mm, 5 * mm, 15 * mm, 15 * mm)]);
    const thinner = erode(ring, mm, 256);
    // The outer 20 becomes an 18 square (324, sharp corners); the 10 hole becomes a 12 square whose
    // convex corners are rounded by the tool, so it takes (4 - pi) less than 144.
    const exact = 324 - (144 - (4 - Math.PI));
    expect(relativeError(regionArea(thinner) / 1e12, exact)).toBeLessThan(1e-3);
  });
});

describe("offset round trip", () => {
  test("dilate then erode never grows the region", () => {
    const square = [rect(0, 0, 10 * mm, 10 * mm)];
    for (const segments of [16, 64]) {
      const back = offset(offset(square, 2 * mm, segments), -2 * mm, segments);
      expect(regionArea(back)).toBeLessThanOrEqual(regionArea(square));
      // The loss is the tool's circumscribed excess applied twice, i.e. a fraction of a percent.
      expect(regionArea(back)).toBeGreaterThan(regionArea(square) * 0.99);
    }
  });

  test("erode then dilate never adds copper and converges to losing only the four corners", () => {
    const square = [rect(0, 0, 20 * mm, 20 * mm)];
    const back = offset(offset(square, -3 * mm, 1024), 3 * mm, 1024);
    expect(regionArea(back)).toBeLessThanOrEqual(regionArea(square));
    // An opening replaces each square corner with a quarter disc of the tool: exactly (4 - pi) r^2
    // less copper. That loss is the definition of the operation, not an error term.
    const lost = regionArea(square) - regionArea(back);
    expect(relativeError(lost, (4 - Math.PI) * (3 * mm) ** 2)).toBeLessThan(1e-3);
  });

  test("a zero delta normalizes", () => {
    const square = [rect(0, 0, 10 * mm, 10 * mm)];
    expect(offset(square, 0)).toEqual(union(square));
  });
});

describe("clearance around primitives", () => {
  const radius = 200_000;
  const clearance = 100_000;

  test("growing a trace capsule by a clearance is the capsule with the summed radius", () => {
    const trace: Region = [capsule({ x_nm: 0, y_nm: 0 }, { x_nm: 10 * mm, y_nm: 0 }, radius, 128)];
    const grown = dilate(trace, clearance, 128);
    const direct = capsule({ x_nm: 0, y_nm: 0 }, { x_nm: 10 * mm, y_nm: 0 }, radius + clearance, 128);
    expect(grown).toHaveLength(1);
    expect(relativeError(regionArea(grown), regionArea([direct]))).toBeLessThan(1e-3);
  });

  test("a round pad grown by a clearance is a bigger round pad", () => {
    // `circle` is inscribed, so the pad itself is already short of pi r squared by the usual
    // polygon factor; growing cannot recover that, and the test states it instead of hiding it.
    const pad: Region = [circle({ x_nm: 0, y_nm: 0 }, mm, 128)];
    const grown = dilate(pad, 500_000, 128);
    const ideal = Math.PI * (1.5 * mm) ** 2;
    const inscribed = (128 / (2 * Math.PI)) * Math.sin((2 * Math.PI) / 128);
    expect(relativeError(regionArea(grown), ideal)).toBeLessThan(1 - inscribed + 1e-3);
  });
});

describe("clearance subtraction", () => {
  test("removing a clearance band around an obstacle leaves a hole with exact geometry", () => {
    const pour = [rect(0, 0, 20 * mm, 20 * mm)];
    const obstacle = [rect(8 * mm, 8 * mm, 12 * mm, 12 * mm)];
    const clearance = 500_000;
    const blocked = dilate(obstacle, clearance, 4096);
    const filled = difference(pour, blocked);
    // 4x4 pad, 4 mm of pad perimeter grown by 0.5 mm, plus the four round corners.
    const exact = 16 + 8 + Math.PI * 0.25;
    expect(relativeError(regionArea(blocked) / 1e12, exact)).toBeLessThan(1e-3);
    expect(regionArea(filled)).toBe(regionArea(pour) - regionArea(blocked));
    expect(intersection(filled, blocked)).toEqual([]);
    // The hole is surrounded, so the pour is a ring of pieces, not a holed polygon.
    expect(filled.length).toBeGreaterThanOrEqual(4);
  });

  test("subtracting clearances from a pour is additive across obstacles", () => {
    const pour = [rect(0, 0, 20 * mm, 20 * mm)];
    const first = [rect(2 * mm, 2 * mm, 4 * mm, 4 * mm)];
    const second = [rect(14 * mm, 14 * mm, 16 * mm, 16 * mm)];
    const clearance = 300_000;
    const together = difference(pour, dilate(first, clearance, 4096), dilate(second, clearance, 4096));
    const oneByOne = difference(difference(pour, dilate(first, clearance, 4096)), dilate(second, clearance, 4096));
    expect(regionArea(together)).toBe(regionArea(oneByOne));
    expect(together).toEqual(oneByOne);
  });
});

describe("concave outlines", () => {
  // An L is the smallest outline that is not convex, and it is what a real pour looks like: the
  // vertical decomposition that a boolean already uses is the only thing that makes it offsettable.
  const l: Polygon = [
    { x_nm: 0, y_nm: 0 },
    { x_nm: 40 * mm, y_nm: 0 },
    { x_nm: 40 * mm, y_nm: 10 * mm },
    { x_nm: 10 * mm, y_nm: 10 * mm },
    { x_nm: 10 * mm, y_nm: 30 * mm },
    { x_nm: 0, y_nm: 30 * mm },
  ];
  const area = 600;
  const perimeter = 140;

  test("a concave outline grows by the Steiner term of its whole boundary", () => {
    const grown = dilate([l], mm, 64);
    // area + perimeter * r + pi * r^2, independent of how many pieces the cover has.
    const exact = area + perimeter + Math.PI;
    expect(relativeError(regionArea(grown) / 1e12, exact)).toBeLessThan(2e-3);
  });

  test("growth rounds the reflex corner too, so the notch closes by less than a square", () => {
    const grown = dilate([l], mm, 64);
    // 0.5 mm from the reflex corner is within one clearance of the copper.
    expect(contains(grown, { x_nm: 10.5 * mm, y_nm: 10.5 * mm })).toBe(true);
    // 2 mm into the notch is more than one radius away from any copper.
    expect(contains(grown, { x_nm: 12 * mm, y_nm: 12 * mm })).toBe(false);
  });

  test("a concave outline shrinks without carving itself along the cover's interior edges", () => {
    const shrunk = erode([l], mm, 64);
    expect(regionArea(shrunk)).toBeLessThan(regionArea([l]));
    // The definition, sampled on a half-millimetre grid: nothing closer than the radius to the
    // outline may survive. The grid is offset by half a step so it never lands exactly on the edges,
    // where distance is 0 and the definition says nothing.
    let sampled = 0;
    for (let x = 0.25; x < 40; x += 0.5) {
      for (let y = 0.25; y < 30; y += 0.5) {
        const point = { x_nm: x * mm, y_nm: y * mm };
        const distance = pointPolygonDistance(l, point);
        if (distance === 0 || distance > mm) continue;
        sampled += 1;
        expect(contains(shrunk, point)).toBe(false);
      }
    }
    expect(sampled).toBeGreaterThan(100);
  });
});

describe("determinism", () => {
  const square: Region = [rect(0, 0, 10 * mm, 10 * mm)];

  test("the same call twice produces the same bytes", () => {
    expect(JSON.stringify(dilate(square, mm, 32))).toBe(JSON.stringify(dilate(square, mm, 32)));
    expect(JSON.stringify(erode(square, mm, 32))).toBe(JSON.stringify(erode(square, mm, 32)));
  });

  test("operand order does not change a dilation of a multi-piece region", () => {
    const a = rect(0, 0, 10 * mm, 10 * mm);
    const b = rect(11 * mm, 0, 21 * mm, 10 * mm);
    expect(dilate([a, b], mm, 32)).toEqual(dilate([b, a], mm, 32));
  });

  test("segments are part of the identity, so two counts are different geometry", () => {
    const coarse = dilate(square, mm, 8);
    const fine = dilate(square, mm, 64);
    expect(regionArea(coarse)).not.toBe(regionArea(fine));
  });
});

describe("cost on the fill-shaped workload", () => {
  test("a pour minus many obstacles stays fast because each cut is box-pruned", () => {
    const pour: Polygon = rect(0, 0, 40 * mm, 40 * mm);
    const obstacles: Polygon[] = [];
    for (let i = 0; i < 60; i += 1) {
      const x = (i % 10) * 3.5 * mm + mm;
      const y = Math.floor(i / 10) * 8 * mm + 2 * mm;
      obstacles.push(rect(x, y, x + mm, y + mm));
    }
    const started = performance.now();
    const blocked = dilate(obstacles, 250_000, 32);
    const filled = difference([pour], blocked);
    const elapsed = performance.now() - started;
    expect(filled.length).toBeGreaterThan(10);
    expect(regionArea(filled)).toBeLessThan(regionArea([pour]));
    expect(elapsed).toBeLessThan(5000);
  });
});
