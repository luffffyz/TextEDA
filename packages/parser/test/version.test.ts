// Unit tests for the language version module (teda.md §13, ADR-0101).
//
// The rules under test: the grammar is MAJOR.MINOR[.PATCH]; the patch component is optional and
// means zero when omitted; a patch never changes the acceptance decision; the language has ONE
// version number and every description type shares its ceiling, while the floor stays per type;
// 1.0 is a milestone.
import { describe, expect, test } from "bun:test";
import {
  checkVersion,
  compareVersions,
  formatVersion,
  parseVersion,
  SUPPORTED_LANGUAGE,
  typeRange,
  type DescriptionType,
} from "../src/version.ts";
import { parseView } from "../src/view.ts";
import { parseSchematicDocument } from "../src/schematic.ts";
import { readComponentFacts } from "../src/component-facts.ts";

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

describe("version parsing", () => {
  test("accepts MAJOR.MINOR and MAJOR.MINOR.PATCH", () => {
    expect(parseVersion("0.6")).toEqual({ major: 0, minor: 6, patch: 0 });
    expect(parseVersion("0.6.1")).toEqual({ major: 0, minor: 6, patch: 1 });
    expect(parseVersion("1.0.0")).toEqual({ major: 1, minor: 0, patch: 0 });
  });

  test("rejects anything that is not a version", () => {
    for (const text of ["0", "0.", "0.6.", "0.6.1.2", "v0.6", "0.06", "0.6.01", "", "0.6 "]) {
      expect({ text, version: parseVersion(text) }).toEqual({ text, version: null });
    }
  });

  test("the canonical spelling leaves a zero patch out", () => {
    expect(formatVersion({ major: 0, minor: 6, patch: 0 })).toBe("0.6");
    expect(formatVersion({ major: 0, minor: 6, patch: 1 })).toBe("0.6.1");
  });

  test("compares by major, then minor, then patch", () => {
    const v = (major: number, minor: number, patch = 0) => ({ major, minor, patch });
    expect(compareVersions(v(0, 6), v(0, 7))).toBeLessThan(0);
    expect(compareVersions(v(0, 6, 1), v(0, 6))).toBeGreaterThan(0);
    expect(compareVersions(v(0, 6, 1), v(0, 6, 1))).toBe(0);
    expect(compareVersions(v(1, 0), v(0, 9))).toBeGreaterThan(0);
  });
});

