// Explicit junctions and perpendicular pin approaches render junction dots; geometric crossings
// remain unconnected.
//
import { describe, expect, test } from "bun:test";
import { irVersion } from "@texteda/ir";
import type { SchematicView } from "@texteda/ir/schematic-view";
import {
  extractSchematic,
  renderSchematic,
  schematicProjection,
  toSvgText,
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
  junctions: NonNullable<SchematicView["junction"]> = [],
): { view: SchematicView; ids: string[] } {
  const ids = [...new Set(wires.flatMap((wire) => [wire.from_pin, wire.to_pin]).flatMap((ref) => typeof ref === "string" && ref.includes(".") ? [ref.slice(0, ref.indexOf("."))] : []))];
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
      format: "0.14",
      source: { file: "views/p.view.teda", line: 1 },
      project: "main",
      page: "p",
      sheet: { width_nm: 297_000_000, height_nm: 210_000_000 },
      place: ids.map((id) => place(id, spots[id]![0], spots[id]![1])),
      junction: junctions,
      wire: wires,
    } as SchematicView,
  };
}

/** The junction dots in a drawing, as sheet points. */
function dots(
  wires: NonNullable<SchematicView["wire"]>,
  junctions: NonNullable<SchematicView["junction"]>,
): { x: number; y: number }[] {
  const built = view(wires, {}, junctions);
  const doc = renderSchematic(built.view, instances(built.ids));
  return doc.primitives.flatMap((p) => (p.kind === "circle" && p.layer === "junction" ? [{ x: p.cx, y: p.cy }] : []));
}

describe("junction dots", () => {
  test("a perpendicular wire endpoint on a pin renders a junction dot in SVG", () => {
    const wires = [{ net: "N1", from_pin: "R1.2", to_pin: "J1" }];
    const junctions = [{ id: "J1", x_nm: 53_810_000, y_nm: 50_000_000 }];
    const built = view(wires, {}, junctions);
    const doc = renderSchematic(built.view, instances(built.ids));

    expect(dots(wires, junctions)).toEqual([
      { x: 53_810_000, y: 50_000_000 },
      { x: 53_810_000, y: 40_000_000 },
    ]);
    const svg = toSvgText(doc);
    expect(svg).toContain('data-ref="pin-junction:53810000,40000000"');
    expect(svg).toContain('<circle cx="53.81" cy="40"');
  });

  test("a parallel wire endpoint on a pin does not need a junction dot", () => {
    expect(dots([{ net: "N1", from_pin: "R1.2", to_pin: "R2.1" }], [])).toEqual([]);
  });

  test("declared junctions render dots and connect named wire endpoints", () => {
    const wires = [
      { net: "N1", from_pin: "R1.2", to_pin: "J1" },
      { net: "N1", from_pin: "J1", to_pin: "R2.1" },
    ];
    const junctions = [{ id: "J1", x_nm: 70_000_000, y_nm: 40_000_000 }];
    expect(dots(wires, junctions)).toEqual([{ x: 70_000_000, y: 40_000_000 }]);

    const built = view(wires, {}, junctions);
    const i = instances(built.ids);
    const doc = renderSchematic(built.view, i);
    expect(extractSchematic(doc)).toEqual(schematicProjection(built.view, i));
  });

  test("crossing runs of different nets do not render a dot", () => {
    expect(dots([
      { net: "N1", from_pin: "R1.2", to_pin: "R2.1", points: [{ x_nm: 70_000_000, y_nm: 40_000_000 }] },
      { net: "GND", from_pin: "R4.1", to_pin: "R4.2", points: [{ x_nm: 70_000_000, y_nm: 40_000_000 }] },
    ], [])).toEqual([]);
  });
});
