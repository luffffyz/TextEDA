// Canonical form for `.teda` `schematic` / `page` (teda.md §12).
//
// Kept separate from the footprint / symbol formatters: here we must handle the `bus` instruction block (`bus <id> = <type>`
// followed by member rows), which is not a single-line section header, so the generic table walker cannot express it; this file brings its own line scan.
//
// Invariant (teda.md §12): `parse(fmt(x))` is semantically the same as `parse(x)`; `fmt(fmt(x)) == fmt(x)`.
import { byteCompare, naturalCompare } from "./order.ts";
import { lex } from "./lexer.ts";
import { parseSchematicDocument } from "./schematic.ts";
import type { Diagnostic } from "@texteda/ir/diagnostics";

export interface SchematicFormatOptions {
  file: string;
}

export interface SchematicFormatResult {
  ok: boolean;
  /** canonical text; omitted when there are semantic errors. */
  text?: string;
  diagnostics: Diagnostic[];
}

const SCHEMATIC_SECTIONS = ["instances", "nets", "pages", "ports", "bus", "constraints"] as const;
const PAGE_SECTIONS = ["instances", "nets", "ports", "constraints"] as const;

const SECTION_NAMES = new Set<string>([...SCHEMATIC_SECTIONS, ...PAGE_SECTIONS]);

/** One row (comments attach to the row that follows). */
interface Row {
  comments: string[];
  cells: string[];
}

interface Section {
  /** Comments before the section header (or the bus instruction line). */
  comments: string[];
  /** The header line; a `bus` section uses the full instruction line (`bus <id> = <type>`), other sections use the section name. */
  header: string[];
  rows: Row[];
}

interface Walk {
  /** The file's two header lines: `version <v>` and the type line. */
  header: Row[];
  /** Section name → section. */
  sections: Map<string, Section>;
  /** The order sections appear in (same-named sections merge, but the first position is remembered). */
  order: string[];
  /** Comments at the end of the file with no meaningful line after them. */
  trailing: string[];
}

/**
 * Line scan: structural recognition only; cell meanings are not interpreted.
 * A section header is a single-cell row; a `bus` instruction line is `bus <id> = <type>` (multiple cells) and also counts as a header.
 */
function walkSchematic(text: string): Walk | null {
  const lines = lex(text);
  let cursor = 0;
  let pending: string[] = [];

  const next = (): Row | null => {
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
      return { comments, cells: line.cells.map((c) => c.text) };
    }
    return null;
  };

  const version = next();
  const type = next();
  if (!version || !type) return null;

  const walk: Walk = { header: [version, type], sections: new Map(), order: [], trailing: [] };

  const isSectionHeader = (row: Row): boolean =>
    row.cells.length === 1 && SECTION_NAMES.has(row.cells[0]!);
  const isBusHeader = (row: Row): boolean => row.cells[0] === "bus" && row.cells.length >= 4;

  let current: Section | null = null;
  for (let row = next(); row !== null; row = next()) {
    if (isSectionHeader(row) || isBusHeader(row)) {
      const name = row.cells[0]!;
      current = {
        comments: row.comments,
        header: isBusHeader(row) ? row.cells : [name],
        rows: [],
      };
      if (!walk.sections.has(name)) walk.order.push(name);
      walk.sections.set(name, current);
      continue;
    }
    if (current === null) continue; // rows outside a section are reported by the parser; nothing is emitted here
    current.rows.push(row);
  }
  walk.trailing = pending;
  return walk;
}

/** Section name plus colon (canonical form of a net row: `SYS:`). */
function netName(cells: string[]): { name: string; members: string[] } {
  const first = cells[0] ?? "";
  if (first.endsWith(":")) {
    return { name: first.slice(0, -1), members: cells.slice(1) };
  }
  if (cells[1] === ":") {
    return { name: first, members: cells.slice(2) };
  }
  return { name: first, members: cells.slice(1) };
}

/**
 * Alignment of net-style rows: the net name (including the colon) is one column; members are separated by two spaces and start at the same column.
 * Members are not columns — within one row the members have different widths, so column alignment would leave large gaps.
 */
function alignNetRows(rows: Row[], indent: string): string[] {
  const parsed = rows.map((row) => ({ row, ...netName(row.cells) }));
  const width = parsed.reduce((max, item) => Math.max(max, item.name.length + 1), 0);
  const lines: string[] = [];
  for (const item of parsed) {
    lines.push(...item.row.comments);
    const head = `${item.name}:`.padEnd(width);
    const members = item.members.join("  ");
    lines.push(members.length > 0 ? `${indent}${head}  ${members}` : `${indent}${head}`);
  }
  return lines;
}

/** Alignment of ordinary table sections: aligned to the widest cell, at least two spaces between columns. */
function alignTableRows(rows: Row[], indent: string): string[] {
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

/**
 * Format a `schematic` / `page` file. No text is produced when there are semantic errors.
 */
export function formatSchematic(text: string, options: SchematicFormatOptions): SchematicFormatResult {
  const walk = walkSchematic(text);
  const kind = walk?.header[1]?.cells[0] === "page" ? "page" : "schematic";
  const parsed = parseSchematicDocument(text, { file: options.file, kind });
  if (!parsed.ok) return { ok: false, diagnostics: parsed.diagnostics };
  if (!walk) return { ok: false, diagnostics: parsed.diagnostics };

  const blocks: string[][] = [];
  blocks.push([
    ...walk.header[0]!.comments,
    `version ${walk.header[0]!.cells[1] ?? ""}`.trimEnd(),
    ...walk.header[1]!.comments,
    walk.header[1]!.cells.join(" "),
  ]);

  const order = kind === "page" ? PAGE_SECTIONS : SCHEMATIC_SECTIONS;
  for (const name of order) {
    const section = walk.sections.get(name);
    if (!section) continue;
    const block: string[] = [...section.comments, ...section.header];
    if (name === "nets") {
      const rows = [...section.rows].sort((a, b) => byteCompare(netName(a.cells).name, netName(b.cells).name));
      block.push(...alignNetRows(rows, "  "));
    } else if (name === "bus") {
      block.push(...alignNetRows(section.rows, "  "));
    } else if (name === "instances") {
      const rows = [...section.rows].sort((a, b) => naturalCompare(a.cells[0]!, b.cells[0]!));
      block.push(...alignTableRows(rows, "  "));
    } else if (name === "pages" || name === "ports") {
      const rows = [...section.rows].sort((a, b) => byteCompare(a.cells[0]!, b.cells[0]!));
      block.push(...alignTableRows(rows, "  "));
    } else {
      // constraints keep the source file's order.
      block.push(...alignTableRows(section.rows, "  "));
    }
    blocks.push(block);
  }

  if (walk.trailing.length > 0) blocks.push([...walk.trailing]);

  return { ok: true, text: `${blocks.map((b) => b.join("\n")).join("\n\n")}\n`, diagnostics: parsed.diagnostics };
}
