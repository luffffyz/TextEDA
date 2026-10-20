// 符号导出（IR + component → .kicad_sym）的单元测试。
// KiCad 能不能读、渲染，由 scripts/smoke-symbol.ts 负责。
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseSymbol } from "@texteda/parser";
import { missingPartPins, symbolLibrary, unplacedPartPins } from "../src/index.ts";

const smallSymbol = parseSymbol(
  [
    "version 0.5",
    "symbol demo",
    "",
    "description 演示符号",
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

describe("符号库导出", () => {
  test("头部是 KiCad 符号库、版本正确", () => {
    const text = symbolLibrary(smallSymbol, part);
    expect(text.startsWith("(kicad_symbol_lib")).toBe(true);
    expect(text).toContain("(version 20251024)");
    expect(text).toContain('(symbol "demo"');
  });

  test("引脚名与电气类型来自 component，位置来自 symbol", () => {
    const text = symbolLibrary(smallSymbol, part);
    expect(text).toContain('(name "IN"');
    expect(text).toContain('(number "1"');
    expect(text).toContain("(pin input line (at -12.7 2.54 0) (length 2.54)");
  });

  test("power 电气类型映射成 KiCad 的 power_in", () => {
    const text = symbolLibrary(smallSymbol, part);
    expect(text).toContain("(pin power_in line");
  });

  test("属性带 footprint 与 datasheet，Reference/Value 用字段值", () => {
    const text = symbolLibrary(smallSymbol, part);
    expect(text).toContain('(property "Footprint" "project:sot-23-5"');
    expect(text).toContain('(property "Datasheet" "https://example.invalid/ds.pdf"');
    expect(text).toContain('(property "Reference" "U"');
    expect(text).toContain('(property "Value" "demo"');
  });

  test("不描边的图形也必须是 KiCad 认的 stroke（没有 type none）", () => {
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

  test("引脚号在器件里缺失时报错而不是静默产出", () => {
    expect(missingPartPins(smallSymbol, { pins: [] })).toEqual(["1", "2"]);
    expect(() => symbolLibrary(smallSymbol, { pins: [] })).toThrow(/引脚在器件里不存在/);
  });

  test("器件里有、符号里没画的引脚被列出来（警告素材）", () => {
    const symbol = parseSymbol(
      ["version 0.5", "symbol t", "", "pins", "  1  0  0  0", ""].join("\n"),
      { file: "x.teda", library: "project" },
    ).ir!.symbol;
    expect(unplacedPartPins(symbol, part)).toEqual(["2"]);
  });
});

describe("示例符号", () => {
  const symbolText = readFileSync("examples/reference-project/symbols/project/bq24610rger.teda", "utf8");
  const example = parseSymbol(symbolText, { file: "x.teda", library: "project" }).ir!.symbol;
  const fullPart = {
    pins: [
      { number: "1", name: "ACN", type: "input" },
      { number: "2", name: "ACP", type: "input" },
      { number: "17", name: "GND", type: "power" },
    ],
  };

  test("缺引脚时列出来", () => {
    expect(missingPartPins(example, fullPart).length).toBe(22);
  });

  test("符号里没画的器件引脚也列出来", () => {
    expect(unplacedPartPins(example, fullPart)).toEqual([]);
  });
});
