// Schematic rendering: the sheet frame, placed symbols, wires, labels, ports, notes and fields (ADR-0035).
//
// The renderer is a pure function of (view IR, caller-supplied symbol facts): no file system, and the
// same inputs must produce byte-identical SVG. Automatic fields are derived from painted symbol geometry.
import { irVersion } from "@texteda/ir";
import { strokeWidthFor, textStrokes } from "@texteda/core/font";
import { describe, expect, test } from "bun:test";
import type { SchematicView } from "@texteda/ir/schematic-view";
import type { SvgText, SymbolBody } from "../src/index.ts";
import { extractSchematic, renderSchematic, renderSymbol, schematicProjection, toSvgText, type SchematicInstance } from "../src/index.ts";
import { resolveSchematicFields } from "../src/field-placement.ts";

interface InkBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function inkBounds(field: Pick<SvgText, "text" | "sizeNm" | "anchor" | "rotateMdeg">): InkBounds {
  const points = textStrokes(field.text, {
    x: 0,
    y: 0,
    sizeNm: field.sizeNm,
    anchor: field.anchor,
    yDown: false,
  }).flatMap((stroke) => stroke.points);
  const rotation = ((field.rotateMdeg ?? 0) % 360_000 + 360_000) % 360_000;
  const radians = (rotation * Math.PI) / 180_000;
  const rotated = points.map((point) => ({
    x: Math.round(point.x * Math.cos(radians) - point.y * Math.sin(radians)),
    y: Math.round(point.x * Math.sin(radians) + point.y * Math.cos(radians)),
  }));
  const halfStroke = strokeWidthFor(field.sizeNm) / 2;
  return {
    minX: Math.min(...rotated.map((point) => point.x)) - halfStroke,
    minY: Math.min(...rotated.map((point) => point.y)) - halfStroke,
    maxX: Math.max(...rotated.map((point) => point.x)) + halfStroke,
    maxY: Math.max(...rotated.map((point) => point.y)) + halfStroke,
  };
}

function paintedPageTextBounds(text: SvgText): InkBounds {
  const points = textStrokes(text.text, {
    x: text.x,
    y: text.y,
    sizeNm: text.sizeNm,
    anchor: text.anchor,
    yDown: true,
  }).flatMap((stroke) => stroke.points);
  const rotation = ((text.rotateMdeg ?? 0) % 360_000 + 360_000) % 360_000;
  const radians = (rotation * Math.PI) / 180_000;
  const rotated = points.map((point) => {
    const dx = point.x - text.x;
    const dy = point.y - text.y;
    return {
      x: Math.round(text.x + dx * Math.cos(radians) + dy * Math.sin(radians)),
      y: Math.round(text.y - dx * Math.sin(radians) + dy * Math.cos(radians)),
    };
  });
  const halfStroke = strokeWidthFor(text.sizeNm) / 2;
  return {
    minX: Math.min(...rotated.map((point) => point.x)) - halfStroke,
    minY: Math.min(...rotated.map((point) => point.y)) - halfStroke,
    maxX: Math.max(...rotated.map((point) => point.x)) + halfStroke,
    maxY: Math.max(...rotated.map((point) => point.y)) + halfStroke,
  };
}

