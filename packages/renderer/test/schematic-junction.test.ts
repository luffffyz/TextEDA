// Junction dots (spec/schematic-view.md §5.1): the dot is derived from the drawn runs, per net, by
// counting arms -- one for a run that ends there, two for a run that passes through, one for a pin
// connection point. Three or more is a join.
import { describe, expect, test } from "bun:test";
import { irVersion } from "@texteda/ir";
import type { SchematicView } from "@texteda/ir/schematic-view";
import {
  extractSchematic,
  renderSchematic,
  schematicProjection,
  type SchematicInstance,
  type SymbolBody,
} from "../src/index.ts";

/** Two pins 3.81mm either side of the origin, so placement x ± 3.81mm is a pin. */
function symbol(): SymbolBody {
  return {
    library: "test",
    name: "two-pin",
    units: 1,
    pin_numbers_hidden: false,
    pin_names_hidden: false,
    power: false,
    in_bom: true,
    on_board: true,
    pins: [
      { number: "1", at: { x_nm: -3_810_000, y_nm: 0, rotation_mdeg: 0 }, length_nm: 2_540_000, unit: 1, style: "line" },
      { number: "2", at: { x_nm: 3_810_000, y_nm: 0, rotation_mdeg: 180_000 }, length_nm: 2_540_000, unit: 1, style: "line" },
    ],
    body: [],
    fields: [
      { name: "Reference", value: "U", at: { x_nm: 0, y_nm: 2_540_000 } },
      { name: "Value", value: "two-pin", at: { x_nm: 0, y_nm: -2_540_000 } },
    ],
  };
}

function instances(ids: string[]): Map<string, SchematicInstance> {
  return new Map(
    ids.map((id) => [
      id,
      { symbol: symbol(), part: { pins: [{ number: "1", name: "A", type: "passive" }, { number: "2", name: "B", type: "passive" }] } },
    ]),
  );
}

const place = (instance_id: string, x_nm: number, y_nm: number) => ({ instance_id, x_nm, y_nm, rot_mdeg: 0 });

function view(
  wires: NonNullable<SchematicView["wire"]>,
  moved: Record<string, [number, number]> = {},
): { view: SchematicView; ids: string[] } {
  const ids = [...new Set(wires.flatMap((wire) => [wire.from_pin, wire.to_pin]).map((ref) => ref.slice(0, ref.indexOf("."))))];
  const spots: Record<string, [number, number]> = {
    R1: [50_000_000, 40_000_000],
    R2: [90_000_000, 40_000_000],
    R3: [70_000_000, 60_000_000],
    R4: [70_000_000, 60_000_000],
    ...moved,
  };
  return {
    ids,
    view: {
      ir_version: irVersion,
      format: "0.7",
      source: { file: "views/b/p.view.teda", line: 1 },
      board: "b",
      page: "p",
      sheet: { width_nm: 297_000_000, height_nm: 210_000_000 },
      place: ids.map((id) => place(id, spots[id]![0], spots[id]![1])),
      wire: wires,
    },
  };
}

/** The junction dots in a drawing, as sheet points. */
function dots(
  wires: NonNullable<SchematicView["wire"]>,
  moved?: Record<string, [number, number]>,
): { x: number; y: number }[] {
  const built = view(wires, moved);
  const doc = renderSchematic(built.view, instances(built.ids));
  return doc.primitives.flatMap((p) => (p.kind === "circle" && p.layer === "junction" ? [{ x: p.cx, y: p.cy }] : []));
}

