// The plane geometry behind the drawing checks and metrics: the rules that are easy to get subtly
// wrong (touching vs overlapping, meeting vs crossing, parallel vs collinear).
import { describe, expect, test } from "bun:test";
import {
  boxDistance,
  boxUnion,
  boxesOverlap,
  overlapArea,
  segmentCrossing,
  segmentInBox,
} from "../src/view/geometry.ts";

const p = (x: number, y: number) => ({ x_nm: x, y_nm: y });
const box = (min_x: number, min_y: number, max_x: number, max_y: number) => ({
  min_x_nm: min_x,
  min_y_nm: min_y,
  max_x_nm: max_x,
  max_y_nm: max_y,
});

describe("boxes", () => {
  test("touching is not overlapping, but it still has zero area and zero distance", () => {
    const a = box(0, 0, 10, 10);
    const b = box(10, 0, 20, 10);
    expect(boxesOverlap(a, b)).toBe(false);
    expect(overlapArea(a, b)).toBe(0);
    expect(boxDistance(a, b)).toBe(0);
  });

  test("overlap area is the shared rectangle", () => {
    expect(overlapArea(box(0, 0, 10, 10), box(5, 5, 20, 20))).toBe(25);
  });

  test("distance is the gap on the separated axis, the diagonal when both separate", () => {
    expect(boxDistance(box(0, 0, 10, 10), box(10, 0, 20, 10))).toBe(0);
    expect(boxDistance(box(0, 0, 10, 10), box(14, 0, 20, 10))).toBe(4);
    expect(boxDistance(box(0, 0, 10, 10), box(13, 14, 20, 20))).toBe(5);
  });

  test("union spans every box", () => {
    expect(boxUnion([box(0, 0, 10, 10), box(-5, 2, 3, 30)])).toEqual(box(-5, 0, 10, 30));
    expect(boxUnion([])).toBeNull();
  });
});

describe("segments", () => {
  test("a proper crossing is found, meeting at an endpoint is not", () => {
    expect(segmentCrossing(p(0, 0), p(10, 10), p(0, 10), p(10, 0))).not.toBeNull();
    // Sharing the start point: t=0 / u=0, so this is a junction, not a crossing.
    expect(segmentCrossing(p(0, 0), p(10, 0), p(0, 0), p(0, 10))).toBeNull();
    // A T-junction: b starts on a's interior.
    expect(segmentCrossing(p(0, 0), p(10, 0), p(5, 0), p(5, 10))).toBeNull();
  });

  test("parallel and collinear runs are not crossings", () => {
    expect(segmentCrossing(p(0, 0), p(10, 0), p(0, 5), p(10, 5))).toBeNull();
    expect(segmentCrossing(p(0, 0), p(10, 0), p(5, 0), p(15, 0))).toBeNull();
  });

  test("clipping reports the slice inside a box, and a run along an edge does not enter it", () => {
    const slice = segmentInBox(p(-10, 5), p(10, 5), box(0, 0, 10, 10));
    expect(slice).not.toBeNull();
    expect(slice![0]).toBeCloseTo(0.5, 6);
    expect(slice![1]).toBeCloseTo(1, 6);
    // Along the top edge (y = 0): clipped out once the inset opens the box.
    expect(segmentInBox(p(-5, 0), p(15, 0), box(0, 0, 10, 10), 1)).toBeNull();
    // Entirely outside.
    expect(segmentInBox(p(20, 20), p(30, 30), box(0, 0, 10, 10))).toBeNull();
  });
});
