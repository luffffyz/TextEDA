// The shape both trust records share: an **act** — somebody checked something, on a day — and the
// items the act covers (ADR-0049 decision 3).
//
// A row carries no revision of its own: one act covers files whose revisions differ, so every item
// names the revision it was checked at (`id@rev`). Writing `by` / `on` once per act instead of once
// per revision is what keeps a review of files from three releases one row instead of three; the
// item list grows with what was verified, which is the irreducible cost of an honest record.
//
// The two records are the library's own (`library.toml`, `[[trust]]`) and the consumer's
// (`--trust`, ADR-0048). They share this module so a reader sees one vocabulary and one syntax, and
// so the importer has one matcher.
import { REV_RE } from "@texteda/parser";

/** The three groups a row covers, in the order the messages list them. */
export const TRUST_GROUPS = ["components", "symbols", "footprints"] as const;

export type TrustGroup = (typeof TRUST_GROUPS)[number];

/** The keys a `[[trust]]` row may carry, beside `library` in a consumer table. */
export const TRUST_ROW_KEYS: Record<string, true> = {
  by: true,
  on: true,
  components: true,
  symbols: true,
  footprints: true,
};

/** One verified file: its id and the revision the verification was of. */
export interface TrustItem {
  readonly id: string;
  readonly rev: string;
}

/** One act: who checked, on which day, and which files at which revisions. A consumer table also
 * names the library the act is about (`library`), so the library is part of the item it covers. */
export interface TrustRow {
  readonly by: string;
  readonly on: string;
  readonly components: readonly TrustItem[];
  readonly symbols: readonly TrustItem[];
  readonly footprints: readonly TrustItem[];
  /** The library an act is about, a consumer table's `library` key; absent for a library record. */
  readonly library?: string;
}

const ID = /^[a-z][a-z0-9-]*$/;
/** `id@rev`: the id never contains `@`, so the split point is unambiguous. */
const ITEM = /^([a-z][a-z0-9-]*)@([^\s#]+)$/;

/** The items of one group, for a row read from either record. */
export function itemsOfGroup(row: TrustRow, group: TrustGroup): readonly TrustItem[] {
  return row[group];
}

/**
 * A group's item list (`components = ["tps7a02@2.1.0", …]`). Absent means "nothing in this group";
 * an entry that is not `id@rev` is an error rather than a silently ignored string.
 */
export function itemsOf(
  table: Record<string, unknown>,
  key: TrustGroup,
  errors: string[],
  line: number,
): TrustItem[] {
  const value = table[key];
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    errors.push(`${line}: \`${key}\` is a list of \`<id>@<rev>\` items`);
    return [];
  }
  const items: TrustItem[] = [];
  for (const raw of value) {
    if (typeof raw !== "string") {
      errors.push(`${line}: \`${key}\` entries are \`<id>@<rev>\` strings`);
      continue;
    }
    const parsed = ITEM.exec(raw);
    if (!parsed) {
      errors.push(
        `${line}: \`${key}\` entry ${JSON.stringify(raw)} is not \`<id>@<rev>\`: each item names the revision it was checked at`,
      );
      continue;
    }
    const id = parsed[1]!;
    const rev = parsed[2]!;
    if (!ID.test(id) || !REV_RE.test(rev)) {
      errors.push(`${line}: \`${key}\` entry ${JSON.stringify(raw)} has an invalid id or revision`);
      continue;
    }
    items.push({ id, rev });
  }
  return items;
}

/**
 * The same item stated twice in one record is a defect, not a merge: two rows for one
 * `(id, rev)` would claim two authors for one act (the importer refuses the same disagreement
 * between two records). A consumer table vouches for several libraries, so the library is part of
 * the item: the same `id@rev` under one library is still one act, while the same `id@rev` under
 * two different libraries is two distinct acts (ADR-0048).
 */
export function checkDuplicates(
  rows: readonly TrustRow[],
  where: string,
  errors: string[],
): void {
  const seen = new Set<string>();
  for (const row of rows) {
    const library = typeof row.library === "string" ? row.library : undefined;
    for (const group of TRUST_GROUPS) {
      for (const item of row[group]) {
        const key = `${library ?? ""}/${group}/${item.id}@${item.rev}`;
        if (seen.has(key)) {
          errors.push(`${where}: ${key} is stated twice: one act, one author`);
        }
        seen.add(key);
      }
    }
  }
}

/** Whether the row covers this id at this revision. Exact strings: `+local.N` never matches. */
export function covers(row: TrustRow, group: TrustGroup, id: string, rev: string): boolean {
  return row[group].some((item) => item.id === id && item.rev === rev);
}
