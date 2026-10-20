// `.teda` 表面格式化：canonical form（各描述规范 §8、teda.md §12）。
//
// 语义先交给对应的 parser 校验；本模块只重排表面，不经 IR：
// IR 会展开默认层集合、丢掉表面拼写，从 IR 回写会把文件写胖，也做不出最小 diff。
//
// 不变量（teda.md §12）：parse(fmt(x)) 与 parse(x) 语义相同；fmt(fmt(x)) === fmt(x)。
import type { Diagnostic } from "./diagnostics.ts";
import { lex, type Cell } from "./lexer.ts";
import { byteCompare, naturalCompare } from "./order.ts";
import {
  FIELD_KEYS,
  MODEL_KEYS,
  parseFootprint,
  type ParseOptions,
  SECTIONS as FOOTPRINT_SECTIONS,
} from "./footprint.ts";
import { parseSymbol, SYMBOL_SECTIONS, type SymbolParseOptions } from "./symbol.ts";
import {
  formatAngleMdeg,
  formatLengthNm,
  formatPpm,
  parseAngleMdeg,
  parseLengthNm,
  parsePpm,
} from "./units.ts";

export interface FormatResult {
  ok: boolean;
  /** canonical 文本；输入有错误时不给。 */
  text?: string;
  diagnostics: Diagnostic[];
}

export interface RawRow {
  comments: string[];
  cells: Cell[];
  line: number;
}

export interface Row {
  comments: string[];
  cells: string[];
}

export type Kind = "length" | "angle" | "ratio";

export function canonValue(text: string, col: number, kind: Kind, file: string, line: number): string {
  const parsed =
    kind === "length"
      ? parseLengthNm(text, file, line, col, "mm", "F100")
      : kind === "angle"
        ? parseAngleMdeg(text, file, line, col, "deg", "F100")
        : parsePpm(text, file, line, col, "F101");
  if (!parsed.ok) return text; // 校验阶段已报错；这里只保底
  return kind === "length"
    ? formatLengthNm(parsed.value)
    : kind === "angle"
      ? formatAngleMdeg(parsed.value)
      : formatPpm(parsed.value);
}

/** `x,y,z` 形式的列表：逐项归一，再以 `,` 连接。 */
export function canonList(
  text: string,
  col: number,
  kind: Kind,
  file: string,
  line: number,
): string {
  return text
    .split(",")
    .map((part) => canonValue(part, col, kind, file, line))
    .join(",");
}

/** 尾列 `key=value`：按键名 ASCII 字节序排序；未知形状（校验已报错）原样保留。 */
export function canonKeyValues(
  cells: Cell[],
  canon: (key: string, raw: string, col: number) => string,
): string[] {
  const pairs: Array<[string, string]> = [];
  for (const cell of cells) {
    const eq = cell.text.indexOf("=");
    if (eq <= 0) continue;
    const key = cell.text.slice(0, eq);
    pairs.push([key, canon(key, cell.text.slice(eq + 1), cell.col)]);
  }
  pairs.sort((a, b) => byteCompare(a[0], b[0]));
  return pairs.map(([key, value]) => `${key}=${value}`);
}

/** 标量行：单元格之间有且只有一个空格（标量不是表，不做列对齐）。 */
export function scalarLines(rows: Row[]): string[] {
  return rows.flatMap((row) => [...row.comments, row.cells.join(" ")]);
}

/** 列对齐：按最宽单元格补齐，列间至少两个空格；最后一列不补（无行尾空白）。 */
export function alignRows(rows: Row[], indent: string): string[] {
  const widths: number[] = [];
  for (const row of rows) {
    row.cells.forEach((cell, i) => {
      widths[i] = Math.max(widths[i] ?? 0, cell.length);
    });
  }
  const lines: string[] = [];
  for (const row of rows) {
    lines.push(...row.comments);
    const cells = row.cells.map((cell, i) =>
      i === row.cells.length - 1 ? cell : cell.padEnd(widths[i]!),
    );
    lines.push(indent + cells.join("  "));
  }
  return lines;
}

