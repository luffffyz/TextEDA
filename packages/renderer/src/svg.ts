// IR → drawing commands → SVG: the foundation of the reference renderer (the "reference renderer" of AGENTS.md §1).
//
// Conventions:
//   - Coordinates are always **integer nanometers**; orientation matches the source: symbols +y up, footprints +y down (ADR-0012 decision 5);
//     when converting to SVG, flip y according to `orientation` (SVG's y points down).
//   - Rendering the same IR twice yields **byte-identical** output: no timestamps, no random numbers, no dependence on external state.
//   - Drawing commands are an intermediate representation (`SvgDoc`), not strings: they can be asserted on, reverse-engineered (extract), and plugged into other backends later.
//
// This layer does not depend on KiCad: previews belong to the design loop, KiCad only owns the manufacturing exit (ADR-0005).
// It also does not depend on system fonts: text is drawn as paths (Hershey single-stroke font, see `font/`) --
// machines without fonts installed (containers, CI) still show text when opening the SVG.

import { strokeWidthFor, textStrokes } from "@texteda/core/font";

export type SvgOrientation = "y-up" | "y-down";

/** Fill semantics. Symbols reuse `none` / `outline` / `background` (spec/symbol.md §5); footprints use `solid` / `none`. */
export type SvgFill = "none" | "solid" | "outline" | "background";

export type SvgAnchor = "start" | "middle" | "end";

/** Semantic role of text: field text, pin name, pin number, footprint free text. */
export type SvgTextRole = "field" | "text" | "pinName" | "pinNumber";

export interface SvgPoint {
  x: number;
  y: number;
}

export interface SvgLine {
  kind: "line";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  widthNm: number;
  layer: string;
  unit?: number;
}

export interface SvgRect {
  kind: "rect";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  widthNm: number;
  fill: SvgFill;
  layer: string;
  unit?: number;
}

export interface SvgCircle {
  kind: "circle";
  cx: number;
  cy: number;
  rNm: number;
  widthNm: number;
  fill: SvgFill;
  layer: string;
  unit?: number;
}

export interface SvgArc {
  kind: "arc";
  x1: number;
  y1: number;
  xm: number;
  ym: number;
  x2: number;
  y2: number;
  widthNm: number;
  fill: SvgFill;
  layer: string;
  unit?: number;
}

/** Polyline (open, unfilled): clock wedges for pins, zigzags for non-logical pins. */
export interface SvgPolyline {
  kind: "polyline";
  points: { x: number; y: number }[];
  widthNm: number;
  fill: "none";
  layer: string;
  unit?: number;
}

export interface SvgPoly {
  kind: "poly";
  points: SvgPoint[];
  widthNm: number;
  fill: SvgFill;
  layer: string;
  unit?: number;
}

export interface SvgText {
  kind: "text";
  x: number;
  y: number;
  text: string;
  sizeNm: number;
  anchor: SvgAnchor;
  rotateMdeg?: number;
  role: SvgTextRole;
  /** Field name (present when role=field). */
  name?: string;
  layer?: string;
  /** Pin number (present when role=pinName / pinNumber). */
  pin?: string;
  unit?: number;
}

/** Symbol pin: connection point + orientation + length + style. Name and electrical type come from `component` (ADR-0012). */
export interface SvgPin {
  kind: "pin";
  number: string;
  name: string;
  type: string;
  x: number;
  y: number;
  rotMdeg: number;
  lengthNm: number;
  style: string;
  unit: number;
}

/**
 * Footprint pad. `shape` is the **drawing style** (rect / oval / circle); the IR's roundrect is
 * expressed via `rratioPpm` -- so reverse engineering can derive the IR shape from the drawing style rather than duplicating it.
 */
export interface SvgPad {
  kind: "pad";
  number: string;
  x: number;
  y: number;
  wNm: number;
  hNm: number;
  shape: "rect" | "oval" | "circle";
  rratioPpm?: number;
  /** Drill (nanometers); oval drills have x≠y. */
  drill?: { xNm: number; yNm: number };
  rotationMdeg?: number;
  layers: string[];
}

export type SvgPrimitive =
  | SvgLine
  | SvgRect
  | SvgCircle
  | SvgArc
  | SvgPoly
  | SvgPolyline
  | SvgText
  | SvgPin
  | SvgPad;

export interface SvgDoc {
  kind: "symbol" | "footprint" | "schematic";
  title: string;
  orientation: SvgOrientation;
  primitives: SvgPrimitive[];
}

