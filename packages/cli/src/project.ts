// Read a project's file layout and contents. The file system appears only at this layer (ADR-0009 decision 1):
// `packages/core` / `packages/ir` / `packages/parser` never touch the disk.
//
// Project layout (AGENTS.md §9):
//   components/**/*.teda              components (one part per file, id taken from the file name)
//   sch/<board>.teda                  the board's schematic (one file per board, ADR-0025)
//   sch/<board>/<page>.view.teda      a print page of the board's drawing (ADR-0021, ADR-0025)
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
  readComponentIndex,
  type ComponentFactsLite,
  type ComponentResolver,
} from "@texteda/parser";
import type { DiagnosticCodeId } from "@texteda/ir/diagnostics";

/** Problem when a component file cannot be read (no exception thrown; the caller aggregates these into diagnostics). */
export interface ComponentProblem {
  /** Diagnostic code (a code from the ADR-0016 registry). */
  code: DiagnosticCodeId;
  /** Path relative to the project root. */
  file: string;
  /** Line number. */
  line: number;
  /** Human-readable message. */
  message: string;
  /** Machine-usable data. */
  data?: Record<string, string | number | boolean> | undefined;
}

export interface LoadedComponents {
  /** Component table: id -> component facts. */
  resolver: ComponentResolver;
  /** Component files that could not be read. */
  problems: ComponentProblem[];
}

/** Read the project's components into a table the resolver can use. The component id is the file name (directory and `.teda` stripped). */
export function loadComponents(root: string): LoadedComponents {
  const dir = join(root, "components");
  const files: string[] = [];
  const walk = (path: string): void => {
    if (!existsSync(path)) return;
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const full = join(path, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".teda")) files.push(full);
    }
  };
  walk(dir);

  const table = new Map<string, ComponentFactsLite>();
  const problems: ComponentProblem[] = [];
  for (const file of files.sort()) {
    const result = readComponentIndex(readFileSync(file, "utf8"));
    const id = file.slice(file.lastIndexOf("/") + 1, file.length - ".teda".length);
    const relativeFile = relative(root, file);
    if (!result.ok || !result.facts) {
      for (const problem of result.problems) {
        problems.push({
          code: "syntax.component-invalid",
          file: relativeFile,
          line: problem.line,
          message: problem.message,
        });
      }
      continue;
    }
    // The component id is the file name (AGENTS.md §4.5): the id declared in the file header must match the file name, otherwise report an error.
    if (result.id !== undefined && result.id !== id) {
      problems.push({
        code: "ref.component-id-mismatch",
        file: relativeFile,
        line: 2,
        message: `The id declared in the file header is ${result.id}, the file name is ${id}`,
        data: { declared_id: result.id, file_id: id },
      });
      continue;
    }
    table.set(id, result.facts);
  }
  return { resolver: { resolve: (id) => table.get(id) }, problems };
}

export interface LoadedBoard {
  /** Board id. */
  board: string;
  /** The board's schematic file (relative to the project root). */
  file: string;
  /** The board's schematic text. */
  text: string;
  /** The board's print pages (the drawing layer, ADR-0021). */
  views: ViewSource[];
}

/** A print page of a board's drawing: `sch/<board>/<page_id>.view.teda`. */
export interface ViewSource {
  /** Print page id (the view file's id). */
  pageId: string;
  /** Path relative to the project root. */
  file: string;
  text: string;
}

/** List the project's boards (`sch/<board>.teda`). Returns an empty array when the directory does not exist. */
export function listBoards(root: string): string[] {
  const dir = join(root, "sch");
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".teda"))
    .map((entry) => entry.name.slice(0, entry.name.length - ".teda".length))
    .sort();
}

/** Read the board's schematic file and its print pages. Returns `null` when the schematic file does not exist. */
export function loadBoard(root: string, board: string): LoadedBoard | null {
  const file = join(root, "sch", `${board}.teda`);
  if (!existsSync(file)) return null;
  const viewDir = join(root, "sch", board);
  const views: ViewSource[] = [];
  if (existsSync(viewDir)) {
    for (const name of readdirSync(viewDir).sort()) {
      // Only print pages live in this directory: `<page_id>.view.teda` (ADR-0021, ADR-0025).
      if (!name.endsWith(".view.teda")) continue;
      views.push({
        pageId: name.slice(0, name.length - ".view.teda".length),
        file: relative(root, join(viewDir, name)),
        text: readFileSync(join(viewDir, name), "utf8"),
      });
    }
  }
  return {
    board,
    file: relative(root, file),
    text: readFileSync(file, "utf8"),
    views,
  };
}

/** Read `pcb/<board>.teda`; returns null when absent (pcb is an optional sibling description). */
export function loadPcb(root: string, board: string): LoadedBoard | null {
  const file = join(root, "pcb", `${board}.teda`);
  if (!existsSync(file)) return null;
  return {
    board,
    file: relative(root, file),
    text: readFileSync(file, "utf8"),
    views: [],
  };
}
