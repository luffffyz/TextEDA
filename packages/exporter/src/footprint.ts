// 封装 → KiCad 产物。
//
// 真源是 IR 里的 footprint 分片（schemas/ir/v0.1/footprint.schema.json），
// 本文件把它写成两种 KiCad 产物（ADR-0011）：
//   1. footprintModule —— 独立的 .kicad_mod（放进 .pretty 库目录，KiCad 能当普通库用）
//   2. footprintInline —— 板文件里的内联封装块（KiCad 6+ 板文件自带几何，不依赖库）
//
// 两种产物共用同一份 body 生成逻辑，所以不会出现"库里的封装和板上的不一致"。
import { createHash } from "node:crypto";
import type { Footprint } from "@texteda/ir/footprint";

export type FootprintBody = Footprint["footprint"];
type Pad = FootprintBody["pads"][number];
type Graphic = NonNullable<FootprintBody["graphics"]>[number];
type TextItem = NonNullable<FootprintBody["texts"]>[number];
type Field = NonNullable<FootprintBody["fields"]>[number];

/** KiCad 10 封装文件格式版本。 */
export const KICAD_FOOTPRINT_VERSION = "20260206";

/** 纳米 → 毫米，最多 6 位小数，去掉尾随零。 */
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

const q = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/** 百万分比 → 十进制（KiCad 侧要浮点，IR 侧不许）。 */
function ratio(ppm: number): string {
  const s = (ppm / 1e6).toFixed(6);
  const trimmed = s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
  return trimmed === "-0" ? "0" : trimmed;
}

function point(p: { x_nm: number; y_nm: number }): string {
  return `(xy ${mm(p.x_nm)} ${mm(p.y_nm)})`;
}

function stroke(widthNm: number | undefined, defaultWidth = 0.1): string {
  const w = widthNm === undefined ? defaultWidth * 1e6 : widthNm;
  return `(stroke (width ${mm(w)}) (type solid))`;
}

function padSexp(pad: Pad): string {
  const parts: string[] = [];
  const type = pad.type === "th" ? "thru_hole" : "smd";
  parts.push(`(pad ${q(pad.number)} ${type} ${pad.shape}`);
  const at = pad.at.rotation_mdeg
    ? `(at ${mm(pad.at.x_nm)} ${mm(pad.at.y_nm)} ${deg(pad.at.rotation_mdeg)})`
    : `(at ${mm(pad.at.x_nm)} ${mm(pad.at.y_nm)})`;
  parts.push(at);
  parts.push(`(size ${mm(pad.size.x_nm)} ${mm(pad.size.y_nm)})`);
  if (pad.drill) {
    const round = pad.drill.x_nm === pad.drill.y_nm;
    parts.push(round ? `(drill ${mm(pad.drill.x_nm)})` : `(drill oval ${mm(pad.drill.x_nm)} ${mm(pad.drill.y_nm)})`);
  }
  parts.push(`(layers ${pad.layers.map((l) => q(l)).join(" ")})`);
  if (pad.shape === "roundrect" && pad.roundrect_ratio_ppm !== undefined) {
    parts.push(`(roundrect_rratio ${ratio(pad.roundrect_ratio_ppm)})`);
  }
  if (pad.solder_mask_margin_nm !== undefined) {
    parts.push(`(solder_mask_margin ${mm(pad.solder_mask_margin_nm)})`);
  }
  if (pad.solder_paste_margin_nm !== undefined) {
    parts.push(`(solder_paste_margin ${mm(pad.solder_paste_margin_nm)})`);
  }
  if (pad.clearance_nm !== undefined) parts.push(`(clearance ${mm(pad.clearance_nm)})`);
  if (pad.zone_connect) {
    const code = pad.zone_connect === "solid" ? 2 : pad.zone_connect === "thermal" ? 1 : 0;
    parts.push(`(zone_connect ${code})`);
  }
  if (pad.thermal_width_nm !== undefined) parts.push(`(thermal_width ${mm(pad.thermal_width_nm)})`);
  if (pad.thermal_gap_nm !== undefined) parts.push(`(thermal_gap ${mm(pad.thermal_gap_nm)})`);
  return `${parts.join(" ")})`;
}

