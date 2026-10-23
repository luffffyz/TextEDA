#!/usr/bin/env bun
// TextEDA logo generator.
//
// Everything ships as outlined vector paths — no font dependency at render time, so the logo looks
// identical in a browser, Figma, Illustrator or a PDF.
//
// Concept: the "T" of Text is drawn as a PCB trace. One trunk (the single source of truth) splits
// into two routed branches ending in two pads — the two sibling descriptions (sch / pcb) derived
// from the same text.
//
// Outputs: lockups (plain / with descriptor, light + dark), square icon, brand sheet, a 1280x640
// social preview, and the raster exports the GitHub upload flow needs (`png/`).
//
//     bun run logo            # or: bun run docs/assets/build_logo.ts
//
// Inputs, all resolved at build time only: the Cascadia Code variable font for the wordmark
// (fetched on first run, see `ensureWordFont`), Liberation Sans for the sheet labels, and a Noto
// Sans CJK face for the Chinese tagline (both found on the system, see `systemFont`).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as fontkit from "fontkit";
import { Resvg } from "@resvg/resvg-js";

const HERE = import.meta.dir;
const OUT = join(HERE, "svg");
const PNG = join(HERE, "png");
mkdirSync(OUT, { recursive: true });
mkdirSync(PNG, { recursive: true });

// The wordmark is set in Cascadia (OFL-1.1), a monospace face because "everything is plain text"
// should be visible in the lettering itself. Cascadia Code and Cascadia Mono share identical glyph
// outlines (Mono just drops the programming ligatures), so the variable Code face is enough.

// Sheet labels use Liberation Sans (OFL-1.1 / Arial metrics): the sheets are documentation, and a
// proportional face reads better there than the monospace wordmark grid.
const LABEL_FAMILY = "Liberation Sans";

/** Em size the outlines are extracted at; every size in this file is expressed against it. */
const FONT_SIZE = 100;
/** Wordmark size in final units. */
const WORD_SIZE = 86;
const PAD = 40;
const GAP = 58;

/** Wordmark settings, all measured against the rendered ink gaps. */
const WORDMARK = {
  /** Extra advance per letter, as a fraction of the em. A monospace grid needs tightening. */
  tracking: -0.026,
  /** Optical gap between the "Text" and "EDA" ink edges, in final units. It must stay wider than
   *  the internal gaps, or the colour change reads as a cramped word rather than two halves. */
  gap: 11.0,
  /** Both halves are bold; colour alone separates them. `false` sets "Text" in the regular weight,
   *  which looked like two words joined together. */
  textBold: true,
};

/** Manual kerning, in font units at `FONT_SIZE`: pull "Te" and "ex" in so the gaps inside "Text"
 *  share one rhythm with the monospace advance. Measured ink gaps at the wordmark size land on
 *  4.0 ("Te") / 4.2 ("ex") / 4.0 ("xt", untouched - the t's crossbar overhang is the font's
 *  design). "ex" keeps slightly more room than the straight-sided pairs because an x is diagonal:
 *  its bbox gap understates the real whitespace. Wordmark only; the sheet labels are untouched. */
const PAIR_ADJ: Record<string, number> = { Te: -1.9, ex: -3.6 };

const CASCADIA_VTT_URL =
  "https://cdn.jsdelivr.net/gh/microsoft/cascadia-code@v2407.24/sources/vtt_data/CascadiaCode_VTT.ttf";
const CASCADIA_VTT = join(HERE, "_font", "CascadiaCode_VTT.ttf");

// ------------------------------------------------------------------ palettes
const LIGHT = {
  ink: "#14213D", frame: "#14213D", teal: "#00A38E", coral: "#FF6B4A",
  chip: "#EDF3FF", pale: "#B0C2DB", accent: "#C6D4E8", muted: "#5A6B85", bg: null as string | null,
};
const DARK = {
  ink: "#F0F5FF", frame: "#E4EBF8", teal: "#2FD3B7", coral: "#FF7A5C",
  chip: "#16233A", pale: "#4A6699", accent: "#3D5A85", muted: "#8AA0C2", bg: "#0B1626" as string | null,
};
type Palette = typeof LIGHT;

