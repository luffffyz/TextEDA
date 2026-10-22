// `.teda` surface formatting: canonical form (description specs §8, teda.md §12).
//
// Semantics are validated by the corresponding parser first; this module only rearranges the surface, never going through the IR:
// the IR expands default layer sets and discards surface spellings, so writing back from the IR would bloat files and cannot produce minimal diffs.
//
// Invariant (teda.md §12): parse(fmt(x)) is semantically the same as parse(x); fmt(fmt(x)) === fmt(x).
import type { Diagnostic, DiagnosticCodeId } from "./diagnostics.ts";
import { lex, type Cell } from "./lexer.ts";
import { byteCompare, naturalCompare } from "@texteda/ir/order";
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
  /** canonical text; omitted when the input has errors. */
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
      ? parseLengthNm(text, file, line, col, "mm", "value.length-invalid")
      : kind === "angle"
        ? parseAngleMdeg(text, file, line, col, "deg", "value.angle-invalid")
        : parsePpm(text, file, line, col, "value.ratio-invalid");
  if (!parsed.ok) return text; // errors were already reported during validation; this is just a safeguard
  return kind === "length"
    ? formatLengthNm(parsed.value)
    : kind === "angle"
      ? formatAngleMdeg(parsed.value)
      : formatPpm(parsed.value);
}

/** An `x,y,z` list: normalize each item, then join with `,`. */
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

/** Trailing `key=value` columns: sort by key in ASCII byte order; unknown shapes (already reported by validation) are kept as-is. */
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

/** Scalar lines: exactly one space between cells (scalars are not tables; no column alignment). */
export function scalarLines(rows: Row[]): string[] {
  return rows.flatMap((row) => [...row.comments, row.cells.join(" ")]);
}

/** Column alignment: pad to the widest cell, at least two spaces between columns; the last column is not padded (no trailing whitespace). */
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

/** Scalar value: rearranged by cell (runs of whitespace normalized to one space). */
export function trailingText(cells: Cell[], from: number): string {
  return cells
    .slice(from)
    .map((cell) => cell.text)
    .join(" ");
}

/** Description type: the type name on the file's second line (after `version`), e.g. `footprint`; returns null when it cannot be read. */
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
  /** Section name → rows (in order of appearance; repeated sections merge). */
  sections: Map<string, RawRow[]>;
  /** Section name → header/pre-section comments. */
  sectionComments: Map<string, string[]>;
  /** Section name appearance order (deduplicated). */
  sectionOrder: string[];
  /** Comments at the end of the file with no meaningful line after them. */
  trailing: string[];
}

/**
 * Surface row grouping: structural recognition only (file header, scalars, section headers, in-section rows); cell meanings are not interpreted.
 * Callers must have parsed successfully before calling here — this function assumes the structure is valid.
 */
export function walkRows(text: string, sectionNames: Set<string>): SurfaceWalk | null {
  const lines = lex(text);
  let cursor = 0;
  let pending: string[] = [];

  // A comment line attaches to the first meaningful line after it (teda.md §12 rule 5).
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

/** Join blocks with blank lines, one trailing newline at the end. */
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

  const packageCode = walk.scalars.get("package_code");
  if (packageCode) {
    rows.push({ comments: packageCode.comments, cells: ["package_code", trailingText(packageCode.cells, 1)] });
  }

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

/** `field <Name> [key=value …] <text…>`: keys first, value at the end of the line. */
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
      // hide=no is equivalent to omitting it: canonical keeps only the affirmative form.
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
 * Format a `footprint` file. No text is produced when the input has semantic errors (fix the errors before formatting),
 * matching gofmt's choice to refuse to format files with syntax errors.
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

  // Section order is fixed as pads → graphics, regardless of the order they appear in the source file.
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

/** Trailing columns equivalent to the default are not written: canonical keeps only non-default entries. */
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

/** Symbol fields have no `layer` (symbols are not layered). */
const SYMBOL_FIELD_KEYS = new Set(["at", "hide", "size"]);

/**
 * Format a `symbol` file. No text is produced when there are semantic errors.
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
      // Only rows with a unit in the trailing columns participate in sorting; a missing unit counts as 1. In canonical output unit is always written explicitly.
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
