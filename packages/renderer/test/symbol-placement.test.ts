import { describe, expect, test } from "bun:test";
import { strokeWidthFor, textStrokes } from "@texteda/core/font";
import { renderSymbol, toSvgText, validateDoc, type SvgText, type SymbolBody } from "../src/index.ts";
type TextGeometry = Pick<SvgText, "text" | "x" | "y" | "sizeNm" | "anchor" | "rotateMdeg">;

interface PaintedTextBounds {
  left: number;
  right: number;
  bottom: number;
  top: number;
}

function paintedTextBounds(label: TextGeometry): PaintedTextBounds {
  const points = textStrokes(label.text, {
    x: label.x,
    y: label.y,
    sizeNm: label.sizeNm,
    anchor: label.anchor,
    yDown: false,
  }).flatMap((stroke) => stroke.points);
  const rotation = ((label.rotateMdeg ?? 0) % 360_000 + 360_000) % 360_000;
  const rad = (rotation * Math.PI) / 180_000;
  const rotated = points.map((point) => {
    const dx = point.x - label.x;
    const dy = point.y - label.y;
    return rotation === 0
      ? point
      : {
          x: Math.round(label.x + dx * Math.cos(rad) - dy * Math.sin(rad)),
          y: Math.round(label.y + dx * Math.sin(rad) + dy * Math.cos(rad)),
        };
  });
  const halfStroke = strokeWidthFor(label.sizeNm) / 2;
  return {
    left: Math.min(...rotated.map((point) => point.x)) - halfStroke,
    right: Math.max(...rotated.map((point) => point.x)) + halfStroke,
    bottom: Math.min(...rotated.map((point) => point.y)) - halfStroke,
    top: Math.max(...rotated.map((point) => point.y)) + halfStroke,
  };
}