describe("version acceptance", () => {
  const range = typeRange("view");

  test("accepts the required version and any of its patches", () => {
    for (const text of ["0.7", "0.7.0", "0.7.1", "0.7.99"]) {
      const verdict = checkVersion(text, range, "view");
      expect({ text, ok: verdict.ok }).toEqual({ text, ok: true });
    }
  });

  test("rejects a version below the type's introduction", () => {
    const verdict = checkVersion("0.6.3", range, "view");
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.code).toBe("format.unsupported-version");
  });

  test("rejects a version the tool does not implement", () => {
    const verdict = checkVersion("0.10", range, "view");
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.code).toBe("format.unsupported-version");
  });

  test("every description type accepts the current language version and any patch of it", () => {
    // ADR-0101 D2: the language has ONE version number. Every type declares the same number, and the
    // patch bit never decides (a patch does not change the accepted file set).
    for (const type of ALL_TYPES) {
      const range = typeRange(type);
      for (const text of ["0.9.1", "0.9", "0.9.0", "0.9.99"]) {
        expect({ type, text, ok: checkVersion(text, range, type).ok }).toEqual({ type, text, ok: true });
      }
    }
  });

  test("every description type refuses a version the language has not reached", () => {
    // 0.10 is beyond the language's current MINOR, and 1.0 is the frozen-surface milestone — neither
    // is implemented, for any type.
    for (const type of ALL_TYPES) {
      const range = typeRange(type);
      for (const text of ["0.10", "1.0"]) {
        const verdict = checkVersion(text, range, type);
        expect({ type, text, ok: verdict.ok }).toEqual({ type, text, ok: false });
        expect(verdict.ok === false && verdict.code).toBe("format.unsupported-version");
      }
    }
  });

  test("every description type refuses a version below the one it was born at", () => {
    // The floor stays per type (ADR-0101 D4): a type that did not exist yet cannot have a file from
    // before it.
    const tooOld: Array<[string, string]> = [
      ["symbol", "0.4"],
      ["view", "0.6"],
      ["procurement", "0.8"],
    ];
    for (const [type, text] of tooOld) {
      const verdict = checkVersion(text, typeRange(type as DescriptionType), type);
      expect({ type, text, ok: verdict.ok }).toEqual({ type, text, ok: false });
      expect(verdict.ok === false && verdict.code).toBe("format.unsupported-version");
    }
  });

  test("the ceiling is the same for every type: the language's current version", () => {
    // The one-number invariant. A per-type ceiling comes back, this fails.
    for (const type of ALL_TYPES) {
      const range = typeRange(type);
      expect({ type, supported: range.supported.minor, language: SUPPORTED_LANGUAGE.minor }).toEqual({
        type,
        supported: SUPPORTED_LANGUAGE.minor,
        language: SUPPORTED_LANGUAGE.minor,
      });
    }
  });

  test("the floor is still per type", () => {
    const born: Record<string, number> = {
      component: 1,
      footprint: 4,
      module: 8,
      pcb: 7,
      procurement: 9,
      schematic: 1,
      symbol: 5,
      system: 2,
      view: 7,
    };
    for (const type of ALL_TYPES) {
      expect({ type, required: typeRange(type).required.minor }).toEqual({ type, required: born[type]! });
    }
    // The floors are not all the same: the merge retired the per-type *ceiling*, not the floor.
    const floors = new Set(ALL_TYPES.map((type) => typeRange(type).required.minor));
    expect(floors.size).toBeGreaterThan(1);
  });

  test("a board file keeps the whole 0.1..0.9 window", () => {
    // A board gained sections over time (ports at 0.2, modules at 0.8, instance UIDs at 0.9), so the
    // window stays open: a flat board may still say 0.2 while a board that carries UIDs says 0.9.
    const schematic = typeRange("schematic");
    for (const text of ["0.2", "0.7", "0.8", "0.9"]) {
      expect({ text, ok: checkVersion(text, schematic, "schematic").ok }).toEqual({ text, ok: true });
    }
    expect(checkVersion("1.0", schematic, "schematic").ok).toBe(false);
  });

  test("rejects a malformed version as an invalid version, not an unsupported one", () => {
    const verdict = checkVersion("zero", range, "view");
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.code).toBe("format.invalid-version");
  });
});

describe("parsers accept a patch version", () => {
  test("a view file may declare a patch version and the IR keeps it", () => {
    const source = "version 0.7.1\nview main\n\nplace\n  U1  10.0  10.0\n";
    const result = parseView(source, { file: "v.teda", board: "b" });
    expect(result.diagnostics).toEqual([]);
    expect(result.ir!.format).toBe("0.7.1");
  });

  test("the patch is canonicalized: 0.7.0 is stored as 0.7", () => {
    const source = "version 0.7.0\nview main\n\nplace\n  U1  10.0  10.0\n";
    const result = parseView(source, { file: "v.teda", board: "b" });
    expect(result.ir!.format).toBe("0.7");
  });

  test("a schematic file may declare a patch version", () => {
    const result = parseSchematicDocument("version 0.3.4\nschematic b\n", { file: "b.teda" });
    expect(result.ok).toBe(true);
    expect(result.doc!.version).toBe("0.3.4");
  });

  test("a schematic file may declare the current language version", () => {
    // The upper bound is the language version the tool supports, not the version that introduced
    // the type: a board written today declares the language's number, not 0.3.
    const result = parseSchematicDocument("version 0.9.1\nschematic b\n", { file: "b.teda" });
    expect(result.ok).toBe(true);
  });

  test("a page file is rejected: the type was removed in language 0.7", () => {
    const result = parseSchematicDocument("version 0.3\npage p\n", { file: "p.teda" });
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]!.code).toBe("syntax.removed-construct");
  });

  test("a component file with a version the tool does not implement is rejected", () => {
    const result = readComponentFacts("version 9.9\ncomponent c\n", { file: "c.teda" });
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]!.code).toBe("format.unsupported-version");
  });
});
