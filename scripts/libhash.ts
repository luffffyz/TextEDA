#!/usr/bin/env bun
/**
 * Compute the content hash of the project's self-built libraries (ADR-0010 decision 2 plus the "two roots" supplement).
 *
 * Specification: SHA-256( all files under all library roots, sorted by **project-relative path** and concatenated
 * line by line as "<path>:<file_sha256>\n" ).
 * `path` is the root path given on the command line + the file's relative path, separated by "/", without a "./" prefix
 * and without a trailing slash; sorting is by byte order (LC_ALL=C).
 *
 * Usage: bun run lib:hash <library dir>...      # e.g. assets/symbols/project assets/footprints/project
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

function walk(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full, base));
    else out.push(relative(base, full).split(sep).join("/"));
  }
  return out;
}

/** Normalize a root path from the command line: strip "./" prefixes and trailing slashes, unify backslashes into "/". */
function normalizeRoot(root: string): string {
  return root.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

const roots = process.argv.slice(2).map(normalizeRoot).filter((r) => r.length > 0);
if (roots.length === 0) {
  console.error("usage: bun run lib:hash <library dir>...");
  process.exit(2);
}

const entries: string[] = [];
for (const root of roots) {
  let files: string[];
  try {
    files = walk(root);
  } catch (error) {
    console.error(`${root}: cannot read (${(error as Error).message})`);
    process.exit(1);
  }
  if (files.length === 0) {
    console.error(`directory is empty: ${root}`);
    process.exit(1);
  }
  for (const rel of files) entries.push(`${root}/${rel}`);
}

entries.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
const hash = createHash("sha256");
for (const path of entries) {
  const fileHash = createHash("sha256").update(readFileSync(path)).digest("hex");
  hash.update(`${path}:${fileHash}\n`);
}

console.log(hash.digest("hex"));
console.error(`${entries.length} files, ${roots.length} roots`);
