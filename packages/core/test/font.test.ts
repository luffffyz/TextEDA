// Glyph layout: text becomes stroke polylines in model coordinates, with no system font involved.
//
// The layout lives in `packages/core` because the board image strokes the silkscreen with it
// (ADR-0018 D4). The contract it has to keep is orientation: the same string is read differently in
// a symbol (+y up) and in a footprint (+y down), and the anchor is the visual centre of the cap box.
import { describe, expect, test } from "bun:test";
import { textAdvance, textStrokes, unsupportedChars } from "../src/font/index.ts";

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
