// The board image: the pcb IR plus its footprints plus a pour, projected into the shape-bearing
// structure the writers serialize (ADR-0054 D4). Synthetic boards, for the same reason as fill.test:
// the projection consumes IR and geometry only.
import { irVersion } from "@texteda/ir";
import type { Footprint } from "@texteda/ir/footprint";
import type { Pcb } from "@texteda/ir/pcb";
import type { Point, Region } from "@texteda/geom";
import { describe, expect, test } from "bun:test";
import { boardImage, EDGE_WIDTH_NM } from "../src/board-image.ts";
import { fillBoard } from "../src/fill/fill.ts";
import { fillBoardFacts } from "../src/fill/board.ts";
import type { PlacedFootprint } from "../src/fill/types.ts";

const mm = (value: number) => Math.round(value * 1_000_000);
const point = (x: number, y: number): Point => ({ x_nm: mm(x), y_nm: mm(y) });

const SQUARE: [Point, Point, Point, ...Point[]] = [point(0, 0), point(10, 0), point(10, 10), point(0, 10)];

function board(overrides: Partial<Pcb> = {}): Pcb {
  return {
    ir_version: irVersion,
    format: "0.7",
    board: "demo",
    board_thickness_nm: 1_600_000,
    stackup: [
      { type: "copper", layer: "F.Cu", thickness_nm: 35_000, kind: "signal" },
      { type: "dielectric", layer: "core", thickness_nm: 1_530_000, material: "FR4" },
      { type: "copper", layer: "B.Cu", thickness_nm: 35_000, kind: "signal" },
    ],
    outline: SQUARE,
    place: [],
    connect: [],
    rules: [{ type: "clearance", value_nm: 200_000 }],
    ...overrides,
  };
}

function footprint(pads: NonNullable<Footprint["footprint"]["pads"]>): Footprint {
  return {
    ir_version: irVersion,
    footprint: { library: "project", name: "test", pads },
  };
}

const smdPad = (number: string, x: number, y: number, w: number, h: number) => ({
  number,
  type: "smd" as const,
  shape: "rect" as const,
  at: { x_nm: mm(x), y_nm: mm(y) },
  size: { x_nm: mm(w), y_nm: mm(h) },
  layers: ["F.Cu", "F.Mask", "F.Paste"] as [string, ...string[]],
});

