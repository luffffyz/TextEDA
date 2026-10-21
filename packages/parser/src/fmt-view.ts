// Canonical form for `.teda` `view` (spec/schematic-view.md §11, teda.md §12).
//
// The formatter only changes whitespace, row order and section order — the cell contents stay as
// written (teda.md §12 rule 6), so `40.0` stays `40.0` and `40mm` stays `40mm`. The parse decides
// whether the file is valid; a file with errors produces no output.
import { byteCompare, naturalCompare, pinRefCompare } from "@texteda/ir/order";
import type { Diagnostic } from "@texteda/ir/diagnostics";
import { lex, type Line } from "./lexer.ts";
import { parseView } from "./view.ts";

export interface ViewFormatOptions {
  file: string;
}

export interface ViewFormatResult {
  ok: boolean;
  /** canonical text; omitted when there are semantic errors. */
  text?: string;
  diagnostics: Diagnostic[];
}

const SECTIONS = ["place", "wire", "label", "port", "text"] as const;
const SECTION_SET = new Set<string>(SECTIONS);

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
function walkView(text: string): Walk | null {
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
    if (row.cells.length === 1 && SECTION_SET.has(row.cells[0]!)) {
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

/** Compare two coordinate cells numerically when both are plain numbers, else byte order. */
function compareCoordinate(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na === nb ? 0 : na < nb ? -1 : 1;
  return byteCompare(a, b);
}

/** Align the given columns of the rows to the widest cell of their column. */
function alignCells(rows: Row[], count: number, indent: string): string[] {
  const widths: number[] = [];
  for (const row of rows) {
    for (let i = 0; i < count; i += 1) {
      widths[i] = Math.max(widths[i] ?? 0, row.cells[i]?.length ?? 0);
    }
  }
  const lines: string[] = [];
  for (const row of rows) {
    lines.push(...row.comments);
    const cells = row.cells.slice(0, count).map((cell, i) => (i === count - 1 ? cell : cell.padEnd(widths[i]!)));
    lines.push(indent + cells.join("  "));
  }
  return lines;
}

/** The `place` row: id x y [rot] [unit=N]; the rot column and the key column are separate. */
function formatPlace(rows: Row[], indent: string): string[] {
  const widths = widthsOf(rows, 3);
  const rotWidth = rows.reduce((max, row) => {
    const cell = row.cells[3];
    if (cell === undefined || cell.includes("=")) return max;
    return Math.max(max, cell.length);
  }, 0);
  const lines: string[] = [];
  for (const row of rows) {
    lines.push(...row.comments);
    const head = row.cells.slice(0, 3).map((cell, i) => (i === 2 ? cell : cell.padEnd(widths[i]!)));
    const rest: string[] = [];
    const rot = row.cells[3];
    if (rot !== undefined && !rot.includes("=")) rest.push(rot.padEnd(rotWidth));
    const unit = row.cells.slice(3).find((cell) => cell.includes("="));
    if (unit !== undefined) rest.push(unit);
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

/** The `port` row: port_id x y [rot]; the optional rotation is never dropped. */
function formatPort(rows: Row[], indent: string): string[] {
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

/** The `wire` row: net from_pin to_pin [bend pairs]; the bends stay paired (x y, x y). */
function formatWire(rows: Row[], indent: string): string[] {
  const widths = widthsOf(rows, 3);
  const lines: string[] = [];
  for (const row of rows) {
    lines.push(...row.comments);
    const head = row.cells.slice(0, 3).map((cell, i) => (i === 2 ? cell : cell.padEnd(widths[i]!)));
    const tail = row.cells.slice(3);
    const pairs: string[] = [];
    for (let i = 0; i < tail.length; i += 2) pairs.push(`${tail[i]} ${tail[i + 1]}`);
    const suffix = pairs.length > 0 ? `  ${pairs.join("  ")}` : "";
    lines.push(`${indent}${head.join("  ")}${suffix}`);
  }
  return lines;
}

/** Format a `view` file. No text is produced when the file has errors. */
export function formatView(text: string, options: ViewFormatOptions): ViewFormatResult {
  const parsed = parseView(text, { file: options.file, board: "" });
  if (!parsed.ok) return { ok: false, diagnostics: parsed.diagnostics };
  const walk = walkView(text);
  if (!walk) return { ok: false, diagnostics: parsed.diagnostics };

  const blocks: string[][] = [];
  blocks.push([
    ...walk.header.version.comments,
    `version ${walk.header.version.cells[1] ?? ""}`.trimEnd(),
    ...walk.header.type.comments,
    walk.header.type.cells.join(" "),
  ]);

  for (const row of walk.scalars) {
    blocks.push([...row.comments, row.cells.join(" ")]);
  }

  for (const name of SECTIONS) {
    const section = walk.sections.get(name);
    if (!section || section.rows.length === 0) continue;
    const rows = [...section.rows];
    switch (name) {
      case "place":
        rows.sort((a, b) => naturalCompare(a.cells[0] ?? "", b.cells[0] ?? ""));
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
    const block: string[] = [...section.comments, name];
    switch (name) {
      case "place":
        block.push(...formatPlace(rows, "  "));
        break;
      case "wire":
        block.push(...formatWire(rows, "  "));
        break;
      case "label":
        block.push(...alignCells(rows, 3, "  "));
        break;
      case "port":
        block.push(...formatPort(rows, "  "));
        break;
      case "text": {
        // The text is the rest of the line: it is the last cell and is never padded.
        const widths = widthsOf(rows, 2);
        for (const row of rows) {
          block.push(...row.comments);
          const head = row.cells.slice(0, 2).map((cell, i) => cell.padEnd(widths[i]!));
          block.push(`  ${head.join("  ")}  ${row.cells.slice(2).join(" ")}`);
        }
        break;
      }
    }
    blocks.push(block);
  }

  if (walk.trailing.length > 0) blocks.push([...walk.trailing]);

  return { ok: true, text: `${blocks.map((b) => b.join("\n")).join("\n\n")}\n`, diagnostics: parsed.diagnostics };
}
