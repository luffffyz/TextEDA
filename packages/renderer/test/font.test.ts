// 文字排版的契约：字画成**路径**，不靠系统字体。
//
// 这一层一旦退回去用 `<text>`，没装字体的机器上预览就只剩图形——
// 所以"没有 <text> 元素"是硬约束，不是实现细节。
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSymbol } from "@texteda/parser";
import { renderSymbol, toSvgText } from "../src/index.ts";
import { textAdvance, textStrokes, unsupportedChars } from "../src/font/index.ts";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const symbolFile = join(
  repoRoot,
  "examples/reference-project/symbols/project/ldo-sot23-5.teda",
);

const SIZE = 1_270_000; // 1.27mm
const strokesOf = (text: string, yDown: boolean, anchor: "start" | "middle" | "end" = "start") =>
  textStrokes(text, { x: 0, y: 0, sizeNm: SIZE, anchor, yDown });
const xs = (text: string, anchor: "start" | "middle" | "end") =>
  strokesOf(text, false, anchor).flatMap((s) => s.points.map((p) => p.x));
const ys = (text: string, yDown: boolean) =>
  strokesOf(text, yDown).flatMap((s) => s.points.map((p) => p.y));

describe("字形排版", () => {
  test("字高就是 sizeNm：大写字框高度等于字高", () => {
    const y = ys("H", false);
    expect(Math.max(...y) - Math.min(...y)).toBe(SIZE);
  });

  test("朝向不同，降部的方向相反：符号（+y 向上）降部在下，封装（+y 向下）降部在上", () => {
    // 'g' 有降部：符号里降部落在锚点下方（模型 y 更小），封装里落在上方（模型 y 更大）。
    const up = ys("g", false);
    const down = ys("g", true);
    expect(Math.min(...up)).toBeLessThan(-SIZE / 2);
    expect(Math.max(...up)).toBeLessThan(SIZE / 2);
    expect(Math.max(...down)).toBeGreaterThan(SIZE / 2);
    expect(Math.min(...down)).toBeGreaterThan(-SIZE / 2);
  });

  test("对齐方式决定横向起点：start 贴左、middle 居中、end 贴右", () => {
    const width = textAdvance("ABC", SIZE);
    // start：第一个字形从锚点往右排（左边距留在字形自身）。
    expect(Math.min(...xs("ABC", "start"))).toBeGreaterThanOrEqual(0);
    expect(Math.min(...xs("ABC", "start"))).toBeLessThan(SIZE);
    expect(Math.max(...xs("ABC", "start"))).toBeLessThanOrEqual(width);
    // middle：整串以锚点为中心。
    expect(Math.min(...xs("ABC", "middle"))).toBeLessThan(0);
    expect(Math.max(...xs("ABC", "middle"))).toBeGreaterThan(0);
    // end：整串以锚点收尾。
    expect(Math.max(...xs("ABC", "end"))).toBeLessThanOrEqual(0);
    expect(Math.max(...xs("ABC", "end"))).toBeGreaterThan(-SIZE);
  });

  test("字宽随字高线性变化", () => {
    expect(textAdvance("ABC", SIZE * 2)).toBe(textAdvance("ABC", SIZE) * 2);
  });

  test("画不出来的字符要点名：自带字体只有 ASCII", () => {
    expect(unsupportedChars("IN")).toEqual([]);
    expect(unsupportedChars("稳压器")).toEqual(["稳", "压", "器"]);
  });

  test("字与字之间留得开：步进不小于字形宽度（字母不压在一起）", () => {
    // 三个 'M'（最宽的字形之一）排下来的宽度要大于单个 'M' 的墨迹宽度。
    const one = Math.max(...xs("M", "start")) - Math.min(...xs("M", "start"));
    const three = Math.max(...xs("MMM", "start")) - Math.min(...xs("MMM", "start"));
    expect(three).toBeGreaterThan(one * 2);
  });
});

describe("SVG 输出不依赖系统字体", () => {
  test("没有 <text> 元素：文字画成路径", () => {
    const parsed = parseSymbol(readFileSync(symbolFile, "utf8"), {
      file: symbolFile,
      library: "project",
    });
    if (!parsed.ok || !parsed.ir) throw new Error("参考符号解析失败");
    const sym = parsed.ir.symbol;
    const doc = renderSymbol(sym, {
      pins: sym.pins.map((p) => ({ number: p.number, name: "IN", type: "input" })),
    });
    const svg = toSvgText(doc);
    expect(svg).not.toContain("<text");
    expect(svg).not.toContain("font-family");
    // 文字仍然在图上（路径 + 可搜索的 title）。
    expect(svg).toContain("<path d=");
    expect(svg).toContain("<title>IN</title>");
  });
});
