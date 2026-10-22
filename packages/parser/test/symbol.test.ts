// Unit tests for `symbol` surface parsing.
// End-to-end coverage (.teda → IR → .kicad_sym renders in KiCad) lives in scripts/smoke-symbol.ts.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { validate } from "@texteda/ir";
import { canonicalJson, formatDiagnostic, parseSymbol } from "../src/index.ts";

const example = readFileSync("examples/reference-project/assets/symbols/project/bq24610rger.teda", "utf8");

function parse(text: string) {
  return parseSymbol(text, { file: "x.teda", library: "project" });
}

describe("example symbol", () => {
  const result = parse(example);

  test("compiles cleanly with no diagnostics", () => {
    expect(result.diagnostics.map(formatDiagnostic)).toEqual([]);
    expect(result.ok).toBe(true);
  });

  test("25 pins; lengths converted to integer nanometers, angles to millidegrees", () => {
    const sym = result.ir!.symbol;
    expect(sym.pins.length).toBe(25);
    const pin1 = sym.pins.find((p) => p.number === "1")!;
    expect(pin1.at).toEqual({ x_nm: -12700000, y_nm: 13970000, rotation_mdeg: 0 });
    expect(pin1.length_nm).toBe(2540000);
    expect(pin1.unit).toBe(1);
    expect(pin1.style).toBe("line");
    const pin17 = sym.pins.find((p) => p.number === "17")!;
    expect(pin17.at.rotation_mdeg).toBe(90000);
  });

  test("body is a rectangle with background fill", () => {
    const body = result.ir!.symbol.body!;
    expect(body.length).toBe(1);
    expect(body[0]!.kind).toBe("rect");
    expect(body[0]!.fill).toBe("background");
    expect(body[0]!.start).toEqual({ x_nm: -10160000, y_nm: -16510000 });
  });

  test("fields are sorted by name; values do not contain keys", () => {
    const fields = result.ir!.symbol.fields!;
    expect(fields.map((f) => f.name)).toEqual(["Reference", "Value"]);
    expect(fields[0]!.value).toBe("U");
    expect(fields[0]!.at).toEqual({ x_nm: -6350000, y_nm: 17780000 });
  });

  test("passes the IR contract (closed schema)", () => {
    expect(validate("symbol", result.ir).ok).toBe(true);
  });

  test("no floats in the IR (ADR-0004 decision 3)", () => {
    expect(() => canonicalJson(result.ir)).not.toThrow();
  });
});

describe("error locations", () => {
  test("version below 0.5 reports an error", () => {
    const result = parse(["version 0.4", "symbol t", "", "pins", "  1  0  0  0"].join("\n"));
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]!.code).toBe("format.unsupported-version");
    expect(result.diagnostics[0]!.location!.line).toBe(1);
  });

  test("type line not symbol reports an error", () => {
    const result = parse("version 0.5\nfootprint t\n");
    expect(formatDiagnostic(result.diagnostics[0]!)).toBe(
      "x.teda:2:1: error syntax.header-invalid: the second line must be symbol <id>",
    );
  });

  test("unknown scalar reports an error with line and column", () => {
    const result = parse(["version 0.5", "symbol t", "", "colour red", "pins", "  1  0  0  0"].join("\n"));
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]!.code).toBe("syntax.unknown-field");
    expect(result.diagnostics[0]!.location!.line).toBe(4);
    expect(result.diagnostics[0]!.location!.col).toBe(1);
  });

  test("unit exceeding units reports an error", () => {
    const result = parse(
      ["version 0.5", "symbol t", "", "units 1", "pins", "  1  0  0  0  unit=2"].join("\n"),
    );
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]!.code).toBe("value.invalid-unit");
  });

  test("symbol fields have no layer", () => {
    const result = parse(
      ["version 0.5", "symbol t", "", "field Reference at=0,0 layer=F.SilkS U", "pins", "  1  0  0  0"].join("\n"),
    );
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.message.includes("symbols have no layers"))).toBe(true);
  });

  test("pins section must not be empty", () => {
    const result = parse("version 0.5\nsymbol t\n");
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "library.pins-empty")).toBe(true);
  });

  test("duplicate pin number within the same unit reports an error", () => {
    const result = parse(
      ["version 0.5", "symbol t", "", "pins", "  1  0  0  0", "  1  1  0  0"].join("\n"),
    );
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "library.duplicate-pin-number")).toBe(true);
  });
});

describe("IR order depends only on semantics", () => {
  test("pins by (unit, number), fields by name, body by (unit, kind, coordinates)", () => {
    const text = [
      "version 0.5",
      "symbol t",
      "",
      "units 2",
      "field Value V",
      "field Reference R",
      "pins",
      "  2  0  0  0  unit=2",
      "  10  0  0  0",
      "  1  0  0  0",
      "",
      "body",
      "  rect  0,0,1,1",
      "  line  0,0,1,1",
      "",
    ].join("\n");
    const sym = parse(text).ir!.symbol;
    expect(sym.pins.map((p) => `${p.unit}:${p.number}`)).toEqual(["1:1", "1:10", "2:2"]);
    expect(sym.fields?.map((f) => f.name)).toEqual(["Reference", "Value"]);
    expect(sym.body?.map((b) => b.kind)).toEqual(["line", "rect"]);
  });
});
