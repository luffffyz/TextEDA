import { describe, expect, test } from "bun:test";
import type { Schematic } from "@texteda/ir/schematic";
import type { SchematicView } from "@texteda/ir/schematic-view";
import {
  checkReadability,
  type ReadabilityFacts,
  type ReadabilityGeometry,
} from "../src/view/readability.ts";

const MM = 1_000_000;

const schematic: Schematic = {
  ir_version: "0.9",
  format: "0.8",
  board: "b",
  instances: [],
  nets: [
    { id: "GND", members: ["U1.2", "R1.2"] },
    { id: "VIN", members: ["U1.1"] },
  ],
  ports: [{ id: "VIN_PORT", net: "VIN" }],
};

/** U1 occupies 0..10mm square with pins on its left and right edges; R1 sits to its right. */
const geometry = (overrides: Partial<ReadabilityGeometry> = {}): ReadabilityGeometry => ({
  symbols: [
    {
      instance_id: "U1",
      box: { min_x_nm: 0, min_y_nm: 0, max_x_nm: 10 * MM, max_y_nm: 10 * MM },
      pins: new Map([
        ["1", { x_nm: 0, y_nm: 5 * MM }],
        ["2", { x_nm: 10 * MM, y_nm: 5 * MM }],
      ]),
    },
    {
      instance_id: "R1",
      box: { min_x_nm: 40 * MM, min_y_nm: 4 * MM, max_x_nm: 48 * MM, max_y_nm: 6 * MM },
      pins: new Map([["2", { x_nm: 40 * MM, y_nm: 5 * MM }]]),
    },
  ],
  texts: [],
  ...overrides,
});

const view = (wires: NonNullable<SchematicView["wire"]>, texts: { label?: unknown[]; port?: unknown[]; text?: unknown[] }): SchematicView =>
  ({
    ir_version: "0.9",
    format: "0.8",
    board: "b",
    page: "p",
    place: [],
    ...(wires.length > 0 ? { wire: wires } : {}),
    ...texts,
  }) as unknown as SchematicView;

const facts = (v: SchematicView, g: ReadabilityGeometry): ReadabilityFacts => ({
  file: "views/b/p.view.teda",
  view: v,
  schematic,
  geometry: g,
});

/** The GND wire runs from R1.2 (40,5) left to U1.2 (10,5). */
const gndWire = {
  net: "GND",
  from_pin: "R1.2",
  to_pin: "U1.2",
  line: 12,
};