/** Nanometers → millimeters, at most 6 decimal places, trailing zeros stripped (same formatting as the exporter). */
export function mm(nm: number): string {
  const s = (nm / 1e6).toFixed(6);
  const trimmed = s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
  return trimmed === "-0" ? "0" : trimmed;
}

/** Millidegrees → degrees. */
export function deg(mdeg: number): string {
  const s = (mdeg / 1000).toFixed(6);
  const trimmed = s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
  return trimmed === "-0" ? "0" : trimmed;
}

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Layer → color. Unrecognized layers fall back to neutral gray. */
const LAYER_STYLE: Record<string, { stroke: string; fill: string }> = {
  symbol: { stroke: "#111827", fill: "#111827" },
  power: { stroke: "#111827", fill: "#111827" },
  pin: { stroke: "#b45309", fill: "#b45309" },
  "F.Cu": { stroke: "#b45309", fill: "#b45309" },
  "B.Cu": { stroke: "#92400e", fill: "#92400e" },
  // `*.Cu` / `*.Mask` name every copper (or mask) layer at once: a through-hole pad is on both sides
  // (spec/footprint.md §4). A preview draws that pad once, in front-copper colour, because a single
  // image cannot show two sides; unrecognized layers would draw the pad with no fill at all.
  "*.Cu": { stroke: "#b45309", fill: "#b45309" },
  "*.Mask": { stroke: "#7c3aed", fill: "#7c3aed" },
  "F.SilkS": { stroke: "#9ca3af", fill: "none" },
  "B.SilkS": { stroke: "#9ca3af", fill: "none" },
  "F.Fab": { stroke: "#2563eb", fill: "none" },
  "B.Fab": { stroke: "#2563eb", fill: "none" },
  "F.CrtYd": { stroke: "#dc2626", fill: "none" },
  "B.CrtYd": { stroke: "#dc2626", fill: "none" },
  "F.Mask": { stroke: "#7c3aed", fill: "none" },
  "B.Mask": { stroke: "#7c3aed", fill: "none" },
  "F.Paste": { stroke: "#059669", fill: "none" },
  "B.Paste": { stroke: "#059669", fill: "none" },
  "F.Adhes": { stroke: "#0891b2", fill: "none" },
  "Edge.Cuts": { stroke: "#111827", fill: "none" },
  sheet: { stroke: "#9ca3af", fill: "none" },
  wire: { stroke: "#15803d", fill: "#15803d" },
  junction: { stroke: "#15803d", fill: "#15803d" },
  label: { stroke: "#111827", fill: "#111827" },
  port: { stroke: "#1d4ed8", fill: "#1d4ed8" },
  text: { stroke: "#374151", fill: "#374151" },
};

const DEFAULT_STYLE = { stroke: "#374151", fill: "none" };

/** Drawing style of a layer: stroke color + solid fill color. */
interface LayerStyle {
  stroke: string;
  fill: string;
}

function styleOf(layer: string): LayerStyle {
  return LAYER_STYLE[layer] ?? DEFAULT_STYLE;
}

/** SvgFill → the SVG fill attribute. */
function fillAttr(fill: SvgFill, style: LayerStyle): string {
  switch (fill) {
    case "solid":
    case "outline":
      return style.fill;
    case "background":
      return "#ffffff";
    default:
      return "none";
  }
}

/** Draw order: copper first, then silkscreen, then assembly layers; symbol items last. */
const LAYER_ORDER = [
  "F.Cu",
  "B.Cu",
  "*.Cu",
  "F.Mask",
  "B.Mask",
  "*.Mask",
  "F.Paste",
  "B.Paste",
  "F.SilkS",
  "B.SilkS",
  "F.Fab",
  "B.Fab",
  "F.CrtYd",
  "B.CrtYd",
  "Edge.Cuts",
  "sheet",
  "wire",
  "junction",
  "symbol",
  "power",
  "pin",
  "label",
  "port",
  "text",
];

