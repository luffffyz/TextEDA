// Unit tests for the `component` description type: the part/generic rules (ADR-0024, ADR-0024).
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseComponent } from "../src/component.ts";

/** A device file with the given scalars and sections (each section is a list of lines). */
function device(scalars: string[], ...sections: (string[] | string)[]): string {
  const version = typeof sections[sections.length - 1] === "string" ? (sections.pop() as string) : "0.1.2";
  return [
    `version ${version}`,
    "component dev",
    "",
    ...scalars,
    "",
    ...sections.flatMap((section) => [...(section as string[]), ""]),
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
// A complete mlcc specification (ADR-0025): the required set of a construction is what a
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

describe("the device rule table (ADR-0025)", () => {
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

describe("a part's own ratings (ADR-0026)", () => {
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
    // The canonical unit of the type (ADR-0006 decision 7): fF, ppm, µV.
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

  test("a ratings row names the two pins its rating is about (ADR-0026 D4)", () => {
    // The pair is written as pin numbers and reaches the IR: a rating that says which pins it is
    // about can be compared with the window the design declares.
    const result = parseComponent(
      device(PART_SCALARS, ["ratings", "  voltage  voltage  36V  1 2"], PINS, "0.15"),
      { file: "x.teda" },
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.component!.ratings[0]).toMatchObject({
      name: "voltage",
      type: "voltage",
      value: 36_000_000,
      terminals: { from: "1", to: "2" },
    });
  });

  test("a ratings row with four columns is an error", () => {
    const result = parseComponent(
      device(PART_SCALARS, ["ratings", "  voltage  voltage  36V  1"], PINS, "0.15"),
      { file: "x.teda" },
    );
    expect(result.ok).toBe(false);
    const diagnostic = result.diagnostics.find((d) => d.code === "syntax.column-count");
    expect(diagnostic).toBeDefined();
    expect(diagnostic!.message).toContain("3 or 5 columns");
  });

  test("a terminal that is not a pin of the part is an error", () => {
    // A name may be reused (`GND` on a multi-unit part), so the pair is written as pin numbers;
    // a terminal the part does not have is a fact about nothing.
    const result = parseComponent(
      device(PART_SCALARS, ["ratings", "  voltage  voltage  36V  1 9"], PINS, "0.15"),
      { file: "x.teda" },
    );
    expect(result.ok).toBe(false);
    const diagnostic = result.diagnostics.find((d) => d.code === "value.component-rating-terminal-invalid");
    expect(diagnostic).toBeDefined();
    expect(diagnostic!.actual).toBe("9");
  });

  test("a rating that names one pin twice is an error", () => {
    const result = parseComponent(
      device(PART_SCALARS, ["ratings", "  voltage  voltage  36V  1 1"], PINS, "0.15"),
      { file: "x.teda" },
    );
    expect(result.ok).toBe(false);
    const diagnostic = result.diagnostics.find((d) => d.code === "value.component-rating-terminal-invalid");
    expect(diagnostic).toBeDefined();
    expect(diagnostic!.message).toContain("one pin twice");
  });

  test("the terminal pair needs language 0.15", () => {
    // A file below that version has no such column, so the row is not read.
    const result = parseComponent(
      device(PART_SCALARS, ["ratings", "  voltage  voltage  36V  1 2"], PINS, "0.14"),
      { file: "x.teda" },
    );
    expect(result.ok).toBe(false);
    const diagnostic = result.diagnostics.find((d) => d.code === "syntax.unknown-field");
    expect(diagnostic).toBeDefined();
    expect(diagnostic!.hint).toContain("language 0.15");
  });

  test("a rating measured in a class carries no terminal pair", () => {
    // A colour has no polarity: there is no pair of pins it is about, and the IR has nowhere to put
    // one. The row is refused rather than quietly losing two columns.
    const result = parseComponent(
      device(PART_SCALARS, ["ratings", "  value  string  green  1 2"], PINS, "0.16"),
      { file: "x.teda" },
    );
    expect(result.ok).toBe(false);
    const diagnostic = result.diagnostics.find((d) => d.code === "syntax.column-count");
    expect(diagnostic).toBeDefined();
    expect(diagnostic!.message).toContain("no terminal pair");
  });

  test("a rating measured in a class reaches the IR as text", () => {
    // The contract's `rating` is a union of the two shapes: `value` for a quantity, `text` for a
    // class (ADR-0077 D4).
    const result = parseComponent(
      device(PART_SCALARS, ["ratings", "  value  string  green"], PINS, "0.16"),
      { file: "x.teda" },
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.ir!.component.ratings).toEqual([{ name: "value", type: "string", text: "green" }]);
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
    // The parts and the generics live in one tree (ADR-0024).
    const files = tedaFiles(join(root, "assets/components"));
    expect(files.length).toBeGreaterThan(0);
    for (const path of files) {
      const result = parseComponent(readFileSync(path, "utf8"), { file: path });
      expect(result.diagnostics).toEqual([]);
      expect(result.ok).toBe(true);
    }
  });
});

// A file carries its own revision (ADR-0034): the release in which *its* facts were last
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

describe("the closed vocabularies grow with the language (ADR-0077 D5)", () => {
  const BARREL_SCALARS = [
    "kind generic",
    "category connector",
    "construction barrel",
    "polarized yes",
    "symbol project:s",
    "footprint project:f",
  ];
  const BARREL_PARAMS = [
    "params",
    "  value         length  required",
    "  rated_current current  required",
    "  voltage       voltage  required",
  ];

  test("a construction that arrived in 0.16 is refused in an older file", () => {
    // The file's version line declares the surface it is written against, so a 0.15 file has no
    // `barrel` in its vocabulary and may not name it.
    const result = parseComponent(
      device(BARREL_SCALARS, BARREL_PARAMS, PINS, "0.15"),
      { file: "x.teda" },
    );
    expect(result.ok).toBe(false);
    const diagnostic = result.diagnostics.find((d) => d.code === "value.component-construction-invalid");
    expect(diagnostic).toBeDefined();
    expect(diagnostic!.message).toContain("arrived in language 0.16");
  });

  test("the same file is accepted from 0.16 on", () => {
    const result = parseComponent(
      device(BARREL_SCALARS, BARREL_PARAMS, PINS, "0.16"),
      { file: "x.teda" },
    );
    expect(result.diagnostics).toEqual([]);
  });

  test("a role that arrived in 0.16 is refused in an older file", () => {
    const result = parseComponent(
      device(PART_SCALARS, ["ratings", "  wavelength  length  565nm"], PINS, "0.15"),
      { file: "x.teda" },
    );
    expect(result.ok).toBe(false);
    const diagnostic = result.diagnostics.find((d) => d.code === "value.component-rating-invalid");
    expect(diagnostic).toBeDefined();
    expect(diagnostic!.message).toContain("arrived in language 0.16");
  });

  test("a construction that was always in the vocabulary is accepted in any version", () => {
    // The gate is on the member, not on the file: an `mlcc` was in the vocabulary from the start.
    const result = parseComponent(
      device(GENERIC_SCALARS, VALUE_PARAM, PINS, "0.15"),
      { file: "x.teda" },
    );
    expect(result.diagnostics).toEqual([]);
  });
});

describe("the polarity of a generic or part (ADR-0078, ADR-0080)", () => {
  const POLARIZED_SCALARS = [
    "kind generic",
    "category capacitor",
    "construction tantalum",
    "polarized yes",
    "positive_pin 1",
    "symbol project:c",
    "footprint project:f",
  ];
  const TANTALUM_PARAMS = [
    "params",
    "  value      capacitance  required",
    "  tolerance  percent      required",
    "  voltage    voltage      required",
    "  esr        resistance   optional",
  ];
  const POLES = ["pins", "  1  P  polarized", "  2  N  polarized"];

  test("a polarised class names its positive pole, and the fact reaches the IR", () => {
    const result = parseComponent(
      device(POLARIZED_SCALARS, TANTALUM_PARAMS, POLES, "0.17"),
      { file: "x.teda" },
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.ir!.component.positive_pin).toBe("1");
  });

  test("a polarised class must name its positive pole from 0.17 on", () => {
    const result = parseComponent(
      device(POLARIZED_SCALARS.filter((line) => !line.startsWith("positive_pin")), TANTALUM_PARAMS, POLES, "0.17"),
      { file: "x.teda" },
    );
    expect(result.ok).toBe(false);
    const diagnostic = result.diagnostics.find((d) => d.code === "value.component-generic-fact-invalid");
    expect(diagnostic).toBeDefined();
    expect(diagnostic!.message).toContain("positive pin");
  });

  test("a class written against an older language may not name one", () => {
    // The fact arrived in 0.17: a 0.16 file has no such fact in its vocabulary.
    const result = parseComponent(
      device(POLARIZED_SCALARS, TANTALUM_PARAMS, POLES, "0.16"),
      { file: "x.teda" },
    );
    expect(result.ok).toBe(false);
    const diagnostic = result.diagnostics.find((d) => d.code === "value.component-positive-pin-invalid");
    expect(diagnostic).toBeDefined();
    expect(diagnostic!.message).toContain("0.17");
  });

  test("a polarised class written against an older language is still legal", () => {
    // It says only that it is polarised: the requirement is read as a magnitude, the way the
    // language read it before.
    const result = parseComponent(
      device(POLARIZED_SCALARS.filter((line) => !line.startsWith("positive_pin")), TANTALUM_PARAMS, POLES, "0.16"),
      { file: "x.teda" },
    );
    expect(result.diagnostics).toEqual([]);
  });

  test("an unpolarised class must not name a positive pole", () => {
    const result = parseComponent(
      device([...GENERIC_SCALARS, "positive_pin 1"], VALUE_PARAM, PINS, "0.17"),
      { file: "x.teda" },
    );
    expect(result.ok).toBe(false);
    const diagnostic = result.diagnostics.find((d) => d.code === "value.component-generic-fact-invalid");
    expect(diagnostic).toBeDefined();
    expect(diagnostic!.message).toContain("unpolarised");
  });

  test("a part may name its own positive pole from 0.18, and the fact reaches the IR", () => {
    const result = parseComponent(
      device([...PART_SCALARS, "positive_pin 1"], POLES, "0.18"),
      { file: "x.teda" },
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.ir!.component.positive_pin).toBe("1");
  });

  test("a part positive pin is refused before language 0.18", () => {
    const result = parseComponent(
      device([...PART_SCALARS, "positive_pin 1"], POLES, "0.17"),
      { file: "x.teda" },
    );
    expect(result.ok).toBe(false);
    const diagnostic = result.diagnostics.find((d) => d.code === "value.component-positive-pin-invalid");
    expect(diagnostic).toBeDefined();
    expect(diagnostic!.message).toContain("0.18");
  });

  test("a part's named positive pole must be typed polarized", () => {
    const result = parseComponent(
      device([...PART_SCALARS, "positive_pin 1"], PINS, "0.18"),
      { file: "x.teda" },
    );
    expect(result.ok).toBe(false);
    const diagnostic = result.diagnostics.find((d) => d.code === "value.component-positive-pin-invalid");
    expect(diagnostic).toBeDefined();
    expect(diagnostic!.message).toContain("not polarized");
  });

  test("the named pole must be a pin of the class", () => {
    const result = parseComponent(
      device([...POLARIZED_SCALARS.slice(0, 4), "positive_pin 3", ...POLARIZED_SCALARS.slice(5)], TANTALUM_PARAMS, POLES, "0.17"),
      { file: "x.teda" },
    );
    expect(result.ok).toBe(false);
    const diagnostic = result.diagnostics.find((d) => d.code === "value.component-positive-pin-invalid");
    expect(diagnostic).toBeDefined();
    expect(diagnostic!.message).toContain("not a pin");
  });

  test("the named pole must be typed polarized", () => {
    const result = parseComponent(
      device(POLARIZED_SCALARS, TANTALUM_PARAMS, ["pins", "  1  P  passive", "  2  N  polarized"], "0.17"),
      { file: "x.teda" },
    );
    expect(result.ok).toBe(false);
    const diagnostic = result.diagnostics.find((d) => d.code === "value.component-positive-pin-invalid");
    expect(diagnostic).toBeDefined();
    expect(diagnostic!.message).toContain("not polarized");
  });

  test("a class must have exactly two poles", () => {
    const result = parseComponent(
      device(POLARIZED_SCALARS, TANTALUM_PARAMS, ["pins", "  1  P  polarized", "  2  N  polarized", "  3  X  polarized"], "0.17"),
      { file: "x.teda" },
    );
    expect(result.ok).toBe(false);
    const diagnostic = result.diagnostics.find((d) => d.code === "value.component-positive-pin-invalid");
    expect(diagnostic).toBeDefined();
    expect(diagnostic!.message).toContain("two poles");
  });

  test("a class with one pole has no pair, so it cannot name one", () => {
    const result = parseComponent(
      device(POLARIZED_SCALARS, TANTALUM_PARAMS, ["pins", "  1  P  polarized", "  2  N  passive"], "0.17"),
      { file: "x.teda" },
    );
    expect(result.ok).toBe(false);
    const diagnostic = result.diagnostics.find((d) => d.code === "value.component-positive-pin-invalid");
    expect(diagnostic).toBeDefined();
    expect(diagnostic!.message).toContain("two poles");
  });
});
