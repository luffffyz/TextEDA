// The copper-fill policy (ADR-0018 D3): what a pour keeps clear of and what copper it leaves.
// Synthetic boards — the fill consumes geometry, nets and rules only, so no .teda and no library.
import { contains, regionArea, type Region } from "@texteda/geom";
import { irVersion } from "@texteda/ir";
import { describe, expect, test } from "bun:test";
import {
  buildObstacles,
  fillBoard,
  fillZone,
  rulesFromPcb,
  type FillFacts,
  type FillObstacle,
  type FillRules,
} from "../src/fill/index.ts";
import type { Footprint } from "@texteda/ir/footprint";
import type { Pcb } from "@texteda/ir/pcb";
import type { Point } from "@texteda/geom";

const mm = (value: number) => Math.round(value * 1_000_000);
const point = (x: number, y: number): Point => ({ x_nm: mm(x), y_nm: mm(y) });
const areaMm2 = (region: Region) => regionArea(region) / 1_000_000_000_000;

const SQUARE: [Point, Point, Point, ...Point[]] = [point(0, 0), point(10, 0), point(10, 10), point(0, 10)];

/** A 10×10 mm board with one placed instance at its centre. */
function board(overrides: Partial<Pcb> = {}): Pcb {
  return {
    ir_version: irVersion,
    format: "0.7",
    board: "b",
    board_thickness_nm: 1_600_000,
    stackup: [
      { type: "copper", layer: "F.Cu", thickness_nm: 35_000, kind: "signal" },
      { type: "dielectric", layer: "core", thickness_nm: 1_530_000, material: "FR4" },
      { type: "copper", layer: "B.Cu", thickness_nm: 35_000, kind: "signal" },
    ],
    outline: SQUARE,
    place: [{ instance_id: "U1", x_nm: mm(5), y_nm: mm(5), rot_mdeg: 0, side: "top" }],
    connect: [],
    rules: [{ type: "clearance", value_nm: 200_000 }],
    ...overrides,
  };
}

/** One footprint with a single centred pad of `size` mm. */
function footprint(size: [number, number], overrides: Record<string, unknown> = {}): Footprint {
  return {
    ir_version: irVersion,
    footprint: {
      library: "project",
      name: "test",
      pads: [
        {
          number: "1",
          type: "smd",
          shape: "rect",
          at: { x_nm: 0, y_nm: 0 },
          size: { x_nm: mm(size[0]), y_nm: mm(size[1]) },
          layers: ["F.Cu", "F.Mask", "F.Paste"],
          ...overrides,
        },
      ],
    },
  };
}

function facts(
  options: {
    pcb?: Pcb;
    obstacles?: FillObstacle[];
    rules?: FillRules;
    keepouts?: FillFacts["keepouts"];
    cutouts?: FillFacts["cutouts"];
  } = {},
): FillFacts {
  const pcb = options.pcb ?? board();
  return {
    file: "design/pcb/b.teda",
    outline: SQUARE,
    cutouts: options.cutouts ?? [],
    zones: [{ net: "GND", layer: "F.Cu", shape: SQUARE, line: 12 }],
    obstacles: options.obstacles ?? [],
    keepouts: options.keepouts ?? [],
    rules: options.rules ?? { ...rulesFromPcb(pcb), clearance_nm: 200_000, min_width_nm: null },
    copper_layers: ["F.Cu", "B.Cu"],
  };
}

/** A 1×1 mm VCC pad at the centre of the board, on F.Cu. */
const vccPad: FillObstacle = {
  kind: "pad",
  net: "VCC",
  layers: ["F.Cu"],
  shape: [[point(4.5, 4.5), point(5.5, 4.5), point(5.5, 5.5), point(4.5, 5.5)]],
  zone_connect: "solid",
  clearance_nm: null,
  thermal_gap_nm: null,
  thermal_bridge_nm: null,
  ref: "U1.1",
};

describe("rulesFromPcb", () => {
  test("reads clearance, thermal and min_width, and the per-net clearance", () => {
    const rules = rulesFromPcb(
      board({
        rules: [
          { type: "clearance", value_nm: 150_000 },
          { type: "width", value_nm: 250_000 },
          { type: "thermal", gap_nm: 300_000, bridge_nm: 500_000 },
          { type: "min_width", value_nm: 100_000 },
          { type: "net", net: "VBUS", clearance_nm: 400_000, width_nm: 500_000, via_size_nm: 800_000, via_drill_nm: 400_000 },
        ],
      }),
    );
    expect(rules.clearance_nm).toBe(150_000);
    expect(rules.thermal_gap_nm).toBe(300_000);
    expect(rules.thermal_bridge_nm).toBe(500_000);
    expect(rules.min_width_nm).toBe(100_000);
    expect(rules.net_clearance_nm.get("VBUS")).toBe(400_000);
  });

  test("rules the board does not declare fall back to the documented defaults", () => {
    const rules = rulesFromPcb(board({ rules: [{ type: "clearance", value_nm: 100_000 }] }));
    expect(rules.thermal_gap_nm).toBe(250_000);
    expect(rules.min_width_nm).toBe(null);
  });
});

