// `footprint` 表面解析的单元测试。
// 端到端（.teda → IR → KiCad → DRC/Gerber）由 scripts/smoke-footprint.ts 负责。
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { canonicalJson, formatDiagnostic, parseFootprint } from "../src/index.ts";

const example = readFileSync("examples/reference-project/footprints/project/sot-23-5.teda", "utf8");

function parse(text: string) {
  return parseFootprint(text, { file: "x.teda", library: "project" });
}

describe("示例封装", () => {
  const result = parse(example);

  test("编译成功且没有诊断", () => {
    expect(result.diagnostics.map(formatDiagnostic)).toEqual([]);
    expect(result.ok).toBe(true);
  });

  test("长度换算成整数纳米、比例换算成百万分比", () => {
    const fp = result.ir!.footprint;
    const pad1 = fp.pads[0]!;
    expect(pad1.at).toEqual({ x_nm: -950000, y_nm: 950000 });
    expect(pad1.size).toEqual({ x_nm: 1100000, y_nm: 600000 });
    expect(pad1.roundrect_ratio_ppm).toBe(250000);
    expect(pad1.layers).toEqual(["F.Cu", "F.Mask", "F.Paste"]);
  });

  test("焊盘按出现顺序保留，图形与字段都在", () => {
    const fp = result.ir!.footprint;
    expect(fp.pads.map((p) => p.number)).toEqual(["1", "2", "3", "4", "5"]);
    expect(fp.graphics?.map((g) => g.kind)).toEqual(["line", "line", "rect", "rect"]);
    expect(fp.fields?.map((f) => f.name)).toEqual(["Reference", "Value"]);
    expect(fp.fields?.[0]?.at).toEqual({ x_nm: 0, y_nm: -2000000 });
    expect(fp.model3d).toBeUndefined();
  });

  test("IR 里没有浮点（ADR-0004 决策 3）", () => {
    // canonicalJson 遇到非整数直接抛错——这就是"IR 不许浮点"的执行点。
    expect(() => canonicalJson(result.ir)).not.toThrow();
  });
});

describe("IR 顺序只依赖语义", () => {
  test("焊盘自然序、字段按名、图形按 (kind, layer, 坐标)", () => {
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

describe("错误定位", () => {
  test("文件头不对时报行列", () => {
    const result = parse("version 0.4\nnot_a_footprint x\n");
    expect(result.ok).toBe(false);
    expect(formatDiagnostic(result.diagnostics[0]!)).toBe(
      "x.teda:2:1: error F113: 第二行必须是 footprint <id>",
    );
  });

  test("通孔焊盘缺 drill 报错", () => {
    const result = parse(
      ["version 0.4", "footprint t", "", "pads", "  1  th  circle  0  0  1.6  1.6"].join("\n"),
    );
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]!.code).toBe("F201");
    expect(result.diagnostics[0]!.line).toBe(5);
  });

  test("未知键报错", () => {
    const result = parse(
      ["version 0.4", "footprint t", "", "pads", "  1  smd  rect  0  0  1  1  bogus=1"].join("\n"),
    );
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]!.code).toBe("F201");
  });

  test("精度超过纳米报错，不四舍五入", () => {
    const result = parse(
      ["version 0.4", "footprint t", "", "pads", "  1  smd  rect  0.0000001mm  0  1  1"].join("\n"),
    );
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]!.message).toContain("精度超过纳米");
  });

  test("未知段报错", () => {
    const result = parse(["version 0.4", "footprint t", "", "wiring"].join("\n"));
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]!.code).toBe("F110");
  });

  test("版本高于支持上限报错", () => {
    const result = parse(["version 0.9", "footprint t", "", "pads", "  1 smd rect 0 0 1 1"].join("\n"));
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]!.message).toContain("高于本工具支持");
  });
});
