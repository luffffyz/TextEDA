// The placement canvas: the board drawn from the PCB IR (ADR-0141 D1).
//
// The canvas draws what the board says -- outline, placed parts with their pads and courtyards,
// copper -- and gives every drawn object a stable identity, so the app can address a net's copper
// without asking the model for its bounding box.
import { irVersion } from "@texteda/ir";
import { describe, expect, test } from "bun:test";
import type { Footprint } from "@texteda/ir/footprint";
import type { Pcb } from "@texteda/ir/pcb";
import { renderPcb } from "../src/pcb.ts";

function footprint(): Footprint {
  return {
    ir_version: irVersion,
    footprint: {
      library: "test",
      name: "two-pad",
      pads: [
        {
          number: "1",
          type: "smd",
          shape: "rect",
          at: { x_nm: -1_000_000, y_nm: 0 },
          size: { x_nm: 1_000_000, y_nm: 1_500_000 },
          layers: ["F.Cu", "F.Paste"],
        },
        {
          number: "2",
          type: "smd",
          shape: "circle",
          at: { x_nm: 1_000_000, y_nm: 0 },
          size: { x_nm: 1_000_000, y_nm: 1_000_000 },
          layers: ["F.Cu", "F.Paste"],
        },
      ],
      graphics: [
        {
          kind: "rect",
          layer: "F.CrtYd",
          start: { x_nm: -2_000_000, y_nm: -1_500_000 },
          end: { x_nm: 2_000_000, y_nm: 1_500_000 },
          width_nm: 100_000,
        },
      ],
      fields: [{ name: "Reference", value: "U", at: { x_nm: 0, y_nm: 2_500_000 } }],
    },
  };
}

function pcb(): Pcb {
  return {
    ir_version: irVersion,
    format: "0.9.1",
    board: "b",
    board_thickness_nm: 1_600_000,
    stackup: [
      { layer: "F.Cu", type: "copper", thickness_nm: 35_000, kind: "signal" },
      { layer: "prepreg", type: "dielectric", thickness_nm: 1_530_000, material: "FR4", er_ppm: 4_300_000 },
      { layer: "B.Cu", type: "copper", thickness_nm: 35_000, kind: "signal" },
    ],
    outline: [
      { x_nm: 0, y_nm: 0 },
      { x_nm: 20_000_000, y_nm: 0 },
      { x_nm: 20_000_000, y_nm: 10_000_000 },
      { x_nm: 0, y_nm: 10_000_000 },
    ],
    place: [{ instance_id: "U1", x_nm: 5_000_000, y_nm: 5_000_000, rot_mdeg: 0, side: "top" }],
    connect: [{ a: "U1.1", b: "U1.2" }],
    trace: [
      {
        net: "VCC",
        layer: "F.Cu",
        width_nm: 300_000,
        points: [
          { x_nm: 4_000_000, y_nm: 5_000_000 },
          { x_nm: 6_000_000, y_nm: 5_000_000 },
        ],
      },
    ],
    via: [{ net: "VCC", x_nm: 8_000_000, y_nm: 5_000_000, size_nm: 600_000, drill_nm: 300_000 }],
    rules: [{ type: "clearance", value_nm: 200_000 }],
  };
}

