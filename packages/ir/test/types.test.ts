// Type-level assertions: the generated TS types must line up with the contract.
// A missing required field or a misspelled literal fails to compile here (@ts-expect-error errors when the type widens).
import { expect, test } from "bun:test";
import { validate } from "../src/index.ts";
import type { Schematic } from "../src/generated/types/schematic.ts";
import type { Component } from "../src/generated/types/component.ts";
import type { Pcb } from "../src/generated/types/pcb.ts";

const minimalSchematic: Schematic = {
  ir_version: "0.9",
  format: "0.7",
  board: "demo",
  instances: [],
  nets: [],
};

// @ts-expect-error ir_version is currently only 0.9; once the type widens, this assertion fails to compile
const wrongVersion: Schematic = { ...minimalSchematic, ir_version: "0.2" };

const minimalComponent: Component = {
  ir_version: "0.9",
  component: {
    id: "res-thick-0402",
    kind: "generic",
    construction: "thick_film",
    polarized: false,
    symbol: "kicad:Device:R",
    footprint: "kicad:Resistor_SMD:R_0402_1005Metric",
    pins: [{ number: "1", name: "A", electrical_type: "passive" }],
    pins_source: "inline",
  },
};

const wrongPinsSource: Component = {
  ...minimalComponent,
  // @ts-expect-error pins_source is an enum, not a free string
  component: { ...minimalComponent.component, pins_source: "nope" },
};

const minimalPcb: Pcb = {
  ir_version: "0.9",
  format: "0.7",
  board: "demo",
  board_thickness_nm: 1600000,
  stackup: [
    { layer: "F.Cu", type: "copper", thickness_nm: 35000, kind: "signal" },
    { layer: "B.Cu", type: "copper", thickness_nm: 35000, kind: "signal" },
  ],
  outline: [
    { x_nm: 0, y_nm: 0 },
    { x_nm: 20000000, y_nm: 0 },
    { x_nm: 0, y_nm: 15000000 },
  ],
  place: [],
  connect: [],
  rules: [{ type: "clearance", value_nm: 200000 }],
};

test("generated types match the contract", () => {
  expect(validate("schematic", minimalSchematic).ok).toBe(true);
  expect(validate("component", minimalComponent).ok).toBe(true);
  expect(validate("pcb", minimalPcb).ok).toBe(true);
  expect(String(wrongVersion.ir_version)).toBe("0.2");
  expect(String(wrongPinsSource.component.pins_source)).toBe("nope");
});

// Every definition in `$defs` must get a named type: they are the contract surface for third-party implementations.
// Regression point: adding a sibling `description` to a `$ref` makes json-schema-to-typescript inline the reference,
// and the name silently disappears (the generator holds the line with `unreachableDefinitions`, see ADR-0019).
test("every definition in the contract has a named type", async () => {
  const text = await Bun.file(
    new URL("../src/generated/types/schematic.ts", import.meta.url),
  ).text();
  const names = new Set(Array.from(text.matchAll(/^export type (\w+) =/gm), (m) => m[1]));
  for (const expected of ["Slug", "NetOrPinRef", "InstanceId", "Note", "IrVersion"]) {
    expect(names.has(expected)).toBe(true);
  }
});
