// `symbol` 描述解析：`.teda` 源码 → IR 分片（spec/symbol.md，ADR-0012）。
//
// 只做表面解析与单位换算；引脚名/电气类型不在这里——它们归 `component`，
// 导出 `.kicad_sym` 时按引脚号合并。契约校验交给 @texteda/ir 的 closed schema。
import type { Symbol } from "@texteda/ir/symbol";
import type { Diagnostic } from "./diagnostics.ts";
import { lex, type Cell, type Line } from "./lexer.ts";
import { byteCompare, naturalCompare } from "./order.ts";
import { parseAngleMdeg, parseLengthNm } from "./units.ts";

export const SYMBOL_SECTIONS = new Set(["pins", "body"]);
export const SYMBOL_PIN_KEYS = new Set(["length", "unit", "style"]);
export const SYMBOL_BODY_KEYS = new Set(["width", "fill", "unit"]);
/** 符号字段没有 layer（符号不分层）。 */
export const SYMBOL_FIELD_KEYS = new Set(["at", "hide", "size"]);
const PIN_STYLES = new Set([
  "line",
  "inverted",
  "clock",
  "inverted_clock",
  "input_low",
  "clock_low",
  "output_low",
  "edge_clock_high",
  "non_logic",
]);
const BODY_KINDS = new Set(["line", "rect", "circle", "arc", "poly"]);
const FILLS = new Set(["none", "outline", "background"]);
const SHOW_HIDE = new Set(["show", "hide"]);
const SYMBOL_ID_RE = /^[A-Za-z0-9_.+-]+$/;
const PIN_NUMBER_RE = /^[A-Za-z0-9_+-]+$/;
const VERSION_RE = /^0\.([1-9][0-9]*)$/;
/** `symbol` 由 0.5 引入：低于 0.5 的文件没有这个类型。 */
const REQUIRED_MINOR = 5;
const SUPPORTED_MINOR = 5;

export interface SymbolParseOptions {
  /** 文件名（诊断用）。 */
  file: string;
  /** 库名；IR 的 `symbol.library` 来自库目录，不来自文件内容。 */
  library: string;
}

export interface SymbolParseResult {
  ok: boolean;
  ir?: Symbol;
  diagnostics: Diagnostic[];
}

type SymbolBody = Symbol["symbol"];
type Pin = SymbolBody["pins"][number];
type BodyItem = NonNullable<SymbolBody["body"]>[number];
type Field = NonNullable<SymbolBody["fields"]>[number];

class Collector {
  readonly diagnostics: Diagnostic[] = [];

  error(file: string, line: number, col: number, code: string, message: string): void {
    this.diagnostics.push({ file, line, col, severity: "error", code, message });
  }

  get hasError(): boolean {
    return this.diagnostics.some((d) => d.severity === "error");
  }
}

/** 解析 `key=value` 尾列；未知键报错。 */
function readKeyValues(
  cells: Cell[],
  allowed: Set<string>,
  file: string,
  line: number,
  code: string,
  out: Map<string, string>,
  collector: Collector,
): void {
  for (const cell of cells) {
    const eq = cell.text.indexOf("=");
    if (eq <= 0) {
      collector.error(file, line, cell.col, code, `无法识别的单元：${cell.text}`);
      continue;
    }
    const key = cell.text.slice(0, eq);
    if (!allowed.has(key)) {
      collector.error(file, line, cell.col, code, `未知键：${key}`);
      continue;
    }
    if (out.has(key)) {
      collector.error(file, line, cell.col, code, `键重复：${key}`);
      continue;
    }
    out.set(key, cell.text.slice(eq + 1));
  }
}

function readLengthList(
  text: string,
  file: string,
  line: number,
  col: number,
  code: string,
  collector: Collector,
): number[] | null {
  const values: number[] = [];
  for (const part of text.split(",")) {
    const parsed = parseLengthNm(part, file, line, col, "mm", code);
    if (!parsed.ok) {
      collector.diagnostics.push(parsed.diagnostic);
      return null;
    }
    values.push(parsed.value);
  }
  return values;
}

