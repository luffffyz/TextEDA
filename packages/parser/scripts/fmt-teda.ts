#!/usr/bin/env bun
// `.teda` surface formatting: canonical form (per-description specs §8).
//
// Usage: bun run scripts/fmt-teda.ts [--check] [--stdout] [--library <name>] <file.teda|dir>...
//   Directory  process its *.teda files recursively.
//   Default    rewrite in place (skip files whose content is unchanged).
//   --check    check only; print files that are not canonical form and exit 1 (for CI / pre-commit).
//   --stdout   write to stdout, leaving files untouched.
//   --library  library name; defaults to the containing directory name.
//
// Dispatch on the file's type line: currently `footprint`, `symbol`, `schematic`, `pcb`, `view` and `procurement` are implemented; other description types are
// skipped for now (their fmt is not implemented yet); naming one explicitly is an error, to avoid "thought it was formatted".
//
// Pre-0.7 sources kept as inputs for the migration tool are skipped: the current language rejects
// them, so they are not formatting candidates. The migration tool owns them.
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { formatDiagnostic, type Diagnostic } from "@texteda/ir/diagnostics";
import {
  descriptionType,
  formatFootprint,
  formatPcb,
  formatProcurement,
  formatSchematic,
  formatSymbol,
  formatView,
} from "../src/index.ts";

interface FormatterOutput {
  ok: boolean;
  text?: string;
  diagnostics: Diagnostic[];
}

const argv = process.argv.slice(2);
const check = argv.includes("--check");
const toStdout = argv.includes("--stdout");
const libraryIdx = argv.indexOf("--library");
const libraryFlag = libraryIdx >= 0 ? argv[libraryIdx + 1] : undefined;
const targets = argv.filter(
  (arg, i) => !arg.startsWith("--") && !(libraryIdx >= 0 && i === libraryIdx + 1),
);

if (targets.length === 0) {
  console.error(
    "Usage: bun run scripts/fmt-teda.ts [--check] [--stdout] [--library <name>] <file.teda|dir>...",
  );
  process.exit(2);
}

interface Work {
  file: string;
  /** From directory expansion: types not yet implemented are skipped directly. */
  fromDirectory: boolean;
}

/** Pre-0.7 sources kept as migration inputs: the current language rejects them. */
const LEGACY_PATHS = ["tests/migration/"];

function isLegacy(file: string): boolean {
  const path = file.split("\\").join("/");
  return LEGACY_PATHS.some((legacy) => path.includes(legacy));
}

/** Recursively expand a directory (only .teda), keeping byte order for stable output. */
function expand(target: string): Work[] {
  if (!statSync(target).isDirectory()) return [{ file: target, fromDirectory: false }];
  return readdirSync(target, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".teda"))
    .map((entry) => ({ file: join(entry.parentPath, entry.name), fromDirectory: true }))
    .filter((work) => !isLegacy(work.file))
    .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
}

const files: Work[] = [];
let unreadable = false;
for (const target of targets) {
  try {
    files.push(...expand(target));
  } catch (error) {
    console.error(`${target}: unreadable (${(error as Error).message})`);
    unreadable = true;
  }
}
if (files.length === 0 && unreadable) process.exit(1);

let failed = false;
for (const { file, fromDirectory } of files) {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    console.error(`${file}: unreadable (${(error as Error).message})`);
    failed = true;
    continue;
  }
  const type = descriptionType(text);
  const library = libraryFlag ?? basename(dirname(file));
  let result: FormatterOutput;
  if (type === "footprint") {
    result = formatFootprint(text, { file, library });
  } else if (type === "symbol") {
    result = formatSymbol(text, { file, library });
  } else if (type === "schematic") {
    result = formatSchematic(text, { file });
  } else if (type === "module") {
    result = formatSchematic(text, { file, kind: "module" });
  } else if (type === "page") {
    // The `page` description type was removed in language 0.7 (ADR-0025): say so instead of
    // silently skipping a leftover file.
    console.error(
      `${file}: the \`page\` description type was removed in language 0.7: a board has one schematic file`,
    );
    failed = true;
    continue;
  } else if (type === "pcb") {
    result = formatPcb(text, { file });
  } else if (type === "view") {
    result = formatView(text, { file });
  } else if (type === "procurement") {
    result = formatProcurement(text, { file });
  } else if (fromDirectory) {
    continue;
  } else {
    console.error(`${file}: formatting this description type is not implemented yet (${type ?? "unknown type"})`);
    failed = true;
    continue;
  }

  for (const diagnostic of result.diagnostics) console.error(formatDiagnostic(diagnostic));
  if (!result.ok || result.text === undefined) {
    failed = true;
    continue;
  }
  if (toStdout) {
    process.stdout.write(result.text);
    continue;
  }
  if (result.text === text) continue;
  if (check) {
    console.error(`${file}: not canonical form (run fmt:teda to fix)`);
    failed = true;
    continue;
  }
  writeFileSync(file, result.text);
}

process.exit(failed ? 1 : 0);
