// Current requirements against what the parts are rated for (the `current` constraint, finally consumed).
import { irVersion } from "@texteda/ir";
import { describe, expect, test } from "bun:test";
import { checkCurrentRatings } from "../src/index.ts";
import type { CurrentDevice } from "../src/index.ts";
import type { Schematic } from "@texteda/ir/schematic";

/** A two-terminal part with a rating: a connector, a fuse, a shunt. */
const JACK: CurrentDevice = {
  pins: ["1", "2"],
  ratings: { rated_current: { type: "current", value: 500_000_000 } },
};

/** A part with more pins than a path: its rating names no terminal yet (ADR-0026 D4). */
const REGULATOR: CurrentDevice = {
  pins: ["1", "2", "3"],
  ratings: { rated_current: { type: "current", value: 300_000_000 } },
};

function board(options: {
  instances: { id: string; component: string }[];
  nets: { id: string; members: string[] }[];
  constraints?: Schematic["constraints"];
  params?: Record<string, { name: string; value: number }[]>;
}): Schematic {
  return {
    ir_version: irVersion,
    format: "0.19",
    project: "main",
    modules: [],
    instances: options.instances.map((instance) => ({
      ...instance,
      ...(options.params?.[instance.id] ? { params: options.params[instance.id]! } : {}),
    })),
    nets: options.nets.map((net) => ({ id: net.id, members: net.members })),
    constraints: options.constraints ?? [],
  };
}

const CURRENT = (subject: string, max_na: number) =>
  ({ type: "current", subject, max_na }) as NonNullable<Schematic["constraints"]>[number];

describe("current requirements", () => {
  test("a pin declared to carry more than a two-terminal part is rated for is an error", () => {
    const schematic = board({
      instances: [{ id: "J1", component: "jack" }],
      nets: [{ id: "ADAPTER_P", members: ["J1.1"] }],
      constraints: [CURRENT("J1.1", 4_000_000_000)],
    });
    const { diagnostics } = checkCurrentRatings({
      file: "b.teda",
      schematic,
      devices: new Map([["jack", JACK]]),
    });
    const error = diagnostics.find((d) => d.code === "design.current-exceeded");
    expect(error?.severity).toBe("error");
    expect(error?.message).toContain("pin J1.1 carries at most 4A");
    expect(error?.message).toContain("is rated 0.5A");
    expect(error?.data).toMatchObject({ declared_na: 4_000_000_000, rated_na: 500_000_000 });
  });

  test("does not count or emit coverage for a net-current fact", () => {
    // The parser no longer accepts this removed schematic construct; raw legacy IR is ignored here
    // rather than recreating the retired rail note (ADR-0081).
    const schematic = board({
      instances: [{ id: "J1", component: "jack" }],
      nets: [{ id: "ADAPTER_P", members: ["J1.1"] }],
      constraints: [CURRENT("ADAPTER_P", 4_000_000_000)],
    });
    const { diagnostics, coverage } = checkCurrentRatings({
      file: "b.teda",
      schematic,
      devices: new Map([["jack", JACK]]),
    });
    expect(diagnostics).toEqual([]);
    expect(coverage).toEqual({ compared: 0, total: 0 });
  });

  test("a part rated for the current its pin carries is not reported", () => {
    const schematic = board({
      instances: [{ id: "J1", component: "jack" }],
      nets: [{ id: "ADAPTER_P", members: ["J1.1"] }],
      constraints: [CURRENT("J1.1", 500_000_000)],
    });
    const { diagnostics, coverage } = checkCurrentRatings({
      file: "b.teda",
      schematic,
      devices: new Map([["jack", JACK]]),
    });
    expect(diagnostics).toEqual([]);
    expect(coverage).toEqual({ compared: 1, total: 1 });
  });

  test("a part that states no rating is counted, not passed", () => {
    const schematic = board({
      instances: [{ id: "R1", component: "resistor" }],
      nets: [{ id: "VOUT", members: ["R1.1"] }],
      constraints: [CURRENT("R1.1", 3_000_000_000)],
    });
    const { diagnostics, coverage } = checkCurrentRatings({
      file: "b.teda",
      schematic,
      devices: new Map([["resistor", { pins: ["1", "2"], ratings: {} }]]),
    });
    expect(diagnostics.map((d) => d.code)).toEqual(["design.current-unknown"]);
    expect(diagnostics[0]!.severity).toBe("note");
    expect(diagnostics[0]!.data).toMatchObject({ compared: 0, skipped: 1, total: 1, no_rating: 1 });
    expect(coverage).toEqual({ compared: 0, total: 1 });
  });

  test("a part with more than two pins is a signal, not a verdict", () => {
    // Its rating names no terminal yet (ADR-0026 D4), so the comparison is not certain.
    const schematic = board({
      instances: [{ id: "U2", component: "regulator" }],
      nets: [{ id: "VOUT", members: ["U2.1"] }],
      constraints: [CURRENT("U2.1", 3_000_000_000)],
    });
    const { diagnostics } = checkCurrentRatings({
      file: "b.teda",
      schematic,
      devices: new Map([["regulator", REGULATOR]]),
    });
    const warning = diagnostics.find((d) => d.code === "design.current-below-rating");
    expect(warning?.severity).toBe("warning");
    expect(warning?.message).toContain("pin U2.1 carries at most 3A");
    expect(warning?.message).toContain("is rated 0.3A");
    expect(warning?.message).toContain("the part's rating does not name the pin it applies to");
  });

  test("a part between two rails is compared with the requirement on its own pin", () => {
    // The design says what that pin carries, so the comparison holds: a series element carries
    // the same current on both sides, and the rails say nothing about the pin in question.
    const schematic = board({
      instances: [{ id: "R1", component: "resistor" }],
      nets: [
        { id: "VOUT", members: ["R1.1"] },
        { id: "V3V3", members: ["R1.2"] },
      ],
      constraints: [CURRENT("R1.1", 3_000_000_000), CURRENT("V3V3", 300_000_000)],
    });
    const { diagnostics, coverage } = checkCurrentRatings({
      file: "b.teda",
      schematic,
      devices: new Map([["resistor", JACK]]),
    });
    const error = diagnostics.find((d) => d.code === "design.current-exceeded");
    expect(error?.message).toContain("pin R1.1 carries at most 3A");
    expect(coverage).toEqual({ compared: 1, total: 1 });
  });

  test("a generic's own line column is the current the part must carry", () => {
    const schematic = board({
      instances: [{ id: "L1", component: "inductor" }],
      nets: [{ id: "VOUT", members: ["L1.1"] }],
      constraints: [CURRENT("L1.1", 3_000_000_000)],
      params: { L1: [{ name: "rated_current", value: 2_000_000_000 }] },
    });
    const inductor: CurrentDevice = {
      pins: ["1", "2"],
      ratings: {},
      params: [{ name: "rated_current", type: "current" }],
    };
    const { diagnostics } = checkCurrentRatings({
      file: "b.teda",
      schematic,
      devices: new Map([["inductor", inductor]]),
    });
    const error = diagnostics.find((d) => d.code === "design.current-exceeded");
    expect(error?.message).toContain("is rated 2A");
  });
});
