import { describe, expect, test } from "bun:test";
import { VIEW_GRID_MM, snapPlacement } from "../src/placement.ts";

describe("view placement grid", () => {
  test("uses the 0.5 mm layout grid", () => {
    expect(VIEW_GRID_MM).toBe(0.5);
    expect(snapPlacement(123.124)).toBeCloseTo(123, 10);
    expect(snapPlacement(123.376)).toBeCloseTo(123.5, 10);
  });

  test("keeps coordinates that are already on the layout grid", () => {
    expect(snapPlacement(0)).toBe(0);
    expect(snapPlacement(120)).toBeCloseTo(120, 10);
    expect(snapPlacement(-0.5)).toBeCloseTo(-0.5, 10);
  });

  test("snaps a half-step to the nearest multiple", () => {
    expect(snapPlacement(0.2)).toBeCloseTo(0, 10);
    expect(snapPlacement(0.3)).toBeCloseTo(0.5, 10);
    expect(snapPlacement(-0.3)).toBeCloseTo(-0.5, 10);
  });
});
