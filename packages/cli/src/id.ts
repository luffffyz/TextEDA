// `texteda id`: generate project-scoped instance UIDs (ADR-0051).
//
// This command only generates and prints; it never edits a source file. Assigning a UID to a row
// is an authoring action, and a generator without a place to insert it would be a second editor.
// Parsing still checks the result: a duplicate is an error at every entry point.
//
// Usage:
//   texteda id <project dir> [--count N] [--json]
//
// The generator avoids every UID it can see in the project's board and module sources, including
// module-local UIDs. A source file that cannot be parsed is an error: a hidden UID must not become
// a collision later.
import { randomInt } from "node:crypto";
import { existsSync } from "node:fs";
import { parseSchematicDocument } from "@texteda/parser";
import type { Diagnostic } from "@texteda/ir/diagnostics";
import { hintFor } from "@texteda/ir/diagnostics";
import { listBoards, loadBoard, loadModules } from "./project.ts";

/** The Crockford Base32 alphabet used by an instance UID (ADR-0051). */
export const CROCKFORD_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

/** Fixed suffix length of an instance UID (ADR-0051). */
export const UID_SUFFIX_LENGTH = 6;

/** Every UID a project declares, plus parse diagnostics that make generation unsafe. */
export interface ProjectUidSources {
  uids: Set<string>;
  diagnostics: Diagnostic[];
}

/**
 * Read every board and module source and collect the UIDs they declare.
 *
 * A UID is project-scoped. Module-local UIDs are collected as bare tokens too: the flattened path
 * is the module-instance token plus this token, so avoiding every existing token is enough.
 */
export function collectProjectUidSources(root: string): ProjectUidSources {
  const uids = new Set<string>();
  const diagnostics: Diagnostic[] = [];

  const collect = (parsed: ReturnType<typeof parseSchematicDocument>): void => {
    diagnostics.push(...parsed.diagnostics);
    if (!parsed.doc) return;
    for (const instance of parsed.doc.instances) {
      if (instance.uid !== undefined) uids.add(instance.uid);
    }
    for (const module of parsed.doc.modules) {
      if (module.uid !== undefined) uids.add(module.uid);
    }
  };

  for (const board of listBoards(root)) {
    const loaded = loadBoard(root, board);
    if (loaded === null) continue;
    collect(parseSchematicDocument(loaded.text, { file: loaded.file, kind: "schematic" }));
  }
  for (const source of loadModules(root)) {
    collect(parseSchematicDocument(source.text, { file: source.file, kind: "module" }));
  }

  return { uids, diagnostics };
}

/** Draw one UID with a caller-supplied source of random alphabet indexes (tests need determinism). */
function drawUid(existing: ReadonlySet<string>, randomIndex: () => number): string | undefined {
  let uid = "ID";
  for (let i = 0; i < UID_SUFFIX_LENGTH; i++) {
    const index = randomIndex();
    if (!Number.isInteger(index) || index < 0 || index >= CROCKFORD_ALPHABET.length) {
      throw new Error(`random index out of range: ${index}`);
    }
    uid += CROCKFORD_ALPHABET[index];
  }
  return existing.has(uid) ? undefined : uid;
}

/**
 * Generate `count` unused project-scoped UIDs. Collisions are retried; the existing set is never
 * mutated, so a failed generation leaves the caller's project unchanged.
 *
 * `randomIndex` returns an integer in `[0, CROCKFORD_ALPHABET.length)`. The attempt cap makes a
 * broken random source fail instead of spinning forever.
 */
export function generateInstanceUids(
  existing: Iterable<string>,
  count: number,
  randomIndex: () => number = () => randomInt(0, CROCKFORD_ALPHABET.length),
): string[] {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`count must be a positive integer: ${count}`);
  }
  const taken = new Set(existing);
  const generated: string[] = [];
  const maxAttempts = count * 1000;
  let attempts = 0;
  while (generated.length < count) {
    if (attempts++ >= maxAttempts) {
      throw new Error(`could not allocate ${count} unused UIDs after ${maxAttempts} attempts`);
    }
    const uid = drawUid(taken, randomIndex);
    if (uid === undefined) continue;
    taken.add(uid);
    generated.push(uid);
  }
  return generated;
}

export interface IdOptions {
  /** Project root directory. */
  root: string;
  /** Number of UIDs to generate. */
  count: number;
  /** Print the machine payload instead of one UID per line. */
  json: boolean;
}

/** Generate UIDs and print them. Returns the process exit code: 0 success, 1 unusable project. */
export function runId(options: IdOptions): number {
  if (!existsSync(options.root)) {
    console.error(`project directory not found: ${options.root}`);
    return 1;
  }
  const { uids, diagnostics } = collectProjectUidSources(options.root);
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  if (errors.length > 0) {
    for (const diagnostic of errors) {
      const where = diagnostic.location
        ? `${diagnostic.location.file}:${diagnostic.location.line}:${diagnostic.location.col}: `
        : "";
      console.error(`${where}${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`);
      const hint = diagnostic.hint ?? hintFor(diagnostic.code);
      if (hint) console.error(`    How to fix: ${hint}`);
    }
    console.error(`No IDs generated: ${errors.length} source errors (run texteda check to see the full project)`);
    return 1;
  }

  let ids: string[];
  try {
    ids = generateInstanceUids(uids, options.count);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  if (options.json) {
    console.log(JSON.stringify({ uids: ids }, null, 2));
  } else {
    process.stdout.write(`${ids.join("\n")}\n`);
  }
  return 0;
}
