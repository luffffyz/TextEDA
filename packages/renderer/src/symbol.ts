// 符号 IR → 绘图指令。
//
// 符号是**视图**（ADR-0012）：引脚摆位、外形、单元、显示开关在这里；
// 引脚名与电气类型归 `component`，渲染时按引脚号查进来。
import type { Symbol } from "@texteda/ir/symbol";
import { pinDirection, type SvgDoc, type SvgFill, type SvgPrimitive } from "./svg.ts";

export type SymbolBody = Symbol["symbol"];
type Pin = SymbolBody["pins"][number];
type BodyItem = NonNullable<SymbolBody["body"]>[number];
type Field = NonNullable<SymbolBody["fields"]>[number];

/** `component` 里渲染符号需要的那部分事实（与导出器同口径）。 */
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
/** 引脚号离连接点的距离（KiCad 用 0.05 英寸 = 1.27mm）。 */
const NUMBER_TEXT_OUT_NM = 1_270_000;
/** 反相气泡半径（KiCad 默认 0.254mm）。 */
const BUBBLE_RADIUS_NM = 254_000;
/** 时钟楔形的长度与半宽。 */
const CLOCK_WEDGE_LEN_NM = 508_000;
const CLOCK_WEDGE_HALF_NM = 254_000;

/** 符号引脚的画法：连接点在引脚"外面"，线朝符号体内部走（spec/symbol.md §4）。 */
export function renderSymbol(sym: SymbolBody, part: SymbolPart): SvgDoc {
  const primitives: SvgPrimitive[] = [];
  const names = new Map(part.pins.map((p) => [p.number, p]));

  for (const item of sym.body ?? []) {
    primitives.push(...bodyPrimitives(item, sym.power));
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
    const away = { x: -dir.x, y: -dir.y };
    const horizontal = dir.x !== 0;
    // 引脚内端（贴符号体那一头）：引脚线从连接点朝符号体内部走。
    const inner = {
      x: pin.at.x_nm + dir.x * pin.length_nm,
      y: pin.at.y_nm + dir.y * pin.length_nm,
    };
    primitives.push(...pinStylePrimitives(pin, dir));

    // 引脚名：贴着内端、沿引脚方向往符号体里挪（与 KiCad 的 pin_names offset 同义）。
    const offset = sym.pin_name_offset_nm ?? DEFAULT_NAME_OFFSET_NM;
    const nameX = inner.x + dir.x * offset;
    // 文字锚点：字的**视觉中心**落在锚点上（SVG 用 dominant-baseline="central"）。
    const nameY = inner.y + dir.y * offset;
    const anchor = dir.x < 0 ? "end" : "start";

    if (!sym.pin_names_hidden) {
      const name = info?.name ?? "";
      if (name.length > 0) {
        primitives.push({
          kind: "text",
          x: nameX,
          y: nameY,
          text: name,
          sizeNm: DEFAULT_TEXT_SIZE_NM,
          anchor,
          role: "pinName",
          pin: pin.number,
          unit: pin.unit,
        });
      }
    }
    if (!sym.pin_numbers_hidden) {
      primitives.push({
        kind: "text",
        x: pin.at.x_nm + away.x * NUMBER_TEXT_OUT_NM,
        // 水平引脚：字心压在引脚轴上；垂直引脚：字心落在外推的锚点上。
        y: horizontal ? pin.at.y_nm : pin.at.y_nm + away.y * NUMBER_TEXT_OUT_NM,
        text: pin.number,
        sizeNm: NUMBER_TEXT_SIZE_NM,
        anchor: "middle",
        role: "pinNumber",
        pin: pin.number,
        unit: pin.unit,
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
 * 引脚图形：KiCad 的引脚风格（反相气泡、时钟楔形、低电平、非逻辑锯齿）。
 * 画在 "pin" 层——反解时不算符号外形（外形只认 "symbol" 层）。
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
    // 低电平：在引脚内端画一段开口朝符号体的弧。
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
    // 非逻辑引脚：引脚线画成锯齿（这里把整条线替换成折线）。
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

/** 电源符号：引脚内端画一根横杠（KiCad 电源符号的形状）。 */
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

// ---------------------------------------------------------------- 反解

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

/** 从绘图指令反解出符号的语义投影（round-trip 的一端）。 */
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
        else if (p.role === "pinNumber") pinNumbersHidden = false;
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
            // 线不填色：IR schema 规定 fill 只对 rect/circle/poly 有效。
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

/** 从符号 IR 直接算出的语义投影（round-trip 的另一端）。 */
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