export interface SvgBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Bounding box of the drawing commands (nanometers). Text gets an estimated box from its font size; good enough. */
export function bounds(doc: SvgDoc): SvgBounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const put = (x: number, y: number): void => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  for (const p of doc.primitives) {
    switch (p.kind) {
      case "line":
        put(p.x1, p.y1);
        put(p.x2, p.y2);
        break;
      case "rect":
        put(p.x1, p.y1);
        put(p.x2, p.y2);
        break;
      case "circle":
        put(p.cx - p.rNm, p.cy - p.rNm);
        put(p.cx + p.rNm, p.cy + p.rNm);
        break;
      case "arc":
        put(p.x1, p.y1);
        put(p.x2, p.y2);
        break;
      case "poly":
      case "polyline":
        for (const pt of p.points) put(pt.x, pt.y);
        break;
      case "text": {
        const half = p.sizeNm / 2;
        put(p.x - half, p.y - half);
        put(p.x + half, p.y + half);
        break;
      }
      case "pin":
        put(p.x, p.y);
        break;
      case "pad":
        put(p.x - p.wNm / 2, p.y - p.hNm / 2);
        put(p.x + p.wNm / 2, p.y + p.hNm / 2);
        break;
    }
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

/** y-up → y-down (SVG coordinates). */
function flip(doc: SvgDoc): (x: number, y: number) => [number, number] {
  return doc.orientation === "y-up" ? (x, y) => [x, -y] : (x, y) => [x, y];
}

export interface ArcGeometry {
  /** Arc radius (nanometers). */
  radiusNm: number;
  /** Whether it is a large arc (> 180°). */
  largeArc: 0 | 1;
  /** SVG sweep-flag: 1 = clockwise (the direction of increasing angle in SVG coordinates). */
  sweep: 0 | 1;
}

/**
 * Arc (start/mid/end) → the SVG A-command parameters.
 * The direction is determined by the three points: first solve the center and radius, then check whether "the positive angular increment from start to end" passes through the mid point;
 * if not, go around the other side. The returned `sweep` is already given in **source coordinates**; callers must negate it themselves when flipping y.
 */
export function arcGeometry(
  x1: number,
  y1: number,
  xm: number,
  ym: number,
  x2: number,
  y2: number,
): ArcGeometry | null {
  // Circle through three points: solve for the center and radius. No arc when collinear.
  const d = 2 * (x1 * (ym - y2) + xm * (y2 - y1) + x2 * (y1 - ym));
  if (d === 0) return null;
  const s1 = x1 * x1 + y1 * y1;
  const s2 = xm * xm + ym * ym;
  const s3 = x2 * x2 + y2 * y2;
  const cx = (s1 * (ym - y2) + s2 * (y2 - y1) + s3 * (y1 - ym)) / d;
  const cy = (s1 * (x2 - xm) + s2 * (x1 - x2) + s3 * (xm - x1)) / d;
  const radiusNm = Math.hypot(x1 - cx, y1 - cy);
  const a1 = Math.atan2(y1 - cy, x1 - cx);
  const am = Math.atan2(ym - cy, xm - cx);
  const a2 = Math.atan2(y2 - cy, x2 - cx);
  const twoPi = 2 * Math.PI;
  const norm = (a: number): number => ((a % twoPi) + twoPi) % twoPi;
  const forward = norm(a2 - a1);
  const midForward = norm(am - a1);
  // Angular increment from start to end: does the positive direction pass through the mid point? If not, go around the other side.
  const positive = midForward <= forward;
  const sweep = positive ? forward : forward - twoPi;
  const largeArc = Math.abs(sweep) > Math.PI ? 1 : 0;
  return { radiusNm, largeArc, sweep: positive ? 1 : 0 };
}

/** Drawing commands → SVG text. The same doc produces byte-identical output. */
export function toSvgText(doc: SvgDoc): string {
  const pad = 2_000_000; // 2mm margin
  const b = bounds(doc);
  const fy = flip(doc);
  // Move the bounding box into SVG coordinates (y down): y-up sources must be flipped first.
  const [x0, y0] =
    doc.orientation === "y-up" ? [b.minX, -b.maxY] : [b.minX, b.minY];
  const [x1, y1] =
    doc.orientation === "y-up" ? [b.maxX, -b.minY] : [b.maxX, b.maxY];
  const viewX = x0 - pad;
  const viewY = y0 - pad;
  const viewW = x1 - x0 + 2 * pad;
  const viewH = y1 - y0 + 2 * pad;

  const byLayer = new Map<string, SvgPrimitive[]>();
  const push = (layer: string, p: SvgPrimitive): void => {
    const list = byLayer.get(layer) ?? [];
    list.push(p);
    byLayer.set(layer, list);
  };
  for (const p of doc.primitives) {
    switch (p.kind) {
      case "text":
        push(p.layer ?? "text", p);
        break;
      case "pin":
        push("pin", p);
        break;
      case "pad":
        push(p.layers[0] ?? "F.Cu", p);
        break;
      default:
        push(p.layer, p);
    }
  }
  const layers = [...byLayer.keys()].sort((a, b) => {
    const ia = LAYER_ORDER.indexOf(a);
    const ib = LAYER_ORDER.indexOf(b);
    if (ia !== ib) return (ia < 0 ? LAYER_ORDER.length : ia) - (ib < 0 ? LAYER_ORDER.length : ib);
    return a < b ? -1 : a > b ? 1 : 0;
  });

  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${mm(viewW)}mm" height="${mm(viewH)}mm" viewBox="${mm(viewX)} ${mm(viewY)} ${mm(viewW)} ${mm(viewH)}">`,
  );
  out.push(`  <title>${esc(doc.title)}</title>`);
  out.push("  <style>");
  out.push("    .bg { fill: #ffffff; }");
  out.push("  </style>");
  out.push(`  <rect class="bg" x="${mm(viewX)}" y="${mm(viewY)}" width="${mm(viewW)}" height="${mm(viewH)}"/>`);

  for (const layer of layers) {
    const style = styleOf(layer);
    out.push(`  <g stroke="${style.stroke}" fill="${style.fill}" stroke-linecap="round" stroke-linejoin="round">`);
    for (const p of byLayer.get(layer) ?? []) {
      out.push(...primitiveSvg(p, fy, doc.orientation, style));
    }
    out.push("  </g>");
  }
  out.push("</svg>");
  return out.join("\n") + "\n";
}

