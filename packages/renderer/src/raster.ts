// Rasterize a drawing into pixels.
//
// The drawing commands are the ones the SVG backend writes (`SvgDoc`), so a picture and the SVG
// show the same geometry in the same colours (spec/rendering.md §2). The point of the second
// backend is that looking at a drawing must not require anything that is not installed: no
// browser, no native rasterizer, no KiCad (ADR-0036 decision 7, ADR-0072).
//
// It is a picture, not a measurement (spec/rendering.md §3): fills are approximations, stroke
// widths are quantised to whole pixels, and no conclusion about where a feature is may be drawn
// from these pixels. The numbers come from `view metrics` and from the diagnostics.
import { strokeWidthFor, textStrokes } from "@texteda/core/font";
import {
  arcGeometry,
  bounds,
  layerOrderIndex,
  layerStyle,
  pinDirection,
  rotateModel,
  type SvgDoc,
  type SvgPrimitive,
} from "./svg.ts";

/** The margin the SVG backend leaves around the drawing, in nanometres. */
const MARGIN_NM = 2_000_000;

/** A picture: RGB, three bytes per pixel, row-major, the top row first. */
export interface RasterImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

/** The part of the drawing to paint, in nanometres. */
export interface RasterCrop {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export interface RasterOptions {
  /** Picture width in pixels; the height follows the drawn area's aspect ratio. */
  readonly widthPx?: number;
  /** The part of the drawing to paint; the whole drawing by default. */
  readonly crop?: RasterCrop;
  /** Background colour; white by default, like the SVG backend's background rectangle. */
  readonly background?: string;
  /** Samples per pixel per axis; 3 by default. */
  readonly samples?: number;
}

type Rgb = [number, number, number];

function parseColor(color: string): Rgb {
  const hex = color.replace("#", "").trim();
  if (hex.length !== 6) return [0, 0, 0];
  const value = Number.parseInt(hex, 16);
  if (Number.isNaN(value)) return [0, 0, 0];
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

/** The painted area: the drawing's bounds plus the same margin the SVG backend leaves. */
export function drawingArea(doc: SvgDoc): RasterCrop {
  const b = bounds(doc);
  return {
    x0: b.minX - MARGIN_NM,
    y0: b.minY - MARGIN_NM,
    x1: b.maxX + MARGIN_NM,
    y1: b.maxY + MARGIN_NM,
  };
}

/** The drawing commands in the order the SVG backend draws them: by layer, then as they come. */
function orderedPrimitives(doc: SvgDoc): SvgPrimitive[] {
  return [...doc.primitives].sort((a, b) => {
    const layerA = a.kind === "text" ? (a.layer ?? "text") : a.kind === "pin" ? "pin" : a.kind === "pad" ? (a.layers[0] ?? "F.Cu") : a.layer;
    const layerB = b.kind === "text" ? (b.layer ?? "text") : b.kind === "pin" ? "pin" : b.kind === "pad" ? (b.layers[0] ?? "F.Cu") : b.layer;
    const order = layerOrderIndex(layerA) - layerOrderIndex(layerB);
    return order !== 0 ? order : 0;
  });
}

interface Surface {
  readonly width: number;
  readonly height: number;
  readonly data: Float64Array;
}

function makeSurface(width: number, height: number, background: Rgb): Surface {
  const surface: Surface = { width, height, data: new Float64Array(width * height * 3) };
  for (let i = 0; i < width * height; i++) {
    surface.data[i * 3] = background[0] / 255;
    surface.data[i * 3 + 1] = background[1] / 255;
    surface.data[i * 3 + 2] = background[2] / 255;
  }
  return surface;
}

interface Frame {
  readonly surface: Surface;
  /** Model nanometres → pixels. */
  readonly toX: (x: number) => number;
  readonly toY: (y: number) => number;
  /** Model nanometres → pixels. */
  readonly scale: number;
  readonly yDown: boolean;
}

function blend(surface: Surface, x: number, y: number, color: Rgb, alpha: number): void {
  if (x < 0 || y < 0 || x >= surface.width || y >= surface.height || alpha <= 0) return;
  const i = (y * surface.width + x) * 3;
  surface.data[i] = surface.data[i]! * (1 - alpha) + (color[0] / 255) * alpha;
  surface.data[i + 1] = surface.data[i + 1]! * (1 - alpha) + (color[1] / 255) * alpha;
  surface.data[i + 2] = surface.data[i + 2]! * (1 - alpha) + (color[2] / 255) * alpha;
}

/**
 * Paint a shape, given as "is this pixel inside?", with `samples` × `samples` samples per pixel.
 *
 * The samples are what makes a thin diagonal stroke look like a stroke instead of a dotted line:
 * a pixel is covered in proportion to the samples that fall inside the shape.
 */
function paint(
  frame: Frame,
  box: [number, number, number, number],
  inside: (x: number, y: number) => boolean,
  color: Rgb,
  samples: number,
): void {
  const x0 = Math.max(0, Math.floor(box[0]));
  const x1 = Math.min(frame.surface.width - 1, Math.ceil(box[1]));
  const y0 = Math.max(0, Math.floor(box[2]));
  const y1 = Math.min(frame.surface.height - 1, Math.ceil(box[3]));
  const step = 1 / samples;
  const total = samples * samples;
  for (let py = y0; py <= y1; py++) {
    for (let px = x0; px <= x1; px++) {
      let hits = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          if (inside(px + (sx + 0.5) * step, py + (sy + 0.5) * step)) hits++;
        }
      }
      if (hits > 0) blend(frame.surface, px, py, color, hits / total);
    }
  }
}

