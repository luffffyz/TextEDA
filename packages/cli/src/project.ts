// Read a project's file layout and contents. The file system appears only at this layer (ADR-0038 decision 1):
// `packages/core` / `packages/ir` / `packages/parser` never touch the disk.
//
// Project layout (ADR-0008, see `paths.ts`):
//   assets/components/**/*.teda        devices (one per file, id taken from the file name)
//   design/sch/main.teda               the one logical root (ADR-0069 D1)
//   design/pcb/<pcb_id>.teda           the physical PCB implementations (ADR-0069 D2)
//   design/modules/<module>.teda       module definitions (spec/module.md)
//   views/<page>.view.teda             a project print page (ADR-0069 D4)
//   views/modules/<module>.module-view.teda      a reusable drawing of one module (ADR-0068 D1)
//   views/templates/<template>.sheet-template.teda  reusable static page furniture (ADR-0068 D1)
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
  parseComponent,
  parseProjectToml,
  type ComponentFactsLite,
  type ComponentResolver,
  type ModuleSource,
} from "@texteda/parser";
import type { Component } from "@texteda/ir/component";
import { schemaDiagnosticsToDiagnostics, validate } from "@texteda/ir";
import type { Diagnostic } from "@texteda/ir/diagnostics";
import type { Project } from "@texteda/ir/project";
import type { DiagnosticCodeId } from "@texteda/ir/diagnostics";
import { PROCUREMENT_ROLES, type ProcurementRole } from "@texteda/parser";
import type { Device } from "@texteda/core";
import type { SourceMap } from "@texteda/ir/spans";
import { LAYOUT, MAIN_SCHEMATIC_ID, VIEW_SUFFIXES } from "./paths.ts";
import { locateWith } from "./locate.ts";

/** Problem when a component file cannot be read (no exception thrown; the caller aggregates these into diagnostics). */
export interface ComponentProblem {
  /** Diagnostic code (a code from the ADR-0003 registry). */
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
  /** The devices, id -> the facts the procurement rules need (ADR-0029). */
  devices: Map<string, Device>;
  /**
   * The IR shard of every readable component file, for the shard tree (`assets/components/<id>.json`).
   *
   * A file only appears here when it parsed cleanly *and* its header id equals its file name: a
   * shard whose id disagrees with its path would make the tree's identity depend on which reader
   * looks at it.
   */
  shards: { id: string; file: string; ir: Component; sources?: SourceMap }[];
  /** Every diagnostic the component files produced, with severity and hint intact. */
  diagnostics: Diagnostic[];
  /**
   * Trees left under `external/libs/`: an external library is a template that `lib import` copies
   * into `assets/`, so a tree there is reported and never resolved (ADR-0034).
   */
  unattachedLibraries: UnattachedLibrary[];
}

/**
 * Read the project's devices into a table the resolver can use.
 *
 * One directory holds device files (ADR-0024, ADR-0024): `assets/components/` holds the parts
 * (specific devices) and the generics (device classes) alike — the kind is a fact of the file,
 * not of the path: the file name is the component id.
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
  const devices = new Map<string, Device>();
  const problems: ComponentProblem[] = [];
  const shards: { id: string; file: string; ir: Component; sources?: SourceMap }[] = [];
  const diagnostics: Diagnostic[] = [];
  /** Device files that exist but have errors: a module referencing them must not be told "not found". */
  const broken = new Map<string, string>();
  for (const file of files.sort()) {
    const result = parseComponent(readFileSync(file, "utf8"), { file: relative(root, file) });
    const id = file.slice(file.lastIndexOf("/") + 1, file.length - ".teda".length);
    const relativeFile = relative(root, file);
    if (!result.ok || !result.component) {
      broken.set(id, relativeFile);
      diagnostics.push(...result.diagnostics);
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
      diagnostics.push({
        code: "ref.component-id-mismatch",
        severity: "error",
        message: `The id declared in the file header is ${result.component.id}, the file name is ${id}`,
        hint: "the id is the file name: rename the file or the header, they must agree",
        location: { file: relativeFile, line: 2, col: 1 },
        data: { declared_id: result.component.id, file_id: id },
      });
      continue;
    }
    if (result.ir) {
      // The contract layer, the same one the shard tree applies (ADR-0038 decision 7): a device whose
      // IR does not satisfy `component` blocks the build, so `check` reports it rather than passing.
      const contract = validate("component", result.ir);
      if (!contract.ok) {
        broken.set(id, relativeFile);
        diagnostics.push(...schemaDiagnosticsToDiagnostics(contract.errors, locateWith(result.sources)));
        continue;
      }
      shards.push({ id, file: relativeFile, ir: result.ir, ...(result.sources ? { sources: result.sources } : {}) });
    }
    const locate = locateWith(result.sources);
    table.set(id, {
      params: result.component.params,
      pins: result.component.pins,
      ...(locate === undefined ? {} : { locate }),
    });
    devices.set(id, {
      id,
      kind: result.component.kind,
      ...(result.component.mpn ? { mpn: result.component.mpn } : {}),
      footprint: result.component.footprint,
      ratings: Object.fromEntries(
        result.component.ratings.map((rating) => [
          rating.name,
          { type: rating.type, value: rating.value },
        ]),
      ),
      params: result.component.params.map((param) => ({ name: param.name, type: param.type })),
      ...(result.component.construction ? { construction: result.component.construction } : {}),
    });
  }
  // A tree under `external/libs/` that holds asset groups is the shape this project no longer reads
  // (ADR-0034). Report it here rather than at each reference: otherwise the symptom is a pile of
  // "unknown component" errors whose cause is a directory nobody is supposed to have.
  const unattachedLibraries = findUnattachedLibraries(root);
  for (const library of unattachedLibraries) {
    diagnostics.push({
      code: "ref.library-in-tree",
      severity: "error",
      message: `external/libs/${library.name} holds library assets, but the build does not read that directory`,
      hint: "import the devices you need (`texteda lib import <name> --from <dir> --rev <rev>`), then delete the tree: an external library is a template, not a dependency (ADR-0034)",
      location: { file: `external/libs/${library.name}`, line: 1, col: 1 },
      data: { library: library.name, groups: library.groups.join(",") },
    });
  }

  return {
    resolver: {
      resolve: (id) => table.get(id),
      broken: (id) => broken.get(id),
    },
    problems,
    devices,
    shards,
    diagnostics,
    unattachedLibraries,
  };

}

