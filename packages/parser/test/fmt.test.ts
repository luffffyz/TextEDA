// `footprint` canonical form 的单元测试（spec/footprint.md §8）。
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  canonicalJson,
  descriptionType,
  formatFootprint,
  formatSymbol,
  parseFootprint,
  parseSymbol,
} from "../src/index.ts";

const example = readFileSync("examples/reference-project/footprints/project/sot-23-5.teda", "utf8");

function format(text: string): string {
  const result = formatFootprint(text, { file: "x.teda", library: "project" });
  if (!result.ok || result.text === undefined) {
    throw new Error(`格式化失败：${JSON.stringify(result.diagnostics)}`);
  }
  return result.text;
}

describe("canonical form", () => {
  test("示例文件本身就是 canonical", () => {
    expect(format(example)).toBe(example);
  });

  test("幂等", () => {
    const once = format(example);
    expect(format(once)).toBe(once);
  });

  test("行/键/注释/单位一次归一", () => {
    const messy = [
      "# 文件眉注",
      "version 0.4",
      "footprint   messy",
      "",
      "field Value   R_0402",
      "# 这条属于 description",
      "description   a  b",
      "tags   b  a",
      "attr smd",
      "",
      "pads",
      "  10  smd  roundrect  1mm  0  1mm  0.5mm   rot=90  rratio=0.250",
      "  2   smd  rect  0.95mm  -0.95mm  1.1mm  0.6mm",
      "",
    ].join("\n");

    expect(format(messy)).toBe(
      [
        "# 文件眉注",
        "version 0.4",
        "footprint messy",
        "",
        "# 这条属于 description",
        "description a b",
        "tags a b",
        "attr smd",
        "field Value R_0402",
        "",
        "pads",
        "  2   smd  rect       0.95  -0.95  1.1  0.6",
        "  10  smd  roundrect  1     0      1    0.5  rot=90  rratio=0.25",
        "",
      ].join("\n"),
    );
  });

  test("非默认单位换算成 mm 后省略单位", () => {
    const text = [
      "version 0.4",
      "footprint t",
      "",
      "pads",
      "  1  smd  rect  10mil  0  40mil  20mil",
      "",
    ].join("\n");
    expect(format(text)).toContain("  1  smd  rect  0.254  0  1.016  0.508");
  });

  test("图形按 (kind, layer, geometry) 排序；th 焊盘保留 drill", () => {
    const text = [
      "version 0.4",
      "footprint t",
      "",
      "pads",
      "  1  th  circle  0  0  1.6  1.6  drill=1.0mm",
      "",
      "graphics",
      "  rect  F.Fab  0,0,1,1  width=0.1",
      "  line  F.SilkS  0,0,1,1  width=0.12",
      "",
    ].join("\n");
    const out = format(text);
    expect(out).toContain("  1  th  circle  0  0  1.6  1.6  drill=1");
    expect(out.indexOf("line  F.SilkS")).toBeLessThan(out.indexOf("rect  F.Fab"));
  });

  test("语义不变：IR 只依赖语义（与源里的顺序、单位写法无关）", () => {
    const messy = [
      "version 0.4",
      "footprint t",
      "",
      "tags b a",
      "field Value R",
      "field Reference R",
      "pads",
      "  10  smd  rect  1mm  1mm  1mm  1mm",
      "  2   smd  rect  0.95mm  0  1.1mm  0.6mm",
      "",
      "graphics",
      "  rect  F.Fab  0,0,1,1  width=0.1",
      "  line  F.SilkS  0,0,1,1  width=0.12",
      "",
    ].join("\n");
    const before = parseFootprint(messy, { file: "x.teda", library: "project" });
    const after = parseFootprint(format(messy), { file: "x.teda", library: "project" });
    expect(canonicalJson(after.ir)).toBe(canonicalJson(before.ir));
  });

  test("注释跟着它所属的行一起移动", () => {
    const text = ["version 0.4", "footprint t", "", "pads", "# 属于焊盘 2", "  2  smd  rect  0  0  1  1", "  1  smd  rect  0  0  1  1", ""].join("\n");
    expect(format(text)).toBe(
      ["version 0.4", "footprint t", "", "pads", "  1  smd  rect  0  0  1  1", "# 属于焊盘 2", "  2  smd  rect  0  0  1  1", ""].join("\n"),
    );
  });

  test("重复的段头归并成一个", () => {
    const text = ["version 0.4", "footprint t", "", "pads", "  1  smd  rect  0  0  1  1", "", "pads", "  2  smd  rect  0  0  1  1", ""].join("\n");
    const out = format(text);
    expect(out.split("\npads\n").length - 1).toBe(1);
    expect(out).toContain("  2  smd  rect  0  0  1  1");
  });

  test("段顺序固定为 pads → graphics；空 graphics 段与它的注释都保留", () => {
    const text = [
      "version 0.4",
      "footprint t",
      "",
      "graphics",
      "# 这个封装暂时没有图形",
      "",
      "pads",
      "  1  smd  rect  0  0  1  1",
      "",
    ].join("\n");
    // 规则是"注释跟随其后第一条有效行"：段内没有行时，它跟随的是下一个段头。
    expect(format(text)).toBe(
      [
        "version 0.4",
        "footprint t",
        "",
        "# 这个封装暂时没有图形",
        "pads",
        "  1  smd  rect  0  0  1  1",
        "",
        "graphics",
        "",
      ].join("\n"),
    );
  });

  test("类型行识别（CLI 按它分发；其他描述类型先跳过）", () => {
    expect(descriptionType("# 注释\nversion 0.4\nfootprint t\n")).toBe("footprint");
    expect(descriptionType("version 0.4\npcb charger-buck\n")).toBe("pcb");
    expect(descriptionType("")).toBeNull();
  });

  test("有错误的输入不产出文本（先修错再格式化）", () => {
    const result = formatFootprint("version 0.4\nfootprint t\n\npads\n  1  th  circle  0  0  1.6  1.6\n", {
      file: "x.teda",
      library: "project",
    });
    expect(result.ok).toBe(false);
    expect(result.text).toBeUndefined();
  });
});

