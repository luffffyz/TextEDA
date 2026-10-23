// Shared test helper: the reference project's device table.
//
// The device id is the file name (AGENTS.md §4.5); the facts come from the component parser,
// which is all the schematic parser needs to resolve pins and parameter columns. The parts and
// the generics live in one tree, `assets/components/` (ADR-0027, ADR-0037); they share one id
// namespace.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseComponent } from "../src/component.ts";
import type { ComponentFactsLite, ComponentResolver } from "../src/schematic.ts";

const projectDir = "examples/reference-project";

/** The device id of a device file: the file name without `.teda`. */
function fileToId(file: string): string {
  const base = file.slice(file.lastIndexOf("/") + 1);
  return base.slice(0, base.length - ".teda".length);
}

/** Load the reference project's devices into a resolver. */
export function loadResolver(): ComponentResolver {
  const files: string[] = [];
  const walk = (path: string): void => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const full = join(path, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".teda")) files.push(full);
    }
  };
  walk(join(projectDir, "assets/components"));
  const table = new Map<string, ComponentFactsLite>();
  for (const file of files) {
    const result = parseComponent(readFileSync(file, "utf8"), { file });
    if (!result.ok || !result.component) continue;
    table.set(fileToId(file), { params: result.component.params, pins: result.component.pins });
  }
  return { resolve: (id) => table.get(id) };
}
