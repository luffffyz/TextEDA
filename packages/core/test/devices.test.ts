// The device rule table (ADR-0025): pure functions over facts, no text parsing, no filesystem.
//
// The table is the tool-side half of the closed device vocabulary: the constructions, the roles
// each construction accepts, and the closed value sets. These tests pin the behaviour that a
// typo must not survive: an unknown construction, a foreign role, a wrong quantity, a wrong
// requiredness, a missing role, and a spelling outside a closed value set.
import { describe, expect, test } from "bun:test";
import {
  checkDeviceDeclaration,
  checkDeviceParamValue,
  DEVICE_CONSTRUCTIONS,
  DEVICE_PARAM_VALUE_SETS,
  type DeviceDeclarationFacts,
  type DeviceParamFact,
} from "../src/index.ts";

/** A parameter column at a given position. */
function param(name: string, type: string, required: boolean, line = 10): DeviceParamFact {
  return { name, type, required, line, col: 3 };
}

/** A generic's declaration facts, with the given construction and parameter columns. */
function facts(construction: string, params: DeviceParamFact[]): DeviceDeclarationFacts {
  return { file: "assets/components/x.teda", construction, constructionLine: 6, constructionCol: 1, params };
}

describe("the rule table", () => {
  test("every construction has a value role of the right quantity", () => {
    for (const [name, rule] of Object.entries(DEVICE_CONSTRUCTIONS)) {
      const value = rule.roles.find((r) => r.name === "value");
      expect(value, name).toBeDefined();
      expect(value!.type).toBe(rule.primary);
      expect(value!.required).toBe(true);
    }
  });

  test("required roles come before optional ones (the instance row's column order)", () => {
    for (const [name, rule] of Object.entries(DEVICE_CONSTRUCTIONS)) {
      const optional = rule.roles.findIndex((r) => !r.required);
      if (optional < 0) continue;
      expect(rule.roles.findIndex((r, i) => i > optional && r.required), name).toBe(-1);
    }
  });

  test("the closed value sets have no duplicates", () => {
    for (const [role, set] of Object.entries(DEVICE_PARAM_VALUE_SETS)) {
      expect(new Set(set).size, role).toBe(set.length);
    }
  });
});

describe("declaration checks", () => {
  test("a compliant declaration produces no diagnostics", () => {
    expect(
      checkDeviceDeclaration(
        facts("mlcc", [
          param("value", "capacitance", true),
          param("tolerance", "percent", true),
          param("voltage", "voltage", true),
          param("dielectric", "string", true),
        ]),
      ),
    ).toEqual([]);
  });

  test("an unknown construction is an error, not a warning", () => {
    const diagnostics = checkDeviceDeclaration(facts("Tantalum", [param("value", "capacitance", true)]));
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.code).toBe("value.component-construction-invalid");
    expect(diagnostics[0]!.severity).toBe("error");
    expect(diagnostics[0]!.actual).toBe("Tantalum");
  });

  test("a role that is not the construction's is an error", () => {
    const diagnostics = checkDeviceDeclaration(
      facts("mlcc", [
        param("value", "capacitance", true),
        param("tolerance", "percent", true),
        param("voltage", "voltage", true),
        param("dielectric", "string", true),
        param("esr", "resistance", false),
      ]),
    );
    expect(diagnostics.map((d) => d.code)).toEqual(["value.component-param-invalid"]);
    expect(diagnostics[0]!.message).toContain("esr");
  });

  test("the wrong quantity for a role is an error", () => {
    const diagnostics = checkDeviceDeclaration(
      facts("mlcc", [
        param("value", "resistance", true),
        param("tolerance", "percent", true),
        param("voltage", "voltage", true),
        param("dielectric", "string", true),
      ]),
    );
    expect(diagnostics.map((d) => d.code)).toEqual(["value.component-param-invalid"]);
    expect(diagnostics[0]!.expected).toBe("capacitance");
    expect(diagnostics[0]!.actual).toBe("resistance");
  });

  test("a required role declared optional is an error", () => {
    const diagnostics = checkDeviceDeclaration(
      facts("mlcc", [
        param("value", "capacitance", true),
        param("tolerance", "percent", true),
        param("voltage", "voltage", false),
        param("dielectric", "string", true),
      ]),
    );
    expect(diagnostics.map((d) => d.code)).toEqual(["value.component-param-invalid"]);
    expect(diagnostics[0]!.expected).toBe("required");
    expect(diagnostics[0]!.actual).toBe("optional");
  });

  test("a missing required role is an error", () => {
    const diagnostics = checkDeviceDeclaration(
      facts("mlcc", [
        param("value", "capacitance", true),
        param("tolerance", "percent", true),
        param("voltage", "voltage", true),
      ]),
    );
    expect(diagnostics.map((d) => d.code)).toEqual(["value.component-param-invalid"]);
    expect(diagnostics[0]!.message).toContain("dielectric");
  });

  test("a part (no construction) is not checked", () => {
    expect(checkDeviceDeclaration({ file: "x.teda", params: [] })).toEqual([]);
  });
});

describe("value checks", () => {
  const at = { file: "design/sch/b.teda", line: 12, col: 5 };

  test("a member of the closed set is accepted", () => {
    expect(checkDeviceParamValue("dielectric", "X7R", at)).toEqual([]);
  });

  test("a spelling outside the closed set is an error", () => {
    const diagnostics = checkDeviceParamValue("dielectric", "X7r", at);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.code).toBe("value.component-param-value-invalid");
    expect(diagnostics[0]!.actual).toBe("X7r");
  });

  test("a role without a value set accepts any text", () => {
    expect(checkDeviceParamValue("value", "whatever", at)).toEqual([]);
  });
});
