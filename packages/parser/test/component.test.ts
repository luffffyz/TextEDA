// Unit tests for the `component` description type: the part/generic rules (ADR-0123, ADR-0123).
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
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
const GENERIC_SCALARS = [
  "kind generic",
  "category capacitor",
  "construction mlcc",
  "polarized no",
  "symbol project:c",
  "footprint project:f",
];
const PINS = ["pins", "  1  A  passive", "  2  B  passive"];
// A complete mlcc specification (ADR-0124): the required set of a construction is what a
// purchasing document says about it.
const VALUE_PARAM = [
  "params",
  "  value      capacitance  required",
  "  tolerance  percent      required",
  "  voltage    voltage      required",
  "  dielectric string       required",
];

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
      device([...GENERIC_SCALARS], ["params", "  value  capacitance  required", "  package  string  optional"], PINS),
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

  test("a generic must not name a part", () => {
    const result = parseComponent(
      device([...GENERIC_SCALARS, "mpn C-PART"], VALUE_PARAM, PINS),
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

  test("a generic needs its construction and its polarity", () => {
    const result = parseComponent(
      device(
        ["kind generic", "symbol project:c", "footprint project:f"],
        VALUE_PARAM,
        PINS,
      ),
      { file: "x.teda" },
    );
    expect(result.ok).toBe(false);
    const codes = result.diagnostics.map((d) => d.code);
    expect(codes.filter((c) => c === "value.component-generic-fact-invalid").length).toBe(2);
  });

  test("construction and polarity are generic facts, not part facts", () => {
    const result = parseComponent(
      device([...PART_SCALARS, "construction mlcc", "polarized no"], PINS),
      { file: "x.teda" },
    );
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "value.component-generic-fact-invalid")).toBe(
      true,
    );
  });

  test("the removed `family` kind value is an error that points at the migration", () => {
    const result = parseComponent(
      device(
        ["kind family", "category capacitor", "construction mlcc", "polarized no", "symbol project:c", "footprint project:f"],
        VALUE_PARAM,
        PINS,
      ),
      { file: "x.teda" },
    );
    expect(result.ok).toBe(false);
    const diagnostic = result.diagnostics.find((d) => d.code === "syntax.removed-construct");
    expect(diagnostic).toBeDefined();
    expect(diagnostic!.message).toContain("family");
    expect(diagnostic!.hint).toContain("generic");
  });
});

describe("component identity", () => {
  test("a part's identity is closed: it declares no parameters", () => {
    const result = parseComponent(device(PART_SCALARS, VALUE_PARAM, PINS), { file: "x.teda" });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "value.component-identity-invalid")).toBe(true);
  });

  test("a generic needs a required value parameter", () => {
    const result = parseComponent(
      device(GENERIC_SCALARS, ["params", "  tolerance  percent  optional"], PINS),
      { file: "x.teda" },
    );
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "value.component-identity-invalid")).toBe(true);
  });

  test("the package and the footprint are fixed attributes, never parameters", () => {
    const result = parseComponent(
      device(
        GENERIC_SCALARS,
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
        GENERIC_SCALARS,
        ["params", "  tolerance  percent  optional", "  value  capacitance  required"],
        PINS,
      ),
      { file: "x.teda" },
    );
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "value.component-param-order")).toBe(true);
  });
});

describe("the device rule table (ADR-0124)", () => {
  test("an unknown construction is an error that names the legal values", () => {
    const result = parseComponent(
      device(GENERIC_SCALARS.map((s) => s.replace("construction mlcc", "construction Tantalum")), VALUE_PARAM, PINS),
      { file: "x.teda" },
    );
    expect(result.ok).toBe(false);
    const diagnostic = result.diagnostics.find((d) => d.code === "value.component-construction-invalid");
    expect(diagnostic).toBeDefined();
    expect(diagnostic!.actual).toBe("Tantalum");
    expect(diagnostic!.expected).toContain("mlcc");
  });

  test("a missing required role is an error", () => {
    const result = parseComponent(
      device(
        GENERIC_SCALARS,
        ["params", "  value      capacitance  required", "  tolerance  percent      required"],
        PINS,
      ),
      { file: "x.teda" },
    );
    expect(result.ok).toBe(false);
    const diagnostic = result.diagnostics.find((d) => d.code === "value.component-param-invalid");
    expect(diagnostic).toBeDefined();
    expect(diagnostic!.message).toContain("voltage");
  });

  test("a required role declared optional is an error", () => {
    const result = parseComponent(
      device(
        GENERIC_SCALARS,
        [
          "params",
          "  value      capacitance  required",
          "  tolerance  percent      required",
          "  voltage    voltage      optional",
          "  dielectric string       required",
        ],
        PINS,
      ),
      { file: "x.teda" },
    );
    expect(result.ok).toBe(false);
    const diagnostic = result.diagnostics.find((d) => d.code === "value.component-param-invalid");
    expect(diagnostic).toBeDefined();
    expect(diagnostic!.expected).toBe("required");
  });
});

