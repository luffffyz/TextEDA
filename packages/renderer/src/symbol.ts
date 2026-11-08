// Symbol IR -> drawing primitives.
//
// Symbols are **views** (ADR-0031): pin placement, outline, units, and visibility toggles live here;
// pin names and electrical types belong to `component`, looked up by pin number at render time.
import { strokeWidthFor, textStrokes } from "@texteda/core/font";
import type { Symbol } from "@texteda/ir/symbol";
import { arcGeometry, pinDirection, type SvgAnchor, type SvgDoc, type SvgFill, type SvgPrimitive } from "./svg.ts";

export type SymbolBody = Symbol["symbol"];
type Pin = SymbolBody["pins"][number];
type BodyItem = NonNullable<SymbolBody["body"]>[number];
type Field = NonNullable<SymbolBody["fields"]>[number];

/** The facts from `component` needed to render a symbol (same conventions as the exporter). */
export interface SymbolPartPin {
  number: string;
  name: string;
  type: string;
}

export interface SymbolPart {
  pins: SymbolPartPin[];
}

const DEFAULT_NAME_OFFSET_NM = 508_000;
const DEFAULT_TEXT_SIZE_NM = 1_270_000;
const NUMBER_TEXT_SIZE_NM = 1_270_000;
/** Exact clear distance from pin lines and painted symbol-body bounds to number ink. */
const NUMBER_TEXT_CLEARANCE_NM = 500_000;
/** Legacy anchor distance when a symbol has no visible body frame. */
const NUMBER_TEXT_BODY_FALLBACK_OFFSET_NM = 1_200_000;
/** Exact clear distance from a visible symbol-body frame to pin-name ink. */
const PIN_NAME_BODY_CLEARANCE_NM = 400_000;
/** Inversion bubble radius (KiCad default 0.254mm). */
const BUBBLE_RADIUS_NM = 254_000;
/** Clock wedge length and half-width. */
const CLOCK_WEDGE_LEN_NM = 508_000;
const CLOCK_WEDGE_HALF_NM = 254_000;

interface TextInkEdges {
  left: number;
  right: number;
  bottom: number;
  top: number;
}

/** Rotate a point around the text anchor using the symbol's y-up model coordinates. */
function rotateTextPoint(x: number, y: number, rotateMdeg: number): { x: number; y: number } {
  const rotation = ((rotateMdeg % 360_000) + 360_000) % 360_000;
  if (rotation === 0) return { x, y };
  const rad = (rotation * Math.PI) / 180_000;
  return {
    x: Math.round(x * Math.cos(rad) - y * Math.sin(rad)),
    y: Math.round(x * Math.sin(rad) + y * Math.cos(rad)),
  };
}

/** Painted bounds relative to a text label's anchor, including the rendered stroke width. */
function textInkEdges(
  text: string,
  sizeNm: number,
  anchor: SvgAnchor,
  rotateMdeg = 0,
): TextInkEdges {
  const strokes = textStrokes(text, {
    x: 0,
    y: 0,
    sizeNm,
    anchor,
    yDown: false,
  });
  let left = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.POSITIVE_INFINITY;
  let top = Number.NEGATIVE_INFINITY;
  for (const stroke of strokes) {
    for (const point of stroke.points) {
      const rotated = rotateTextPoint(point.x, point.y, rotateMdeg);
      left = Math.min(left, rotated.x);
      right = Math.max(right, rotated.x);
      bottom = Math.min(bottom, rotated.y);
      top = Math.max(top, rotated.y);
    }
  }
  if (!Number.isFinite(left) || !Number.isFinite(right) || !Number.isFinite(bottom) || !Number.isFinite(top)) {
    return { left: 0, right: 0, bottom: 0, top: 0 };
  }
  const halfStroke = strokeWidthFor(sizeNm) / 2;
  return {
    left: left - halfStroke,
    right: right + halfStroke,
    bottom: bottom - halfStroke,
    top: top + halfStroke,
  };
}


interface PinNamePlacement {
  x: number;
  y: number;
  anchor: SvgAnchor;
  rotateMdeg?: number;
}


