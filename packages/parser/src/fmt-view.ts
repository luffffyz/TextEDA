// Canonical form for `.teda` `view` (spec/schematic-view.md §11, teda.md §12).
//
// The formatter only changes whitespace, row order and section order — the cell contents stay as
// written (teda.md §12 rule 6), so `40.0` stays `40.0` and `40mm` stays `40mm`. The parse decides
// whether the file is valid; a file with errors produces no output.
//
// Language 0.13 added two more artifacts of the view family (ADR-0068): the module drawing
// (`module_view`) and the sheet template (`sheet_template`), and a composed page may name a
// `template` and place module drawings in a `module_place` section.
import { byteCompare, naturalCompare, pinRefCompare } from "@texteda/ir/order";
import type { Diagnostic } from "@texteda/ir/diagnostics";
import { lex, type Line } from "./lexer.ts";
import { compareVersions, parseVersion } from "./version.ts";
import {
  MODULE_VIEW_SECTIONS,
  MODULE_VIEW_VERSION,
  parseModuleView,
  parseSheetTemplate,
  parseView,
  SHEET_TEMPLATE_SECTIONS,
} from "./view.ts";

export interface ViewFormatOptions {
  file: string;
}

export interface ViewFormatResult {
  ok: boolean;
  /** canonical text; omitted when there are semantic errors. */
  text?: string;
  diagnostics: Diagnostic[];
}

export interface ModuleViewFormatOptions {
  file: string;
}

export interface ModuleViewFormatResult {
  ok: boolean;
  /** canonical text; omitted when there are semantic errors. */
  text?: string;
  diagnostics: Diagnostic[];
}

export interface SheetTemplateFormatOptions {
  file: string;
}

export interface SheetTemplateFormatResult {
  ok: boolean;
  /** canonical text; omitted when there are semantic errors. */
  text?: string;
  diagnostics: Diagnostic[];
}

/** The sections, in canonical order (spec/schematic-view.md §11). */
const SECTIONS = ["place", "field", "module", "module_port", "interconnect", "module_place", "junction", "wire", "label", "port", "text"] as const;
const SECTION_SET = new Set<string>(SECTIONS);
/** The sections of a module drawing (ADR-0068 D2). */
const MODULE_VIEW_SECTION_SET = new Set<string>(MODULE_VIEW_SECTIONS);
/** The sections of a sheet template (ADR-0068 D3). */
const SHEET_TEMPLATE_SECTION_SET = new Set<string>(SHEET_TEMPLATE_SECTIONS);

interface Row {
  comments: string[];
  cells: string[];
}

interface Section {
  comments: string[];
  rows: Row[];
}

interface Walk {
  header: { version: Row; type: Row };
  /** Scalar lines (the key and its cells), in source order. */
  scalars: Row[];
  sections: Map<string, Section>;
  trailing: string[];
}

/** Line scan: structural recognition only. */
function walkDocument(text: string, sections: ReadonlySet<string>): Walk | null {
  const lines = lex(text);
  let cursor = 0;
  let pending: string[] = [];

  const next = (): Row | null => {
    while (cursor < lines.length) {
      const line: Line = lines[cursor]!;
      cursor += 1;
      if (line.blank) continue;
      if (line.comment) {
        pending.push(line.text);
        continue;
      }
      const comments = pending;
      pending = [];
      return { comments, cells: line.cells.map((c) => c.text) };
    }
    return null;
  };

  const version = next();
  const type = next();
  if (!version || !type) return null;

  const walk: Walk = { header: { version, type }, scalars: [], sections: new Map(), trailing: [] };
  let current: Section | null = null;
  for (let row = next(); row !== null; row = next()) {
    if (row.cells.length === 1 && sections.has(row.cells[0]!)) {
      const name = row.cells[0]!;
      const existing = walk.sections.get(name);
      if (existing) {
        existing.comments.push(...row.comments);
      } else {
        walk.sections.set(name, { comments: row.comments, rows: [] });
      }
      current = walk.sections.get(name)!;
      continue;
    }
    if (current === null) {
      walk.scalars.push(row);
      continue;
    }
    current.rows.push(row);
  }
  walk.trailing = pending;
  return walk;
}

