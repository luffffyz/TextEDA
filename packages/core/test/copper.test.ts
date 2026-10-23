// Copper coverage (ADR-0041): does the drawing implement the `connect` declarations?
// Synthetic IRs — the check consumes geometry only, so no .teda and no library is needed.
import { describe, expect, test } from "bun:test";
import { checkCopperCoverage, type InstancePads } from "../src/index.ts";
import type { Pcb, Point, Trace } from "@texteda/ir/pcb";
import type { Schematic } from "@texteda/ir/schematic";

const mm = (value: number) => Math.round(value * 1_000_000);

const schematic: Schematic = {
  ir_version: "0.7",
  format: "0.7",
  board: "b",
  instances: [
    { id: "A", component: "r" },
    { id: "B", component: "r" },
  ],
  nets: [{ id: "N", members: ["A.1", "B.1"] }],
};

const pcbBase: Pcb = {
  ir_version: "0.7",
  format: "0.7",
  board: "b",
  board_thickness_nm: 1_600_000,
  stackup: [
    { type: "copper", layer: "F.Cu", thickness_nm: 35_000, kind: "signal" },
    { type: "dielectric", layer: "core", thickness_nm: 1_530_000, material: "FR4" },
    { type: "copper", layer: "B.Cu", thickness_nm: 35_000, kind: "signal" },
  ],
  outline: [
    { x_nm: 0, y_nm: 0 },
    { x_nm: mm(10), y_nm: 0 },
    { x_nm: mm(10), y_nm: mm(10) },
  ],
  place: [
    { instance_id: "A", x_nm: 0, y_nm: 0, rot_mdeg: 0, side: "top" },
    { instance_id: "B", x_nm: mm(5), y_nm: 0, rot_mdeg: 0, side: "top" },
  ],
  connect: [{ a: "A.1", b: "B.1" }],
  rules: [{ type: "clearance", value_nm: 200_000 }],
};

/** Two pads per part at ±0.5mm, radius 0.3mm (a "circumscribed circle" of a small land). */
const pads: InstancePads[] = ["A", "B"].map((id) => ({
  instance_id: id,
  pads: [
    { number: "1", x_nm: -500_000, y_nm: 0, radius_nm: 300_000, layers: ["F.Cu"] },
    { number: "2", x_nm: 500_000, y_nm: 0, radius_nm: 300_000, layers: ["F.Cu"] },
  ],
}));

/** A track whose centre line is a list of mm pairs. */
const trace = (layer: string, points: [number, number][], net = "N"): Trace => ({
  net,
  layer,
  width_nm: 200_000,
  points: points.map(([x, y]) => ({ x_nm: mm(x), y_nm: mm(y) })) as [Point, Point, ...Point[]],
});

const check = (pcb: Pcb, padFacts: InstancePads[] = pads, sch: Schematic = schematic) =>
  checkCopperCoverage({ file: "pcb/b.teda", schematic: sch, pcb, pads: padFacts });

const codes = (pcb: Pcb, padFacts?: InstancePads[], sch?: Schematic) =>
  check(pcb, padFacts, sch).map((d) => d.code);

describe("a pair the copper implements", () => {
  test("one track from pad to pad is enough", () => {
    expect(check({ ...pcbBase, trace: [trace("F.Cu", [[-0.5, 0], [4.5, 0]])] })).toEqual([]);
  });

  test("a chain through two vias and another layer is enough", () => {
    // Both pads are F.Cu-only: the chain has to come back up to reach B.1.
    const pcb: Pcb = {
      ...pcbBase,
      trace: [trace("F.Cu", [[-0.5, 0], [2, 0]]), trace("B.Cu", [[2, 0], [4, 0]]), trace("F.Cu", [[4, 0], [4.5, 0]])],
      via: [
        { net: "N", x_nm: mm(2), y_nm: 0, size_nm: 600_000, drill_nm: 300_000 },
        { net: "N", x_nm: mm(4), y_nm: 0, size_nm: 600_000, drill_nm: 300_000 },
      ],
    };
    expect(check(pcb)).toEqual([]);
    // Remove the second via and the chain no longer comes back to the top layer.
    expect(codes({ ...pcb, via: pcb.via!.slice(0, 1) })).toEqual(["bind.connect-unbacked"]);
  });

  test("a zone that reaches both pads is enough", () => {
    const pcb: Pcb = {
      ...pcbBase,
      zone: [
        {
          net: "N",
          layer: "F.Cu",
          points: [
            { x_nm: mm(-2), y_nm: mm(2) },
            { x_nm: mm(7), y_nm: mm(2) },
            { x_nm: mm(7), y_nm: mm(-2) },
            { x_nm: mm(-2), y_nm: mm(-2) },
          ],
        },
      ],
    };
    expect(check(pcb)).toEqual([]);
  });
});

describe("a pair nothing implements", () => {
  test("no copper at all is one warning per pair, saying so", () => {
    const diagnostics = check({ ...pcbBase, trace: [] });
    expect(diagnostics.map((d) => d.code)).toEqual(["bind.connect-unbacked"]);
    expect(diagnostics[0]!.severity).toBe("warning");
    expect(diagnostics[0]!.actual).toBe("no copper of this net touches either pad");
    expect(diagnostics[0]!.data).toEqual({ net: "N", a: "A.1", b: "B.1" });
  });

  test("a track that stops short touches one pad only", () => {
    const diagnostics = check({ ...pcbBase, trace: [trace("F.Cu", [[-0.5, 0], [2, 0]])] });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.actual).toBe("copper touches one pad only");
  });

  test("copper of another net does not count", () => {
    expect(codes({ ...pcbBase, trace: [trace("F.Cu", [[-0.5, 0], [4.5, 0]], "OTHER")] })).toEqual([
      "bind.connect-unbacked",
    ]);
  });

  test("copper on another layer does not count without a via", () => {
    expect(codes({ ...pcbBase, trace: [trace("B.Cu", [[-0.5, 0], [4.5, 0]])] })).toEqual(["bind.connect-unbacked"]);
  });

  test("a zone that misses the pads does not count", () => {
    const pcb: Pcb = {
      ...pcbBase,
      zone: [
        {
          net: "N",
          layer: "F.Cu",
          points: [
            { x_nm: mm(0), y_nm: mm(2) },
            { x_nm: mm(1), y_nm: mm(2) },
            { x_nm: mm(1), y_nm: mm(3) },
          ],
        },
      ],
    };
    expect(codes(pcb)).toEqual(["bind.connect-unbacked"]);
  });
});

describe("geometry follows `place`", () => {
  test("a 180° rotation moves the pad to the other side", () => {
    const rotated: Pcb = {
      ...pcbBase,
      place: [
        { instance_id: "A", x_nm: 0, y_nm: 0, rot_mdeg: 180_000, side: "top" },
        { instance_id: "B", x_nm: mm(5), y_nm: 0, rot_mdeg: 0, side: "top" },
      ],
      // A.1 is now at (+0.5, 0): this track starts where the pad is.
      trace: [trace("F.Cu", [[0.5, 0], [4.5, 0]])],
    };
    expect(check(rotated)).toEqual([]);
    // The un-rotated board would not be reached by the same track.
    expect(codes({ ...rotated, place: pcbBase.place })).toEqual(["bind.connect-unbacked"]);
  });

  test("a pad with no footprint is not judged", () => {
    expect(codes({ ...pcbBase, trace: [] }, [pads[0]!])).toEqual([]);
  });
});
