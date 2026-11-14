#!/usr/bin/env bun
// Print-page house style: the coordinates that have to reach each other are anchored on the
// 0.5 mm drawing lattice (ADR-0074 D1).
//
// Usage:
//   bun run view:verify [project dir]        required section, **zero external dependencies**
//
// What it checks, per project print page directly under `views/`:
//   1. the page parses;
//   2. the coordinates that must reach each other — a placement origin, a wire bend, a port, a
//      junction — are lattice points in both axes.
//
// The rest of the page is drawing, and drawing is free (ADR-0074 D2): a label may sit anywhere
// along the wire it names, a note may sit anywhere on the sheet.
//
// Why a gate and not a diagnostic code: a page off the lattice is still a readable page, and the
// failure it causes (a diagonal segment, a wire that cannot reach its pin) is already reported by
// `view.wire-diagonal` / `view.wire-crosses-pin`. A second code for the same symptom would train
// an agent to silence codes instead of fixing geometry (ADR-0059 D2).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseModuleView, parseView } from "@texteda/parser";
import type { SchematicView } from "@texteda/ir/schematic-view";
import { viewHouseStyleProblems } from "./lib/view-style.ts";

const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const projectRoot = positional[0] ?? "examples/reference-project";
const viewsRoot = join(projectRoot, "views");

const problems: string[] = [];
const fail = (message: string): void => {
  problems.push(message);
  console.error(`  ✗ ${message}`);
};

function listPages(dir: string): string[] {
  return readdirSync(dir)
    .filter((entry) => entry.endsWith(".view.teda") && statSync(join(dir, entry)).isFile())
    .map((entry) => join(dir, entry))
    .sort();
}

function listModuleViews(dir: string): string[] {
  const modules = join(dir, "modules");
  if (!statSync(modules).isDirectory()) return [];
  return readdirSync(modules)
    .filter((entry) => entry.endsWith(".module-view.teda") && statSync(join(modules, entry)).isFile())
    .map((entry) => join(modules, entry))
    .sort();
}

if (!statSync(viewsRoot).isDirectory()) {
  console.error(`✗ ${viewsRoot} does not exist — is ${projectRoot} a TextEDA project?`);
  process.exit(1);
}

const pages = listPages(viewsRoot);
const moduleViews = listModuleViews(viewsRoot);
if (pages.length === 0 && moduleViews.length === 0) {
  console.error(`✗ no print pages or module drawings under ${viewsRoot}`);
  process.exit(1);
}

let checked = 0;
for (const page of pages) {
  const parsed = parseView(readFileSync(page, "utf8"), { file: page });
  if (!parsed.ok || !parsed.ir) {
    fail(`${page}: the page does not parse`);
    continue;
  }
  checked += 1;
  for (const problem of viewHouseStyleProblems(page, parsed.ir)) fail(problem);
}

for (const drawing of moduleViews) {
  const parsed = parseModuleView(readFileSync(drawing, "utf8"), { file: drawing });
  if (!parsed.ok || !parsed.ir) {
    fail(`${drawing}: the module drawing does not parse`);
    continue;
  }
  checked += 1;
  for (const problem of viewHouseStyleProblems(drawing, parsed.ir as unknown as SchematicView)) fail(problem);
}

if (problems.length > 0) {
  console.error(`view:verify failed — ${problems.length} problem(s)`);
  process.exit(1);
}
console.log(`view:verify ok — ${pages.length} print page(s) and ${moduleViews.length} module drawing(s), wiring on the 0.5 mm lattice`);