/** Compare two coordinate cells: tuples component by component, plain numbers numerically, else byte order. */
function compareCoordinate(a: string, b: string): number {
  const tuple = (text: string): string[] | undefined => {
    const match = /^\[(.*)\]$/.exec(text);
    return match === null ? undefined : match[1]!.split(",");
  };
  const left = tuple(a);
  const right = tuple(b);
  if (left !== undefined && right !== undefined && left.length === right.length) {
    for (let i = 0; i < left.length; i += 1) {
      const order = compareCoordinate(left[i]!, right[i]!);
      if (order !== 0) return order;
    }
    return 0;
  }
  if (left !== undefined || right !== undefined) return byteCompare(a, b);
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na === nb ? 0 : na < nb ? -1 : 1;
  return byteCompare(a, b);
}

/** Align the given columns of the rows to the widest cell of their column. */
function alignCells(rows: Row[], count: number, indent: string): string[] {
  const widths = widthsOf(rows, count);
  const lines: string[] = [];
  for (const row of rows) {
    lines.push(...row.comments);
    const cells = row.cells.slice(0, count).map((cell, i) => (i === count - 1 ? cell : cell.padEnd(widths[i]!)));
    lines.push(indent + cells.join("  "));
  }
  return lines;
}

/** `place` / `port` rows: `<id> <point> [<rot>] [<key=value> …]`; a key never enters the rotation column. */
function formatIdPoint(rows: Row[], indent: string, keys: boolean): string[] {
  const widths = widthsOf(rows, 2);
  const rotWidth = rows.reduce((max, row) => {
    const cell = row.cells[2];
    if (cell === undefined || (keys && cell.includes("="))) return max;
    return Math.max(max, cell.length);
  }, 0);
  const lines: string[] = [];
  for (const row of rows) {
    lines.push(...row.comments);
    const head = row.cells.slice(0, 2).map((cell, i) => (i === 1 ? cell : cell.padEnd(widths[i]!)));
    const rest: string[] = [];
    const rot = row.cells[2];
    if (rot !== undefined && !(keys && rot.includes("="))) rest.push(rot.padEnd(rotWidth));
    if (keys) {
      const tailKeys = row.cells.slice(2).filter((cell) => cell.includes("="));
      if (tailKeys.length > 0) rest.push(tailKeys.join("  "));
    }
    const tail = rest.length > 0 ? `  ${rest.join("  ").trimEnd()}` : "";
    lines.push(`${indent}${head.join("  ")}${tail}`);
  }
  return lines;
}

/** Widest cell per column, over the first `count` columns. */
function widthsOf(rows: Row[], count: number): number[] {
  const widths: number[] = [];
  for (const row of rows) {
    for (let i = 0; i < count; i += 1) {
      widths[i] = Math.max(widths[i] ?? 0, row.cells[i]?.length ?? 0);
    }
  }
  return widths;
}

/** `wire` rows: `net from_pin to_pin [<point> …]`; each bend is one cell, so the row is plain columns. */
function formatWire(rows: Row[], indent: string): string[] {
  const lines: string[] = [];
  for (const row of rows) {
    lines.push(...row.comments);
    lines.push(`${indent}${row.cells.join("  ").trimEnd()}`);
  }
  return lines;
}

/** `module_place` rows: `<instance_id> <module_id> <point> [<rot>]`; the rotation column is optional. */
function formatModulePlace(rows: Row[], indent: string): string[] {
  const widths = widthsOf(rows, 3);
  const rotWidth = rows.reduce((max, row) => Math.max(max, row.cells[3]?.length ?? 0), 0);
  const lines: string[] = [];
  for (const row of rows) {
    lines.push(...row.comments);
    const head = row.cells.slice(0, 3).map((cell, i) => (i === 2 ? cell : cell.padEnd(widths[i]!)));
    const rot = row.cells[3];
    const tail = rot === undefined ? "" : `  ${rot.padEnd(rotWidth)}`;
    lines.push(`${indent}${head.join("  ")}${tail}`.trimEnd());
  }
  return lines;
}

/** `polyline` rows: `<id> <point> <point> …`; the point count varies, so only the id column is aligned. */
function formatPolyline(rows: Row[], indent: string): string[] {
  const widths = widthsOf(rows, 1);
  const lines: string[] = [];
  for (const row of rows) {
    lines.push(...row.comments);
    lines.push(`${indent}${row.cells[0]!.padEnd(widths[0]!)}  ${row.cells.slice(1).join("  ")}`);
  }
  return lines;
}

/** The `text` rows of a template: `<id> <point> <text>`; the text is the rest of the line, never padded. */
function formatFurnitureText(rows: Row[], indent: string): string[] {
  const widths = widthsOf(rows, 2);
  const lines: string[] = [];
  for (const row of rows) {
    lines.push(...row.comments);
    lines.push(`${indent}${row.cells[0]!.padEnd(widths[0]!)}  ${row.cells[1]!.padEnd(widths[1]!)}  ${row.cells.slice(2).join(" ")}`);
  }
  return lines;
}