/** Painted bounds relative to a middle-anchored pin-number label's anchor. */
function pinNumberInkEdges(text: string, rotateMdeg: number): TextInkEdges {
  return textInkEdges(text, NUMBER_TEXT_SIZE_NM, "middle", rotateMdeg);
 }


interface BodyFrameBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  innerMinX: number;
  innerMinY: number;
  innerMaxX: number;
  innerMaxY: number;
}

/** Axis-aligned outer and inner painted frames of visible symbol-body geometry. */
function symbolBodyBounds(body: readonly BodyItem[] | undefined): BodyFrameBounds | undefined {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let innerMinX = Number.POSITIVE_INFINITY;
  let innerMinY = Number.POSITIVE_INFINITY;
  let innerMaxX = Number.NEGATIVE_INFINITY;
  let innerMaxY = Number.NEGATIVE_INFINITY;
  const include = (x: number, y: number, margin: number): void => {
    minX = Math.min(minX, x - margin);
    minY = Math.min(minY, y - margin);
    maxX = Math.max(maxX, x + margin);
    maxY = Math.max(maxY, y + margin);
    innerMinX = Math.min(innerMinX, x + margin);
    innerMinY = Math.min(innerMinY, y + margin);
    innerMaxX = Math.max(innerMaxX, x - margin);
    innerMaxY = Math.max(innerMaxY, y - margin);
  };

  for (const item of body ?? []) {
    const width = item.width_nm ?? 0;
    const filled = item.kind !== "line" && item.kind !== "arc" && item.fill !== undefined && item.fill !== "none";
    if (width <= 0 && !filled) continue;
    const halfWidth = Math.max(0, width) / 2;
    switch (item.kind) {
      case "line":
      case "rect": {
        const start = item.start!;
        const end = item.end!;
        include(start.x_nm, start.y_nm, halfWidth);
        include(end.x_nm, end.y_nm, halfWidth);
        break;
      }
      case "circle": {
        const center = item.center!;
        const radius = item.radius_nm!;
        include(center.x_nm - radius, center.y_nm - radius, halfWidth);
        include(center.x_nm + radius, center.y_nm + radius, halfWidth);
        break;
      }
      case "arc": {
        const start = item.start!;
        const mid = item.mid!;
        const end = item.end!;
        include(start.x_nm, start.y_nm, halfWidth);
        include(mid.x_nm, mid.y_nm, halfWidth);
        include(end.x_nm, end.y_nm, halfWidth);
        const arc = arcGeometry(start.x_nm, start.y_nm, mid.x_nm, mid.y_nm, end.x_nm, end.y_nm);
        if (!arc) break;

        const d = 2 * (
          start.x_nm * (mid.y_nm - end.y_nm) +
          mid.x_nm * (end.y_nm - start.y_nm) +
          end.x_nm * (start.y_nm - mid.y_nm)
        );
        const s1 = start.x_nm * start.x_nm + start.y_nm * start.y_nm;
        const s2 = mid.x_nm * mid.x_nm + mid.y_nm * mid.y_nm;
        const s3 = end.x_nm * end.x_nm + end.y_nm * end.y_nm;
        const cx = (s1 * (mid.y_nm - end.y_nm) + s2 * (end.y_nm - start.y_nm) + s3 * (start.y_nm - mid.y_nm)) / d;
        const cy = (s1 * (end.x_nm - mid.x_nm) + s2 * (start.x_nm - end.x_nm) + s3 * (mid.x_nm - start.x_nm)) / d;
        const startAngle = Math.atan2(start.y_nm - cy, start.x_nm - cx);
        const endAngle = Math.atan2(end.y_nm - cy, end.x_nm - cx);
        const twoPi = 2 * Math.PI;
        const forwardRaw = endAngle - startAngle;
        const forward = ((forwardRaw % twoPi) + twoPi) % twoPi;
        const positive = arc.sweep === 1;
        const sweep = positive ? forward : forward - twoPi;
        for (let index = 0; index < 4; index += 1) {
          const angle = index * Math.PI / 2;
          const deltaRaw = positive ? angle - startAngle : startAngle - angle;
          const delta = ((deltaRaw % twoPi) + twoPi) % twoPi;
          if (delta <= Math.abs(sweep) + 1e-12) {
            include(cx + arc.radiusNm * Math.cos(angle), cy + arc.radiusNm * Math.sin(angle), halfWidth);
          }
        }
        break;
      }
      case "poly":
        for (const point of item.points!) include(point.x_nm, point.y_nm, halfWidth);
        break;
    }
  }
  if (!Number.isFinite(minX)) return undefined;
  return {
    minX: Math.floor(minX),
    minY: Math.floor(minY),
    maxX: Math.ceil(maxX),
    maxY: Math.ceil(maxY),
    innerMinX: Math.ceil(innerMinX),
    innerMinY: Math.ceil(innerMinY),
    innerMaxX: Math.floor(innerMaxX),
    innerMaxY: Math.floor(innerMaxY),
  };
}

