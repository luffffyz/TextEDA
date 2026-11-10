// Round-trip of the print page: `extract(render(ir)) == ir` in the sense of the semantic projection
// (ADR-0036 decision 5). Both ends compute the projection; neither calls the other's transform.
import { irVersion } from "@texteda/ir";
import { describe, expect, test } from "bun:test";
import type { ModuleView } from "@texteda/ir/module-view";
import type { SheetTemplate } from "@texteda/ir/sheet-template";
import type { SchematicView } from "@texteda/ir/schematic-view";
import {
  extractSchematic,
  renderComposedPage,
  renderModuleDrawing,
  renderSchematic,
  schematicGeometry,
  schematicProjection,
  type SchematicInstance,
  type SymbolBody,
} from "../src/index.ts";

/**
 * The overview rows a view may carry (IR contract v0.17).
 *
 * The same two optional arrays the IR type grows; declared here so the case writes the rows the
 * way a view file does.
 */
interface ModuleRows {
  module?: {
    instance_id: string;
    module_id: string;
    x_nm: number;
    y_nm: number;
    width_nm: number;
    height_nm: number;
  }[];
  module_port?: { id: string; x_nm: number; y_nm: number }[];
}

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

function view(over: Partial<SchematicView> & ModuleRows = {}): SchematicView {
  return {
    ir_version: irVersion,
    format: "0.14",
    source: { file: "views/p.view.teda", line: 1 },
    project: "main",
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

/**
 * An overview page (`view main`): one module box, one module port on its boundary, and a run
 * between that port and a page port.
 */
function overview(over: Partial<SchematicView> & ModuleRows = {}): SchematicView {
  return view({
    place: [],
    label: [],
    text: [],
    port: [{ id: "OUT", x_nm: 200_000_000, y_nm: 50_000_000, rot_mdeg: 0 }],
    wire: [{ net: "SYS", from_pin: "M1.SYS_OUT", to_pin: "OUT" }],
    module: [
      {
        instance_id: "M1",
        module_id: "charger-power",
        x_nm: 20_000_000,
        y_nm: 20_000_000,
        width_nm: 90_000_000,
        height_nm: 60_000_000,
      },
    ],
    module_port: [{ id: "M1.SYS_OUT", x_nm: 110_000_000, y_nm: 50_000_000 }],
    ...over,
  });
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

  test("a field that steps aside reverse-extracts into the view's projection", () => {
    // Two parts six millimetres apart: one of the four fields cannot stay where its symbol wanted
    // it, so the page moves it. The drawing and the projection place the fields on their own, and
    // the two ends must still agree on where the field ended up.
    const v = view({
      place: [
        { instance_id: "R1", x_nm: 100_000_000, y_nm: 100_000_000, rot_mdeg: 90_000 },
        { instance_id: "R2", x_nm: 106_000_000, y_nm: 100_000_000, rot_mdeg: 90_000 },
      ],
      wire: [],
    });
    const i = instances(["R1", "R2"]);
    const extracted = extractSchematic(renderSchematic(v, i));
    const projection = schematicProjection(v, i);
    expect(extracted.fields).toEqual(projection.fields);
    expect(extracted.fields).toHaveLength(4);
    // The symbol wanted its Reference above the body, at (102.54, 100); the page moved it aside.
    const reference = extracted.fields.find((field) => field.instance_id === "R1" && field.name === "Reference");
    expect(reference?.x_nm).not.toBe(102_540_000);
    expect(extracted).toEqual(projection);
  });

  test("the projection is not a no-op: moving, turning or relabelling changes it", () => {
    const base = extractSchematic(renderSchematic(view(), instances(ids)));

    const moved = view();
    moved.place = moved.place!.map((p) => (p.instance_id === "R1" ? { ...p, x_nm: p.x_nm + 1_000_000 } : p));
    expect(extractSchematic(renderSchematic(moved, instances(ids)))).not.toEqual(base);

    const turned = view();
    turned.place = turned.place!.map((p) => (p.instance_id === "R2" ? { ...p, rot_mdeg: 0 } : p));
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

  test("an overview page: the module box and the module port are drawn and read back", () => {
    const v = overview();
    const i = new Map<string, SchematicInstance>();
    const doc = renderSchematic(v, i);

    // The box is drawn as the rectangle the view names: corner and extent alike.
    const box = doc.primitives.find((p) => p.kind === "rect" && p.layer === "module");
    expect(box).toMatchObject({
      kind: "rect",
      x1: 20_000_000,
      y1: 20_000_000,
      x2: 110_000_000,
      y2: 80_000_000,
      ref: "module:M1",
    });
    // The port mark sits where the view stores it.
    const mark = doc.primitives.find((p) => p.kind === "circle" && p.layer === "module_port");
    expect(mark).toMatchObject({ kind: "circle", cx: 110_000_000, cy: 50_000_000, ref: "module-port:M1.SYS_OUT" });
    // The run ends on the module port, at the point the port is drawn.
    const run = doc.primitives.find((p) => p.kind === "polyline" && p.layer === "wire");
    expect(run?.kind === "polyline" ? run.points[0] : undefined).toEqual({ x: 110_000_000, y: 50_000_000 });

    // The geometry the readability checks read: the module's own box.
    expect(schematicGeometry(v, i).modules).toEqual([
      {
        instance_id: "M1",
        box: { min_x_nm: 20_000_000, min_y_nm: 20_000_000, max_x_nm: 110_000_000, max_y_nm: 80_000_000 },
      },
    ]);

    // The drawing reverse-extracts into the view's projection.
    const extracted = extractSchematic(doc);
    expect(extracted.modules).toEqual([
      { instance_id: "M1", x1_nm: 20_000_000, y1_nm: 20_000_000, x2_nm: 110_000_000, y2_nm: 80_000_000 },
    ]);
    expect(extracted.modulePorts).toEqual([{ id: "M1.SYS_OUT", x_nm: 110_000_000, y_nm: 50_000_000 }]);
    expect(extracted).toEqual(schematicProjection(v, i));
  });

  test("the overview projection is not a no-op: moving the box or the port changes it", () => {
    const base = extractSchematic(renderSchematic(overview(), new Map<string, SchematicInstance>()));

    const movedBox = overview({
      module: [
        {
          instance_id: "M1",
          module_id: "charger-power",
          x_nm: 25_000_000,
          y_nm: 20_000_000,
          width_nm: 90_000_000,
          height_nm: 60_000_000,
        },
      ],
    });
    expect(extractSchematic(renderSchematic(movedBox, new Map<string, SchematicInstance>()))).not.toEqual(base);

    const movedPort = overview({
      module_port: [{ id: "M1.SYS_OUT", x_nm: 115_000_000, y_nm: 50_000_000 }],
    });
    expect(extractSchematic(renderSchematic(movedPort, new Map<string, SchematicInstance>()))).not.toEqual(base);
  });
});

describe("reusable module drawings and composed pages", () => {
  const drawing: ModuleView = {
    ir_version: irVersion,
    format: "0.13",
    module_id: "charger-power",
    bounds: { width_nm: 40_000_000, height_nm: 30_000_000 },
    place: [{ instance_id: "R1", x_nm: 20_000_000, y_nm: 15_000_000 }],
    port: [{ id: "SYS_OUT", x_nm: 40_000_000, y_nm: 15_000_000 }],
  };

  test("renders a module drawing against its independent local bounds", () => {
    const doc = renderModuleDrawing(drawing, instances(["R1"]));
    expect(doc.title).toBe("charger-power");
    expect(doc.primitives.find((p) => p.kind === "rect" && p.layer === "sheet")).toMatchObject({
      kind: "rect", x1: 0, y1: 0, x2: 40_000_000, y2: 30_000_000,
    });
    expect(doc.primitives.some((p) => p.kind === "pin" && p.x === 16_190_000)).toBe(true);
  });

  test("composes template furniture and transformed module drawings without scaling", () => {
    const template: SheetTemplate = {
      ir_version: irVersion,
      format: "0.13",
      template_id: "a4",
      size: { width_nm: 297_000_000, height_nm: 210_000_000 },
      rect: [{ id: "title-block", start: { x_nm: 200_000_000, y_nm: 180_000_000 }, end: { x_nm: 290_000_000, y_nm: 205_000_000 } }],
      text: [{ id: "literal", x_nm: 205_000_000, y_nm: 185_000_000, text: "STATIC" }],
    };
    const page = view({
      template: "a4",
      place: [],
      module: [],
      module_port: [],
      port: [{ id: "OUT", x_nm: 180_000_000, y_nm: 60_000_000, rot_mdeg: 0 }],
      module_place: [{ instance_id: "M1", module_id: "charger-power", x_nm: 120_000_000, y_nm: 20_000_000, rot_mdeg: 90_000 }],
      wire: [{ net: "SYS", from_pin: "M1.SYS_OUT", to_pin: "OUT" }],
    });
    const doc = renderComposedPage(page, new Map(), {
      template,
      drawings: new Map([[drawing.module_id, drawing]]),
      moduleInstances: new Map([[drawing.module_id, instances(["R1"])]]),
    });
    expect(doc.primitives.find((p) => p.kind === "rect" && p.layer === "sheet")).toMatchObject({
      kind: "rect", x2: 297_000_000, y2: 210_000_000,
    });
    expect(doc.primitives.find((p) => p.kind === "rect" && p.layer === "template" && p.ref === "template:title-block")).toBeDefined();
    expect(doc.primitives.find((p) => p.kind === "text" && p.ref === "template:literal")).toMatchObject({ text: "STATIC" });
    const wire = doc.primitives.find((p) => p.kind === "polyline" && p.layer === "wire");
    expect(wire?.kind === "polyline" ? wire.points[0] : undefined).toEqual({ x: 135_000_000, y: 60_000_000 });
    expect(doc.primitives.some((p) => p.kind === "pin" && p.x === 135_000_000)).toBe(true);
    expect(extractSchematic(renderSchematic(overview(), new Map())).modules).toHaveLength(1);
  });
});
