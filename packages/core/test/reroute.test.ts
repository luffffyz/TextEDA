// The re-anchor: what a wire looks like after the symbol it belongs to has moved (ADR-0141 D5).
//
// The rules under test: the shape survives (same segments, same directions), the free coordinates
// survive, the endpoints land exactly on the pins, and a shape that cannot survive is reported.
import { describe, expect, test } from "bun:test";
import { nearestOnPath, reanchorWire, type WireCorners } from "../src/view/reroute.ts";

const MM = 1_000_000;

function at(x: number, y: number): WireCorners {
  return { x_nm: x * MM, y_nm: y * MM };
}

function wire(over: Partial<Parameters<typeof reanchorWire>[0]> = {}): Parameters<typeof reanchorWire>[0] {
  return {
    net: "GND",
    from_pin: "U1.1",
    to_pin: "U1.2",
    points: [],
    from: at(0, 0),
    to: at(10, 0),
    newFrom: at(0, 0),
    newTo: at(10, 0),
    ...over,
  };
}

describe("the re-anchor", () => {
  test("a straight wire between pins that moved together keeps its shape", () => {
    const result = reanchorWire(
      wire({
        from: at(0, 0),
        to: at(10, 0),
        newFrom: at(3, 5),
        newTo: at(13, 5),
      }),
    );
    expect(result.conflict).toBeUndefined();
    expect(result.points).toEqual([]);
  });

  test("a wire whose pins are no longer in line becomes one elbow", () => {
    const result = reanchorWire(
      wire({
        from: at(0, 0),
        to: at(10, 0),
        newFrom: at(0, 4),
        newTo: at(10, 0),
      }),
    );
    // The first leg keeps the direction the wire had (horizontal), and the elbow sits where the
    // two pins line up.
    expect(result.conflict).toBe("shape-lost");
    expect(result.points).toEqual([at(10, 4)]);
  });

  test("a staircase keeps its shape and its free coordinates", () => {
    // Down, across, down: the from-pin moves down by 2mm, the to-pin stays.
    const result = reanchorWire(
      wire({
        points: [at(0, 10), at(10, 10)],
        from: at(0, 0),
        to: at(10, 14),
        newFrom: at(0, 2),
        newTo: at(10, 14),
      }),
    );
    expect(result.conflict).toBeUndefined();
    // The first corner follows the from-pin (it shares its x); the second corner keeps the y the
    // horizontal run was drawn at and takes the to-pin's x.
    expect(result.points).toEqual([at(0, 10), at(10, 10)]);
  });

  test("the corners land exactly on the new pins", () => {
    const input = wire({
      points: [at(0, 10), at(10, 10)],
      from: at(0, 0),
      to: at(10, 14),
      newFrom: at(2, 3),
      newTo: at(12, 9),
    });
    const result = reanchorWire(input);
    const path = [input.newFrom, ...result.points, input.newTo];
    for (let i = 0; i + 1 < path.length; i += 1) {
      const a = path[i]!;
      const b = path[i + 1]!;
      const orthogonal = a.x_nm === b.x_nm || a.y_nm === b.y_nm;
      expect(orthogonal).toBe(true);
    }
  });

  test("a middle run keeps the coordinate it was drawn with", () => {
    // Down, across, down, across: the middle runs are free, so they stay where they were.
    const result = reanchorWire(
      wire({
        points: [at(0, 10), at(5, 10), at(5, 20)],
        from: at(0, 0),
        to: at(12, 20),
        newFrom: at(1, 1),
        newTo: at(13, 25),
      }),
    );
    expect(result.conflict).toBeUndefined();
    // The first corner follows the from-pin; the middle keeps the x and the y it was drawn with;
    // the last corner takes the to-pin's y, because the run that reaches the to-pin is pinned by it.
    expect(result.points).toEqual([at(1, 10), at(5, 10), at(5, 25)]);
  });

  test("a wire that was not orthogonal is rebuilt and reported", () => {
    const result = reanchorWire(
      wire({
        points: [at(3, 7)],
        from: at(0, 0),
        to: at(10, 0),
        newFrom: at(0, 0),
        newTo: at(10, 0),
      }),
    );
    expect(result.conflict).toBe("not-orthogonal");
    expect(result.points).toEqual([at(0, 0)]);
  });
});

describe("the nearest point of a drawn path", () => {
  test("a point beside the path snaps onto it", () => {
    const foot = nearestOnPath([at(0, 0), at(10, 0)], at(4, 3));
    expect(foot).toEqual(at(4, 0));
  });

  test("a point past the end of the path snaps onto the end", () => {
    const foot = nearestOnPath([at(0, 0), at(10, 0)], at(14, 3));
    expect(foot).toEqual(at(10, 0));
  });

  test("an empty path has no nearest point", () => {
    expect(nearestOnPath([], at(1, 1))).toBeUndefined();
  });
});