/** The canonical row order of a section. */
function sortSection(name: string, rows: Row[]): void {
  switch (name) {
    case "place":
    case "module":
    case "module_port":
    case "interconnect":
      rows.sort((a, b) => naturalCompare(a.cells[0] ?? "", b.cells[0] ?? ""));
      break;
    case "junction":
      rows.sort((a, b) => naturalCompare(a.cells[0] ?? "", b.cells[0] ?? ""));
      break;
    case "module_place":
      // The canonical order of a placement list: by instance, then by position (IR v0.18).
      rows.sort(
        (a, b) => naturalCompare(a.cells[0] ?? "", b.cells[0] ?? "") || compareCoordinate(a.cells[2] ?? "", b.cells[2] ?? ""),
      );
      break;
    case "field":
      rows.sort((a, b) => naturalCompare(a.cells[0] ?? "", b.cells[0] ?? "") || byteCompare(a.cells[1] ?? "", b.cells[1] ?? ""));
      break;
    case "wire":
      rows.sort((a, b) => {
        const byNet = byteCompare(a.cells[0] ?? "", b.cells[0] ?? "");
        if (byNet !== 0) return byNet;
        const byFrom = pinRefCompare(a.cells[1] ?? "", b.cells[1] ?? "");
        if (byFrom !== 0) return byFrom;
        return pinRefCompare(a.cells[2] ?? "", b.cells[2] ?? "");
      });
      break;
    case "label":
      rows.sort((a, b) => {
        const byNet = byteCompare(a.cells[0] ?? "", b.cells[0] ?? "");
        if (byNet !== 0) return byNet;
        const byX = compareCoordinate(a.cells[1] ?? "", b.cells[1] ?? "");
        if (byX !== 0) return byX;
        return compareCoordinate(a.cells[2] ?? "", b.cells[2] ?? "");
      });
      break;
    case "port":
      rows.sort((a, b) => byteCompare(a.cells[0] ?? "", b.cells[0] ?? ""));
      break;
    case "text":
      rows.sort((a, b) => {
        const byX = compareCoordinate(a.cells[0] ?? "", b.cells[0] ?? "");
        if (byX !== 0) return byX;
        const byY = compareCoordinate(a.cells[1] ?? "", b.cells[1] ?? "");
        if (byY !== 0) return byY;
        return byteCompare(a.cells.slice(2).join(" "), b.cells.slice(2).join(" "));
      });
      break;
  }
}

/** The canonical layout of a section's rows. */
function formatSection(name: string, rows: Row[]): string[] {
  switch (name) {
    case "place":
      return formatIdPoint(rows, "  ", true);
    case "junction":
      return alignCells(rows, 2, "  ");
    case "field":
      return alignCells(rows, 3, "  ");
    case "module":
      return alignCells(rows, 4, "  ");
    case "module_port":
      return alignCells(rows, 2, "  ");
    case "interconnect":
      return alignCells(rows, 5, "  ");
    case "module_place":
      return formatModulePlace(rows, "  ");
    case "wire":
      return formatWire(rows, "  ");
    case "label":
      return alignCells(rows, 2, "  ");
    case "port":
      return formatIdPoint(rows, "  ", false);
    case "text": {
      // The text is the rest of the line: it is the last cell and is never padded.
      const widths = widthsOf(rows, 1);
      const lines: string[] = [];
      for (const row of rows) {
        lines.push(...row.comments);
        lines.push(`  ${row.cells[0]!.padEnd(widths[0]!)}  ${row.cells.slice(1).join(" ")}`);
      }
      return lines;
    }
    default:
      return [];
  }
}

/** The canonical blocks of the sections, in the canonical section order. */
function sectionBlocks(walk: Walk, sectionNames: readonly string[]): string[][] {
  const blocks: string[][] = [];
  for (const name of sectionNames) {
    const section = walk.sections.get(name);
    if (!section || section.rows.length === 0) continue;
    const rows = [...section.rows];
    sortSection(name, rows);
    blocks.push([...section.comments, name, ...formatSection(name, rows)]);
  }
  return blocks;
}

/** The header block: the version line and the description-type line, as they were written. */
function headerBlock(walk: Walk): string[] {
  return [
    ...walk.header.version.comments,
    `version ${walk.header.version.cells[1] ?? ""}`.trimEnd(),
    ...walk.header.type.comments,
    walk.header.type.cells.join(" "),
  ];
}

