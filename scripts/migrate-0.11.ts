#!/usr/bin/env bun
// Migration to 0.11 (ADR-0065): a coordinate tuple is one bracketed cell.
//
// Usage:
//   bun run migrate:0.11 <project dir>
//
// Every geometric value — a point, a size, an offset, a rotation triple — is written as one cell
// `[a,b]`, with no whitespace inside. The old surface wrote a point as two cells in a table and as
// `a,b` inside a `key=value` cell; this migration folds the table form into brackets and brackets
// the attribute form.
//
// What it does, and nothing else:
//   1. folds coordinate columns per section, per description type, exactly as ADR-0065's migration
//      table lists them;
//   2. brackets the tuple value of a key that carries one (`at=`, `size=`, `offset=`, `scale=`,
//      `rot=`) and the single geometry cell of a `body`/`graphics` row;
//   3. rewrites the `version` line of `view`, `pcb`, `symbol`, and `footprint` files to the current
//      language version; the other description types keep their accepted older version lines;
//   4. rewrites the `format` key of `project.toml` to the same number.
//
// It works on the text, not on the IR: it reads and writes lines and never asks the parser what a
// file means. It decides nothing — a tuple's arity was already fixed by the column that consumed
// it, so the fold is complete. A row whose cell count does not match its column's arity was already
// invalid; the script leaves it alone and reports it, and the parser says why.
//
// Idempotent: an already-bracketed tuple is left as it is, so re-running the script is safe.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { formatVersion, SUPPORTED_LANGUAGE } from "@texteda/parser";
import { descriptionType, foldFile, GEOMETRIC_DESCRIPTION_TYPES, headerIndex } from "./lib/tuple-fold.ts";

/** The target number for geometric files and `project.toml` after this migration (ADR-0065 D5). */
const TARGET = formatVersion(SUPPORTED_LANGUAGE);

/**
 * Directories a project does not own: build output and vendored libraries. Their files are not the
 * project's own, and a vendored copy carries its own version line.
 */
const SKIP_DIRS: Record<string, true> = { dist: true, external: true };

/** A file the migration could not fully fold, and where. */
interface Problem {
  readonly path: string;
  readonly reason: string;
}

/** Every `.teda` file under a directory, in a stable order. */
function tedaFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS[entry.name] === true) continue;
        walk(join(dir, entry.name));
      } else if (entry.name.endsWith(".teda")) {
        out.push(join(dir, entry.name));
      }
    }
  };
  walk(root);
  return out;
}

/** Rewrite the `version` line to the target number. */
function rewriteVersion(text: string): { text: string; changed: boolean; reason?: string } {
  const lines = text.split("\n");
  const at = headerIndex(lines);
  if (at < 0) return { text, changed: false, reason: "the file has no header line" };
  const line = lines[at]!;
  if (!/^version\s+\S+/.test(line.trim())) {
    return { text, changed: false, reason: `the header is not a version line: ${line.trim()}` };
  }
  const rewritten = line.replace(/^(\s*version\s+)\S+/, `$1${TARGET}`);
  if (rewritten === line) return { text, changed: false };
  lines[at] = rewritten;
  return { text: lines.join("\n"), changed: true };
}

/**
 * The rewritten project file, and whether anything changed.
 *
 * `format` belongs to the `[project]` table, so only a key inside that table is touched.
 */
function rewriteFormat(text: string): { text: string; changed: boolean; reason?: string } {
  const lines = text.split("\n");
  let inProject = false;
  let sawProject = false;
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i]!.trim();
    if (trimmed.startsWith("[")) {
      inProject = trimmed === "[project]";
      if (inProject) sawProject = true;
      continue;
    }
    if (!inProject) continue;
    const match = /^(\s*format\s*=\s*)"([^"]*)"/.exec(lines[i]!);
    if (match === null) continue;
    if (match[2] === TARGET) return { text, changed: false };
    lines[i] = `${match[1]}"${TARGET}"`;
    return { text: lines.join("\n"), changed: true };
  }
  return {
    text,
    changed: false,
    reason: sawProject ? "the [project] table has no `format` key" : "there is no [project] table",
  };
}

/** The old version a file stated, for the report. */
function statedVersion(text: string): string {
  const lines = text.split("\n");
  const at = headerIndex(lines);
  if (at < 0) return "";
  return /^version\s+(\S+)/.exec(lines[at]!.trim())?.[1] ?? "";
}

function main(): number {
  const projectRoot = process.argv[2] ?? "examples/reference-project";
  if (!existsSync(projectRoot)) {
    console.error(`No such project directory: ${projectRoot}`);
    return 2;
  }
  if (!existsSync(join(projectRoot, "project.toml"))) {
    console.error(`No project.toml in ${projectRoot}: this is not a TextEDA project`);
    return 2;
  }

  // Non-geometric types are out of scope and left untouched. Malformed geometric rows are reported
  // and left unchanged; valid rows in the same file can still be migrated.
  const writes: { path: string; text: string; note: string }[] = [];
  const problems: Problem[] = [];

  const projectFile = join(projectRoot, "project.toml");
  const projectText = readFileSync(projectFile, "utf8");
  const projectResult = rewriteFormat(projectText);
  if (projectResult.changed) {
    writes.push({ path: projectFile, text: projectResult.text, note: `format -> "${TARGET}"` });
  } else if (projectResult.reason !== undefined) {
    problems.push({ path: "project.toml", reason: projectResult.reason });
  }

  for (const file of tedaFiles(projectRoot)) {
    const text = readFileSync(file, "utf8");
    const type = descriptionType(text.split("\n"));
    if (!GEOMETRIC_DESCRIPTION_TYPES.has(type)) continue;
    const folded = foldFile(text, type);
    const versioned = rewriteVersion(folded.text);
    for (const problem of folded.problems) problems.push({ path: relative(projectRoot, file), reason: problem });
    const notes: string[] = [];
    if (folded.text !== text) notes.push("coordinates folded into one cell");
    if (versioned.changed) notes.push(`version ${statedVersion(text)} -> ${TARGET}`);
    if (notes.length > 0) writes.push({ path: file, text: versioned.text, note: notes.join("; ") });
    else if (versioned.reason !== undefined) problems.push({ path: relative(projectRoot, file), reason: versioned.reason });
  }

  for (const write of writes) {
    writeFileSync(write.path, write.text);
    console.log(`+ ${relative(projectRoot, write.path)}: ${write.note}`);
  }
  for (const problem of problems) {
    console.log(`x ${problem.path}: ${problem.reason} (left alone)`);
  }

  if (writes.length === 0 && problems.length === 0) {
    console.log(`Nothing to change: project format and geometric files already use language ${TARGET}.`);
    return 0;
  }
  console.log(
    `Updated ${writes.length} file(s) for language ${TARGET}` +
      (problems.length > 0 ? `; ${problems.length} problem(s) were left alone.` : "."),
  );
  return problems.length > 0 ? 1 : 0;
}

process.exit(main());
