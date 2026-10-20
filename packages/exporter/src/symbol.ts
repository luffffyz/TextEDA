// 符号 → KiCad `.kicad_sym`。
//
// 真源分两半（ADR-0012）：
//   - `symbol` 分片（schemas/ir/v0.1/symbol.schema.json）提供视图：引脚摆位、外形、单元、显示开关；
//   - `component` 提供电学事实：引脚名、电气类型、footprint、datasheet。
// 导出时按**引脚号**把两边合起来；这是"一个事实一个所有者"的落点。
import type { Symbol } from "@texteda/ir/symbol";
import { mm } from "./footprint.ts";

export type SymbolBody = Symbol["symbol"];
type Pin = SymbolBody["pins"][number];
type BodyItem = NonNullable<SymbolBody["body"]>[number];
type Field = NonNullable<SymbolBody["fields"]>[number];

/** KiCad 10 符号库格式版本。 */
export const KICAD_SYMBOL_VERSION = "20251024";

const INDENT = "\t";
const q = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/** `component` 里导出符号需要的那部分事实。 */
export interface PartPin {
  number: string;
  name: string;
  /** teda 的电气类型（`teda.md` §10.1）。 */
  type: string;
}

export interface PartInfo {
  pins: PartPin[];
  /** `<lib>:<name>`，原样写进 Footprint 属性。 */
  footprint?: string;
  datasheet?: string;
  /** 器件描述；符号自己有 description 时以符号为准。 */
  description?: string;
}

/** teda 电气类型 → KiCad 引脚类型。`power` 在 teda 里表示地/参考节点。 */
const PIN_TYPE_MAP: Record<string, string> = {
  input: "input",
  output: "output",
  bidirectional: "bidirectional",
  tri_state: "tri_state",
  passive: "passive",
  power: "power_in",
  power_in: "power_in",
  power_out: "power_out",
  open_collector: "open_collector",
  open_emitter: "open_emitter",
  no_connect: "no_connect",
  unspecified: "unspecified",
};

/** 符号里有、器件里没有的引脚号（缺一个就不能导出）。 */
export function missingPartPins(sym: SymbolBody, part: PartInfo): string[] {
  const known = new Set(part.pins.map((p) => p.number));
  return [...new Set(sym.pins.map((p) => p.number))].filter((n) => !known.has(n)).sort();
}

/** 器件里有、符号里没画的引脚号（只是警告：可以隐藏电源脚）。 */
export function unplacedPartPins(sym: SymbolBody, part: PartInfo): string[] {
  const drawn = new Set(sym.pins.map((p) => p.number));
  return part.pins.map((p) => p.number).filter((n) => !drawn.has(n)).sort();
}

function propertySexp(field: Field | undefined, name: string, value: string, hidden: boolean): string[] {
  const at = field?.at;
  const x = at ? mm(at.x_nm) : "0";
  const y = at ? mm(at.y_nm) : "0";
  const rot = at?.rotation_mdeg ? ` ${(at.rotation_mdeg / 1000).toString()}` : " 0";
  const effects = field?.effects;
  const width = effects?.width_nm ? mm(effects.width_nm) : "1.27";
  const height = effects?.height_nm ? mm(effects.height_nm) : "1.27";
  const hide = (field?.hide ?? false) || hidden;
  return [
    `${INDENT}${INDENT}(property ${q(name)} ${q(value)}`,
    `${INDENT}${INDENT}${INDENT}(at ${x} ${y}${rot})`,
    `${INDENT}${INDENT}${INDENT}(effects`,
    `${INDENT}${INDENT}${INDENT}${INDENT}(font`,
    `${INDENT}${INDENT}${INDENT}${INDENT}${INDENT}(size ${width} ${height})`,
    `${INDENT}${INDENT}${INDENT}${INDENT})`,
    ...(hide ? [`${INDENT}${INDENT}${INDENT}${INDENT}(hide yes)`] : []),
    `${INDENT}${INDENT}${INDENT})`,
    `${INDENT}${INDENT})`,
  ];
}

