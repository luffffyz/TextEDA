// Coordinate-tuple folding, shared by the migrations that have to write the current surface.
//
// The 0.11 surface writes a point, a size and an offset as one bracketed cell (ADR-0065). A
// migration that produces such a file — `migrate:0.11`, and `migrate:0.7` when it rewrites a page
// or a pcb description — folds the coordinates here, so the two cannot drift apart.
//
// It works on the text, not on the IR: it reads and writes lines and never asks the parser what a
// file means. It decides nothing — a tuple's arity was already fixed by the column that consumed
// it. A row whose cell count does not match its column's arity was already invalid; the fold reports
// it and leaves the row alone, and the parser is the one that says why.
//
// Idempotent: an already-bracketed tuple is left as it is, so re-folding is safe.
import { splitCells, type Cell } from "@texteda/parser";

/**
 * One section's coordinate columns (ADR-0065 §Migration).
 *
 * `starts` is the column index of each tuple's first component; `arity` is how many components one
 * tuple has. `repeat` marks a run that continues to the end of the row (outline vertices, trace
 * bends, zone rings, wire bends), where the number of tuples is the number of cells left.
 */
export interface Fold {
  readonly starts: readonly number[];
  readonly arity: number;
  readonly repeat: boolean;
}

/** Section name → its coordinate columns, per description type. */
const FOLDS: Record<string, Record<string, Fold>> = {
  view: {
    place: { starts: [1], arity: 2, repeat: false },
    field: { starts: [2], arity: 2, repeat: false },
    junction: { starts: [1], arity: 2, repeat: false },
    wire: { starts: [3], arity: 2, repeat: true },
    label: { starts: [1], arity: 2, repeat: false },
    port: { starts: [1], arity: 2, repeat: false },
    text: { starts: [0], arity: 2, repeat: false },
  },
  pcb: {
    outline: { starts: [0], arity: 2, repeat: true },
    place: { starts: [1], arity: 2, repeat: false },
    trace: { starts: [3], arity: 2, repeat: true },
    via: { starts: [1], arity: 2, repeat: false },
    zone: { starts: [2], arity: 2, repeat: true },
    keepout: { starts: [2], arity: 2, repeat: true },
    physical_only: { starts: [2], arity: 2, repeat: false },
  },
  symbol: { pins: { starts: [1], arity: 2, repeat: false } },
  // A pad carries two tuples: its position, then its size.
  footprint: { pads: { starts: [3, 5], arity: 2, repeat: false } },
};

/** A section whose whole geometry is one comma list in one cell (`rect  -10,-16.5,10,16.5`). */
const WRAPS: Record<string, Record<string, number>> = {
  symbol: { body: 1 },
  footprint: { graphics: 2 },
};

/** Every section header of a type, so a section without coordinates still closes the previous one. */
const SECTIONS: Record<string, ReadonlySet<string>> = {
  view: new Set(["place", "field", "junction", "wire", "label", "port", "text"]),
  pcb: new Set([
    "stackup",
    "outline",
    "place",
    "connect",
    "trace",
    "via",
    "zone",
    "keepout",
    "rules",
    "silk",
    "physical_only",
    "deviation",
  ]),
  symbol: new Set(["pins", "body"]),
  footprint: new Set(["pads", "graphics"]),
};
/** Description types whose lexical surface contains coordinate tuples. */
export const GEOMETRIC_DESCRIPTION_TYPES: ReadonlySet<string> = new Set(Object.keys(SECTIONS));

/** A file-level scalar whose value is a tuple (`view`'s `sheet <size>`). */
const SCALAR_FOLDS: Record<string, Record<string, Fold>> = {
  view: { sheet: { starts: [1], arity: 2, repeat: false } },
};

/** Keys whose `key=value` value is a tuple, per description type. */
const TUPLE_KEYS: Record<string, ReadonlySet<string>> = {
  symbol: new Set(["at", "size"]),
  footprint: new Set(["at", "size", "offset", "scale", "rot"]),
};

/** The index of a file's header line: the first line that is neither blank nor a comment. */
export function headerIndex(lines: readonly string[]): number {
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i]!.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    return i;
  }
  return -1;
}

/** The description type a file declares on the line after its version line, or "" when it has none. */
export function descriptionType(lines: readonly string[]): string {
  const at = headerIndex(lines);
  if (at < 0) return "";
  const match = /^(\S+)\s+\S+/.exec(lines[at + 1]?.trim() ?? "");
  return match?.[1] ?? "";
}

/** One replacement on a line: replace characters `[from, to)` (0-based) with `text`. */
interface Replacement {
  readonly from: number;
  readonly to: number;
  readonly text: string;
}

/** Apply the replacements right to left, so the offsets of the ones before them stay valid. */
function applyReplacements(line: string, replacements: readonly Replacement[]): string {
  let out = line;
  for (const replacement of [...replacements].sort((a, b) => b.from - a.from)) {
    out = out.slice(0, replacement.from) + replacement.text + out.slice(replacement.to);
  }
  return out;
}

/** A bracketed tuple whose components are the given cells, or `null` when they are already bracketed. */
function tupleReplacement(cells: readonly Cell[], first: number, arity: number): Replacement | null {
  const head = cells[first]!;
  if (head.text.startsWith("[")) return null;
  const last = cells[first + arity - 1]!;
  const body = cells
    .slice(first, first + arity)
    .map((cell) => cell.text)
    .join(",");
  return { from: head.col - 1, to: last.col - 1 + last.text.length, text: `[${body}]` };
}

/**
 * Fold one row's coordinate columns.
 *
 * A row already written in the new form is left alone, so the fold is idempotent. When the row
 * does not have the cells its column demands, the reason is returned instead of guessed at: a row
 * whose arity does not match its column was already invalid, and the parser is the one that says so.
 */
