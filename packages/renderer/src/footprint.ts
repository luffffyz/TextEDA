// Footprint IR → drawing commands.
//
// A footprint is pure geometry (ADR-0010): pads, silkscreen/assembly/courtyard graphics, field text.
// Coordinates: +x right, +y down (PCB convention), so no flip is needed when converting to SVG.
import type { Footprint } from "@texteda/ir/footprint";
import type { SvgDoc, SvgFill, SvgPrimitive } from "./svg.ts";

export type FootprintBody = Footprint["footprint"];
type Pad = FootprintBody["pads"][number];
type Graphic = NonNullable<FootprintBody["graphics"]>[number];
type TextItem = NonNullable<FootprintBody["texts"]>[number];
type Field = NonNullable<FootprintBody["fields"]>[number];

const DEFAULT_TEXT_SIZE_NM = 1_270_000;

export function renderFootprint(fp: FootprintBody): SvgDoc {
  const primitives: SvgPrimitive[] = [];

  for (const pad of fp.pads) {
    primitives.push({
      kind: "pad",
      number: pad.number,
      x: pad.at.x_nm,
      y: pad.at.y_nm,
      wNm: pad.size.x_nm,
      hNm: pad.size.y_nm,
      shape: padShape(pad),
      ...(pad.roundrect_ratio_ppm !== undefined ? { rratioPpm: pad.roundrect_ratio_ppm } : {}),
      ...(pad.drill ? { drill: { xNm: pad.drill.x_nm, yNm: pad.drill.y_nm } } : {}),
      ...(pad.at.rotation_mdeg !== undefined ? { rotationMdeg: pad.at.rotation_mdeg } : {}),
      layers: [...pad.layers],
    });
  }

  for (const g of fp.graphics ?? []) {
    primitives.push(...graphicPrimitives(g));
  }

  for (const t of fp.texts ?? []) {
    if (t.hide) continue;
    primitives.push({
      kind: "text",
      x: t.at.x_nm,
      y: t.at.y_nm,
      text: t.text,
      sizeNm: t.effects?.height_nm ?? DEFAULT_TEXT_SIZE_NM,
      anchor: "middle",
      role: "text",
      layer: t.layer,
      unit: 1,
    });
  }

  for (const f of fp.fields ?? []) {
    if (f.hide) continue;
    primitives.push({
      kind: "text",
      x: f.at?.x_nm ?? 0,
      y: f.at?.y_nm ?? 0,
      text: f.value,
      sizeNm: f.effects?.height_nm ?? DEFAULT_TEXT_SIZE_NM,
      anchor: "middle",
      role: "field",
      name: f.name,
      layer: f.layer ?? "F.SilkS",
      unit: 1,
    });
  }

  return {
    kind: "footprint",
    title: `${fp.library}:${fp.name}`,
    orientation: "y-down",
    primitives,
  };
}

/** IR pad shape → drawing style. roundrect is expressed as "rectangle + corner-radius ratio", so it can be derived back during reverse engineering. */
function padShape(pad: Pad): "rect" | "oval" | "circle" {
  switch (pad.shape) {
    case "roundrect":
      return "rect";
    case "oval":
      return "oval";
    case "circle":
      return "circle";
    default:
      return "rect";
  }
}

function graphicPrimitives(g: Graphic): SvgPrimitive[] {
  const width = g.width_nm ?? 0;
  const fill: SvgFill = g.filled ? "solid" : "none";
  const base = { widthNm: width, fill, layer: g.layer, unit: 1 };
  switch (g.kind) {
    case "line":
      return [
        {
          kind: "line",
          x1: g.start!.x_nm,
          y1: g.start!.y_nm,
          x2: g.end!.x_nm,
          y2: g.end!.y_nm,
          ...base,
        },
      ];
    case "rect":
      return [
        {
          kind: "rect",
          x1: g.start!.x_nm,
          y1: g.start!.y_nm,
          x2: g.end!.x_nm,
          y2: g.end!.y_nm,
          ...base,
        },
      ];
    case "circle":
      return [
        {
          kind: "circle",
          cx: g.center!.x_nm,
          cy: g.center!.y_nm,
          rNm: g.radius_nm!,
          ...base,
        },
      ];
    case "arc":
      return [
        {
          kind: "arc",
          x1: g.start!.x_nm,
          y1: g.start!.y_nm,
          xm: g.mid!.x_nm,
          ym: g.mid!.y_nm,
          x2: g.end!.x_nm,
          y2: g.end!.y_nm,
          ...base,
        },
      ];
    case "poly":
      return [
        {
          kind: "poly",
          points: g.points!.map((p) => ({ x: p.x_nm, y: p.y_nm })),
          ...base,
        },
      ];
  }
}