describe("a part's own ratings (ADR-0125)", () => {
  const RATINGS = [
    "ratings",
    "  value          capacitance  10uF",
    "  tolerance      percent      10%",
    "  voltage        voltage      16V",
    "  dielectric     string       X7R",
  ];

  test("a part states its ratings, and the values are canonical integers", () => {
    const result = parseComponent(device(PART_SCALARS, RATINGS, PINS), { file: "x.teda" });
    expect(result.diagnostics).toEqual([]);
    expect(result.ok).toBe(true);
    const ratings = result.component!.ratings;
    expect(ratings.map((r) => r.name)).toEqual(["value", "tolerance", "voltage", "dielectric"]);
    // The canonical unit of the type (ADR-0105 decision 7): fF, ppm, µV.
    expect(ratings[0]!.value).toBe(10_000_000_000);
    expect(ratings[1]!.value).toBe(100_000);
    expect(ratings[2]!.value).toBe(16_000_000);
    expect(ratings[3]!.value).toBe("X7R");
  });

  test("a part states its power rating", () => {
    // The power rating belongs to the package, but it is a fact of the part: it is stated here,
    // and the procurement layer compares it with the line's requirement.
    const result = parseComponent(
      device(PART_SCALARS, ["ratings", "  value      capacitance  10uF", "  power      power       62.5mW"], PINS),
      { file: "x.teda" },
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.component!.ratings[1]).toMatchObject({ name: "power", type: "power", value: 62_500 });
  });

  test("a generic states no ratings: a class has no ratings of its own", () => {
    const result = parseComponent(device(GENERIC_SCALARS, VALUE_PARAM, RATINGS, PINS), { file: "x.teda" });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "value.component-rating-invalid")).toBe(true);
  });

  test("a role outside the vocabulary is an error", () => {
    const result = parseComponent(
      device(PART_SCALARS, ["ratings", "  ripple  voltage  100mV"], PINS),
      { file: "x.teda" },
    );
    expect(result.ok).toBe(false);
    const diagnostic = result.diagnostics.find((d) => d.code === "value.component-rating-invalid");
    expect(diagnostic).toBeDefined();
    expect(diagnostic!.actual).toBe("ripple");
  });

  test("a role measured in the wrong quantity is an error", () => {
    const result = parseComponent(
      device(PART_SCALARS, ["ratings", "  voltage  percent  10%"], PINS),
      { file: "x.teda" },
    );
    expect(result.ok).toBe(false);
    const diagnostic = result.diagnostics.find((d) => d.code === "value.component-rating-invalid");
    expect(diagnostic).toBeDefined();
    expect(diagnostic!.expected).toBe("voltage");
    expect(diagnostic!.actual).toBe("percent");
  });

  test("the same rating written twice is an error", () => {
    const result = parseComponent(
      device(PART_SCALARS, ["ratings", "  voltage  voltage  16V", "  voltage  voltage  25V"], PINS),
      { file: "x.teda" },
    );
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "value.component-rating-invalid")).toBe(true);
  });

  test("a rating outside the closed value set is an error", () => {
    const result = parseComponent(
      device(PART_SCALARS, ["ratings", "  dielectric  string  X5R2"], PINS),
      { file: "x.teda" },
    );
    expect(result.ok).toBe(false);
    const diagnostic = result.diagnostics.find((d) => d.code === "value.component-rating-value-invalid");
    expect(diagnostic).toBeDefined();
    expect(diagnostic!.expected).toContain("X7R");
  });

  test("a rating value that is not a quantity is an error", () => {
    const result = parseComponent(
      device(PART_SCALARS, ["ratings", "  voltage  voltage  sixteen"], PINS),
      { file: "x.teda" },
    );
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "value.invalid-value")).toBe(true);
  });
});

describe("the reference project's devices", () => {
  const root = "examples/reference-project";

  /** Every `.teda` file under a directory, recursively. */
  function tedaFiles(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) out.push(...tedaFiles(path));
      else if (name.endsWith(".teda")) out.push(path);
    }
    return out;
  }

  test("every part and every generic parses", () => {
    // The parts and the generics live in one tree (ADR-0123).
    const files = tedaFiles(join(root, "assets/components"));
    expect(files.length).toBeGreaterThan(0);
    for (const path of files) {
      const result = parseComponent(readFileSync(path, "utf8"), { file: path });
      expect(result.diagnostics).toEqual([]);
      expect(result.ok).toBe(true);
    }
  });
});

// A file carries its own revision (ADR-0133): the release in which *its* facts were last
// established. Optional — a project that never imports from a library never needs one.
describe("the file revision", () => {
  test("`rev` is a scalar and reaches the IR", () => {
    const result = parseComponent(device(["rev 2.1.0"], PART_SCALARS, PINS), { file: "dev.teda" });
    expect(result.diagnostics.map((d) => d.code)).toEqual([]);
    expect(result.ir!.component.rev).toBe("2.1.0");
  });

  test("a fork marker is part of the value, not a second field", () => {
    const result = parseComponent(device(["rev 2.1.0+local.1"], PART_SCALARS, PINS), { file: "dev.teda" });
    expect(result.ir!.component.rev).toBe("2.1.0+local.1");
  });

  test("whitespace keeps it from being a revision", () => {
    const result = parseComponent(device(["rev 2.1 beta"], PART_SCALARS, PINS), { file: "dev.teda" });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((d) => d.code)).toContain("value.rev-invalid");
  });

  test("a file without one has no `rev` in the IR", () => {
    const result = parseComponent(device(PART_SCALARS, PINS), { file: "dev.teda" });
    expect(result.ir!.component.rev).toBeUndefined();
  });
});
