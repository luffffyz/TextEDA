// Constraint agreement: one net states one window, and the root and the module may not say it
// twice with different values (ADR-0041 D1: one fact, one house).
import { irVersion } from "@texteda/ir";
import { describe, expect, test } from "bun:test";
import { checkConstraintAgreement } from "../src/index.ts";
import type { Schematic } from "@texteda/ir/schematic";

function board(constraints: Schematic["constraints"]): Schematic {
  return {
    ir_version: irVersion,
    format: "0.19",
    project: "main",
    modules: [],
    instances: [],
    nets: [{ id: "VOUT", members: [] }],
    constraints: constraints ?? [],
  };
}

const VOLTAGE = (subject: string, min_uv: number, max_uv: number) =>
  ({ type: "voltage", subject, min_uv, max_uv }) as NonNullable<Schematic["constraints"]>[number];

const CURRENT = (subject: string, max_na: number) =>
  ({ type: "current", subject, max_na }) as NonNullable<Schematic["constraints"]>[number];

const POWER = (subject: string, max_uw: number) =>
  ({ type: "power", subject, max_uw }) as NonNullable<Schematic["constraints"]>[number];

describe("one net, one window", () => {
  test("the same window declared twice is a note, and it names both places", () => {
    const diagnostics = checkConstraintAgreement({
      file: "design/sch/main.teda",
      schematic: board([VOLTAGE("VOUT", 4_500_000, 5_500_000), VOLTAGE("VOUT", 4_500_000, 5_500_000)]),
      locateConstraint: (index) => ({
        file: index === 0 ? "design/sch/main.teda" : "design/sch/modules/mcu-board.teda",
        line: 47 + index,
        col: 3,
      }),
    });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.code).toBe("net.constraint-duplicate");
    expect(diagnostics[0]!.severity).toBe("note");
    expect(diagnostics[0]!.message).toContain("net VOUT states its window (4.5V..5.5V) 2 times");
    expect(diagnostics[0]!.location?.file).toBe("design/sch/main.teda");
    expect(diagnostics[0]!.related?.[0]?.file).toBe("design/sch/modules/mcu-board.teda");
  });

  test("two different windows on one net are an error", () => {
    const diagnostics = checkConstraintAgreement({
      file: "design/sch/main.teda",
      schematic: board([VOLTAGE("VOUT", 4_500_000, 5_500_000), VOLTAGE("VOUT", 4_000_000, 5_600_000)]),
    });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.code).toBe("net.constraint-conflict");
    expect(diagnostics[0]!.severity).toBe("error");
    expect(diagnostics[0]!.message).toContain("net VOUT is given 2 different windows");
    expect(diagnostics[0]!.message).toContain("4.5V..5.5V");
    expect(diagnostics[0]!.message).toContain("4V..5.6V");
  });

  test("a window and a current limit on the same net never compare with each other", () => {
    const diagnostics = checkConstraintAgreement({
      file: "design/sch/main.teda",
      schematic: board([VOLTAGE("VOUT", 4_500_000, 5_500_000), CURRENT("VOUT", 3_000_000_000)]),
    });
    expect(diagnostics).toEqual([]);
  });

  test("two power limits on one pin are legal: the tightest one applies (ADR-0026 D11)", () => {
    const diagnostics = checkConstraintAgreement({
      file: "design/sch/main.teda",
      schematic: board([POWER("R1.1", 63_000), POWER("R1.1", 100_000)]),
    });
    expect(diagnostics).toEqual([]);
  });

  test("a current limit declared twice is caught as well", () => {
    const diagnostics = checkConstraintAgreement({
      file: "design/sch/main.teda",
      schematic: board([CURRENT("VOUT", 3_000_000_000), CURRENT("VOUT", 3_000_000_000)]),
    });
    expect(diagnostics.map((d) => d.code)).toEqual(["net.constraint-duplicate"]);
    expect(diagnostics[0]!.message).toContain("net VOUT states its current limit (3A) 2 times");
  });
});
