// Rating checks (ADR-0026): a device's limit against the declared window of the net it sits on.
import { irVersion } from "@texteda/ir";
import { describe, expect, test } from "bun:test";
import { checkRatings } from "../src/index.ts";
import type { RatingDevice } from "../src/index.ts";
import type { Schematic } from "@texteda/ir/schematic";

const TWO_PIN: RatingDevice = { pins: ["1", "2"], ratings: {} };

/** A project schematic with direct synthetic instances; ratings do not require module ownership. */
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

const VOLTAGE = (subject: string, min_uv: number, max_uv: number) =>
  ({ type: "voltage", subject, min_uv, max_uv }) as NonNullable<Schematic["constraints"]>[number];

const CURRENT = (subject: string, max_na: number) =>
  ({ type: "current", subject, max_na }) as NonNullable<Schematic["constraints"]>[number];

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
    const { diagnostics } = checkRatings({ file: "b.teda", schematic, devices: new Map([["cap-0402", TWO_PIN]]) });
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
    const { diagnostics } = checkRatings({ file: "b.teda", schematic: frames, devices: new Map([["cap-0402", TWO_PIN]]) });
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
    const { diagnostics } = checkRatings({ file: "b.teda", schematic, devices: new Map([["cap-tantalum", device]]) });
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
    const { diagnostics } = checkRatings({ file: "b.teda", schematic, devices: new Map([["cap-0402", TWO_PIN]]) });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.code).toBe("design.stress-unknown");
    expect(diagnostics[0]!.severity).toBe("note");
    expect(diagnostics[0]!.message).toContain("2 of 2 instances");
    expect(diagnostics[0]!.message).toContain("without a declared voltage window");
  });

  test("a rating that names no terminals is not compared on a part with more than two pins", () => {
    // A number whose terminals are not stated cannot be checked against a pair of nets
    // (ADR-0026 D7): the device is counted as unknown, not passed.
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
    const { diagnostics } = checkRatings({ file: "b.teda", schematic, devices: new Map([["regulator", device]]) });
    expect(diagnostics.map((d) => d.code)).toEqual(["design.stress-unknown"]);
    expect(diagnostics[0]!.message).toContain("1 whose rating names no terminals");
  });

  test("a rating that names its terminals is compared on a part with more than two pins", () => {
    // The pair says which pins the rating is about, so the multi-pin part is checkable
    // (ADR-0026 D4/D12).
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
      ratings: {
        voltage: { type: "voltage", value: 28_000_000, terminals: { from: "1", to: "2" } },
      },
    };
    const { diagnostics, coverage } = checkRatings({
      file: "b.teda",
      schematic,
      devices: new Map([["regulator", device]]),
    });
    expect(diagnostics).toEqual([]);
    expect(coverage.stress).toEqual({ compared: 1, total: 1 });
  });

  test("a rating that names its terminals is exceeded like any other", () => {
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
      ratings: {
        voltage: { type: "voltage", value: 12_000_000, terminals: { from: "1", to: "2" } },
      },
    };
    const { diagnostics } = checkRatings({
      file: "b.teda",
      schematic,
      devices: new Map([["regulator", device]]),
    });
    const error = diagnostics.find((d) => d.code === "design.rating-exceeded");
    expect(error?.severity).toBe("error");
    expect(error?.message).toContain("rated 12V");
    expect(error?.message).toContain("stresses it to 19.8V");
    expect(error?.data).toMatchObject({ role: "voltage", pin_from: "1", pin_to: "2" });
  });

  test("a directed role reads only its own polarity", () => {
    // `reverse_voltage` is stressed when the cathode is above the anode (ADR-0026 D5). Here the
    // cathode is the 12..14 V net and the anode the 0 V net, so the role fires and the 30 V limit
    // holds.
    const schematic = board({
      instances: [{ id: "D1", component: "diode" }],
      nets: [
        { id: "VDD", members: ["D1.1"] },
        { id: "GND", members: ["D1.2"] },
      ],
      constraints: [VOLTAGE("VDD", 12_000_000, 14_000_000), VOLTAGE("GND", 0, 0)],
    });
    const device: RatingDevice = {
      pins: ["1", "2", "3"],
      ratings: {
        reverse_voltage: {
          type: "voltage",
          value: 30_000_000,
          terminals: { from: "2", to: "1" },
        },
      },
    };
    const { diagnostics, coverage } = checkRatings({
      file: "b.teda",
      schematic,
      devices: new Map([["diode", device]]),
    });
    expect(diagnostics).toEqual([]);
    expect(coverage.stress).toEqual({ compared: 1, total: 1 });
  });

  test("a directed role in the other polarity is neither a violation nor an unknown", () => {
    // The anode is above the cathode here, so the role's polarity never occurs: the design never
    // stresses the part that way (ADR-0026 D12). The limit is deliberately tiny — a polarity that
    // does not occur is not a violation at any limit.
    const schematic = board({
      instances: [{ id: "D1", component: "diode" }],
      nets: [
        { id: "GND", members: ["D1.1"] },
        { id: "VDD", members: ["D1.2"] },
      ],
      constraints: [VOLTAGE("GND", 0, 0), VOLTAGE("VDD", 12_000_000, 14_000_000)],
    });
    const device: RatingDevice = {
      pins: ["1", "2", "3"],
      ratings: {
        reverse_voltage: {
          type: "voltage",
          value: 5_000_000,
          terminals: { from: "2", to: "1" },
        },
      },
    };
    const { diagnostics, coverage } = checkRatings({
      file: "b.teda",
      schematic,
      devices: new Map([["diode", device]]),
    });
    expect(diagnostics).toEqual([]);
    expect(coverage.stress).toEqual({ compared: 1, total: 1 });
  });

  test("a symmetric role is stressed in the polarity the design exercises", () => {
    // A P-channel high-side switch has its source above its drain (ADR-0075 D2). The drain-source
    // rating is a magnitude, so it covers that polarity too: the stress is the span of the
    // difference, 14 V, and a 10 V limit is exceeded. A directed reading would have compared
    // nothing here and reported the instance as compared.
    const schematic = board({
      instances: [{ id: "Q1", component: "pfet" }],
      nets: [
        { id: "ADP", members: ["Q1.5"] },
        { id: "SYS", members: ["Q1.1"] },
      ],
      constraints: [VOLTAGE("ADP", 0, 5_000_000), VOLTAGE("SYS", 12_000_000, 14_000_000)],
    });
    const device: RatingDevice = {
      pins: ["1", "2", "3", "4", "5"],
      ratings: {
        drain_source_voltage: {
          type: "voltage",
          value: 10_000_000,
          terminals: { from: "5", to: "1" },
        },
      },
    };
    const { diagnostics, coverage } = checkRatings({
      file: "b.teda",
      schematic,
      devices: new Map([["pfet", device]]),
    });
    const error = diagnostics.find((d) => d.code === "design.rating-exceeded");
    expect(error?.severity).toBe("error");
    expect(error?.data).toMatchObject({ stress_uv: 14_000_000, role: "drain_source_voltage" });
    expect(coverage.stress).toEqual({ compared: 1, total: 1 });
  });

  test("a symmetric role takes the larger of the two polarities", () => {
    // The same part, the other way round: the drain above the source. The stress is the same span
    // of the difference, so the rating covers the part either way.
    const schematic = board({
      instances: [{ id: "Q1", component: "nfet" }],
      nets: [
        { id: "SYS", members: ["Q1.5"] },
        { id: "ADP", members: ["Q1.1"] },
      ],
      constraints: [VOLTAGE("ADP", 0, 5_000_000), VOLTAGE("SYS", 12_000_000, 14_000_000)],
    });
    const device: RatingDevice = {
      pins: ["1", "2", "3", "4", "5"],
      ratings: {
        drain_source_voltage: {
          type: "voltage",
          value: 10_000_000,
          terminals: { from: "5", to: "1" },
        },
      },
    };
    const { diagnostics } = checkRatings({
      file: "b.teda",
      schematic,
      devices: new Map([["nfet", device]]),
    });
    const error = diagnostics.find((d) => d.code === "design.rating-exceeded");
    expect(error?.data).toMatchObject({ stress_uv: 14_000_000 });
  });

  test("a symmetric gate-source role is stressed when the gate is pulled below the source", () => {
    // The gate of a P-channel switch is pulled to ground while the source sits at the rail, so the
    // |V_GS| the part really sees is the opposite of the "gate above source" reading (ADR-0075 D2).
    const schematic = board({
      instances: [{ id: "Q1", component: "pfet" }],
      nets: [
        { id: "GND", members: ["Q1.4"] },
        { id: "SYS", members: ["Q1.1"] },
      ],
      constraints: [VOLTAGE("GND", 0, 0), VOLTAGE("SYS", 12_000_000, 14_000_000)],
    });
    const device: RatingDevice = {
      pins: ["1", "2", "3", "4", "5"],
      ratings: {
        gate_source_voltage: {
          type: "voltage",
          value: 10_000_000,
          terminals: { from: "4", to: "1" },
        },
      },
    };
    const { diagnostics } = checkRatings({
      file: "b.teda",
      schematic,
      devices: new Map([["pfet", device]]),
    });
    const error = diagnostics.find((d) => d.code === "design.rating-exceeded");
    expect(error?.severity).toBe("error");
    expect(error?.data).toMatchObject({ stress_uv: 14_000_000, role: "gate_source_voltage" });
  });

  test("a symmetric role inside its limit is not reported", () => {
    // The same P-channel part with a 30 V rating: the 14 V span is inside the limit.
    const schematic = board({
      instances: [{ id: "Q1", component: "pfet" }],
      nets: [
        { id: "ADP", members: ["Q1.5"] },
        { id: "SYS", members: ["Q1.1"] },
      ],
      constraints: [VOLTAGE("ADP", 0, 5_000_000), VOLTAGE("SYS", 12_000_000, 14_000_000)],
    });
    const device: RatingDevice = {
      pins: ["1", "2", "3", "4", "5"],
      ratings: {
        drain_source_voltage: {
          type: "voltage",
          value: 30_000_000,
          terminals: { from: "5", to: "1" },
        },
      },
    };
    const { diagnostics, coverage } = checkRatings({
      file: "b.teda",
      schematic,
      devices: new Map([["pfet", device]]),
    });
    expect(diagnostics).toEqual([]);
    expect(coverage.stress).toEqual({ compared: 1, total: 1 });
  });
});

