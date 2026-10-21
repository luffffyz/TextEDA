// Read a project's file layout and contents. The file system appears only at this layer (ADR-0009 decision 1):
// `packages/core` / `packages/ir` / `packages/parser` never touch the disk.
//
// Project layout (AGENTS.md §9):
//   components/**/*.teda       components (one part per file, id taken from the file name)
//   sch/<board>.teda           board root
//   sch/<board>/<page>.teda    page inside a board (a subdivision of the board, not a standalone board)
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
  readComponentIndex,
  type ComponentFactsLite,
  type ComponentResolver,
  type PageSource,
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
  /** Board root file (relative to the project root). */
  file: string;
  /** Board root text. */
  text: string;
  /** Pages inside the board. */
  pages: PageSource[];
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

/** Read the board root and its pages. Returns `null` when the board root does not exist. */
export function loadBoard(root: string, board: string): LoadedBoard | null {
  const file = join(root, "sch", `${board}.teda`);
  if (!existsSync(file)) return null;
  const pageDir = join(root, "sch", board);
  const pages: PageSource[] = [];
  if (existsSync(pageDir)) {
    for (const name of readdirSync(pageDir).sort()) {
      // `<page>.view.teda` is the page's drawing (ADR-0021), not a page description.
      if (!name.endsWith(".teda") || name.endsWith(".view.teda")) continue;
      pages.push({
        pageId: name.slice(0, name.length - ".teda".length),
        file: relative(root, join(pageDir, name)),
        text: readFileSync(join(pageDir, name), "utf8"),
      });
    }
  }
  return {
    board,
    file: relative(root, file),
    text: readFileSync(file, "utf8"),
    pages,
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
    pages: [],
  };
}
