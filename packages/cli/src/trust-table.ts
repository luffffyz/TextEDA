// A consumer trust table: what an organisation vouches for about libraries it does not own
// (ADR-0048). A library that somebody else maintains will not carry our `library.toml`, so the
// record of "we looked at these files at these revisions" has to live on the consuming side.
//
// The importer is given the path (`lib import --trust <file>`); nothing discovers it. The table is
// read at import time only, exactly like a library manifest: its effect lands in the copies (a
// `provenance reviewed` component, an origin header for geometry), and the file itself never enters
// a build.
//
// Same TOML subset as `library.toml` (`packages/parser/src/toml.ts`) — tables, arrays of tables,
// strings — plus a mandatory `library` key and the same per-item shape (ADR-0049 decision 3): a row
// is one act, and every item names the revision it was checked at. There is no whole-library form
// and no row-level revision: a row states what was verified, and "we ship everything unreviewed
// anyway" is a policy about a board, not a fact about a library.
import { parseToml } from "@texteda/parser";
import { checkDuplicates, itemsOf, TRUST_ROW_KEYS, type TrustRow } from "./trust-record.ts";

/** One vouching act about one library: these files at these revisions, by this person, on this day. */
export interface ConsumerTrustEntry extends TrustRow {
  /** The library the entry is about; it must equal the name being imported. */
  library: string;
}

export interface TrustTableResult {
  entries?: ConsumerTrustEntry[];
  /** Refusals, one per line: `<line>: <what is wrong>`. A table that cannot be read vets nothing. */
  errors: string[];
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const LIB_NAME = /^[a-z][a-z0-9_-]*$/;
/** A consumer row also names its library. */
const ENTRY_KEYS: Record<string, true> = { library: true, ...TRUST_ROW_KEYS };

/**
 * Read a consumer trust table. Every departure is an error naming its line: a record that is
 * silently misread would vouch for a revision nobody looked at, which is worse than no record at
 * all (ADR-0047 decision 5, ADR-0048 decision 2).
 */
export function readTrustTable(text: string, file: string): TrustTableResult {
  const toml = parseToml(text, { file });
  const errors = toml.diagnostics.map((d) => `${d.location?.line ?? 1}: ${d.message}`);
  const root = toml.value;
  if (root === undefined) return { errors };
  const at = (path: string): number => toml.positions?.get(path)?.line ?? 1;

  for (const key of Object.keys(root)) {
    if (key === "trust") continue;
    errors.push(`${at(key)}: unknown table [${key}]: a trust table holds [[trust]] entries`);
  }

  const entries: ConsumerTrustEntry[] = [];
  const raw = root["trust"];
  if (raw !== undefined && !Array.isArray(raw)) {
    errors.push(`${at("trust")}: \`trust\` must be a list of \`[[trust]]\` tables`);
  } else if (raw === undefined) {
    errors.push(`${file}: no [[trust]] entry: a trust table that vouches for nothing is not a table`);
  } else {
    for (const [index, entry] of raw.entries()) {
      const base = `trust#${index}`;
      if (Array.isArray(entry) || typeof entry !== "object") {
        errors.push(`${at(base)}: \`[[trust]]\` must be a table`);
        continue;
      }
      const path = (key: string): number => at(`${base}.${key}`);
      for (const key of Object.keys(entry)) {
        if (ENTRY_KEYS[key] === true) continue;
        if (key === "rev") {
          errors.push(
            `${path(key)}: a [[trust]] row has no \`rev\`: every item names its revision (\`id@rev\`), so one row is one act (ADR-0049)`,
          );
          continue;
        }
        errors.push(
          `${path(key)}: unknown key \`${key}\` in [[trust]] (library / by / on / components / symbols / footprints)`,
        );
      }

      const library = stringOf(entry, "library", errors, path("library"));
      if (library !== undefined && !LIB_NAME.test(library)) {
        errors.push(`${path("library")}: not a library name: ${JSON.stringify(library)} (^[a-z][a-z0-9_-]*$)`);
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
      if (components.length + symbols.length + footprints.length === 0) {
        errors.push(`${at(base)}: [[trust]] names no items: a row states what was verified, and this one states nothing`);
      }

      for (const [key, value] of [
        ["library", library],
        ["by", by],
        ["on", on],
      ] as const) {
        if (value === undefined) {
          errors.push(
            `${at(base)}: [[trust]] needs \`${key}\`: a review is of a library, by someone, on a day`,
          );
        }
      }
      if (library === undefined || by === undefined || on === undefined) continue;
      entries.push({ library, by, on, components, symbols, footprints });
    }
    checkDuplicates(entries, `${file}: [[trust]]`, errors);
  }

  return errors.length > 0 ? { errors } : { entries, errors };
}

function stringOf(
  table: Record<string, unknown>,
  key: string,
  errors: string[],
  line: number,
): string | undefined {
  const value = table[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    errors.push(`${line}: \`${key}\` is a string, not ${Array.isArray(value) ? "a list" : typeof value}`);
    return undefined;
  }
  return value;
}