describe("fillZone", () => {
  test("a zone over an empty board pours its own outline exactly", () => {
    const input = facts();
    const { output, diagnostics } = fillZone(input, input.zones[0]!);
    expect(diagnostics).toEqual([]);
    expect(areaMm2(output.region)).toBeCloseTo(100, 3);
    expect(output.net).toBe("GND");
    expect(output.layer).toBe("F.Cu");
  });

  test("the zone is clipped to the board, not the other way round", () => {
    const zone = { net: "GND", layer: "F.Cu", shape: [point(-5, -5), point(15, -5), point(15, 15), point(-5, 15)] };
    const result = fillZone({ ...facts(), zones: [zone] }, zone);
    expect(areaMm2(result.output.region)).toBeCloseTo(100, 3);
  });

  test("copper of another net is cleared by exactly the declared clearance", () => {
    const input = facts({ obstacles: [vccPad] });
    const { output } = fillZone(input, input.zones[0]!);
    // 50 µm outside the clearance boundary is copper; 50 µm inside it is not.
    expect(contains(output.region, point(4.25, 5))).toBe(true);
    expect(contains(output.region, point(4.35, 5))).toBe(false);
    // The pad itself is never poured over.
    expect(contains(output.region, point(5, 5))).toBe(false);
  });

  test("a pad's own clearance_nm widens the cut beyond the board rule", () => {
    const input = facts({ obstacles: [{ ...vccPad, clearance_nm: 500_000 }] });
    const { output } = fillZone(input, input.zones[0]!);
    expect(contains(output.region, point(4.25, 5))).toBe(false);
    expect(contains(output.region, point(3.75, 5))).toBe(true);
  });

  test("a per-net rule widens the gap, and a pair takes the larger of the two nets' values", () => {
    const rules: FillRules = { ...rulesFromPcb(board()), net_clearance_nm: new Map([["VCC", 600_000]]) };
    const input = facts({ obstacles: [vccPad], rules });
    const { output } = fillZone(input, input.zones[0]!);
    expect(contains(output.region, point(4.25, 5))).toBe(false);
    expect(contains(output.region, point(3.75, 5))).toBe(true);
  });

  test("same-net copper that connects solid is poured over", () => {
    const input = facts({ obstacles: [{ ...vccPad, net: "GND" }] });
    const { output } = fillZone(input, input.zones[0]!);
    expect(areaMm2(output.region)).toBeCloseTo(100, 3);
    expect(contains(output.region, point(5, 5))).toBe(true);
  });

  test("same-net copper declared none keeps the full clearance", () => {
    const input = facts({ obstacles: [{ ...vccPad, net: "GND", zone_connect: "none" }] });
    const { output } = fillZone(input, input.zones[0]!);
    expect(contains(output.region, point(5, 5))).toBe(false);
    expect(contains(output.region, point(4.35, 5))).toBe(false);
    expect(contains(output.region, point(4.25, 5))).toBe(true);
  });

  test("a thermal relief keeps four spokes and leaves the diagonals empty", () => {
    const input = facts({ obstacles: [{ ...vccPad, net: "GND", zone_connect: "thermal" }] });
    const { output } = fillZone(input, input.zones[0]!);
    // The gap ring stays empty on the spoke directions' sides...
    expect(contains(output.region, point(4.35, 4.35))).toBe(false);
    // ...and the four spokes reach across it.
    for (const spoke of [point(4.35, 5), point(5.65, 5), point(5, 4.35), point(5, 5.65)]) {
      expect(contains(output.region, spoke)).toBe(true);
    }
    // A relief keeps only the four bridges: what it removes is the gap annulus minus them.
    expect(areaMm2(output.region)).toBeGreaterThan(98.5);
    expect(areaMm2(output.region)).toBeLessThan(99.3);
  });

  test("a no_pour keepout removes its area; a keepout on another layer does not", () => {
    const keepout = [point(0, 0), point(2, 0), point(2, 2), point(0, 2)];
    const onZone = facts({ keepouts: [{ layer: "F.Cu", shape: keepout }] });
    expect(areaMm2(fillZone(onZone, onZone.zones[0]!).output.region)).toBeCloseTo(96, 3);
    const elsewhere = facts({ keepouts: [{ layer: "B.Cu", shape: keepout }] });
    expect(areaMm2(fillZone(elsewhere, elsewhere.zones[0]!).output.region)).toBeCloseTo(100, 3);
  });

  test("a board cutout is a hole in the pour", () => {
    const cutout = [point(0, 0), point(2, 0), point(2, 2), point(0, 2)];
    const input = facts({ cutouts: [cutout] });
    const { output } = fillZone(input, input.zones[0]!);
    expect(areaMm2(output.region)).toBeCloseTo(96, 3);
    expect(contains(output.region, point(1, 1))).toBe(false);
  });

  test("copper with no net is cleared, never poured over", () => {
    const input = facts({ obstacles: [{ ...vccPad, net: null }] });
    const { output } = fillZone(input, input.zones[0]!);
    expect(contains(output.region, point(5, 5))).toBe(false);
    expect(areaMm2(output.region)).toBeLessThan(99);
  });

  test("two runs over the same board produce byte-identical copper", () => {
    const input = facts({ obstacles: [vccPad] });
    const first = fillZone(input, input.zones[0]!);
    const second = fillZone(input, input.zones[0]!);
    expect(JSON.stringify(first.output.region)).toBe(JSON.stringify(second.output.region));
    expect(first.output.area_nm2).toBe(second.output.area_nm2);
  });

  test("min_width removes a thin neck and reports the loss", () => {
    // A 0.1 mm slit leaves a 0.1 mm neck, which a 0.3 mm rule cannot etch.
    const slit = [point(4.45, 0), point(4.95, 0), point(4.95, 4.95), point(4.45, 4.95)];
    const rules: FillRules = { ...rulesFromPcb(board()), min_width_nm: 300_000 };
    const input = facts({ keepouts: [{ layer: "F.Cu", shape: slit }], rules });
    const { output, diagnostics } = fillZone(input, input.zones[0]!);
    expect(areaMm2(output.region)).toBeLessThan(100 - 4.9 * 0.1 - 0.05);
    const reported = diagnostics.find((entry) => entry.code === "drc.zone-min-width");
    expect(reported).toBeDefined();
    expect(reported!.severity).toBe("warning");
    expect(reported!.data?.removed_nm2).toBeGreaterThan(0);
  });

  test("a zone on a layer the board does not have pours nothing and says why", () => {
    const zone = { net: "GND", layer: "In1.Cu", shape: SQUARE, line: 3 };
    const result = fillZone({ ...facts(), zones: [zone] }, zone);
    expect(result.output.region).toEqual([]);
    const codes = result.diagnostics.map((entry) => entry.code);
    expect(codes).toContain("drc.zone-layer-not-copper");
    expect(codes).not.toContain("drc.zone-empty");
  });

  test("a zone swallowed by a keepout reports an empty pour", () => {
    const input = facts({ keepouts: [{ layer: "F.Cu", shape: SQUARE }] });
    const { output, diagnostics } = fillZone(input, input.zones[0]!);
    expect(output.area_nm2).toBe(0);
    expect(diagnostics.map((entry) => entry.code)).toEqual(["drc.zone-empty"]);
  });

  test("a zone cut away by surrounding copper reports an empty pour too", () => {
    const blanket: FillObstacle = {
      ...vccPad,
      net: "VCC",
      shape: [[point(-20, -20), point(30, -20), point(30, 30), point(-20, 30)]],
    };
    const input = facts({ obstacles: [blanket] });
    const { diagnostics } = fillZone(input, input.zones[0]!);
    expect(diagnostics.map((entry) => entry.code)).toContain("drc.zone-empty");
  });
});

