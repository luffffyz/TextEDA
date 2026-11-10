// The version table in spec/teda.md §12.1 states each description type's introduction version and
// the oldest surface version accepted by this reader. Those facts differ after a breaking rewrite;
// the parser implements reader floors, and this test keeps them aligned with the public contract.
// The language ceiling is shared by every type.
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
  "module_view",
  "pcb",
  "procurement",
  "schematic",
  "sheet_template",
  "symbol",
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

/** The lines of the table in §12.1 that lists the description types, header included. */
function versionTable(): string[] {
  const blocks: string[][] = [];
  let block: string[] = [];
  for (const line of section("### 12.1").split("\n")) {
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
 * The version table in spec/teda.md §12.1 gives the oldest accepted reader floor plus the historical
 * version that introduced each type; those are separate facts after a breaking rewrite.
 */
function specTable(): Map<string, { floor: string; introduced: string | null; upper: number | null }> {
  const rows = new Map<string, { floor: string; introduced: string | null; upper: number | null }>();
  for (const line of versionTable()) {
    const parts = cells(line);
    if (parts.length !== 3) continue;
    const name = /^`([a-z_]+)`$/.exec(parts[0]!);
    const floor = /^`([0-9.]+)`$/.exec(parts[1]!);
    if (!name || !floor) continue;
    const cell = parts[2]!.replace(/`/g, "").trim();
    const range = /^(\d+\.\d+)(?:\.\d+)?(?:\s*[-–—]\s*(\d+\.\d+)(?:\.\d+)?)?$/.exec(cell);
    const introduced = /\bintroduced at (\d+\.\d+)\b/i.exec(cell)?.[1] ?? null;
    rows.set(name[1]!, {
      floor: floor[1]!,
      introduced,
      upper: range ? Number((range[2] ?? range[1]!).split(".")[1]) : null,
    });
  }
  return rows;
}

/** The prose of §12.1 — the section text with the version table taken out. */
function specProse(): string {
  const table = new Set(versionTable());
  return section("### 12.1")
    .split("\n")
    .filter((line) => !table.has(line))
    .join("\n");
}

/** Whether the prose of §12.1 states the language's current version. */
function proseStatesCeiling(): boolean {
  // The spec records the declared release as `0.14.0`; canonical source spelling omits a zero patch (`0.14`).
  return specProse().includes(formatVersion(SUPPORTED_LANGUAGE));
}

describe("spec/teda.md §12.1 and packages/parser/src/version.ts", () => {
  test("the spec table lists every description type the parser reads, and no other", () => {
    const rows = specTable();
    expect([...rows.keys()].sort()).toEqual([...ALL_TYPES].sort());
  });

  test("the table has three columns: type, reader floor and notes", () => {
    // The language version is shared, while historical introductions stay in the notes column.
    const table = versionTable();
    expect(table.length).toBeGreaterThan(0);
    for (const line of table) {
      expect({ cells: cells(line).length }).toEqual({ cells: 3 });
    }
  });

  test("the reader floor matches the spec independently of type introduction", () => {
    const rows = specTable();
    for (const type of ALL_TYPES) {
      const floor = rows.get(type)?.floor;
      expect({ type, floor: floor ?? "<missing>", required: formatVersion(typeRange(type).required) }).toEqual({
        type,
        floor: floor ?? "<missing>",
        required: floor ?? "<missing>",
      });
    }
    expect(typeRange("footprint").required.minor).toBeGreaterThan(4);
    expect(typeRange("pcb").required.minor).toBeGreaterThan(4);
    expect(typeRange("symbol").required.minor).toBeGreaterThan(5);
    expect(typeRange("view").required.minor).toBe(14);
  });

  test("the spec keeps historical type introductions distinct from reader floors", () => {
    const rows = specTable();
    const introduced: Record<DescriptionType, string> = {
      component: "0.1",
      footprint: "0.4",
      module: "0.8",
      module_view: "0.13",
      pcb: "0.4",
      procurement: "0.9",
      schematic: "0.1",
      sheet_template: "0.13",
      symbol: "0.5",
      view: "0.6",
    };
    for (const type of ALL_TYPES) {
      expect({ type, introduced: rows.get(type)?.introduced }).toEqual({ type, introduced: introduced[type] });
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

  test("the language's current version is stated in the prose of §12.1", () => {
    // The upper bound is not a per-type fact: it is the one number the whole language is at, and the
    // prose of §12.1 is where it is stated.
    expect(proseStatesCeiling()).toBe(true);
  });
});

describe("spec/teda.md §12.4, the changelog of the language", () => {
  /** The `#### <version> — <title>（<YYYY-MM-DD>）` headings of §12.4, newest first. */
  function entries(): Array<{ version: string; date: string }> {
    return [
      ...section("### 12.4").matchAll(
        /^####\s+(\d+\.\d+(?:\.\d+)?)\s+[—–]\s+(.+?)（(\d{4}-\d{2}-\d{2})）\s*$/gm,
      ),
    ].map((m) => ({ version: m[1]!, date: m[3]! }));
  }

  test("the newest entry is the language's current version", () => {
    const found = entries();
    expect(found.length).toBeGreaterThan(0);
    const declared = `${SUPPORTED_LANGUAGE.major}.${SUPPORTED_LANGUAGE.minor}.${SUPPORTED_LANGUAGE.patch}`;
    expect(found[0]!.version).toBe(declared);
  });

  test("every entry carries a date", () => {
    const headings = section("### 12.4")
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
    // The language version and the IR contract version are two different lines (ADR-0002 D7). Both
    // live in their own homes — spec/teda.md §12.1/§12.4 and schemas/ir/ — and AGENTS.md points at
    expect(/(?<![\w.])v?0\.14(?![\w])/.test(text)).toBe(false);
  });
});
