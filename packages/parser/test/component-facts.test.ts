// Unit tests for the `component` facts projection: covers only the part needed for symbol export.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { readComponentFacts } from "../src/index.ts";

const example = readFileSync(
  "examples/reference-project/assets/components/power/bq24610rger.teda",
  "utf8",
);

/** A minimal valid part file, with the given extra lines. */
function part(...extra: string[]): string {
  return [
    "version 0.1.1",
    "component c",
    "",
    "kind part",
    "mpn C-PART",
    "symbol project:s",
    "footprint project:f",
    ...extra,
    "",
  ].join("\n");
}

describe("component facts projection", () => {
  test("reads pin table, footprint, datasheet and description", () => {
    const result = readComponentFacts(example, { file: "x.teda" });
    expect(result.diagnostics).toEqual([]);
    expect(result.ok).toBe(true);
    const facts = result.facts!;
    expect(facts.id).toBe("bq24610rger");
    expect(facts.pins.length).toBe(25);
    expect(facts.pins[0]).toEqual({ number: "1", name: "ACN", type: "input" });
    expect(facts.footprint).toBe("vqfn:vqfn-24-ep");
    expect(facts.datasheet).toContain("bq24610");
  });

  test("optional trailing columns unit / alt are accepted", () => {
    const text = part(
      "pins",
      "  1  OUT  output  unit=2",
      "  2  IN   input   alt=AUX",
    );
    const result = readComponentFacts(text, { file: "x.teda" });
    expect(result.diagnostics).toEqual([]);
    expect(result.facts!.pins.length).toBe(2);
  });

  test("unknown trailing column reports an error", () => {
    const text = part("pins", "  1  IN  input  colour=red");
    const result = readComponentFacts(text, { file: "x.teda" });
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]!.code).toBe("value.pin-column-invalid");
  });

  test("duplicate pin number reports an error", () => {
    const text = part("pins", "  1  IN  input", "  1  OUT output");
    const result = readComponentFacts(text, { file: "x.teda" });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "library.duplicate-pin-number")).toBe(true);
  });

  test("unknown electrical type reports an error", () => {
    const text = part("pins", "  1  IN  weird");
    const result = readComponentFacts(text, { file: "x.teda" });
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]!.code).toBe("value.electrical-type-unknown");
  });

  test("omitting pins (delegating to a third-party library) is rejected on the symbol export path", () => {
    const text = [
      "version 0.1.1",
      "component res-thick-0402",
      "",
      "kind part",
      "mpn C-PART",
      "symbol kicad:Device:R",
      "footprint project:f",
      "",
    ].join("\n");
    const result = readComponentFacts(text, { file: "x.teda" });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "library.pins-empty")).toBe(true);
  });

  test("type line that is not component reports an error", () => {
    const result = readComponentFacts("version 0.1\nsymbol s\n", { file: "x.teda" });
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]!.code).toBe("syntax.header-invalid");
  });
});