function strokeSexp(widthNm: number | undefined): string[] {
  // KiCad 的 stroke type 只有 default/dash/dash_dot/dot/dash_dot_dot；
  // "none" 不是合法值，KiCad 会拒绝整个符号库。线宽 0 表示不描边，用 width 0 + default。
  const width = widthNm === undefined || widthNm === 0 ? 0 : mm(widthNm);
  return [`${INDENT}${INDENT}${INDENT}(stroke (width ${width}) (type default))`];
}

function fillSexp(fill: BodyItem["fill"]): string[] {
  return [`${INDENT}${INDENT}${INDENT}(fill (type ${fill ?? "none"}))`];
}

function bodySexp(item: BodyItem): string[] {
  const head = `${INDENT}${INDENT}${INDENT}`;
  switch (item.kind) {
    case "line":
      return [
        `${head}(polyline`,
        `${head}${INDENT}(pts (xy ${mm(item.start!.x_nm)} ${mm(item.start!.y_nm)}) (xy ${mm(item.end!.x_nm)} ${mm(item.end!.y_nm)}))`,
        ...strokeSexp(item.width_nm),
        `${head})`,
      ];
    case "rect":
      return [
        `${head}(rectangle`,
        `${head}${INDENT}(start ${mm(item.start!.x_nm)} ${mm(item.start!.y_nm)})`,
        `${head}${INDENT}(end ${mm(item.end!.x_nm)} ${mm(item.end!.y_nm)})`,
        ...strokeSexp(item.width_nm),
        ...fillSexp(item.fill),
        `${head})`,
      ];
    case "circle":
      return [
        `${head}(circle`,
        `${head}${INDENT}(center ${mm(item.center!.x_nm)} ${mm(item.center!.y_nm)})`,
        `${head}${INDENT}(radius ${mm(item.radius_nm!)})`,
        ...strokeSexp(item.width_nm),
        ...fillSexp(item.fill),
        `${head})`,
      ];
    case "arc":
      return [
        `${head}(arc`,
        `${head}${INDENT}(start ${mm(item.start!.x_nm)} ${mm(item.start!.y_nm)})`,
        `${head}${INDENT}(mid ${mm(item.mid!.x_nm)} ${mm(item.mid!.y_nm)})`,
        `${head}${INDENT}(end ${mm(item.end!.x_nm)} ${mm(item.end!.y_nm)})`,
        ...strokeSexp(item.width_nm),
        ...fillSexp(item.fill),
        `${head})`,
      ];
    case "poly":
      return [
        `${head}(polyline`,
        `${head}${INDENT}(pts ${item.points!.map((p) => `(xy ${mm(p.x_nm)} ${mm(p.y_nm)})`).join(" ")})`,
        ...strokeSexp(item.width_nm),
        ...fillSexp(item.fill),
        `${head})`,
      ];
  }
}

function pinSexp(pin: Pin, partPin: PartPin, hideNames: boolean, hideNumbers: boolean): string[] {
  const head = `${INDENT}${INDENT}${INDENT}`;
  const inner = `${head}${INDENT}`;
  const at = pin.at;
  const rot = at.rotation_mdeg === undefined ? "0" : (at.rotation_mdeg / 1000).toString();
  const type = PIN_TYPE_MAP[partPin.type] ?? "unspecified";
  const effects = (text: string, hide: boolean) => [
    `${inner}(effects`,
    `${inner}${INDENT}(font`,
    `${inner}${INDENT}${INDENT}(size 1.27 1.27)`,
    `${inner}${INDENT})`,
    ...(hide ? [`${inner}${INDENT}(hide yes)`] : []),
    `${inner})`,
  ];
  return [
    `${head}(pin ${type} ${pin.style} (at ${mm(at.x_nm)} ${mm(at.y_nm)} ${rot}) (length ${mm(pin.length_nm)})`,
    `${inner}(name ${q(partPin.name)}`,
    ...effects(partPin.name, hideNames),
    `${inner})`,
    `${inner}(number ${q(pin.number)}`,
    ...effects(pin.number, hideNumbers),
    `${inner})`,
    `${head})`,
  ];
}