/** How a symbol pin is drawn: the connection point is at the pin's "outer" end and the line runs toward the inside of the symbol body (spec/symbol.md §4). */
export function renderSymbol(sym: SymbolBody, part: SymbolPart): SvgDoc {
  const primitives: SvgPrimitive[] = [];
  const names = new Map(part.pins.map((p) => [p.number, p]));
  const bodyBounds = symbolBodyBounds(sym.body);

  for (const item of sym.body ?? []) {
    primitives.push(...bodyPrimitives(item, sym.power));
  }
  const pinNamePlacements = new Map<Pin, PinNamePlacement>();
  if (bodyBounds && !sym.pin_names_hidden) {
    for (const pin of sym.pins) {
      const info = names.get(pin.number);
      const name = info?.name ?? "";
      if (name.length === 0) continue;

      const rot = pin.at.rotation_mdeg ?? 0;
      const dir = pinDirection(rot);
      const inner = {
        x: pin.at.x_nm + dir.x * pin.length_nm,
        y: pin.at.y_nm + dir.y * pin.length_nm,
      };
      if (dir.x !== 0) {
        const anchor = dir.x < 0 ? "end" : "start";
        const ink = textInkEdges(name, DEFAULT_TEXT_SIZE_NM, anchor);
        pinNamePlacements.set(pin, {
          x: dir.x > 0
            ? bodyBounds.innerMinX + PIN_NAME_BODY_CLEARANCE_NM - ink.left
            : bodyBounds.innerMaxX - PIN_NAME_BODY_CLEARANCE_NM - ink.right,
          y: inner.y,
          anchor,
        });
        continue;
      }

      const anchor = "start" as const;
      const rotateMdeg = 90_000;
      const ink = textInkEdges(name, DEFAULT_TEXT_SIZE_NM, anchor, rotateMdeg);
      const y = dir.y > 0
        ? bodyBounds.innerMinY + PIN_NAME_BODY_CLEARANCE_NM - ink.bottom
        : bodyBounds.innerMaxY - PIN_NAME_BODY_CLEARANCE_NM - ink.top;
      pinNamePlacements.set(pin, {
        x: inner.x,
        y,
        anchor,
        rotateMdeg,
      });
    }
  }

  for (const pin of sym.pins) {
    const info = names.get(pin.number);
    const rot = pin.at.rotation_mdeg ?? 0;
    primitives.push({
      kind: "pin",
      number: pin.number,
      name: info?.name ?? "",
      type: info?.type ?? "unspecified",
      x: pin.at.x_nm,
      y: pin.at.y_nm,
      rotMdeg: rot,
      lengthNm: pin.length_nm,
      style: pin.style,
      unit: pin.unit,
    });

    if (sym.power) primitives.push(...powerBarPrimitives(pin));

    const dir = pinDirection(rot);
    const horizontal = dir.x !== 0;
    // Pin inner end (the side against the symbol body): the pin line runs from the connection point toward the inside of the symbol body.
    const inner = {
      x: pin.at.x_nm + dir.x * pin.length_nm,
      y: pin.at.y_nm + dir.y * pin.length_nm,
    };
    primitives.push(...pinStylePrimitives(pin, dir));

    // Pin name: keep its frame-facing painted edge clear of the visible body; bodyless symbols retain pin_name_offset.
    const name = info?.name ?? "";
    if (!sym.pin_names_hidden && name.length > 0) {
      const placement = pinNamePlacements.get(pin);
      if (placement) {
        primitives.push({
          kind: "text",
          x: placement.x,
          y: placement.y,
          text: name,
          sizeNm: DEFAULT_TEXT_SIZE_NM,
          anchor: placement.anchor,
          ...(placement.rotateMdeg === undefined ? {} : { rotateMdeg: placement.rotateMdeg }),
          role: "pinName",
          pin: pin.number,
          unit: pin.unit,
        });
      } else {
        const anchor = dir.x < 0 ? "end" : "start";
        const offset = sym.pin_name_offset_nm ?? DEFAULT_NAME_OFFSET_NM;
        primitives.push({
          kind: "text",
          x: inner.x + dir.x * offset,
          y: inner.y + dir.y * offset,
          text: name,
          sizeNm: DEFAULT_TEXT_SIZE_NM,
          anchor,
          role: "pinName",
          pin: pin.number,
          unit: pin.unit,
        });
      }
    }
    {
      // Pin numbers follow the symbol's frame so a rotated C/R body cannot cut through the glyph.
      // Keep the local text horizontal for horizontal pins and vertical for vertical pins; the
      // schematic placer then composes this rotation with the instance rotation.
      const textRotation = horizontal ? 0 : 90_000;
      const ink = pinNumberInkEdges(pin.number, textRotation);
      const bodySide = bodyBounds
        ? {
            x: dir.x > 0
              ? bodyBounds.minX - NUMBER_TEXT_CLEARANCE_NM - ink.right
              : dir.x < 0
                ? bodyBounds.maxX + NUMBER_TEXT_CLEARANCE_NM - ink.left
                : inner.x,
            y: dir.y > 0
              ? bodyBounds.minY - NUMBER_TEXT_CLEARANCE_NM - ink.top
              : dir.y < 0
                ? bodyBounds.maxY + NUMBER_TEXT_CLEARANCE_NM - ink.bottom
                : inner.y,
          }
        : {
            x: inner.x - dir.x * NUMBER_TEXT_BODY_FALLBACK_OFFSET_NM,
            y: inner.y - dir.y * NUMBER_TEXT_BODY_FALLBACK_OFFSET_NM,
          };
      primitives.push({
        kind: "text",
        x: horizontal ? bodySide.x : pin.at.x_nm + NUMBER_TEXT_CLEARANCE_NM - ink.left,
        y: horizontal ? pin.at.y_nm + NUMBER_TEXT_CLEARANCE_NM - ink.bottom : bodySide.y,
        text: pin.number,
        sizeNm: NUMBER_TEXT_SIZE_NM,
        anchor: "middle",
        rotateMdeg: textRotation,
        role: "pinNumber",
        pin: pin.number,
        unit: pin.unit,
        ...(sym.pin_numbers_hidden ? { hidden: true } : {}),
      });
    }
  }

  for (const field of sym.fields ?? []) {
    if (field.hide) continue;
    const at = field.at ?? { x_nm: 0, y_nm: 0 };
    primitives.push({
      kind: "text",
      x: at.x_nm,
      y: at.y_nm,
      text: field.value,
      sizeNm: field.effects?.height_nm ?? DEFAULT_TEXT_SIZE_NM,
      anchor: "middle",
      role: "field",
      name: field.name,
      unit: 1,
    });
  }

  return {
    kind: "symbol",
    title: `${sym.library}:${sym.name}`,
    orientation: "y-up",
    primitives,
  };
}