describe("symbol 的 canonical form", () => {
  const symbolExample = readFileSync("examples/reference-project/symbols/project/bq24610rger.teda", "utf8");

  function formatSymbolText(text: string): string {
    const result = formatSymbol(text, { file: "x.teda", library: "project" });
    if (!result.ok || result.text === undefined) {
      throw new Error(`格式化失败：${JSON.stringify(result.diagnostics)}`);
    }
    return result.text;
  }

  test("示例文件本身就是 canonical", () => {
    expect(formatSymbolText(symbolExample)).toBe(symbolExample);
  });

  test("幂等", () => {
    const once = formatSymbolText(symbolExample);
    expect(formatSymbolText(once)).toBe(once);
  });

  test("缺省值不写：length/unit/style 与 units/power 等标量", () => {
    const text = [
      "version 0.5",
      "symbol t",
      "",
      "units 1",
      "power no",
      "in_bom yes",
      "pin_numbers show",
      "pins",
      "  1  0  0  0  length=2.54  unit=1  style=line",
      "  2  0  0  0  length=3  style=clock",
      "",
    ].join("\n");
    const out = formatSymbolText(text);
    expect(out).toContain("  1  0  0  0");
    expect(out).toContain("  2  0  0  0  length=3  style=clock");
    expect(out).not.toContain("units 1");
    expect(out).not.toContain("power no");
    expect(out).not.toContain("in_bom yes");
    expect(out).not.toContain("pin_numbers show");
  });

  test("引脚按 (unit, 号) 排序；语义不变", () => {
    const text = [
      "version 0.5",
      "symbol t",
      "",
      "units 2",
      "pins",
      "  2  0  0  0  unit=2",
      "  10  0  0  0",
      "  1  0  0  0",
      "",
    ].join("\n");
    const out = formatSymbolText(text);
    const order = out.split("\n").filter((l) => /^\s+\d/.test(l));
    expect(order[0]).toContain(" 1  ");
    expect(order[1]).toContain(" 10  ");
    expect(order[2]).toContain(" 2  ");
    const before = parseSymbol(text, { file: "x.teda", library: "project" });
    const after = parseSymbol(out, { file: "x.teda", library: "project" });
    expect(canonicalJson(after.ir)).toBe(canonicalJson(before.ir));
  });
});
