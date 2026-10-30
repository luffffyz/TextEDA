// Boolean invariants, not pictures (ADR-0018 D6): the union and the intersection cover the operands
// exactly once, the difference plus the intersection reconstructs the base, and the output of an
// operation is a disjoint cover that is byte-identical for the same geometry.
import { describe, expect, test } from "bun:test";
import {
  bounds,
  comparePolygons,
  convexCover,
  difference,
  intersection,
  isConvex,
  isSimple,
  normalize,
  overlaps,
  rect,
  regionArea,
  union,
  type Point,
  type Polygon,
  type Region,
} from "../src/index.ts";

const p = (x: number, y: number): Point => ({ x_nm: x, y_nm: y });
const mm = 1_000_000;

/** No two pieces may overlap: a false overlap would double-count, and Gerber would paint twice. */
function piecesAreDisjoint(region: Region): boolean {
  for (let i = 0; i < region.length; i += 1) {
    for (let j = i + 1; j < region.length; j += 1) {
      if (overlaps([region[i]!], [region[j]!])) return false;
    }
  }
  return true;
}

/** Deterministic pseudo-random integers; no fixture files and no randomness between runs. */
function sampler(start: number): () => number {
  let seed = start;
  return (): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed;
  };
}

function convexHull(points: Point[]): Polygon | null {
  const turn = (o: Point, a: Point, b: Point): number =>
    (a.x_nm - o.x_nm) * (b.y_nm - o.y_nm) - (a.y_nm - o.y_nm) * (b.x_nm - o.x_nm);
  const sorted = [...points].sort((left, right) => left.x_nm - right.x_nm || left.y_nm - right.y_nm);
  const lower: Point[] = [];
  for (const point of sorted) {
    while (lower.length >= 2 && turn(lower[lower.length - 2]!, lower[lower.length - 1]!, point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper: Point[] = [];
  for (const point of [...sorted].reverse()) {
    while (upper.length >= 2 && turn(upper[upper.length - 2]!, upper[upper.length - 1]!, point) <= 0) upper.pop();
    upper.push(point);
  }
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
  return hull.length >= 3 ? normalize(hull) : null;
}

/** One pseudo-random convex polygon whose vertices land on whole millimetres. */
function randomPolygon(next: () => number, span: number): Polygon | null {
  const points = Array.from({ length: 7 }, () => p((next() % span) * mm, (next() % span) * mm));
  return convexHull(points);
}

describe("union", () => {
  test("overlapping rectangles add up without double counting", () => {
    const a = [rect(0, 0, 10 * mm, 10 * mm)];
    const b = [rect(5 * mm, 0, 15 * mm, 10 * mm)];
    expect(regionArea(union(a, b))).toBe(150 * mm * mm);
    expect(piecesAreDisjoint(union(a, b))).toBe(true);
  });

  test("touching rectangles merge and keep their combined area", () => {
    const a = [rect(0, 0, 10 * mm, 10 * mm)];
    const b = [rect(10 * mm, 0, 20 * mm, 10 * mm)];
    const joined = union(a, b);
    expect(regionArea(joined)).toBe(200 * mm * mm);
    expect(piecesAreDisjoint(joined)).toBe(true);
  });

  test("disjoint rectangles stay separate and keep their own area", () => {
    const a = [rect(0, 0, 10 * mm, 10 * mm)];
    const b = [rect(20 * mm, 20 * mm, 30 * mm, 30 * mm)];
    const joined = union(a, b);
    expect(regionArea(joined)).toBe(200 * mm * mm);
    expect(joined).toHaveLength(2);
    expect(bounds(joined[0]!)).toEqual({ min_x_nm: 0, min_y_nm: 0, max_x_nm: 10 * mm, max_y_nm: 10 * mm });
  });

  test("union with an empty region is the other region", () => {
    const a = [rect(0, 0, 10 * mm, 10 * mm)];
    expect(union(a, [])).toEqual(union(a));
    expect(union([], a)).toEqual(union(a));
    expect(union([], [])).toEqual([]);
  });

  test("a region unioned with itself is unchanged", () => {
    const a = [rect(0, 0, 10 * mm, 10 * mm)];
    expect(union(a, a)).toEqual(union(a));
  });

  test("three operands equal the two-operand fold", () => {
    const a = [rect(0, 0, 10 * mm, 10 * mm)];
    const b = [rect(5 * mm, 0, 15 * mm, 10 * mm)];
    const c = [rect(5 * mm, 5 * mm, 15 * mm, 15 * mm)];
    expect(union(a, b, c)).toEqual(union(union(a, b), c));
    // a and b join into 150; c adds 100 and shares 50 with that union, so the total is 200.
    expect(regionArea(union(a, b, c))).toBe(200 * mm * mm);
  });
});

describe("intersection", () => {
  test("overlapping rectangles intersect into the shared rectangle", () => {
    const a = [rect(0, 0, 10 * mm, 10 * mm)];
    const b = [rect(5 * mm, 5 * mm, 15 * mm, 15 * mm)];
    const shared = intersection(a, b);
    expect(regionArea(shared)).toBe(25 * mm * mm);
    expect(bounds(shared[0]!)).toEqual({
      min_x_nm: 5 * mm,
      min_y_nm: 5 * mm,
      max_x_nm: 10 * mm,
      max_y_nm: 10 * mm,
    });
  });

  test("touching along an edge is not an intersection", () => {
    const a = [rect(0, 0, 10 * mm, 10 * mm)];
    const b = [rect(10 * mm, 0, 20 * mm, 10 * mm)];
    expect(intersection(a, b)).toEqual([]);
    expect(overlaps(a, b)).toBe(false);
  });

  test("a rectangle inside another intersects to itself", () => {
    const outer = [rect(0, 0, 10 * mm, 10 * mm)];
    const inner = [rect(3 * mm, 3 * mm, 7 * mm, 7 * mm)];
    expect(regionArea(intersection(outer, inner))).toBe(16 * mm * mm);
    expect(intersection(outer, inner)).toEqual(union(inner));
  });

  test("intersection with empty is empty", () => {
    const a = [rect(0, 0, 10 * mm, 10 * mm)];
    expect(intersection(a, [])).toEqual([]);
    expect(intersection([], a)).toEqual([]);
  });
});

describe("difference", () => {
  test("a corner bite leaves a cover with the right area", () => {
    const base = [rect(0, 0, 10 * mm, 10 * mm)];
    const bite = [rect(0, 0, 4 * mm, 4 * mm)];
    const cut = difference(base, bite);
    expect(regionArea(cut)).toBe(84 * mm * mm);
    expect(piecesAreDisjoint(cut)).toBe(true);
  });

  test("a hole in the middle becomes a ring of simple pieces, not a holed polygon", () => {
    const base = [rect(0, 0, 10 * mm, 10 * mm)];
    const hole = [rect(3 * mm, 3 * mm, 7 * mm, 7 * mm)];
    const cut = difference(base, hole);
    expect(regionArea(cut)).toBe(84 * mm * mm);
    expect(cut).toHaveLength(4);
    for (const piece of cut) expect(isSimple(piece)).toBe(true);
  });

  test("subtracting the base itself leaves nothing", () => {
    const a = [rect(0, 0, 10 * mm, 10 * mm)];
    expect(difference(a, a)).toEqual([]);
  });

  test("subtracting a disjoint region changes nothing", () => {
    const a = [rect(0, 0, 10 * mm, 10 * mm)];
    const far = [rect(20 * mm, 20 * mm, 30 * mm, 30 * mm)];
    expect(difference(a, far)).toEqual(union(a));
  });

  test("subtracting an empty region changes nothing", () => {
    const a = [rect(0, 0, 10 * mm, 10 * mm)];
    expect(difference(a, [])).toEqual(union(a));
  });
});

describe("area identities", () => {
  const a = [rect(0, 0, 10 * mm, 10 * mm)];
  const b = [rect(5 * mm, 2 * mm, 15 * mm, 8 * mm)];

  test("union plus intersection equals the sum of the operands", () => {
    const left = regionArea(union(a, b)) + regionArea(intersection(a, b));
    expect(left).toBe(regionArea(a) + regionArea(b));
  });

  test("difference plus intersection reconstructs the base", () => {
    expect(regionArea(difference(a, b)) + regionArea(intersection(a, b))).toBe(regionArea(a));
  });
});

describe("slanted geometry", () => {
  const triangle = [normalize([p(0, 0), p(100 * mm, 0), p(0, 100 * mm)])];

  test("a vertical strip through a triangle takes the right share", () => {
    const strip = [rect(25 * mm, 0, 50 * mm, 100 * mm)];
    // The hypotenuse is x + y = 100, so height falls from 75 to 50 across the strip: area 1562.5.
    expect(regionArea(intersection(triangle, strip))).toBe(1562.5 * mm * mm);
  });

  test("a slant cut rebuilds the base area", () => {
    const cut = [rect(50 * mm, 0, 100 * mm, 100 * mm)];
    const whole = regionArea(difference(triangle, cut)) + regionArea(intersection(triangle, cut));
    expect(whole).toBe(regionArea(triangle));
  });

  test("crossing edges produce disjoint pieces in all three modes", () => {
    const a = [normalize([p(0, 0), p(40 * mm, 0), p(40 * mm, 40 * mm), p(0, 40 * mm)])];
    const b = [normalize([p(20 * mm, -10 * mm), p(60 * mm, 20 * mm), p(20 * mm, 50 * mm), p(-20 * mm, 20 * mm)])];
    expect(piecesAreDisjoint(union(a, b))).toBe(true);
    expect(piecesAreDisjoint(intersection(a, b))).toBe(true);
    expect(piecesAreDisjoint(difference(a, b))).toBe(true);
  });
});

describe("determinism", () => {
  const a = [rect(0, 0, 10 * mm, 10 * mm)];
  const b = [rect(5 * mm, 5 * mm, 15 * mm, 15 * mm)];

  test("the same call twice produces the same bytes", () => {
    expect(JSON.stringify(union(a, b))).toBe(JSON.stringify(union(a, b)));
    expect(JSON.stringify(intersection(a, b))).toBe(JSON.stringify(intersection(a, b)));
    expect(JSON.stringify(difference(a, b))).toBe(JSON.stringify(difference(a, b)));
  });

  test("operand order does not change the result", () => {
    expect(union(a, b)).toEqual(union(b, a));
    expect(intersection(a, b)).toEqual(intersection(b, a));
  });

  test("output pieces come out in canonical order", () => {
    const many = union([rect(10, 0, 20, 10)], [rect(0, 0, 10, 10)], [rect(20, 0, 30, 10)]);
    expect(many).toEqual([...many].sort(comparePolygons));
  });

  test("vertex order inside an operand does not change the result", () => {
    const square = [p(0, 0), p(10 * mm, 0), p(10 * mm, 10 * mm), p(0, 10 * mm)];
    const rotated = [square[2]!, square[3]!, square[0]!, square[1]!];
    expect(union([normalize(rotated)])).toEqual(union([normalize(square)]));
  });
});

describe("randomized identities", () => {
  test("every trial keeps the two area identities and stays disjoint", () => {
    for (let trial = 0; trial < 40; trial += 1) {
      const leftPolygon = randomPolygon(sampler(trial * 7 + 1), 40);
      const rightPolygon = randomPolygon(sampler(trial * 7 + 4), 40);
      if (leftPolygon === null || rightPolygon === null) continue;
      const left: Region = [leftPolygon];
      const right: Region = [rightPolygon];
      const a = regionArea(left);
      const b = regionArea(right);
      const together = regionArea(union(left, right));
      const shared = regionArea(intersection(left, right));
      const cut = regionArea(difference(left, right));
      // Both identities hold up to the one-nanometre quantization of emitted vertices.
      const tolerance = Math.max(a, b) * 1e-6;
      expect(Math.abs(together + shared - (a + b))).toBeLessThan(tolerance);
      expect(Math.abs(cut + shared - a)).toBeLessThan(tolerance);
      expect(piecesAreDisjoint(union(left, right))).toBe(true);
    }
  });
});

describe("convex cover", () => {
  // Offset and area both need to distribute an operation over a union, which is only valid when every
  // piece is convex. A concave ring cannot be its own cover.
  const l: Polygon = [p(0, 0), p(40 * mm, 0), p(40 * mm, 10 * mm), p(10 * mm, 10 * mm), p(10 * mm, 30 * mm), p(0, 30 * mm)];

  test("a concave ring is cut into convex pieces that tile it exactly", () => {
    const cover = convexCover([l]);
    expect(cover.length).toBeGreaterThan(1);
    expect(cover.every((piece) => isConvex(piece))).toBe(true);
    expect(cover.reduce((sum, piece) => sum + regionArea([piece]), 0)).toBe(regionArea([l]));
    expect(piecesAreDisjoint(cover)).toBe(true);
  });

  test("a convex ring is left alone instead of being shredded", () => {
    const square = rect(0, 0, 10 * mm, 10 * mm);
    expect(convexCover([square])).toEqual([square]);
  });

  test("the cover is the same set, so either side of a difference is empty", () => {
    // Bytes differ: `union` of one polygon returns it whole, while a two-piece cover is decomposed.
    // The shape must not differ, and that is what a caller actually depends on.
    const cover = convexCover([l]);
    expect(regionArea(union(cover))).toBe(regionArea([l]));
    expect(difference(cover, [l])).toEqual([]);
    expect(difference([l], cover)).toEqual([]);
  });
});
