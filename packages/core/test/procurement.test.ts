// Unit tests for the procurement rules (`spec/procurement.md` §3, ADR-0030).
//
// The facts are given directly: the rules are pure, so the tests do not need a project on disk.
import { describe, expect, test } from "bun:test";
import {
  buildBomLines,
  checkProcurement,
  type DesignLine,
  type Device,
  type ProcurementFacts,
  type Selection,
} from "../src/procurement/rules.ts";

/** A generic: a 0402 thick-film resistor class. */
const generic: Device = {
  id: "res-thick-0402",
  kind: "generic",
  footprint: "project:chip-0402",
  ratings: {},
  params: [
    { name: "value", type: "resistance" },
    { name: "tolerance", type: "percent" },
  ],
};

/** A part: 10 kΩ ±1%. */
const part: Device = {
  id: "rc0402fr-0710kl",
  kind: "part",
  mpn: "RC0402FR-0710KL",
  footprint: "project:chip-0402",
  ratings: {
    value: { type: "resistance", value: 10_000_000_000 },
    tolerance: { type: "percent", value: 10_000 },
  },
  params: [],
};

const devices = new Map<string, Device>([
  [generic.id, generic],
  [part.id, part],
]);

/** One design line: 10 kΩ ±1%. */
function line(overrides: Partial<DesignLine> = {}): DesignLine {
  return {
    component: "res-thick-0402",
    params: { value: 10_000_000_000, tolerance: 10_000 },
    instances: ["R1"],
    location: { file: "design/sch/b.teda", line: 10, col: 1 },
    ...overrides,
  };
}

/** One selection row. */
function selection(overrides: Partial<Selection> = {}): Selection {
  return {
    generic: "res-thick-0402",
    params: { value: 10_000_000_000, tolerance: 10_000 },
    part: "rc0402fr-0710kl",
    role: "primary",
    location: { file: "assets/procurement/primary/b.teda", line: 8, col: 1 },
    ...overrides,
  };
}

function facts(overrides: Partial<ProcurementFacts> = {}): ProcurementFacts {
  return {
    lines: [line()],
    selections: [selection()],
    devices,
    ...overrides,
  };
}

