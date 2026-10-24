// `symbol` description parsing: `.teda` source → IR fragments (spec/symbol.md, ADR-0012).
//
// Surface parsing and unit conversion only; pin names/electrical types do not live here — they belong to `component`,
// merged by pin number when exporting `.kicad_sym`. Contract validation is delegated to the closed schema in @texteda/ir.
import { irVersion } from "@texteda/ir";
import type { Symbol } from "@texteda/ir/symbol";
import type { Diagnostic, DiagnosticCodeId } from "./diagnostics.ts";
import { lex, type Cell, type Line } from "./lexer.ts";
import { SourceFile, recordObjects } from "./sources.ts";
import type { SourceMap, Span } from "@texteda/ir/spans";
import { byteCompare, naturalCompare } from "@texteda/ir/order";
import { parseAngleMdeg, parseLengthNm } from "./units.ts";
import { checkVersion, typeRange } from "./version.ts";
import { REV_RE } from "./ids.ts";

export const SYMBOL_SECTIONS = new Set(["pins", "body"]);
export const SYMBOL_PIN_KEYS = new Set(["length", "unit", "style"]);
export const SYMBOL_BODY_KEYS = new Set(["width", "fill", "unit"]);
/** Symbol fields have no `layer` (symbols are not layered). */
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
/** `symbol` was introduced in 0.5: files below 0.5 do not have this type. */
const VERSION_RANGE = typeRange("symbol");

export interface SymbolParseOptions {
  /** File name (used for diagnostics). */
  file: string;
  /** Library name; the IR's `symbol.library` comes from the library directory, not from the file content. */
  library: string;
}

export interface SymbolParseResult {
  ok: boolean;
  ir?: Symbol;
  diagnostics: Diagnostic[];
  /** IR path → span of the record that produced it (ADR-0020 D2). Never persisted. */
  sources?: SourceMap;
}

type SymbolBody = Symbol["symbol"];
type Pin = SymbolBody["pins"][number];
type BodyItem = NonNullable<SymbolBody["body"]>[number];
type Field = NonNullable<SymbolBody["fields"]>[number];

class Collector {
  readonly diagnostics: Diagnostic[] = [];

  error(file: string, line: number, col: number, code: DiagnosticCodeId, message: string): void {
    this.diagnostics.push({ code, severity: "error", message, location: { file, line, col } });
  }

  get hasError(): boolean {
    return this.diagnostics.some((d) => d.severity === "error");
  }
}

