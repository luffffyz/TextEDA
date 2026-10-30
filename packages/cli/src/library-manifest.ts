// `library.toml`: what a library says about itself, including which of its facts a human checked.
//
// Reviewing a library is one act, not one act per file: the reviewer compares the files with their
// sources and says which of them they looked at. That statement belongs beside the library. The
// record is read at **import time only** (`lib import` turns it into the per-file claim a project can
// check); nothing at build time reads it, so a copy that is edited later cannot hide behind it
// (ADR-0034 D8).
//
// There is no tree-level revision: a library whose files change independently has no single
// revision that is true, and every consumer of one would misread the files a release did not touch
// (ADR-0034 decision 7). Each item names the revision it was checked at, so `by` / `on` are written
// once per act rather than once per revision.
//
// The file is optional: a library that makes no claim has no manifest. The TOML subset is the one
// `project.toml` uses (`packages/parser/src/toml.ts`) — tables, arrays of tables, strings.
import { parseToml, subTable, type TomlTable } from "@texteda/parser";
import {
  checkDuplicates,
  itemsOf,
  TRUST_ROW_KEYS,
  type TrustItem,
  type TrustRow,
} from "./trust-record.ts";

/** One review: who checked which files, at which revisions, on which day. */
export type TrustEntry = TrustRow;

/** The manifest of a library tree (`library.toml`). */
export interface LibraryManifest {
  /** The library's name, as a reader would ask for it. */
  name?: string;
  /**
   * Where the tree itself lives (its repository). For a library the organisation owns this answers
   * "whose tree is this" — the question a reader of a copy actually has (ADR-0034 decision 7).
   */
  source?: string;
  trust: readonly TrustEntry[];
}

export interface LibraryManifestResult {
  manifest?: LibraryManifest;
  /** Refusals, one per line: `<line>: <what is wrong>`. */
  errors: string[];
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Read a library manifest. Every departure is an error naming its line: a trust record that is
 * silently misread would claim a review nobody made, which is worse than having no record.
 */
export function readLibraryManifest(text: string, file: string): LibraryManifestResult {
  const toml = parseToml(text, { file });
  const errors = toml.diagnostics.map((d) => `${d.location?.line ?? 1}: ${d.message}`);
  const root = toml.value;
  if (root === undefined) return { errors };
  const at = (path: string): number => toml.positions?.get(path)?.line ?? 1;

  for (const key of Object.keys(root)) {
    if (key === "library" || key === "trust") continue;
    errors.push(`${at(key)}: unknown table [${key}]: a library manifest holds [library] and [[trust]]`);
  }

  const library = subTable(root, "library");
  if (library !== undefined) {
    for (const key of Object.keys(library)) {
      if (key === "name" || key === "source") continue;
      if (key === "rev") {
        errors.push(
          `${at(`library.${key}`)}: \`[library] rev\` was removed: a tree-level revision cannot be true for files that change independently (ADR-0034)`,
        );
        continue;
      }
      errors.push(`${at(`library.${key}`)}: unknown key \`${key}\` in [library] (name / source)`);
    }
  }
  // A template literal, not `"library.name"`: the registry guard in `packages/ir` reads every
  // dotted double-quoted literal as a diagnostic code, and a table path is not one.
  const inLibrary = (key: string): number => at(`library.${key}`);
  const name = stringOf(library, "name", errors, inLibrary("name"));
  const source = stringOf(library, "source", errors, inLibrary("source"));

  const trust: TrustEntry[] = [];
  const raw = root["trust"];
  if (raw !== undefined && !Array.isArray(raw)) {
    errors.push(`${at("trust")}: \`trust\` must be a list of \`[[trust]]\` tables`);
  } else {
    for (const [index, entry] of (raw ?? []).entries()) {
      const base = `trust#${index}`;
      if (Array.isArray(entry) || typeof entry !== "object") {
        errors.push(`${at(base)}: \`[[trust]]\` must be a table`);
        continue;
      }
      const path = (key: string): number => at(`${base}.${key}`);
      for (const key of Object.keys(entry)) {
        if (TRUST_ROW_KEYS[key] === true) continue;
        if (key === "rev") {
          errors.push(
            `${path(key)}: a [[trust]] row has no \`rev\`: every item names its revision (\`id@rev\`), so one row is one act (ADR-0034)`,
          );
          continue;
        }
        errors.push(
          `${path(key)}: unknown key \`${key}\` in [[trust]] (by / on / components / symbols / footprints)`,
        );
      }
      const by = stringOf(entry, "by", errors, path("by"));
      const on = stringOf(entry, "on", errors, path("on"));
      if (on !== undefined && !DATE.test(on)) {
        errors.push(`${path("on")}: \`on\` is a date (YYYY-MM-DD), not ${JSON.stringify(on)}`);
      }
      if (by !== undefined && by.trim().length === 0) {
        errors.push(`${path("by")}: \`by\` must name who did the review`);
      }
      const components = itemsOf(entry, "components", errors, path("components"));
      const symbols = itemsOf(entry, "symbols", errors, path("symbols"));
      const footprints = itemsOf(entry, "footprints", errors, path("footprints"));
      for (const [key, value, what] of [
        ["by", by, "someone"],
        ["on", on, "a day"],
      ] as const) {
        if (value === undefined) errors.push(`${at(base)}: [[trust]] needs \`${key}\`: a review is by ${what}, on a day`);
      }
      if (by === undefined || on === undefined) continue;
      trust.push({ by, on, components, symbols, footprints });
    }
    checkDuplicates(trust, `[[trust]]`, errors);
  }

  const manifest: LibraryManifest = {
    ...(name === undefined ? {} : { name }),
    ...(source === undefined ? {} : { source }),
    trust,
  };
  return { manifest, errors };
}

function stringOf(table: TomlTable | undefined, key: string, errors: string[], line: number): string | undefined {
  if (table === undefined) return undefined;
  const value = table[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    errors.push(`${line}: \`${key}\` is a string, not ${Array.isArray(value) ? "a list" : typeof value}`);
    return undefined;
  }
  return value;
}

export type { TrustItem };
