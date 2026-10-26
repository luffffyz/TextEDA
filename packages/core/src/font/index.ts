// Glyph layout: string -> stroke polylines (model coordinates, integer nanometers).
//
// This module lives in `packages/core` because two consumers need it and neither may depend on the
// other: the SVG renderer (`packages/renderer`) draws symbol, footprint and print-page text with it,
// and the board image (`packages/core/src/board-image.ts`) strokes the silkscreen with it. Text that
// reaches a manufacturing file is assembly, not drawing, so the layout sits below the renderer
// (ADR-0054 D4); the renderer imports it from here.
//
// Uses the Hershey single-stroke font (`hershey-sans.ts`): glyphs are drawn as **paths**,
// independent of system fonts -- machines without fonts installed still open the SVG
// without getting "the picture but no text".
//
// Coordinate convention: the font's own y axis **points down** (baseline y=22, cap height
// 21, x-height 14, descenders reach 29). Model coordinates follow the document's
// orientation (+y up for symbols, +y down for footprints), so layout takes a `yDown` flag.
import { GLYPHS, SPACE_ADVANCE, glyphIndex } from "./hershey-sans.ts";

export type TextAnchor = "start" | "middle" | "end";

/** Font metrics (font coordinate system, y down). */
const BASELINE_Y = 22;
/** Cap height: from y=1 to the baseline at y=22. */
const CAP_HEIGHT = 21;
/** Center of the cap box (y=1..22) -- text hangs centered on the anchor by it. */
const CAP_CENTER_Y = 11.5;
/**
 * Conversion factor for advance widths.
 *
 * In the Hershey data, each glyph's `o` (advance) is **not on the same scale as the
 * stroke coordinates**: the strokes are measured in units of the cap height 21, while
 * `o` is per em. Upstream `hersheytext` reconciles the two with 1.68 when rendering
 * itself (`multiplyer`); copying that factor keeps the letters from crowding together.
 */
const ADVANCE_SCALE = 1.68;

export interface FontPoint {
  x: number;
  y: number;
}

export interface FontStroke {
  points: FontPoint[];
}

interface Glyph {
  /** Stroke polylines (font coordinates). */
  strokes: FontPoint[][];
  /** Advance width (font coordinate units, same scale as the strokes). */
  advance: number;
}

const glyphCache = new Map<string, Glyph | null>();

/** Get the glyph; a space has an advance only, no strokes. */
function glyph(ch: string): Glyph | null {
  if (ch === " ") return { strokes: [], advance: SPACE_ADVANCE };
  const cached = glyphCache.get(ch);
  if (cached !== undefined) return cached;
  const i = glyphIndex(ch);
  const raw = i >= 0 ? GLYPHS[i] : undefined;
  const parsed: Glyph | null = raw
    ? { strokes: parseStrokes(raw[0]), advance: raw[1] * ADVANCE_SCALE }
    : null;
  glyphCache.set(ch, parsed);
  return parsed;
}

/** Hershey's path notation has only M and L: M starts a new polyline; the following coordinate pairs continue it. */
function parseStrokes(d: string): FontPoint[][] {
  const strokes: FontPoint[][] = [];
  let current: FontPoint[] = [];
  const re = /([ML])|(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d)) !== null) {
    if (m[1] === "M") {
      if (current.length > 0) strokes.push(current);
      current = [];
    } else if (m[1] === "L") {
      // Just continues the current polyline.
    } else {
      current.push({ x: Number(m[2]), y: Number(m[3]) });
    }
  }
  if (current.length > 0) strokes.push(current);
  return strokes;
}

/** Width of a text string (nanometers). `sizeNm` is the cap height. */
export function textAdvance(text: string, sizeNm: number): number {
  const scale = sizeNm / CAP_HEIGHT;
  let total = 0;
  for (const ch of text) {
    const g = glyph(ch);
    if (g) total += g.advance * scale;
  }
  return total;
}

/**
 * Layout: turn text into stroke polylines in model coordinates.
 *
 * `x` / `y` anchor the **visual center** of the text (equivalent to `<text
 * dominant-baseline="central">`): the cap box (the cap-height band) hangs centered on
 * the anchor, with descenders extending below. `yDown` states the model y direction:
 * false for symbols (+y up), true for footprints (+y down).
 */
export function textStrokes(
  text: string,
  opts: { x: number; y: number; sizeNm: number; anchor: TextAnchor; yDown: boolean },
): FontStroke[] {
  const scale = opts.sizeNm / CAP_HEIGHT;
  const width = textAdvance(text, opts.sizeNm);
  let penX =
    opts.anchor === "start" ? opts.x : opts.anchor === "end" ? opts.x - width : opts.x - width / 2;

  const out: FontStroke[] = [];
  for (const ch of text) {
    const g = glyph(ch);
    if (!g) continue;
    for (const stroke of g.strokes) {
      const points = stroke.map((p) => ({
        x: Math.round(penX + p.x * scale),
        y: Math.round(
          opts.y +
            (opts.yDown ? p.y - CAP_CENTER_Y : CAP_CENTER_Y - p.y) * scale,
        ),
      }));
      out.push({ points });
    }
    penX += g.advance * scale;
  }
  return out;
}

/** Stroke width (nanometers): stroke weight of the single-stroke font, tied to cap height. */
export function strokeWidthFor(sizeNm: number): number {
  return Math.max(1, Math.round(sizeNm * 0.1));
}

/**
 * Characters that cannot be drawn (the bundled font is ASCII-only).
 *
 * The preview must **say so**: otherwise a pin name in Chinese silently disappears from
 * the diagram, and the viewer would think the pin has no name.
 */
export function unsupportedChars(text: string): string[] {
  const bad = new Set<string>();
  for (const ch of text) {
    if (!glyph(ch)) bad.add(ch);
  }
  return [...bad];
}

export { BASELINE_Y, CAP_HEIGHT };
