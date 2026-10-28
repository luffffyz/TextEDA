// The Gerber file is a byte contract (ADR-0117 D9): header order, integer
// coordinates, aperture integer arithmetic, statement order, and one LF at the end. These tests pin
// the bytes rather than the shape, because a Gerber file that "looks right" is exactly the failure a
// board house reports after fabrication.
import { describe, expect, test } from "bun:test";
import type { BoardImage, ImageLayer, ManufacturingStamp } from "@texteda/core/image";
import { decimal, gerberLayer, toGerber } from "../src/gerber.ts";

const stamp: ManufacturingStamp = { tool_version: "1.2.3", source_hash: "abc123" };

function image(layers: ImageLayer[], board = "demo"): BoardImage {
  return { board, layers, drills: [] };
}

const header = [
  "G04 TextEDA 1.2.3*",
  "G04 source abc123*",
  "%FSLAX46Y46*%",
  "%MOMM*%",
  "%LPD*%",
];

describe("decimal", () => {
  test("millimetres from integer nanometres, never a float", () => {
    expect(decimal(300_000)).toBe("0.300000");
    expect(decimal(1)).toBe("0.000001");
    expect(decimal(0)).toBe("0.000000");
    expect(decimal(2_500_000)).toBe("2.500000");
    expect(decimal(-1_234_567)).toBe("-1.234567");
  });

  test("a negative sub-millimetre value keeps its sign", () => {
    expect(decimal(-1)).toBe("-0.000001");
  });

  test("3 decimals for the drill-style reading of the same number", () => {
    expect(decimal(300_000, 3)).toBe("0.300");
  });
});

describe("header", () => {
  test("order is tool, source, format, units, polarity, then apertures", () => {
    const file = gerberLayer(image([{ layer: "F.Cu", items: [] }]), { layer: "F.Cu", items: [] }, stamp);
    expect(file.text.split("\n").slice(0, 5)).toEqual(header);
    expect(file.name).toBe("demo-F_Cu.gbr");
  });

  test("an empty layer is still a complete file, ending with exactly one LF after M02*", () => {
    const file = gerberLayer(image([]), { layer: "B.Cu", items: [] }, stamp);
    expect(file.text.endsWith("M02*\n")).toBe(true);
    expect(file.text.endsWith("M02*\n\n")).toBe(false);
    expect(file.text.split("\n").slice(5)).toEqual(["M02*", ""]);
  });

  test("the layer name maps dots to underscores in the file name", () => {
    const file = gerberLayer(image([]), { layer: "Edge.Cuts", items: [] }, stamp);
    expect(file.name).toBe("demo-Edge_Cuts.gbr");
  });
});

describe("apertures", () => {
  test("deduped, ascending from D10, six decimals", () => {
    const file = gerberLayer(
      image([]),
      {
        layer: "F.Cu",
        items: [
          { kind: "draw", width_nm: 600_000, points: [{ x_nm: 0, y_nm: 0 }, { x_nm: 1_000_000, y_nm: 0 }] },
          { kind: "draw", width_nm: 300_000, points: [{ x_nm: 0, y_nm: 1_000_000 }, { x_nm: 1_000_000, y_nm: 1_000_000 }] },
          { kind: "flash", diameter_nm: 300_000, at: { x_nm: 2_000_000, y_nm: 0 } },
        ],
      },
      stamp,
    );
    const lines = file.text.split("\n");
    expect(lines.slice(5, 7)).toEqual(["%ADD10C,0.300000*%", "%ADD11C,0.600000*%"]);
    // One select per diameter, and only when it changes.
    expect(lines.filter((line) => line === "D10*").length).toBe(2);
    expect(lines.filter((line) => line === "D11*").length).toBe(1);
  });

  test("a non-positive width is not an aperture and draws nothing", () => {
    const file = gerberLayer(
      image([]),
      {
        layer: "F.Cu",
        items: [
          { kind: "draw", width_nm: 0, points: [{ x_nm: 0, y_nm: 0 }, { x_nm: 1_000_000, y_nm: 0 }] },
          { kind: "flash", diameter_nm: 500_000, at: { x_nm: 0, y_nm: 0 } },
        ],
      },
      stamp,
    );
    expect(file.text).toContain("%ADD10C,0.500000*%");
    expect(file.text).not.toContain("D01*");
  });
});

