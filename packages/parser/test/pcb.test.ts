// `pcb` description → IR: only tests the "text → structure" layer (spec/pcb.md §1–§6).
// Cross-description consistency (whether a pad belongs to the same net) belongs to binding validation, which is not tested here.
import { describe, expect, test } from "bun:test";
import { parsePcb } from "../src/pcb.ts";

const valid = `version 0.7
pcb main
board_thickness 1.6mm

stackup
  F.Cu       copper     0.035mm  signal
  core       dielectric 1.530mm  FR4 4.3
  B.Cu       copper     0.035mm  signal

outline
  0.0 0.0
  40.0 0.0
  40.0 30.0
  0.0 30.0

place
  U1     12.0 12.0  0    top
  C1     18.0 12.0  90   bottom

connect
  U1.4  C1.1

rules
  clearance  0.2mm
  width      0.25mm
  via        0.6mm  0.3mm
  diff       USB_DP  USB_DN  90Ω  0.2mm
  match      USB_DP  USB_DN  0.5mm
  paste      0.9  -0.02mm
  thermal    0.25mm  0.4mm
  min_width  0.15mm
`;

const parse = (text: string, board = "main") => parsePcb(text, { file: "pcb/main.teda", board });

const codes = (text: string, board = "main") => parse(text, board).diagnostics.map((d) => d.code);

describe("complete file", () => {
  test("compiles an IR aligned with the schema", () => {
    const result = parse(valid);
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const ir = result.ir!;
    expect(ir.board).toBe("main");
    expect(ir.format).toBe("0.7");
    expect(ir.board_thickness_nm).toBe(1_600_000);
    expect(ir.stackup).toHaveLength(3);
    expect(ir.stackup[1]).toEqual({
      type: "dielectric",
      layer: "core",
      thickness_nm: 1_530_000,
      material: "FR4",
      er_ppm: 4_300_000,
    });
    expect(ir.place.map((item) => item.instance_id)).toEqual(["C1", "U1"]);
    expect(ir.place[1]).toEqual({
      instance_id: "U1",
      x_nm: 12_000_000,
      y_nm: 12_000_000,
      rot_mdeg: 0,
      side: "top",
    });
    expect(ir.connect).toEqual([{ a: "C1.1", b: "U1.4" }]);
    expect(ir.rules).toContainEqual({ type: "diff", net_a: "USB_DP", net_b: "USB_DN", impedance_mohm: 90_000, gap_nm: 200_000 });
    expect(ir.rules).toContainEqual({ type: "paste", ratio_ppm: 900_000, offset_nm: -20_000 });
  });

  test("row order and member order do not affect IR bytes", () => {
    const shuffled = valid
      .replace("  U1     12.0 12.0  0    top\n  C1     18.0 12.0  90   bottom", "  C1     18.0 12.0  90   bottom\n  U1     12.0 12.0  0    top");
    expect(JSON.stringify(parse(shuffled).ir)).toBe(JSON.stringify(parse(valid).ir));
  });

  test("board outline normalization: start rotated to the lexicographically smallest vertex, direction unified to positive", () => {
    const reversed = valid.replace(
      "  0.0 0.0\n  40.0 0.0\n  40.0 30.0\n  0.0 30.0",
      "  0.0 30.0\n  40.0 30.0\n  40.0 0.0\n  0.0 0.0",
    );
    expect(parse(reversed).ir!.outline).toEqual([
      { x_nm: 0, y_nm: 0 },
      { x_nm: 40_000_000, y_nm: 0 },
      { x_nm: 40_000_000, y_nm: 30_000_000 },
      { x_nm: 0, y_nm: 30_000_000 },
    ]);
  });
});