function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function pointInPolygon(px: number, py: number, points: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i]!;
    const b = points[j]!;
    if (a.y > py !== b.y > py && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Stroke a polyline: a stroke is a disc of half the width swept along the path. */
function strokePath(
  frame: Frame,
  points: { x: number; y: number }[],
  widthNm: number,
  color: Rgb,
  samples: number,
): void {
  if (points.length < 2) return;
  const half = Math.max(frame.scale * widthNm * 0.5, 0.35);
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const ax = frame.toX(a.x);
    const ay = frame.toY(a.y);
    const bx = frame.toX(b.x);
    const by = frame.toY(b.y);
    paint(
      frame,
      [Math.min(ax, bx) - half - 1, Math.max(ax, bx) + half + 1, Math.min(ay, by) - half - 1, Math.max(ay, by) + half + 1],
      (x, y) => distanceToSegment(x, y, ax, ay, bx, by) <= half,
      color,
      samples,
    );
  }
}

/** Fill a closed polygon with the even-odd rule. */
function fillPath(
  frame: Frame,
  points: { x: number; y: number }[],
  color: Rgb,
  samples: number,
): void {
  if (points.length < 3) return;
  const projected = points.map((point) => ({ x: frame.toX(point.x), y: frame.toY(point.y) }));
  const xs = projected.map((point) => point.x);
  const ys = projected.map((point) => point.y);
  paint(
    frame,
    [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)],
    (x, y) => pointInPolygon(x, y, projected),
    color,
    samples,
  );
}