function bodyPrimitives(item: BodyItem, power: boolean): SvgPrimitive[] {
  const width = item.width_nm ?? 0;
  const fill: SvgFill = item.fill ?? "none";
  const unit = item.unit ?? 1;
  const base = { widthNm: width, fill, layer: "symbol", unit };
  switch (item.kind) {
    case "line":
      return [
        {
          kind: "line",
          x1: item.start!.x_nm,
          y1: item.start!.y_nm,
          x2: item.end!.x_nm,
          y2: item.end!.y_nm,
          ...base,
        },
      ];
    case "rect":
      return [
        {
          kind: "rect",
          x1: item.start!.x_nm,
          y1: item.start!.y_nm,
          x2: item.end!.x_nm,
          y2: item.end!.y_nm,
          ...base,
        },
      ];
    case "circle":
      return [
        {
          kind: "circle",
          cx: item.center!.x_nm,
          cy: item.center!.y_nm,
          rNm: item.radius_nm!,
          ...base,
        },
      ];
    case "arc":
      return [
        {
          kind: "arc",
          x1: item.start!.x_nm,
          y1: item.start!.y_nm,
          xm: item.mid!.x_nm,
          ym: item.mid!.y_nm,
          x2: item.end!.x_nm,
          y2: item.end!.y_nm,
          ...base,
        },
      ];
    case "poly":
      return [
        {
          kind: "poly",
          points: item.points!.map((p) => ({ x: p.x_nm, y: p.y_nm })),
          ...base,
        },
      ];
  }
}