type Flip = (x: number, y: number) => [number, number];

function primitiveSvg(
  p: SvgPrimitive,
  fy: Flip,
  docOrientation: SvgOrientation,
  style: LayerStyle,
): string[] {
  switch (p.kind) {
    case "line": {
      const [x1, y1] = fy(p.x1, p.y1);
      const [x2, y2] = fy(p.x2, p.y2);
      return [
        `    <line x1="${mm(x1)}" y1="${mm(y1)}" x2="${mm(x2)}" y2="${mm(y2)}" stroke-width="${mm(p.widthNm)}"/>`,
      ];
    }
    case "rect": {
      const [x1, y1] = fy(p.x1, p.y1);
      const [x2, y2] = fy(p.x2, p.y2);
      return [
        `    <rect x="${mm(Math.min(x1, x2))}" y="${mm(Math.min(y1, y2))}" width="${mm(Math.abs(x2 - x1))}" height="${mm(Math.abs(y2 - y1))}" fill="${fillAttr(p.fill, style)}" stroke-width="${mm(p.widthNm)}"/>`,
      ];
    }
    case "circle": {
      const [cx, cy] = fy(p.cx, p.cy);
      return [
        `    <circle cx="${mm(cx)}" cy="${mm(cy)}" r="${mm(p.rNm)}" fill="${fillAttr(p.fill, style)}" stroke-width="${mm(p.widthNm)}"/>`,
      ];
    }
    case "arc": {
      const [ax, ay] = fy(p.x1, p.y1);
      const [bx, by] = fy(p.x2, p.y2);
      const arc = arcGeometry(p.x1, p.y1, p.xm, p.ym, p.x2, p.y2);
      if (!arc) {
        // The three points are collinear: no arc, draw a polyline.
        return [
          `    <polyline points="${mm(ax)},${mm(ay)} ${mm(bx)},${mm(by)}" fill="none" stroke-width="${mm(p.widthNm)}"/>`,
        ];
      }
      // Flipping y mirrors the handedness: when the source coordinates "sweep in the negative direction", switch to the positive direction in SVG.
      const mirrored = docOrientation === "y-up";
      const sweep = mirrored ? (arc.sweep === 1 ? 0 : 1) : arc.sweep;
      return [
        `    <path d="M ${mm(ax)} ${mm(ay)} A ${mm(arc.radiusNm)} ${mm(arc.radiusNm)} 0 ${arc.largeArc} ${sweep} ${mm(bx)} ${mm(by)}" fill="none" stroke-width="${mm(p.widthNm)}"/>`,
      ];
    }
    case "poly": {
      const pts = p.points.map((pt) => {
        const [x, y] = fy(pt.x, pt.y);
        return `${mm(x)},${mm(y)}`;
      });
      return [
        `    <polygon points="${pts.join(" ")}" fill="${fillAttr(p.fill, style)}" stroke-width="${mm(p.widthNm)}"/>`,
      ];
    }
    case "polyline": {
      const pts = p.points.map((pt) => {
        const [x, y] = fy(pt.x, pt.y);
        return `${mm(x)},${mm(y)}`;
      });
      return [
        `    <polyline points="${pts.join(" ")}" fill="none" stroke-width="${mm(p.widthNm)}"/>`,
      ];
    }
    case "text": {
      // Text is drawn as **paths** (Hershey single-stroke font), with no system font dependency:
      // machines without fonts installed can still see the text when opening the SVG.
      const strokes = textStrokes(p.text, {
        x: p.x,
        y: p.y,
        sizeNm: p.sizeNm,
        anchor: p.anchor,
        yDown: docOrientation === "y-down",
      });
      if (strokes.length === 0) return [];
      const color = p.role === "pinName" || p.role === "pinNumber" ? "#6b7280" : "#111827";
      const width = strokeWidthFor(p.sizeNm);
      // Rotation happens in the **model coordinate system**: angles are always interpreted as "visually counterclockwise" (symbols +y up,
      // footprints +y down, so the signs in the numeric matrix are reversed; see `rotateModel`).
      const rot = p.rotateMdeg ? rotateModel(p.x, p.y, p.rotateMdeg, docOrientation === "y-down") : null;
      const d = strokes
        .map((s) => {
          const pts = s.points.map((pt) => {
            const q = rot ? rot(pt.x, pt.y) : pt;
            const [sx, sy] = fy(q.x, q.y);
            return `${mm(sx)},${mm(sy)}`;
          });
          return `M${pts.join("L")}`;
        })
        .join("");
      return [
        `    <g><title>${esc(p.text)}</title>`,
        `    <path d="${d}" fill="none" stroke="${color}" stroke-width="${mm(width)}" stroke-linecap="round" stroke-linejoin="round"/>`,
        "    </g>",
      ];
    }
    case "pin": {
      const dir = pinDirection(p.rotMdeg);
      const [ax, ay] = fy(p.x, p.y);
      const [bx, by] = fy(p.x + dir.x * p.lengthNm, p.y + dir.y * p.lengthNm);
      return [
        `    <line x1="${mm(ax)}" y1="${mm(ay)}" x2="${mm(bx)}" y2="${mm(by)}" stroke-width="${mm(127000)}"/>`,
      ];
    }
    case "pad": {
      const [cx, cy] = fy(p.x, p.y);
      const out: string[] = [];
      if (p.shape === "circle") {
        out.push(
          `    <circle cx="${mm(cx)}" cy="${mm(cy)}" r="${mm(p.wNm / 2)}" fill="${style.fill}" stroke="none"/>`,
        );
      } else if (p.shape === "oval") {
        out.push(
          `    <ellipse cx="${mm(cx)}" cy="${mm(cy)}" rx="${mm(p.wNm / 2)}" ry="${mm(p.hNm / 2)}" fill="${style.fill}" stroke="none"/>`,
        );
      } else {
        const rx = p.rratioPpm !== undefined ? (Math.min(p.wNm, p.hNm) * (p.rratioPpm / 1e6)) / 2 : 0;
        out.push(
          `    <rect x="${mm(cx - p.wNm / 2)}" y="${mm(cy - p.hNm / 2)}" width="${mm(p.wNm)}" height="${mm(p.hNm)}"${rx > 0 ? ` rx="${mm(rx)}"` : ""} fill="${style.fill}" stroke="none"/>`,
        );
      }
      if (p.drill) {
        if (p.drill.xNm === p.drill.yNm) {
          out.push(
            `    <circle cx="${mm(cx)}" cy="${mm(cy)}" r="${mm(p.drill.xNm / 2)}" fill="#ffffff" stroke="none"/>`,
          );
        } else {
          out.push(
            `    <ellipse cx="${mm(cx)}" cy="${mm(cy)}" rx="${mm(p.drill.xNm / 2)}" ry="${mm(p.drill.yNm / 2)}" fill="#ffffff" stroke="none"/>`,
          );
        }
      }
      return out;
    }
  }
}

