import { irVersion } from "@texteda/ir";
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
  ir_version: irVersion,
  format: "0.8",
  project: "main",
  modules: [],
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
  fields: [],
  ...overrides,
});

const view = (
  wires: NonNullable<SchematicView["wire"]>,
  texts: { label?: unknown[]; port?: unknown[]; text?: unknown[] },
  modulePorts: { id: string; x_nm: number; y_nm: number }[] = [],
): SchematicView =>
  ({
    ir_version: irVersion,
    format: "0.8",
    project: "main",
    page: "p",
    place: [],
    ...(wires.length > 0 ? { wire: wires } : {}),
    ...(modulePorts.length > 0 ? { module_port: modulePorts } : {}),
    ...texts,
  }) as unknown as SchematicView;

const facts = (v: SchematicView, g: ReadabilityGeometry, board: Schematic = schematic): ReadabilityFacts => ({
  file: "views/p.view.teda",
  view: v,
  schematic: board,
  geometry: g,
});

/** The GND wire runs from R1.2 (40,5) left to U1.2 (10,5). */
const gndWire = {
  net: "GND",
  from_pin: "R1.2",
  to_pin: "U1.2",
};

// The overview: two module boxes with a port on the frame of each, joined by one board net.
const moduleBoxes = [
  { instance_id: "M1", box: { min_x_nm: 10 * MM, min_y_nm: 10 * MM, max_x_nm: 30 * MM, max_y_nm: 20 * MM } },
  { instance_id: "M2", box: { min_x_nm: 50 * MM, min_y_nm: 10 * MM, max_x_nm: 70 * MM, max_y_nm: 20 * MM } },
];

/** M1's port sits on M1's right frame, M2's on M2's left frame: where the overview draws them. */
const modulePorts = [
  { id: "M1.PORT", x_nm: 30 * MM, y_nm: 15 * MM },
  { id: "M2.PORT", x_nm: 50 * MM, y_nm: 15 * MM },
];

/** The board net the two module ports are bound to. */
const sysWire = { net: "SYS", from_pin: "M1.PORT", to_pin: "M2.PORT" };

const overviewSchematic: Schematic = {
  ...schematic,
  nets: [...schematic.nets, { id: "SYS", members: ["M1.PORT", "M2.PORT"] }],
};

