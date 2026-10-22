// Unit tests for symbol export (IR + component → .kicad_sym).
// Whether KiCad can read and render it is covered by scripts/smoke-symbol.ts.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseSymbol } from "@texteda/parser";
import { missingPartPins, symbolLibrary, unplacedPartPins } from "../src/index.ts";

const smallSymbol = parseSymbol(
  [
    "version 0.5",
    "symbol demo",
    "",
    "description demo symbol",
    "field Reference at=-6.35,17.78 U",
    "",
    "pins",
    "  1  -12.7  2.54  0",
    "  2  12.7  -2.54  180",
    "",
    "body",
    "  rect  -5.08,-5.08,5.08,5.08  width=0.254  fill=background",
    "",
  ].join("\n"),
  { file: "x.teda", library: "project" },
).ir!.symbol;

const part = {
  pins: [
    { number: "1", name: "IN", type: "input" },
    { number: "2", name: "GND", type: "power" },
  ],
  footprint: "project:sot-23-5",
  datasheet: "https://example.invalid/ds.pdf",
};

describe("Symbol library export", () => {
  test("header is a KiCad symbol library with the correct version", () => {
    const text = symbolLibrary(smallSymbol, part);
    expect(text.startsWith("(kicad_symbol_lib")).toBe(true);
    expect(text).toContain("(version 20251024)");
    expect(text).toContain('(symbol "demo"');
  });

  test("pin names and electrical types come from component, positions come from symbol", () => {
    const text = symbolLibrary(smallSymbol, part);
    expect(text).toContain('(name "IN"');
    expect(text).toContain('(number "1"');
    expect(text).toContain("(pin input line (at -12.7 2.54 0) (length 2.54)");
  });

  test("power electrical type maps to KiCad's power_in", () => {
    const text = symbolLibrary(smallSymbol, part);
    expect(text).toContain("(pin power_in line");
  });

  test("properties carry footprint and datasheet; Reference/Value use the field values", () => {
    const text = symbolLibrary(smallSymbol, part);
    expect(text).toContain('(property "Footprint" "project:sot-23-5"');
    expect(text).toContain('(property "Datasheet" "https://example.invalid/ds.pdf"');
    expect(text).toContain('(property "Reference" "U"');
    expect(text).toContain('(property "Value" "demo"');
  });

  test("graphics without stroking still get a stroke KiCad accepts (no type none)", () => {
    const symbol = parseSymbol(
      [
        "version 0.5",
        "symbol t",
        "",
        "pins",
        "  1  0  0  0",
        "",
        "body",
        "  poly  -1,1,0,2,1,1  width=0",
        "",
      ].join("\n"),
      { file: "x.teda", library: "project" },
    ).ir!.symbol;
    const text = symbolLibrary(symbol, { pins: [{ number: "1", name: "A", type: "passive" }] });
    expect(text).not.toContain("(stroke (width 0) (type none))");
    expect(text).toContain("(stroke (width 0) (type default))");
  });

  test("missing pin numbers in the component raise an error instead of silently producing output", () => {
    expect(missingPartPins(smallSymbol, { pins: [] })).toEqual(["1", "2"]);
    expect(() => symbolLibrary(smallSymbol, { pins: [] })).toThrow(/pins not present in component/);
  });

  test("pins present in the component but not drawn in the symbol are listed (warning material)", () => {
    const symbol = parseSymbol(
      ["version 0.5", "symbol t", "", "pins", "  1  0  0  0", ""].join("\n"),
      { file: "x.teda", library: "project" },
    ).ir!.symbol;
    expect(unplacedPartPins(symbol, part)).toEqual(["2"]);
  });
});

describe("Example symbol", () => {
  const symbolText = readFileSync("examples/reference-project/assets/symbols/project/bq24610rger.teda", "utf8");
  const example = parseSymbol(symbolText, { file: "x.teda", library: "project" }).ir!.symbol;
  const fullPart = {
    pins: [
      { number: "1", name: "ACN", type: "input" },
      { number: "2", name: "ACP", type: "input" },
      { number: "17", name: "GND", type: "power" },
    ],
  };

  test("missing pins are listed", () => {
    expect(missingPartPins(example, fullPart).length).toBe(22);
  });

  test("unplaced component pins are also listed", () => {
    expect(unplacedPartPins(example, fullPart)).toEqual([]);
  });
});