describe("checkReadability", () => {
  test("a clean drawing reports nothing", () => {
    const g = geometry({
      texts: [
        {
          kind: "label",
          text: "GND",
          x_nm: 20 * MM,
          y_nm: 5 * MM,
          box: { min_x_nm: 20 * MM, min_y_nm: 4 * MM, max_x_nm: 25 * MM, max_y_nm: 6 * MM },
          line: 13,
          subject: "GND",
        },
      ],
    });
    expect(checkReadability(facts(view([gndWire], {}), g))).toEqual([]);
  });

  test("a label away from its net is reported", () => {
    const g = geometry({
      texts: [
        {
          kind: "label",
          text: "GND",
          x_nm: 20 * MM,
          y_nm: 30 * MM,
          box: { min_x_nm: 20 * MM, min_y_nm: 29 * MM, max_x_nm: 25 * MM, max_y_nm: 31 * MM },
          line: 13,
          subject: "GND",
        },
      ],
    });
    const out = checkReadability(facts(view([gndWire], {}), g));
    expect(out.map((d) => d.code)).toEqual(["view.label-not-on-net"]);
    expect(out[0]!.severity).toBe("warning");
    expect(out[0]!.location).toEqual({ file: "views/b/p.view.teda", line: 13, col: 1 });
  });

  test("a label on a net's wiring drawn on no page is not reported (the coverage check owns that gap)", () => {
    const g = geometry({
      texts: [
        {
          kind: "label",
          text: "GND",
          x_nm: 20 * MM,
          y_nm: 30 * MM,
          box: { min_x_nm: 20 * MM, min_y_nm: 29 * MM, max_x_nm: 25 * MM, max_y_nm: 31 * MM },
          line: 13,
          subject: "GND",
        },
      ],
    });
    expect(checkReadability(facts(view([], {}), g))).toEqual([]);
  });

  test("a label on a pin of a member counts as on the net", () => {
    const g = geometry({
      texts: [
        {
          kind: "label",
          text: "GND",
          x_nm: 40 * MM,
          y_nm: 5 * MM,
          box: { min_x_nm: 40 * MM, min_y_nm: 4 * MM, max_x_nm: 45 * MM, max_y_nm: 6 * MM },
          line: 13,
          subject: "GND",
        },
      ],
    });
    expect(checkReadability(facts(view([gndWire], {}), g))).toEqual([]);
  });

  test("a port away from the net it names is reported", () => {
    const vinWire = { net: "VIN", from_pin: "U1.1", to_pin: "R1.2", line: 20 };
    const g = geometry({
      texts: [
        {
          kind: "port",
          text: "VIN_PORT",
          x_nm: 80 * MM,
          y_nm: 80 * MM,
          box: { min_x_nm: 80 * MM, min_y_nm: 79 * MM, max_x_nm: 90 * MM, max_y_nm: 81 * MM },
          line: 21,
          subject: "VIN_PORT",
        },
      ],
    });
    const out = checkReadability(facts(view([vinWire], {}), g));
    expect(out.map((d) => d.code)).toEqual(["view.port-not-on-net"]);
  });

  test("two labels on top of each other collide; label against note overlaps", () => {
    const box = { min_x_nm: 20 * MM, min_y_nm: 4 * MM, max_x_nm: 26 * MM, max_y_nm: 6 * MM };
    const labels = geometry({
      texts: [
        { kind: "label", text: "GND", x_nm: 20 * MM, y_nm: 5 * MM, box, line: 13, subject: "GND" },
        { kind: "label", text: "VIN", x_nm: 21 * MM, y_nm: 5 * MM, box, line: 14, subject: "VIN" },
      ],
    });
    expect(checkReadability(facts(view([gndWire], {}), labels)).map((d) => d.code)).toContain(
      "view.label-collision",
    );

    const mixed = geometry({
      texts: [
        { kind: "label", text: "GND", x_nm: 20 * MM, y_nm: 5 * MM, box, line: 13, subject: "GND" },
        { kind: "text", text: "note", x_nm: 21 * MM, y_nm: 5 * MM, box, line: 14 },
      ],
    });
    expect(checkReadability(facts(view([gndWire], {}), mixed)).map((d) => d.code)).toContain(
      "view.text-overlap",
    );
  });

  test("boxes that merely touch do not collide", () => {
    const left = { min_x_nm: 20 * MM, min_y_nm: 4 * MM, max_x_nm: 25 * MM, max_y_nm: 6 * MM };
    const right = { min_x_nm: 25 * MM, min_y_nm: 4 * MM, max_x_nm: 30 * MM, max_y_nm: 6 * MM };
    const g = geometry({
      texts: [
        { kind: "text", text: "a", x_nm: 20 * MM, y_nm: 5 * MM, box: left, line: 13 },
        { kind: "text", text: "b", x_nm: 25 * MM, y_nm: 5 * MM, box: right, line: 14 },
      ],
    });
    expect(checkReadability(facts(view([gndWire], {}), g))).toEqual([]);
  });

  test("a wire through a symbol's body is reported once per body, except for its own endpoints", () => {
    // A GND wire from R1.2 to U1.2 passes through U1's own body only at its endpoint pin.
    expect(checkReadability(facts(view([gndWire], {}), geometry()))).toEqual([]);

    const crossing = geometry({
      symbols: [
        ...geometry().symbols,
        {
          instance_id: "C1",
          box: { min_x_nm: 20 * MM, min_y_nm: 4 * MM, max_x_nm: 24 * MM, max_y_nm: 6 * MM },
          pins: new Map(),
        },
      ],
    });
    const out = checkReadability(facts(view([gndWire], {}), crossing));
    expect(out.map((d) => d.code)).toEqual(["view.wire-crosses-symbol"]);
    expect(out[0]!.data).toEqual({ page: "p", net: "GND", instance: "C1", through_nm: 3_998_000 });
  });
});