function parseUnit(raw: string, file: string, line: number, col: number, units: number, collector: Collector): number | null {
  if (!/^\d+$/.test(raw)) {
    collector.error(file, line, col, "S202", `unit 必须是整数：${raw}`);
    return null;
  }
  const unit = Number(raw);
  if (unit > units) {
    collector.error(file, line, col, "S202", `unit 超出 units=${units}：${raw}`);
    return null;
  }
  return unit;
}

function parsePinRow(
  cells: Cell[],
  file: string,
  line: number,
  units: number,
  collector: Collector,
): Pin | null {
  if (cells.length < 4) {
    collector.error(file, line, cells[0]?.col ?? 1, "S212", "pins 行至少 4 列：number x y rot");
    return null;
  }
  const firstCell = cells[0]!;
  const number = cells[0]!;
  const x = cells[1]!;
  const y = cells[2]!;
  const rot = cells[3]!;
  if (!PIN_NUMBER_RE.test(number.text)) {
    collector.error(file, line, number.col, "S200", `引脚号不合法：${number.text}`);
    return null;
  }
  const positions: number[] = [];
  for (const cell of [x, y]) {
    const parsed = parseLengthNm(cell.text, file, line, cell.col, "mm", "S200");
    if (!parsed.ok) {
      collector.diagnostics.push(parsed.diagnostic);
      return null;
    }
    positions.push(parsed.value);
  }
  const parsedRot = parseAngleMdeg(rot.text, file, line, rot.col, "deg", "S200");
  if (!parsedRot.ok) {
    collector.diagnostics.push(parsedRot.diagnostic);
    return null;
  }

  const kv = new Map<string, string>();
  readKeyValues(cells.slice(4), SYMBOL_PIN_KEYS, file, line, "S201", kv, collector);

  const pin: Pin = {
    number: number.text,
    at: { x_nm: positions[0]!, y_nm: positions[1]!, rotation_mdeg: parsedRot.value },
    length_nm: 2540000,
    unit: 1,
    style: "line",
  };

  const length = kv.get("length");
  if (length !== undefined) {
    const parsed = parseLengthNm(length, file, line, firstCell.col, "mm", "S201");
    if (parsed.ok) pin.length_nm = parsed.value;
    else collector.diagnostics.push(parsed.diagnostic);
  }
  const unit = kv.get("unit");
  if (unit !== undefined) {
    const parsed = parseUnit(unit, file, line, firstCell.col, units, collector);
    if (parsed !== null) pin.unit = parsed;
  }
  const style = kv.get("style");
  if (style !== undefined) {
    if (!PIN_STYLES.has(style)) {
      collector.error(file, line, firstCell.col, "S201", `未知引脚图形：${style}`);
    } else {
      pin.style = style as Pin["style"];
    }
  }
  return pin;
}