describe("the coverage the comparison reports (ADR-0026 D13)", () => {
  test("an uncompared instance is counted, not passed", () => {
    const schematic = board({
      instances: [
        { id: "C1", component: "cap-0402" },
        { id: "U1", component: "regulator" },
      ],
      nets: [
        { id: "SYS", members: ["C1.1", "U1.1"] },
        { id: "GND", members: ["C1.2", "U1.2"] },
      ],
      constraints: [VOLTAGE("SYS", 9_000_000, 19_800_000), VOLTAGE("GND", 0, 0)],
      params: { C1: [{ name: "voltage", value: 50_000_000 }] },
    });
    const regulator: RatingDevice = { pins: ["1", "2", "3", "4"], ratings: {} };
    const { coverage } = checkRatings({
      file: "b.teda",
      schematic,
      devices: new Map([["cap-0402", TWO_PIN], ["regulator", regulator]]),
    });
    // C1 was compared (it is two-terminal with a capability and two windows); U1 was not.
    expect(coverage.stress).toEqual({ compared: 1, total: 2 });
  });

  test("a design where everything was compared reports full coverage", () => {
    const schematic = board({
      instances: [{ id: "C1", component: "cap-0402" }],
      nets: [
        { id: "SYS", members: ["C1.1"] },
        { id: "GND", members: ["C1.2"] },
      ],
      constraints: [VOLTAGE("SYS", 9_000_000, 19_800_000), VOLTAGE("GND", 0, 0)],
      params: { C1: [{ name: "voltage", value: 50_000_000 }] },
    });
    const { coverage } = checkRatings({
      file: "b.teda",
      schematic,
      devices: new Map([["cap-0402", TWO_PIN]]),
    });
    expect(coverage.stress).toEqual({ compared: 1, total: 1 });
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
    const { diagnostics } = checkRatings({
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
    const { diagnostics } = checkRatings({
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
    const { diagnostics } = checkRatings({
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
    const { diagnostics } = checkRatings({
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
    const { diagnostics } = checkRatings({
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
    const { diagnostics } = checkRatings({
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
    const { diagnostics } = checkRatings({
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
    const { diagnostics } = checkRatings({
      file: "sch/b.teda",
      schematic,
      devices: new Map([["res-thick-0402", { ...RESISTOR, construction: "thick", package_code: "1005" }]]),
    });
    expect(diagnostics.some((diagnostic) => diagnostic.code === "design.rating-exceeded")).toBe(false);
    expect(diagnostics.find((diagnostic) => diagnostic.code === "design.power-unknown")?.data?.no_package_rating).toBe(1);
  });
});

describe("the stated current bounds a part in series (ADR-0076)", () => {
  /** A 0402 between two rails whose windows are far apart: the span bound is enormous. */
  const RESISTOR_0402: RatingDevice = {
    pins: ["1", "2"],
    ratings: {},
    params: [
      { name: "value", type: "resistance" },
      { name: "tolerance", type: "percent" },
      { name: "power", type: "power" },
    ],
    construction: "thick",
    package_code: "0402",
  };

  test("without a stated current the window span still speaks for the part", () => {
    // The span of the two windows is 28 V, so the bound is 78.4 W against a 0402's 62.5 mW.
    const schematic = board({
      instances: [{ id: "R1", component: "res-thick-0402" }],
      nets: [
        { id: "A", members: ["R1.1"] },
        { id: "B", members: ["R1.2"] },
      ],
      constraints: [VOLTAGE("A", 0, 19_000_000), VOLTAGE("B", 5_000_000, 28_000_000)],
      params: { R1: [{ name: "value", value: 10_000_000 }] }, // 10 Ω
    });
    const { diagnostics } = checkRatings({
      file: "sch/b.teda",
      schematic,
      devices: new Map([["res-thick-0402", RESISTOR_0402]]),
    });
    const error = diagnostics.find((diagnostic) => diagnostic.code === "design.rating-exceeded");
    expect(error?.severity).toBe("error");
    expect(error?.data?.stress_uw).toBe(78_400_000);
    expect(error?.data?.bound).toBe("window_span");
  });

  test("a stated current bounds the dissipation and the part passes", () => {
    // 25 mA through 10 Ω is 62.5 µW: the design knows what flows here, and the part can take it.
    const schematic = board({
      instances: [{ id: "R1", component: "res-thick-0402" }],
      nets: [
        { id: "A", members: ["R1.1"] },
        { id: "B", members: ["R1.2"] },
      ],
      constraints: [
        VOLTAGE("A", 0, 19_000_000),
        VOLTAGE("B", 5_000_000, 28_000_000),
        CURRENT("R1.1", 25_000_000),
      ],
      params: { R1: [{ name: "value", value: 10_000_000 }] }, // 10 Ω
    });
    const { diagnostics, coverage } = checkRatings({
      file: "sch/b.teda",
      schematic,
      devices: new Map([["res-thick-0402", RESISTOR_0402]]),
    });
    expect(diagnostics.some((diagnostic) => diagnostic.code === "design.rating-exceeded")).toBe(false);
    expect(coverage.dissipation).toEqual({ compared: 1, total: 1 });
  });

  test("a stated current the part cannot carry is an error, and the message names it", () => {
    const schematic = board({
      instances: [{ id: "R1", component: "res-thick-0402" }],
      nets: [
        { id: "A", members: ["R1.1"] },
        { id: "B", members: ["R1.2"] },
      ],
      constraints: [VOLTAGE("A", 0, 12_000_000), VOLTAGE("B", 0, 0), CURRENT("R1.1", 4_000_000_000)],
      params: { R1: [{ name: "value", value: 1_000_000 }] }, // 1 Ω
    });
    const { diagnostics } = checkRatings({
      file: "sch/b.teda",
      schematic,
      devices: new Map([["res-thick-0402", RESISTOR_0402]]),
    });
    const error = diagnostics.find((diagnostic) => diagnostic.code === "design.rating-exceeded");
    expect(error?.severity).toBe("error");
    expect(error?.message).toContain("carries at most 4A (current R1.1)");
    expect(error?.message).toContain("16W");
    expect(error?.data).toMatchObject({ bound: "stated_current", current_na: 4_000_000_000 });
  });

  test("a rail's current is not the current of a part on it", () => {
    // The rail's current is a layout input (ADR-0026 D18): the language does not say which member
    // of the net carries it, so it may not become the bound of this part.
    const schematic = board({
      instances: [{ id: "R1", component: "res-thick-0402" }],
      nets: [
        { id: "A", members: ["R1.1"] },
        { id: "B", members: ["R1.2"] },
      ],
      constraints: [VOLTAGE("A", 0, 12_000_000), VOLTAGE("B", 0, 0), CURRENT("A", 4_000_000_000)],
      params: { R1: [{ name: "value", value: 1_000_000 }] }, // 1 Ω
    });
    const { diagnostics } = checkRatings({
      file: "sch/b.teda",
      schematic,
      devices: new Map([["res-thick-0402", RESISTOR_0402]]),
    });
    const error = diagnostics.find((diagnostic) => diagnostic.code === "design.rating-exceeded");
    expect(error?.data?.bound).toBe("window_span");
  });

  test("the tighter of the two bounds binds", () => {
    // 1 kΩ across 12 V is 144 mW, which a 0402 cannot take; a stated 1 A would say 1 W, which is
    // looser. The span binds, so the finding is the one the windows give.
    const schematic = board({
      instances: [{ id: "R1", component: "res-thick-0402" }],
      nets: [
        { id: "A", members: ["R1.1"] },
        { id: "B", members: ["R1.2"] },
      ],
      constraints: [VOLTAGE("A", 0, 12_000_000), VOLTAGE("B", 0, 0), CURRENT("R1.1", 1_000_000_000)],
      params: { R1: [{ name: "value", value: 1_000_000_000 }] }, // 1 kΩ
    });
    const { diagnostics } = checkRatings({
      file: "sch/b.teda",
      schematic,
      devices: new Map([["res-thick-0402", RESISTOR_0402]]),
    });
    const error = diagnostics.find((diagnostic) => diagnostic.code === "design.rating-exceeded");
    expect(error?.data).toMatchObject({ bound: "window_span", stress_uw: 144_000 });
  });

  test("a position with a stated current and no window is still compared", () => {
    // Each bound needs only the facts it uses (ADR-0076 D5): the current bound does not need a
    // window, so the position is compared rather than counted as unknown.
    const schematic = board({
      instances: [{ id: "R1", component: "res-thick-0402" }],
      nets: [
        { id: "A", members: ["R1.1"] },
        { id: "B", members: ["R1.2"] },
      ],
      constraints: [CURRENT("R1.1", 25_000_000)],
      params: { R1: [{ name: "value", value: 10_000_000 }] }, // 10 Ω
    });
    const { diagnostics, coverage } = checkRatings({
      file: "sch/b.teda",
      schematic,
      devices: new Map([["res-thick-0402", RESISTOR_0402]]),
    });
    expect(diagnostics.some((diagnostic) => diagnostic.code === "design.power-unknown")).toBe(false);
    expect(coverage.dissipation).toEqual({ compared: 1, total: 1 });
  });
});
