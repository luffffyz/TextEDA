// Project library reading: the "compile" half shared by the preview command and the smoke scripts.
//
// Three things: find files, compile (.teda → IR), read component facts.
// Rendering lives in @texteda/renderer, exporting in @texteda/exporter — this module only handles "reading in".
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import {
  parseFootprint,
  parseSymbol,
  readComponentFacts,
  readComponentIndex,
  type ComponentFacts,
  type ComponentFactsLite,
  type ComponentResolver,
  type Diagnostic,
  type ModuleSource,
} from "@texteda/parser";
import type { Footprint } from "@texteda/ir/footprint";
import type { Symbol } from "@texteda/ir/symbol";

/** Recursively list `.teda` source files under a directory (sorted by path for a stable order). */
export function tedaFiles(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries.sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tedaFiles(full));
    else if (entry.endsWith(".teda")) out.push(full);
  }
  return out;
}

export type Loaded<T> =
  | { ok: true; value: T; diagnostics: Diagnostic[] }
  | { ok: false; diagnostics: Diagnostic[] };

/** Compile a symbol source file. */
export function loadSymbol(file: string, library: string): Loaded<Symbol> {
  const parsed = parseSymbol(readFileSync(file, "utf8"), { file, library });
  if (!parsed.ok || !parsed.ir) return { ok: false, diagnostics: parsed.diagnostics };
  return { ok: true, value: parsed.ir, diagnostics: parsed.diagnostics };
}

/** Compile a footprint source file. */
export function loadFootprint(file: string, library: string): Loaded<Footprint> {
  const parsed = parseFootprint(readFileSync(file, "utf8"), { file, library });
  if (!parsed.ok || !parsed.ir) return { ok: false, diagnostics: parsed.diagnostics };
  return { ok: true, value: parsed.ir, diagnostics: parsed.diagnostics };
}

/** Read the facts of a component description (the single owner of pin names and electrical types, ADR-0012). */
export function loadComponent(file: string): Loaded<ComponentFacts> {
  const facts = readComponentFacts(readFileSync(file, "utf8"), { file });
  if (!facts.ok || !facts.facts) return { ok: false, diagnostics: facts.diagnostics };
  return { ok: true, value: facts.facts, diagnostics: facts.diagnostics };
}

/**
 * A resolver over the project's components: the id is the file name (AGENTS.md §4.5).
 * Reading the component index is enough here: the preview needs the facts, not the file.
 */
export function loadComponentResolver(projectRoot: string): ComponentResolver {
  const table = new Map<string, ComponentFactsLite>();
  for (const file of tedaFiles(join(projectRoot, "components"))) {
    const result = readComponentIndex(readFileSync(file, "utf8"));
    if (!result.ok || !result.facts) continue;
    table.set(basename(file, ".teda"), result.facts);
  }
  return { resolve: (id) => table.get(id) };
}

/**
 * The project's modules (`modules/<module_id>.teda`). The module id is the file name, like the
 * component id (spec/module.md §1).
 */
export function loadModuleSources(projectRoot: string): ModuleSource[] {
  return tedaFiles(join(projectRoot, "modules")).map((file) => ({
    moduleId: basename(file, ".teda"),
    file,
    text: readFileSync(file, "utf8"),
  }));
}

/** The component referencing a given symbol (a symbol can be reused by multiple components; take the first). */
export function componentUsingSymbol(
  projectRoot: string,
  ref: string,
): { file: string; facts: ComponentFacts } | null {
  for (const file of tedaFiles(join(projectRoot, "components"))) {
    const text = readFileSync(file, "utf8");
    const m = /^symbol\s+(\S+)$/m.exec(text);
    if (!m || m[1] !== ref) continue;
    const loaded = loadComponent(file);
    if (!loaded.ok) continue;
    return { file, facts: loaded.value };
  }
  return null;
}
