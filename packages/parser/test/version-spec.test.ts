// The language version table in spec/teda.md §13.1 and the acceptance ranges in
// packages/parser/src/version.ts state the same fact twice: which version each description type is
// on. ADR-0055 D1 allows one fact to live in one place, and this pair is the one place where two
// copies have to exist — the spec has to be self-contained for third-party implementers, and the
// parser has to decide what it accepts. These tests pin them together so neither can drift.
//
// The spec table also carries the patch component of the current surface (`component 0.1.7`), which
// the parser deliberately does not track: a patch never changes the acceptance decision.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { typeRange } from "../src/version.ts";

const specPath = join(import.meta.dir, "..", "..", "..", "spec", "teda.md");
const spec = readFileSync(specPath, "utf-8");

/** The version table in spec/teda.md §13.1: one row per description type. */
function specTable(): Map<string, { current: string; born: string; accepted: string }> {
  const section = spec.slice(spec.indexOf("### 13.1"));
  const rows = new Map<string, { current: string; born: string; accepted: string }>();
  for (const line of section.split("\n")) {
    const match = /^\|\s*`([a-z]+)`\s*\|\s*`([0-9.]+)`\s*\|\s*`([0-9.]+)`\s*\|\s*(.+?)\s*\|$/.exec(line);
    if (!match) continue;
    rows.set(match[1]!, {
      current: match[2]!,
      born: match[3]!,
      accepted: match[4]!,
    });
  }
  return rows;
}

describe("spec/teda.md §13.1 and packages/parser/src/version.ts", () => {
  test("the spec table lists every description type the parser reads", () => {
    const rows = specTable();
    for (const type of ["component", "footprint", "module", "pcb", "procurement", "schematic", "symbol", "system", "view"]) {
      expect(rows.has(type)).toBe(true);
    }
  });

  test("the accepted range in the spec is the range the parser accepts", () => {
    for (const [type, row] of specTable()) {
      const range = typeRange(type as Parameters<typeof typeRange>[0]);
      const accepted = row.accepted.split("–").map((part) => part.trim().replace(/`/g, ""));
      expect({ type, required: range.required.minor, supported: range.supported.minor }).toEqual({
        type,
        required: Number(accepted[0]!.split(".")[1]),
        supported: Number(accepted[accepted.length - 1]!.split(".")[1]),
      });
    }
  });

  test("the type's current version is the top of its accepted range", () => {
    for (const [type, row] of specTable()) {
      const range = typeRange(type as Parameters<typeof typeRange>[0]);
      const currentMinor = Number(row.current.split(".")[1]);
      expect({ type, current: currentMinor, supported: range.supported.minor }).toEqual({
        type,
        current: currentMinor,
        supported: currentMinor,
      });
    }
  });

  test("the born version is the bottom of the accepted range", () => {
    for (const [type, row] of specTable()) {
      const range = typeRange(type as Parameters<typeof typeRange>[0]);
      expect({ type, born: Number(row.born.split(".")[1]), required: range.required.minor }).toEqual({
        type,
        born: Number(row.born.split(".")[1]),
        required: Number(row.born.split(".")[1]),
      });
    }
  });
});
