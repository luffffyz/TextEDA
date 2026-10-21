// Canonical form for `.teda` `schematic` / `page` (teda.md §12).
//
// Kept separate from the footprint / symbol formatters: here we must handle the `bus` instruction block (`bus <id> = <type>`
// followed by member rows), which is not a single-line section header, so the generic table walker cannot express it; this file brings its own line scan.
//
// Invariant (teda.md §12): `parse(fmt(x))` is semantically the same as `parse(x)`; `fmt(fmt(x)) == fmt(x)`.
import { byteCompare, naturalCompare, pinRefCompare } from "@texteda/ir/order";
import { lex } from "./lexer.ts";
import { parseSchematicDocument } from "./schematic.ts";
import type { Diagnostic } from "@texteda/ir/diagnostics";

/** The first-column marker of a continuation row: a bare `:` continues the net named by the row above. */
const CONTINUATION = ":";

/** Maximum width of a formatted net row, in columns. Longer member lists are wrapped into continuation rows. */
const MAX_LINE_WIDTH = 80;

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
        // A bus header is one line (`bus <id> = <type>`); other sections use the section name.
        header: isBusHeader(row) ? [row.cells.join(" ")] : [name],
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
  if (first === CONTINUATION) {
    // A bare `:` in the first column marks a continuation row.
    return { name: CONTINUATION, members: cells.slice(1) };
  }
  if (first.endsWith(":")) {
    return { name: first.slice(0, -1), members: cells.slice(1) };
  }
  if (cells[1] === ":") {
    return { name: first, members: cells.slice(2) };
  }
  return { name: first, members: cells.slice(1) };
}

/**
 * A net-style group: all rows that belong to one net, with their members merged.
 */
interface NetGroup {
  name: string;
  members: string[];
  comments: string[];
}

/**
 * Group net-style rows by net name.
 *
 * A repeated net name continues the same net, and a continuation row (a bare `:` in the first column) adds to the net
 * named by the row above it. Both are merged into one group, because the parser merges them into one net too.
 */
function groupNetRows(rows: Row[]): NetGroup[] {
  const groups: NetGroup[] = [];
  const byName = new Map<string, NetGroup>();
  for (const row of rows) {
    const { name, members } = netName(row.cells);
    const last = groups[groups.length - 1];
    if (name === CONTINUATION) {
      if (last === undefined) continue; // a continuation without a net above: the parser reports this
      last.members.push(...members);
      last.comments.push(...row.comments);
      continue;
    }
    const existing = byName.get(name);
    if (existing !== undefined) {
      existing.members.push(...members);
      existing.comments.push(...row.comments);
      continue;
    }
    const group: NetGroup = { name, members: [...members], comments: [...row.comments] };
    groups.push(group);
    byName.set(name, group);
  }
  return groups;
}

/**
 * Alignment of net-style rows: the net name (including the colon) is one column; members are separated by two spaces and start at the same column.
 * Members are not columns — within one row the members have different widths, so column alignment would leave large gaps.
 *
 * The members of one net are merged, sorted, and then wrapped so that no line exceeds `MAX_LINE_WIDTH`. The first line of a
 * net carries its name; the following lines are continuation rows whose first column is a bare `:`.
 */
function alignNetRows(rows: Row[], indent: string, sortGroups: boolean): string[] {
  const groups = groupNetRows(rows);
  if (sortGroups) groups.sort((a, b) => byteCompare(a.name, b.name));
  const width = groups.reduce((max, group) => Math.max(max, group.name.length + 1), 0);
  const lines: string[] = [];
  for (const group of groups) {
    lines.push(...group.comments);
    const members = [...group.members].sort(pinRefCompare);
    if (members.length === 0) {
      lines.push(`${indent}${`${group.name}:`.padEnd(width)}`);
      continue;
    }
    // The first line carries the net name; continuation lines start with a bare `:` in the name column.
    const head = `${group.name}:`.padEnd(width);
    const cont = ":".padEnd(width);
    let current = `${indent}${head}`;
    let column = indent.length + width + 2;
    let first = true;
    for (const member of members) {
      if (!first && column + member.length + 2 > MAX_LINE_WIDTH) {
        lines.push(current);
        current = `${indent}${cont}`;
        column = indent.length + width + 2;
        first = true;
      }
      current += `  ${member}`;
      column += member.length + 2;
      first = false;
    }
    lines.push(current);
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
      block.push(...alignNetRows(section.rows, "  ", true));
    } else if (name === "bus") {
      block.push(...alignNetRows(section.rows, "  ", false));
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