/** The project's one logical root: `design/sch/main.teda` (ADR-0069 D1). */
export interface SchematicSource {
  /** Path relative to the project root. */
  file: string;
  /** The file's text. */
  text: string;
}

/** Read the project's logical root (`design/sch/main.teda`). Returns `null` when the file does not exist. */
export function loadSchematic(root: string): SchematicSource | null {
  const file = join(root, LAYOUT.sch, `${MAIN_SCHEMATIC_ID}.teda`);
  if (!existsSync(file)) return null;
  return { file: relative(root, file), text: readFileSync(file, "utf8") };
}

/** A project print page: `views/<page_id>.view.teda` (ADR-0069 D4). */
export interface ViewSource {
  /** Print page id (the view file's id). */
  pageId: string;
  /** Path relative to the project root. */
  file: string;
  text: string;
}

/** The project's print pages (`views/<page_id>.view.teda`), the drawing layer (ADR-0035). Returns an empty array when the directory does not exist. */
export function loadViews(root: string): ViewSource[] {
  return readViewFiles(root, LAYOUT.views, VIEW_SUFFIXES.page).map((page) => ({
    pageId: page.id,
    file: page.file,
    text: page.text,
  }));
}

/** A physical PCB implementation: `design/pcb/<pcb_id>.teda` (ADR-0069 D2). */
export interface PcbSource {
  /** The PCB id, taken from the file name. */
  pcbId: string;
  /** Path relative to the project root. */
  file: string;
  /** The file's text. */
  text: string;
}

/** List the project's physical PCBs (`design/pcb/<pcb_id>.teda`). Returns an empty array when the directory does not exist. */
export function listPcbs(root: string): string[] {
  const dir = join(root, LAYOUT.pcb);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".teda"))
    .map((entry) => entry.name.slice(0, entry.name.length - ".teda".length))
    .sort();
}

/** Read one physical PCB (`design/pcb/<pcb_id>.teda`). Returns `null` when the file does not exist. */
export function loadPcb(root: string, pcbId: string): PcbSource | null {
  const file = join(root, LAYOUT.pcb, `${pcbId}.teda`);
  if (!existsSync(file)) return null;
  return { pcbId, file: relative(root, file), text: readFileSync(file, "utf8") };
}

/**
 * Read the project file (`project.toml`).
 *
 * The project file holds metadata such as name, version, variants, and library locks. It carries no
 * circuit. A project without the file is still a project — the diagnostics say so.
 */