// ---------------------------------------------------------------- reverse engineering

export interface FootprintPadProjection {
  number: string;
  type: "smd" | "th";
  shape: "rect" | "roundrect" | "oval" | "circle";
  x_nm: number;
  y_nm: number;
  rotation_mdeg: number;
  size_x_nm: number;
  size_y_nm: number;
  drill_x_nm: number;
  drill_y_nm: number;
  roundrect_ratio_ppm: number;
  layers: string[];
}

export type FootprintGraphicProjection =
  | {
      kind: "line" | "rect";
      layer: string;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      width_nm: number;
      filled: boolean;
    }
  | {
      kind: "circle";
      layer: string;
      cx: number;
      cy: number;
      r_nm: number;
      width_nm: number;
      filled: boolean;
    }
  | {
      kind: "arc";
      layer: string;
      x1: number;
      y1: number;
      xm: number;
      ym: number;
      x2: number;
      y2: number;
      width_nm: number;
      filled: boolean;
    }
  | {
      kind: "poly";
      layer: string;
      points: { x_nm: number; y_nm: number }[];
      width_nm: number;
      filled: boolean;
    };

export interface FootprintFieldProjection {
  name: string;
  value: string;
  x_nm: number;
  y_nm: number;
  layer: string;
}

export interface FootprintTextProjection {
  text: string;
  x_nm: number;
  y_nm: number;
  layer: string;
}

export interface FootprintProjection {
  pads: FootprintPadProjection[];
  graphics: FootprintGraphicProjection[];
  fields: FootprintFieldProjection[];
  texts: FootprintTextProjection[];
}

/** Reverse-engineer the footprint's semantic projection from the drawing commands (one end of the round-trip). */
export function extractFootprint(doc: SvgDoc): FootprintProjection {
  const pads: FootprintPadProjection[] = [];
  const graphics: FootprintGraphicProjection[] = [];
  const fields: FootprintFieldProjection[] = [];
  const texts: FootprintTextProjection[] = [];

  for (const p of doc.primitives) {
    switch (p.kind) {
      case "pad": {
        const shape =
          p.shape === "circle"
            ? "circle"
            : p.shape === "oval"
              ? "oval"
              : p.rratioPpm !== undefined
                ? "roundrect"
                : "rect";
        pads.push({
          number: p.number,
          type: p.drill ? "th" : "smd",
          shape,
          x_nm: p.x,
          y_nm: p.y,
          rotation_mdeg: p.rotationMdeg ?? 0,
          size_x_nm: p.wNm,
          size_y_nm: p.hNm,
          drill_x_nm: p.drill?.xNm ?? 0,
          drill_y_nm: p.drill?.yNm ?? 0,
          roundrect_ratio_ppm: p.rratioPpm ?? 0,
          layers: [...p.layers],
        });
        break;
      }
      case "line":
        graphics.push({
          kind: "line",
          layer: p.layer,
          x1: p.x1,
          y1: p.y1,
          x2: p.x2,
          y2: p.y2,
          width_nm: p.widthNm,
          filled: false,
        });
        break;
      case "rect":
        graphics.push({
          kind: "rect",
          layer: p.layer,
          x1: p.x1,
          y1: p.y1,
          x2: p.x2,
          y2: p.y2,
          width_nm: p.widthNm,
          filled: p.fill === "solid",
        });
        break;
      case "circle":
        graphics.push({
          kind: "circle",
          layer: p.layer,
          cx: p.cx,
          cy: p.cy,
          r_nm: p.rNm,
          width_nm: p.widthNm,
          filled: p.fill === "solid",
        });
        break;
      case "arc":
        graphics.push({
          kind: "arc",
          layer: p.layer,
          x1: p.x1,
          y1: p.y1,
          xm: p.xm,
          ym: p.ym,
          x2: p.x2,
          y2: p.y2,
          width_nm: p.widthNm,
          filled: p.fill === "solid",
        });
        break;
      case "poly":
        graphics.push({
          kind: "poly",
          layer: p.layer,
          points: p.points.map((pt) => ({ x_nm: pt.x, y_nm: pt.y })),
          width_nm: p.widthNm,
          filled: p.fill === "solid",
        });
        break;
      case "text":
        if (p.role === "field" && p.name !== undefined) {
          fields.push({
            name: p.name,
            value: p.text,
            x_nm: p.x,
            y_nm: p.y,
            layer: p.layer ?? "F.SilkS",
          });
        } else if (p.role === "text") {
          texts.push({ text: p.text, x_nm: p.x, y_nm: p.y, layer: p.layer ?? "F.SilkS" });
        }
        break;
      case "pin":
        break;
    }
  }
  return { pads, graphics, fields, texts };
}