describe("statements", () => {
  test("a flash is a D03 with integer nanometre coordinates", () => {
    const file = gerberLayer(
      image([]),
      { layer: "F.Cu", items: [{ kind: "flash", diameter_nm: 600_000, at: { x_nm: 12_500_000, y_nm: -300_000 } }] },
      stamp,
    );
    expect(file.text).toContain("%ADD10C,0.600000*%");
    expect(file.text).toContain("D10*\nX12500000Y-300000D03*");
  });

  test("a draw moves with D02 then draws with D01 for each following point", () => {
    const file = gerberLayer(
      image([]),
      {
        layer: "F.Cu",
        items: [{ kind: "draw", width_nm: 300_000, points: [{ x_nm: 0, y_nm: 0 }, { x_nm: 1_000_000, y_nm: 0 }, { x_nm: 1_000_000, y_nm: 1_000_000 }] }],
      },
      stamp,
    );
    const lines = file.text.split("\n");
    const start = lines.indexOf("D10*");
    expect(lines.slice(start + 1, start + 4)).toEqual(["X0Y0D02*", "X1000000Y0D01*", "X1000000Y1000000D01*"]);
  });

  test("a region is G36/G37 and does not repeat the first vertex", () => {
    const ring = [
      { x_nm: 0, y_nm: 0 },
      { x_nm: 1_000_000, y_nm: 0 },
      { x_nm: 1_000_000, y_nm: 1_000_000 },
      { x_nm: 0, y_nm: 1_000_000 },
    ];
    const file = gerberLayer(image([]), { layer: "F.Cu", items: [{ kind: "region", shape: ring }] }, stamp);
    const lines = file.text.split("\n").slice(5);
    expect(lines).toEqual([
      "G36*",
      "X0Y0D02*",
      "X1000000Y0D01*",
      "X1000000Y1000000D01*",
      "X0Y1000000D01*",
      "G37*",
      "M02*",
      "",
    ]);
  });

  test("order is regions, then draws, then flashes — never insertion order", () => {
    const item = (kind: "region" | "draw" | "flash"): ImageLayer["items"][number] =>
      kind === "region"
        ? { kind, shape: [{ x_nm: 0, y_nm: 0 }, { x_nm: 1_000_000, y_nm: 0 }, { x_nm: 0, y_nm: 1_000_000 }] }
        : kind === "draw"
          ? { kind, width_nm: 300_000, points: [{ x_nm: 0, y_nm: 0 }, { x_nm: 1_000_000, y_nm: 0 }] }
          : { kind, diameter_nm: 300_000, at: { x_nm: 5_000_000, y_nm: 5_000_000 } };
    const forward = gerberLayer(image([]), { layer: "F.Cu", items: [item("region"), item("draw"), item("flash")] }, stamp);
    const reversed = gerberLayer(image([]), { layer: "F.Cu", items: [item("flash"), item("draw"), item("region")] }, stamp);
    expect(reversed.text).toBe(forward.text);
    expect(forward.text.indexOf("G36*")).toBeLessThan(forward.text.indexOf("D02*"));
    expect(forward.text.indexOf("D01*")).toBeLessThan(forward.text.indexOf("D03*"));
  });

  test("a draw given from the other end is the same file", () => {
    const points = [
      { x_nm: 1_000_000, y_nm: 2_000_000 },
      { x_nm: 3_000_000, y_nm: 4_000_000 },
    ];
    const forward = gerberLayer(image([]), { layer: "F.Cu", items: [{ kind: "draw", width_nm: 300_000, points }] }, stamp);
    const backward = gerberLayer(image([]), { layer: "F.Cu", items: [{ kind: "draw", width_nm: 300_000, points: [...points].reverse() }] }, stamp);
    expect(backward.text).toBe(forward.text);
  });
});

describe("toGerber", () => {
  test("one file per layer the image carries, in image order", () => {
    const files = toGerber(
      image([
        { layer: "F.Cu", items: [] },
        { layer: "B.Cu", items: [] },
        { layer: "Edge.Cuts", items: [] },
      ]),
      stamp,
    );
    expect(files.map((file) => file.name)).toEqual(["demo-F_Cu.gbr", "demo-B_Cu.gbr", "demo-Edge_Cuts.gbr"]);
    for (const file of files) expect(file.text.endsWith("M02*\n")).toBe(true);
  });

  test("no layers means no files", () => {
    expect(toGerber(image([]), stamp)).toEqual([]);
  });

  test("the same image twice is byte-identical", () => {
    const layer: ImageLayer = {
      layer: "F.Cu",
      items: [
        { kind: "flash", diameter_nm: 600_000, at: { x_nm: 1_000_000, y_nm: 2_000_000 } },
        { kind: "draw", width_nm: 300_000, points: [{ x_nm: 0, y_nm: 0 }, { x_nm: 5_000_000, y_nm: 0 }] },
      ],
    };
    const once = toGerber(image([layer]), stamp);
    const twice = toGerber(image([layer]), stamp);
    expect(twice).toEqual(once);
  });
});
