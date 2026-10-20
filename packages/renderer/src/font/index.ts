// 字形排版：字符串 → 笔画折线（模型坐标，整数纳米）。
//
// 用 Hershey 单线字体（`hershey-sans.ts`）：字画成**路径**，不依赖系统字体——
// 没装字体的机器打开 SVG 也不会"只有图没有文字"。
//
// 坐标约定：字体自身的 y 轴**向下**（基线 y=22，字高 21，x 高 14，降部到 29）。
// 模型坐标的朝向随文档走（符号 +y 向上、封装 +y 向下），所以排版要带 `yDown`。
import { GLYPHS, SPACE_ADVANCE, glyphIndex } from "./hershey-sans.ts";

export type TextAnchor = "start" | "middle" | "end";

/** 字体度量（字体坐标系，y 向下）。 */
const BASELINE_Y = 22;
/** 字高（cap height）：从 y=1 到基线 y=22。 */
const CAP_HEIGHT = 21;
/** 大写字框（y=1..22）的中心——文字按它居中挂在锚点上。 */
const CAP_CENTER_Y = 11.5;
/**
 * 步进宽的换算系数。
 *
 * Hershey 数据里每个字形的 `o`（步进）与笔画坐标**不是同一把尺子**：笔画坐标
 * 以字高 21 为单位，`o` 却是按 em 记的。上游 `hersheytext` 自己渲染时用 1.68
 * 把两者对上（`multiplyer`），照抄这个系数，字母才不会互相压。
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
  /** 笔画折线（字体坐标）。 */
  strokes: FontPoint[][];
  /** 步进宽（字体坐标单位，与笔画同一把尺子）。 */
  advance: number;
}

const glyphCache = new Map<string, Glyph | null>();

/** 取字形；空格只有步进宽，没有笔画。 */
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

/** Hershey 的路径写法只有 M 与 L：M 起一条新折线，后面的坐标对接着画。 */
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
      // 只是继续当前折线。
    } else {
      current.push({ x: Number(m[2]), y: Number(m[3]) });
    }
  }
  if (current.length > 0) strokes.push(current);
  return strokes;
}

/** 一串文字的宽度（纳米）。`sizeNm` 是字高（cap height）。 */
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
 * 排版：把文字变成模型坐标里的笔画折线。
 *
 * `x` / `y` 是文字的**视觉中心**锚点（与 `<text dominant-baseline="central">` 同义）：
 * 大写字框（字高那一条）居中挂在锚点上，降部往下伸。
 * `yDown` 说明模型坐标的 y 方向：符号是 false（+y 向上），封装是 true。
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

/** 描边线宽（纳米）：单线字体的笔画粗细，跟字高挂钩。 */
export function strokeWidthFor(sizeNm: number): number {
  return Math.max(1, Math.round(sizeNm * 0.1));
}

/**
 * 画不出来的字符（自带字体只有 ASCII）。
 *
 * 预览要**说出来**：不然一个中文引脚名在图上凭空消失，看图的人会以为引脚没名字。
 */
export function unsupportedChars(text: string): string[] {
  const bad = new Set<string>();
  for (const ch of text) {
    if (!glyph(ch)) bad.add(ch);
  }
  return [...bad];
}

export { BASELINE_Y, CAP_HEIGHT };