/**
 * Pin graphics: KiCad pin styles (inversion bubble, clock wedge, active-low, non-logic zigzag).
 * Drawn on the "pin" layer -- not counted as the symbol outline during extraction (only the "symbol" layer defines the outline).
 */
export function pinStylePrimitives(pin: Pin, dir: { x: number; y: number }): SvgPrimitive[] {
  const out: SvgPrimitive[] = [];
  const inner = {
    x: pin.at.x_nm + dir.x * pin.length_nm,
    y: pin.at.y_nm + dir.y * pin.length_nm,
  };
  const perp = { x: -dir.y, y: dir.x };
  const style = pin.style;

  if (style === "inverted" || style === "inverted_clock") {
    out.push({
      kind: "circle",
      cx: pin.at.x_nm,
      cy: pin.at.y_nm,
      rNm: BUBBLE_RADIUS_NM,
      widthNm: 127_000,
      fill: "none",
      layer: "pin",
      unit: pin.unit,
    });
  }

  if (style === "clock" || style === "inverted_clock" || style === "clock_low" || style === "edge_clock_high") {
    const base = {
      x: inner.x - dir.x * CLOCK_WEDGE_LEN_NM,
      y: inner.y - dir.y * CLOCK_WEDGE_LEN_NM,
    };
    out.push({
      kind: "polyline",
      points: [
        { x: base.x + perp.x * CLOCK_WEDGE_HALF_NM, y: base.y + perp.y * CLOCK_WEDGE_HALF_NM },
        { x: inner.x, y: inner.y },
        { x: base.x - perp.x * CLOCK_WEDGE_HALF_NM, y: base.y - perp.y * CLOCK_WEDGE_HALF_NM },
      ],
      widthNm: 127_000,
      fill: "none",
      layer: "pin",
      unit: pin.unit,
    });
  }

  if (style === "input_low" || style === "output_low" || style === "clock_low") {
    // Active-low: draw an arc at the pin's inner end, opening toward the symbol body.
    const c = {
      x: inner.x - dir.x * BUBBLE_RADIUS_NM,
      y: inner.y - dir.y * BUBBLE_RADIUS_NM,
    };
    out.push({
      kind: "arc",
      x1: c.x + perp.x * BUBBLE_RADIUS_NM,
      y1: c.y + perp.y * BUBBLE_RADIUS_NM,
      xm: c.x - dir.x * BUBBLE_RADIUS_NM,
      ym: c.y - dir.y * BUBBLE_RADIUS_NM,
      x2: c.x - perp.x * BUBBLE_RADIUS_NM,
      y2: c.y - perp.y * BUBBLE_RADIUS_NM,
      widthNm: 127_000,
      fill: "none",
      layer: "pin",
      unit: pin.unit,
    });
  }

  if (style === "non_logic") {
    // Non-logic pin: draw the pin line as a zigzag (here the whole line is replaced by a polyline).
    const steps = 4;
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const along = pin.length_nm * t;
      const wobble = i % 2 === 0 ? -BUBBLE_RADIUS_NM : BUBBLE_RADIUS_NM;
      pts.push({
        x: pin.at.x_nm + dir.x * along + perp.x * wobble,
        y: pin.at.y_nm + dir.y * along + perp.y * wobble,
      });
    }
    out.push({
      kind: "polyline",
      points: pts,
      widthNm: 127_000,
      fill: "none",
      layer: "pin",
      unit: pin.unit,
    });
  }
  return out;
}

