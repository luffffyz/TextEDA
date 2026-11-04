// Tests for the symbol house style in scripts/lib/symbol-style.ts, which `bun run lib:verify` applies
// (ADR-0057 §1, ADR-0058 §1, §2).
// The verifier itself is an end-to-end script; these pin the two rules it must keep telling apart: a pin
// point on both axes, and the row floor that only applies to a symbol that draws its pin numbers.
import { describe, expect, test } from "bun:test";
import type { Symbol } from "@texteda/ir/symbol";
import { symbolHouseStyleProblems } from "./lib/symbol-style.ts";

type Pin = Symbol["symbol"]["pins"][number];

const pin = (number: string, x_mm: number, y_mm: number, rot: number, unit = 1): Pin => ({
  number,
  at: { x_nm: Math.round(x_mm * 1e6), y_nm: Math.round(y_mm * 1e6), rotation_mdeg: rot * 1000 },
  length_nm: 2_500_000,
  unit,
  style: "line",
});

const symbol = (pins: Pin[], numbersHidden = false): Symbol["symbol"] => ({
  name: "t",
  units: 1,
  pins,
  ...(numbersHidden ? { pin_numbers_hidden: true } : {}),
});

describe("symbol house style", () => {
  test("a 2.5 mm row anchored on the lattice passes", () => {
    expect(symbolHouseStyleProblems("t", symbol([pin("1", -12.5, -13.5, 0), pin("2", -12.5, -11, 0)]))).toEqual([]);
  });

  test("a 2.5 mm row that is not symmetric about the origin passes", () => {
    // The anchoring rule is per pin and per axis: asymmetry is not a defect, a symmetric row is a coincidence.
    expect(
      symbolHouseStyleProblems("t", symbol([pin("1", -9, -1, 0), pin("3", -9, 1.5, 0)])),
    ).toEqual([]);
  });

  test("a 2.0 mm row is reported as below the floor", () => {
    const [problem] = symbolHouseStyleProblems("t", symbol([pin("1", -9, -1, 0), pin("3", -9, 1, 0)]));
    expect(problem).toContain("pins 1/3 are 2 mm apart");
    expect(problem).toContain("the floor is 2.5 mm");
  });

  test("the floor is measured along the row, not across it", () => {
    // Two pins on opposite sides at the same y are 18 mm apart across the symbol; their rows each hold one pin.
    expect(
      symbolHouseStyleProblems("t", symbol([pin("1", -9, 0, 0), pin("4", 9, 0, 180)])),
    ).toEqual([]);
  });

  test("units are separate rows even when they share a side and a coordinate", () => {
    // Two units stacked on one side overlap in the drawing on purpose (they are different units).
    expect(
      symbolHouseStyleProblems("t", symbol([pin("2", -5, -1, 0, 1), pin("6", -5, 1.5, 0, 1), pin("5", -5, -1, 0, 2)])),
    ).toEqual([]);
  });
  test("a pin off the lattice is reported even when its numbers are hidden", () => {
    const problems = symbolHouseStyleProblems("t", symbol([pin("1", -4.25, 0, 0)], true));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("pins off the 0.5 mm lattice: 1");
  });

  test("either axis can be off the lattice", () => {
    expect(symbolHouseStyleProblems("t", symbol([pin("1", -4.25, 0, 0)]))[0]).toContain("pins off");
    expect(symbolHouseStyleProblems("t", symbol([pin("1", -4, 0.25, 0)]))[0]).toContain("pins off");
    expect(symbolHouseStyleProblems("t", symbol([pin("1", -4, -0.5, 0)]))).toEqual([]);
  });

  test("a tight pair is allowed when the symbol hides its numbers", () => {
    // sw-push: two pins per side one glyph apart, numbers hidden because at 1 mm their ink overlaps.
    expect(
      symbolHouseStyleProblems("t", symbol([pin("1", -4, -0.5, 0), pin("2", -4, 0.5, 0)], true)),
    ).toEqual([]);
    expect(symbolHouseStyleProblems("t", symbol([pin("1", -4, -0.5, 0), pin("2", -4, 0.5, 0)]))).toHaveLength(1);
  });
});