/** 标量值：按单元格重排（连续空白归一为一个空格）。 */
export function trailingText(cells: Cell[], from: number): string {
  return cells
    .slice(from)
    .map((cell) => cell.text)
    .join(" ");
}

/** 描述类型：文件第二行（`version` 之后）的类型名，如 `footprint`；读不到返回 null。 */
export function descriptionType(text: string): string | null {
  let meaningful = 0;
  for (const line of lex(text)) {
    if (line.blank || line.comment) continue;
    meaningful += 1;
    if (meaningful === 2) return line.cells[0]?.text ?? null;
  }
  return null;
}

export interface SurfaceWalk {
  version: RawRow;
  type: RawRow;
  scalars: Map<string, RawRow>;
  fields: RawRow[];
  /** 段名 → 行（按出现顺序；同一段重复出现时合并）。 */
  sections: Map<string, RawRow[]>;
  /** 段名 → 段头/段前注释。 */
  sectionComments: Map<string, string[]>;
  /** 段名出现顺序（去重）。 */
  sectionOrder: string[];
  /** 文件末尾、后面没有有效行的注释。 */
  trailing: string[];
}

/**
 * 表面行分组：只做结构识别（文件头、标量、段头、段内行），不解释单元格含义。
 * 调用方必须先成功解析，再调这里——本函数假设结构合法。
 */
export function walkRows(text: string, sectionNames: Set<string>): SurfaceWalk | null {
  const lines = lex(text);
  let cursor = 0;
  let pending: string[] = [];

  // 注释行跟随其后第一条有效行（teda.md §12 规则 5）。
  const next = (): RawRow | null => {
    while (cursor < lines.length) {
      const line = lines[cursor]!;
      cursor += 1;
      if (line.blank) continue;
      if (line.comment) {
        pending.push(line.text);
        continue;
      }
      const comments = pending;
      pending = [];
      return { comments, cells: line.cells, line: line.number };
    }
    return null;
  };

  const version = next();
  const type = next();
  if (!version || !type) return null;

  const walk: SurfaceWalk = {
    version,
    type,
    scalars: new Map(),
    fields: [],
    sections: new Map(),
    sectionComments: new Map(),
    sectionOrder: [],
    trailing: [],
  };

  let section: string | null = null;
  for (let row = next(); row !== null; row = next()) {
    if (row.cells.length === 1 && sectionNames.has(row.cells[0]!.text)) {
      section = row.cells[0]!.text;
      walk.sectionComments.set(section, row.comments);
      if (!walk.sectionOrder.includes(section)) walk.sectionOrder.push(section);
      continue;
    }
    if (section === null) {
      const key = row.cells[0]!.text;
      if (key === "field") walk.fields.push(row);
      else walk.scalars.set(key, row);
      continue;
    }
    const rows = walk.sections.get(section) ?? [];
    rows.push(row);
    walk.sections.set(section, rows);
  }
  walk.trailing = pending;
  return walk;
}

/** 把块用空行拼起来，末尾一个换行。 */
export function emitBlocks(blocks: string[][]): string {
  return `${blocks.map((b) => b.join("\n")).join("\n\n")}\n`;
}

// ---------------------------------------------------------------- footprint

function canonicalFootprintPadRow(row: RawRow, file: string): Row {
  const cells = row.cells;
  const out = [cells[0]!.text, cells[1]!.text, cells[2]!.text];
  for (const cell of cells.slice(3, 7)) {
    out.push(canonValue(cell.text, cell.col, "length", file, row.line));
  }
  out.push(
    ...canonKeyValues(cells.slice(7), (key, raw, col) => {
      if (key === "rot") return canonValue(raw, col, "angle", file, row.line);
      if (key === "rratio") return canonValue(raw, col, "ratio", file, row.line);
      if (key === "layers" || key === "zone") return raw;
      return canonValue(raw, col, "length", file, row.line);
    }),
  );
  return { comments: row.comments, cells: out };
}