function fieldsOf(doc: ReturnType<typeof renderSchematic>): SvgText[] {
  return doc.primitives.filter((primitive): primitive is SvgText => primitive.kind === "text" && primitive.role === "field");
}

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
    ir_version: irVersion,
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
  test("keeps vertical pin names inside the body after schematic placement", () => {
    const pinSymbol: SymbolBody = {
      library: "test",
      name: "vertical-pin-name",
      units: 1,
      pin_numbers_hidden: false,
      pin_names_hidden: false,
      power: false,
      in_bom: true,
      on_board: true,
      pins: [{
        number: "1",
        at: { x_nm: 0, y_nm: -5_000_000, rotation_mdeg: 90_000 },
        length_nm: 2_000_000,
        unit: 1,
        style: "line",
      }],
      body: [{
        kind: "rect",
        start: { x_nm: -3_000_000, y_nm: -3_000_000 },
        end: { x_nm: 3_000_000, y_nm: 3_000_000 },
        width_nm: 254_000,
        fill: "none",
        unit: 1,
      }],
    };
    const instance = {
      symbol: pinSymbol,
      part: { pins: [{ number: "1", name: "GND", type: "power_in" }] },
    };

    for (const rotation of [0, 90_000, 180_000, 270_000] as const) {
      const doc = renderSchematic(
        view({ place: [{ instance_id: "U1", x_nm: 100_000_000, y_nm: 100_000_000, rot_mdeg: rotation }] }),
        new Map([["U1", instance]]),
      );
      const body = doc.primitives.find((primitive) => primitive.kind === "rect" && primitive.layer === "symbol");
      const name = doc.primitives.find((primitive) => primitive.kind === "text" && primitive.role === "pinName");
      const number = doc.primitives.find((primitive) => primitive.kind === "text" && primitive.role === "pinNumber");
      if (body?.kind !== "rect" || name?.kind !== "text" || number?.kind !== "text") {
        throw new Error("vertical pin symbol is missing its body or labels");
      }
      expect(name.rotateMdeg).toBe(({ 0: 90_000, 90_000: 0, 180_000: 270_000, 270_000: 180_000 } as const)[rotation]);

      const halfBodyStroke = body.widthNm / 2;
      const innerLeft = body.x1 + halfBodyStroke;
      const innerTop = body.y1 + halfBodyStroke;
      const innerRight = body.x2 - halfBodyStroke;
      const innerBottom = body.y2 - halfBodyStroke;
      const nameInk = paintedPageTextBounds(name);
      const gap = rotation === 0
        ? innerBottom - nameInk.maxY
        : rotation === 90_000
          ? nameInk.minX - innerLeft
          : rotation === 180_000
            ? nameInk.minY - innerTop
            : innerRight - nameInk.maxX;
      expect(gap).toBe(400_000);

      const numberInk = paintedPageTextBounds(number);
      const separation = rotation === 0
        ? numberInk.minY - nameInk.maxY
        : rotation === 90_000
          ? nameInk.minX - numberInk.maxX
          : rotation === 180_000
            ? nameInk.minY - numberInk.maxY
            : numberInk.minX - nameInk.maxX;
      expect(separation).toBeGreaterThan(0);
    }
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

  test("grows a turned part's field text away from its body", () => {
    // A quarter turn puts `Reference` and `Value` on either side of the body. Centered on those
    // anchors, any two texts of a few characters overlap (`220uF` under `M2.C3`), so the one on the
    // left ends at its anchor and the one on the right starts there.
    const doc = renderSchematic(view(), new Map([["C1", part()]]));
    const fields = doc.primitives.filter((p) => p.kind === "text" && p.role === "field");
    const reference = fields.find((p) => p.kind === "text" && p.name === "Reference");
    const value = fields.find((p) => p.kind === "text" && p.name === "Value");
    if (reference?.kind !== "text" || value?.kind !== "text") throw new Error("missing fields");
    // Symbol `at` is +y-up: after a 90-degree clockwise turn the Reference sits right of the origin.
    expect(reference.anchor).toBe("start");
    expect(value.anchor).toBe("end");
    // Upright parts keep the centered anchor: the two texts sit above and below the body.
    const upright = renderSchematic(
      view({ place: [{ instance_id: "C1", x_nm: 100_000_000, y_nm: 100_000_000 }] }),
      new Map([["C1", part()]]),
    );
    for (const p of upright.primitives.filter((q) => q.kind === "text" && q.role === "field")) {
      expect(p.kind === "text" ? p.anchor : undefined).toBe("middle");
    }
  });

  test("keeps quarter-turned fields one millimetre from the painted body frame", () => {
    for (const rot_mdeg of [90_000, 270_000]) {
      const place = { instance_id: "U1", x_nm: 100_000_000, y_nm: 100_000_000, rot_mdeg };
      const instance = { ...part(), value: "bq24610rger" };
      const doc = renderSchematic(view({ place: [place] }), new Map([["U1", instance]]));
      const body = doc.primitives.find((primitive) => primitive.kind === "rect" && primitive.layer === "symbol");
      if (body?.kind !== "rect") throw new Error("missing symbol body frame");
      const bodyHalfStroke = body.widthNm / 2;
      const bodyLeft = body.x1 - bodyHalfStroke;
      const bodyRight = body.x2 + bodyHalfStroke;
      const fields = fieldsOf(doc);
      const reference = fields.find((field) => field.name === "Reference");
      const value = fields.find((field) => field.name === "Value");
      if (!reference || !value) throw new Error("missing symbol fields");
      const referenceInk = inkBounds(reference);
      const valueInk = inkBounds(value);

      if (rot_mdeg === 90_000) {
        expect(reference.x + referenceInk.minX - bodyRight).toBe(1_000_000);
        expect(bodyLeft - (value.x + valueInk.maxX)).toBe(1_000_000);
      } else {
        expect(bodyLeft - (reference.x + referenceInk.maxX)).toBe(1_000_000);
        expect(value.x + valueInk.minX - bodyRight).toBe(1_000_000);
      }
    }
  });

  test("places a page's fields together, so two parts drawn close keep readable fields", () => {
    // Two parts six millimetres apart: each field wants the side its symbol points at, and the two
    // wanted places face each other. The page places the fields together — the first keeps the
    // place it wants, and the other steps aside instead of printing on top of it.
    const instances = new Map([
      ["C1", { ...part(), value: "10k" }],
      ["C2", { ...part(), value: "220uF" }],
    ]);
    const v = view({
      place: [
        { instance_id: "C1", x_nm: 100_000_000, y_nm: 100_000_000, rot_mdeg: 90_000 },
        { instance_id: "C2", x_nm: 106_000_000, y_nm: 100_000_000, rot_mdeg: 90_000 },
      ],
    });
    const fields = fieldsOf(renderSchematic(v, instances));
    expect(fields).toHaveLength(4);
    const boxes = fields.map((field) => paintedPageTextBounds(field));
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        const overX = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
        const overY = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
        expect(overX > 0 && overY > 0).toBe(false);
      }
    }
    // The fields did not all stay where their symbol asked: one of them stepped aside.
    const reference = fields.find((field) => field.name === "Reference" && field.text === "C1");
    if (!reference) throw new Error("missing C1 reference field");
    expect(reference.x).not.toBe(101_635_000);
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
  test("places automatic fields one million nanometres from every supported painted body", () => {
    type BodyItem = NonNullable<SymbolBody["body"]>[number];
    const cases: { item: BodyItem; minY: number; maxY: number }[] = [
      {
        item: { kind: "line", start: { x_nm: -2_000_000, y_nm: -3_000_000 }, end: { x_nm: 4_000_000, y_nm: 5_000_000 }, width_nm: 200_000 },
        minY: -3_100_000,
        maxY: 5_100_000,
      },
      {
        item: { kind: "rect", start: { x_nm: -1_000_000, y_nm: -2_000_000 }, end: { x_nm: 3_000_000, y_nm: 4_000_000 }, width_nm: 200_000 },
        minY: -2_100_000,
        maxY: 4_100_000,
      },
      {
        item: { kind: "circle", center: { x_nm: 0, y_nm: 0 }, radius_nm: 2_000_000, width_nm: 200_000 },
        minY: -2_100_000,
        maxY: 2_100_000,
      },
      {
        item: { kind: "arc", start: { x_nm: 3_000_000, y_nm: 0 }, mid: { x_nm: 0, y_nm: 3_000_000 }, end: { x_nm: -3_000_000, y_nm: 0 }, width_nm: 200_000 },
        minY: -100_000,
        maxY: 3_100_000,
      },
      {
        item: { kind: "poly", points: [{ x_nm: -1_000_000, y_nm: -4_000_000 }, { x_nm: 2_000_000, y_nm: 1_000_000 }, { x_nm: 4_000_000, y_nm: 2_000_000 }], width_nm: 200_000 },
        minY: -4_100_000,
        maxY: 2_100_000,
      },
    ];

    for (const { item, minY, maxY } of cases) {
      const candidate = { ...symbol(), body: [item] } satisfies SymbolBody;
      const rendered = renderSymbol(candidate, part().part).primitives;
      const resolved = resolveSchematicFields(rendered, "C1", 1, "10k", undefined);
      for (const field of rendered.filter((primitive): primitive is SvgText => primitive.kind === "text" && primitive.role === "field")) {
        const position = resolved.get(field);
        if (position === undefined) throw new Error(`field ${field.name ?? "?"} was not resolved`);
        const ink = inkBounds({ ...field, text: position.text });
        if (field.name === "Reference") expect(position.y + ink.minY).toBe(maxY + 1_000_000);
        if (field.name === "Value") expect(position.y + ink.maxY).toBe(minY - 1_000_000);
      }
    }
  });

  test("automatic bounds include the selected unit and shared body geometry", () => {
    const multi = {
      ...symbol(2),
      body: [
        { kind: "line", start: { x_nm: -1_000_000, y_nm: -1_000_000 }, end: { x_nm: 1_000_000, y_nm: -1_000_000 }, width_nm: 200_000, unit: 0 },
        { kind: "line", start: { x_nm: -1_000_000, y_nm: 4_000_000 }, end: { x_nm: 1_000_000, y_nm: 4_000_000 }, width_nm: 200_000, unit: 1 },
        { kind: "line", start: { x_nm: -1_000_000, y_nm: 10_000_000 }, end: { x_nm: 1_000_000, y_nm: 10_000_000 }, width_nm: 200_000, unit: 2 },
      ],
    } satisfies SymbolBody;
    const rendered = renderSymbol(multi, part().part).primitives;
    const resolved = resolveSchematicFields(rendered, "U1", 2, undefined, undefined);
    const reference = rendered.find((primitive): primitive is SvgText => primitive.kind === "text" && primitive.name === "Reference");
    const value = rendered.find((primitive): primitive is SvgText => primitive.kind === "text" && primitive.name === "Value");
    if (!reference || !value) throw new Error("multi-unit fields are missing");
    const referencePosition = resolved.get(reference);
    const valuePosition = resolved.get(value);
    if (!referencePosition || !valuePosition) throw new Error("multi-unit fields were not resolved");
    expect(referencePosition.y + inkBounds({ ...reference, text: referencePosition.text }).minY).toBe(10_100_000 + 1_000_000);
    expect(valuePosition.y + inkBounds({ ...value, text: valuePosition.text }).maxY).toBe(-1_100_000 - 1_000_000);
  });

  test("bodyless fields retain their library anchors", () => {
    const bodyless = { ...symbol(), body: [] } satisfies SymbolBody;
    const rendered = renderSymbol(bodyless, part().part).primitives;
    const resolved = resolveSchematicFields(rendered, "C1", 1, undefined, undefined);
    const reference = rendered.find((primitive): primitive is SvgText => primitive.kind === "text" && primitive.name === "Reference");
    const value = rendered.find((primitive): primitive is SvgText => primitive.kind === "text" && primitive.name === "Value");
    if (!reference || !value) throw new Error("bodyless fields are missing");
    expect(resolved.get(reference)).toMatchObject({ x: 0, y: 2_540_000, text: "C1" });
    expect(resolved.get(value)).toMatchObject({ x: 0, y: -2_540_000, text: "two-pin" });
  });

  test("manual fields use local coordinates, follow movement and rotation, and restore automatic placement when removed", () => {
    const instance = { ...part(), value: "10k" };
    const instances = new Map([["C1", instance]]);
    const manual = [{ instance_id: "C1", name: "Reference" as const, x_nm: 4_000_000, y_nm: 5_000_000 }];
    const at = (rot_mdeg: number, x_nm = 100_000_000) => {
      const doc = renderSchematic(
        view({ place: [{ instance_id: "C1", x_nm, y_nm: 100_000_000, rot_mdeg }], field: manual }),
        instances,
      );
      const field = fieldsOf(doc).find((candidate) => candidate.name === "Reference");
      if (!field) throw new Error("manual Reference field is missing");
      return field;
    };
    expect(at(0)).toMatchObject({ x: 104_000_000, y: 95_000_000 });
    expect(at(90_000)).toMatchObject({ x: 105_000_000, y: 104_000_000 });
    expect(at(90_000, 110_000_000)).toMatchObject({ x: 115_000_000, y: 104_000_000 });

    const automatic = fieldsOf(renderSchematic(view({ place: [{ instance_id: "C1", x_nm: 100_000_000, y_nm: 100_000_000, rot_mdeg: 0 }], field: [] }), instances))
      .find((candidate) => candidate.name === "Reference");
    if (!automatic) throw new Error("automatic Reference field is missing");
    expect(automatic).not.toMatchObject({ x: 104_000_000, y: 95_000_000 });
  });

  test("field geometry stays separate from free text during projection and extraction", () => {
    const v = view({ text: [{ x_nm: 10_000_000, y_nm: 10_000_000, text: "note" }] });
    const instances = new Map([["C1", part()]]);
    const doc = renderSchematic(v, instances);
    const projection = schematicProjection(v, instances);
    const extracted = extractSchematic(doc);
    expect(projection.fields).toHaveLength(2);
    expect(projection.texts.every((text) => text.role !== "field")).toBe(true);
    expect(extracted.fields).toEqual(projection.fields);
    expect(extracted.texts).toEqual(projection.texts);
  });
});
