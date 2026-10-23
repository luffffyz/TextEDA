import { describe, expect, test } from "bun:test";
import type { Schematic } from "@texteda/ir/schematic";
import type { SchematicView } from "@texteda/ir/schematic-view";
import { viewMetrics } from "../src/view/metrics.ts";
import type { ReadabilityGeometry } from "../src/view/facts.ts";

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

const geometry: ReadabilityGeometry = {
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
      pins: new Map([
        ["1", { x_nm: 48 * MM, y_nm: 5 * MM }],
        ["2", { x_nm: 40 * MM, y_nm: 5 * MM }],
      ]),
    },
  ],
  texts: [
    {
      kind: "label",
      text: "GND",
      x_nm: 20 * MM,
      y_nm: 5 * MM,
      box: { min_x_nm: 20 * MM, min_y_nm: 4 * MM, max_x_nm: 24 * MM, max_y_nm: 6 * MM },
      subject: "GND",
    },
    {
      kind: "label",
      text: "VIN",
      x_nm: 20 * MM,
      y_nm: 10 * MM,
      box: { min_x_nm: 20 * MM, min_y_nm: 9 * MM, max_x_nm: 24 * MM, max_y_nm: 11 * MM },
      subject: "VIN",
    },
  ],
};

const view = (wires: NonNullable<SchematicView["wire"]>): SchematicView =>
  ({
    ir_version: "0.9",
    format: "0.8",
    board: "b",
    page: "p",
    sheet: { width_nm: 100 * MM, height_nm: 100 * MM },
    place: [],
    ...(wires.length > 0 ? { wire: wires } : {}),
  }) as unknown as SchematicView;

describe("viewMetrics", () => {
  test("reports counts, sizes and each net text's distance to its net", () => {
    // GND: R1.2 -> U1.2 runs along y=5 through x=20 (the GND label sits on it).
    const wires = [{ net: "GND", from_pin: "R1.2", to_pin: "U1.2" }];
    const metrics = viewMetrics({ view: view(wires), schematic, geometry });

    expect(metrics.counts).toEqual({ instances: 2, labels: 2, ports: 0, notes: 0, wires: 1, nets_undrawn: 1 });
    expect(metrics.wire_total_nm).toBe(30 * MM);
    // The two label boxes are 3mm apart vertically (6mm bottom edge, 9mm top edge).
    expect(metrics.label_min_gap_nm).toBe(3 * MM);
    const byText = new Map(metrics.net_texts.map((text) => [text.text, text]));
    expect(byText.get("GND")!.distance_nm).toBe(0);
    // VIN has a pin at U1.1 (0,5) and no wire here: the nearest VIN point is 20mm away.
    expect(byText.get("VIN")!.distance_nm).toBe(Math.round(Math.hypot(20 * MM, 5 * MM)));
    expect(metrics.content).toEqual({ min_x_nm: 0, min_y_nm: 0, max_x_nm: 48 * MM, max_y_nm: 11 * MM });
    expect(metrics.content_fill_ppm).toBe(Math.round(((48 * MM * 11 * MM) / (100 * MM * 100 * MM)) * 1_000_000));
  });

  test("a net with neither wiring nor a placed pin on the page reports -1", () => {
    const metrics = viewMetrics({
      view: view([]),
      schematic,
      geometry: { symbols: [], texts: geometry.texts },
    });
    const byText = new Map(metrics.net_texts.map((text) => [text.text, text]));
    // Nothing of the net exists here: 0 would read as "on the net", which is the opposite.
    expect(byText.get("GND")!.distance_nm).toBe(-1);
    expect(byText.get("VIN")!.distance_nm).toBe(-1);
  });

  test("a net drawn nowhere still measures to the pins it has on the page", () => {
    const metrics = viewMetrics({ view: view([]), schematic, geometry });
    expect(metrics.counts.nets_undrawn).toBe(2);
    expect(metrics.net_texts.every((text) => text.distance_nm > 0)).toBe(true);
    expect(metrics.net_texts.find((text) => text.text === "GND")!.distance_nm).toBeGreaterThan(0);
  });

  test("crossings count wires of different nets that pass through each other, not wires that meet", () => {
    // A straight VIN run at x=20 from y=0 to y=30 over the straight GND run at y=5.
    const withJ1: ReadabilityGeometry = {
      ...geometry,
      symbols: [
        ...geometry.symbols,
        {
          instance_id: "J1",
          box: { min_x_nm: 19 * MM, min_y_nm: 0, max_x_nm: 21 * MM, max_y_nm: 30 * MM },
          pins: new Map([
            ["1", { x_nm: 20 * MM, y_nm: 0 }],
            ["2", { x_nm: 20 * MM, y_nm: 30 * MM }],
          ]),
        },
      ],
    };
    const wires = [
      { net: "GND", from_pin: "U1.2", to_pin: "R1.2" },
      { net: "VIN", from_pin: "J1.1", to_pin: "J1.2" },
    ];
    const metrics = viewMetrics({ view: view(wires), schematic, geometry: withJ1 });
    // One perpendicular crossing at (20,5).
    expect(metrics.wire_crossings).toBe(1);
  });

  test("wires that meet at a shared pin do not count as crossings", () => {
    // Both nets leave U1.2 (10,5): touching at the pin is a junction, not a crossing.
    const wires = [
      { net: "GND", from_pin: "U1.2", to_pin: "R1.2" },
      {
        net: "VIN",
        from_pin: "U1.2",
        to_pin: "U1.1",
        points: [{ x_nm: 10 * MM, y_nm: 20 * MM }],
      },
    ];
    const metrics = viewMetrics({ view: view(wires), schematic, geometry });
    expect(metrics.wire_crossings).toBe(0);
  });

  test("a wire through another symbol's body is counted", () => {
    const wires = [
      {
        net: "GND",
        from_pin: "R1.2",
        to_pin: "R1.1",
        points: [{ x_nm: 40 * MM, y_nm: 20 * MM }, { x_nm: 48 * MM, y_nm: 20 * MM }],
      },
    ];
    const withObstacle: ReadabilityGeometry = {
      ...geometry,
      symbols: [
        ...geometry.symbols,
        {
          instance_id: "C1",
          box: { min_x_nm: 43 * MM, min_y_nm: 15 * MM, max_x_nm: 45 * MM, max_y_nm: 25 * MM },
          pins: new Map(),
        },
      ],
    };
    const metrics = viewMetrics({ view: view(wires), schematic, geometry: withObstacle });
    expect(metrics.wires_through_bodies).toBe(1);
  });

  test("an empty page measures zero without inventing content", () => {
    const metrics = viewMetrics({
      view: view([]),
      schematic,
      geometry: { symbols: [], texts: [] },
    });
    expect(metrics.content).toBeNull();
    expect(metrics.content_fill_ppm).toBe(0);
    expect(metrics.text_min_gap_nm).toBeNull();
    expect(metrics.label_min_gap_nm).toBeNull();
    expect(metrics.wire_total_nm).toBe(0);
  });
});
