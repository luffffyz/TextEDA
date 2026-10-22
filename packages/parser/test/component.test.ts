// Unit tests for the `component` description type: the part/family rules (ADR-0027).
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseComponent } from "../src/component.ts";

/** A device file with the given scalars and sections (each section is a list of lines). */
function device(scalars: string[], ...sections: string[][]): string {
  return [
    "version 0.1.2",
    "component dev",
    "",
    ...scalars,
    "",
    ...sections.flatMap((section) => [...section, ""]),
  ].join("\n");
}

const PART_SCALARS = ["kind part", "mpn C-PART", "symbol project:s", "footprint project:f"];
const FAMILY_SCALARS = [
  "kind family",
  "category capacitor",
  "construction mlcc",
  "polarized no",
  "symbol project:c",
  "footprint project:f",
];
const PINS = ["pins", "  1  A  passive", "  2  B  passive"];
const VALUE_PARAM = ["params", "  value  capacitance  required"];

describe("the removed package field", () => {
  test("a `package` line is an error that points at the migration, not an unknown key", () => {
    const result = parseComponent(
      device([...PART_SCALARS, "package 0402"], PINS),
      { file: "x.teda" },
    );
    expect(result.ok).toBe(false);
    const diagnostic = result.diagnostics.find((d) => d.code === "syntax.removed-construct");
    expect(diagnostic).toBeDefined();
    expect(diagnostic!.message).toContain("package");
    expect(diagnostic!.hint).toContain("package_code");
  });

  test("the package code is not a parameter column either", () => {
    const result = parseComponent(
      device([...FAMILY_SCALARS], ["params", "  value  capacitance  required", "  package  string  optional"], PINS),
      { file: "x.teda" },
    );
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "value.component-param-reserved")).toBe(true);
  });
});

describe("component kind", () => {
  test("a part needs a manufacturer part number", () => {
    const result = parseComponent(
      device(["kind part", "symbol project:s", "footprint project:f"], PINS),
      { file: "x.teda" },
    );
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "value.component-mpn-invalid")).toBe(true);
  });

  test("a family must not name a part", () => {
    const result = parseComponent(
      device([...FAMILY_SCALARS, "mpn C-PART"], VALUE_PARAM, PINS),
      { file: "x.teda" },
    );
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "value.component-mpn-invalid")).toBe(true);
  });

  test("the kind is never inferred: a file without one is rejected", () => {
    const result = parseComponent(
      device(["mpn C-PART", "symbol project:s", "footprint project:f"], PINS),
      { file: "x.teda" },
    );
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "value.component-kind-invalid")).toBe(true);
  });

  test("a family needs its construction and its polarity", () => {
    const result = parseComponent(
      device(
        ["kind family", "symbol project:c", "footprint project:f"],
        VALUE_PARAM,
        PINS,
      ),
      { file: "x.teda" },
    );
    expect(result.ok).toBe(false);
    const codes = result.diagnostics.map((d) => d.code);
    expect(codes.filter((c) => c === "value.component-family-fact-invalid").length).toBe(2);
  });

  test("construction and polarity are family facts, not part facts", () => {
    const result = parseComponent(
      device([...PART_SCALARS, "construction mlcc", "polarized no"], PINS),
      { file: "x.teda" },
    );
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "value.component-family-fact-invalid")).toBe(
      true,
    );
  });
});

describe("component identity", () => {
  test("a part's identity is closed: it declares no parameters", () => {
    const result = parseComponent(device(PART_SCALARS, VALUE_PARAM, PINS), { file: "x.teda" });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "value.component-identity-invalid")).toBe(true);
  });

  test("a family needs a required value parameter", () => {
    const result = parseComponent(
      device(FAMILY_SCALARS, ["params", "  tolerance  percent  optional"], PINS),
      { file: "x.teda" },
    );
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "value.component-identity-invalid")).toBe(true);
  });

  test("the package and the footprint are fixed attributes, never parameters", () => {
    const result = parseComponent(
      device(
        FAMILY_SCALARS,
        ["params", "  value  capacitance  required", "  package  string  optional"],
        PINS,
      ),
      { file: "x.teda" },
    );
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "value.component-param-reserved")).toBe(true);
  });

  test("required parameters come before optional ones", () => {
    const result = parseComponent(
      device(
        FAMILY_SCALARS,
        ["params", "  tolerance  percent  optional", "  value  capacitance  required"],
        PINS,
      ),
      { file: "x.teda" },
    );
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "value.component-param-order")).toBe(true);
  });
});

describe("the reference project's devices", () => {
  const root = "examples/reference-project";

  test("every part and every family parses", () => {
    for (const dir of ["assets/components", "assets/families"]) {
      for (const name of readdirSync(join(root, dir))) {
        const path = join(root, dir, name);
        if (!name.endsWith(".teda")) continue;
        const result = parseComponent(readFileSync(path, "utf8"), { file: path });
        expect(result.diagnostics).toEqual([]);
        expect(result.ok).toBe(true);
      }
    }
  });
});
