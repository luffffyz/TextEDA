// Rating checks (ADR-0026): a device's limit against the declared window of the net it sits on.
import { irVersion } from "@texteda/ir";
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
    ir_version: irVersion,
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
  ({ type: "voltage", subject, min_uv, max_uv }) as NonNullable<Schematic["constraints"]>[number];

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

describe("dissipation checks (ADR-0026)", () => {
  const RESISTOR: RatingDevice = {
    pins: ["1", "2"],
    ratings: {},
    params: [
      { name: "value", type: "resistance" },
      { name: "tolerance", type: "percent" },
      { name: "power", type: "power" },
    ],
  };

  const windows = [
    VOLTAGE("A", 0, 12_000_000),
    VOLTAGE("B", 0, 0),
  ];

  test("a dissipation above the part's rating is an error, with both numbers", () => {
    const schematic = board({
      instances: [{ id: "R1", component: "res-thick-0402" }],
      nets: [
        { id: "A", members: ["R1.1"] },
        { id: "B", members: ["R1.2"] },
      ],
      constraints: windows,
      params: { R1: [{ name: "value", value: 100_000_000 }] }, // 100 Ω
    });
    const diagnostics = checkRatings({
      file: "sch/b.teda",
      schematic,
      devices: new Map([["res-thick-0402", { ...RESISTOR, ratings: { power: { type: "power", value: 62_500 } } }]]),
    });
    const error = diagnostics.find((diagnostic) => diagnostic.code === "design.rating-exceeded");
    // 12V across 100Ω = 1.44W; the part is rated 62.5mW.
    expect(error?.message).toContain("1.44W");
    expect(error?.message).toContain("62.5mW");
    expect(error?.data?.stress_uw).toBe(1_440_000);
  });

  test("a dissipation inside every limit is not reported", () => {
    const schematic = board({
      instances: [{ id: "R1", component: "res-thick-0402" }],
      nets: [
        { id: "A", members: ["R1.1"] },
        { id: "B", members: ["R1.2"] },
      ],
      constraints: windows,
      params: { R1: [{ name: "value", value: 10_000_000_000 }] }, // 10 kΩ
    });
    const diagnostics = checkRatings({
      file: "sch/b.teda",
      schematic,
      devices: new Map([["res-thick-0402", { ...RESISTOR, ratings: { power: { type: "power", value: 62_500 } } }]]),
    });
    expect(diagnostics.some((diagnostic) => diagnostic.code === "design.rating-exceeded")).toBe(false);
    // 12V across 10kΩ = 14.4mW.
    expect(diagnostics.some((diagnostic) => diagnostic.code === "design.power-unknown")).toBe(false);
  });

  test("the design's own limit binds when it is tighter than the part's rating", () => {
    const schematic = board({
      instances: [{ id: "R1", component: "res-thick-0402" }],
      nets: [
        { id: "A", members: ["R1.1"] },
        { id: "B", members: ["R1.2"] },
      ],
      constraints: [...windows, { type: "power", subject: "R1.1", max_uw: 10_000 } as NonNullable<Schematic["constraints"]>[number]],
      params: { R1: [{ name: "value", value: 10_000_000_000 }] },
    });
    const diagnostics = checkRatings({
      file: "sch/b.teda",
      schematic,
      devices: new Map([["res-thick-0402", { ...RESISTOR, ratings: { power: { type: "power", value: 62_500 } } }]]),
    });
    const error = diagnostics.find((diagnostic) => diagnostic.code === "design.rating-exceeded");
    expect(error?.data?.limit_uw).toBe(10_000);
    expect(error?.message).toContain("the design's dissipation limit");
  });

  test("a resistive instance on a package the table does not know is counted, not passed", () => {
    const schematic = board({
      instances: [{ id: "R1", component: "res-thick-0402" }],
      nets: [
        { id: "A", members: ["R1.1"] },
        { id: "B", members: ["R1.2"] },
      ],
      constraints: windows,
      params: { R1: [{ name: "value", value: 10_000_000_000 }] },
    });
    const diagnostics = checkRatings({
      file: "sch/b.teda",
      schematic,
      devices: new Map([["res-thick-0402", RESISTOR]]),
    });
    const note = diagnostics.find((diagnostic) => diagnostic.code === "design.power-unknown");
    expect(note?.data?.no_package_rating).toBe(1);
    expect(note?.data?.compared).toBe(0);
  });

  test("with nothing declared, the package's standard rating is the floor (ADR-0027)", () => {
    const schematic = board({
      instances: [{ id: "R1", component: "res-thick-0402" }],
      nets: [
        { id: "A", members: ["R1.1"] },
        { id: "B", members: ["R1.2"] },
      ],
      constraints: windows,
      params: { R1: [{ name: "value", value: 100_000_000 }] }, // 100 Ω on 12V = 1.44W
    });
    const diagnostics = checkRatings({
      file: "sch/b.teda",
      schematic,
      devices: new Map([["res-thick-0402", { ...RESISTOR, construction: "thick", package_code: "0402" }]]),
    });
    const error = diagnostics.find((diagnostic) => diagnostic.code === "design.rating-exceeded");
    expect(error?.data?.limit_uw).toBe(62_500);
    expect(error?.message).toContain("standard rating of a 0402 chip resistor");
    expect(diagnostics.some((diagnostic) => diagnostic.code === "design.power-unknown")).toBe(false);
  });

  test("a declared requirement wins over the floor: a 1W part in a 2010 is not second-guessed", () => {
    const schematic = board({
      instances: [{ id: "R1", component: "res-thick-2010" }],
      nets: [
        { id: "A", members: ["R1.1"] },
        { id: "B", members: ["R1.2"] },
      ],
      constraints: windows,
      params: { R1: [{ name: "value", value: 190_000_000 }, { name: "power", value: 1_000_000 }] }, // 190Ω, 1W
    });
    const diagnostics = checkRatings({
      file: "sch/b.teda",
      schematic,
      devices: new Map([
        ["res-thick-2010", { ...RESISTOR, construction: "thick", package_code: "2010" }],
      ]),
    });
    // 12V across 190Ω = 758mW: above the 750mW floor, inside the 1W the line asked for. The
    // declared requirement is the bound, so the package convention must not flag it.
    expect(diagnostics.some((diagnostic) => diagnostic.code === "design.rating-exceeded")).toBe(false);
  });

  test("a declared requirement is what the error names, not the floor", () => {
    const schematic = board({
      instances: [{ id: "R1", component: "res-thick-2010" }],
      nets: [
        { id: "A", members: ["R1.1"] },
        { id: "B", members: ["R1.2"] },
      ],
      constraints: windows,
      params: { R1: [{ name: "value", value: 100_000_000 }, { name: "power", value: 1_000_000 }] }, // 100Ω, 1W
    });
    const diagnostics = checkRatings({
      file: "sch/b.teda",
      schematic,
      devices: new Map([
        ["res-thick-2010", { ...RESISTOR, construction: "thick", package_code: "2010" }],
      ]),
    });
    const error = diagnostics.find((diagnostic) => diagnostic.code === "design.rating-exceeded");
    expect(error?.data?.limit_uw).toBe(1_000_000); // 1.44W against the line's 1W, not the 750mW floor
    expect(error?.message).toContain("the line's power requirement");
  });

  test("a package the table does not carry (IEC spelling) is not a violation and not a pass", () => {
    const schematic = board({
      instances: [{ id: "R1", component: "res-thick-0402" }],
      nets: [
        { id: "A", members: ["R1.1"] },
        { id: "B", members: ["R1.2"] },
      ],
      constraints: windows,
      params: { R1: [{ name: "value", value: 100_000_000 }] },
    });
    const diagnostics = checkRatings({
      file: "sch/b.teda",
      schematic,
      devices: new Map([["res-thick-0402", { ...RESISTOR, construction: "thick", package_code: "1005" }]]),
    });
    expect(diagnostics.some((diagnostic) => diagnostic.code === "design.rating-exceeded")).toBe(false);
    expect(diagnostics.find((diagnostic) => diagnostic.code === "design.power-unknown")?.data?.no_package_rating).toBe(1);
  });
});