/** The arc's points: the circle through the three given points, sampled along the arc. */
function arcPoints(
  x1: number,
  y1: number,
  xm: number,
  ym: number,
  x2: number,
  y2: number,
): { x: number; y: number }[] {
  const geometry = arcGeometry(x1, y1, xm, ym, x2, y2);
  if (!geometry) {
    return [
      { x: x1, y: y1 },
      { x: x2, y: y2 },
    ];
  }
  // Centre and radius of the circle through the three points.
  const d = 2 * (x1 * (ym - y2) + xm * (y2 - y1) + x2 * (y1 - ym));
  const s1 = x1 * x1 + y1 * y1;
  const s2 = xm * xm + ym * ym;
  const s3 = x2 * x2 + y2 * y2;
  const cx = (s1 * (ym - y2) + s2 * (y2 - y1) + s3 * (y1 - ym)) / d;
  const cy = (s1 * (x2 - xm) + s2 * (x1 - x2) + s3 * (xm - x1)) / d;
  const radius = Math.hypot(x1 - cx, y1 - cy);
  const start = Math.atan2(y1 - cy, x1 - cx);
  const middle = Math.atan2(ym - cy, xm - cx);
  const end = Math.atan2(y2 - cy, x2 - cx);
  const twoPi = 2 * Math.PI;
  const norm = (angle: number): number => ((angle % twoPi) + twoPi) % twoPi;
  const forward = norm(end - start);
  const middleForward = norm(middle - start);
  // The positive direction wins when it passes through the mid point; otherwise the arc goes the other way.
  const sweep = middleForward <= forward ? forward : forward - twoPi;
  const steps = Math.max(8, Math.ceil((Math.abs(sweep) * radius) / 50_000));
  const points: { x: number; y: number }[] = [];
  for (let step = 0; step <= steps; step++) {
    const angle = start + (sweep * step) / steps;
    points.push({ x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius });
  }
  return points;
}

/** The text colour the SVG backend uses: pin names and pin numbers are grey, everything else is near-black. */
function textColor(role: string): Rgb {
  return role === "pinName" || role === "pinNumber" ? parseColor("#6b7280") : parseColor("#111827");
}

/**
 * Paint a drawing into pixels.
 *
 * The same drawing commands, the same colours and the same draw order as the SVG backend, so the
 * picture and the SVG show the same thing (spec/rendering.md §2).
 */