function graphicSexp(g: Graphic): string {
  switch (g.kind) {
    case "line":
      return `(fp_line (start ${mm(g.start!.x_nm)} ${mm(g.start!.y_nm)}) (end ${mm(g.end!.x_nm)} ${mm(g.end!.y_nm)}) ${stroke(g.width_nm)} (layer ${q(g.layer)}))`;
    case "rect":
      return `(fp_rect (start ${mm(g.start!.x_nm)} ${mm(g.start!.y_nm)}) (end ${mm(g.end!.x_nm)} ${mm(g.end!.y_nm)}) ${stroke(g.width_nm, 0.05)} (fill ${g.filled ? "solid" : "none"}) (layer ${q(g.layer)}))`;
    case "circle":
      return `(fp_circle (center ${mm(g.center!.x_nm)} ${mm(g.center!.y_nm)}) (end ${mm(g.center!.x_nm + g.radius_nm!)} ${mm(g.center!.y_nm)}) ${stroke(g.width_nm)} (fill ${g.filled ? "solid" : "none"}) (layer ${q(g.layer)}))`;
    case "arc":
      return `(fp_arc (start ${mm(g.start!.x_nm)} ${mm(g.start!.y_nm)}) (mid ${mm(g.mid!.x_nm)} ${mm(g.mid!.y_nm)}) (end ${mm(g.end!.x_nm)} ${mm(g.end!.y_nm)}) ${stroke(g.width_nm)} (layer ${q(g.layer)}))`;
    case "poly":
      return `(fp_poly (pts ${g.points!.map((pt) => point(pt)).join(" ")}) ${stroke(g.width_nm)} (fill ${g.filled ? "solid" : "none"}) (layer ${q(g.layer)}))`;
  }
}

function effectsSexp(e: Field["effects"]): string {
  if (!e) return "(effects (font (size 1 1) (thickness 0.15)))";
  const w = e.width_nm !== undefined ? mm(e.width_nm) : "1";
  const h = e.height_nm !== undefined ? mm(e.height_nm) : "1";
  const t = e.thickness_nm !== undefined ? mm(e.thickness_nm) : "0.15";
  const style = [e.bold ? "bold" : null, e.italic ? "italic" : null].filter(Boolean).join(" ");
  return `(effects (font (size ${w} ${h}) (thickness ${t})${style ? ` ${style}` : ""}))`;
}

function textSexp(t: TextItem, rotationMdeg = 0): string {
  const angle = (t.at.rotation_mdeg ?? 0) + rotationMdeg;
  const at = angle ? `(at ${mm(t.at.x_nm)} ${mm(t.at.y_nm)} ${deg(angle)})` : `(at ${mm(t.at.x_nm)} ${mm(t.at.y_nm)})`;
  const hide = t.hide ? " (hide yes)" : "";
  return `(property ${q(t.text)} ${q(t.text)} ${at} (layer ${q(t.layer)})${hide} ${effectsSexp(t.effects)})`;
}

function fieldSexp(f: Field, rotationMdeg = 0, valueOverride?: string): string {
  const at = f.at
    ? (() => {
        const angle = (f.at.rotation_mdeg ?? 0) + rotationMdeg;
        return angle
          ? `(at ${mm(f.at.x_nm)} ${mm(f.at.y_nm)} ${deg(angle)})`
          : `(at ${mm(f.at.x_nm)} ${mm(f.at.y_nm)})`;
      })()
    : "(at 0 0)";
  const hide = f.hide ? " (hide yes)" : "";
  const layer = f.layer ? ` (layer ${q(f.layer)})` : "";
  return `(property ${q(f.name)} ${q(valueOverride ?? f.value)} ${at}${layer}${hide} ${effectsSexp(f.effects)})`;
}

function modelSexp(m: NonNullable<FootprintBody["model3d"]>): string {
  const off = m.offset_nm ?? [0, 0, 0];
  const sc = (m.scale_ppm ?? [1000000, 1000000, 1000000]).map((v) => ratio(v));
  const rot = m.rotation_mdeg ?? [0, 0, 0];
  return `(model ${q(m.path)} (offset (xyz ${mm(off[0])} ${mm(off[1])} ${mm(off[2])})) (scale (xyz ${sc[0]} ${sc[1]} ${sc[2]})) (rotate (xyz ${deg(rot[0])} ${deg(rot[1])} ${deg(rot[2])})))`;
}