function canonicalFootprintGraphicRow(row: RawRow, file: string): Row {
  const cells = row.cells;
  const geometryCell = cells[2]!;
  const out = [
    cells[0]!.text,
    cells[1]!.text,
    canonList(geometryCell.text, geometryCell.col, "length", file, row.line),
  ];
  out.push(
    ...canonKeyValues(cells.slice(3), (key, raw, col) =>
      key === "fill" ? raw : canonValue(raw, col, "length", file, row.line),
    ),
  );
  return { comments: row.comments, cells: out };
}

function canonicalFootprintScalars(walk: SurfaceWalk, file: string): Row[] {
  const rows: Row[] = [];

  const description = walk.scalars.get("description");
  if (description) {
    rows.push({ comments: description.comments, cells: ["description", trailingText(description.cells, 1)] });
  }

  const tags = walk.scalars.get("tags");
  if (tags) {
    const list = trailingText(tags.cells, 1).split(/\s+/).filter((t) => t.length > 0);
    if (list.length > 0) rows.push({ comments: tags.comments, cells: ["tags", list.sort(byteCompare).join(" ")] });
  }

  const attr = walk.scalars.get("attr");
  if (attr) rows.push({ comments: attr.comments, cells: ["attr", trailingText(attr.cells, 1)] });

  const model = walk.scalars.get("model");
  if (model) {
    const path = model.cells[1]!.text;
    const kv = canonKeyValues(model.cells.slice(2), (key, raw, col) => {
      if (!MODEL_KEYS.has(key)) return raw;
      if (key === "offset") return canonList(raw, col, "length", file, model.line);
      if (key === "scale") return canonList(raw, col, "ratio", file, model.line);
      return canonList(raw, col, "angle", file, model.line);
    });
    rows.push({ comments: model.comments, cells: ["model", path, ...kv] });
  }

  const fieldRows = walk.fields
    .map((row) => canonicalFieldRow(row, file, FIELD_KEYS))
    .sort((a, b) => byteCompare(a.cells[1]!, b.cells[1]!));
  rows.push(...fieldRows);

  return rows;
}

/** `field <Name> [key=value …] <text…>`：键在前、值在行尾。 */
function canonicalFieldRow(row: RawRow, file: string, allowed: Set<string>): Row {
  const cells = row.cells; // cells[0] === "field"
  const name = cells[1]!.text;
  let cursor = 2;
  const kv = new Map<string, string>();
  while (cursor < cells.length) {
    const cell = cells[cursor]!;
    const eq = cell.text.indexOf("=");
    if (eq <= 0) break;
    const key = cell.text.slice(0, eq);
    if (!allowed.has(key)) break;
    kv.set(key, cell.text.slice(eq + 1));
    cursor += 1;
  }
  const text = trailingText(cells, cursor);

  const out = ["field", name];
  const col = cells[0]!.col;
  for (const key of [...kv.keys()].sort(byteCompare)) {
    const raw = kv.get(key)!;
    if (key === "hide") {
      // hide=no 与不写等价：canonical 只保留肯定形式。
      if (raw === "yes" || raw === "true") out.push("hide=yes");
      continue;
    }
    if (key === "layer") {
      out.push(`layer=${raw}`);
      continue;
    }
    if (key === "at" || key === "size") {
      out.push(`${key}=${canonList(raw, col, "length", file, row.line)}`);
      continue;
    }
    out.push(`${key}=${canonValue(raw, col, "length", file, row.line)}`);
  }
  if (text.length > 0) out.push(text);
  return { comments: row.comments, cells: out };
}

/**
 * 格式化一个 `footprint` 文件。输入有语义错误时不产出文本（先修错再格式化），
 * 与 gofmt 拒绝格式化语法错误文件的取舍一致。
 */
