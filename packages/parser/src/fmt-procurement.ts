// Canonical form for `.teda` `procurement` (spec/procurement.md §6, teda.md §12).
//
// The formatter only changes whitespace and row order — the cell contents stay as they are written
// (teda.md §12 rule 6), so `10k` stays `10k` and `10 kOhm` stays `10 kOhm`. The parse decides
// whether the file is valid; a file with errors produces no output.
//
// Procurement rows are **not** column-aligned: the first parameter of one generic is not the first
// parameter of another, so aligning the columns would suggest a correspondence that is not there.
import { byteCompare } from "@texteda/ir/order";
import type { Diagnostic } from "@texteda/ir/diagnostics";
import { lex, type Line } from "./lexer.ts";
import { parseProcurementDocument } from "./procurement.ts";

export interface ProcurementFormatOptions {
  /** File name, used for diagnostics. */
  file: string;
}

export interface ProcurementFormatResult {
  ok: boolean;
  text?: string;
  diagnostics: Diagnostic[];
}

interface Row {
  comments: string[];
  cells: string[];
}

interface Walk {
  header: { version: Row; type: Row; role: Row };
  sections: Map<string, { comments: string[]; rows: Row[] }>;
  trailing: string[];
}

/** Line scan: structural recognition only. */
function walkProcurement(text: string): Walk | null {
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
      return { comments, cells: line.cells.map((cell) => cell.text) };
    }
    return null;
  };

  const version = next();
  const type = next();
  const role = next();
  if (!version || !type || !role) return null;

  const walk: Walk = {
    header: { version, type, role },
    sections: new Map(),
    trailing: [],
  };
  let current: { comments: string[]; rows: Row[] } | null = null;
  for (let row = next(); row !== null; row = next()) {
    if (row.cells.length === 1) {
      const name = row.cells[0]!;
      const existing = walk.sections.get(name);
      if (existing) {
        // A second section head with the same name continues the first one.
        existing.comments.push(...row.comments);
      } else {
        current = { comments: row.comments, rows: [] };
        walk.sections.set(name, current);
      }
      continue;
    }
    if (current === null) {
      // A scalar before the section: the header has three lines, so this is a stray key.
      current = { comments: [], rows: [] };
      walk.sections.set("", current);
    }
    current.rows.push(row);
  }
  walk.trailing = pending;
  return walk;
}

/** Compare two rows by their left key: the generic id, then the parameter cells, each by text. */
function compareRows(a: Row, b: Row): number {
  const count = Math.max(a.cells.length, b.cells.length);
  for (let i = 0; i < count; i += 1) {
    const left = a.cells[i] ?? "";
    const right = b.cells[i] ?? "";
    if (left !== right) return byteCompare(left, right);
  }
  return 0;
}

/** Format a `procurement` file. No text is produced when the file has errors. */
export function formatProcurement(text: string, options: ProcurementFormatOptions): ProcurementFormatResult {
  const parsed = parseProcurementDocument(text, { file: options.file });
  if (!parsed.ok) return { ok: false, diagnostics: parsed.diagnostics };
  const walk = walkProcurement(text);
  if (!walk) return { ok: false, diagnostics: parsed.diagnostics };

  const blocks: string[][] = [];
  blocks.push([
    ...walk.header.version.comments,
    `version ${walk.header.version.cells[1] ?? ""}`.trimEnd(),
    ...walk.header.type.comments,
    walk.header.type.cells.join(" "),
    ...walk.header.role.comments,
    walk.header.role.cells.join(" "),
  ]);

  const section = walk.sections.get("selections");
  if (section) {
    const rows = [...section.rows].sort(compareRows);
    const block: string[] = [...section.comments, "selections"];
    for (const row of rows) {
      block.push(...row.comments);
      // The cells keep their single-space separation: the columns mean different things per row.
      block.push(`  ${row.cells.join(" ")}`);
    }
    blocks.push(block);
  }

  if (walk.trailing.length > 0) blocks.push([...walk.trailing]);

  return {
    ok: true,
    text: `${blocks.map((block) => block.join("\n")).join("\n\n")}\n`,
    diagnostics: parsed.diagnostics,
  };
}
