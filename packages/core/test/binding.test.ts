// The binding validation is pure functions: they only consume the two IRs, so the IRs are
// built directly here — no need to write .teda.
import { irVersion } from "@texteda/ir";
import { describe, expect, test } from "bun:test";
import { checkBinding, instanceOf } from "../src/index.ts";
import type { Pcb } from "@texteda/ir/pcb";
import type { Schematic } from "@texteda/ir/schematic";

const schematic: Schematic = {
  ir_version: irVersion,
  format: "0.7",
  board: "b",
  instances: [
    { id: "R1", component: "res-thick-0402" },
    { id: "R2", component: "res-thick-0402" },
    { id: "C1", component: "cap-mlcc-0402" },
  ],
  nets: [
    { id: "A", members: ["R1.1", "R2.1"] },
    { id: "B", members: ["R1.2", "R2.2"] },
    { id: "C", members: ["C1.1", "C1.2"] },
  ],
};

const pcbBase: Pcb = {
  ir_version: irVersion,
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
    { x_nm: 10_000_000, y_nm: 0 },
    { x_nm: 10_000_000, y_nm: 10_000_000 },
  ],
  place: [
    { instance_id: "R1", x_nm: 0, y_nm: 0, rot_mdeg: 0, side: "top" },
    { instance_id: "R2", x_nm: 2_000_000, y_nm: 0, rot_mdeg: 0, side: "top" },
    { instance_id: "C1", x_nm: 4_000_000, y_nm: 0, rot_mdeg: 0, side: "top" },
  ],
  connect: [
    { a: "R1.1", b: "R2.1" },
    { a: "R1.2", b: "R2.2" },
    { a: "C1.1", b: "C1.2" },
  ],
  rules: [{ type: "clearance", value_nm: 200_000 }],
};

const check = (pcb: Pcb, sch: Schematic = schematic) =>
  checkBinding({ file: "pcb/b.teda", schematic: sch, pcb });

const codes = (pcb: Pcb, sch?: Schematic) => check(pcb, sch).map((d) => d.code);

describe("instanceOf", () => {
  test("splits at the last dot (instance ids may contain dots)", () => {
    expect(instanceOf("R1.1")).toBe("R1");
    expect(instanceOf("M1.R14.2")).toBe("M1.R14");
  });
});

describe("valid pcb", () => {
  test("placement, connect and coverage all hold → no diagnostics", () => {
    expect(check(pcbBase)).toEqual([]);
  });
});

describe("rule 1: instances in place must exist", () => {
  test("unknown instance", () => {
    const diagnostics = check({
      ...pcbBase,
      place: [...pcbBase.place, { instance_id: "R9", x_nm: 0, y_nm: 0, rot_mdeg: 0, side: "top" }],
    });
    expect(diagnostics.map((d) => d.code)).toEqual(["bind.unknown-instance"]);
    expect(diagnostics[0]!.data).toEqual({ instance_id: "R9" });
  });
});

describe("rule 2: pads in connect must belong to placed instances", () => {
  test("references an unplaced instance", () => {
    const unplaced = { ...pcbBase, place: pcbBase.place.filter((item) => item.instance_id !== "C1") };
    expect(codes(unplaced)).toContain("bind.pad-unplaced");
  });
});

describe("rule 3: a pair of pads must be inside the same sch net", () => {
  test("cross-net short → error, reporting both nets", () => {
    const pcb = { ...pcbBase, connect: [...pcbBase.connect, { a: "R1.1", b: "R1.2" }] };
    const diagnostics = check(pcb).filter((d) => d.code === "bind.net-mismatch");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.data).toEqual({ a: "R1.1", b: "R1.2", net_a: "A", net_b: "B" });
  });

  test("the finding names the connect row and the net's own row (ADR-0103 D5)", () => {
    const pcb = { ...pcbBase, connect: [...pcbBase.connect, { a: "R1.1", b: "R1.2" }] };
    const index = pcb.connect.length - 1;
    const diagnostics = checkBinding({
      file: "pcb/b.teda",
      schematic,
      pcb,
      locate: (irPath) =>
        irPath === `/connect/${index}` ? { file: "pcb/b.teda", line: 40, col: 3 } : undefined,
      locateNet: (netId) => (netId === "A" ? { file: "sch/b.teda", line: 12, col: 3 } : undefined),
    }).filter((d) => d.code === "bind.net-mismatch");
    expect(diagnostics).toHaveLength(1);
    // The row to fix is the copper; the row that decides the nets is on the board.
    expect(diagnostics[0]!.location).toEqual({ file: "pcb/b.teda", line: 40, col: 3 });
    expect(diagnostics[0]!.related).toEqual([{ file: "sch/b.teda", line: 12, col: 3 }]);
  });

  test("no longer reported once overridden by net_tie", () => {
    const pcb: Pcb = {
      ...pcbBase,
      connect: [...pcbBase.connect, { a: "R1.1", b: "R1.2" }],
      deviation: [{ type: "net_tie", net_a: "A", net_b: "B" }],
    };
    expect(codes(pcb)).not.toContain("bind.net-mismatch");
  });

  test("pad does not belong to any net in sch", () => {
    const sch: Schematic = { ...schematic, nets: [{ id: "A", members: ["R1.1", "R2.1"] }, { id: "B", members: ["R1.2"] }, { id: "C", members: ["C1.1", "C1.2"] }] };
    const diagnostics = check({ ...pcbBase, connect: [{ a: "R1.1", b: "R2.1" }, { a: "R1.2", b: "R2.2" }, { a: "C1.1", b: "C1.2" }, { a: "R1.1", b: "R2.2" }] }, sch);
    expect(diagnostics.map((d) => d.code)).toContain("bind.unconnected-pad");
  });
});