/** Power symbol: draw a horizontal bar at the pin's inner end (the shape of a KiCad power symbol). */
export function powerBarPrimitives(pin: Pin): SvgPrimitive[] {
  const dir = pinDirection(pin.at.rotation_mdeg ?? 0);
  const inner = {
    x: pin.at.x_nm + dir.x * pin.length_nm,
    y: pin.at.y_nm + dir.y * pin.length_nm,
  };
  const half = 1_270_000;
  return [
    {
      kind: "line",
      x1: inner.x - half,
      y1: inner.y,
      x2: inner.x + half,
      y2: inner.y,
      widthNm: 254_000,
      layer: "power",
      unit: pin.unit,
    },
  ];
}

// ---------------------------------------------------------------- reverse extraction

export interface SymbolPinProjection {
  number: string;
  x_nm: number;
  y_nm: number;
  rotation_mdeg: number;
  length_nm: number;
  unit: number;
  style: string;
}

export type SymbolBodyProjection =
  | {
      kind: "line" | "rect";
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      width_nm: number;
      fill: SvgFill;
      unit: number;
    }
  | {
      kind: "circle";
      cx: number;
      cy: number;
      r_nm: number;
      width_nm: number;
      fill: SvgFill;
      unit: number;
    }
  | {
      kind: "arc";
      x1: number;
      y1: number;
      xm: number;
      ym: number;
      x2: number;
      y2: number;
      width_nm: number;
      fill: SvgFill;
      unit: number;
    }
  | {
      kind: "poly";
      points: { x_nm: number; y_nm: number }[];
      width_nm: number;
      fill: SvgFill;
      unit: number;
    };

export interface SymbolFieldProjection {
  name: string;
  value: string;
  x_nm: number;
  y_nm: number;
}

export interface SymbolProjection {
  units: number;
  pin_names_hidden: boolean;
  pin_numbers_hidden: boolean;
  power: boolean;
  pins: SymbolPinProjection[];
  body: SymbolBodyProjection[];
  fields: SymbolFieldProjection[];
}

/** Reverse-solves the symbol's semantic projection from the drawing primitives (one end of the round trip). */
export function extractSymbol(doc: SvgDoc): SymbolProjection {
  const pins: SymbolPinProjection[] = [];
  const body: SymbolBodyProjection[] = [];
  const fields: SymbolFieldProjection[] = [];
  let pinNamesHidden = true;
  let pinNumbersHidden = true;
  let power = false;
  let units = 1;

  for (const p of doc.primitives) {
    switch (p.kind) {
      case "pin":
        pins.push({
          number: p.number,
          x_nm: p.x,
          y_nm: p.y,
          rotation_mdeg: p.rotMdeg,
          length_nm: p.lengthNm,
          unit: p.unit,
          style: p.style,
        });
        units = Math.max(units, p.unit);
        break;
      case "text":
        if (p.role === "pinName") pinNamesHidden = false;
        else if (p.role === "pinNumber" && !p.hidden) pinNumbersHidden = false;
        else if (p.role === "field" && p.name !== undefined) {
          fields.push({ name: p.name, value: p.text, x_nm: p.x, y_nm: p.y });
        }
        break;
      case "line":
        if (p.layer === "symbol") {
          body.push({
            kind: "line",
            x1: p.x1,
            y1: p.y1,
            x2: p.x2,
            y2: p.y2,
            width_nm: p.widthNm,
            // Lines take no fill: the IR schema says fill only applies to rect/circle/poly.
            fill: "none",
            unit: p.unit ?? 1,
          });
        } else if (p.layer === "power") {
          power = true;
        }
        break;
      case "rect":
        if (p.layer === "symbol") {
          body.push({
            kind: "rect",
            x1: p.x1,
            y1: p.y1,
            x2: p.x2,
            y2: p.y2,
            width_nm: p.widthNm,
            fill: p.fill,
            unit: p.unit ?? 1,
          });
        }
        break;
      case "circle":
        if (p.layer === "symbol") {
          body.push({
            kind: "circle",
            cx: p.cx,
            cy: p.cy,
            r_nm: p.rNm,
            width_nm: p.widthNm,
            fill: p.fill,
            unit: p.unit ?? 1,
          });
        }
        break;
      case "arc":
        if (p.layer === "symbol") {
          body.push({
            kind: "arc",
            x1: p.x1,
            y1: p.y1,
            xm: p.xm,
            ym: p.ym,
            x2: p.x2,
            y2: p.y2,
            width_nm: p.widthNm,
            fill: p.fill,
            unit: p.unit ?? 1,
          });
        }
        break;
      case "poly":
        if (p.layer === "symbol") {
          body.push({
            kind: "poly",
            points: p.points.map((pt) => ({ x_nm: pt.x, y_nm: pt.y })),
            width_nm: p.widthNm,
            fill: p.fill,
            unit: p.unit ?? 1,
          });
        }
        break;
      case "pad":
        break;
    }
  }
  return {
    units,
    pin_names_hidden: pinNamesHidden,
    pin_numbers_hidden: pinNumbersHidden,
    power,
    pins,
    body,
    fields,
  };
}

