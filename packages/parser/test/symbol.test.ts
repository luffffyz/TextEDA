// `symbol` 表面解析的单元测试。
// 端到端（.teda → IR → .kicad_sym → KiCad 能渲染）由 scripts/smoke-symbol.ts 负责。
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { validate } from "@texteda/ir";
import { canonicalJson, formatDiagnostic, parseSymbol } from "../src/index.ts";

const example = readFileSync("examples/reference-project/symbols/project/bq24610rger.teda", "utf8");

function parse(text: string) {
  return parseSymbol(text, { file: "x.teda", library: "project" });
}

describe("示例符号", () => {
  const result = parse(example);

  test("编译成功且没有诊断", () => {
    expect(result.diagnostics.map(formatDiagnostic)).toEqual([]);
    expect(result.ok).toBe(true);
  });

  test("25 个引脚，长度换算成整数纳米、角度换算成毫度", () => {
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

  test("外形是带背景填充的矩形", () => {
    const body = result.ir!.symbol.body!;
    expect(body.length).toBe(1);
    expect(body[0]!.kind).toBe("rect");
    expect(body[0]!.fill).toBe("background");
    expect(body[0]!.start).toEqual({ x_nm: -10160000, y_nm: -16510000 });
  });

  test("字段按名排序，属性值不含键", () => {
    const fields = result.ir!.symbol.fields!;
    expect(fields.map((f) => f.name)).toEqual(["Reference", "Value"]);
    expect(fields[0]!.value).toBe("U");
    expect(fields[0]!.at).toEqual({ x_nm: -6350000, y_nm: 17780000 });
  });

  test("通过 IR 契约（closed schema）", () => {
    expect(validate("symbol", result.ir).ok).toBe(true);
  });

  test("IR 里没有浮点（ADR-0004 决策 3）", () => {
    expect(() => canonicalJson(result.ir)).not.toThrow();
  });
});

describe("错误定位", () => {
  test("版本低于 0.5 报错", () => {
    const result = parse(["version 0.4", "symbol t", "", "pins", "  1  0  0  0"].join("\n"));
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]!.code).toBe("S113");
    expect(result.diagnostics[0]!.line).toBe(1);
  });

  test("类型行不是 symbol 报错", () => {
    const result = parse("version 0.5\nfootprint t\n");
    expect(formatDiagnostic(result.diagnostics[0]!)).toBe(
      "x.teda:2:1: error S113: 第二行必须是 symbol <id>",
    );
  });

  test("未知标量报错并给行列", () => {
    const result = parse(["version 0.5", "symbol t", "", "colour red", "pins", "  1  0  0  0"].join("\n"));
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]!.code).toBe("S110");
    expect(result.diagnostics[0]!.line).toBe(4);
    expect(result.diagnostics[0]!.col).toBe(1);
  });

  test("unit 超出 units 报错", () => {
    const result = parse(
      ["version 0.5", "symbol t", "", "units 1", "pins", "  1  0  0  0  unit=2"].join("\n"),
    );
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]!.code).toBe("S202");
  });

  test("符号字段没有 layer", () => {
    const result = parse(
      ["version 0.5", "symbol t", "", "field Reference at=0,0 layer=F.SilkS U", "pins", "  1  0  0  0"].join("\n"),
    );
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.message.includes("符号没有层"))).toBe(true);
  });

  test("pins 段不能为空", () => {
    const result = parse("version 0.5\nsymbol t\n");
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "S210")).toBe(true);
  });

  test("引脚号在同一单元内重复报错", () => {
    const result = parse(
      ["version 0.5", "symbol t", "", "pins", "  1  0  0  0", "  1  1  0  0"].join("\n"),
    );
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "S211")).toBe(true);
  });
});

describe("IR 顺序只依赖语义", () => {
  test("引脚按 (unit, 号)，字段按名，外形按 (unit, kind, 坐标)", () => {
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