describe("rule 4: every net's placed members must be covered by connect", () => {
  test("missing one edge → that net reports unrouted", () => {
    const pcb = { ...pcbBase, connect: pcbBase.connect.filter((edge) => edge.a !== "R1.1") };
    const diagnostics = check(pcb).filter((d) => d.code === "bind.unrouted");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.severity).toBe("warning");
    expect(diagnostics[0]!.data).toMatchObject({ net: "A" });
  });

  test("unplaced instances do not participate in the coverage check", () => {
    const pcb = { ...pcbBase, place: pcbBase.place.filter((item) => item.instance_id !== "C1") };
    const unrouted = check(pcb).filter((d) => d.code === "bind.unrouted");
    expect(unrouted.map((d) => d.data?.net)).not.toContain("C");
  });
});

describe("rule 5: pcb must not reference nets absent from sch", () => {
  test("unknown nets in trace / rules / deviation are each reported once", () => {
    const pcb: Pcb = {
      ...pcbBase,
      trace: [{ net: "NOPE", layer: "F.Cu", width_nm: 200_000, points: [{ x_nm: 0, y_nm: 0 }, { x_nm: 1_000_000, y_nm: 0 }] }],
      rules: [...pcbBase.rules, { type: "net", net: "NOPE2", clearance_nm: 1, width_nm: 1, via_size_nm: 1, via_drill_nm: 1 }],
      deviation: [{ type: "split_ground", net: "NOPE" }],
    };
    const unknown = check(pcb).filter((d) => d.code === "bind.unknown-net").map((d) => d.data?.net);
    expect(unknown).toEqual(["NOPE", "NOPE2"]);
  });
});

describe("declared deviations enter the report (ADR-0113 D10)", () => {
  test("a net_tie is a note and names both nets", () => {
    const pcb: Pcb = { ...pcbBase, deviation: [{ type: "net_tie", net_a: "A", net_b: "B" }] };
    const diagnostics = check(pcb).filter((d) => d.code === "bind.net-tie");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.severity).toBe("note");
    expect(diagnostics[0]!.data).toEqual({ net_a: "A", net_b: "B" });
  });

  test("a split_ground is a warning", () => {
    const pcb: Pcb = { ...pcbBase, deviation: [{ type: "split_ground", net: "C" }] };
    const diagnostics = check(pcb).filter((d) => d.code === "bind.split-ground");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.severity).toBe("warning");
    expect(diagnostics[0]!.data).toEqual({ net: "C" });
  });
});

describe("rule 12: a partial layout is reported, not forbidden (ADR-0118)", () => {
  // R1 and R2 placed, C1 not: drop its place row *and* its connect pair, so the only
  // complaint is the missing placement itself (rule 4 ignores unplaced instances).
  const partial: Pcb = {
    ...pcbBase,
    place: pcbBase.place.filter((item) => item.instance_id !== "C1"),
    connect: pcbBase.connect.filter((pair) => instanceOf(pair.a) !== "C1"),
  };

  test("one warning per board, naming the count and the missing instance", () => {
    const diagnostics = check(partial);
    expect(diagnostics.map((d) => d.code)).toEqual(["bind.instance-unplaced"]);
    const [diagnostic] = diagnostics;
    expect(diagnostic!.severity).toBe("warning");
    expect(diagnostic!.message).toContain("2 of the board's 3");
    expect(diagnostic!.message).toContain("C1");
    expect(diagnostic!.data).toEqual({ placed: 2, total: 3, unplaced: 1 });
  });

  test("a logical_only instance needs no place", () => {
    const sch: Schematic = {
      ...schematic,
      instances: [...schematic.instances, { id: "PWR_FLAG", component: "flag", logical_only: true }],
    };
    expect(check(partial, sch).map((d) => d.code)).toEqual(["bind.instance-unplaced"]);
    expect(check(pcbBase, sch)).toEqual([]);
  });

  test("a dnp part still occupies a place (its land pattern is on the board)", () => {
    const sch: Schematic = {
      ...schematic,
      instances: schematic.instances.map((instance) => (instance.id === "C1" ? { ...instance, dnp: true } : instance)),
    };
    expect(check(partial, sch).map((d) => d.code)).toEqual(["bind.instance-unplaced"]);
  });

  test("a complete layout is silent", () => {
    expect(check(pcbBase).filter((d) => d.code === "bind.instance-unplaced")).toEqual([]);
  });
});