describe("boardImage", () => {
  test("layers follow the stackup and Edge.Cuts comes last", () => {
    const image = boardImage({ pcb: board(), placed: [], fill: [] });
    expect(image.layers.map((layer) => layer.layer)).toEqual(["F.Cu", "B.Cu", "Edge.Cuts"]);
  });

  test("the outline is a hairline draw on Edge.Cuts", () => {
    const image = boardImage({ pcb: board(), placed: [], fill: [] });
    const edge = image.layers.find((layer) => layer.layer === "Edge.Cuts")!;
    expect(edge.items).toEqual([{ kind: "draw", width_nm: EDGE_WIDTH_NM, points: SQUARE }]);
  });

  test("a rectangular pad is a region on its copper layer, not a flash", () => {
    const placed: PlacedFootprint[] = [
      { instance_id: "U1", footprint: footprint([smdPad("1", 0, 0, 1, 2)]) },
    ];
    const image = boardImage({
      pcb: board({ place: [{ instance_id: "U1", x_nm: mm(5), y_nm: mm(5), rot_mdeg: 0, side: "top" }] }),
      placed,
      fill: [],
    });
    const copper = image.layers.find((layer) => layer.layer === "F.Cu")!;
    expect(copper.items.length).toBe(1);
    const item = copper.items[0]!;
    expect(item.kind).toBe("region");
    // A 1×2 mm pad at the centre of a 10×10 board.
    if (item.kind === "region") {
      expect(item.shape.every((vertex) => vertex.x_nm >= mm(4.5) && vertex.x_nm <= mm(5.5))).toBe(true);
      expect(item.shape.every((vertex) => vertex.y_nm >= mm(4) && vertex.y_nm <= mm(6))).toBe(true);
    }
  });

  test("a round pad flashes with its diameter and lands at the pad's centre", () => {
    const placed: PlacedFootprint[] = [
      {
        instance_id: "U1",
        footprint: footprint([
          {
            number: "1",
            type: "smd",
            shape: "circle",
            at: { x_nm: 0, y_nm: 0 },
            size: { x_nm: mm(0.8), y_nm: mm(0.8) },
            layers: ["F.Cu"],
          },
        ]),
      },
    ];
    const image = boardImage({
      pcb: board({ place: [{ instance_id: "U1", x_nm: mm(5), y_nm: mm(4), rot_mdeg: 0, side: "top" }] }),
      placed,
      fill: [],
    });
    expect(image.layers.find((layer) => layer.layer === "F.Cu")!.items).toEqual([
      { kind: "flash", diameter_nm: mm(0.8), at: { x_nm: mm(5), y_nm: mm(4) } },
    ]);
  });

  test("a bottom-side part puts its copper on B.Cu", () => {
    const placed: PlacedFootprint[] = [
      { instance_id: "U1", footprint: footprint([smdPad("1", 0, 0, 1, 1)]) },
    ];
    const image = boardImage({
      pcb: board({ place: [{ instance_id: "U1", x_nm: mm(5), y_nm: mm(5), rot_mdeg: 0, side: "bottom" }] }),
      placed,
      fill: [],
    });
    expect(image.layers.find((layer) => layer.layer === "F.Cu")!.items).toEqual([]);
    expect(image.layers.find((layer) => layer.layer === "B.Cu")!.items.length).toBe(1);
  });

  test("a trace draws with its width on its layer", () => {
    const image = boardImage({
      pcb: board({
        trace: [
          {
            net: "GND",
            layer: "B.Cu",
            width_nm: mm(0.3),
            points: [point(1, 1), point(1, 5), point(4, 5)],
          },
        ],
      }),
      placed: [],
      fill: [],
    });
    expect(image.layers.find((layer) => layer.layer === "B.Cu")!.items).toEqual([
      { kind: "draw", width_nm: mm(0.3), points: [point(1, 1), point(1, 5), point(4, 5)] },
    ]);
  });

  test("a via flashes on every copper layer it spans and drills a plated hole", () => {
    const image = boardImage({
      pcb: board({ via: [{ net: "GND", x_nm: mm(3), y_nm: mm(4), size_nm: mm(0.6), drill_nm: mm(0.3) }] }),
      placed: [],
      fill: [],
    });
    for (const layer of ["F.Cu", "B.Cu"]) {
      expect(image.layers.find((entry) => entry.layer === layer)!.items).toEqual([
        { kind: "flash", diameter_nm: mm(0.6), at: point(3, 4) },
      ]);
    }
    expect(image.drills).toEqual([{ x_nm: mm(3), y_nm: mm(4), diameter_nm: mm(0.3), plated: true }]);
  });

  test("pour pieces become regions on the pour's layer", () => {
    const region: Region = [
      [point(0, 0), point(2, 0), point(2, 2), point(0, 2)],
      [point(2, 0), point(4, 0), point(4, 2), point(2, 2)],
    ];
    const image = boardImage({
      pcb: board(),
      placed: [],
      fill: [{ net: "GND", layer: "B.Cu", region, area_nm2: 8_000_000_000_000 }],
    });
    expect(image.layers.find((layer) => layer.layer === "B.Cu")!.items).toEqual([
      { kind: "region", shape: region[0]! },
      { kind: "region", shape: region[1]! },
    ]);
  });

  test("a mounting hole drills unplated and puts no copper on any layer", () => {
    const image = boardImage({
      pcb: board({
        physical_only: [{ id: "H1", type: "mounting", x_nm: mm(3.5), y_nm: mm(3.5), size_nm: mm(6), drill_nm: mm(3.2) }],
      }),
      placed: [],
      fill: [],
    });
    for (const layer of ["F.Cu", "B.Cu"]) expect(image.layers.find((entry) => entry.layer === layer)!.items).toEqual([]);
    expect(image.drills).toEqual([{ x_nm: mm(3.5), y_nm: mm(3.5), diameter_nm: mm(3.2), plated: false }]);
  });

  test("a through-hole pad drills plated at the pad's board position", () => {
    const placed: PlacedFootprint[] = [
      {
        instance_id: "J1",
        footprint: footprint([
          {
            number: "1",
            type: "th",
            shape: "circle",
            at: { x_nm: 0, y_nm: 0 },
            size: { x_nm: mm(1.6), y_nm: mm(1.6) },
            drill: { x_nm: mm(0.8), y_nm: mm(0.8) },
            layers: ["*.Cu", "*.Mask"],
          },
        ]),
      },
    ];
    const image = boardImage({
      pcb: board({ place: [{ instance_id: "J1", x_nm: mm(2), y_nm: mm(8), rot_mdeg: 0, side: "top" }] }),
      placed,
      fill: [],
    });
    expect(image.drills).toEqual([{ x_nm: mm(2), y_nm: mm(8), diameter_nm: mm(0.8), plated: true }]);
    // `*.Cu` reaches both copper layers.
    for (const layer of ["F.Cu", "B.Cu"]) expect(image.layers.find((entry) => entry.layer === layer)!.items.length).toBe(1);
  });

  test("an unplaced footprint contributes nothing (a partial layout, ADR-0040)", () => {
    const placed: PlacedFootprint[] = [
      { instance_id: "U1", footprint: footprint([smdPad("1", 0, 0, 1, 1)]) },
    ];
    const image = boardImage({ pcb: board(), placed, fill: [] });
    expect(image.layers.find((layer) => layer.layer === "F.Cu")!.items).toEqual([]);
  });
});