/** The canonical text of a document: the blocks, separated by a blank line. */
function joinBlocks(blocks: string[][]): string {
  return `${blocks.map((b) => b.join("\n")).join("\n\n")}\n`;
}

/** Format a `view` file. No text is produced when the file has errors. */
export function formatView(text: string, options: ViewFormatOptions): ViewFormatResult {
  const parsed = parseView(text, { file: options.file });
  if (!parsed.ok) return { ok: false, diagnostics: parsed.diagnostics };
  const walk = walkDocument(text, SECTION_SET);
  if (!walk) return { ok: false, diagnostics: parsed.diagnostics };

  /**
   * The page-size key follows the file's own language version: a page that declares 0.11 keeps
   * `sheet`, a page that declares 0.12 writes `size` (ADR-0067 D6). Formatting a file never
   * migrates it to another version.
   */
  const declared = parseVersion(parsed.ir!.format);
  const sizeKey = declared !== null && compareVersions(declared, MODULE_VIEW_VERSION) >= 0 ? "size" : "sheet";

  const blocks: string[][] = [];
  blocks.push(headerBlock(walk));

  for (const row of walk.scalars) {
    const cells = row.cells.slice();
    // Only the key changes; the size cell stays as it was written.
    if (cells[0] === "size" || cells[0] === "sheet") cells[0] = sizeKey;
    blocks.push([...row.comments, cells.join(" ")]);
  }

  blocks.push(...sectionBlocks(walk, SECTIONS));

  if (walk.trailing.length > 0) blocks.push([...walk.trailing]);

  return { ok: true, text: joinBlocks(blocks), diagnostics: parsed.diagnostics };
}

/**
 * Format a `module_view` file: a module's own drawing (ADR-0068 D2). No text is produced when the
 * file has errors.
 */
export function formatModuleView(text: string, options: ModuleViewFormatOptions): ModuleViewFormatResult {
  const parsed = parseModuleView(text, { file: options.file });
  if (!parsed.ok) return { ok: false, diagnostics: parsed.diagnostics };
  const walk = walkDocument(text, MODULE_VIEW_SECTION_SET);
  if (!walk) return { ok: false, diagnostics: parsed.diagnostics };

  const blocks: string[][] = [];
  blocks.push(headerBlock(walk));
  for (const row of walk.scalars) {
    blocks.push([...row.comments, row.cells.join(" ")]);
  }
  blocks.push(...sectionBlocks(walk, MODULE_VIEW_SECTIONS));
  if (walk.trailing.length > 0) blocks.push([...walk.trailing]);

  return { ok: true, text: joinBlocks(blocks), diagnostics: parsed.diagnostics };
}

/**
 * Format a `sheet_template` file: the static furniture of a page (ADR-0068 D3). No text is produced
 * when the file has errors.
 */
export function formatSheetTemplate(text: string, options: SheetTemplateFormatOptions): SheetTemplateFormatResult {
  const parsed = parseSheetTemplate(text, { file: options.file });
  if (!parsed.ok) return { ok: false, diagnostics: parsed.diagnostics };
  const walk = walkDocument(text, SHEET_TEMPLATE_SECTION_SET);
  if (!walk) return { ok: false, diagnostics: parsed.diagnostics };

  const blocks: string[][] = [];
  blocks.push(headerBlock(walk));
  for (const row of walk.scalars) {
    blocks.push([...row.comments, row.cells.join(" ")]);
  }

  for (const name of SHEET_TEMPLATE_SECTIONS) {
    const section = walk.sections.get(name);
    if (!section || section.rows.length === 0) continue;
    const rows = [...section.rows];
    // Every furniture row carries an id; the canonical order is the id order.
    rows.sort((a, b) => byteCompare(a.cells[0] ?? "", b.cells[0] ?? ""));
    const block: string[] = [...section.comments, name];
    switch (name) {
      case "line":
      case "rect":
        block.push(...alignCells(rows, 3, "  "));
        break;
      case "polyline":
        block.push(...formatPolyline(rows, "  "));
        break;
      case "text":
        block.push(...formatFurnitureText(rows, "  "));
        break;
    }
    blocks.push(block);
  }

  if (walk.trailing.length > 0) blocks.push([...walk.trailing]);

  return { ok: true, text: joinBlocks(blocks), diagnostics: parsed.diagnostics };
}
