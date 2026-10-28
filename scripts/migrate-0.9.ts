#!/usr/bin/env bun
// Migration to 0.9.1 (ADR-0101): one version number for the whole language.
//
// Usage:
//   bun run migrate:0.9 <project dir>
//
// The per-description-type version lines are gone. The language has one number, and every `.teda`
// file declares the language generation it was written against (ADR-0101 D2); `project.toml`'s
// `format` is that number.
//
// What it does, and nothing else:
//   1. rewrites the `version` line of every `.teda` file the project owns to the current language
//      version;
//   2. rewrites the `format` key of `project.toml` to the same number.
//
// It works on the text, not on the IR: a file from before the merge may no longer parse with the
// current parser (the old per-type ceilings refused a `symbol` file above `0.5`), so it reads and
// writes lines and never asks the parser what a file means.
//
// What it refuses to do: decide anything. It renames no file, moves nothing, and picks no name —
// a renumbering is a renumbering, and the rest of the migration is the author's decision.
//
// The target number is the language version this repository implements, read from the parser, so
// the script cannot drift from the version the tool accepts.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { formatVersion, SUPPORTED_LANGUAGE } from "@texteda/parser";

/** The one number every file carries after the merge (ADR-0101 D2). */
const TARGET = formatVersion(SUPPORTED_LANGUAGE);

/**
 * Directories a project does not own: build output and vendored libraries. Their files are not the
 * project's own, and a vendored library carries its own version line.
 */
const SKIP_DIRS: Record<string, true> = {
  dist: true,
  external: true,
};

/** One file the migration did not touch, and why. */
interface Skipped {
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

/** The index of a file's header line: the first line that is neither blank nor a comment. */
function headerIndex(lines: readonly string[]): number {
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i]!.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    return i;
  }
  return -1;
}

/**
 * The rewritten file, and whether anything changed.
 *
 * The version line is the header: the language puts it first, before the type line, so the header
 * line is the only place a version can be. A file whose header is not a version line is not a
 * description file this migration understands, and it is left alone and reported.
 */
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
 * `format` belongs to the `[project]` table, so only a key inside that table is touched: a
 * `format` key anywhere else belongs to something else and is not this script's business.
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
  const match = /^version\s+(\S+)/.exec(lines[at]!.trim());
  return match?.[1] ?? "";
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

  // Every file is read and rewritten before anything is written, so a crash cannot leave half a file
  // behind. A file this script does not understand is reported and left alone; the exit code says
  // so, and re-running the script picks up where it left off.
  const writes: { path: string; text: string; note: string }[] = [];
  const skipped: Skipped[] = [];

  const projectFile = join(projectRoot, "project.toml");
  const projectText = readFileSync(projectFile, "utf8");
  const projectResult = rewriteFormat(projectText);
  if (projectResult.changed) {
    const match = /^(\s*format\s*=\s*)"([^"]*)"/m.exec(projectText);
    writes.push({
      path: projectFile,
      text: projectResult.text,
      note: `format "${match?.[2] ?? ""}" -> "${TARGET}"`,
    });
  } else if (projectResult.reason !== undefined) {
    skipped.push({ path: "project.toml", reason: projectResult.reason });
  }

  for (const file of tedaFiles(projectRoot)) {
    const text = readFileSync(file, "utf8");
    const result = rewriteVersion(text);
    if (result.changed) {
      writes.push({
        path: file,
        text: result.text,
        note: `version ${statedVersion(text)} -> ${TARGET}`,
      });
    } else if (result.reason !== undefined) {
      skipped.push({ path: relative(projectRoot, file), reason: result.reason });
    }
  }

  for (const write of writes) {
    writeFileSync(write.path, write.text);
    console.log(`+ ${relative(projectRoot, write.path)}: ${write.note}`);
  }
  for (const skip of skipped) {
    console.log(`x ${skip.path}: ${skip.reason} (left alone)`);
  }

  if (writes.length === 0 && skipped.length === 0) {
    console.log(`Nothing to change: every file already carries version ${TARGET}.`);
    return 0;
  }
  console.log(
    `\nMigrated ${writes.length} file(s) to language ${TARGET}` +
      (skipped.length > 0 ? `; ${skipped.length} file(s) were left alone.` : "."),
  );
  return skipped.length > 0 ? 1 : 0;
}

process.exit(main());
