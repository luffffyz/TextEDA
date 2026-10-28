// The language version table in spec/teda.md §13.1 and the acceptance ranges in
// packages/parser/src/version.ts state the same fact twice: the version each description type is
// born at, and the one version number the language is at. ADR-0140 D1 allows one fact to live in one
// place, and this pair is the one place where two copies have to exist — the spec has to be
// self-contained for third-party implementers, and the parser has to decide what it accepts. These
// tests pin them together so neither can drift.
//
// The table carries the **floor** (the version a type was born at). The upper bound is the language's
// current number, shared by every type (ADR-0101 D4): either every row states it as a range, or it
// is stated once in the prose of §13.1. The reader below accepts both shapes and asserts the same
// thing about either.
//
// The parser deliberately does not track the patch component of the accepted set: a patch never
// changes the acceptance decision.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { formatVersion, SUPPORTED_LANGUAGE, typeRange, type DescriptionType } from "../src/version.ts";

const repoRoot = join(import.meta.dir, "..", "..", "..");
const spec = readFileSync(join(repoRoot, "spec", "teda.md"), "utf-8");

/** Every description type the parser reads. */
const ALL_TYPES: DescriptionType[] = [
  "component",
  "footprint",
  "module",
  "pcb",
  "procurement",
  "schematic",
  "symbol",
  "system",
  "view",
];

