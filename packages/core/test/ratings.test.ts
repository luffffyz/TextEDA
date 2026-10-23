// Rating checks (ADR-0043): a device's limit against the declared window of the net it sits on.
import { describe, expect, test } from "bun:test";
import { checkRatings } from "../src/index.ts";
import type { RatingDevice } from "../src/index.ts";
import type { Schematic } from "@texteda/ir/schematic";

const TWO_PIN: RatingDevice = { pins: ["1", "2"], ratings: {} };

/** A board with the given instances, nets and windows; everything else is empty. */
function board(options: {
  instances: { id: string; component: string }[];
  nets: { id: string; members: string[] }[];
  constraints?: Schematic["constraints"];
  params?: Record<string, { name: string; value: number }[]>;
}): Schematic {
  return {
    ir_version: "0.9",
    format: "0.8",
    board: "b",
    instances: options.instances.map((instance) => ({
      ...instance,
      line: 10,
      ...(options.params?.[instance.id] ? { params: options.params[instance.id]! } : {}),
    })),
    nets: options.nets.map((net) => ({ id: net.id, members: net.members })),
    constraints: options.constraints ?? [],
  } as Schematic;
}

const VOLTAGE = (subject: string, min_uv: number, max_uv: number) =>
  ({ type: "voltage", subject, min_uv, max_uv }) as Schematic["constraints"][number];

describe("rating checks", () => {
  test("a capability below the declared window is an error, with both numbers", () => {
    const schematic = board({
      instances: [{ id: "C1", component: "cap-0402" }],
      nets: [
        { id: "SYS", members: ["C1.1"] },
        { id: "GND", members: ["C1.2"] },
      ],
      constraints: [VOLTAGE("SYS", 9_000_000, 19_800_000), VOLTAGE("GND", 0, 0)],
      params: { C1: [{ name: "voltage", value: 16_000_000 }] },
    });
    const diagnostics = checkRatings({ file: "b.teda", schematic, devices: new Map([["cap-0402", TWO_PIN]]) });
    const error = diagnostics.find((d) => d.code === "design.rating-exceeded");
    expect(error?.severity).toBe("error");
    expect(error?.message).toContain("rated 16V");
    expect(error?.message).toContain("19.8V");
    expect(error?.data).toMatchObject({ capability_uv: 16_000_000, stress_uv: 19_800_000 });
  });

  test("the stress is the extreme of the difference, not the potential of one net", () => {
    // A 10 V part between a 4.5..5.5 V rail and a 0..0 V ground is fine; the same part between
    // two rails 12 V apart is not, even though neither rail alone exceeds 10 V.
    const frames = board({
      instances: [{ id: "C1", component: "cap-0402" }],
      nets: [
        { id: "A", members: ["C1.1"] },
        { id: "B", members: ["C1.2"] },
      ],
      constraints: [VOLTAGE("A", 1_000_000, 5_000_000), VOLTAGE("B", -7_000_000, 0)],
      params: { C1: [{ name: "voltage", value: 10_000_000 }] },
    });
    const diagnostics = checkRatings({ file: "b.teda", schematic: frames, devices: new Map([["cap-0402", TWO_PIN]]) });
    expect(diagnostics.map((d) => d.code)).toContain("design.rating-exceeded");
  });

  test("a part's own rating is used when the instance states no voltage", () => {
    const schematic = board({
      instances: [{ id: "C1", component: "cap-tantalum" }],
      nets: [
        { id: "VOUT", members: ["C1.1"] },
        { id: "GND", members: ["C1.2"] },
      ],
      constraints: [VOLTAGE("VOUT", 4_850_000, 5_150_000), VOLTAGE("GND", 0, 0)],
    });
    const device: RatingDevice = { pins: ["1", "2"], ratings: { voltage: { type: "voltage", value: 4_000_000 } } };
    const diagnostics = checkRatings({ file: "b.teda", schematic, devices: new Map([["cap-tantalum", device]]) });
    expect(diagnostics.map((d) => d.code)).toContain("design.rating-exceeded");
  });

  test("an unknown potential is not a pass: it is counted, once per board", () => {
    const schematic = board({
      instances: [
        { id: "C1", component: "cap-0402" },
        { id: "C2", component: "cap-0402" },
      ],
      nets: [
        { id: "SYS", members: ["C1.1", "C2.1"] },
        { id: "GND", members: ["C1.2", "C2.2"] },
      ],
      // no windows at all: ground was never declared
      params: {
        C1: [{ name: "voltage", value: 50_000_000 }],
        C2: [{ name: "voltage", value: 50_000_000 }],
      },
    });
    const diagnostics = checkRatings({ file: "b.teda", schematic, devices: new Map([["cap-0402", TWO_PIN]]) });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.code).toBe("design.stress-unknown");
    expect(diagnostics[0]!.severity).toBe("note");
    expect(diagnostics[0]!.message).toContain("2 of 2 instances");
    expect(diagnostics[0]!.message).toContain("without a declared voltage window");
  });

  test("a multi-terminal device is not compared (its stress model is not defined yet)", () => {
    const schematic = board({
      instances: [{ id: "U1", component: "regulator" }],
      nets: [
        { id: "SYS", members: ["U1.1"] },
        { id: "GND", members: ["U1.2"] },
      ],
      constraints: [VOLTAGE("SYS", 9_000_000, 19_800_000), VOLTAGE("GND", 0, 0)],
    });
    const device: RatingDevice = {
      pins: ["1", "2", "3", "4"],
      ratings: { voltage: { type: "voltage", value: 28_000_000 } },
    };
    const diagnostics = checkRatings({ file: "b.teda", schematic, devices: new Map([["regulator", device]]) });
    expect(diagnostics.map((d) => d.code)).toEqual(["design.stress-unknown"]);
    expect(diagnostics[0]!.message).toContain("1 not two-terminal");
  });
});