export function loadProject(root: string): { ir?: Project; owner?: string; diagnostics: Diagnostic[] } {
  const file = "project.toml";
  const path = join(root, file);
  if (!existsSync(path)) {
    return {
      diagnostics: [
        {
          severity: "error",
          code: "ref.unknown-project",
          message: "the project has no project.toml",
          location: { file, line: 1, col: 1 },
        },
      ],
    };
  }
  const result = parseProjectToml(readFileSync(path, "utf8"), { file });
  return {
    ...(result.ir ? { ir: result.ir } : {}),
    ...(result.owner !== undefined ? { owner: result.owner } : {}),
    diagnostics: result.diagnostics,
  };
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

/** A reusable module drawing: `views/modules/<module_id>.module-view.teda` (ADR-0068 D1). */
export interface ModuleViewSource {
  /** The module the drawing belongs to; the id is the file name. */
  moduleId: string;
  /** Path relative to the project root. */
  file: string;
  /** The file's text. */
  text: string;
}

/** A reusable sheet template: `views/templates/<template_id>.sheet-template.teda` (ADR-0068 D1). */
export interface SheetTemplateSource {
  /** The template id; the id is the file name. */
  templateId: string;
  /** Path relative to the project root. */
  file: string;
  /** The file's text. */
  text: string;
}

/**
 * Read the project's reusable module drawings (`views/modules/<module_id>.module-view.teda`).
 *
 * A module drawing is the view layer's own description of one module: local bounds plus the rows
 * that draw it (ADR-0068 D2). The module id is the file name, like the electrical module's id, and
 * the drawing is advisory: it can show the module, it can never change it.
 */
export function loadModuleViews(root: string): ModuleViewSource[] {
  return readViewFiles(root, LAYOUT.moduleViews, VIEW_SUFFIXES.moduleView).map((entry) => ({
    moduleId: entry.id,
    file: entry.file,
    text: entry.text,
  }));
}

/**
 * Read the project's sheet templates (`views/templates/<template_id>.sheet-template.teda`).
 *
 * A template is static page furniture: a size and the rows that draw it (ADR-0068 D3). It adds
 * artwork to a page, never electrical facts.
 */
export function loadSheetTemplates(root: string): SheetTemplateSource[] {
  return readViewFiles(root, LAYOUT.sheetTemplates, VIEW_SUFFIXES.sheetTemplate).map((entry) => ({
    templateId: entry.id,
    file: entry.file,
    text: entry.text,
  }));
}

/** One file of a view artifact directory: the id is the file name without the type suffix. */
interface ViewFile {
  /** The id: the file name without the type suffix. */
  id: string;
  /** Path relative to the project root. */
  file: string;
  /** The file's text. */
  text: string;
}

/**
 * Read the files in one view artifact directory that carry the given type suffix.
 *
 * Project pages are direct children of `views/`; module drawings and templates live in their
 * dedicated subdirectories. The suffix distinguishes artifact kinds, and absent directories
 * produce an empty array.
 */
function readViewFiles(root: string, dir: string, suffix: string): ViewFile[] {
  const path = join(root, dir);
  if (!existsSync(path)) return [];
  const files: ViewFile[] = [];
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(suffix)) continue;
    const full = join(path, entry.name);
    files.push({
      id: entry.name.slice(0, entry.name.length - suffix.length),
      file: relative(root, full),
      text: readFileSync(full, "utf8"),
    });
  }
  return files.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** A procurement file: one PCB's selections, in one of the two positions (spec/procurement.md). */
export interface ProcurementSource {
  /** The role the position gives the file: the primary selections or the second sources. */
  role: ProcurementRole;
  /** The PCB id the file belongs to, taken from the file name. */
  board: string;
  /** Path relative to the project root. */
  file: string;
  /** The file's text. */
  text: string;
}

/**
 * Read a PCB's procurement file in one position.
 *
 * The primary is normative (the build is made of those parts) and the alternatives are advisory
 * (a second source does not change the build); the two are separate files, and each one produces
 * exactly one shard with exactly one classification (ADR-0006 decision 9).
 */
export function loadProcurement(root: string, board: string, role: ProcurementRole): ProcurementSource | null {
  const file = join(root, LAYOUT.procurement, role, `${board}.teda`);
  if (!existsSync(file)) return null;
  return { role, board, file: relative(root, file), text: readFileSync(file, "utf8") };
}

/** Every procurement file in the project: the primary ones first, then the alternatives. */
export function listProcurement(root: string): ProcurementSource[] {
  const out: ProcurementSource[] = [];
  for (const role of PROCUREMENT_ROLES) {
    const dir = join(root, LAYOUT.procurement, role);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).sort()) {
      if (!name.endsWith(".teda")) continue;
      const board = name.slice(0, name.length - ".teda".length);
      const file = join(dir, name);
      out.push({ role, board, file: relative(root, file), text: readFileSync(file, "utf8") });
    }
  }
  return out;
}

/** One tree under `external/libs/` that the build refuses to read (ADR-0034). */
export interface UnattachedLibrary {
  /** Directory name; it was the qualifier when trees were consumed. */
  name: string;
  /** Which asset groups it holds (`components`, `symbols`, `footprints`). */
  groups: string[];
}

const LIBRARY_GROUPS = ["components", "symbols", "footprints"] as const;

/**
 * Trees under `external/libs/` that hold asset groups.
 *
 * An empty directory, or one with notes only, is not reported: it is not a library. The name is
 * the directory name, because the file name was the anchor and the anchor is gone.
 */
function findUnattachedLibraries(root: string): UnattachedLibrary[] {
  const base = join(root, "external", "libs");
  if (!existsSync(base)) return [];
  const found: UnattachedLibrary[] = [];
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const groups = LIBRARY_GROUPS.filter((group) => existsSync(join(base, entry.name, group)));
    if (groups.length > 0) found.push({ name: entry.name, groups: [...groups] });
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}