export function rasterize(doc: SvgDoc, options: RasterOptions = {}): RasterImage {
  const samples = Math.max(1, Math.min(8, Math.round(options.samples ?? 3)));
  const widthPx = Math.max(1, Math.round(options.widthPx ?? 1024));
  const area = options.crop ?? drawingArea(doc);
  const widthNm = Math.max(1, area.x1 - area.x0);
  const heightNm = Math.max(1, area.y1 - area.y0);
  const scale = widthPx / widthNm;
  const heightPx = Math.max(1, Math.round(heightNm * scale));
  const background = parseColor(options.background ?? "#ffffff");
  const surface = makeSurface(widthPx, heightPx, background);
  const yDown = doc.orientation === "y-down";
  const frame: Frame = {
    surface,
    toX: (x) => (x - area.x0) * scale,
    toY: (y) => (yDown ? y - area.y0 : area.y1 - y) * scale,
    scale,
    yDown,
  };

  for (const p of orderedPrimitives(doc)) {
    switch (p.kind) {
      case "line": {
        const style = layerStyle(p.layer);
        strokePath(frame, [{ x: p.x1, y: p.y1 }, { x: p.x2, y: p.y2 }], p.widthNm, parseColor(style.stroke), samples);
        break;
      }
      case "polyline": {
        const style = layerStyle(p.layer);
        strokePath(frame, p.points, p.widthNm, parseColor(style.stroke), samples);
        break;
      }
      case "poly": {
        const style = layerStyle(p.layer);
        const fill = p.fill === "none" ? null : parseColor(p.fill === "background" ? "#ffffff" : style.fill);
        if (fill) fillPath(frame, p.points, fill, samples);
        strokePath(frame, [...p.points, p.points[0]!], p.widthNm, parseColor(style.stroke), samples);
        break;
      }
      case "rect": {
        const style = layerStyle(p.layer);
        const fill = p.fill === "none" ? null : parseColor(p.fill === "background" ? "#ffffff" : style.fill);
        const corners = [
          { x: p.x1, y: p.y1 },
          { x: p.x2, y: p.y1 },
          { x: p.x2, y: p.y2 },
          { x: p.x1, y: p.y2 },
        ];
        if (fill) fillPath(frame, corners, fill, samples);
        strokePath(frame, [...corners, corners[0]!], p.widthNm, parseColor(style.stroke), samples);
        break;
      }
      case "circle": {
        const style = layerStyle(p.layer);
        const fill = p.fill === "none" ? null : parseColor(p.fill === "background" ? "#ffffff" : style.fill);
        const cx = frame.toX(p.cx);
        const cy = frame.toY(p.cy);
        const radius = Math.max(0.35, p.rNm * scale);
        const half = Math.max(frame.scale * p.widthNm * 0.5, 0.35);
        if (fill) {
          paint(frame, [cx - radius, cx + radius, cy - radius, cy + radius], (x, y) => Math.hypot(x - cx, y - cy) <= radius, fill, samples);
        }
        paint(
          frame,
          [cx - radius - half - 1, cx + radius + half + 1, cy - radius - half - 1, cy + radius + half + 1],
          (x, y) => Math.abs(Math.hypot(x - cx, y - cy) - radius) <= half,
          parseColor(style.stroke),
          samples,
        );
        break;
      }
      case "arc": {
        const style = layerStyle(p.layer);
        strokePath(frame, arcPoints(p.x1, p.y1, p.xm, p.ym, p.x2, p.y2), p.widthNm, parseColor(style.stroke), samples);
        break;
      }
      case "text": {
        if (p.hidden) break; // the SVG backend hides it too
        const strokes = textStrokes(p.text, {
          x: p.x,
          y: p.y,
          sizeNm: p.sizeNm,
          anchor: p.anchor,
          yDown,
        });
        if (strokes.length === 0) break;
        const rotate = p.rotateMdeg ? rotateModel(p.x, p.y, p.rotateMdeg, yDown) : null;
        const color = textColor(p.role);
        const width = strokeWidthFor(p.sizeNm);
        for (const stroke of strokes) {
          const points = stroke.points.map((point) => (rotate ? rotate(point.x, point.y) : point));
          strokePath(frame, points, width, color, samples);
        }
        break;
      }
      case "pin": {
        const style = layerStyle("pin");
        const direction = pinDirection(p.rotMdeg);
        strokePath(
          frame,
          [
            { x: p.x, y: p.y },
            { x: p.x + direction.x * p.lengthNm, y: p.y + direction.y * p.lengthNm },
          ],
          127_000,
          parseColor(style.stroke),
          samples,
        );
        break;
      }
      case "pad": {
        const style = layerStyle(p.layers[0] ?? "F.Cu");
        const fill = parseColor(style.fill);
        const cx = frame.toX(p.x);
        const cy = frame.toY(p.y);
        const halfWidth = Math.max(0.35, (p.wNm * scale) / 2);
        const halfHeight = Math.max(0.35, (p.hNm * scale) / 2);
        paint(
          frame,
          [cx - halfWidth, cx + halfWidth, cy - halfHeight, cy + halfHeight],
          (x, y) => {
            if (p.shape === "circle") return Math.hypot(x - cx, y - cy) <= halfWidth;
            if (p.shape === "oval") return ((x - cx) / halfWidth) ** 2 + ((y - cy) / halfHeight) ** 2 <= 1;
            return true;
          },
          fill,
          samples,
        );
        if (p.drill) {
          const drill = p.drill;
          const dx = frame.toX(drill.xNm);
          const dy = frame.toY(drill.yNm);
          const radius = Math.max(0.6, (drill.xNm * scale) / 2);
          paint(
            frame,
            [dx - radius - radius, dx + radius + radius, dy - radius - radius, dy + radius + radius],
            (x, y) => {
              if (drill.xNm === drill.yNm) return Math.hypot(x - dx, y - dy) <= radius;
              return ((x - dx) / radius) ** 2 + ((y - dy) / radius) ** 2 <= 1;
            },
            background,
            samples,
          );
        }
        break;
      }
    }
  }

  const data = new Uint8Array(widthPx * heightPx * 3);
  for (let i = 0; i < widthPx * heightPx; i++) {
    data[i * 3] = Math.round(Math.max(0, Math.min(1, surface.data[i * 3]!)) * 255);
    data[i * 3 + 1] = Math.round(Math.max(0, Math.min(1, surface.data[i * 3 + 1]!)) * 255);
    data[i * 3 + 2] = Math.round(Math.max(0, Math.min(1, surface.data[i * 3 + 2]!)) * 255);
  }
  return { width: widthPx, height: heightPx, data };
}