describe("the placement canvas", () => {
  test("draws the outline, the parts and the copper", () => {
    const doc = renderPcb({ pcb: pcb(), parts: [{ instance_id: "U1", footprint: footprint() }] });
    expect(doc.kind).toBe("pcb");
    // The board frame is the IR's "board frame", in which +y points down (`toBoardPoint` moves a
    // footprint's own y-down frame into it without a flip): the document is y-down, so the SVG
    // shows the board's coordinates as they are.
    expect(doc.orientation).toBe("y-down");
    const kinds = doc.primitives.map((p) => p.kind);
    expect(kinds).toContain("polyline"); // the outline
    expect(kinds).toContain("poly"); // the pads and the courtyard
    expect(kinds).toContain("circle"); // the via and the round pad
    expect(kinds).toContain("text"); // the reference designator
  });

  test("names every drawn object", () => {
    const doc = renderPcb({
      pcb: pcb(),
      parts: [{ instance_id: "U1", footprint: footprint() }],
      padNets: new Map([["U1.1", "VCC"]]),
    });
    const refs = doc.primitives.map((p) => p.ref).filter((r): r is string => r !== undefined);
    expect(refs).toContain("instance:U1");
    expect(refs).toContain("pad:U1.1");
    expect(refs).toContain("pad:U1.2");
    expect(refs).toContain("net:VCC");
    expect(refs).toContain("board:outline");
    // The pad that the schematic puts on a net carries that net.
    const pad = doc.primitives.find((p) => p.ref === "pad:U1.1");
    expect(pad?.net).toBe("VCC");
    // The pad the schematic leaves without a net carries none.
    const unconnected = doc.primitives.find((p) => p.ref === "pad:U1.2");
    expect(unconnected?.net).toBeUndefined();
  });

  test("a part the board places but the schematic does not know draws nothing", () => {
    const doc = renderPcb({ pcb: pcb(), parts: [] });
    expect(doc.primitives.some((p) => p.ref?.startsWith("pad:"))).toBe(false);
    expect(doc.primitives.some((p) => p.ref?.startsWith("instance:"))).toBe(false);
  });

  test("prints the reference the board's silk rules ask for", () => {
    const board = pcb();
    const named: Footprint = footprint();
    named.footprint.fields = [{ name: "Reference", value: "U", at: { x_nm: 0, y_nm: 2_500_000 } }];
    // No silk section: the defaults print the reference on the top silk (spec/pcb.md section 4.10).
    const shown = renderPcb({ pcb: board, parts: [{ instance_id: "U1", footprint: named }] });
    expect(shown.primitives.some((p) => p.kind === "text" && p.text === "U1")).toBe(true);
    // A board that turns the reference off prints nothing, and the canvas follows the board.
    const hidden: typeof board = { ...board, silk: [{ item: "refdes", layer: "F.SilkS", size_nm: 1_000_000, mode: "hide" }] };
    const off = renderPcb({ pcb: hidden, parts: [{ instance_id: "U1", footprint: named }] });
    expect(off.primitives.some((p) => p.kind === "text" && p.text === "U1")).toBe(false);
  });

  test("prints a value only when the board asks for one", () => {
    const board = pcb();
    const withValue: Footprint = footprint();
    withValue.footprint.fields = [
      { name: "Reference", value: "U", at: { x_nm: 0, y_nm: 2_500_000 } },
      { name: "Value", value: "460k", at: { x_nm: 0, y_nm: -2_500_000 } },
    ];
    const quiet = renderPcb({ pcb: board, parts: [{ instance_id: "U1", footprint: withValue, value: "460k" }] });
    // The default prints no value, even when the caller knows it.
    expect(quiet.primitives.some((p) => p.kind === "text" && p.text === "460k")).toBe(false);
    const loud: typeof board = {
      ...board,
      silk: [
        { item: "refdes", layer: "F.SilkS", size_nm: 1_000_000, mode: "show" },
        { item: "value", layer: "F.SilkS", size_nm: 800_000, mode: "show" },
      ],
    };
    const printed = renderPcb({ pcb: loud, parts: [{ instance_id: "U1", footprint: withValue, value: "460k" }] });
    const value = printed.primitives.find((p) => p.kind === "text" && p.text === "460k");
    expect(value?.kind === "text" ? value.sizeNm : undefined).toBe(800_000);
  });

  test("a bottom-side part draws on the back copper", () => {
    const board = pcb();
    board.place = [{ instance_id: "U1", x_nm: 5_000_000, y_nm: 5_000_000, rot_mdeg: 180_000, side: "bottom" }];
    const doc = renderPcb({ pcb: board, parts: [{ instance_id: "U1", footprint: footprint() }] });
    const pad = doc.primitives.find((p) => p.ref === "pad:U1.1");
    expect(pad?.kind).toBe("poly");
    expect(pad?.kind === "poly" ? pad.layer : undefined).toBe("B.Cu");
  });
});