/**
 * 一个符号 → 一个只含该符号的 `.kicad_sym` 库文本。
 *
 * 引脚号在 `part` 里查不到时抛错：调用方应先跑 `missingPartPins` 给出干净诊断。
 */
export function symbolLibrary(
  sym: SymbolBody,
  part: PartInfo,
  options?: { generator?: string },
): string {
  const missing = missingPartPins(sym, part);
  if (missing.length > 0) {
    throw new Error(`符号引脚在器件里不存在：${missing.join(", ")}`);
  }
  const byNumber = new Map(part.pins.map((p) => [p.number, p]));
  const generator = options?.generator ?? "texteda";
  const field = (name: string) => sym.fields?.find((f) => f.name === name);

  const lines: string[] = [
    "(kicad_symbol_lib",
    `${INDENT}(version ${KICAD_SYMBOL_VERSION})`,
    `${INDENT}(generator ${q(generator)})`,
    `${INDENT}(symbol ${q(sym.name)}`,
  ];

  if (sym.units > 1) lines.push(`${INDENT}${INDENT}(unit_count ${sym.units})`);
  if (sym.power) lines.push(`${INDENT}${INDENT}(power)`);
  lines.push(`${INDENT}${INDENT}(exclude_from_sim no)`);
  lines.push(`${INDENT}${INDENT}(in_bom ${sym.in_bom ? "yes" : "no"})`);
  lines.push(`${INDENT}${INDENT}(on_board ${sym.on_board ? "yes" : "no"})`);
  if (sym.pin_numbers_hidden) lines.push(`${INDENT}${INDENT}(pin_numbers hide)`);
  const offset = mm(sym.pin_name_offset_nm ?? 508000);
  lines.push(
    `${INDENT}${INDENT}(pin_names (offset ${offset})${sym.pin_names_hidden ? " hide" : ""})`,
  );

  const reference = field("Reference");
  const value = field("Value");
  lines.push(...propertySexp(reference, "Reference", reference?.value ?? "U", false));
  lines.push(...propertySexp(value, "Value", value?.value ?? sym.name, false));
  lines.push(...propertySexp(field("Footprint"), "Footprint", part.footprint ?? "", true));
  lines.push(...propertySexp(field("Datasheet"), "Datasheet", part.datasheet ?? "", true));
  lines.push(
    ...propertySexp(
      field("Description"),
      "Description",
      sym.description ?? part.description ?? "",
      true,
    ),
  );

  // 单元 0 = 所有单元共用的外形（KiCad 的 <name>_0_1）。
  const common = (sym.body ?? []).filter((item) => (item.unit ?? 1) === 0);
  if (common.length > 0) {
    lines.push(`${INDENT}${INDENT}(symbol ${q(`${sym.name}_0_1`)}`);
    for (const item of common) lines.push(...bodySexp(item));
    lines.push(`${INDENT}${INDENT})`);
  }

  for (let unit = 1; unit <= sym.units; unit += 1) {
    const items = (sym.body ?? []).filter((item) => (item.unit ?? 1) === unit);
    const pins = sym.pins.filter((pin) => pin.unit === unit || pin.unit === 0);
    if (items.length === 0 && pins.length === 0) continue;
    lines.push(`${INDENT}${INDENT}(symbol ${q(`${sym.name}_${unit}_1`)}`);
    for (const item of items) lines.push(...bodySexp(item));
    for (const pin of pins) {
      lines.push(...pinSexp(pin, byNumber.get(pin.number)!, sym.pin_names_hidden, sym.pin_numbers_hidden));
    }
    lines.push(`${INDENT}${INDENT})`);
  }

  lines.push(`${INDENT})`);
  lines.push(")");
  return `${lines.join("\n")}\n`;
}
