// Unit tests for `footprint` surface parsing.
// End-to-end (.teda → IR → KiCad → DRC/Gerber) is covered by scripts/smoke-footprint.ts.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { canonicalJson, formatDiagnostic, parseFootprint } from "../src/index.ts";

const example = readFileSync("examples/reference-project/assets/footprints/project/sot-23-5.teda", "utf8");

function parse(text: string) {
  return parseFootprint(text, { file: "x.teda", library: "project" });
}

describe("example footprint", () => {
  const result = parse(example);

  test("compiles successfully with no diagnostics", () => {
    expect(result.diagnostics.map(formatDiagnostic)).toEqual([]);
    expect(result.ok).toBe(true);
  });

  test("lengths converted to integer nanometers, ratios to parts per million", () => {
    const fp = result.ir!.footprint;
    const pad1 = fp.pads[0]!;
    expect(pad1.at).toEqual({ x_nm: -950000, y_nm: 950000 });
    expect(pad1.size).toEqual({ x_nm: 1100000, y_nm: 600000 });
    expect(pad1.roundrect_ratio_ppm).toBe(250000);
    expect(pad1.layers).toEqual(["F.Cu", "F.Mask", "F.Paste"]);
  });

  test("the land pattern states its package code (ADR-0127 decision 1)", () => {
    expect(result.ir!.footprint.package_code).toBe("SOT-23-5");
  });

  test("pads preserved in appearance order, graphics and fields all present", () => {
    const fp = result.ir!.footprint;
    expect(fp.pads.map((p) => p.number)).toEqual(["1", "2", "3", "4", "5"]);
    expect(fp.graphics?.map((g) => g.kind)).toEqual(["line", "line", "rect", "rect"]);
    expect(fp.fields?.map((f) => f.name)).toEqual(["Reference", "Value"]);
    expect(fp.fields?.[0]?.at).toEqual({ x_nm: 0, y_nm: -2000000 });
    expect(fp.model3d).toBeUndefined();
  });

  test("IR contains no floating point (ADR-0104 decision 3)", () => {
    // canonicalJson throws as soon as it meets a non-integer; this is where "no floats in the IR" is enforced.
    expect(() => canonicalJson(result.ir)).not.toThrow();
  });
});

describe("IR order depends only on semantics", () => {
  test("pads in natural order, fields by name, graphics by (kind, layer, coordinates)", () => {
    const text = [
      "version 0.4",
      "footprint t",
      "",
      "field Value V",
      "field Reference R",
      "pads",
      "  10  smd  rect  1  1  1  1",
      "  2   smd  rect  0  0  1  1",
      "",
      "graphics",
      "  rect  F.Fab  0,0,1,1  width=0.1",
      "  line  F.SilkS  0,0,1,1  width=0.12",
      "",
    ].join("\n");
    const fp = parse(text).ir!.footprint;
    expect(fp.pads.map((p) => p.number)).toEqual(["2", "10"]);
    expect(fp.fields?.map((f) => f.name)).toEqual(["Reference", "Value"]);
    expect(fp.graphics?.map((g) => g.kind)).toEqual(["line", "rect"]);
  });
});

describe("error location", () => {
  test("reports row and column when the file header is wrong", () => {
    const result = parse("version 0.4\nnot_a_footprint x\n");
    expect(result.ok).toBe(false);
    expect(formatDiagnostic(result.diagnostics[0]!)).toBe(
      "x.teda:2:1: error syntax.header-invalid: the second line must be footprint <id>",
    );
  });

  test("through-hole pad missing drill reports an error", () => {
    const result = parse(
      ["version 0.4", "footprint t", "", "pads", "  1  th  circle  0  0  1.6  1.6"].join("\n"),
    );
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]!.code).toBe("value.pad-attribute-invalid");
    expect(result.diagnostics[0]!.location!.line).toBe(5);
  });

  test("unknown key reports an error", () => {
    const result = parse(
      ["version 0.4", "footprint t", "", "pads", "  1  smd  rect  0  0  1  1  bogus=1"].join("\n"),
    );
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]!.code).toBe("syntax.unknown-field");
  });

  test("finer than nanometer precision reports an error, no rounding", () => {
    const result = parse(
      ["version 0.4", "footprint t", "", "pads", "  1  smd  rect  0.0000001mm  0  1  1"].join("\n"),
    );
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]!.message).toContain("finer than nanometer precision");
  });

  test("unknown section reports an error", () => {
    const result = parse(["version 0.4", "footprint t", "", "wiring"].join("\n"));
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]!.code).toBe("syntax.unknown-section");
  });

  test("version above the supported maximum reports an error", () => {
    const result = parse(["version 0.10", "footprint t", "", "pads", "  1 smd rect 0 0 1 1"].join("\n"));
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]!.code).toBe("format.unsupported-version");
  });
});

describe("the file revision", () => {
  test("`rev` is a scalar and reaches the IR", () => {
    const text = ["version 0.4.2", "footprint f", "rev 2.1.0", "", "pads", "  1  smd  roundrect  0  0  1.1  0.6  rratio=0.25", ""].join("\n");
    const result = parse(text);
    expect(result.diagnostics.map(formatDiagnostic)).toEqual([]);
    expect(result.ir!.footprint.rev).toBe("2.1.0");
  });
});