describe("optional sections", () => {
  test("trace / via / zone / keepout / silk / physical_only / deviation", () => {
    const text = `${valid}
trace
  VBUS  F.Cu  0.5mm  8.0 6.0  12.0 6.0
via
  GND   20.0 14.0 0.6mm 0.3mm
zone
  GND  B.Cu  0.0 0.0  40.0 0.0  40.0 30.0
keepout
  no_place  F.Cu  30.0 20.0  38.0 20.0  38.0 26.0
silk
  refdes  F.SilkS  1.0mm  show
physical_only
  H1  mounting  5  5   3.2mm  2.5mm
  S1  stitching 10 30  VBUS   0.6mm  0.3mm
deviation
  net_tie  VBUS  VBUS_RAW
`;
    const ir = parse(text).ir!;
    expect(ir.trace![0]!.points).toEqual([
      { x_nm: 8_000_000, y_nm: 6_000_000 },
      { x_nm: 12_000_000, y_nm: 6_000_000 },
    ]);
    expect(ir.via![0]).toEqual({ net: "GND", x_nm: 20_000_000, y_nm: 14_000_000, size_nm: 600_000, drill_nm: 300_000 });
    expect(ir.zone![0]!.points).toHaveLength(3);
    expect(ir.keepout![0]!.type).toBe("no_place");
    expect(ir.silk).toEqual([{ item: "refdes", layer: "F.SilkS", size_nm: 1_000_000, mode: "show" }]);
    expect(ir.physical_only).toEqual([
      { type: "mounting", id: "H1", x_nm: 5_000_000, y_nm: 5_000_000, size_nm: 3_200_000, drill_nm: 2_500_000 },
      {
        type: "stitching",
        id: "S1",
        x_nm: 10_000_000,
        y_nm: 30_000_000,
        net: "VBUS",
        size_nm: 600_000,
        drill_nm: 300_000,
      },
    ]);
    expect(ir.deviation).toEqual([{ type: "net_tie", net_a: "VBUS", net_b: "VBUS_RAW" }]);
  });

  test("the retired test_point form is rejected as an unknown physical entity type", () => {
    // A test point is a one-pin device in the schematic (ADR-0035 D8/D9), not a pcb entity.
    const result = parse(`${valid}
physical_only
  TP1 test_point VBUS  1.0mm
`);
    expect(result.diagnostics.map((d) => d.code)).toContain("value.unknown-pcb-type");
    expect(result.ir?.physical_only).toBeUndefined();
  });

  test("a physical entity row without a position is a short row", () => {
    const result = parse(`${valid}
physical_only
  H1 mounting 3.2mm 2.5mm
`);
    expect(result.diagnostics.map((d) => d.code)).toContain("syntax.row-too-short");
  });

  test("same section repeated: rows are concatenated in order of appearance", () => {
    const result = parse(`${valid}
trace
  A  F.Cu  0.3mm  1.0 1.0  2.0 1.0
trace
  B  F.Cu  0.3mm  3.0 1.0  4.0 1.0
`);
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.ir!.trace!.map((t) => t.net)).toEqual(["A", "B"]);
  });

  test("silk text height below 0.5mm produces a warning", () => {
    const result = parse(`${valid}\nsilk\n  value  F.SilkS  0.4mm  hide\n`);
    expect(result.diagnostics.map((d) => d.code)).toContain("drc.silk-small");
    expect(result.ok).toBe(true);
  });
});

describe("errors", () => {
  test("id does not match the board", () => {
    expect(codes(valid, "other")).toContain("ref.pcb-id-mismatch");
  });

  test("missing required section", () => {
    expect(codes(valid.replace(/rules\n  clearance.*\n/g, ""))).toContain("syntax.unknown-section");
  });

  test("board thickness does not match the sum of stackup thicknesses", () => {
    expect(codes(valid.replace("board_thickness 1.6mm", "board_thickness 2.0mm"))).toContain("value.thickness-mismatch");
  });

  test("board outline self-intersects", () => {
    const self = valid.replace(
      "  0.0 0.0\n  40.0 0.0\n  40.0 30.0\n  0.0 30.0",
      "  0.0 0.0\n  40.0 30.0\n  40.0 0.0\n  0.0 30.0",
    );
    expect(codes(self)).toContain("value.outline-invalid");
  });

  test("same instance placed twice", () => {
    expect(codes(valid.replace("  C1     18.0 12.0  90   bottom", "  U1     18.0 12.0  90   bottom"))).toContain("value.duplicate-instance");
  });

  test("unknown rule type / unknown section / wrong column count", () => {
    expect(codes(valid.replace("  clearance  0.2mm", "  clearancex  0.2mm"))).toContain("value.unknown-pcb-type");
    // An unknown section outside any section is reported as unknown-section; an unknown row inside a section is an "unknown rule/type".
    expect(codes(valid.replace("stackup\n", "frobnicate\n"))).toContain("syntax.unknown-section");
    expect(codes(`${valid}\nfrobnicate\n  1 2\n`)).toContain("value.unknown-pcb-type");
    expect(codes(valid.replace("  clearance  0.2mm", "  clearance  0.2mm  0.3mm"))).toContain("syntax.column-count");
  });

  test("stackup order: first and last entries must be copper layers", () => {
    const bad = valid.replace("  B.Cu       copper     0.035mm  signal", "  prepreg2   dielectric 0.035mm  FR4");
    expect(codes(bad)).toContain("value.layer-order");
  });

  test("inner layer numbering must be consecutive", () => {
    const bad = valid.replace("  F.Cu       copper     0.035mm  signal", "  F.Cu       copper     0.035mm  signal\n  In2.Cu     copper     0.035mm  signal\n  prepreg_x  dielectric 0.035mm  FR4");
    expect(codes(bad.replace("board_thickness 1.6mm", "board_thickness 1.705mm"))).toContain("value.layer-order");
  });
});
