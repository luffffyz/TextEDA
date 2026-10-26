// The board image: the pcb IR plus its footprints plus a pour, projected into the shape-bearing
// structure the writers serialize (ADR-0054 D4). Synthetic boards, for the same reason as fill.test:
// the projection consumes IR and geometry only.
import { irVersion } from "@texteda/ir";
import type { Footprint } from "@texteda/ir/footprint";
import type { Pcb } from "@texteda/ir/pcb";
import type { Point, Region } from "@texteda/geom";
import { describe, expect, test } from "bun:test";
import { boardImage, EDGE_WIDTH_NM } from "../src/board-image.ts";
import { SILK_WIDTH_NM } from "../src/silk.ts";
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
  test("layers follow the stackup, then each side's mask/paste/silk, and Edge.Cuts comes last", () => {
    const image = boardImage({ pcb: board(), placed: [], fill: [] });
    expect(image.layers.map((layer) => layer.layer)).toEqual([
      "F.Cu",
      "B.Cu",
      "F.Mask",
      "F.Paste",
      "F.SilkS",
      "B.Mask",
      "B.Paste",
      "B.SilkS",
      "Edge.Cuts",
    ]);
    // An empty layer still exists as a layer: the file says "nothing here", not "not defined".
    expect(image.layers.every((layer) => Array.isArray(layer.items))).toBe(true);
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

  test("the mask opening is the pad grown by the board's expansion", () => {
    const placed: PlacedFootprint[] = [
      { instance_id: "U1", footprint: footprint([smdPad("1", 0, 0, 1, 1)]) },
    ];
    const image = boardImage({
      pcb: board({
        place: [{ instance_id: "U1", x_nm: mm(5), y_nm: mm(5), rot_mdeg: 0, side: "top" }],
        rules: [{ type: "mask", expansion_nm: mm(0.05) }],
      }),
      placed,
      fill: [],
    });
    const mask = image.layers.find((layer) => layer.layer === "F.Mask")!;
    expect(mask.items.length).toBe(1);
    const item = mask.items[0]!;
    if (item.kind !== "region") throw new Error("expected a region");
    // A 1×1 mm pad grown by 0.05 mm on every side: the opening reaches 0.55 mm about the centre, to
    // within the tessellation of the offset tool (circumscribed, so growth is never short).
    const xs = item.shape.map((vertex) => vertex.x_nm);
    expect(Math.min(...xs) / 1_000_000).toBeCloseTo(4.45, 2);
    expect(Math.max(...xs) / 1_000_000).toBeCloseTo(5.55, 2);
    // Copper is untouched: the opening is not the pad.
    expect(image.layers.find((layer) => layer.layer === "F.Cu")!.items.length).toBe(1);
  });

  test("a pad's own mask= overrides the board rule, and a negative value shrinks the opening", () => {
    const pad = { ...smdPad("1", 0, 0, 1, 1), solder_mask_margin_nm: mm(-0.1) };
    const image = boardImage({
      pcb: board({
        place: [{ instance_id: "U1", x_nm: mm(5), y_nm: mm(5), rot_mdeg: 0, side: "top" }],
        rules: [{ type: "mask", expansion_nm: mm(0.05) }],
      }),
      placed: [{ instance_id: "U1", footprint: footprint([pad]) }],
      fill: [],
    });
    const item = image.layers.find((layer) => layer.layer === "F.Mask")!.items[0]!;
    if (item.kind !== "region") throw new Error("expected a region");
    // 1 mm pad, −0.1 mm per side: 0.8 mm wide about the centre. Shrinking goes through the kernel's
    // circumscribed tool, so the edges are exact only to the tessellation (spec/pcb.md §4.9).
    const left = Math.min(...item.shape.map((vertex) => vertex.x_nm));
    expect(left / 1_000_000).toBeCloseTo(4.6, 2);
  });

  test("*.Mask opens both sides: a through-hole barrel is open top and bottom", () => {
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
    // The opening *is* the pad: no expansion is declared (spec/pcb.md §4.9).
    for (const layer of ["F.Mask", "B.Mask"]) {
      expect(image.layers.find((entry) => entry.layer === layer)!.items).toEqual([
        { kind: "flash", diameter_nm: mm(1.6), at: point(2, 8) },
      ]);
    }
    // A through-hole pad names no paste layer, so the stencil gets nothing.
    expect(image.layers.find((entry) => entry.layer === "F.Paste")!.items).toEqual([]);
  });

  test("the paste aperture is the pad scaled to the declared area ratio", () => {
    const image = boardImage({
      pcb: board({
        place: [{ instance_id: "U1", x_nm: mm(5), y_nm: mm(5), rot_mdeg: 0, side: "top" }],
        rules: [{ type: "paste", ratio_ppm: 900_000, offset_nm: 0 }],
      }),
      placed: [{ instance_id: "U1", footprint: footprint([smdPad("1", 0, 0, 2, 1)]) }],
      fill: [],
    });
    const item = image.layers.find((layer) => layer.layer === "F.Paste")!.items[0]!;
    if (item.kind !== "region") throw new Error("expected a region");
    // 90 % of 2 mm² is 1.8 mm², and the scale is the square root of the *area* ratio.
    const width = Math.max(...item.shape.map((vertex) => vertex.x_nm)) - Math.min(...item.shape.map((vertex) => vertex.x_nm));
    const height = Math.max(...item.shape.map((vertex) => vertex.y_nm)) - Math.min(...item.shape.map((vertex) => vertex.y_nm));
    expect(width / 1_000_000).toBeCloseTo(2 * Math.sqrt(0.9), 2);
    expect(height / 1_000_000).toBeCloseTo(Math.sqrt(0.9), 2);
  });

  test("the paste offset is a per-edge margin applied after the ratio, and a pad's paste= replaces it", () => {
    const pad = { ...smdPad("1", 0, 0, 2, 1), solder_paste_margin_nm: mm(-0.1) };
    const image = boardImage({
      pcb: board({
        place: [{ instance_id: "U1", x_nm: mm(5), y_nm: mm(5), rot_mdeg: 0, side: "top" }],
        rules: [{ type: "paste", ratio_ppm: 1_000_000, offset_nm: mm(-0.02) }],
      }),
      placed: [{ instance_id: "U1", footprint: footprint([pad]) }],
      fill: [],
    });
    const item = image.layers.find((layer) => layer.layer === "F.Paste")!.items[0]!;
    if (item.kind !== "region") throw new Error("expected a region");
    // Ratio 1 leaves the pad as it is; the pad's own -0.1 mm then pulls every edge in.
    const width = Math.max(...item.shape.map((vertex) => vertex.x_nm)) - Math.min(...item.shape.map((vertex) => vertex.x_nm));
    expect(width).toBeGreaterThan(mm(1.6));
    expect(width).toBeLessThan(mm(1.8));
  });

  test("silk graphics land on the silk layer with the declared width, or the layer default", () => {
    const withGraphics: Footprint = {
      ir_version: irVersion,
      footprint: {
        library: "project",
        name: "test",
        pads: [smdPad("1", 0, 0, 1, 1)],
        graphics: [
          { kind: "line", layer: "F.SilkS", start: { x_nm: 0, y_nm: 0 }, end: { x_nm: mm(1), y_nm: 0 } },
          { kind: "line", layer: "F.SilkS", start: { x_nm: 0, y_nm: 0 }, end: { x_nm: 0, y_nm: mm(1) }, width_nm: mm(0.15) },
          { kind: "rect", layer: "F.Fab", start: { x_nm: 0, y_nm: 0 }, end: { x_nm: mm(1), y_nm: mm(1) } },
        ],
      },
    };
    const image = boardImage({
      pcb: board({ place: [{ instance_id: "U1", x_nm: mm(5), y_nm: mm(5), rot_mdeg: 0, side: "top" }] }),
      placed: [{ instance_id: "U1", footprint: withGraphics }],
      fill: [],
    });
    const silk = image.layers.find((layer) => layer.layer === "F.SilkS")!;
    expect(silk.items.map((item) => item.kind)).toEqual(["draw", "draw"]);
    expect(silk.items[0]!.kind === "draw" && silk.items[0]!.width_nm).toBe(SILK_WIDTH_NM);
    expect(silk.items[1]!.kind === "draw" && silk.items[1]!.width_nm).toBe(mm(0.15));
    // A fabrication-layer rect is not silk.
    expect(image.layers.flatMap((layer) => layer.items).some((item) => item.kind === "draw" && item.points.length === 5)).toBe(false);
  });

  test("a filled silk shape is a region and an arc is a polyline with both ends exact", () => {
    const withGraphics: Footprint = {
      ir_version: irVersion,
      footprint: {
        library: "project",
        name: "test",
        pads: [smdPad("1", 0, 0, 1, 1)],
        graphics: [
          { kind: "rect", layer: "F.SilkS", start: { x_nm: 0, y_nm: 0 }, end: { x_nm: mm(1), y_nm: mm(1) }, filled: true },
          {
            kind: "arc",
            layer: "F.SilkS",
            start: { x_nm: mm(1), y_nm: 0 },
            mid: { x_nm: 0, y_nm: mm(1) },
            end: { x_nm: mm(-1), y_nm: 0 },
          },
        ],
      },
    };
    const image = boardImage({
      pcb: board({ place: [{ instance_id: "U1", x_nm: mm(5), y_nm: mm(5), rot_mdeg: 0, side: "top" }] }),
      placed: [{ instance_id: "U1", footprint: withGraphics }],
      fill: [],
    });
    const items = image.layers.find((layer) => layer.layer === "F.SilkS")!.items;
    expect(items[0]!.kind).toBe("region");
    const arc = items[1]!;
    if (arc.kind !== "draw") throw new Error("expected a draw");
    // The arc is the upper half of a circle of radius 1 mm about the footprint origin, which sits at
    // the board's (5, 5); it starts and ends at the declared points.
    expect(arc.points[0]).toEqual(point(6, 5));
    expect(arc.points[arc.points.length - 1]).toEqual(point(4, 5));
    expect(arc.points.length).toBeGreaterThan(8);
    // Footprint +y points down the board's y, so the arc's apex sits 1 mm above the placement in the
    // board frame the file writes.
    expect(Math.max(...arc.points.map((vertex) => vertex.y_nm))).toBe(mm(6));
  });

  test("the board's silk rules put the reference on the declared layer and the field's layer does not gate", () => {
    const marked: Footprint = {
      ir_version: irVersion,
      footprint: {
        library: "project",
        name: "test",
        pads: [smdPad("1", 0, 0, 1, 1)],
        fields: [
          { name: "Reference", value: "REF**", at: { x_nm: 0, y_nm: mm(-2) }, layer: "F.SilkS" },
          { name: "Value", value: "VALUE**", at: { x_nm: 0, y_nm: mm(2) }, layer: "F.Fab" },
        ],
      },
    };
    const values = new Map([["U1", "10k"]]);
    const shown = boardImage({
      pcb: board({
        place: [{ instance_id: "U1", x_nm: mm(5), y_nm: mm(5), rot_mdeg: 0, side: "top" }],
        silk: [
          { item: "refdes", layer: "F.SilkS", size_nm: mm(1), mode: "show" },
          { item: "value", layer: "F.SilkS", size_nm: mm(0.8), mode: "show" },
        ],
      }),
      placed: [{ instance_id: "U1", footprint: marked }],
      fill: [],
      values,
    });
    const silk = shown.layers.find((layer) => layer.layer === "F.SilkS")!;
    // Two strings, both printed on F.SilkS even though the Value field lives on F.Fab.
    expect(silk.items.length).toBeGreaterThan(4);
    expect(silk.items.every((item) => item.kind === "draw")).toBe(true);

    const hidden = boardImage({
      pcb: board({ place: [{ instance_id: "U1", x_nm: mm(5), y_nm: mm(5), rot_mdeg: 0, side: "top" }] }),
      placed: [{ instance_id: "U1", footprint: marked }],
      fill: [],
      values,
    });
    // The default hides the value, so only the reference is printed; no value text means no silk at all
    // for a footprint whose only graphics are its fields.
    expect(hidden.layers.find((layer) => layer.layer === "F.SilkS")!.items.length).toBeLessThan(silk.items.length);
  });

  test("a hidden field prints nothing, even when the board prints its item", () => {
    const marked: Footprint = {
      ir_version: irVersion,
      footprint: {
        library: "project",
        name: "test",
        pads: [smdPad("1", 0, 0, 1, 1)],
        fields: [{ name: "Reference", value: "REF**", layer: "F.SilkS", hide: true }],
      },
    };
    const image = boardImage({
      pcb: board({ place: [{ instance_id: "U1", x_nm: mm(5), y_nm: mm(5), rot_mdeg: 0, side: "top" }] }),
      placed: [{ instance_id: "U1", footprint: marked }],
      fill: [],
    });
    expect(image.layers.find((layer) => layer.layer === "F.SilkS")!.items).toEqual([]);
  });

  test("a bottom-side part mirrors its silk layer, its drawing and its text", () => {
    const marked: Footprint = {
      ir_version: irVersion,
      footprint: {
        library: "project",
        name: "test",
        pads: [smdPad("1", 0, 0, 1, 1)],
        graphics: [
          { kind: "line", layer: "F.SilkS", start: { x_nm: mm(-1), y_nm: 0 }, end: { x_nm: 0, y_nm: 0 } },
        ],
        fields: [{ name: "Reference", value: "REF**", at: { x_nm: mm(1), y_nm: 0 }, layer: "F.SilkS" }],
      },
    };
    const image = boardImage({
      pcb: board({ place: [{ instance_id: "U1", x_nm: mm(5), y_nm: mm(5), rot_mdeg: 0, side: "bottom" }] }),
      placed: [{ instance_id: "U1", footprint: marked }],
      fill: [],
    });
    expect(image.layers.find((layer) => layer.layer === "F.SilkS")!.items).toEqual([]);
    const back = image.layers.find((layer) => layer.layer === "B.SilkS")!;
    expect(back.items.length).toBeGreaterThan(1);
    // The mirror flips x: a stroke reaching -1 mm goes to the right of the placement instead of left.
    const first = back.items[0]!;
    if (first.kind !== "draw") throw new Error("expected a draw");
    expect(first.points).toEqual([point(6, 5), point(5, 5)]);
    // The text's anchor mirrors too: +1 mm in footprint space lands 1 mm to the left on the board, so
    // the whole string stays left of the placement.
    const textPoints = back.items.slice(1).flatMap((item) => (item.kind === "draw" ? item.points : []));
    expect(textPoints.length).toBeGreaterThan(2);
    expect(Math.max(...textPoints.map((vertex) => vertex.x_nm))).toBeLessThan(mm(5));
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