// ------------------------------------------------------------- font plumbing
type Font = any; // fontkit's font / variation / collection faces
type Box = [number, number, number, number]; // x0, y0, x1, y1 in the extracted em space

let wordFont: Font | null = null;

/** Download the variable face once; both weights come out of it through `variation`. */
async function ensureWordFont(): Promise<Font> {
  if (wordFont) return wordFont;
  if (!existsSync(CASCADIA_VTT)) {
    const response = await fetch(CASCADIA_VTT_URL);
    if (!response.ok) {
      throw new Error(
        `cannot fetch the Cascadia Code variable font (${response.status}); ` +
          `put it at ${CASCADIA_VTT} for an offline build`,
      );
    }
    mkdirSync(join(HERE, "_font"), { recursive: true });
    writeFileSync(CASCADIA_VTT, Buffer.from(await response.arrayBuffer()));
  }
  wordFont = fontkit.openSync(CASCADIA_VTT);
  return wordFont;
}

/** One static weight out of the variable face. */
function wordFace(weight: 400 | 700): Font {
  return wordFont!.getVariation({ wght: weight });
}

/**
 * Resolve a font file: an explicit override, then fontconfig, then the usual distro paths.
 * Every face is optional in this repo, so a missing font fails loudly with what to install.
 */
function systemFont(
  what: string,
  envKey: string,
  patterns: string[],
  files: string[],
): string {
  const candidates = [process.env[envKey] ?? ""];
  for (const pattern of patterns) {
    const match = Bun.spawnSync(["fc-match", "-f", "%{file}", pattern]);
    if (match.exitCode === 0) candidates.push(match.stdout.toString().trim());
  }
  candidates.push(...files);
  for (const file of candidates) {
    if (file && existsSync(file)) return file;
  }
  throw new Error(`no ${what} font found: install it or set ${envKey} to a font file`);
}

const labelFonts: Record<number, Font> = {};

/** Liberation Sans for sheet labels, both weights. */
function labelFace(weight: 400 | 700): Font {
  labelFonts[weight] ??= fontkit.openSync(
    systemFont(
      `${LABEL_FAMILY} ${weight === 700 ? "Bold" : "Regular"}`,
      weight === 700 ? "TEXTEDA_LABEL_BOLD_FONT" : "TEXTEDA_LABEL_FONT",
      weight === 700 ? ["Liberation Sans:bold", "Arial:bold"] : ["Liberation Sans", "Arial"],
      [
        `/usr/share/fonts/truetype/liberation/LiberationSans-${weight === 700 ? "Bold" : "Regular"}.ttf`,
        `/System/Library/Fonts/Supplemental/Arial${weight === 700 ? " Bold" : ""}.ttf`,
      ],
    ),
  );
  return labelFonts[weight]!;
}

let cjkFace: Font | null = null;

/** CJK face for the Chinese captions in the sheets. */
function cjkFont(): Font {
  if (cjkFace) return cjkFace;
  const file = systemFont(
    "Noto Sans CJK",
    "TEXTEDA_CJK_FONT",
    ["Noto Sans CJK SC"],
    [
      "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
      "/usr/share/fonts/opentype/noto-cjk/NotoSansCJK-Regular.ttc",
      "/System/Library/Fonts/NotoSansCJK-Regular.ttc",
    ],
  );
  const font = fontkit.openSync(file) as any;
  if (font.type === "TTC") {
    cjkFace =
      font.fonts.find((face: any) => face.postscriptName === "NotoSansCJKsc-Regular") ??
      font.fonts.find((face: any) => /sc/i.test(face.postscriptName)) ??
      font.fonts[0];
  } else {
    cjkFace = font;
  }
  return cjkFace!;
}