/**
 * Pin orientation → unit direction (symbol coordinates: +x right, +y up).
 * `rotMdeg` is in **millidegrees** (IR convention, ADR-0004 decision 3): 90° = 90000.
 */
export function pinDirection(rotMdeg: number): { x: number; y: number } {
  const r = ((rotMdeg % 360_000) + 360_000) % 360_000;
  switch (r) {
    case 90_000:
      return { x: 0, y: 1 };
    case 180_000:
      return { x: -1, y: 0 };
    case 270_000:
      return { x: 0, y: -1 };
    default:
      return { x: 1, y: 0 };
  }
}

/**
 * Rotate a point in model coordinates around an anchor.
 *
 * Angles are interpreted as **visually counterclockwise** (KiCad's convention):
 *   - Symbols (+y up): the numeric matrix is the standard mathematical rotation.
 *   - Footprints (+y down): the numeric matrix is inverted -- because numeric +y points down, a positive angle is visually clockwise.
 */
function rotateModel(
  cx: number,
  cy: number,
  mdeg: number,
  yDown: boolean,
): (x: number, y: number) => { x: number; y: number } {
  const rad = (mdeg * Math.PI) / 180_000;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const s = yDown ? -sin : sin;
  return (x, y) => {
    const dx = x - cx;
    const dy = y - cy;
    return {
      x: Math.round(cx + dx * cos - dy * s),
      y: Math.round(cy + dx * s + dy * cos),
    };
  };
}

