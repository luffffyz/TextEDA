// Unit tests for the language version module (teda.md §13, ADR-0022).
//
// The rules under test: the grammar is MAJOR.MINOR[.PATCH]; the patch component is optional and
// means zero when omitted; a patch never changes the acceptance decision; 1.0 is a milestone.
import { describe, expect, test } from "bun:test";
import { checkVersion, compareVersions, formatVersion, parseVersion, typeRange } from "../src/version.ts";
import { parseView } from "../src/view.ts";
import { parseSchematicDocument } from "../src/schematic.ts";
import { readComponentFacts } from "../src/component-facts.ts";

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
  const range = typeRange(6);

  test("accepts the required version and any of its patches", () => {
    for (const text of ["0.6", "0.6.0", "0.6.1", "0.6.99"]) {
      const verdict = checkVersion(text, range, "view");
      expect({ text, ok: verdict.ok }).toEqual({ text, ok: true });
    }
  });

  test("rejects a version below the type's introduction", () => {
    const verdict = checkVersion("0.5.3", range, "view");
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.code).toBe("format.unsupported-version");
  });

  test("rejects a version the tool does not implement", () => {
    const verdict = checkVersion("0.7", range, "view");
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.code).toBe("format.unsupported-version");
  });

  test("a type accepts any version up to the language version the tool supports", () => {
    // The upper bound is the language version, not the version that introduced the type: a symbol
    // file written today may declare the current language version.
    const symbol = typeRange(5);
    expect(checkVersion("0.6", symbol, "symbol").ok).toBe(true);
    expect(checkVersion("0.6.4", symbol, "symbol").ok).toBe(true);
    expect(checkVersion("0.4", symbol, "symbol").ok).toBe(false);
  });

  test("rejects a malformed version as an invalid version, not an unsupported one", () => {
    const verdict = checkVersion("zero", range, "view");
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.code).toBe("format.invalid-version");
  });
});

describe("parsers accept a patch version", () => {
  test("a view file may declare a patch version and the IR keeps it", () => {
    const source = "version 0.6.1\nview main\n\nplace\n  U1  10.0  10.0\n";
    const result = parseView(source, { file: "v.teda", board: "b" });
    expect(result.diagnostics).toEqual([]);
    expect(result.ir!.format).toBe("0.6.1");
  });

  test("the patch is canonicalized: 0.6.0 is stored as 0.6", () => {
    const source = "version 0.6.0\nview main\n\nplace\n  U1  10.0  10.0\n";
    const result = parseView(source, { file: "v.teda", board: "b" });
    expect(result.ir!.format).toBe("0.6");
  });

  test("a schematic file may declare a patch version", () => {
    const result = parseSchematicDocument("version 0.3.4\nschematic b\n", { file: "b.teda", kind: "schematic" });
    expect(result.ok).toBe(true);
    expect(result.doc!.version).toBe("0.3.4");
  });

  test("a schematic file may declare the current language version", () => {
    // The upper bound is the language version the tool supports, not the version that introduced
    // the type: a board written today declares 0.6, not 0.3.
    const result = parseSchematicDocument("version 0.6\nschematic b\n", { file: "b.teda", kind: "schematic" });
    expect(result.ok).toBe(true);
  });

  test("a page file below the version that introduced the page type is rejected", () => {
    const result = parseSchematicDocument("version 0.2\npage p\n", { file: "p.teda", kind: "page" });
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]!.code).toBe("format.unsupported-version");
  });

  test("a component file with a version the tool does not implement is rejected", () => {
    const result = readComponentFacts("version 9.9\ncomponent c\n", { file: "c.teda" });
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]!.code).toBe("format.unsupported-version");
  });
});
