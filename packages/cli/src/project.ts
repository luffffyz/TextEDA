// Read a project's file layout and contents. The file system appears only at this layer (ADR-0009 decision 1):
// `packages/core` / `packages/ir` / `packages/parser` never touch the disk.
//
// Project layout (ADR-0031, see `paths.ts`):
//   assets/components/**/*.teda        devices (one per file, id taken from the file name)
//   design/sch/<board>.teda            the board's schematic (one file per board, ADR-0025)
//   design/pcb/<board>.teda            the board's layout
//   design/modules/<module>.teda       module definitions (spec/module.md)
//   views/<board>/<page>.view.teda     a print page of the board's drawing (ADR-0021, ADR-0025, ADR-0032)
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
  parseComponent,
  type ComponentFactsLite,
  type ComponentResolver,
  type ModuleSource,
} from "@texteda/parser";
import type { DiagnosticCodeId } from "@texteda/ir/diagnostics";
import { LAYOUT } from "./paths.ts";

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

/**
 * Read the project's devices into a table the resolver can use.
 *
 * One directory holds device files (ADR-0027, ADR-0037): `assets/components/` holds the parts
 * (specific devices) and the generics (device classes) alike — the kind is a fact of the file,
 * not of the path. One id namespace: the id is the file name, so a board writes
 * `res-thick-0402` without saying where it lives.
 */
export function loadComponents(root: string): LoadedComponents {
  const files: string[] = [];
  const walk = (path: string): void => {
    if (!existsSync(path)) return;
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const full = join(path, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".teda")) files.push(full);
    }
  };
  walk(join(root, LAYOUT.components));

  const table = new Map<string, ComponentFactsLite>();
  const problems: ComponentProblem[] = [];
  /** Device files that exist but have errors: a board referencing them must not be told "not found". */
  const broken = new Map<string, string>();
  for (const file of files.sort()) {
    const result = parseComponent(readFileSync(file, "utf8"), { file: relative(root, file) });
    const id = file.slice(file.lastIndexOf("/") + 1, file.length - ".teda".length);
    const relativeFile = relative(root, file);
    if (!result.ok || !result.component) {
      broken.set(id, relativeFile);
      for (const diagnostic of result.diagnostics) {
        problems.push({
          code: diagnostic.code,
          file: relativeFile,
          line: diagnostic.location?.line ?? 1,
          message: diagnostic.message,
        });
      }
      continue;
    }
    // The component id is the file name (AGENTS.md §4.5): the id declared in the file header must match the file name, otherwise report an error.
    if (result.component.id !== id) {
      broken.set(id, relativeFile);
      problems.push({
        code: "ref.component-id-mismatch",
        file: relativeFile,
        line: 2,
        message: `The id declared in the file header is ${result.component.id}, the file name is ${id}`,
        data: { declared_id: result.component.id, file_id: id },
      });
      continue;
    }
    table.set(id, { params: result.component.params, pins: result.component.pins });
  }
  return {
    resolver: {
      resolve: (id) => table.get(id),
      broken: (id) => broken.get(id),
    },
    problems,
  };
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

/** A print page of a board's drawing: `views/<board>/<page_id>.view.teda`. */
export interface ViewSource {
  /** Print page id (the view file's id). */
  pageId: string;
  /** Path relative to the project root. */
  file: string;
  text: string;
}

/** List the project's boards (`design/sch/<board>.teda`). Returns an empty array when the directory does not exist. */
export function listBoards(root: string): string[] {
  const dir = join(root, LAYOUT.sch);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".teda"))
    .map((entry) => entry.name.slice(0, entry.name.length - ".teda".length))
    .sort();
}

/**
 * Read the project's modules (`design/modules/<module_id>.teda`). The module id is the file name, like the
 * component id (spec/module.md §1). Returns an empty array when the directory does not exist.
 */
export function loadModules(root: string): ModuleSource[] {
  const dir = join(root, LAYOUT.modules);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".teda"))
    .map((entry) => ({
      moduleId: entry.name.slice(0, entry.name.length - ".teda".length),
      file: relative(root, join(dir, entry.name)),
      text: readFileSync(join(dir, entry.name), "utf8"),
    }))
    .sort((a, b) => (a.moduleId < b.moduleId ? -1 : a.moduleId > b.moduleId ? 1 : 0));
}

/** Read the board's schematic file and its print pages. Returns `null` when the schematic file does not exist. */
export function loadBoard(root: string, board: string): LoadedBoard | null {
  const file = join(root, LAYOUT.sch, `${board}.teda`);
  if (!existsSync(file)) return null;
  const viewDir = join(root, LAYOUT.views, board);
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

/** Read `design/pcb/<board>.teda`; returns null when absent (pcb is an optional sibling description). */
export function loadPcb(root: string, board: string): LoadedBoard | null {
  const file = join(root, LAYOUT.pcb, `${board}.teda`);
  if (!existsSync(file)) return null;
  return {
    board,
    file: relative(root, file),
    text: readFileSync(file, "utf8"),
    views: [],
  };
}
