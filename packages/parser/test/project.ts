// Shared test helper: the reference project's component table.
//
// The component id is the file name (AGENTS.md §4.5); the facts come from the component index,
// which is all the schematic parser needs to resolve pins and parameter columns.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readComponentIndex } from "../src/component-index.ts";
import type { ComponentFactsLite, ComponentResolver } from "../src/schematic.ts";

const projectDir = "examples/reference-project";

/** The component id of a component file: the file name without `.teda`. */
function fileToId(file: string): string {
  const base = file.slice(file.lastIndexOf("/") + 1);
  return base.slice(0, base.length - ".teda".length);
}

/** Load the reference project's components into a resolver. */
export function loadResolver(): ComponentResolver {
  const dir = join(projectDir, "components");
  const files: string[] = [];
  const walk = (path: string): void => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const full = join(path, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".teda")) files.push(full);
    }
  };
  walk(dir);
  const table = new Map<string, ComponentFactsLite>();
  for (const file of files) {
    const result = readComponentIndex(readFileSync(file, "utf8"));
    if (!result.ok || !result.facts) continue;
    table.set(fileToId(file), result.facts);
  }
  return { resolve: (id) => table.get(id) };
}