export function formatFootprint(text: string, options: ParseOptions): FormatResult {
  const parsed = parseFootprint(text, options);
  if (!parsed.ok) return { ok: false, diagnostics: parsed.diagnostics };

  const { file } = options;
  const walk = walkRows(text, FOOTPRINT_SECTIONS);
  if (!walk) return { ok: false, diagnostics: parsed.diagnostics };

  const blocks: string[][] = [];
  blocks.push(
    scalarLines([
      { comments: walk.version.comments, cells: ["version", walk.version.cells[1]!.text] },
      { comments: walk.type.comments, cells: ["footprint", walk.type.cells[1]!.text] },
    ]),
  );

  const scalarRows = canonicalFootprintScalars(walk, file);
  if (scalarRows.length > 0) blocks.push(scalarLines(scalarRows));

  const padRows = (walk.sections.get("pads") ?? [])
    .map((r) => canonicalFootprintPadRow(r, file))
    .sort((a, b) => naturalCompare(a.cells[0]!, b.cells[0]!));
  const graphicRows = (walk.sections.get("graphics") ?? [])
    .map((r) => canonicalFootprintGraphicRow(r, file))
    .sort((a, b) =>
      byteCompare(`${a.cells[0]} ${a.cells[1]} ${a.cells[2]}`, `${b.cells[0]} ${b.cells[1]} ${b.cells[2]}`),
    );

  // 段顺序固定为 pads → graphics，与源文件里出现的先后无关。
  const sectionRows: Array<[string, Row[]]> = [
    ["pads", padRows],
    ["graphics", graphicRows],
  ];
  for (const [name, rows] of sectionRows) {
    if (!walk.sectionOrder.includes(name)) continue;
    blocks.push([...(walk.sectionComments.get(name) ?? []), name, ...alignRows(rows, "  ")]);
  }

  if (walk.trailing.length > 0) blocks.push([...walk.trailing]);

  return { ok: true, text: emitBlocks(blocks), diagnostics: parsed.diagnostics };
}

// ------------------------------------------------------------------- symbol

/** 与缺省值等价的尾列不写：canonical 只保留非缺省项。 */
function dropDefaults(pairs: string[], defaults: Map<string, string>): string[] {
  return pairs.filter((pair) => {
    const eq = pair.indexOf("=");
    return defaults.get(pair.slice(0, eq)) !== pair.slice(eq + 1);
  });
}

const PIN_DEFAULTS = new Map([
  ["length", "2.54"],
  ["unit", "1"],
  ["style", "line"],
]);
const BODY_DEFAULTS = new Map([
  ["width", "0"],
  ["fill", "none"],
  ["unit", "1"],
]);

function canonicalSymbolPinRow(row: RawRow, file: string): Row {
  const cells = row.cells;
  const out = [cells[0]!.text];
  for (const cell of cells.slice(1, 4)) {
    out.push(canonValue(cell.text, cell.col, "length", file, row.line));
  }
  out.push(
    ...dropDefaults(
      canonKeyValues(cells.slice(4), (key, raw, col) => {
        if (key === "style" || key === "unit") return raw;
        return canonValue(raw, col, "length", file, row.line);
      }),
      PIN_DEFAULTS,
    ),
  );
  return { comments: row.comments, cells: out };
}

function canonicalSymbolBodyRow(row: RawRow, file: string): Row {
  const cells = row.cells;
  const geometryCell = cells[1]!;
  const out = [
    cells[0]!.text,
    canonList(geometryCell.text, geometryCell.col, "length", file, row.line),
  ];
  out.push(
    ...dropDefaults(
      canonKeyValues(cells.slice(2), (key, raw, col) =>
        key === "fill" || key === "unit" ? raw : canonValue(raw, col, "length", file, row.line),
      ),
      BODY_DEFAULTS,
    ),
  );
  return { comments: row.comments, cells: out };
}

const SYMBOL_SCALARS = [
  "description",
  "tags",
  "units",
  "pin_numbers",
  "pin_names",
  "pin_name_offset",
  "power",
  "in_bom",
  "on_board",
] as const;

const SYMBOL_LENGTH_SCALARS = new Set(["pin_name_offset"]);

