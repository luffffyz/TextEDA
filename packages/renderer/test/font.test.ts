// The typography contract: glyphs are drawn as **paths**, never relying on system fonts.
//
// If this layer ever falls back to `<text>`, previews on machines without the font
// would degrade to shapes only -- so "no <text> elements" is a hard constraint, not an implementation detail.
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
  "examples/reference-project/assets/symbols/project/ldo-sot23-5.teda",
);

const SIZE = 1_270_000; // 1.27mm
const strokesOf = (text: string, yDown: boolean, anchor: "start" | "middle" | "end" = "start") =>
  textStrokes(text, { x: 0, y: 0, sizeNm: SIZE, anchor, yDown });
const xs = (text: string, anchor: "start" | "middle" | "end") =>
  strokesOf(text, false, anchor).flatMap((s) => s.points.map((p) => p.x));
const ys = (text: string, yDown: boolean) =>
  strokesOf(text, yDown).flatMap((s) => s.points.map((p) => p.y));

describe("glyph layout", () => {
  test("cap height equals sizeNm: the height of the uppercase box is the glyph size", () => {
    const y = ys("H", false);
    expect(Math.max(...y) - Math.min(...y)).toBe(SIZE);
  });

  test("orientation flips descender direction: in a symbol (+y up) the descender points down, in a footprint (+y down) it points up", () => {
    // 'g' has a descender: in a symbol it lands below the anchor (smaller model y), in a footprint above it (larger model y).
    const up = ys("g", false);
    const down = ys("g", true);
    expect(Math.min(...up)).toBeLessThan(-SIZE / 2);
    expect(Math.max(...up)).toBeLessThan(SIZE / 2);
    expect(Math.max(...down)).toBeGreaterThan(SIZE / 2);
    expect(Math.min(...down)).toBeGreaterThan(-SIZE / 2);
  });

  test("alignment sets the horizontal start: start is flush left, middle is centered, end is flush right", () => {
    const width = textAdvance("ABC", SIZE);
    // start: the first glyph starts at the anchor and extends right (the left side bearing belongs to the glyph itself).
    expect(Math.min(...xs("ABC", "start"))).toBeGreaterThanOrEqual(0);
    expect(Math.min(...xs("ABC", "start"))).toBeLessThan(SIZE);
    expect(Math.max(...xs("ABC", "start"))).toBeLessThanOrEqual(width);
    // middle: the whole string is centered on the anchor.
    expect(Math.min(...xs("ABC", "middle"))).toBeLessThan(0);
    expect(Math.max(...xs("ABC", "middle"))).toBeGreaterThan(0);
    // end: the whole string ends at the anchor.
    expect(Math.max(...xs("ABC", "end"))).toBeLessThanOrEqual(0);
    expect(Math.max(...xs("ABC", "end"))).toBeGreaterThan(-SIZE);
  });

  test("advance width scales linearly with glyph size", () => {
    expect(textAdvance("ABC", SIZE * 2)).toBe(textAdvance("ABC", SIZE) * 2);
  });

  test("characters that cannot be drawn are named: the built-in font covers only ASCII", () => {
    expect(unsupportedChars("IN")).toEqual([]);
    expect(unsupportedChars("\u7a33\u538b\u5668")).toEqual(["\u7a33", "\u538b", "\u5668"]);
  });

  test("glyphs are spaced apart: the step is no smaller than a glyph's advance (letters do not collide)", () => {
    // Three 'M's (one of the widest glyphs) laid out end to end must be wider than a single 'M'.
    const one = Math.max(...xs("M", "start")) - Math.min(...xs("M", "start"));
    const three = Math.max(...xs("MMM", "start")) - Math.min(...xs("MMM", "start"));
    expect(three).toBeGreaterThan(one * 2);
  });
});

describe("SVG output does not depend on system fonts", () => {
  test("no <text> elements: text is drawn as paths", () => {
    const parsed = parseSymbol(readFileSync(symbolFile, "utf8"), {
      file: symbolFile,
      library: "project",
    });
    if (!parsed.ok || !parsed.ir) throw new Error("failed to parse reference symbol");
    const sym = parsed.ir.symbol;
    const doc = renderSymbol(sym, {
      pins: sym.pins.map((p) => ({ number: p.number, name: "IN", type: "input" })),
    });
    const svg = toSvgText(doc);
    expect(svg).not.toContain("<text");
    expect(svg).not.toContain("font-family");
    // The text is still on the drawing (paths plus a searchable title).
    expect(svg).toContain("<path d=");
    expect(svg).toContain("<title>IN</title>");
  });
});
