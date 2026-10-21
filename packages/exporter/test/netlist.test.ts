// The netlist is a deterministic projection of the IR: two exports of the same IR must be byte-identical and unaffected by member order.
import { describe, expect, test } from "bun:test";
import { formatNetlist, toNetlist } from "../src/netlist.ts";
import type { Schematic } from "@texteda/ir/schematic";

const base: Schematic = {
  ir_version: "0.1",
  format: "0.3",
  board: "b",
  instances: [
    { id: "R2", component: "r-0402" },
    { id: "R1", component: "r-0402" },
  ],
  nets: [
    { id: "N2", members: ["R2.2", "R1.2"] },
    { id: "N1", members: ["R1.1"] },
  ],
};

describe("toNetlist", () => {
  test("instances, nets, and members are sorted (source order does not matter)", () => {
    const netlist = toNetlist(base);
    expect(netlist.components.map((c) => c.id)).toEqual(["R1", "R2"]);
    expect(netlist.nets.map((n) => n.id)).toEqual(["N1", "N2"]);
    expect(netlist.nets[1]!.members).toEqual(["R1.2", "R2.2"]);
  });

  test("different member order, same IR semantics → byte-identical netlist", () => {
    const shuffled: Schematic = {
      ...base,
      nets: [
        { id: "N2", members: ["R1.2", "R2.2"] },
        { id: "N1", members: ["R1.1"] },
      ],
    };
    expect(formatNetlist(toNetlist(shuffled))).toBe(formatNetlist(toNetlist(base)));
  });

  test("no values: the netlist describes only connectivity", () => {
    const text = formatNetlist(toNetlist(base));
    expect(text).not.toContain("100nF");
    expect(text.startsWith("# netlist b (ir 0.1)")).toBe(true);
    expect(text).toContain("N2: R1.2 R2.2");
    expect(text).toContain("R1 r-0402");
  });
});
