#!/usr/bin/env bun
// Print-page house style: every coordinate a page stores is anchored on the 0.5 mm drawing
// lattice (ADR-0059 D1).
//
// Usage:
//   bun run view:verify [project dir]        required section, **zero external dependencies**
//
// What it checks, per print page under `views/<board_id>/<page_id>.view.teda`:
//   1. the page parses;
//   2. every coordinate it stores — placement origin, field anchor, wire bend, label, port, note —
//      is a lattice point in both axes.
//
// Why a gate and not a diagnostic code: a page off the lattice is still a readable page, and the
// failure it causes (a diagonal segment, a wire that cannot reach its pin) is already reported by
// `view.wire-diagonal` / `view.wire-crosses-pin`. A second code for the same symptom would train
// an agent to silence codes instead of fixing geometry (ADR-0059 D2).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseView } from "@texteda/parser";
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
  const out: string[] = [];
  if (!statSync(dir).isDirectory()) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listPages(full));
    } else if (entry.endsWith(".view.teda")) {
      out.push(full);
    }
  }
  return out.sort();
}

if (!statSync(viewsRoot).isDirectory()) {
  console.error(`✗ ${viewsRoot} does not exist — is ${projectRoot} a TextEDA project?`);
  process.exit(1);
}

const pages = listPages(viewsRoot);
if (pages.length === 0) {
  console.error(`✗ no print pages under ${viewsRoot}`);
  process.exit(1);
}

let checked = 0;
for (const page of pages) {
  const board = page.split("/").slice(-2, -1)[0] ?? "";
  const parsed = parseView(readFileSync(page, "utf8"), { file: page, board });
  if (!parsed.ok || !parsed.ir) {
    fail(`${page}: the page does not parse`);
    continue;
  }
  checked += 1;
  for (const problem of viewHouseStyleProblems(page, parsed.ir)) fail(problem);
}

if (problems.length > 0) {
  console.error(`view:verify failed — ${problems.length} problem(s)`);
  process.exit(1);
}
console.log(`view:verify ok — ${checked} print page(s) on the 0.5 mm lattice`);