export function foldRow(line: string, fold: Fold): { line: string; problem?: string } {
  const cells = splitCells(line);
  const replacements: Replacement[] = [];
  if (fold.repeat) {
    const start = fold.starts[0]!;
    const left = cells.length - start;
    if (left < 0) return { line, problem: `the row is too short for column ${start + 1}` };
    const head = cells[start];
    if (left > 0 && head !== undefined && head.text.startsWith("[")) return { line };
    if (left % fold.arity !== 0) {
      return {
        line,
        problem: `column ${start + 1} starts a run of ${left} cell(s), not a whole number of ${fold.arity}-component tuples`,
      };
    }
    for (let i = start; i + fold.arity <= cells.length; i += fold.arity) {
      const replacement = tupleReplacement(cells, i, fold.arity);
      if (replacement !== null) replacements.push(replacement);
    }
  } else {
    let collapsedBefore = 0;
    for (const start of fold.starts) {
      // `starts` describes the old, two-cells-per-tuple row. An already-bracketed tuple has
      // collapsed one cell, so later tuple columns move left on a second migration run.
      const effectiveStart = start - collapsedBefore;
      const head = cells[effectiveStart];
      if (head === undefined) return { line, problem: `the row is too short for the tuple at column ${start + 1}` };
      // Already bracketed: one cell is the whole tuple, so no arity check applies.
      if (head.text.startsWith("[")) {
        collapsedBefore += fold.arity - 1;
        continue;
      }
      if (cells.length < effectiveStart + fold.arity) {
        return { line, problem: `the row is too short for the tuple at column ${start + 1}` };
      }
      const replacement = tupleReplacement(cells, effectiveStart, fold.arity);
      if (replacement !== null) replacements.push(replacement);
    }
  }
  return { line: applyReplacements(line, replacements) };
}

/** Bracket one cell that holds an unbracketed comma list, e.g. `rect  -10,-16.5,10,16.5`. */
function wrapCell(line: string, index: number): { line: string; problem?: string } {
  const cell = splitCells(line)[index];
  if (cell === undefined) return { line, problem: `the row has no geometry cell at column ${index + 1}` };
  if (cell.text.startsWith("[")) return { line };
  if (!cell.text.includes(",")) return { line, problem: `the geometry cell is not a comma list: ${cell.text}` };
  const replacement: Replacement = { from: cell.col - 1, to: cell.col - 1 + cell.text.length, text: `[${cell.text}]` };
  return { line: applyReplacements(line, [replacement]) };
}

/**
 * Bracket the value of a tuple-carrying key in a `key=value` cell: `at=-6.5,20` → `at=[-6.5,20]`.
 *
 * The cell is one token, so the value's own column is the cell's column plus the key and the `=`.
 */
function bracketKeys(line: string, keys: ReadonlySet<string>): string {
  const replacements: Replacement[] = [];
  for (const cell of splitCells(line)) {
    const eq = cell.text.indexOf("=");
    if (eq <= 0) continue;
    const key = cell.text.slice(0, eq);
    const value = cell.text.slice(eq + 1);
    if (!keys.has(key)) continue;
    if (value.startsWith("[") || value.includes(" ")) continue;
    if (!value.includes(",")) continue;
    const from = cell.col - 1 + eq + 1;
    replacements.push({ from, to: from + value.length, text: `[${value}]` });
  }
  return applyReplacements(line, replacements);
}

/**
 * Fold every coordinate in one file.
 *
 * A section header is a single cell at column 1; the rows below it are indented, and belong to it.
 * A `field`/`model` line is a file-level scalar whose tuple lives inside a `key=value` cell, so it is
 * bracketed in place rather than folded by column.
 */
export function foldFile(text: string, type: string): { text: string; problems: string[] } {
  const lines = text.split("\n");
  const problems: string[] = [];
  const folds = FOLDS[type] ?? {};
  const wraps = WRAPS[type] ?? {};
  const scalars = SCALAR_FOLDS[type] ?? {};
  const sections = SECTIONS[type];
  const tupleKeys = TUPLE_KEYS[type];
  if (sections === undefined) return { text, problems };

  let section: string | undefined;
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index]!.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const cells = splitCells(lines[index]!);
    const atColumnOne = cells[0]!.col === 1;
    if (atColumnOne && cells.length === 1 && sections.has(cells[0]!.text)) {
      section = cells[0]!.text;
      continue;
    }

    // File-level scalars. `sheet` carries a size tuple; `field`/`model` carry key=value tuples.
    if (atColumnOne) {
      const scalar = scalars[cells[0]!.text];
      if (scalar !== undefined) {
        const result = foldRow(lines[index]!, scalar);
        if (result.problem !== undefined) problems.push(`line ${index + 1}: ${result.problem}`);
        else lines[index] = result.line;
      } else if (cells[0]!.text === "field" || cells[0]!.text === "model") {
        if (tupleKeys !== undefined) lines[index] = bracketKeys(lines[index]!, tupleKeys);
      }
      continue;
    }

    if (section === undefined) continue;
    const fold = folds[section];
    const wrap = wraps[section];
    if (fold !== undefined) {
      const result = foldRow(lines[index]!, fold);
      if (result.problem !== undefined) problems.push(`line ${index + 1}: ${result.problem}`);
      else lines[index] = result.line;
    } else if (wrap !== undefined) {
      const result = wrapCell(lines[index]!, wrap);
      if (result.problem !== undefined) problems.push(`line ${index + 1}: ${result.problem}`);
      else lines[index] = result.line;
    }
  }
  return { text: lines.join("\n"), problems };
}
