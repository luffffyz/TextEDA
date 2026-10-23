// Canonical form for `.teda` `system` (teda.md §12, spec/teda.md §8).
//
// The formatter only changes whitespace and row order — the cell contents stay as they are written
// (teda.md §12 rule 6). The parse decides whether the file is valid; a file with errors produces
// no output.
//
// The rules that matter here (teda.md §12):
//   - the sections are `boards` then `nets`;
//   - the boards are sorted by board id, the nets by net name;
//   - the members of a system net are sorted by `<board_id>.<port_id>`;
//   - the net name hugs the colon, the members start at the same column in every row of the
//     section, and a row that would exceed 80 columns is wrapped into continuation rows whose
//     first column is a bare `:`.
import { byteCompare } from "@texteda/ir/order";
import type { Diagnostic } from "@texteda/ir/diagnostics";
import { lex, type Line } from "./lexer.ts";
import { parseSystem } from "./system.ts";

/** Maximum width of a formatted net row, in columns. */
const MAX_LINE_WIDTH = 80;

export interface SystemFormatOptions {
  /** File name, used for diagnostics. */
  file: string;
}

export interface SystemFormatResult {
  ok: boolean;
  text?: string;
  diagnostics: Diagnostic[];
}

interface Row {
  comments: string[];
  cells: string[];
}

interface Walk {
  header: { version: Row; type: Row };
  sections: Map<string, { comments: string[]; rows: Row[] }>;
  trailing: string[];
}

/** Line scan: structural recognition only. */
function walkSystem(text: string): Walk | null {
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
  if (!version || !type) return null;

  const walk: Walk = { header: { version, type }, sections: new Map(), trailing: [] };
  let current: { comments: string[]; rows: Row[] } | null = null;
  for (let row = next(); row !== null; row = next()) {
    if (row.cells.length === 1 && (row.cells[0] === "boards" || row.cells[0] === "nets")) {
      const existing = walk.sections.get(row.cells[0]!);
      if (existing) {
        existing.comments.push(...row.comments);
      } else {
        current = { comments: row.comments, rows: [] };
        walk.sections.set(row.cells[0]!, current);
      }
      continue;
    }
    if (current === null) {
      current = { comments: [], rows: [] };
      walk.sections.set("", current);
    }
    current.rows.push(row);
  }
  walk.trailing = pending;
  return walk;
}

/** One net of a system: its name, its members and the comments that belong to it. */
interface NetGroup {
  name: string;
  comments: string[];
  members: string[];
}

/** Group the net rows by their name; a continuation row (a bare `:`) adds to the net above it. */
function groupNetRows(rows: Row[]): NetGroup[] {
  const groups: NetGroup[] = [];
  for (const row of rows) {
    const first = row.cells[0] ?? "";
    const name = first.endsWith(":") ? first.slice(0, -1) : first;
    const members = row.cells.slice(1);
    const existing = groups.find((group) => group.name === name);
    if (existing) {
      existing.members.push(...members);
      continue;
    }
    groups.push({ name, comments: row.comments, members: [...members] });
  }
  return groups;
}

/** Format a `system` file. No text is produced when the file has errors. */
export function formatSystem(text: string, options: SystemFormatOptions): SystemFormatResult {
  const parsed = parseSystem(text, { file: options.file });
  if (!parsed.ok) return { ok: false, diagnostics: parsed.diagnostics };
  const walk = walkSystem(text);
  if (!walk) return { ok: false, diagnostics: parsed.diagnostics };

  const blocks: string[][] = [];
  blocks.push([
    ...walk.header.version.comments,
    `version ${walk.header.version.cells[1] ?? ""}`.trimEnd(),
    ...walk.header.type.comments,
    walk.header.type.cells.join(" "),
  ]);

  const boards = walk.sections.get("boards");
  if (boards) {
    const block: string[] = [...boards.comments, "boards"];
    const rows = [...boards.rows].sort((a, b) => byteCompare(a.cells[0] ?? "", b.cells[0] ?? ""));
    for (const row of rows) {
      block.push(...row.comments);
      block.push(`  ${row.cells.join("  ")}`);
    }
    blocks.push(block);
  }

  const nets = walk.sections.get("nets");
  if (nets) {
    const groups = groupNetRows(nets.rows).sort((a, b) => byteCompare(a.name, b.name));
    const width = groups.reduce((max, group) => Math.max(max, group.name.length + 1), 0);
    const block: string[] = [...nets.comments, "nets"];
    for (const group of groups) {
      block.push(...group.comments);
      const members = [...group.members].sort(byteCompare);
      const head = `${group.name}:`.padEnd(width);
      const cont = ":".padEnd(width);
      let current = `  ${head}`;
      let column = 2 + width + 2;
      let first = true;
      for (const member of members) {
        if (!first && column + member.length + 2 > MAX_LINE_WIDTH) {
          block.push(current);
          current = `  ${cont}`;
          column = 2 + width + 2;
          first = true;
        }
        current += `  ${member}`;
        column += member.length + 2;
        first = false;
      }
      block.push(current);
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