/** Geometric self-check of the drawing commands. Returns a list of problems; empty array = no problems. */
export function validateDoc(doc: SvgDoc): string[] {
  const problems: string[] = [];
  const isInt = (v: number): boolean => Number.isInteger(v);
  for (const p of doc.primitives) {
    const tag = `${p.kind}${p.kind === "pin" || p.kind === "pad" || p.kind === "text" ? `(${p.kind === "pin" || p.kind === "pad" ? p.number : p.text})` : ""}`;
    switch (p.kind) {
      case "line":
        if (![p.x1, p.y1, p.x2, p.y2, p.widthNm].every(isInt)) problems.push(`${tag}: coordinates are not integer nanometers`);
        if (p.x1 === p.x2 && p.y1 === p.y2) problems.push(`${tag}: zero-length line`);
        break;
      case "rect":
        if (![p.x1, p.y1, p.x2, p.y2, p.widthNm].every(isInt)) problems.push(`${tag}: coordinates are not integer nanometers`);
        if (p.x1 === p.x2 || p.y1 === p.y2) problems.push(`${tag}: degenerates to a line`);
        break;
      case "circle":
        if (![p.cx, p.cy, p.rNm].every(isInt)) problems.push(`${tag}: coordinates are not integer nanometers`);
        if (p.rNm <= 0) problems.push(`${tag}: non-positive radius`);
        break;
      case "arc":
        if (![p.x1, p.y1, p.xm, p.ym, p.x2, p.y2].every(isInt)) problems.push(`${tag}: coordinates are not integer nanometers`);
        break;
      case "poly":
        if (p.points.length < 3) problems.push(`${tag}: polygon point count < 3`);
        if (!p.points.every((pt) => isInt(pt.x) && isInt(pt.y))) problems.push(`${tag}: coordinates are not integer nanometers`);
        break;
      case "polyline":
        if (p.points.length < 2) problems.push(`${tag}: polyline point count < 2`);
        if (!p.points.every((pt) => isInt(pt.x) && isInt(pt.y))) problems.push(`${tag}: coordinates are not integer nanometers`);
        break;
      case "text":
        if (![p.x, p.y, p.sizeNm].every(isInt)) problems.push(`${tag}: coordinates are not integer nanometers`);
        if (p.sizeNm <= 0) problems.push(`${tag}: non-positive font size`);
        if (p.text.length === 0) problems.push(`${tag}: empty text`);
        break;
      case "pin":
        if (![p.x, p.y, p.lengthNm, p.rotMdeg].every(isInt)) problems.push(`${tag}: coordinates are not integer nanometers`);
        if (p.lengthNm <= 0) problems.push(`${tag}: non-positive pin length`);
        if (p.unit < 0) problems.push(`${tag}: invalid unit number`);
        break;
      case "pad":
        if (![p.x, p.y, p.wNm, p.hNm].every(isInt)) problems.push(`${tag}: coordinates are not integer nanometers`);
        if (p.wNm <= 0 || p.hNm <= 0) problems.push(`${tag}: non-positive pad size`);
        break;
    }
  }
  return problems;
}
