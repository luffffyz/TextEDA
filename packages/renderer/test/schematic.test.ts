// Schematic rendering: the sheet frame, placed symbols, wires, labels, ports and notes (ADR-0021).
//
// The renderer is a pure function of (view IR, caller-supplied symbol facts): no file system, no
// auto-placement, and the same inputs must produce byte-identical SVG.
import { describe, expect, test } from "bun:test";
import type { SchematicView } from "@texteda/ir/schematic-view";
import type { SymbolBody } from "../src/index.ts";
import { renderSchematic, toSvgText, type SchematicInstance } from "../src/index.ts";

function symbol(units = 1): SymbolBody {
  return {
    library: "test",
    name: "two-pin",
    units,
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

function part(): SchematicInstance {
  return {
    symbol: symbol(),
    part: {
      pins: [
        { number: "1", name: "A", type: "passive" },
        { number: "2", name: "B", type: "passive" },
      ],
    },
  };
}

function view(over: Partial<SchematicView> = {}): SchematicView {
  return {
    ir_version: "0.2",
    format: "0.7",
    source: { file: "sch/b/p.view.teda", line: 1 },
    board: "b",
    page: "p",
    sheet: { width_nm: 297_000_000, height_nm: 210_000_000 },
    place: [{ instance_id: "C1", x_nm: 100_000_000, y_nm: 100_000_000, rot_mdeg: 90_000 }],
    ...over,
  };
}

describe("renderSchematic", () => {
  test("is deterministic", () => {
    const instances = new Map([["C1", part()]]);
    const v = view({
      wire: [{ net: "N", from_pin: "C1.1", to_pin: "C1.2" }],
      label: [{ net: "N", x_nm: 100_000_000, y_nm: 100_000_000 }],
      port: [{ id: "OUT", x_nm: 100_000_000, y_nm: 100_000_000, rot_mdeg: 180_000 }],
      text: [{ x_nm: 10_000_000, y_nm: 10_000_000, text: "note" }],
    });
    expect(toSvgText(renderSchematic(v, instances))).toBe(toSvgText(renderSchematic(v, instances)));
  });

  test("wire endpoints land on the placed pin connection points", () => {
    const v = view({ wire: [{ net: "N", from_pin: "C1.1", to_pin: "C1.2" }] });
    const doc = renderSchematic(v, new Map([["C1", part()]]));
    const pins = doc.primitives.filter((p) => p.kind === "pin");
    const wires = doc.primitives.filter((p) => p.kind === "polyline" && p.layer === "wire");
    expect(pins).toHaveLength(2);
    expect(wires).toHaveLength(1);
    const wire = wires[0]!;
    if (wire.kind !== "polyline") throw new Error("expected a polyline");
    const pin1 = pins.find((p) => p.kind === "pin" && p.number === "1");
    const pin2 = pins.find((p) => p.kind === "pin" && p.number === "2");
    expect(wire.points[0]).toEqual({ x: pin1!.x, y: pin1!.y });
    expect(wire.points[wire.points.length - 1]).toEqual({ x: pin2!.x, y: pin2!.y });
  });

  test("rotates pin connection points and pin orientations clockwise", () => {
    const v = view({ wire: [{ net: "N", from_pin: "C1.1", to_pin: "C1.2" }] });
    const doc = renderSchematic(v, new Map([["C1", part()]]));
    const pin1 = doc.primitives.find((p) => p.kind === "pin" && p.number === "1");
    if (!pin1 || pin1.kind !== "pin") throw new Error("missing pin 1");
    // Symbol pin 1 sits at (-3.81, 0) pointing right; a 90-degree clockwise placement moves it to
    // (100, 96.19) -- above the origin on a +y-down sheet -- and turns the pin to point down.
    expect({ x: pin1.x, y: pin1.y }).toEqual({ x: 100_000_000, y: 96_190_000 });
    expect(pin1.rotMdeg).toBe(90_000);
  });

  test("draws only the selected unit plus the shared unit", () => {
    const multi = symbol(2);
    multi.pins = [
      { number: "1", at: { x_nm: -3_810_000, y_nm: 0, rotation_mdeg: 0 }, length_nm: 2_540_000, unit: 1, style: "line" },
      { number: "3", at: { x_nm: 0, y_nm: -3_810_000, rotation_mdeg: 90_000 }, length_nm: 2_540_000, unit: 2, style: "line" },
    ];
    multi.body = [
      { kind: "line", start: { x_nm: -1_270_000, y_nm: 0 }, end: { x_nm: 1_270_000, y_nm: 0 }, width_nm: 254_000, unit: 0 },
      { kind: "line", start: { x_nm: -1_270_000, y_nm: -1_270_000 }, end: { x_nm: 1_270_000, y_nm: -1_270_000 }, width_nm: 254_000, unit: 1 },
      { kind: "line", start: { x_nm: -1_270_000, y_nm: 1_270_000 }, end: { x_nm: 1_270_000, y_nm: 1_270_000 }, width_nm: 254_000, unit: 2 },
    ];
    const v = view({ place: [{ instance_id: "U1", x_nm: 50_000_000, y_nm: 50_000_000, unit: 2 }] });
    const doc = renderSchematic(v, new Map([["U1", { symbol: multi, part: part().part }]]));
    expect(doc.primitives.filter((p) => p.kind === "pin").map((p) => p.number)).toEqual(["3"]);
    // Shared (unit 0) plus unit 2; the unit 1 line stays out.
    const lines = doc.primitives.filter((p) => p.kind === "line");
    expect(lines).toHaveLength(2);
    expect(new Set(lines.map((p) => (p.kind === "line" ? p.y1 : 0)))).toEqual(
      new Set([50_000_000, 48_730_000]),
    );
  });

  test("shows the instance refdes in the Reference field", () => {
    const v = view();
    const doc = renderSchematic(v, new Map([["C1", part()]]));
    const reference = doc.primitives.find(
      (p) => p.kind === "text" && p.role === "field" && p.name === "Reference",
    );
    if (!reference || reference.kind !== "text") throw new Error("missing Reference field");
    expect(reference.text).toBe("C1");
  });

  test("refuses to draw an instance without symbol facts", () => {
    expect(() => renderSchematic(view(), new Map())).toThrow(/no symbol facts/);
  });

  test("draws a module-qualified instance and resolves its pins", () => {
    // The module hierarchy is not implemented yet, but the view speaks the board's identity
    // language: a module instance is `M1.U1` and its pin reference is `M1.U1.1`.
    const v = view({
      place: [{ instance_id: "M1.U1", x_nm: 100_000_000, y_nm: 100_000_000, rot_mdeg: 90_000 }],
      wire: [{ net: "M1.VCC", from_pin: "M1.U1.1", to_pin: "M1.U1.2" }],
    });
    const doc = renderSchematic(v, new Map([["M1.U1", part()]]));
    const pins = doc.primitives.filter((p) => p.kind === "pin");
    const wires = doc.primitives.filter((p) => p.kind === "polyline" && p.layer === "wire");
    expect(pins).toHaveLength(2);
    expect(wires).toHaveLength(1);
    const wire = wires[0]!;
    if (wire.kind !== "polyline") throw new Error("expected a polyline");
    const pin1 = pins.find((p) => p.kind === "pin" && p.number === "1");
    const pin2 = pins.find((p) => p.kind === "pin" && p.number === "2");
    expect(wire.points[0]).toEqual({ x: pin1!.x, y: pin1!.y });
    expect(wire.points[wire.points.length - 1]).toEqual({ x: pin2!.x, y: pin2!.y });
  });
});