describe("junction dots", () => {
  test("two runs of one net meeting at a bend point are joined", () => {
    // R1.2 -> R2.1 runs straight along y=40mm past the bend; R3 (above) comes down onto the same
    // point and leaves: two arms from the passing run, two from R3's V, so the point is a join.
    const out = dots([
      { net: "N1", from_pin: "R1.2", to_pin: "R2.1", points: [{ x_nm: 70_000_000, y_nm: 40_000_000 }] },
      { net: "N1", from_pin: "R3.1", to_pin: "R3.2", points: [{ x_nm: 70_000_000, y_nm: 40_000_000 }] },
    ]);
    expect(out).toEqual([{ x: 70_000_000, y: 40_000_000 }]);
  });

  test("two runs leaving one pin are joined", () => {
    // The pin connection point is one arm; the two run ends are the other two. A single run leaving
    // a pin is only two arms (wire + pin) and stays undotted.
    expect(dots([
      { net: "N1", from_pin: "R1.2", to_pin: "R2.1", points: [{ x_nm: 70_000_000, y_nm: 30_000_000 }] },
      { net: "N1", from_pin: "R1.2", to_pin: "R3.1" },
    ])).toEqual([{ x: 53_810_000, y: 40_000_000 }]);
    expect(dots([
      { net: "N1", from_pin: "R1.2", to_pin: "R2.1", points: [{ x_nm: 70_000_000, y_nm: 30_000_000 }] },
    ])).toEqual([]);
  });

  test("two coincident runs leaving a pin make one visible arm and no dot", () => {
    // Two rows are one line to a reader. Counting rows instead of directions would give the pin
    // three arms and a dot on a pin that visibly has a single wire.
    expect(dots([
      { net: "N1", from_pin: "R1.2", to_pin: "R2.1", points: [{ x_nm: 70_000_000, y_nm: 40_000_000 }] },
      { net: "N1", from_pin: "R1.2", to_pin: "R2.1", points: [{ x_nm: 70_000_000, y_nm: 40_000_000 }] },
    ])).toEqual([]);
  });

  test("runs of different nets that pass through the same point draw no dot", () => {
    // The absence of a dot is the drawing's way of saying "not connected".
    expect(dots([
      { net: "N1", from_pin: "R1.2", to_pin: "R2.1", points: [{ x_nm: 70_000_000, y_nm: 40_000_000 }] },
      { net: "GND", from_pin: "R4.1", to_pin: "R4.2", points: [{ x_nm: 70_000_000, y_nm: 40_000_000 }] },
    ])).toEqual([]);
  });

  test("a run passing through a pin of another net draws no dot there", () => {
    // R1.2 is a VOUT pin (one VOUT wire ends there); a PH run crosses it vertically. A dot would
    // claim PH is joined to VOUT, so the pin's net vetoes the PH junction.
    expect(dots(
      [
        { net: "VOUT", from_pin: "R1.2", to_pin: "R2.2" },
        { net: "PH", from_pin: "R3.1", to_pin: "R4.1" },
      ],
      { R3: [57_620_000, 60_000_000], R4: [57_620_000, 20_000_000] },
    )).toEqual([]);
  });

  test("a run ending on a run that passes through is joined", () => {
    // R1.2 -> R2.1 runs along y=40mm through R3's pin 1 (66.19mm): two arms; R3.1 -> R4.2 ends
    // there: one more. R3.2 (73.81mm) has only the passing run, so it stays a plain crossing.
    const out = dots(
      [
        { net: "N1", from_pin: "R1.2", to_pin: "R2.1" },
        { net: "N1", from_pin: "R3.1", to_pin: "R4.2" },
      ],
      { R3: [70_000_000, 40_000_000] },
    );
    expect(out).toEqual([{ x: 66_190_000, y: 40_000_000 }]);
  });

  test("a dot is drawing only: the round-trip projection does not see it", () => {
    const built = view([
      { net: "N1", from_pin: "R1.2", to_pin: "R2.1", points: [{ x_nm: 70_000_000, y_nm: 40_000_000 }] },
      { net: "N1", from_pin: "R3.1", to_pin: "R3.2", points: [{ x_nm: 70_000_000, y_nm: 40_000_000 }] },
    ]);
    const i = instances(built.ids);
    const doc = renderSchematic(built.view, i);
    expect(doc.primitives.some((p) => p.kind === "circle" && p.layer === "junction")).toBe(true);
    expect(extractSchematic(doc)).toEqual(schematicProjection(built.view, i));
  });
});
