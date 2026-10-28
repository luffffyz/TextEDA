// Round-trip of the print page: `extract(render(ir)) == ir` in the sense of the semantic projection
// (ADR-0135 decision 5). Both ends compute the projection; neither calls the other's transform.
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
    body: [
      {
        kind: "rect",
        start: { x_nm: -1_270_000, y_nm: -635_000 },
        end: { x_nm: 1_270_000, y_nm: 635_000 },
        width_nm: 254_000,
        fill: "none",
        unit: 0,
      },
    ],
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

function view(over: Partial<SchematicView> = {}): SchematicView {
  return {
    ir_version: irVersion,
    format: "0.7",
    source: { file: "views/b/p.view.teda", line: 1 },
    board: "b",
    page: "p",
    sheet: { width_nm: 297_000_000, height_nm: 210_000_000 },
    place: [
      { instance_id: "R1", x_nm: 50_000_000, y_nm: 40_000_000, rot_mdeg: 0 },
      { instance_id: "R2", x_nm: 90_000_000, y_nm: 40_000_000, rot_mdeg: 90_000 },
      { instance_id: "R3", x_nm: 130_000_000, y_nm: 40_000_000, rot_mdeg: 180_000 },
      { instance_id: "R4", x_nm: 170_000_000, y_nm: 40_000_000, rot_mdeg: 270_000 },
    ],
    wire: [
      { net: "N1", from_pin: "R1.2", to_pin: "R2.1", points: [{ x_nm: 70_000_000, y_nm: 30_000_000 }] },
      { net: "GND", from_pin: "R3.1", to_pin: "R4.2" },
    ],
    label: [{ net: "N1", x_nm: 60_000_000, y_nm: 30_000_000 }],
    port: [
      { id: "OUT", x_nm: 200_000_000, y_nm: 60_000_000, rot_mdeg: 0 },
      { id: "IN", x_nm: 20_000_000, y_nm: 60_000_000, rot_mdeg: 180_000 },
    ],
    text: [{ x_nm: 10_000_000, y_nm: 190_000_000, text: "note" }],
    ...over,
  };
}

const ids = ["R1", "R2", "R3", "R4"];

describe("schematic round-trip", () => {
  test("the instance names its own value; both ends compute the substitution", () => {
    const v = view();
    const i = instances(ids);
    const withValue = new Map(
      [...i].map(([id, instance]): [string, SchematicInstance] => [id, { ...instance, value: "10k" }]),
    );
    // The symbol's Value field is a placeholder (`two-pin`); the drawing prints the instance's value.
    const texts = (map: Map<string, SchematicInstance>): string[] =>
      (renderSchematic(v, map).primitives.filter((p) => p.kind === "text" && p.name === "Value") as { text: string }[]).map(
        (p) => p.text,
      );
    expect(new Set(texts(i))).toEqual(new Set(["two-pin"]));
    expect(new Set(texts(withValue))).toEqual(new Set(["10k"]));
    expect(extractSchematic(renderSchematic(v, withValue))).toEqual(schematicProjection(v, withValue));
    expect(extractSchematic(renderSchematic(v, withValue))).not.toEqual(schematicProjection(v, i));
  });

  test("all four placement quadrants: the drawing reverse-extracts into the view's projection", () => {
    const v = view();
    const i = instances(ids);
    expect(schematicProjection(v, i).pins).toHaveLength(8);
    expect(extractSchematic(renderSchematic(v, i))).toEqual(schematicProjection(v, i));
  });

  test("the projection is not a no-op: moving, turning or relabelling changes it", () => {
    const base = extractSchematic(renderSchematic(view(), instances(ids)));

    const moved = view();
    moved.place = moved.place.map((p) => (p.instance_id === "R1" ? { ...p, x_nm: p.x_nm + 1_000_000 } : p));
    expect(extractSchematic(renderSchematic(moved, instances(ids)))).not.toEqual(base);

    const turned = view();
    turned.place = turned.place.map((p) => (p.instance_id === "R2" ? { ...p, rot_mdeg: 0 } : p));
    expect(extractSchematic(renderSchematic(turned, instances(ids)))).not.toEqual(base);

    const relabelled = view();
    relabelled.label = [{ net: "N2", x_nm: 60_000_000, y_nm: 30_000_000 }];
    expect(extractSchematic(renderSchematic(relabelled, instances(ids)))).not.toEqual(base);

    const fewerWires = view();
    fewerWires.wire = [];
    expect(extractSchematic(renderSchematic(fewerWires, instances(ids)))).not.toEqual(base);

    const turnedPort = view();
    turnedPort.port = [{ id: "OUT", x_nm: 200_000_000, y_nm: 60_000_000, rot_mdeg: 90_000 }];
    expect(extractSchematic(renderSchematic(turnedPort, instances(ids)))).not.toEqual(base);
  });

  test("wire endpoints land on the pin connection points of the projection", () => {
    const projection = extractSchematic(renderSchematic(view(), instances(ids)));
    const wires = projection.shapes.filter((shape) => shape.kind === "polyline" && shape.layer === "wire");
    expect(wires).toHaveLength(2);
    const endpoints = wires.flatMap((wire) => (wire.kind === "polyline" ? [wire.points[0]!, wire.points[wire.points.length - 1]!] : []));
    for (const point of endpoints) {
      expect(projection.pins.some((pin) => pin.x_nm === point.x_nm && pin.y_nm === point.y_nm)).toBe(true);
    }
  });
});