describe("symbol pin-number placement", () => {
  test("numbers keep 0.50 mm painted clearance from pin lines and body bounds", () => {
    const pin = (
      number: string,
      x_nm: number,
      y_nm: number,
      rotation_mdeg: number,
    ): SymbolBody["pins"][number] => ({
      number,
      at: { x_nm, y_nm, rotation_mdeg },
      length_nm: 2_540_000,
      unit: 1,
      style: "line",
    });
    const symbol = {
      library: "test",
      name: "placement",
      units: 1,
      pin_numbers_hidden: false,
      pin_names_hidden: true,
      power: false,
      in_bom: true,
      on_board: true,
      pins: [
        pin("1", 0, 0, 0),
        pin("2", 10_000_000, 0, 180_000),
        pin("3", 5_000_000, -5_000_000, 90_000),
        pin("24", 5_000_000, 5_000_000, 270_000),
      ],
      body: [
        {
          kind: "rect",
          start: { x_nm: 2_540_000, y_nm: -2_460_000 },
          end: { x_nm: 7_460_000, y_nm: 2_460_000 },
          width_nm: 254_000,
          unit: 1,
        },
      ],
    } satisfies SymbolBody;
    const doc = renderSymbol(symbol, { pins: [] });
    expect(validateDoc(doc)).toEqual([]);
    const labels = doc.primitives.flatMap((primitive) => {
      if (primitive.kind !== "text" || primitive.role !== "pinNumber") return [];
      return [{
        text: primitive.text,
        pin: primitive.pin,
        x: primitive.x,
        y: primitive.y,
        sizeNm: primitive.sizeNm,
        anchor: primitive.anchor,
        rotateMdeg: primitive.rotateMdeg ?? 0,
      }];
    });
    expect(labels.map((label) => ({
      text: label.text,
      pin: label.pin,
      x: label.x,
      y: label.y,
      anchor: label.anchor,
      rotateMdeg: label.rotateMdeg,
    }))).toEqual([
      { text: "1", pin: "1", x: 1_692_262, y: 1_198_500, anchor: "middle", rotateMdeg: 0 },
      { text: "2", pin: "2", x: 8_477_071, y: 1_198_500, anchor: "middle", rotateMdeg: 0 },
      { text: "3", pin: "3", x: 6_198_500, y: -3_670_595, anchor: "middle", rotateMdeg: 90_000 },
      { text: "24", pin: "24", x: 6_198_500, y: 3_985_071, anchor: "middle", rotateMdeg: 90_000 },
    ]);

    const body = { minX: 2_413_000, minY: -2_587_000, maxX: 7_587_000, maxY: 2_587_000 };
    for (const label of labels) {
      const pin = symbol.pins.find((candidate) => candidate.number === label.pin)!;
      const bounds = paintedTextBounds(label);
      const minX = bounds.left;
      const maxX = bounds.right;
      const minY = bounds.bottom;
      const maxY = bounds.top;
      const horizontal = (pin.at.rotation_mdeg ?? 0) % 180_000 === 0;
      const pinLineGap = horizontal
        ? minY - pin.at.y_nm
        : minX - pin.at.x_nm;
      expect(pinLineGap).toBe(500_000);

      const bodyGap = horizontal
        ? pin.at.rotation_mdeg === 0
          ? body.minX - maxX
          : minX - body.maxX
        : pin.at.rotation_mdeg === 90_000
          ? body.minY - maxY
          : minY - body.maxY;
      expect(bodyGap).toBe(500_000);
    }

    const bodyless = renderSymbol({ ...symbol, body: [] }, { pins: [] });
    const fallback = bodyless.primitives.find(
      (primitive) => primitive.kind === "text" && primitive.role === "pinNumber" && primitive.pin === "1",
    );
    expect(fallback).toMatchObject({ kind: "text", x: 1_340_000, y: 1_198_500, anchor: "middle" });
  });
  test("C- and R-like bodies keep pin numbers outside the painted body", () => {
    const pin = (number: string, x_nm: number): SymbolBody["pins"][number] => ({
      number,
      at: { x_nm, y_nm: 0, rotation_mdeg: x_nm < 0 ? 0 : 180_000 },
      length_nm: 1_500_000,
      unit: 1,
      style: "line",
    });
    const base = {
      library: "test",
      name: "passive",
      units: 1,
      pin_numbers_hidden: true,
      pin_names_hidden: true,
      power: false,
      in_bom: true,
      on_board: true,
      pins: [pin("1", -4_000_000), pin("2", 4_000_000)],
    } satisfies Omit<SymbolBody, "body">;
    const cases: Array<{ name: string; body: NonNullable<SymbolBody["body"]> }> = [
      {
        name: "capacitor",
        body: [
          { kind: "line", start: { x_nm: -1_000_000, y_nm: -1_500_000 }, end: { x_nm: -1_000_000, y_nm: 1_500_000 }, width_nm: 250_000, unit: 1 },
          { kind: "line", start: { x_nm: 1_000_000, y_nm: -1_500_000 }, end: { x_nm: 1_000_000, y_nm: 1_500_000 }, width_nm: 250_000, unit: 1 },
        ],
      },
      {
        name: "resistor",
        body: [{ kind: "rect", start: { x_nm: -2_500_000, y_nm: -1_000_000 }, end: { x_nm: 2_500_000, y_nm: 1_000_000 }, width_nm: 250_000, unit: 1 }],
      },
    ];

    for (const candidate of cases) {
      const doc = renderSymbol({ ...base, name: candidate.name, body: candidate.body }, { pins: [] });
      expect(validateDoc(doc)).toEqual([]);
      const labels = doc.primitives.filter(
        (primitive): primitive is SvgText => primitive.kind === "text" && primitive.role === "pinNumber",
      );
      expect(labels).toHaveLength(2);
      const bodyMinX = candidate.name === "capacitor" ? -1_125_000 : -2_625_000;
      const bodyMaxX = -bodyMinX;
      for (const label of labels) {
        const bounds = paintedTextBounds(label);
        const bodyGap = label.pin === "1" ? bodyMinX - bounds.right : bounds.left - bodyMaxX;
        expect(bodyGap).toBe(500_000);
        expect(bounds.bottom).toBe(500_000);
      }
    }
  });
  test("body frame includes circular arc extrema beyond authored points", () => {
    const symbol = {
      library: "test",
      name: "arc-frame",
      units: 1,
      pin_numbers_hidden: false,
      pin_names_hidden: true,
      power: false,
      in_bom: true,
      on_board: true,
      pins: [
        {
          number: "1",
          at: { x_nm: -4_000_000, y_nm: 0, rotation_mdeg: 0 },
          length_nm: 2_540_000,
          unit: 1,
          style: "line",
        },
      ],
      body: [
        {
          kind: "arc",
          start: { x_nm: 1_000_000, y_nm: 0 },
          mid: { x_nm: 0, y_nm: 1_000_000 },
          end: { x_nm: 0, y_nm: -1_000_000 },
          width_nm: 200_000,
          unit: 1,
        },
      ],
    } satisfies SymbolBody;
    const arcDoc = renderSymbol(symbol, { pins: [] });
    expect(validateDoc(arcDoc)).toEqual([]);
    const label = arcDoc.primitives.find(
      (primitive) => primitive.kind === "text" && primitive.role === "pinNumber",
    );
    if (!label || label.kind !== "text") throw new Error("arc pin-number label missing");

    const points = textStrokes("1", {
      x: label.x,
      y: label.y,
      sizeNm: 1_270_000,
      anchor: "middle",
      yDown: false,
    }).flatMap((stroke) => stroke.points);
    const rightInk = Math.max(...points.map((point) => point.x)) + strokeWidthFor(1_270_000) / 2;
    expect(-1_100_000 - rightInk).toBe(500_000);
  });
  test("pin names keep 0.40 mm painted clearance from the inner body frame", () => {
    const symbol = {
      library: "test",
      name: "pin-name-clearance",
      units: 1,
      pin_numbers_hidden: true,
      pin_names_hidden: false,
      power: false,
      in_bom: true,
      on_board: true,
      pins: [
        {
          number: "1",
          at: { x_nm: 0, y_nm: 0, rotation_mdeg: 0 },
          length_nm: 1_000_000,
          unit: 1,
          style: "line",
        },
        {
          number: "2",
          at: { x_nm: 10_000_000, y_nm: 0, rotation_mdeg: 180_000 },
          length_nm: 4_000_000,
          unit: 1,
          style: "line",
        },
        {
          number: "3",
          at: { x_nm: 5_000_000, y_nm: -5_000_000, rotation_mdeg: 90_000 },
          length_nm: 1_000_000,
          unit: 1,
          style: "line",
        },
        {
          number: "4",
          at: { x_nm: 5_000_000, y_nm: 5_000_000, rotation_mdeg: 270_000 },
          length_nm: 4_000_000,
          unit: 1,
          style: "line",
        },
      ],
      body: [
        {
          kind: "rect",
          start: { x_nm: 2_540_000, y_nm: -2_460_000 },
          end: { x_nm: 7_460_000, y_nm: 2_460_000 },
          width_nm: 254_000,
          unit: 1,
        },
      ],
    } satisfies SymbolBody;
    const part = {
      pins: [
        { number: "1", name: "A", type: "input" },
        { number: "2", name: "LONG", type: "output" },
        { number: "3", name: "UP", type: "passive" },
        { number: "4", name: "B", type: "passive" },
      ],
    };
    const doc = renderSymbol(symbol, part);
    expect(validateDoc(doc)).toEqual([]);
    const labels = doc.primitives.flatMap((primitive) => {
      if (primitive.kind !== "text" || primitive.role !== "pinName") return [];
      return [primitive];
    });
    expect(labels.map((label) => ({
      text: label.text,
      pin: label.pin,
      anchor: label.anchor,
    }))).toEqual([
      { text: "A", pin: "1", anchor: "start" },
      { text: "LONG", pin: "2", anchor: "end" },
      { text: "UP", pin: "3", anchor: "start" },
      { text: "B", pin: "4", anchor: "start" },
    ]);
    expect(labels.filter((label) => label.pin === "3" || label.pin === "4").map((label) => label.rotateMdeg))
      .toEqual([90_000, 90_000]);

    const body = { minX: 2_667_000, minY: -2_333_000, maxX: 7_333_000, maxY: 2_333_000 };
    for (const label of labels) {
      if (label.kind !== "text" || label.pin === undefined) throw new Error("pin-name label missing");
      const pin = symbol.pins.find((candidate) => candidate.number === label.pin)!;
      const bounds = paintedTextBounds(label);
      const minX = bounds.left;
      const maxX = bounds.right;
      const minY = bounds.bottom;
      const maxY = bounds.top;
      const gap = pin.at.rotation_mdeg === 0
        ? minX - body.minX
        : pin.at.rotation_mdeg === 180_000
          ? body.maxX - maxX
          : pin.at.rotation_mdeg === 90_000
            ? minY - body.minY
            : body.maxY - maxY;
      expect(gap).toBe(400_000);
    }

    const bodyless = renderSymbol(
      { ...symbol, body: [], pin_name_offset_nm: 600_000 },
      part,
    );
    expect(validateDoc(bodyless)).toEqual([]);
    expect(bodyless.primitives.find(
      (primitive) => primitive.kind === "text" && primitive.role === "pinName" && primitive.pin === "1",
    )).toMatchObject({ kind: "text", x: 1_600_000, y: 0, anchor: "start" });
  });
  test("keeps hidden pin numbers in SVG geometry for transient overlays", () => {
    const symbol = {
      library: "test",
      name: "hidden-numbers",
      units: 1,
      pin_numbers_hidden: true,
      pin_names_hidden: true,
      power: false,
      in_bom: true,
      on_board: true,
      pins: [
        {
          number: "1",
          at: { x_nm: -4_000_000, y_nm: 0, rotation_mdeg: 0 },
          length_nm: 3_000_000,
          unit: 1,
          style: "line",
        },
        {
          number: "2",
          at: { x_nm: 4_000_000, y_nm: 0, rotation_mdeg: 180_000 },
          length_nm: 3_000_000,
          unit: 1,
          style: "line",
        },
      ],
      body: [
        {
          kind: "rect",
          start: { x_nm: -1_000_000, y_nm: -1_500_000 },
          end: { x_nm: 1_000_000, y_nm: 1_500_000 },
          width_nm: 250_000,
          unit: 1,
        },
      ],
    } satisfies SymbolBody;
    const doc = renderSymbol(symbol, { pins: [] });
    const numbers = doc.primitives.filter(
      (primitive) => primitive.kind === "text" && primitive.role === "pinNumber",
    );
    expect(numbers).toHaveLength(2);
    expect(numbers.every((primitive) => primitive.kind === "text" && primitive.hidden)).toBe(true);
    expect(toSvgText(doc)).toContain('<g display="none"><title>1</title>');
    expect(toSvgText(doc)).toContain('<g display="none"><title>2</title>');
  });
  test("always rotates visible-body vertical names toward the pin-facing side", () => {
    const pin = (number: string, x_nm: number, y_nm: number, rotation_mdeg: number): SymbolBody["pins"][number] => ({
      number,
      at: { x_nm, y_nm, rotation_mdeg },
      length_nm: 3_000_000,
      unit: 1,
      style: "line",
    });
    const symbol = {
      library: "test",
      name: "pin-name-rotation",
      units: 1,
      pin_numbers_hidden: true,
      pin_names_hidden: false,
      power: false,
      in_bom: true,
      on_board: true,
      pins: [
        pin("1", -1_000_000, -6_000_000, 90_000),
        pin("2", 1_000_000, 6_000_000, 270_000),
      ],
      body: [
        {
          kind: "rect",
          start: { x_nm: -3_000_000, y_nm: -3_000_000 },
          end: { x_nm: 3_000_000, y_nm: 3_000_000 },
          width_nm: 254_000,
          unit: 1,
        },
      ],
    } satisfies SymbolBody;
    const doc = renderSymbol(symbol, {
      pins: [
        { number: "1", name: "BOTTOM", type: "passive" },
        { number: "2", name: "TOP", type: "passive" },
      ],
    });
    expect(validateDoc(doc)).toEqual([]);
    const labels = doc.primitives.flatMap((primitive) => {
      if (primitive.kind !== "text" || primitive.role !== "pinName") return [];
      return [primitive];
    });
    expect(labels.map((label) => ({
      pin: label.pin,
      x: label.x,
      anchor: label.anchor,
      rotateMdeg: label.rotateMdeg,
    }))).toEqual([
      { pin: "1", x: -1_000_000, anchor: "start", rotateMdeg: 90_000 },
      { pin: "2", x: 1_000_000, anchor: "start", rotateMdeg: 90_000 },
    ]);

    const innerMinY = -2_873_000;
    const innerMaxY = 2_873_000;
    for (const label of labels) {
      const bounds = paintedTextBounds(label);
      const gap = label.pin === "1"
        ? bounds.bottom - innerMinY
        : innerMaxY - bounds.top;
      expect(gap).toBe(400_000);
    }
  });

  test("a bodyless vertical pin turns its name with its number, clear of the pin line", () => {
    const pin = (number: string, x_nm: number, y_nm: number, rotation_mdeg: number): SymbolBody["pins"][number] => ({
      number,
      at: { x_nm, y_nm, rotation_mdeg },
      length_nm: 2_540_000,
      unit: 1,
      style: "line",
    });
    const symbol = {
      library: "test",
      name: "bodyless-vertical",
      units: 1,
      pin_numbers_hidden: false,
      pin_names_hidden: false,
      power: false,
      in_bom: true,
      on_board: true,
      // No `body`: the symbol has no visible frame, so the name keeps the source's
      // `pin_name_offset` placement — but it must still turn with the pin, like the number does.
      pins: [pin("1", 0, -8_000_000, 90_000)],
    } satisfies SymbolBody;
    const doc = renderSymbol(symbol, {
      pins: [{ number: "1", name: "BOTTOM", type: "passive" }],
    });
    expect(validateDoc(doc)).toEqual([]);

    const label = doc.primitives.find(
      (primitive) => primitive.kind === "text" && primitive.role === "pinName",
    );
    const number = doc.primitives.find(
      (primitive) => primitive.kind === "text" && primitive.role === "pinNumber",
    );
    expect(label).toBeDefined();
    expect(number).toBeDefined();
    if (label?.kind !== "text" || number?.kind !== "text") throw new Error("labels are missing");

    // The name and the number agree about which way the pin runs.
    expect(label.rotateMdeg).toBe(90_000);
    expect(number.rotateMdeg).toBe(90_000);

    // The turned name runs alongside its pin line and keeps a 0.10 mm gap from it.
    const bounds = paintedTextBounds(label);
    const pinLineX = 0;
    expect(pinLineX - bounds.right).toBe(100_000);
  });

});