/** `???` in the square brackets is never reached: the ranges are byte-identical to the originals. */
function glyphPath(glyph: any, scale: number): { d: string; box: Box | null } {
  const points: string[] = [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const command of glyph.path.commands) {
    if (command.command === "closePath") {
      points.push("Z");
      continue;
    }
    const args: number[] = command.args;
    const pts: string[] = [];
    for (let i = 0; i + 1 < args.length; i += 2) {
      const x = args[i] * scale;
      const y = -args[i + 1] * scale; // font y grows up, SVG y grows down
      pts.push(`${x.toFixed(2)} ${y.toFixed(2)}`);
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
    const letter = { moveTo: "M", lineTo: "L", quadraticCurveTo: "Q", bezierCurveTo: "C" }[
      command.command as string
    ];
    points.push(letter + pts.join(" "));
  }
  return { d: points.join(" "), box: x0 === Infinity ? null : [x0, y0, x1, y1] };
}

interface TextPaths {
  /** One SVG path per drawn glyph, already positioned on the baseline. */
  ds: string[];
  /** Control-point hull per drawn glyph, parallel to `ds`. */
  boxes: Box[];
  /** Total advance width, in the same units as the paths. */
  width: number;
}

/**
 * Lay out one string as positioned outlines: one glyph per code point, on the font's own advance.
 *
 * Shaping is deliberately NOT used. A programming face would turn "fl" into a ligature glyph and the
 * CJK face would substitute variants, which costs paths and makes the output depend on which
 * substitutions a font happens to carry; here every code point gets its own outline, so the same
 * string always produces the same paths. Configured kerning is the manual `pairs` table, applied by
 * moving the second letter of a pair, which is where a kern belongs.
 */
function textPaths(
  text: string,
  font: Font,
  { tracking = 0, pairs = null as Record<string, number> | null } = {},
): TextPaths {
  const scale = FONT_SIZE / font.unitsPerEm;
  const chars = Array.from(text);
  const ds: string[] = [];
  const boxes: Box[] = [];
  let x = 0;
  for (let i = 0; i < chars.length; i += 1) {
    const glyph = font.glyphForCodePoint(chars[i].codePointAt(0)!);
    if (i > 0 && pairs) x += pairs[chars[i - 1] + chars[i]] ?? 0;
    const { d, box } = glyphPath(glyph, scale);
    // A space has no outline; it still advances, and it still leaves whitespace between the inks.
    if (box) {
      ds.push(shiftPath(d, x));
      boxes.push([box[0] + x, box[1], box[2] + x, box[3]]);
    }
    x += glyph.advanceWidth * scale + tracking;
  }
  return { ds, boxes, width: chars.length > 0 ? x - tracking : 0 };
}

/** Move an already-formatted path by `dx` on the x axis. */
function shiftPath(d: string, dx: number): string {
  if (dx === 0) return d;
  const tokens = d.match(/[MLQCZ]|-?\d+\.?\d*/g) ?? [];
  const out: string[] = [];
  let inPath = false;
  let pending = 0;
  for (const token of tokens) {
    if (/[MLQCZ]/.test(token)) {
      out.push(token);
      inPath = token !== "Z";
      pending = 0;
      continue;
    }
    if (!inPath) continue;
    const value = Number(token);
    if (pending === 0) {
      out.push(pad2(value + dx));
      pending = 1;
    } else {
      out.push(token);
      pending = 0;
    }
  }
  return out.join(" ");
}

function pad2(value: number): string {
  return value.toFixed(2);
}

/** One label: the glyph paths in a group, plus the advance width in final units. */
function label(
  text: string,
  x: number,
  y: number,
  size: number,
  fill: string,
  font: Font = JOB_FONT,
  trackingRatio = 0,
): [string, number] {
  // Outlines stay in em-100 units (as `textPaths` extracts them); the group transform applies the
  // real size. Tracking is measured in that same space, so it is computed against the label size.
  const paths = textPaths(text, font, { tracking: size * trackingRatio });
  return [group(paths, x, y, size / FONT_SIZE, fill), paths.width * (size / FONT_SIZE)];
}

/** A laid-out string as one `<g>`, scaled into final units. */
function group(paths: TextPaths, x: number, y: number, k: number, fill: string): string {
  const parts = [`<g transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${k.toFixed(4)})">`];
  for (const d of paths.ds) parts.push(`<path d="${d}" fill="${fill}"/>`);
  parts.push("</g>");
  return parts.join("\n  ");
}

/** Same label, centred on `cx` — laid out once, then shifted by half its own width. */
function labelC(
  text: string,
  cx: number,
  y: number,
  size: number,
  fill: string,
  font: Font = JOB_FONT,
  trackingRatio = 0,
): string {
  const k = size / FONT_SIZE;
  const paths = textPaths(text, font, { tracking: size * trackingRatio });
  return group(paths, cx - (paths.width * k) / 2, y, k, fill);
}

/** Sheet captions: Liberation Sans regular / bold (never the wordmark face). */
let JOB_FONT: Font = null as unknown as Font;
let JOB_BOLD: Font = null as unknown as Font;

// ------------------------------------------------------------- wordmark
function wordmark(
  x: number,
  baseline: number,
  p: Palette,
  { size = WORD_SIZE } = {},
): [string, Box] {
  const k = size / FONT_SIZE;
  const regular = wordFace(WORDMARK.textBold ? 700 : 400);
  const bold = wordFace(700);
  const tr = size * WORDMARK.tracking;
  const boundary = (WORDMARK.gap * size) / WORD_SIZE;

  // The manual kerning is what makes the three gaps inside "Text" one rhythm; see `PAIR_ADJ`.
  const text = textPaths("Text", regular, { tracking: tr, pairs: PAIR_ADJ });
  const eda = textPaths("EDA", bold, { tracking: tr });

  // Place "EDA" by INK edge, so the optical gap at the colour change is exact.
  const bt = text.boxes;
  const be = eda.boxes;
  const textInkRight = Math.max(...bt.map((b) => b[2])) * k;
  const edaInkLeft = Math.min(...be.map((b) => b[0])) * k;
  const xe = x + textInkRight + boundary - edaInkLeft;

  const out: string[] = [];
  out.push(`<g transform="translate(${x.toFixed(2)} ${baseline.toFixed(2)}) scale(${k.toFixed(4)})">`);
  for (const d of text.ds) out.push(`<path d="${d}" fill="${p.ink}"/>`);
  out.push("</g>");
  out.push(`<g transform="translate(${xe.toFixed(2)} ${baseline.toFixed(2)}) scale(${k.toFixed(4)})">`);
  for (const d of eda.ds) out.push(`<path d="${d}" fill="${p.teal}"/>`);
  out.push("</g>");

  const x0 = Math.min(...bt.map((b) => b[0])) * k + x;
  const x1 = Math.max(...be.map((b) => b[2])) * k + xe;
  const y0 = Math.min(...[bt, be].flat().map((b) => b[1])) * k + baseline;
  const y1 = Math.max(...[bt, be].flat().map((b) => b[3])) * k + baseline;
  return [out.join("\n  "), [x0, y0, x1, y1]];
}

/** A 2-D point in design space. */
type Point = [number, number];

/** Flattened T in a landscape board frame -> body in a 240x170 design space. */
function markFlatSvg(p: Palette, ox = 0, oy = 0, s = 1): string {
  // Board frame 208x138 at (16,16), trace 22 wide, three 14-radius rings with an 8-wide ring wall,
  // vias at the bottom corners. All in the 240x170 design space.
  const tw = 22, ringR = 14, ringW = 8, lx = 54, rx = 186, cy = 60, by = 112;
  const fx = 16, fy = 16, fw = 208, fh = 138, frx = 30, viaR = 7.5;
  const viaPos: [number, number][] = [[46, 124], [194, 124]];
  const edge = ringR - ringW / 2 + tw / 2;
  const g = (x: number, y: number): Point => [ox + x * s, oy + y * s];
  const parts: string[] = [];
  parts.push(
    `<rect x="${g(fx, fy)[0].toFixed(2)}" y="${g(fx, fy)[1].toFixed(2)}" width="${(fw * s).toFixed(2)}" height="${(fh * s).toFixed(2)}" rx="${(frx * s).toFixed(2)}" fill="${p.chip}" stroke="${p.frame}" stroke-width="${(7 * s).toFixed(2)}"/>`,
  );
  const line = (a: Point, b: Point): string => {
    const [x1, y1] = g(a[0], a[1]);
    const [x2, y2] = g(b[0], b[1]);
    return `<path d="M${x1.toFixed(2)} ${y1.toFixed(2)} L${x2.toFixed(2)} ${y2.toFixed(2)}" fill="none" stroke="${p.teal}" stroke-width="${(tw * s).toFixed(2)}" stroke-linecap="round"/>`;
  };
  parts.push(line([lx + edge, cy], [rx - edge, cy]));
  parts.push(line([120, cy], [120, by - edge]));
  for (const [cx, cyy] of [[lx, cy], [rx, cy], [120, by]] as Point[]) {
    const [x, y] = g(cx, cyy);
    parts.push(
      `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${(ringR * s).toFixed(2)}" fill="none" stroke="${p.coral}" stroke-width="${(ringW * s).toFixed(2)}"/>`,
    );
  }
  for (const [cx, cyy] of viaPos) {
    const [x, y] = g(cx, cyy);
    parts.push(`<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${(viaR * s).toFixed(2)}" fill="${p.pale}"/>`);
  }
  return parts.join("\n  ");
}

/** Bare flat T in a square canvas — safe for circular crops (GitHub avatar). */
function avatarBody(p: Palette): string {
  const edge = 14 - 8 / 2 + 22 / 2;
  const parts: string[] = [];
  for (const [x1, y1, x2, y2] of [
    [40 + edge, 94, 200 - edge, 94],
    [120, 94, 120, 148 - edge],
  ]) {
    parts.push(
      `<path d="M${x1.toFixed(2)} ${y1.toFixed(2)} L${x2.toFixed(2)} ${y2.toFixed(2)}" fill="none" stroke="${p.teal}" stroke-width="22" stroke-linecap="round"/>`,
    );
  }
  for (const [cx, cy] of [[40, 94], [200, 94], [120, 148]]) {
    parts.push(`<circle cx="${cx}" cy="${cy}" r="14" fill="none" stroke="${p.coral}" stroke-width="8"/>`);
  }
  return parts.join("\n  ");
}

// ------------------------------------------------------------- lockups
interface Lockup {
  body: string;
  width: number;
  height: number;
}

interface FlatLockupOptions {
  s?: number;
  wordSize?: number;
  descriptor?: string | null;
  descFont?: Font | null;
  descSize?: number;
  descTracking?: number;
}

/** Landscape flat mark + wordmark, in design space. */
function flatLockupBody(p: Palette, opts: FlatLockupOptions = {}): Lockup {
  const {
    s = 1, wordSize = 108, descriptor = null, descFont = null, descSize = 25, descTracking = 0.08,
  } = opts;
  let H = 250;
  const descFace = descFont ?? wordFace(400);
  const mw = 240 * s;
  const mh = 170 * s;
  const wmX = PAD + mw + GAP;
  // Centre the wordmark on the mark: lay it out once at the baseline to learn its ink height, then
  // draw it at the baseline that puts that ink box on the mark's centre line.
  const [, rel] = wordmark(wmX, 0, p, { size: wordSize });
  const baseline = H / 2 - (rel[3] + rel[1]) / 2;
  const [wm, bbox] = wordmark(wmX, baseline, p, { size: wordSize });
  const body: string[] = [markFlatSvg(p, PAD, (H - mh) / 2, s), wm];
  const accY = bbox[3] + 30;
  body.push(
    `<path d="M${bbox[0].toFixed(2)} ${accY.toFixed(2)} L${(bbox[2] - 14).toFixed(2)} ${accY.toFixed(2)}" fill="none" stroke="${p.accent}" stroke-width="4" stroke-linecap="round"/>`,
  );
  body.push(`<circle cx="${(bbox[2] - 8).toFixed(2)}" cy="${accY.toFixed(2)}" r="6" fill="${p.coral}"/>`);
  if (descriptor) {
    const [d] = label(descriptor, bbox[0], accY + 48, descSize, p.muted, descFace, descTracking);
    body.push(d);
    H = Math.trunc(accY + 48 + descSize * 0.35 + 30);
  }
  return { body: body.join("\n  "), width: Math.trunc(Math.round(bbox[2] + PAD)), height: H };
}

// ------------------------------------------------------------- output
interface Size {
  width: number;
  height: number;
}

function writeSvg(path: string, body: string, w: number, h: number, aria = "TextEDA logo", bg: string | null = null): Size {
  const head = bg ? [`<rect width="${w}" height="${h}" fill="${bg}"/>`] : [];
  head.push(body);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${aria}">\n  ` +
    head.join("\n  ") +
    "\n</svg>\n";
  writeFileSync(path, svg);
  return { width: w, height: h };
}

/** Rasterise an SVG to exactly this pixel width, keeping the aspect ratio. */
function rasterize(svgPath: string, outPath: string, width: number): void {
  const svg = readFileSync(svgPath, "utf8");
  const png = new Resvg(svg, { fitTo: { mode: "width", value: width } }).render().asPng();
  writeFileSync(outPath, png);
}

/** A `.ico` whose entries are PNGs: read by every browser and by Windows since Vista. */
function writeIco(outPath: string, entries: { width: number; png: Buffer }[]): void {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(entries.length, 4);
  const directory = Buffer.alloc(16 * entries.length);
  let offset = 6 + directory.length;
  entries.forEach((entry, index) => {
    const at = index * 16;
    directory.writeUInt8(entry.width >= 256 ? 0 : entry.width, at);
    directory.writeUInt8(entry.width >= 256 ? 0 : entry.width, at + 1);
    directory.writeUInt8(0, at + 2); // palette size
    directory.writeUInt8(0, at + 3); // reserved
    directory.writeUInt16LE(1, at + 4); // planes
    directory.writeUInt16LE(32, at + 6); // bits per pixel
    directory.writeUInt32LE(entry.png.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += entry.png.length;
  });
  writeFileSync(outPath, Buffer.concat([header, directory, ...entries.map((e) => e.png)]));
}

function buildFlatLockup(p: Palette, path: string, dark = false, opts: FlatLockupOptions = {}): Size {
  const { body, width, height } = flatLockupBody(p, opts);
  return writeSvg(path, body, width, height, "TextEDA logo", dark ? p.bg : null);
}

/** Square avatar: transparent in both palettes, so it drops onto any background (GitHub, PyPI). */
function buildAvatar(p: Palette, path: string): Size {
  return writeSvg(path, avatarBody(p), 240, 240, "TextEDA avatar");
}

/** GitHub social preview (1280x640). */
function buildSocial(path: string, w = 1280, h = 640): Size {
  const p = DARK;
  const parts: string[] = [`<rect width="${w}" height="${h}" fill="${p.bg}"/>`];
  for (const d of [
    "M0 500 L160 500 L240 420 L440 420",
    "M1280 150 L1130 150 L1050 230 L880 230",
    "M0 150 L80 150 L160 230",
    "M1280 520 L1170 520 L1090 440",
  ]) {
    parts.push(
      `<path d="${d}" fill="none" stroke="#1B2C49" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`,
    );
  }
  for (const [cx, cy] of [[240, 420], [160, 230], [1090, 440], [1050, 230]]) {
    parts.push(`<circle cx="${cx}" cy="${cy}" r="5" fill="#1B2C49"/>`);
  }

  const { body, width: lw, height: lh } = flatLockupBody(p, { descriptor: "Hardware as text" });
  const s = 1.28;
  const tx = (w - lw * s) / 2;
  const ty = (h - lh * s) / 2 - 18;
  parts.push(`<g transform="translate(${tx.toFixed(1)} ${ty.toFixed(1)}) scale(${s.toFixed(3)})">${body}</g>`);
  parts.push(labelC("github.com/luffffyz/TextEDA", w / 2, h - 66, 24, "#5E7396", JOB_FONT, 0.04));
  return writeSvg(path, parts.join("\n  "), w, h, "TextEDA", null);
}

/** One-page brand sheet: every lockup, the descriptor variants, reversed, marks at size, palette. */
function buildBrandSheet(path: string): Size {
  const W = 1000;
  const cjk = cjkFont();
  const parts: string[] = [];
  const state = { y: 78 };

  const head = (text: string, size = 30, color = "#14213D", font: Font = JOB_BOLD, gap = 26): void => {
    parts.push(label(text, 60, state.y, size, color, font)[0]);
    state.y += gap;
  };
  const rule = (): void => {
    state.y += 18;
    parts.push(`<line x1="60" y1="${state.y}" x2="940" y2="${state.y}" stroke="#E3E9F2" stroke-width="2"/>`);
    state.y += 40;
  };
  const caption = (text: string): void => {
    parts.push(label(text, 60, state.y, 15, "#94A3B8", cjk)[0]);
    state.y += 32;
  };
  const show = (body: string, h: number, dark = false): void => {
    if (dark) {
      parts.push(
        `<g transform="translate(60 ${state.y})"><rect width="880" height="${h}" fill="${DARK.bg}"/>${body}</g>`,
      );
    } else {
      parts.push(`<g transform="translate(60 ${state.y})">${body}</g>`);
    }
    state.y += h + 26;
  };

  head("TextEDA  -  logo sheet");
  head("扁版标志 + 等宽字标  |  flat board, Cascadia Mono wordmark", 15, "#94A3B8", cjk, 46);

  caption("主标志  -  扁版 + 等宽字标");
  let lockup = flatLockupBody(LIGHT);
  show(lockup.body, lockup.height);
  lockup = flatLockupBody(LIGHT, { descriptor: "Hardware as text" });
  show(lockup.body, lockup.height);
  lockup = flatLockupBody(LIGHT, { descriptor: "用文本描述硬件", descFont: cjk });
  show(lockup.body, lockup.height);
  rule();

  caption("负色  -  反转配色");
  lockup = flatLockupBody(DARK);
  show(lockup.body, lockup.height, true);
  rule();

  caption("头像  -  方形,圆形裁切安全");
  parts.push(`<g transform="translate(60 ${state.y + 25}) scale(0.62)">${avatarBody(LIGHT)}</g>`);
  for (const [i, size] of [130, 96, 68, 46, 30, 20].entries()) {
    parts.push(
      `<g transform="translate(${320 + i * 118} ${state.y + (150 - size) / 2}) scale(${(size / 240).toFixed(4)})">${avatarBody(LIGHT)}</g>`,
    );
  }
  state.y += 160 + 26;
  rule();

  caption("色板");
  const swatches: [string, string][] = [
    ["#14213D", "Ink"], ["#00A38E", "Teal"], ["#FF6B4A", "Coral"], ["#EDF3FF", "Chip"], ["#B0C2DB", "Via"],
  ];
  for (const [i, [color, name]] of swatches.entries()) {
    const x = 60 + i * 150;
    parts.push(`<rect x="${x}" y="${state.y}" width="46" height="46" rx="10" fill="${color}" stroke="#E3E9F2"/>`);
    parts.push(label(name, x, state.y + 72, 16, "#5A6B85", JOB_BOLD)[0]);
    parts.push(label(color, x, state.y + 92, 13, "#94A3B8", JOB_FONT)[0]);
  }
  state.y += 120;

  parts.unshift(`<rect width="${W}" height="${state.y}" fill="#FFFFFF"/>`);
  return writeSvg(path, parts.join("\n  "), W, state.y, "TextEDA logo sheet");
}

/** Positive vs negative, the final set only. */
function buildCompareSheet(path: string): Size {
  const W = 1200;
  const CARD_W = 1000;
  const PADX = 24;
  const cjk = cjkFont();
  const rows: [string, (p: Palette) => Lockup][] = [
    ["扁版标志  FLAT LOCKUP", (p) => flatLockupBody(p)],
    ["头像  AVATAR", (p) => ({ body: avatarBody(p), width: 240, height: 240 })],
  ];
  const cardH = 230;
  const H = 190 + rows.length * (cardH + 60) + 30;

  const parts: string[] = [`<rect width="${W}" height="${H}" fill="#FFFFFF"/>`];
  parts.push(label("TextEDA  -  positive / negative", 60, 76, 30, "#14213D", JOB_BOLD)[0]);
  parts.push(label("同一套几何,两套配色  |  same geometry, two palettes", 60, 102, 15, "#94A3B8", cjk)[0]);

  const colX = [60, 60 + CARD_W + 40];
  for (const [i, title] of ["正色  POSITIVE", "负色  NEGATIVE"].entries()) {
    parts.push(label(title, colX[i], 142, 18, "#14213D", cjk, 0.02)[0]);
    parts.push(label(i === 0 ? "on #FFFFFF" : "on #0B1626", colX[i], 162, 13, "#94A3B8", JOB_FONT)[0]);
  }

  let y = 186;
  for (const [name, getter] of rows) {
    parts.push(label(name, 60, y + 18, 14, "#5A6B85", cjk)[0]);
    for (const [i, p] of [LIGHT, DARK].entries()) {
      const { body, width: bw, height: bh } = getter(p);
      const sc = Math.min(1, (CARD_W - 2 * PADX) / bw);
      const bg = i === 0 ? "#FFFFFF" : DARK.bg;
      parts.push(
        `<g transform="translate(${colX[i]} ${y + 30})"><rect width="${CARD_W}" height="${cardH}" fill="${bg}" stroke="${i === 0 ? "#E3E9F2" : DARK.bg}" stroke-width="1"/><g transform="translate(${PADX.toFixed(1)} ${((cardH - bh * sc) / 2).toFixed(1)}) scale(${sc.toFixed(4)})">${body}</g></g>`,
      );
    }
    y += cardH + 60;
  }
  return writeSvg(path, parts.join("\n  "), W, H, "TextEDA positive / negative");
}

// ------------------------------------------------------------- main
await ensureWordFont();
JOB_FONT = labelFace(400);
JOB_BOLD = labelFace(700);
const svg = (name: string): string => join(OUT, name);
const png = (name: string): string => join(PNG, name);

const wordmarkFace = wordFace(700);
if (!wordmarkFace) throw new Error("the wordmark face failed to load");

const logo = buildFlatLockup(LIGHT, svg("texteda-logo.svg"));
const logoDark = buildFlatLockup(DARK, svg("texteda-logo-dark.svg"), true);
const logoTagline = buildFlatLockup(LIGHT, svg("texteda-logo-tagline.svg"), false, {
  descriptor: "Hardware as text",
});
const logoCn = buildFlatLockup(LIGHT, svg("texteda-logo-cn.svg"), false, {
  descriptor: "用文本描述硬件",
  descFont: cjkFont(),
});
const icon = buildAvatar(LIGHT, svg("texteda-icon.svg"));
const iconDark = buildAvatar(DARK, svg("texteda-icon-dark.svg"));
const social = buildSocial(svg("texteda-social-preview.svg"));
const compare = buildCompareSheet(svg("texteda-positive-negative.svg"));
const sheet = buildBrandSheet(svg("texteda-brand-sheet.svg"));

console.log(`--- wordmark: Cascadia Mono ${wordmarkFace.unitsPerEm} upem ---`);
for (const [path, size] of [
  ["logo", logo], ["logo dark", logoDark], ["logo + desc", logoTagline], ["logo + cn", logoCn],
  ["icon", icon], ["icon dark", iconDark], ["social", social], ["compare sheet", compare], ["brand sheet", sheet],
] as [string, Size][]) {
  console.log(`  ${path.padEnd(14)} ${size.width}x${size.height}`);
}

// Raster exports: the GitHub upload flow (avatar, favicon, social preview) needs them in the tree.
// Names carry "-2x" rather than the "@2x" suffix: "@" reads as an email address to check:public.
rasterize(svg("texteda-logo.svg"), png("logo-2x.png"), 1800);
rasterize(svg("texteda-logo-dark.svg"), png("logo-dark-2x.png"), 1800);
rasterize(svg("texteda-logo-tagline.svg"), png("logo-tagline-2x.png"), 1800);
rasterize(svg("texteda-logo-cn.svg"), png("logo-cn-2x.png"), 1800);
rasterize(svg("texteda-logo.svg"), png("preview.png"), 1200);
rasterize(svg("texteda-brand-sheet.svg"), png("texteda-brand-sheet.png"), 1400);
rasterize(svg("texteda-positive-negative.svg"), png("texteda-positive-negative.png"), 1400);
rasterize(svg("texteda-social-preview.svg"), png("texteda-social-preview.png"), 1280);

// The light icon also covers 16/32 (the favicon sizes); the dark one starts at 64, where it is
// actually read as an icon rather than a smudge.
for (const [name, dark, sizes] of [
  ["icon", false, [16, 32, 64, 128, 256, 512]],
  ["icon-dark", true, [64, 128, 256, 512]],
] as [string, boolean, number[]][]) {
  for (const size of sizes) {
    rasterize(svg(dark ? "texteda-icon-dark.svg" : "texteda-icon.svg"), png(`${name}-${size}.png`), size);
  }
}

writeIco(
  png("favicon.ico"),
  [16, 32, 48].map((width) => ({
    width,
    png: new Resvg(readFileSync(svg("texteda-icon.svg"), "utf8"), { fitTo: { mode: "width", value: width } })
      .render()
      .asPng(),
  })),
);

console.log(`  png/           8 raster exports, 10 icon sizes, favicon.ico`);