/** The semantic projection computed directly from the symbol IR (the other end of the round trip). */
export function symbolProjection(sym: SymbolBody): SymbolProjection {
  const body: SymbolBodyProjection[] = [];
  let units = 1;
  for (const item of sym.body ?? []) {
    const width = item.width_nm ?? 0;
    const fill = (item.fill ?? "none") as SvgFill;
    const unit = item.unit ?? 1;
    units = Math.max(units, unit);
    switch (item.kind) {
      case "line":
        body.push({
          kind: "line",
          x1: item.start!.x_nm,
          y1: item.start!.y_nm,
          x2: item.end!.x_nm,
          y2: item.end!.y_nm,
          width_nm: width,
          fill: "none",
          unit,
        });
        break;
      case "rect":
        body.push({
          kind: "rect",
          x1: item.start!.x_nm,
          y1: item.start!.y_nm,
          x2: item.end!.x_nm,
          y2: item.end!.y_nm,
          width_nm: width,
          fill,
          unit,
        });
        break;
      case "circle":
        body.push({
          kind: "circle",
          cx: item.center!.x_nm,
          cy: item.center!.y_nm,
          r_nm: item.radius_nm!,
          width_nm: width,
          fill,
          unit,
        });
        break;
      case "arc":
        body.push({
          kind: "arc",
          x1: item.start!.x_nm,
          y1: item.start!.y_nm,
          xm: item.mid!.x_nm,
          ym: item.mid!.y_nm,
          x2: item.end!.x_nm,
          y2: item.end!.y_nm,
          width_nm: width,
          fill,
          unit,
        });
        break;
      case "poly":
        body.push({
          kind: "poly",
          points: item.points!.map((p) => ({ x_nm: p.x_nm, y_nm: p.y_nm })),
          width_nm: width,
          fill,
          unit,
        });
        break;
    }
  }
  const pins: SymbolPinProjection[] = sym.pins.map((pin) => {
    units = Math.max(units, pin.unit);
    return {
      number: pin.number,
      x_nm: pin.at.x_nm,
      y_nm: pin.at.y_nm,
      rotation_mdeg: pin.at.rotation_mdeg ?? 0,
      length_nm: pin.length_nm,
      unit: pin.unit,
      style: pin.style,
    };
  });
  const fields: SymbolFieldProjection[] = (sym.fields ?? [])
    .filter((f) => !f.hide)
    .map((f) => ({
      name: f.name,
      value: f.value,
      x_nm: f.at?.x_nm ?? 0,
      y_nm: f.at?.y_nm ?? 0,
    }));
  return {
    units,
    pin_names_hidden: sym.pin_names_hidden,
    pin_numbers_hidden: sym.pin_numbers_hidden,
    power: sym.power,
    pins,
    body,
    fields,
  };
}
