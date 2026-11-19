import { describe, expect, test } from "bun:test";
import { irVersion } from "@texteda/ir";
import type { Pcb } from "@texteda/ir/pcb";
import { checkCurrentTraceWidths } from "../src/index.ts";

const pcb: Pcb = {
  ir_version: irVersion,
  format: "0.19",
  pcb: "main",
  modules: ["M1"],
  board_thickness_nm: 70_000,
  stackup: [
    { type: "copper", layer: "F.Cu", thickness_nm: 35_000, kind: "signal" },
    { type: "copper", layer: "B.Cu", thickness_nm: 35_000, kind: "signal" },
  ],
  outline: [
    { x_nm: 0, y_nm: 0 },
    { x_nm: 1_000_000, y_nm: 0 },
    { x_nm: 1_000_000, y_nm: 1_000_000 },
  ],
  place: [],
  connect: [],
  trace: [
    { net: "VBUS", layer: "F.Cu", width_nm: 499_999, points: [{ x_nm: 0, y_nm: 0 }, { x_nm: 1, y_nm: 1 }] },
    { net: "VBUS", layer: "F.Cu", width_nm: 500_000, points: [{ x_nm: 0, y_nm: 2 }, { x_nm: 1, y_nm: 3 }] },
    { net: "VBUS", layer: "B.Cu", width_nm: 750_000, points: [{ x_nm: 0, y_nm: 4 }, { x_nm: 1, y_nm: 5 }] },
    { net: "GND", layer: "F.Cu", width_nm: 100_000, points: [{ x_nm: 0, y_nm: 6 }, { x_nm: 1, y_nm: 7 }] },
  ],
  via: [{ net: "VBUS", x_nm: 100_000, y_nm: 200_000, size_nm: 600_000, drill_nm: 300_000 }],
  zone: [{ net: "VBUS", layer: "B.Cu", points: [{ x_nm: 0, y_nm: 0 }, { x_nm: 1, y_nm: 0 }, { x_nm: 1, y_nm: 1 }] }],
  rules: [{ type: "current", net: "VBUS", max_na: 3_000_000_000, min_width_nm: 500_000, source: "docs/power-budget.md#vbus" }],
};

describe("PCB current trace-width checks", () => {
  test("errors only below the declared minimum and reports the trace-only boundary", () => {
    const diagnostics = checkCurrentTraceWidths({
      file: "design/pcb/main.teda",
      pcb,
      locate: (path) => ({ file: "design/pcb/main.teda", line: path === "/trace/0" ? 21 : 40, col: 3 }),
    });
    const errors = diagnostics.filter((item) => item.code === "drc.current-trace-width");
    expect(errors).toHaveLength(1);
    expect(errors[0]!.location).toEqual({ file: "design/pcb/main.teda", line: 21, col: 3 });
    expect(errors[0]!.data).toMatchObject({ net: "VBUS", width_nm: 499_999, min_width_nm: 500_000 });
    expect(errors[0]!.message).toContain("declares 0.499999mm, below the current rule minimum 0.5mm");

    const note = diagnostics.find((item) => item.code === "drc.current-trace-only");
    expect(note?.severity).toBe("note");
    expect(note?.message).toContain("does not verify geometric current capacity or branch-current distribution");
    expect(note?.message).toContain("1 same-net via");
    expect(note?.message).toContain("1 same-net zone");
    expect(note?.data).toMatchObject({ traces_checked: 3, vias_unchecked: 1, zones_unchecked: 1, source: "docs/power-budget.md#vbus" });
  });

  test("counts physical-only stitching vias in the unchecked capacity report", () => {
    const diagnostics = checkCurrentTraceWidths({
      file: "design/pcb/main.teda",
      pcb: {
        ...pcb,
        trace: [],
        via: [],
        zone: [],
        physical_only: [
          { id: "S1", type: "stitching", net: "VBUS", x_nm: 250_000, y_nm: 500_000, size_nm: 600_000, drill_nm: 300_000 },
          { id: "S2", type: "stitching", net: "GND", x_nm: 250_000, y_nm: 750_000, size_nm: 600_000, drill_nm: 300_000 },
        ],
      },
    });
    const note = diagnostics[0]!;
    expect(note.code).toBe("drc.current-trace-only");
    expect(note.message).toContain("1 same-net via(s), including 1 stitching via(s)");
    expect(note.message).toContain("[0.25mm,0.5mm]");
    expect(note.data).toMatchObject({ vias_unchecked: 1, stitching_vias_unchecked: 1 });
  });

  test("a current rule with no trace still reports that no trace width was checked", () => {
    const diagnostics = checkCurrentTraceWidths({
      file: "design/pcb/main.teda",
      pcb: { ...pcb, trace: [], via: [], zone: [] },
    });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.code).toBe("drc.current-trace-only");
    expect(diagnostics[0]!.message).toContain("checked 0 matching trace declaration(s) only");
  });
});
