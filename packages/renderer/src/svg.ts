// IR → 绘图指令 → SVG：参考渲染器的底座（AGENTS.md §1 的"参考渲染器"）。
//
// 约定：
//   - 坐标一律**整数纳米**，方向跟源一致：符号 +y 向上、封装 +y 向下（ADR-0012 决策 5）；
//     转 SVG 时按 `orientation` 翻转 y（SVG 的 y 向下）。
//   - 同一份 IR 渲染两次，输出**字节相同**：没有时间戳、没有随机数、没有依赖外部状态。
//   - 绘图指令是中间表示（`SvgDoc`），不是字符串：可以断言、可以反解（extract），以后也能接别的后端。
//
// 这一层不依赖 KiCad：预览是设计回路的事，KiCad 只负责制造出口（ADR-0005）。

export type SvgOrientation = "y-up" | "y-down";

/** 填充语义。符号沿用 `none` / `outline` / `background`（spec/symbol.md §5），封装用 `solid` / `none`。 */
export type SvgFill = "none" | "solid" | "outline" | "background";

export type SvgAnchor = "start" | "middle" | "end";

/** 文字的语义角色：属性文字、引脚名、引脚号、封装自由文字。 */
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

/** 折线（不闭合、不填充）：引脚的时钟楔形、非逻辑引脚的锯齿。 */
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
  /** 属性名（role=field 时有）。 */
  name?: string;
  layer?: string;
  /** 引脚号（role=pinName / pinNumber 时有）。 */
  pin?: string;
  unit?: number;
}

/** 符号引脚：连接点 + 朝向 + 长度 + 样式。名字与电气类型来自 `component`（ADR-0012）。 */
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
 * 封装焊盘。`shape` 是**画法**（rect / oval / circle），IR 的 roundrect 由
 * `rratioPpm` 表达——这样反解时能从画法推回 IR 的形状，而不是抄一份。
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
  /** 钻孔（纳米）；椭圆钻孔 x≠y。 */
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
  kind: "symbol" | "footprint";
  title: string;
  orientation: SvgOrientation;
  primitives: SvgPrimitive[];
}

/** 纳米 → 毫米，最多 6 位小数，去掉尾随零（与导出器同一套写法）。 */
export function mm(nm: number): string {
  const s = (nm / 1e6).toFixed(6);
  const trimmed = s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
  return trimmed === "-0" ? "0" : trimmed;
}

/** 毫度 → 度。 */
export function deg(mdeg: number): string {
  const s = (mdeg / 1000).toFixed(6);
  const trimmed = s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
  return trimmed === "-0" ? "0" : trimmed;
}

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** 图层 → 颜色。认不出的图层走中性灰。 */
const LAYER_STYLE: Record<string, { stroke: string; fill: string }> = {
  symbol: { stroke: "#111827", fill: "#111827" },
  power: { stroke: "#111827", fill: "#111827" },
  pin: { stroke: "#b45309", fill: "#b45309" },
  "F.Cu": { stroke: "#b45309", fill: "#b45309" },
  "B.Cu": { stroke: "#92400e", fill: "#92400e" },
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
};

const DEFAULT_STYLE = { stroke: "#374151", fill: "none" };

/** 图层的画法：描边色 + 实心填充色。 */
interface LayerStyle {
  stroke: string;
  fill: string;
}

function styleOf(layer: string): LayerStyle {
  return LAYER_STYLE[layer] ?? DEFAULT_STYLE;
}

/** SvgFill → SVG 的 fill 属性。 */
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

/** 画图顺序：先铜后丝印后装配层，符号件在后。 */
const LAYER_ORDER = [
  "F.Cu",
  "B.Cu",
  "F.Mask",
  "B.Mask",
  "F.Paste",
  "B.Paste",
  "F.SilkS",
  "B.SilkS",
  "F.Fab",
  "B.Fab",
  "F.CrtYd",
  "B.CrtYd",
  "Edge.Cuts",
  "symbol",
  "power",
  "pin",
];

export interface SvgBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** 绘图指令的外接框（纳米）。文字按字号估一个方框，够用即可。 */
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

/** y 向上 → y 向下（SVG 坐标）。 */
function flip(doc: SvgDoc): (x: number, y: number) => [number, number] {
  return doc.orientation === "y-up" ? (x, y) => [x, -y] : (x, y) => [x, y];
}

export interface ArcGeometry {
  /** 圆弧半径（纳米）。 */
  radiusNm: number;
  /** 是否是大弧（> 180°）。 */
  largeArc: 0 | 1;
  /** SVG sweep-flag：1 = 顺时针（SVG 坐标里角度增大的方向）。 */
  sweep: 0 | 1;
}

/**
 * 圆弧（起点/中点/终点）→ SVG 的 A 指令参数。
 * 方向由三点决定：先算圆心与半径，再看"从起点到终点的正向角增量"能不能经过中点；
 * 不能就绕另一边。返回的 `sweep` 已经按**源坐标**给出，调用方在翻转 y 时要自己取反。
 */
export function arcGeometry(
  x1: number,
  y1: number,
  xm: number,
  ym: number,
  x2: number,
  y2: number,
): ArcGeometry | null {
  // 三点定圆：解圆心与半径。共线时没有圆弧。
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
  // 从起点到终点的角增量：正向能不能经过中点？不能就绕另一边。
  const positive = midForward <= forward;
  const sweep = positive ? forward : forward - twoPi;
  const largeArc = Math.abs(sweep) > Math.PI ? 1 : 0;
  return { radiusNm, largeArc, sweep: positive ? 1 : 0 };
}