describe("buildObstacles", () => {
  test("a bottom-side part puts its pad copper on the mirrored layer", () => {
    const pcb = board({ place: [{ instance_id: "U1", x_nm: mm(5), y_nm: mm(5), rot_mdeg: 0, side: "bottom" }] });
    const obstacles = buildObstacles({
      pcb,
      placed: [{ instance_id: "U1", footprint: footprint([1, 1]) }],
      pin_net: new Map([["U1.1", "VCC"]]),
    });
    expect(obstacles).toHaveLength(1);
    expect(obstacles[0]!.layers).toEqual(["B.Cu"]);
    expect(obstacles[0]!.net).toBe("VCC");
    // A centred pad on a mirrored part is still centred, so a B.Cu pour keeps clear of it.
    const zone = { net: "GND", layer: "B.Cu", shape: SQUARE };
    const input: FillFacts = { ...facts({ pcb }), zones: [zone], obstacles };
    expect(contains(fillZone(input, zone).output.region, point(5, 5))).toBe(false);
  });

  test("a trace is one capsule per segment; a via is a ring on every copper layer", () => {
    const pcb = board({
      trace: [{ net: "VCC", layer: "F.Cu", width_nm: 200_000, points: [point(1, 1), point(3, 1), point(3, 3)] }],
      via: [{ net: "VCC", x_nm: mm(7), y_nm: mm(7), size_nm: 600_000, drill_nm: 300_000 }],
    });
    const obstacles = buildObstacles({ pcb, placed: [], pin_net: new Map() });
    expect(obstacles).toHaveLength(2);
    expect(obstacles[0]!.kind).toBe("trace");
    expect(obstacles[0]!.shape).toHaveLength(2);
    expect(obstacles[1]!.layers).toEqual(["F.Cu", "B.Cu"]);
    const input: FillFacts = { ...facts({ pcb }), obstacles };
    const { output } = fillZone(input, input.zones[0]!);
    expect(contains(output.region, point(2, 1))).toBe(false);
    expect(contains(output.region, point(7, 7))).toBe(false);
    // 0.3 mm radius + 0.2 mm clearance = 0.5 mm, so 0.6 mm out is copper again.
    expect(contains(output.region, point(7, 7.6))).toBe(true);
  });

  test("a pad with no net in the schematic is copper no pour owns", () => {
    const obstacles = buildObstacles({
      pcb: board(),
      placed: [{ instance_id: "U1", footprint: footprint([1, 1]) }],
      pin_net: new Map(),
    });
    expect(obstacles[0]!.net).toBe(null);
  });

  test("a through-hole pad gets a thermal relief by default, an SMD pad a solid one", () => {
    const obstacles = buildObstacles({
      pcb: board(),
      placed: [
        { instance_id: "U1", footprint: footprint([1, 1], { type: "th", layers: ["*.Cu", "*.Mask"], drill: { x_nm: 300_000, y_nm: 300_000 } }) },
      ],
      pin_net: new Map([["U1.1", "GND"]]),
    });
    expect(obstacles[0]!.zone_connect).toBe("thermal");
    expect(obstacles[0]!.layers).toEqual(["F.Cu", "B.Cu"]);
  });
});

