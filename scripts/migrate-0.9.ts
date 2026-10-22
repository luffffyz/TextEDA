#!/usr/bin/env bun
// Migration 0.1 -> 0.1.1 for the `component` description type (ADR-0027): every device file says
// what it is — a part (one specific device, bought by part number) or a family (one device family,
// whose value and ratings live in the instance row).
//
// Usage:
//   bun run migrate:0.9 <project dir>
//
// The script works on the text: it reads the old shape with its own small reader and writes the new
// shape, which the current parser then checks.
//
// What it does, per device file:
//   1. adds `kind part` to every file that names a manufacturer part number;
//   2. adds `kind family` to every file that does not, and moves it to the families directory;
//   3. bumps the version line to 0.1.1.
//
// What it refuses to do: choose names or facts. A family needs its `construction` (the technology)
// and its `polarized` fact, and a family id must not carry a value — all three are authoring
// decisions, so the script reports the files that still need them and writes nothing else.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const projectDir = process.argv[2];
if (!projectDir) {
  console.error("Usage: bun run migrate:0.9 <project dir>");
  process.exit(2);
}

function tedaFiles(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tedaFiles(full));
    else if (entry.name.endsWith(".teda")) out.push(full);
  }
  return out.sort();
}

/** The first line that is a scalar (not a comment, not a section header, not the header itself). */
function firstScalarLine(lines: string[]): number {
  for (let i = 2; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    if (/^[a-z]+\s/.test(line)) return i; // a section header is a single word
    return i;
  }
  return -1;
}

const root = projectDir;
// The device directory: the current layout, or the pre-3.1 flat one. The families directory is its
// sibling, so a legacy project keeps its flat shape.
const sourceDir = existsSync(join(root, "assets/components"))
  ? join(root, "assets/components")
  : join(root, "components");
const targetDir = join(dirname(sourceDir), "families");
const files = tedaFiles(sourceDir);

if (files.length === 0) {
  console.error(`no device files found under ${sourceDir}`);
  process.exit(1);
}

/** Files that still need an authoring decision. */
const needsAuthor: string[] = [];
let parts = 0;
let families = 0;

for (const file of files) {
  const original = readFileSync(file, "utf8");
  if (/^kind\s+/m.test(original)) continue; // already migrated
  const lines = original.split("\n");
  const isPart = /^mpn\s+\S+/m.test(original);
  const at = firstScalarLine(lines);
  if (at < 0) {
    console.error(`${file}: no scalar lines found; left untouched`);
    continue;
  }
  // The version line: 0.1 -> 0.1.1 (the `component` type's own line).
  lines[0] = lines[0]!.replace(/^version\s+0\.1(\.1)?$/, "version 0.1.1");
  lines.splice(at, 0, isPart ? "kind part" : "kind family");
  const updated = lines.join("\n");
  writeFileSync(file, updated);
  if (isPart) {
    parts += 1;
    continue;
  }
  families += 1;
  mkdirSync(targetDir, { recursive: true });
  const moved = join(targetDir, basename(file));
  if (existsSync(moved)) {
    console.error(`${moved}: already exists; the family was left in place`);
    needsAuthor.push(file);
    continue;
  }
  renameSync(file, moved);
  needsAuthor.push(moved);
}

console.log(`migrated ${parts} part(s) and ${families} family(ies) to version 0.1.1`);
if (needsAuthor.length > 0) {
  console.log("");
  console.log("These files still need an authoring decision (ADR-0027):");
  for (const file of needsAuthor) {
    console.log(`  ${file}`);
  }
  console.log("");
  console.log("  - add `construction <technology>` and `polarized yes|no` to each family;");
  console.log("  - rename a family whose id carries a value (the id names the family, not a value);");
  console.log("  - update the `instances` rows that refer to a renamed family.");
}