const moduleGeometry = (overrides: Partial<ReadabilityGeometry> = {}): ReadabilityGeometry => ({
  symbols: [],
  texts: [],
  fields: [],
  modules: moduleBoxes,
  ...overrides,
});

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
          subject: "GND",
        },
      ],
    });
    const out = checkReadability(facts(view([gndWire], {}), g));
    expect(out.map((d) => d.code)).toEqual(["view.label-not-on-net"]);
    expect(out[0]!.severity).toBe("warning");
    // No locator was handed in, so the finding names the file only: the line was in the record.
    expect(out[0]!.location).toEqual({ file: "views/p.view.teda", line: 1, col: 1 });
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
          subject: "GND",
        },
      ],
    });
    expect(checkReadability(facts(view([gndWire], {}), g))).toEqual([]);
  });

  test("a port away from the net it names is reported", () => {
    const vinWire = { net: "VIN", from_pin: "U1.1", to_pin: "R1.2" };
    const g = geometry({
      texts: [
        {
          kind: "port",
          text: "VIN_PORT",
          x_nm: 80 * MM,
          y_nm: 80 * MM,
          box: { min_x_nm: 80 * MM, min_y_nm: 79 * MM, max_x_nm: 90 * MM, max_y_nm: 81 * MM },
          subject: "VIN_PORT",
        },
      ],
    });
    const out = checkReadability(facts(view([vinWire], {}), g));
    // The VIN run from U1.1 to R1.2 also passes through U1.2's pin on its way: a drawing defect of its own.
    expect(out.map((d) => d.code)).toEqual(["view.port-not-on-net", "view.wire-crosses-symbol", "view.wire-crosses-pin"]);
  });

  test("two labels on top of each other collide; label against note overlaps", () => {
    const box = { min_x_nm: 20 * MM, min_y_nm: 4 * MM, max_x_nm: 26 * MM, max_y_nm: 6 * MM };
    const labels = geometry({
      texts: [
        { kind: "label", text: "GND", x_nm: 20 * MM, y_nm: 5 * MM, box, subject: "GND" },
        { kind: "label", text: "VIN", x_nm: 21 * MM, y_nm: 5 * MM, box, subject: "VIN" },
      ],
    });
    expect(checkReadability(facts(view([gndWire], {}), labels)).map((d) => d.code)).toContain(
      "view.label-collision",
    );

    const mixed = geometry({
      texts: [
        { kind: "label", text: "GND", x_nm: 20 * MM, y_nm: 5 * MM, box, subject: "GND" },
        { kind: "text", text: "note", x_nm: 21 * MM, y_nm: 5 * MM, box },
      ],
    });
    expect(checkReadability(facts(view([gndWire], {}), mixed)).map((d) => d.code)).toContain(
      "view.text-overlap",
    );
  });

  test("two fields on top of each other are reported: a field is text on the sheet", () => {
    // The renderer places a page's fields so that they do not cover each other. When the page has
    // no room left, the reader is the one who has to see it.
    const box = { min_x_nm: 20 * MM, min_y_nm: 19 * MM, max_x_nm: 26 * MM, max_y_nm: 21 * MM };
    const g = geometry({
      fields: [
        {
          instance_id: "R1",
          name: "Reference",
          text: "R1",
          box,
        },
        {
          instance_id: "U1",
          name: "Value",
          text: "TPS5430DDAR",
          box,
        },
      ],
    });
    const out = checkReadability(facts(view([gndWire], {}), g));
    expect(out.map((d) => d.code)).toEqual(["view.text-overlap"]);
    expect(out[0]!.message).toContain("the Reference field of R1");
    expect(out[0]!.message).toContain("the Value field of U1");
  });

  test("boxes that merely touch do not collide", () => {
    // Off the GND run (y = 20mm): a note sitting on a wire is now `view.text-on-wire`, and this
    // test is about the text-versus-text rule only.
    const left = { min_x_nm: 20 * MM, min_y_nm: 19 * MM, max_x_nm: 25 * MM, max_y_nm: 21 * MM };
    const right = { min_x_nm: 25 * MM, min_y_nm: 19 * MM, max_x_nm: 30 * MM, max_y_nm: 21 * MM };
    const g = geometry({
      texts: [
        { kind: "text", text: "a", x_nm: 20 * MM, y_nm: 20 * MM, box: left },
        { kind: "text", text: "b", x_nm: 25 * MM, y_nm: 20 * MM, box: right },
      ],
    });
    expect(checkReadability(facts(view([gndWire], {}), g))).toEqual([]);
  });

  test("a wire through a symbol's field is reported even when the field is the wire's own part", () => {
    // `TPS5430DDAR` under a regulator whose ground pads drop through the value text: the wire is
    // correct and the word is not, which is exactly the case no other rule covers.
    const g = geometry({
      fields: [
        {
          instance_id: "R1",
          name: "Value",
          text: "3.24k",
          box: { min_x_nm: 32 * MM, min_y_nm: 4 * MM, max_x_nm: 38 * MM, max_y_nm: 6 * MM },
        },
      ],
    });
    const out = checkReadability(facts(view([gndWire], {}), g));
    expect(out.map((d) => d.code)).toEqual(["view.text-on-wire"]);
    expect(out[0]!.severity).toBe("warning");
    expect(out[0]!.message).toContain("the Value field of R1 (3.24k)");
    expect(out[0]!.data).toMatchObject({ net: "GND", kind: "field", instance: "R1", through_nm: 6 * MM });
  });

  test("a label's own net runs under it; another net's wire through it is reported", () => {
    const g = geometry({
      texts: [
        {
          kind: "label",
          text: "GND",
          x_nm: 20 * MM,
          y_nm: 5 * MM,
          box: { min_x_nm: 20 * MM, min_y_nm: 4 * MM, max_x_nm: 25 * MM, max_y_nm: 6 * MM },
          subject: "GND",
        },
      ],
    });
    // The label sits on the GND run it names: this is what a label is for.
    expect(checkReadability(facts(view([gndWire], {}), g))).toEqual([]);
    // A VIN run through the same letters is a different story.
    const vinWire = { net: "VIN", from_pin: "U1.1", to_pin: "R1.2" };
    // The VIN run passes through U1.2's pin as well; the label is the finding this test is about.
    expect(checkReadability(facts(view([vinWire], {}), g)).map((d) => d.code)).toEqual([
      "view.text-on-wire",
      "view.wire-crosses-symbol",
      "view.wire-crosses-pin",
    ]);
  });

  test("a wire that ends at the edge of a text is not through it", () => {
    const g = geometry({
      texts: [
        {
          kind: "label",
          text: "VIN",
          x_nm: 40 * MM,
          y_nm: 5 * MM,
          box: { min_x_nm: 40 * MM, min_y_nm: 4 * MM, max_x_nm: 45 * MM, max_y_nm: 6 * MM },
          subject: "VIN",
        },
      ],
    });
    // The GND run stops at R1.2 (40,5), the box's left edge: touching is not covering.
    const codes = checkReadability(facts(view([gndWire], {}), g)).map((d) => d.code);
    expect(codes).not.toContain("view.text-on-wire");
  });

  test("a wire through a symbol's body is reported once per body, including its own body", () => {
    // A GND wire from R1.2 to U1.2 stops at U1's right edge: touching an edge is not entering it.
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

    // A wire that connects U1.1 and U1.2 straight through U1's own body is the same defect.
    const throughOwnBody = { net: "GND", from_pin: "U1.1", to_pin: "U1.2" };
    const own = checkReadability(facts(view([throughOwnBody], {}), geometry()));
    expect(own.map((d) => d.code)).toEqual(["view.wire-crosses-symbol"]);
    expect(own[0]!.data).toEqual({ page: "p", net: "GND", instance: "U1", through_nm: 9_998_000 });
  });

  test("a wire that runs through a pin's connection point is reported", () => {
    // C1's pin 1 sits on the GND run at (20, 5), but the wire neither starts nor ends there.
    const g = geometry({
      symbols: [
        ...geometry().symbols,
        {
          instance_id: "C1",
          box: { min_x_nm: 20 * MM, min_y_nm: 6 * MM, max_x_nm: 24 * MM, max_y_nm: 8 * MM },
          pins: new Map([["1", { x_nm: 20 * MM, y_nm: 5 * MM }]]),
        },
      ],
    });
    const out = checkReadability(facts(view([gndWire], {}), g));
    expect(out.map((d) => d.code)).toEqual(["view.wire-crosses-pin"]);
    expect(out[0]!.data).toEqual({
      page: "p",
      net: "GND",
      instance: "C1",
      pin: "1",
      x_nm: 20 * MM,
      y_nm: 5 * MM,
    });
  });

  test("a wire that crosses a pin's drawn line without touching its connection point is reported", () => {
    const g = geometry({
      symbols: [
        {
          instance_id: "A",
          box: { min_x_nm: 23 * MM, min_y_nm: -1 * MM, max_x_nm: 24 * MM, max_y_nm: 1 * MM },
          pins: new Map([["1", { x_nm: 22 * MM, y_nm: 0 }]]),
        },
        {
          instance_id: "B",
          box: { min_x_nm: 23 * MM, min_y_nm: 9 * MM, max_x_nm: 24 * MM, max_y_nm: 11 * MM },
          pins: new Map([["1", { x_nm: 22 * MM, y_nm: 10 * MM }]]),
        },
        {
          instance_id: "C1",
          box: { min_x_nm: 24 * MM, min_y_nm: 4 * MM, max_x_nm: 26 * MM, max_y_nm: 6 * MM },
          pins: new Map([["1", { x_nm: 20 * MM, y_nm: 5 * MM }]]),
        },
      ],
    });
    // The run is vertical at x=22; C1.1's stroke runs from its connection point (20,5) to the body
    // edge (24,5). The wire crosses the stroke at (22,5), two millimetres from the connection point.
    const out = checkReadability(facts(view([{ net: "GND", from_pin: "A.1", to_pin: "B.1" }], {}), g));
    expect(out.map((d) => d.code)).toEqual(["view.wire-crosses-pin"]);
    expect(out[0]!.data).toEqual({
      page: "p",
      net: "GND",
      instance: "C1",
      pin: "1",
      x_nm: 20 * MM,
      y_nm: 5 * MM,
      cross_x_nm: 22 * MM,
      cross_y_nm: 5 * MM,
    });
    expect(out[0]!.message).toContain("line of pin C1.1");
  });

  test("wires of two different nets may cross: no dot means not connected", () => {
    const g = geometry({
      symbols: [
        ...geometry().symbols,
        {
          instance_id: "A",
          box: { min_x_nm: 31 * MM, min_y_nm: -1 * MM, max_x_nm: 32 * MM, max_y_nm: 1 * MM },
          pins: new Map([["1", { x_nm: 30 * MM, y_nm: 0 }]]),
        },
        {
          instance_id: "B",
          box: { min_x_nm: 31 * MM, min_y_nm: 9 * MM, max_x_nm: 32 * MM, max_y_nm: 11 * MM },
          pins: new Map([["1", { x_nm: 30 * MM, y_nm: 10 * MM }]]),
        },
      ],
    });
    const out = checkReadability(
      facts(view([gndWire, { net: "VIN", from_pin: "A.1", to_pin: "B.1" }], {}), g),
    );
    expect(out).toEqual([]);
  });

  test("a slanted run is reported: wiring is drawn along the axes only", () => {
    const slanted = {
      net: "GND",
      from_pin: "U1.2",
      to_pin: "R1.2",
      points: [{ x_nm: 20 * MM, y_nm: 8 * MM }, { x_nm: 40 * MM, y_nm: 8 * MM }],
    };
    const out = checkReadability(facts(view([slanted], {}), geometry()));
    expect(out.map((d) => d.code)).toEqual(["view.wire-diagonal"]);
    // The stub from U1.2 (10,5) to the first bend (20,8) is the one off the axes.
    expect(out[0]!.data).toEqual({
      page: "p",
      net: "GND",
      segments: 1,
      x_nm: 10 * MM,
      y_nm: 5 * MM,
      off_axis_nm: 3 * MM,
    });
  });

  test("the same run with its corner on the pin's row is not reported", () => {
    const orthogonal = {
      net: "GND",
      from_pin: "U1.2",
      to_pin: "R1.2",
      points: [{ x_nm: 10 * MM, y_nm: 8 * MM }, { x_nm: 40 * MM, y_nm: 8 * MM }],
    };
    expect(checkReadability(facts(view([orthogonal], {}), geometry()))).toEqual([]);
  });

  test("wires of one net crossing are not reported: they join, and a join is drawn with a dot", () => {
    const g = geometry({
      symbols: [
        ...geometry().symbols,
        {
          instance_id: "A",
          box: { min_x_nm: 31 * MM, min_y_nm: -1 * MM, max_x_nm: 32 * MM, max_y_nm: 1 * MM },
          pins: new Map([["1", { x_nm: 30 * MM, y_nm: 0 }]]),
        },
        {
          instance_id: "B",
          box: { min_x_nm: 31 * MM, min_y_nm: 9 * MM, max_x_nm: 32 * MM, max_y_nm: 11 * MM },
          pins: new Map([["1", { x_nm: 30 * MM, y_nm: 10 * MM }]]),
        },
      ],
    });
    // The second GND run crosses the first at (30,5): same net, a join.
    expect(checkReadability(facts(view([gndWire, { net: "GND", from_pin: "A.1", to_pin: "B.1" }], {}), g))).toEqual(
      [],
    );
  });

  test("a wire that crosses a module box is reported", () => {
    // M3 sits between M1 and M2, so the overview's own wire runs straight through its frame.
    const g = moduleGeometry({
      modules: [
        ...moduleBoxes,
        { instance_id: "M3", box: { min_x_nm: 35 * MM, min_y_nm: 10 * MM, max_x_nm: 45 * MM, max_y_nm: 20 * MM } },
      ],
    });
    const out = checkReadability(facts(view([sysWire], {}, modulePorts), g, overviewSchematic));
    expect(out.map((d) => d.code)).toEqual(["view.wire-crosses-module"]);
    expect(out[0]!.severity).toBe("error");
    expect(out[0]!.data).toEqual({
      page: "p",
      net: "SYS",
      module: "M3",
      x_nm: 35 * MM,
      y_nm: 15 * MM,
      through_nm: 10 * MM,
    });
    expect(out[0]!.message).toContain("through the box of module M3");
  });

  test("a wire may touch the frame of the module whose port it ends on", () => {
    // The overview's own wire: it starts on M1's frame and ends on M2's frame, at the module ports
    // it connects. That is the one place a wire may meet a module box.
    const out = checkReadability(facts(view([sysWire], {}, modulePorts), moduleGeometry(), overviewSchematic));
    expect(out).toEqual([]);
  });

  test("a wire that runs through the box of the module whose port it ends on is reported", () => {
    // The port is drawn inside M1's box instead of on its frame, so the wire leaves the module by
    // crossing its boundary: the own endpoint is not a licence to run through the box.
    const ports = [{ id: "M1.PORT", x_nm: 20 * MM, y_nm: 15 * MM }, modulePorts[1]!];
    const out = checkReadability(facts(view([sysWire], {}, ports), moduleGeometry(), overviewSchematic));
    expect(out.map((d) => d.code)).toEqual(["view.wire-crosses-module"]);
    expect(out[0]!.data).toMatchObject({ page: "p", net: "SYS", module: "M1", through_nm: 10 * MM });
  });

  test("a module port endpoint resolves through its own coordinates, not through a pin", () => {
    // A decoy: a symbol `M1` with a pin `PORT` inside M1's own box. `M1.PORT` names the module
    // port, so the wire starts on M1's frame — not at the pin, which would run it through the box.
    const g = moduleGeometry({
      symbols: [
        {
          instance_id: "M1",
          box: { min_x_nm: 13 * MM, min_y_nm: 13 * MM, max_x_nm: 17 * MM, max_y_nm: 17 * MM },
          pins: new Map([["PORT", { x_nm: 15 * MM, y_nm: 15 * MM }]]),
        },
      ],
    });
    const out = checkReadability(facts(view([sysWire], {}, modulePorts), g, overviewSchematic));
    expect(out.map((d) => d.code)).not.toContain("view.wire-crosses-module");

    // The same wire, read from the net: a label on the module port sits on the net it names.
    const labelled = moduleGeometry({
      ...g,
      texts: [
        {
          kind: "label",
          text: "SYS",
          x_nm: 30 * MM,
          y_nm: 15 * MM,
          box: { min_x_nm: 30 * MM, min_y_nm: 14 * MM, max_x_nm: 35 * MM, max_y_nm: 16 * MM },
          subject: "SYS",
        },
      ],
    });
    expect(checkReadability(facts(view([sysWire], {}, modulePorts), labelled, overviewSchematic))).toEqual([]);
  });
});
