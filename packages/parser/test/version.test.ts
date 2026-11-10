// Unit tests for the language version module (teda.md §13, ADR-0002).
//
// The rules under test: the grammar is MAJOR.MINOR[.PATCH]; the patch component is optional and
// means zero when omitted; a patch never changes the acceptance decision; the language has ONE
// version number and every description type shares its ceiling; reader floors are per type and may
// be later than a type's historical introduction after a breaking surface rewrite; 1.0 is a milestone.
//
// The language is at 0.14 and every type accepts it; 0.15 is refused for every type. The `pcb`,
// `schematic`, and `view` reader floors moved to 0.14 under ADR-0069; module_view and sheet_template
// remain at 0.13.
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
import { parsePcb } from "../src/pcb.ts";
import { parseSymbol } from "../src/symbol.ts";
import { parseFootprint } from "../src/footprint.ts";
import { parseSchematicDocument } from "../src/schematic.ts";
import { readComponentFacts } from "../src/component-facts.ts";

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

  test("accepts the reader floor and any of its patches", () => {
    // The view floor moved to 0.14 under ADR-0069; patch versions remain accepted.
    // Files below 0.14 are refused before geometry parsing.
    for (const text of ["0.14", "0.14.0", "0.14.1", "0.14.99"]) {
      const verdict = checkVersion(text, range, "view");
      expect({ text, ok: verdict.ok }).toEqual({ text, ok: true });
    }
  });

  test("rejects a version below the reader floor", () => {
    const verdict = checkVersion("0.13.3", range, "view");
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.code).toBe("format.unsupported-version");
  });

  test("rejects a version beyond the supported language", () => {
    const verdict = checkVersion("0.15", range, "view");
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.code).toBe("format.unsupported-version");
  });

  test("every description type accepts the current language version and any patch of it", () => {
    // ADR-0002 D2: the language has ONE version number. Every type declares the same number, and the
    // patch bit never decides (a patch does not change the accepted file set).
    for (const type of ALL_TYPES) {
      const range = typeRange(type);
      for (const text of ["0.14", "0.14.0", "0.14.1", "0.14.99"]) {
        expect({ type, text, ok: checkVersion(text, range, type).ok }).toEqual({ type, text, ok: true });
      }
    }
  });

  test("every description type refuses a version the language has not reached", () => {
    // 0.15 is beyond the language's current MINOR, and 1.0 is the frozen-surface milestone — neither
    // is implemented, for any type.
    for (const type of ALL_TYPES) {
      const range = typeRange(type);
      for (const text of ["0.15", "1.0"]) {
        const verdict = checkVersion(text, range, type);
        expect({ type, text, ok: verdict.ok }).toEqual({ type, text, ok: false });
        expect(verdict.ok === false && verdict.code).toBe("format.unsupported-version");
      }
    }
  });

  test("every description type refuses a version below its reader floor", () => {
    for (const type of ALL_TYPES) {
      const floor = typeRange(type).required.minor;
      const text = `0.${floor - 1}`;
      const verdict = checkVersion(text, typeRange(type), type);
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

  test("the language is at 0.14 and the view floor moved to 0.14", () => {
    // The language ceiling and the view reader floor both moved to 0.14 under ADR-0069.
    // The floor and ceiling remain separate facts even when they currently share a minor version.
    // Every accepted patch version preserves the file's declared format.
    expect(SUPPORTED_LANGUAGE).toEqual({ major: 0, minor: 14, patch: 0 });
    expect({ required: typeRange("view").required.minor, supported: typeRange("view").supported.minor }).toEqual({
      required: 14,
      supported: 14,
    });
  });

  test("the reader floors are per description type", () => {
    const floor: Record<DescriptionType, number> = {
      component: 1,
      footprint: 11,
      module: 8,
      module_view: 13,
      pcb: 14,
      procurement: 9,
      schematic: 14,
      sheet_template: 13,
      symbol: 11,
      view: 14,
    };
    for (const type of ALL_TYPES) {
      expect({ type, required: typeRange(type).required.minor }).toEqual({ type, required: floor[type] });
    }
  });

  test("pre-0.14 schematic versions are below the reader floor", () => {
    const schematic = typeRange("schematic");
    for (const text of ["0.2", "0.7", "0.8", "0.9", "0.9.2", "0.10.0", "0.11.0", "0.12.0", "0.13.0"]) {
      expect({ text, ok: checkVersion(text, schematic, "schematic").ok }).toEqual({ text, ok: false });
    }
    for (const text of ["0.14", "0.14.1", "0.14.99"]) {
      expect({ text, ok: checkVersion(text, schematic, "schematic").ok }).toEqual({ text, ok: true });
    }
    expect(checkVersion("0.15", schematic, "schematic").ok).toBe(false);
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
    const source = "version 0.14.1\nview main\n\nplace\n  U1  [10.0,10.0]\n";
    const result = parseView(source, { file: "v.teda" });
    expect(result.diagnostics).toEqual([]);
    expect(result.ir!.format).toBe("0.14.1");
  });

  test("the patch is canonicalized: 0.14.0 is stored as 0.14", () => {
    const source = "version 0.14.0\nview main\n\nplace\n  U1  [10.0,10.0]\n";
    const result = parseView(source, { file: "v.teda" });
    expect(result.ir!.format).toBe("0.14");
  });

  test("a current view file keeps the format it declares", () => {
    const source = "version 0.14\nview main\n\nplace\n  U1  [10.0,10.0]\n";
    const result = parseView(source, { file: "v.teda" });
    expect(result.ok).toBe(true);
    expect(result.ir!.format).toBe("0.14");
  });

  test("a view file beyond the ceiling is refused", () => {
    const source = "version 0.15\nview main\n\nplace\n  U1  [10.0,10.0]\n";
    const result = parseView(source, { file: "v.teda" });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["format.unsupported-version"]);
  });

  test("a view below its reader floor is refused before reading its geometry", () => {
    const source = "version 0.13\nview main\n\nplace\n  U1  10.0  10.0\n";
    const result = parseView(source, { file: "v.teda" });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["format.unsupported-version"]);
  });

  test("a schematic file may declare a patch version", () => {
    const result = parseSchematicDocument("version 0.14.1\nschematic main\n", { file: "main.teda" });
    expect(result.ok).toBe(true);
    expect(result.doc!.version).toBe("0.14.1");
  });

  test("a schematic file may declare the current language version", () => {
    const result = parseSchematicDocument("version 0.14.0\nschematic main\n", { file: "main.teda" });
    expect(result.ok).toBe(true);
  });

  test("a schematic file beyond the ceiling is refused", () => {
    const result = parseSchematicDocument("version 0.15\nschematic main\n", { file: "main.teda" });
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]!.code).toBe("format.unsupported-version");
  });

  test("a page file is rejected: the type was removed in language 0.7", () => {
    const result = parseSchematicDocument("version 0.14\npage p\n", { file: "p.teda" });
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]!.code).toBe("syntax.removed-construct");
  });

  test("geometry parsers reject every pre-reader-floor file before parsing its body", () => {
    const cases: { text: string; run: (text: string) => { ok: boolean; diagnostics: readonly { code: string; message: string }[] } }[] = [
      { text: "version 0.13\npcb b\n", run: (text) => parsePcb(`${text}\noutline\n  0 0\n`, { file: "b.teda", pcb: "b" }) },
      {
        text: "version 0.10\nsymbol s\n",
        run: (text) => parseSymbol(`${text}\npins\n  1  0 0  0\n`, { file: "s.teda", library: "test" }),
      },
      {
        text: "version 0.10\nfootprint f\n",
        run: (text) => parseFootprint(`${text}\npads\n  1  smd  rect  0 0  1 1\n`, { file: "f.teda", library: "test" }),
      },
    ];
    for (const { text, run } of cases) {
      const result = run(text);
      expect({ text, ok: result.ok }).toEqual({ text, ok: false });
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["format.unsupported-version"]);
    }
    expect(parsePcb("version 0.13\npcb b\n", { file: "b.teda", pcb: "b" }).diagnostics.map((d) => d.code)).toEqual([
      "format.unsupported-version",
    ]);
  });

  test("a component file with a version the tool does not implement is rejected", () => {
    const result = readComponentFacts("version 9.9\ncomponent c\n", { file: "c.teda" });
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]!.code).toBe("format.unsupported-version");
  });
});