/** 板内联时覆盖的属性值（位号、值）。 */
interface FieldOverrides {
  reference?: string | undefined;
  value?: string | undefined;
}

/** 封装体（不含最外层 footprint 与 placement 属性），两种产物共用。 */
function body(fp: FootprintBody, rotationMdeg: number, overrides?: FieldOverrides): string[] {
  const out: string[] = [];
  if (fp.description) out.push(`(descr ${q(fp.description)})`);
  // KiCad 的 tags 是**一个**引号字符串，标签之间用空格分隔；写成多个字符串会让 KiCad 拒绝加载库。
  if (fp.tags?.length) out.push(`(tags ${q(fp.tags.join(" "))})`);
  for (const f of fp.fields ?? []) {
    const override =
      f.name === "Reference" ? overrides?.reference : f.name === "Value" ? overrides?.value : undefined;
    out.push(fieldSexp(f, rotationMdeg, override));
  }
  for (const t of fp.texts ?? []) out.push(textSexp(t, rotationMdeg));
  const attr = fp.attr ?? (fp.pads.every((p) => p.type === "th") ? ["through_hole"] : ["smd"]);
  out.push(`(attr ${attr.join(" ")})`);
  for (const g of fp.graphics ?? []) out.push(graphicSexp(g));
  for (const p of fp.pads) out.push(padSexp(p));
  if (fp.model3d) out.push(modelSexp(fp.model3d));
  return out;
}

/** 独立 .kicad_mod 文件内容（放进 `<lib>.pretty/` 即可被 KiCad 当普通库使用）。 */
export function footprintModule(fp: FootprintBody, options?: { generator?: string }): string {
  const head = [
    `(footprint ${q(fp.name)}`,
    `\t(version ${KICAD_FOOTPRINT_VERSION})`,
    `\t(generator ${q(options?.generator ?? "texteda")})`,
    `\t(layer "F.Cu")`,
  ];
  const rest = body(fp, 0).map((line) => `\t${line}`);
  return [...head, ...rest, ")", ""].join("\n");
}

export interface Placement {
  /** 板级位置，纳米。 */
  xNm: number;
  yNm: number;
  /** 板级旋转，毫度。 */
  rotationMdeg?: number;
  /** 位号，写进 Reference 属性。 */
  reference?: string;
  /** 值，写进 Value 属性。 */
  value?: string;
  /** 底面放置时为 true（几何镜像到 B.Cu）。 */
  back?: boolean;
  /** 显式 uuid；不给则按内容派生（确定性）。 */
  uuid?: string;
}

/** 板文件里的内联封装块。 */
export function footprintInline(fp: FootprintBody, placement: Placement): string {
  const rot = placement.rotationMdeg ?? 0;
  const layer = placement.back ? "B.Cu" : "F.Cu";
  const uuid = placement.uuid ?? deriveUuid(`${fp.library}:${fp.name}|${placement.reference ?? ""}|${placement.xNm}|${placement.yNm}|${rot}`);
  const at = rot
    ? `(at ${mm(placement.xNm)} ${mm(placement.yNm)} ${deg(rot)})`
    : `(at ${mm(placement.xNm)} ${mm(placement.yNm)})`;
  const head = [
    `(footprint ${q(`${fp.library}:${fp.name}`)}`,
    `\t(layer ${q(layer)})`,
    `\t${at}`,
    `\t(uuid ${q(uuid)})`,
  ];
  const rest = body(fp, rot, { reference: placement.reference, value: placement.value }).map(
    (line) => `\t${line}`,
  );
  return [...head, ...rest, "\t)", ""].join("\n");
}

/** 确定性 uuid：同一输入永远得到同一个 id，导出可字节复现。 */
export function deriveUuid(seed: string): string {
  const h = createHash("sha256").update(seed).digest();
  const bytes = Buffer.from(h.subarray(0, 16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40; // version 4 位型
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // variant
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