function parseBodyRow(
  cells: Cell[],
  file: string,
  line: number,
  units: number,
  collector: Collector,
): BodyItem | null {
  if (cells.length < 2) {
    collector.error(file, line, cells[0]?.col ?? 1, "S312", "body 行至少 2 列：kind geometry");
    return null;
  }
  const kindCell = cells[0]!;
  const geometryCell = cells[1]!;
  if (!BODY_KINDS.has(kindCell.text)) {
    collector.error(file, line, kindCell.col, "S300", `未知图形种类：${kindCell.text}`);
    return null;
  }
  const values = readLengthList(geometryCell.text, file, line, geometryCell.col, "S300", collector);
  if (values === null) return null;

  const item: BodyItem = { kind: kindCell.text as BodyItem["kind"], unit: 1 };

  const need = (count: number): boolean => {
    if (values.length !== count) {
      collector.error(
        file,
        line,
        geometryCell.col,
        "S300",
        `${kindCell.text} 的几何需要 ${count} 个数，得到 ${values.length}`,
      );
      return false;
    }
    return true;
  };

  switch (kindCell.text) {
    case "line":
    case "rect": {
      if (!need(4)) return null;
      item.start = { x_nm: values[0]!, y_nm: values[1]! };
      item.end = { x_nm: values[2]!, y_nm: values[3]! };
      break;
    }
    case "circle": {
      if (!need(3)) return null;
      if (values[2]! <= 0) {
        collector.error(file, line, geometryCell.col, "S300", "圆半径必须为正");
        return null;
      }
      item.center = { x_nm: values[0]!, y_nm: values[1]! };
      item.radius_nm = values[2]!;
      break;
    }
    case "arc": {
      if (!need(6)) return null;
      item.start = { x_nm: values[0]!, y_nm: values[1]! };
      item.mid = { x_nm: values[2]!, y_nm: values[3]! };
      item.end = { x_nm: values[4]!, y_nm: values[5]! };
      break;
    }
    case "poly": {
      if (values.length < 6 || values.length % 2 !== 0) {
        collector.error(file, line, geometryCell.col, "S300", "poly 至少 3 个点（x,y 交替）");
        return null;
      }
      const points = [];
      for (let i = 0; i < values.length; i += 2) {
        points.push({ x_nm: values[i]!, y_nm: values[i + 1]! });
      }
      const [p0, p1, p2, ...rest] = points;
      if (p0 && p1 && p2) item.points = [p0, p1, p2, ...rest];
      break;
    }
  }

  const kv = new Map<string, string>();
  readKeyValues(cells.slice(2), SYMBOL_BODY_KEYS, file, line, "S301", kv, collector);
  const width = kv.get("width");
  if (width !== undefined) {
    const parsed = parseLengthNm(width, file, line, kindCell.col, "mm", "S301");
    if (parsed.ok) item.width_nm = parsed.value;
    else collector.diagnostics.push(parsed.diagnostic);
  }
  const fill = kv.get("fill");
  if (fill !== undefined) {
    if (kindCell.text === "line" || kindCell.text === "arc") {
      collector.error(file, line, kindCell.col, "S301", "fill 只适用于 rect/circle/poly");
    } else if (!FILLS.has(fill)) {
      collector.error(file, line, kindCell.col, "S301", `未知填充：${fill}`);
    } else {
      item.fill = fill as NonNullable<BodyItem["fill"]>;
    }
  }
  const unit = kv.get("unit");
  if (unit !== undefined) {
    const parsed = parseUnit(unit, file, line, kindCell.col, units, collector);
    if (parsed !== null) item.unit = parsed;
  }
  return item;
}

function graphicCoords(item: BodyItem): number[] {
  switch (item.kind) {
    case "circle":
      return [item.center!.x_nm, item.center!.y_nm, item.radius_nm!];
    case "poly":
      return item.points!.flatMap((p) => [p.x_nm, p.y_nm]);
    case "arc":
      return [
        item.start!.x_nm,
        item.start!.y_nm,
        item.mid!.x_nm,
        item.mid!.y_nm,
        item.end!.x_nm,
        item.end!.y_nm,
      ];
    default:
      return [item.start!.x_nm, item.start!.y_nm, item.end!.x_nm, item.end!.y_nm];
  }
}

/** body 的 canonical 顺序：unit → kind → 坐标逐项数值。 */
function compareBody(a: BodyItem, b: BodyItem): number {
  const byUnit = (a.unit ?? 1) - (b.unit ?? 1);
  if (byUnit !== 0) return byUnit;
  const byKind = byteCompare(a.kind, b.kind);
  if (byKind !== 0) return byKind;
  const ca = graphicCoords(a);
  const cb = graphicCoords(b);
  for (let i = 0; i < Math.min(ca.length, cb.length); i += 1) {
    const diff = ca[i]! - cb[i]!;
    if (diff !== 0) return diff;
  }
  return ca.length - cb.length;
}