/** Parse the trailing `key=value` columns; unknown keys are errors. Structural problems always use syntax-domain codes, separate from "invalid value". */
function readKeyValues(
  cells: Cell[],
  allowed: Set<string>,
  file: string,
  line: number,
  out: Map<string, string>,
  collector: Collector,
): void {
  for (const cell of cells) {
    const eq = cell.text.indexOf("=");
    if (eq <= 0) {
      collector.error(file, line, cell.col, "syntax.invalid-token", `unrecognized cell: ${cell.text}`);
      continue;
    }
    const key = cell.text.slice(0, eq);
    if (!allowed.has(key)) {
      collector.error(file, line, cell.col, "syntax.unknown-field", `unknown key: ${key}`);
      continue;
    }
    if (out.has(key)) {
      collector.error(file, line, cell.col, "syntax.duplicate-key", `duplicate key: ${key}`);
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
  code: DiagnosticCodeId,
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
    collector.error(file, line, col, "value.invalid-unit", `unit must be a non-negative integer: ${raw}`);
    return null;
  }
  const unit = Number(raw);
  if (unit > units) {
    collector.error(file, line, col, "value.invalid-unit", `unit exceeds units=${units}: ${raw}`);
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
    collector.error(file, line, cells[0]?.col ?? 1, "syntax.row-too-short", "a pins row needs at least 4 columns: number x y rot");
    return null;
  }
  const firstCell = cells[0]!;
  const number = cells[0]!;
  const x = cells[1]!;
  const y = cells[2]!;
  const rot = cells[3]!;
  if (!PIN_NUMBER_RE.test(number.text)) {
    collector.error(file, line, number.col, "value.pin-number-invalid", `invalid pin number: ${number.text}`);
    return null;
  }
  const positions: number[] = [];
  for (const cell of [x, y]) {
    const parsed = parseLengthNm(cell.text, file, line, cell.col, "mm", "value.pin-geometry-invalid");
    if (!parsed.ok) {
      collector.diagnostics.push(parsed.diagnostic);
      return null;
    }
    positions.push(parsed.value);
  }
  const parsedRot = parseAngleMdeg(rot.text, file, line, rot.col, "deg", "value.pin-geometry-invalid");
  if (!parsedRot.ok) {
    collector.diagnostics.push(parsedRot.diagnostic);
    return null;
  }

  const kv = new Map<string, string>();
  readKeyValues(cells.slice(4), SYMBOL_PIN_KEYS, file, line, kv, collector);

  const pin: Pin = {
    number: number.text,
    at: { x_nm: positions[0]!, y_nm: positions[1]!, rotation_mdeg: parsedRot.value },
    length_nm: 2540000,
    unit: 1,
    style: "line",
  };

  const length = kv.get("length");
  if (length !== undefined) {
    const parsed = parseLengthNm(length, file, line, firstCell.col, "mm", "value.pin-attribute-invalid");
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
      collector.error(file, line, firstCell.col, "value.pin-attribute-invalid", `unknown pin style: ${style}`);
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
    collector.error(file, line, cells[0]?.col ?? 1, "syntax.row-too-short", "a body row needs at least 2 columns: kind geometry");
    return null;
  }
  const kindCell = cells[0]!;
  const geometryCell = cells[1]!;
  if (!BODY_KINDS.has(kindCell.text)) {
    collector.error(file, line, kindCell.col, "value.graphic-invalid", `unknown graphic kind: ${kindCell.text}`);
    return null;
  }
  const values = readLengthList(geometryCell.text, file, line, geometryCell.col, "value.graphic-invalid", collector);
  if (values === null) return null;

  const item: BodyItem = { kind: kindCell.text as BodyItem["kind"], unit: 1 };

  const need = (count: number): boolean => {
    if (values.length !== count) {
      collector.error(
        file,
        line,
        geometryCell.col,
        "value.graphic-invalid",
        `${kindCell.text} geometry needs ${count} numbers, got ${values.length}`,
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
        collector.error(file, line, geometryCell.col, "value.graphic-invalid", "circle radius must be positive");
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
        collector.error(file, line, geometryCell.col, "value.graphic-invalid", "poly needs at least 3 points (x,y alternating)");
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
  readKeyValues(cells.slice(2), SYMBOL_BODY_KEYS, file, line, kv, collector);
  const width = kv.get("width");
  if (width !== undefined) {
    const parsed = parseLengthNm(width, file, line, kindCell.col, "mm", "value.graphic-attribute-invalid");
    if (parsed.ok) item.width_nm = parsed.value;
    else collector.diagnostics.push(parsed.diagnostic);
  }
  const fill = kv.get("fill");
  if (fill !== undefined) {
    if (kindCell.text === "line" || kindCell.text === "arc") {
      collector.error(file, line, kindCell.col, "value.graphic-attribute-invalid", "fill only applies to rect/circle/poly");
    } else if (!FILLS.has(fill)) {
      collector.error(file, line, kindCell.col, "value.graphic-attribute-invalid", `unknown fill: ${fill}`);
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

/** Canonical order for body: unit → kind → coordinates item by item. */
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

/** Parse a `symbol` file. */
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
    collector.error(file, versionLine?.number ?? 1, 1, "syntax.header-invalid", "the first line must be version <ver>");
    return { ok: false, diagnostics: collector.diagnostics };
  }
  const version = versionLine.cells[1]!.text;
  const verdict = checkVersion(version, VERSION_RANGE, "symbol");
  if (!verdict.ok) {
    collector.error(file, versionLine.number, versionLine.cells[1]!.col, verdict.code, verdict.message);
  }

  const typeLine = nextMeaningful();
  if (!typeLine || typeLine.cells.length !== 2 || typeLine.cells[0]!.text !== "symbol") {
    collector.error(file, typeLine?.number ?? 1, 1, "syntax.header-invalid", "the second line must be symbol <id>");
    return { ok: false, diagnostics: collector.diagnostics };
  }
  const name = typeLine.cells[1]!.text;
  if (!SYMBOL_ID_RE.test(name)) {
    collector.error(file, typeLine.number, typeLine.cells[1]!.col, "syntax.invalid-token", `not a valid symbol name: ${name}`);
  }

  // Scalars have defaults; materialize them all as explicit values first: the IR depends only on semantics (spec/symbol.md §7 rule 6).
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
  // Span of each record, by object identity: the IR sorts these arrays, so the index in a pointer
  // only means something after the sort (ADR-0020 D2/D4).
  const at = new Map<object, Span>();
  const src = new SourceFile(file, lex(text));
  const put = <T extends object>(list: T[], item: T, line: Line): void => {
    list.push(item);
    at.set(item, src.span(line.number, line.cells[0]?.col));
  };
  let section: "pins" | "body" | null = null;

  const readBool = (line: Line, key: Cell, value: string): boolean | null => {
    if (value === "yes") return true;
    if (value === "no") return false;
    collector.error(file, line.number, key.col, "syntax.invalid-literal", `${key.text} can only be yes/no: ${value}`);
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
        collector.error(file, line.number, line.cells[0]!.col, "syntax.unknown-section", `unknown section: ${head}`);
        continue;
      }
      collector.error(file, line.number, line.cells[0]!.col, "syntax.row-too-short", "a row inside a section needs at least 2 cells");
      continue;
    }

    if (section === null) {
      const key = line.cells[0]!.text;
      const rest = line.cells.slice(1);
      const trailing = (from: number): string => rest.slice(from).map((c) => c.text).join(" ");
      switch (key) {
        case "rev": {
          // The release of *this file's* facts (ADR-0049 D1), not the format version.
          const value = trailing(0);
          if (!REV_RE.test(value)) {
            collector.error(file, line.number, line.cells[1]?.col ?? line.cells[0]!.col, "value.rev-invalid", `rev must be a release name without whitespace: "${value}"`);
          } else {
            body.rev = value;
          }
          break;
        }
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
            collector.error(file, line.number, line.cells[1]!.col, "syntax.invalid-literal", `units must be a positive integer: ${raw}`);
          } else {
            body.units = Number(raw);
          }
          break;
        }
        case "pin_numbers":
        case "pin_names": {
          const raw = trailing(0);
          if (!SHOW_HIDE.has(raw)) {
            collector.error(file, line.number, line.cells[1]!.col, "syntax.invalid-literal", `${key} can only be show/hide: ${raw}`);
          } else if (key === "pin_numbers") {
            body.pin_numbers_hidden = raw === "hide";
          } else {
            body.pin_names_hidden = raw === "hide";
          }
          break;
        }
        case "pin_name_offset": {
          const parsed = parseLengthNm(trailing(0), file, line.number, line.cells[1]!.col, "mm", "value.length-invalid");
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
            collector.error(file, line.number, line.cells[0]!.col, "library.field-invalid", "a field needs a name");
            break;
          }
          if (fields.some((f) => f.name === fieldName)) {
            collector.error(file, line.number, rest[0]!.col, "library.field-invalid", `duplicate field name: ${fieldName}`);
          }
          // Keys always come before values: consume consecutive key=value cells first, then validate key names.
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
              "library.field-invalid",
              fieldKey === "layer"
                ? "symbols have no layers: field does not accept layer"
                : `unknown field key: ${fieldKey}`,
            );
          }
          const field: Field = { name: fieldName, value: trailing(cursor) };
          const at = kv.get("at");
          if (at !== undefined) {
            const values = readLengthList(at, file, line.number, rest[0]!.col, "library.field-invalid", collector);
            if (values && values.length === 2) field.at = { x_nm: values[0]!, y_nm: values[1]! };
          }
          const hide = kv.get("hide");
          if (hide !== undefined) field.hide = hide === "yes" || hide === "true";
          const size = kv.get("size");
          if (size !== undefined) {
            const values = readLengthList(size, file, line.number, rest[0]!.col, "library.field-invalid", collector);
            if (values && values.length === 2) {
              field.effects = { width_nm: values[0]!, height_nm: values[1]! };
            }
          }
          put(fields, field, line);
          break;
        }
        default:
          collector.error(file, line.number, line.cells[0]!.col, "syntax.unknown-field", `unknown scalar: ${key}`);
      }
      continue;
    }

    if (section === "pins") {
      const pin = parsePinRow(line.cells, file, line.number, body.units, collector);
      if (pin) put(pins, pin, line);
    } else {
      const item = parseBodyRow(line.cells, file, line.number, body.units, collector);
      if (item) put(bodyItems, item, line);
    }
  }

  if (pins.length === 0) collector.error(file, 1, 1, "library.pins-empty", "the pins section must not be empty");
  const seen = new Set<string>();
  for (const pin of pins) {
    const key = `${pin.unit}:${pin.number}`;
    if (seen.has(key)) collector.error(file, 1, 1, "library.duplicate-pin-number", `duplicate pin number: ${pin.number} (unit ${pin.unit})`);
    seen.add(key);
  }

  // The IR is a function of semantics: pins sorted by (unit, number), body by (unit, kind, coordinates), fields by name.
  pins.sort((a, b) => (a.unit !== b.unit ? a.unit - b.unit : naturalCompare(a.number, b.number)));
  bodyItems.sort(compareBody);
  fields.sort((a, b) => byteCompare(a.name, b.name));

  const [firstPin, ...restPins] = pins;
  if (!firstPin) return { ok: false, diagnostics: collector.diagnostics };
  body.pins = [firstPin, ...restPins];
  if (bodyItems.length > 0) body.body = bodyItems;
  if (fields.length > 0) body.fields = fields;

  const ir: Symbol = {
    ir_version: irVersion,
    source: { file, line: 1 },
    symbol: body,
  };

  if (collector.hasError) return { ok: false, diagnostics: collector.diagnostics };

  const sources: SourceMap = new Map();
  recordObjects(sources, "/symbol/pins", body.pins, at);
  recordObjects(sources, "/symbol/body", body.body ?? [], at);
  recordObjects(sources, "/symbol/fields", body.fields ?? [], at);

  return { ok: true, ir, diagnostics: collector.diagnostics, sources };
}