/** The semantic projection computed directly from the footprint IR (the other end of the round-trip). */
export function footprintProjection(fp: FootprintBody): FootprintProjection {
  const pads: FootprintPadProjection[] = fp.pads.map((pad) => ({
    number: pad.number,
    type: pad.type,
    shape: pad.shape,
    x_nm: pad.at.x_nm,
    y_nm: pad.at.y_nm,
    rotation_mdeg: pad.at.rotation_mdeg ?? 0,
    size_x_nm: pad.size.x_nm,
    size_y_nm: pad.size.y_nm,
    drill_x_nm: pad.drill?.x_nm ?? 0,
    drill_y_nm: pad.drill?.y_nm ?? 0,
    roundrect_ratio_ppm: pad.roundrect_ratio_ppm ?? 0,
    layers: [...pad.layers],
  }));
  const graphics: FootprintGraphicProjection[] = (fp.graphics ?? []).map((g) => {
    const filled = g.filled ?? false;
    switch (g.kind) {
      case "line":
        return {
          kind: "line",
          layer: g.layer,
          x1: g.start!.x_nm,
          y1: g.start!.y_nm,
          x2: g.end!.x_nm,
          y2: g.end!.y_nm,
          width_nm: g.width_nm ?? 0,
          filled,
        };
      case "rect":
        return {
          kind: "rect",
          layer: g.layer,
          x1: g.start!.x_nm,
          y1: g.start!.y_nm,
          x2: g.end!.x_nm,
          y2: g.end!.y_nm,
          width_nm: g.width_nm ?? 0,
          filled,
        };
      case "circle":
        return {
          kind: "circle",
          layer: g.layer,
          cx: g.center!.x_nm,
          cy: g.center!.y_nm,
          r_nm: g.radius_nm!,
          width_nm: g.width_nm ?? 0,
          filled,
        };
      case "arc":
        return {
          kind: "arc",
          layer: g.layer,
          x1: g.start!.x_nm,
          y1: g.start!.y_nm,
          xm: g.mid!.x_nm,
          ym: g.mid!.y_nm,
          x2: g.end!.x_nm,
          y2: g.end!.y_nm,
          width_nm: g.width_nm ?? 0,
          filled,
        };
      case "poly":
        return {
          kind: "poly",
          layer: g.layer,
          points: g.points!.map((p) => ({ x_nm: p.x_nm, y_nm: p.y_nm })),
          width_nm: g.width_nm ?? 0,
          filled,
        };
    }
  });
  const fields: FootprintFieldProjection[] = (fp.fields ?? [])
    .filter((f) => !f.hide)
    .map((f) => ({
      name: f.name,
      value: f.value,
      x_nm: f.at?.x_nm ?? 0,
      y_nm: f.at?.y_nm ?? 0,
      layer: f.layer ?? "F.SilkS",
    }));
  const texts: FootprintTextProjection[] = (fp.texts ?? [])
    .filter((t) => !t.hide)
    .map((t) => ({
      text: t.text,
      x_nm: t.at.x_nm,
      y_nm: t.at.y_nm,
      layer: t.layer,
    }));
  return { pads, graphics, fields, texts };
}