/** 解析一个 `symbol` 文件。 */
export function parseSymbol(text: string, options: SymbolParseOptions): SymbolParseResult {
  const collector = new Collector();
  const { file } = options;
  const lines = lex(text);

  let index = 0;
  const nextMeaningful = (): Line | null => {
    while (index < lines.length) {
      const line = lines[index]!;
      index += 1;
      if (line.blank || line.comment) continue;
      return line;
    }
    return null;
  };

  const versionLine = nextMeaningful();
  if (!versionLine || versionLine.cells.length !== 2 || versionLine.cells[0]!.text !== "version") {
    collector.error(file, versionLine?.number ?? 1, 1, "S113", "第一行必须是 version <ver>");
    return { ok: false, diagnostics: collector.diagnostics };
  }
  const version = versionLine.cells[1]!.text;
  const versionMatch = VERSION_RE.exec(version);
  if (!versionMatch) {
    collector.error(file, versionLine.number, versionLine.cells[1]!.col, "S113", `版本号不合法：${version}`);
  } else if (Number(versionMatch[1]) < REQUIRED_MINOR) {
    collector.error(
      file,
      versionLine.number,
      versionLine.cells[1]!.col,
      "S113",
      `symbol 类型需要 version ${(REQUIRED_MINOR / 10).toFixed(1)}（当前 ${version}）`,
    );
  } else if (Number(versionMatch[1]) > SUPPORTED_MINOR) {
    collector.error(
      file,
      versionLine.number,
      versionLine.cells[1]!.col,
      "S113",
      `版本 ${version} 高于本工具支持的 0.${SUPPORTED_MINOR}`,
    );
  }

  const typeLine = nextMeaningful();
  if (!typeLine || typeLine.cells.length !== 2 || typeLine.cells[0]!.text !== "symbol") {
    collector.error(file, typeLine?.number ?? 1, 1, "S113", "第二行必须是 symbol <id>");
    return { ok: false, diagnostics: collector.diagnostics };
  }
  const name = typeLine.cells[1]!.text;
  if (!SYMBOL_ID_RE.test(name)) {
    collector.error(file, typeLine.number, typeLine.cells[1]!.col, "S113", `符号名不合法：${name}`);
  }

  // 标量有默认值，先全部落成显式值：IR 只依赖语义（spec/symbol.md §7 规则 6）。
  const body: SymbolBody = {
    library: options.library,
    name,
    units: 1,
    pin_numbers_hidden: false,
    pin_names_hidden: false,
    pin_name_offset_nm: 508000,
    power: false,
    in_bom: true,
    on_board: true,
    pins: [] as unknown as SymbolBody["pins"],
  };
  const pins: Pin[] = [];
  const bodyItems: BodyItem[] = [];
  const fields: Field[] = [];
  let section: "pins" | "body" | null = null;

  const readBool = (line: Line, key: Cell, value: string): boolean | null => {
    if (value === "yes") return true;
    if (value === "no") return false;
    collector.error(file, line.number, key.col, "S111", `${key.text} 只能是 yes/no：${value}`);
    return null;
  };

  while (index < lines.length) {
    const line = lines[index]!;
    index += 1;
    if (line.blank || line.comment) continue;

    if (line.cells.length === 1) {
      const head = line.cells[0]!.text;
      if (SYMBOL_SECTIONS.has(head)) {
        section = head as "pins" | "body";
        continue;
      }
      if (section === null) {
        collector.error(file, line.number, line.cells[0]!.col, "S110", `未知段：${head}`);
        continue;
      }
      collector.error(file, line.number, line.cells[0]!.col, "S112", "段内行至少 2 个单元格");
      continue;
    }

    if (section === null) {
      const key = line.cells[0]!.text;
      const rest = line.cells.slice(1);
      const trailing = (from: number): string => rest.slice(from).map((c) => c.text).join(" ");
      switch (key) {
        case "description":
          body.description = trailing(0);
          break;
        case "tags": {
          const tags = trailing(0).split(/\s+/).filter((t) => t.length > 0);
          if (tags.length > 0) body.tags = [...tags].sort(byteCompare);
          break;
        }
        case "units": {
          const raw = trailing(0);
          if (!/^\d+$/.test(raw) || Number(raw) < 1) {
            collector.error(file, line.number, line.cells[1]!.col, "S111", `units 必须是正整数：${raw}`);
          } else {
            body.units = Number(raw);
          }
          break;
        }
        case "pin_numbers":
        case "pin_names": {
          const raw = trailing(0);
          if (!SHOW_HIDE.has(raw)) {
            collector.error(file, line.number, line.cells[1]!.col, "S111", `${key} 只能是 show/hide：${raw}`);
          } else if (key === "pin_numbers") {
            body.pin_numbers_hidden = raw === "hide";
          } else {
            body.pin_names_hidden = raw === "hide";
          }
          break;
        }
        case "pin_name_offset": {
          const parsed = parseLengthNm(trailing(0), file, line.number, line.cells[1]!.col, "mm", "S111");
          if (parsed.ok) body.pin_name_offset_nm = parsed.value;
          else collector.diagnostics.push(parsed.diagnostic);
          break;
        }
        case "power": {
          const value = rest[0]?.text ?? "";
          const parsed = readBool(line, line.cells[0]!, value);
          if (parsed !== null) body.power = parsed;
          break;
        }
        case "in_bom": {
          const value = rest[0]?.text ?? "";
          const parsed = readBool(line, line.cells[0]!, value);
          if (parsed !== null) body.in_bom = parsed;
          break;
        }
        case "on_board": {
          const value = rest[0]?.text ?? "";
          const parsed = readBool(line, line.cells[0]!, value);
          if (parsed !== null) body.on_board = parsed;
          break;
        }
        case "field": {
          const fieldName = rest[0]?.text ?? "";
          if (rest.length === 0) {
            collector.error(file, line.number, line.cells[0]!.col, "S400", "field 需要属性名");
            break;
          }
          if (fields.some((f) => f.name === fieldName)) {
            collector.error(file, line.number, rest[0]!.col, "S400", `属性名重复：${fieldName}`);
          }
          // 键一律在值之前：先吃掉连续的 key=value 单元格，再校验键名。
          let cursor = 1;
          const kv = new Map<string, string>();
          while (cursor < rest.length) {
            const cell = rest[cursor]!;
            const eq = cell.text.indexOf("=");
            if (eq <= 0) break;
            kv.set(cell.text.slice(0, eq), cell.text.slice(eq + 1));
            cursor += 1;
          }
          for (const fieldKey of kv.keys()) {
            if (SYMBOL_FIELD_KEYS.has(fieldKey)) continue;
            collector.error(
              file,
              line.number,
              line.cells[0]!.col,
              "S400",
              fieldKey === "layer"
                ? "符号没有层：field 不接受 layer"
                : `未知字段键：${fieldKey}`,
            );
          }
          const field: Field = { name: fieldName, value: trailing(cursor) };
          const at = kv.get("at");
          if (at !== undefined) {
            const values = readLengthList(at, file, line.number, rest[0]!.col, "S400", collector);
            if (values && values.length === 2) field.at = { x_nm: values[0]!, y_nm: values[1]! };
          }
          const hide = kv.get("hide");
          if (hide !== undefined) field.hide = hide === "yes" || hide === "true";
          const size = kv.get("size");
          if (size !== undefined) {
            const values = readLengthList(size, file, line.number, rest[0]!.col, "S400", collector);
            if (values && values.length === 2) {
              field.effects = { width_nm: values[0]!, height_nm: values[1]! };
            }
          }
          fields.push(field);
          break;
        }
        default:
          collector.error(file, line.number, line.cells[0]!.col, "S110", `未知标量：${key}`);
      }
      continue;
    }

    if (section === "pins") {
      const pin = parsePinRow(line.cells, file, line.number, body.units, collector);
      if (pin) pins.push(pin);
    } else {
      const item = parseBodyRow(line.cells, file, line.number, body.units, collector);
      if (item) bodyItems.push(item);
    }
  }

  if (pins.length === 0) collector.error(file, 1, 1, "S210", "pins 段不能为空");
  const seen = new Set<string>();
  for (const pin of pins) {
    const key = `${pin.unit}:${pin.number}`;
    if (seen.has(key)) collector.error(file, 1, 1, "S211", `引脚号重复：${pin.number}（unit ${pin.unit}）`);
    seen.add(key);
  }

  // IR 是语义的函数：引脚按 (unit, 号)、外形按 (unit, kind, 坐标)、字段按名排。
  pins.sort((a, b) => (a.unit !== b.unit ? a.unit - b.unit : naturalCompare(a.number, b.number)));
  bodyItems.sort(compareBody);
  fields.sort((a, b) => byteCompare(a.name, b.name));

  const [firstPin, ...restPins] = pins;
  if (!firstPin) return { ok: false, diagnostics: collector.diagnostics };
  body.pins = [firstPin, ...restPins];
  if (bodyItems.length > 0) body.body = bodyItems;
  if (fields.length > 0) body.fields = fields;

  const ir: Symbol = {
    ir_version: "0.1",
    source: { file, line: 1 },
    symbol: body,
  };

  if (collector.hasError) return { ok: false, diagnostics: collector.diagnostics };
  return { ok: true, ir, diagnostics: collector.diagnostics };
}