function canonicalSymbolScalars(walk: SurfaceWalk, file: string): Row[] {
  const rows: Row[] = [];
  const SCALAR_DEFAULTS = new Map([
    ["units", "1"],
    ["pin_numbers", "show"],
    ["pin_names", "show"],
    ["pin_name_offset", "0.508"],
    ["power", "no"],
    ["in_bom", "yes"],
    ["on_board", "yes"],
  ]);

  for (const key of SYMBOL_SCALARS) {
    const row = walk.scalars.get(key);
    if (!row) continue;
    const raw = trailingText(row.cells, 1);
    if (SCALAR_DEFAULTS.get(key) === raw) continue;
    if (key === "description") {
      rows.push({ comments: row.comments, cells: [key, trailingText(row.cells, 1)] });
    } else if (key === "tags") {
      const list = trailingText(row.cells, 1).split(/\s+/).filter((t) => t.length > 0);
      if (list.length > 0) rows.push({ comments: row.comments, cells: [key, list.sort(byteCompare).join(" ")] });
    } else if (SYMBOL_LENGTH_SCALARS.has(key)) {
      rows.push({ comments: row.comments, cells: [key, canonValue(trailingText(row.cells, 1), row.cells[0]!.col, "length", file, row.line)] });
    } else {
      rows.push({ comments: row.comments, cells: [key, trailingText(row.cells, 1)] });
    }
  }

  const fieldRows = walk.fields
    .map((row) => canonicalFieldRow(row, file, SYMBOL_FIELD_KEYS))
    .sort((a, b) => byteCompare(a.cells[1]!, b.cells[1]!));
  rows.push(...fieldRows);
  return rows;
}

/** 符号字段没有 `layer`（符号不分层）。 */
const SYMBOL_FIELD_KEYS = new Set(["at", "hide", "size"]);

/**
 * 格式化一个 `symbol` 文件。语义错误时不产出文本。
 */
export function formatSymbol(text: string, options: SymbolParseOptions): FormatResult {
  const parsed = parseSymbol(text, options);
  if (!parsed.ok) return { ok: false, diagnostics: parsed.diagnostics };

  const { file } = options;
  const walk = walkRows(text, SYMBOL_SECTIONS);
  if (!walk) return { ok: false, diagnostics: parsed.diagnostics };

  const blocks: string[][] = [];
  blocks.push(
    scalarLines([
      { comments: walk.version.comments, cells: ["version", walk.version.cells[1]!.text] },
      { comments: walk.type.comments, cells: ["symbol", walk.type.cells[1]!.text] },
    ]),
  );

  const scalarRows = canonicalSymbolScalars(walk, file);
  if (scalarRows.length > 0) blocks.push(scalarLines(scalarRows));

  const pinRows = (walk.sections.get("pins") ?? [])
    .map((r) => canonicalSymbolPinRow(r, file))
    .sort((a, b) => {
      // 尾列里有 unit 才参与排序；没有 unit 按 1 算。canonical 里 unit 总是显式写出。
      const unit = (row: Row) => Number(row.cells.find((c) => c.startsWith("unit="))?.slice(5) ?? "1");
      const byUnit = unit(a) - unit(b);
      return byUnit !== 0 ? byUnit : naturalCompare(a.cells[0]!, b.cells[0]!);
    });
  const bodyRows = (walk.sections.get("body") ?? [])
    .map((r) => canonicalSymbolBodyRow(r, file))
    .sort((a, b) => byteCompare(`${a.cells[0]} ${a.cells[1]}`, `${b.cells[0]} ${b.cells[1]}`));

  for (const name of ["pins", "body"]) {
    if (!walk.sectionOrder.includes(name)) continue;
    const rows = name === "pins" ? pinRows : bodyRows;
    blocks.push([...(walk.sectionComments.get(name) ?? []), name, ...alignRows(rows, "  ")]);
  }

  if (walk.trailing.length > 0) blocks.push([...walk.trailing]);

  return { ok: true, text: emitBlocks(blocks), diagnostics: parsed.diagnostics };
}