/** The text of a `###` section: from its heading up to the next heading of the same or a higher level. */
function section(heading: string): string {
  const start = spec.indexOf(heading);
  if (start === -1) return "";
  const rest = spec.slice(start + heading.length);
  const next = rest.search(/\n#{1,3} /);
  return next === -1 ? rest : rest.slice(0, next);
}

/** The lines of the table in §13.1 that lists the description types, header included. */
function versionTable(): string[] {
  const blocks: string[][] = [];
  let block: string[] = [];
  for (const line of section("### 13.1").split("\n")) {
    if (line.startsWith("|")) {
      block.push(line);
      continue;
    }
    if (block.length > 0) blocks.push(block);
    block = [];
  }
  if (block.length > 0) blocks.push(block);
  // The type table is the one that names description types; the MAJOR/MINOR/PATCH table does not.
  return blocks.find((lines) => lines.filter((line) => /^\|\s*`[a-z]+`\s*\|/.test(line)).length >= 5) ?? [];
}

/** The cells of a table row, split on the unescaped pipes. */
function cells(line: string): string[] {
  return line.split(/(?<!\\)\|/).slice(1, -1).map((cell) => cell.trim());
}

/**
 * The version table in spec/teda.md §13.1: one row per description type.
 *
 * Column 1 is the type name in a code span, column 2 the floor in a code span. Column 3 is either
 * free prose or the accepted range (`0.1` – `0.9`); a cell that is nothing but versions is read as a
 * range, so the reader does not depend on which of the two shapes the table is written in.
 */
function specTable(): Map<string, { floor: string; upper: number | null }> {
  const rows = new Map<string, { floor: string; upper: number | null }>();
  for (const line of versionTable()) {
    const parts = cells(line);
    if (parts.length !== 3) continue;
    const name = /^`([a-z]+)`$/.exec(parts[0]!);
    const floor = /^`([0-9.]+)`$/.exec(parts[1]!);
    if (!name || !floor) continue;
    const cell = parts[2]!.replace(/`/g, "").trim();
    const range = /^(\d+\.\d+)(?:\.\d+)?(?:\s*[-–—]\s*(\d+\.\d+)(?:\.\d+)?)?$/.exec(cell);
    rows.set(name[1]!, {
      floor: floor[1]!,
      upper: range ? Number((range[2] ?? range[1]!).split(".")[1]) : null,
    });
  }
  return rows;
}

/** The prose of §13.1 — the section text with the version table taken out. */
function specProse(): string {
  const table = new Set(versionTable());
  return section("### 13.1")
    .split("\n")
    .filter((line) => !table.has(line))
    .join("\n");
}

/** Whether the prose of §13.1 states the language's current version. */
function proseStatesCeiling(): boolean {
  // The canonical spelling, patch included: `0.9.1`. The MINOR alone (`0.9`) is the accepted-range
  // bound, not the language's number, so it does not count here.
  return specProse().includes(formatVersion(SUPPORTED_LANGUAGE));
}

describe("spec/teda.md §13.1 and packages/parser/src/version.ts", () => {
  test("the spec table lists every description type the parser reads, and no other", () => {
    const rows = specTable();
    expect([...rows.keys()].sort()).toEqual([...ALL_TYPES].sort());
  });

  test("the table has three columns: the per-type current-version column is gone", () => {
    // The old table had four columns (type | current version | born | accepted range). The current
    // version is one number for the whole language, so it is not a column of a per-type table.
    const table = versionTable();
    expect(table.length).toBeGreaterThan(0);
    for (const line of table) {
      expect({ cells: cells(line).length }).toEqual({ cells: 3 });
    }
  });

  test("the born version is the floor the parser accepts", () => {
    const rows = specTable();
    for (const type of ALL_TYPES) {
      const row = rows.get(type);
      const born = row ? Number(row.floor.split(".")[1]) : NaN;
      expect({ type, born, required: typeRange(type).required.minor }).toEqual({
        type,
        born,
        required: born,
      });
    }
  });

  test("the ceiling is one number: every row that states a range states the language's version", () => {
    const rows = specTable();
    const uppers = new Set<number>();
    let stated = 0;
    for (const type of ALL_TYPES) {
      const upper = rows.get(type)?.upper ?? null;
      if (upper === null) continue;
      stated++;
      uppers.add(upper);
      expect({ type, upper, language: SUPPORTED_LANGUAGE.minor }).toEqual({
        type,
        upper: SUPPORTED_LANGUAGE.minor,
        language: SUPPORTED_LANGUAGE.minor,
      });
    }
    // Either every row states the ceiling, or none does and the prose carries it — never a mix, and
    // never two different ceilings.
    expect(stated === 0 || stated === ALL_TYPES.length).toBe(true);
    expect(uppers.size).toBeLessThanOrEqual(1);
    // Whichever way the spec writes it, the ceiling has to be stated somewhere.
    if (stated === 0) {
      expect(proseStatesCeiling()).toBe(true);
    }
  });

  test("the language's current version is stated in the prose of §13.1", () => {
    // The upper bound is not a per-type fact: it is the one number the whole language is at, and the
    // prose of §13.1 is where it is stated.
    expect(proseStatesCeiling()).toBe(true);
  });
});

describe("spec/teda.md §13.4, the changelog of the language", () => {
  /** The `#### <version> — <title>（<YYYY-MM-DD>）` headings of §13.4, newest first. */
  function entries(): Array<{ version: string; date: string }> {
    return [
      ...section("### 13.4").matchAll(
        /^####\s+(\d+\.\d+(?:\.\d+)?)\s+[—–]\s+(.+?)（(\d{4}-\d{2}-\d{2})）\s*$/gm,
      ),
    ].map((m) => ({ version: m[1]!, date: m[3]! }));
  }

  test("the newest entry is the language's current version", () => {
    const found = entries();
    expect(found.length).toBeGreaterThan(0);
    expect(found[0]!.version).toBe(formatVersion(SUPPORTED_LANGUAGE));
  });

  test("every entry carries a date", () => {
    const headings = section("### 13.4")
      .split("\n")
      .filter((line) => /^####\s+\d/.test(line));
    expect(headings.length).toBeGreaterThan(0);
    for (const heading of headings) {
      expect(heading).toMatch(/^####\s+\d+\.\d+(?:\.\d+)?\s+[—–]\s+.+?（\d{4}-\d{2}-\d{2}）\s*$/);
    }
  });
});

describe("AGENTS.md does not restate the current version", () => {
  test("the language version and the IR contract version are not written out", () => {
    const text = readFileSync(join(repoRoot, "AGENTS.md"), "utf-8")
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/`[^`\n]*`/g, " ");
    // The language version is `0.9.1`; the IR contract version is `v0.14` (a different line, ADR-0101
    // D7). Both live in their own homes — spec/teda.md §13.1/§13.4 and schemas/ir/ — and AGENTS.md
    // points at them instead of writing the numbers out.
    expect(text.includes("0.9.1")).toBe(false);
    expect(/(?<![\w.])v?0\.14(?![\w])/.test(text)).toBe(false);
  });
});