describe("fillBoardFacts", () => {
  test("reads zones, cutouts and rules from the pcb; only no_pour keepouts reach the fill", () => {
    const facts = fillBoardFacts({
      file: "design/pcb/demo.teda",
      pcb: board({
        zone: [{ net: "GND", layer: "B.Cu", points: SQUARE }],
        keepout: [
          { type: "no_pour", layer: "B.Cu", points: [point(1, 1), point(2, 1), point(2, 2)] },
          { type: "no_track", layer: "B.Cu", points: [point(4, 4), point(5, 4), point(5, 5)] },
        ],
        physical_only: [{ id: "X1", type: "cutout", x_nm: mm(7), y_nm: mm(7), w_nm: mm(1), h_nm: mm(1) }],
      }),
      placed: [],
      pin_net: new Map(),
      locate: () => ({ file: "design/pcb/demo.teda", line: 12, col: 1 }),
    });
    expect(facts.zones.map((zone) => [zone.net, zone.layer, zone.line])).toEqual([["GND", "B.Cu", 12]]);
    expect(facts.keepouts.length).toBe(1);
    expect(facts.cutouts.length).toBe(1);
    expect(facts.copper_layers).toEqual(["F.Cu", "B.Cu"]);
  });

  test("the pour it builds is what boardImage projects, piece for piece", () => {
    const pcb = board({
      zone: [{ net: "GND", layer: "B.Cu", points: SQUARE }],
      place: [{ instance_id: "U1", x_nm: mm(5), y_nm: mm(5), rot_mdeg: 0, side: "top" }],
    });
    const placed: PlacedFootprint[] = [{ instance_id: "U1", footprint: footprint([smdPad("1", 0, 0, 1, 1)]) }];
    const facts = fillBoardFacts({ file: "design/pcb/demo.teda", pcb, placed, pin_net: new Map([["U1.1", "VCC"]]) });
    const fill = fillBoard(facts).zones;
    expect(fill.length).toBe(1);
    const image = boardImage({ pcb, placed, fill });
    const regions = image.layers.find((layer) => layer.layer === "B.Cu")!.items.filter((item) => item.kind === "region");
    // Nothing but the pad's own copper and the pour: the pour is on B.Cu, the pad on F.Cu.
    expect(regions.length).toBe(fill[0]!.region.length);
  });
});