describe("fillBoard", () => {
  test("fills every zone and collects their diagnostics in declaration order", () => {
    const input: FillFacts = {
      ...facts(),
      zones: [
        { net: "GND", layer: "F.Cu", shape: SQUARE, line: 4 },
        { net: "GND", layer: "B.Cu", shape: SQUARE, line: 5 },
        { net: "GND", layer: "In9.Cu", shape: SQUARE, line: 6 },
      ],
    };
    const result = fillBoard(input);
    expect(result.zones.map((entry) => entry.layer)).toEqual(["F.Cu", "B.Cu", "In9.Cu"]);
    expect(result.zones[2]!.area_nm2).toBe(0);
    expect(result.diagnostics.map((entry) => entry.code)).toEqual(["drc.zone-layer-not-copper"]);
  });
});

describe("drc.zone-overlap", () => {
  test("two zones of different nets on one layer that overlap are refused, and nothing pours", () => {
    const pcb = board();
    const input: FillFacts = {
      ...facts({ pcb }),
      zones: [
        { net: "GND", layer: "F.Cu", shape: SQUARE, line: 12 },
        { net: "VCC", layer: "F.Cu", shape: [point(5, 5), point(15, 5), point(15, 15), point(5, 15)], line: 13 },
      ],
    };
    const gnd = fillZone(input, input.zones[0]!);
    expect(gnd.output.region).toEqual([]);
    expect(gnd.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["drc.zone-overlap"]);
    expect(gnd.diagnostics[0]!.related).toEqual([{ file: input.file, line: 13, col: 1 }]);
    const vcc = fillZone(input, input.zones[1]!);
    expect(vcc.output.region).toEqual([]);
    expect(vcc.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["drc.zone-overlap"]);
  });

  test("the same net twice, or the same outline on another layer, is not an overlap", () => {
    const input: FillFacts = {
      ...facts({ pcb: board() }),
      zones: [
        { net: "GND", layer: "F.Cu", shape: SQUARE, line: 12 },
        { net: "GND", layer: "F.Cu", shape: SQUARE, line: 13 },
        { net: "VCC", layer: "B.Cu", shape: SQUARE, line: 14 },
      ],
    };
    for (const zone of input.zones) {
      const fill = fillZone(input, zone);
      expect(fill.diagnostics.some((diagnostic) => diagnostic.code === "drc.zone-overlap")).toBe(false);
      expect(areaMm2(fill.output.region)).toBeCloseTo(100, 6);
    }
  });
});