describe("procurement rules", () => {
  test("a selection that satisfies the line is clean", () => {
    expect(checkProcurement(facts())).toEqual([]);
  });

  test("a part that is not a part is refused", () => {
    const result = checkProcurement(facts({ selections: [selection({ part: "res-thick-0402" })] }));
    expect(result.map((d) => d.code)).toEqual(["value.procurement-part-invalid"]);
  });

  test("a generic that is not a generic is refused", () => {
    const result = checkProcurement(facts({ selections: [selection({ generic: "rc0402fr-0710kl" })] }));
    expect(result[0]!.code).toBe("value.procurement-generic-invalid");
  });

  test("a part without a part number is refused", () => {
    const { mpn: _mpn, ...rest } = part;
    const withoutMpn: Device = rest;
    const result = checkProcurement(
      facts({ devices: new Map(devices).set(part.id, withoutMpn) }),
    );
    expect(result.map((d) => d.code)).toEqual(["value.procurement-part-mpn-missing"]);
  });

  test("a part with another land pattern is refused", () => {
    const otherFootprint: Device = { ...part, footprint: "project:chip-0603" };
    const result = checkProcurement(
      facts({ devices: new Map(devices).set(part.id, otherFootprint) }),
    );
    expect(result.map((d) => d.code)).toEqual(["bind.procurement-footprint-mismatch"]);
  });

  test("a part that does not state the required ratings is refused", () => {
    const noRatings: Device = { ...part, ratings: {} };
    const result = checkProcurement(facts({ devices: new Map(devices).set(part.id, noRatings) }));
    expect(result.map((d) => d.code)).toEqual(["value.procurement-ratings-missing"]);
  });

  test("a part with a wider tolerance than the line does not qualify", () => {
    const wider: Device = {
      ...part,
      ratings: { ...part.ratings, tolerance: { type: "percent", value: 20_000 } },
    };
    const result = checkProcurement(facts({ devices: new Map(devices).set(part.id, wider) }));
    expect(result.map((d) => d.code)).toEqual([
      "value.procurement-part-unsuitable",
      "value.procurement-part-unsuitable",
    ]);
    expect(result[0]!.message).toContain("worst case");
    expect(result[1]!.message).toContain("tolerance");
  });

  test("a part with a tighter tolerance qualifies", () => {
    const tighter: Device = {
      ...part,
      ratings: { ...part.ratings, tolerance: { type: "percent", value: 5_000 } },
    };
    const result = checkProcurement(facts({ devices: new Map(devices).set(part.id, tighter) }));
    expect(result).toEqual([]);
  });

  test("a part whose nominal value drifts out of the envelope does not qualify", () => {
    const drifting: Device = {
      ...part,
      ratings: { ...part.ratings, value: { type: "resistance", value: 10_100_000_000 } },
    };
    const result = checkProcurement(facts({ devices: new Map(devices).set(part.id, drifting) }));
    expect(result.map((d) => d.code)).toEqual(["value.procurement-part-unsuitable"]);
  });

  test("a broken row is an error in the primary and a warning in the alternatives", () => {
    const primary = checkProcurement(
      facts({ selections: [selection({ part: "no-such-part" })] }),
    );
    expect(primary.map((d) => d.severity)).toEqual(["error"]);
    const alternatives = checkProcurement(
      facts({ selections: [selection({ part: "no-such-part", role: "alternatives" })] }),
    );
    // The unknown part and the line the alternatives leave unsourced: both warnings.
    expect(alternatives.map((d) => d.severity)).toEqual(["warning", "warning"]);
  });

  test("a line nobody sourced is a warning, not an error", () => {
    const result = checkProcurement(facts({ selections: [] }));
    expect(result.map((d) => d.code)).toEqual(["value.procurement-generic-unsourced"]);
    expect(result[0]!.severity).toBe("warning");
  });

  test("a line marked not-required is not an unsourced line", () => {
    const result = checkProcurement(facts({ selections: [selection({ part: null })] }));
    expect(result).toEqual([]);
  });

  test("a selection for a line the design does not use is a warning", () => {
    const result = checkProcurement(
      facts({ lines: [], selections: [selection()] }),
    );
    expect(result.map((d) => d.code)).toEqual(["value.procurement-part-unused"]);
    expect(result[0]!.severity).toBe("warning");
  });

  test("the alternatives file does not source a line", () => {
    const result = checkProcurement(
      facts({ selections: [selection({ role: "alternatives" })] }),
    );
    expect(result.map((d) => d.code)).toEqual(["value.procurement-generic-unsourced"]);
  });
});

describe("the bill of materials", () => {
  test("a generic line with a selection carries the part's number", () => {
    const rows = buildBomLines(facts());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      component: "res-thick-0402",
      mpn: "RC0402FR-0710KL",
      status: "bought",
      part: "rc0402fr-0710kl",
      quantity: 1,
    });
  });

  test("a line nobody sourced carries no part number", () => {
    const rows = buildBomLines(facts({ selections: [] }));
    expect(rows[0]).toMatchObject({ mpn: "", status: "unsourced" });
  });

  test("a line marked not-required carries no part number and says so", () => {
    const rows = buildBomLines(facts({ selections: [selection({ part: null })] }));
    expect(rows[0]).toMatchObject({ mpn: "", status: "not-required" });
  });

  test("the quantity counts the instances of the line", () => {
    const rows = buildBomLines(facts({ lines: [line({ instances: ["R1", "R2"] })] }));
    expect(rows[0]!.quantity).toBe(2);
  });

  test("two lines of the same device with different values are two rows", () => {
    const rows = buildBomLines(
      facts({
        lines: [
          line({ params: { value: 10_000_000_000, tolerance: 10_000 }, instances: ["R1"] }),
          line({ params: { value: 10_000_000_000, tolerance: 20_000 }, instances: ["R2"] }),
        ],
      }),
    );
    expect(rows).toHaveLength(2);
  });
});