/** 绘图指令 → SVG 文本。同一份 doc 输出字节相同。 */
export function toSvgText(doc: SvgDoc): string {
  const pad = 2_000_000; // 2mm 留白
  const b = bounds(doc);
  const fy = flip(doc);
  // 外接框搬到 SVG 坐标（y 向下）：y 向上 的源要先翻。
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
  out.push("    text { font-family: sans-serif; }");
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
        // 三点共线：没有圆弧，画折线。
        return [
          `    <polyline points="${mm(ax)},${mm(ay)} ${mm(bx)},${mm(by)}" fill="none" stroke-width="${mm(p.widthNm)}"/>`,
        ];
      }
      // 翻转 y 会把手性翻过来：源坐标是"负向绕行"时，SVG 里要改成正向。
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
      const [x, yAnchor] = fy(p.x, p.y);
      // 锚点是**字的视觉中心**；SVG 的基线要下移半个字高（SVG 的 y 向下）。
      // 不用 dominant-baseline：有些光栅化器不认它，基线算出来更保险。
      const fontSize = p.sizeNm / 0.75; // 字高（cap height）→ 字号，比例同 KiCad
      const y = yAnchor + 0.5 * p.sizeNm;
      const anchor = p.anchor === "start" ? "start" : p.anchor === "end" ? "end" : "middle";
      const transform = p.rotateMdeg
        ? ` transform="rotate(${deg(p.rotateMdeg)} ${mm(x)} ${mm(yAnchor)})"`
        : "";
      const fill = p.role === "pinName" || p.role === "pinNumber" ? "#6b7280" : "#111827";
      return [
        `    <text x="${mm(x)}" y="${mm(y)}" font-size="${mm(fontSize)}" text-anchor="${anchor}" fill="${fill}" stroke="none"${transform}>${esc(p.text)}</text>`,
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
 * 引脚朝向 → 单位方向（符号坐标：+x 右、+y 上）。
 * `rotMdeg` 是**毫度**（IR 约定，ADR-0004 决策 3）：90° = 90000。
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

/** 绘图指令的几何自检。返回问题清单，空数组 = 没问题。 */
export function validateDoc(doc: SvgDoc): string[] {
  const problems: string[] = [];
  const isInt = (v: number): boolean => Number.isInteger(v);
  for (const p of doc.primitives) {
    const tag = `${p.kind}${p.kind === "pin" || p.kind === "pad" || p.kind === "text" ? `(${p.kind === "pin" || p.kind === "pad" ? p.number : p.text})` : ""}`;
    switch (p.kind) {
      case "line":
        if (![p.x1, p.y1, p.x2, p.y2, p.widthNm].every(isInt)) problems.push(`${tag}: 坐标不是整数纳米`);
        if (p.x1 === p.x2 && p.y1 === p.y2) problems.push(`${tag}: 零长线`);
        break;
      case "rect":
        if (![p.x1, p.y1, p.x2, p.y2, p.widthNm].every(isInt)) problems.push(`${tag}: 坐标不是整数纳米`);
        if (p.x1 === p.x2 || p.y1 === p.y2) problems.push(`${tag}: 退化成线`);
        break;
      case "circle":
        if (![p.cx, p.cy, p.rNm].every(isInt)) problems.push(`${tag}: 坐标不是整数纳米`);
        if (p.rNm <= 0) problems.push(`${tag}: 半径非正`);
        break;
      case "arc":
        if (![p.x1, p.y1, p.xm, p.ym, p.x2, p.y2].every(isInt)) problems.push(`${tag}: 坐标不是整数纳米`);
        break;
      case "poly":
        if (p.points.length < 3) problems.push(`${tag}: 多边形点数 < 3`);
        if (!p.points.every((pt) => isInt(pt.x) && isInt(pt.y))) problems.push(`${tag}: 坐标不是整数纳米`);
        break;
      case "polyline":
        if (p.points.length < 2) problems.push(`${tag}: 折线点数 < 2`);
        if (!p.points.every((pt) => isInt(pt.x) && isInt(pt.y))) problems.push(`${tag}: 坐标不是整数纳米`);
        break;
      case "text":
        if (![p.x, p.y, p.sizeNm].every(isInt)) problems.push(`${tag}: 坐标不是整数纳米`);
        if (p.sizeNm <= 0) problems.push(`${tag}: 字号非正`);
        if (p.text.length === 0) problems.push(`${tag}: 空文字`);
        break;
      case "pin":
        if (![p.x, p.y, p.lengthNm, p.rotMdeg].every(isInt)) problems.push(`${tag}: 坐标不是整数纳米`);
        if (p.lengthNm <= 0) problems.push(`${tag}: 引脚长度非正`);
        if (p.unit < 0) problems.push(`${tag}: 单元号非法`);
        break;
      case "pad":
        if (![p.x, p.y, p.wNm, p.hNm].every(isInt)) problems.push(`${tag}: 坐标不是整数纳米`);
        if (p.wNm <= 0 || p.hNm <= 0) problems.push(`${tag}: 焊盘尺寸非正`);
        break;
    }
  }
  return problems;
}
