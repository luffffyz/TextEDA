// Symbol → KiCad `.kicad_sym`.
//
// The source of truth is split in two (ADR-0031):
//   - the `symbol` shard (schemas/ir/v0.3/symbol.schema.json) provides the view: pin placement, outline, units, visibility toggles;
//   - `component` provides the electrical facts: pin names, electrical types, footprint, datasheet.
// On export the two are joined by **pin number**; this is where "one fact, one owner" lands.
import type { Symbol } from "@texteda/ir/symbol";
import { mm } from "./footprint.ts";

export type SymbolBody = Symbol["symbol"];
type Pin = SymbolBody["pins"][number];
type BodyItem = NonNullable<SymbolBody["body"]>[number];
type Field = NonNullable<SymbolBody["fields"]>[number];

/** KiCad 10 symbol library format version. */
export const KICAD_SYMBOL_VERSION = "20251024";

const INDENT = "\t";
const q = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/** The subset of facts from `component` needed to export a symbol. */
export interface PartPin {
  number: string;
  name: string;
  /** teda electrical type (`teda.md` §10.1). */
  type: string;
}

export interface PartInfo {
  pins: PartPin[];
  /** `<lib>:<name>`, written verbatim into the Footprint property. */
  footprint?: string;
  datasheet?: string;
  /** Component description; when the symbol carries its own description, the symbol wins. */
  description?: string;
}

/** teda electrical type → KiCad pin type. `power` denotes a ground/reference node in teda. */
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

/** Pin numbers present in the symbol but absent from the component (any missing one blocks export). */
export function missingPartPins(sym: SymbolBody, part: PartInfo): string[] {
  const known = new Set(part.pins.map((p) => p.number));
  return [...new Set(sym.pins.map((p) => p.number))].filter((n) => !known.has(n)).sort();
}

/** Pin numbers present in the component but not drawn in the symbol (warning only: power pins may be hidden). */
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
  // KiCad's stroke type only accepts default/dash/dash_dot/dot/dash_dot_dot;
  // "none" is not a valid value, and KiCad rejects the whole symbol library for it.
  // A line width of 0 means no stroking: use width 0 + default.
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
 * One symbol → the text of a `.kicad_sym` library containing only that symbol.
 *
 * Throws when a pin number cannot be found in `part`: callers should run `missingPartPins`
 * first to get a clean diagnostic.
 */
export function symbolLibrary(
  sym: SymbolBody,
  part: PartInfo,
  options?: { generator?: string },
): string {
  const missing = missingPartPins(sym, part);
  if (missing.length > 0) {
    throw new Error(`Symbol pins not present in component: ${missing.join(", ")}`);
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

  // Unit 0 = the outline shared by all units (KiCad's <name>_0_1).
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
