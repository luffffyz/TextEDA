// The connectivity rules are pure functions: they only consume facts, no text parsing, no
// filesystem access.
// So there is no need to construct .teda source here — supplying nets and pins directly tests
// the rules themselves.
import { describe, expect, test } from "bun:test";
import { checkConnectivity, type ConnectivityFacts } from "../src/index.ts";

const base: ConnectivityFacts = {
  file: "design/sch/main.teda",
  nets: [],
  portNets: new Set(),
  pins: [],
};

const pin = (key: string, type?: string) => ({
  key,
  component: "res-thick-0402",
  name: key.split(".")[1]!,
  ...(type === undefined ? {} : { type }),
});

describe("single-member net", () => {
  test("connecting only one pin → warning (carries net and member)", () => {
    const diagnostics = checkConnectivity({ ...base, nets: [{ id: "N1", members: ["R1.1"] }] });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.code).toBe("drc.single-member-net");
    expect(diagnostics[0]!.severity).toBe("warning");
    expect(diagnostics[0]!.data).toEqual({ net: "N1", pin: "R1.1" });
  });

  test("empty net is not reported (in-board node declaration, no pin members after flattening)", () => {
    expect(checkConnectivity({ ...base, nets: [{ id: "N1", members: [] }] })).toEqual([]);
  });

  test("nets with board-level ports are not counted as missing connections", () => {
    const diagnostics = checkConnectivity({
      ...base,
      nets: [{ id: "N1", members: ["J1.3"] }],
      portNets: new Set(["N1"]),
    });
    expect(diagnostics).toEqual([]);
  });
});

describe("pin ownership", () => {
  test("the same pin appears in two nets → error, pointing out the other net", () => {
    const diagnostics = checkConnectivity({
      ...base,
      nets: [
        { id: "N1", members: ["R1.1", "R2.1"] },
        { id: "N2", members: ["R1.1", "R2.2"] },
      ],
    });
    const errors = diagnostics.filter((d) => d.code === "net.pin-in-two-nets");
    expect(errors).toHaveLength(1);
    expect(errors[0]!.data).toEqual({ pin: "R1.1", net: "N2", other_net: "N1" });
  });

  test("unconnected pin → warning; no_connect pins are not reported", () => {
    const diagnostics = checkConnectivity({
      ...base,
      nets: [{ id: "N1", members: ["R1.1", "R1.2"] }],
      pins: [pin("R1.1"), pin("R1.2"), pin("R1.3"), pin("R1.4", "no_connect")],
    });
    expect(diagnostics.map((d) => d.code)).toEqual(["net.pin-unassigned"]);
    expect(diagnostics[0]!.data).toEqual({ pin: "R1.3", component_id: "res-thick-0402" });
  });

  test("a no_connect pin connected to a net → error", () => {
    const diagnostics = checkConnectivity({
      ...base,
      nets: [{ id: "N1", members: ["R1.1", "R1.2"] }],
      pins: [pin("R1.1", "no_connect"), pin("R1.2")],
    });
    expect(diagnostics.map((d) => d.code)).toEqual(["net.no-connect-connected"]);
    expect(diagnostics[0]!.data).toEqual({ pin: "R1.1", net: "N1" });
  });
});

describe("electrical types", () => {
  test("an unconnected input is a floating input, not a spare pin", () => {
    const diagnostics = checkConnectivity({
      ...base,
      nets: [{ id: "N1", members: ["R1.1", "R1.2"] }],
      pins: [pin("R1.1"), pin("R1.2"), pin("U1.1", "input")],
    });
    expect(diagnostics.map((d) => d.code)).toEqual(["net.input-unassigned"]);
    expect(diagnostics[0]!.severity).toBe("warning");
    expect(diagnostics[0]!.data).toEqual({ pin: "U1.1", component_id: "res-thick-0402", pin_type: "input" });
  });

  test("an unconnected passive stays an ordinary unassigned pin", () => {
    const diagnostics = checkConnectivity({
      ...base,
      nets: [{ id: "N1", members: ["R1.1", "R1.2"] }],
      pins: [pin("R1.1"), pin("R1.2"), pin("U1.1", "passive")],
    });
    expect(diagnostics.map((d) => d.code)).toEqual(["net.pin-unassigned"]);
  });

  test("an unconnected power input is a floating input too", () => {
    const diagnostics = checkConnectivity({
      ...base,
      nets: [{ id: "N1", members: ["R1.1", "R1.2"] }],
      pins: [pin("R1.1"), pin("R1.2"), pin("U1.1", "power_in")],
    });
    expect(diagnostics.map((d) => d.code)).toEqual(["net.input-unassigned"]);
  });

  test("two drivers on one net fight each other → error", () => {
    const diagnostics = checkConnectivity({
      ...base,
      nets: [{ id: "N1", members: ["U1.1", "U2.1", "R1.1"] }],
      pins: [pin("U1.1", "output"), pin("U2.1", "power_out"), pin("R1.1", "passive")],
    });
    expect(diagnostics.map((d) => d.code)).toEqual(["net.output-conflict"]);
    expect(diagnostics[0]!.severity).toBe("error");
    expect(diagnostics[0]!.data).toEqual({ net: "N1", drivers: "U1.1 U2.1" });
  });

  test("two open-collector pins on one net are a wired-AND bus, not a conflict", () => {
    const diagnostics = checkConnectivity({
      ...base,
      nets: [{ id: "N1", members: ["U1.1", "U2.1"] }],
      pins: [pin("U1.1", "open_collector"), pin("U2.1", "open_collector")],
    });
    expect(diagnostics).toEqual([]);
  });

  test("a power input on a net nothing sources → note", () => {
    const diagnostics = checkConnectivity({
      ...base,
      nets: [{ id: "N1", members: ["U1.1", "C1.1"] }],
      pins: [pin("U1.1", "power_in"), pin("C1.1", "passive")],
    });
    expect(diagnostics.map((d) => d.code)).toEqual(["net.power-undriven"]);
    expect(diagnostics[0]!.severity).toBe("note");
    expect(diagnostics[0]!.data).toEqual({ pin: "U1.1", net: "N1" });
  });

  test("a net with a source leaves the power input alone", () => {
    const diagnostics = checkConnectivity({
      ...base,
      nets: [{ id: "N1", members: ["U1.1", "U2.1"] }],
      pins: [pin("U1.1", "power_in"), pin("U2.1", "power_out")],
    });
    expect(diagnostics).toEqual([]);
  });

  test("a net that may be driven from outside the design is not judged", () => {
    const diagnostics = checkConnectivity({
      ...base,
      nets: [{ id: "N1", members: ["U1.1", "C1.1"] }],
      externallyDrivenNets: new Set(["N1"]),
      pins: [pin("U1.1", "power_in"), pin("C1.1", "passive")],
    });
    expect(diagnostics).toEqual([]);
  });
});

describe("location", () => {
  test("prefers the net location supplied by the caller", () => {
    const diagnostics = checkConnectivity({
      ...base,
      nets: [{ id: "N1", members: ["R1.1"] }],
      locateNet: (id) => (id === "N1" ? { file: "design/sch/main.teda", line: 12, col: 3 } : undefined),
    });
    expect(diagnostics[0]!.location).toEqual({ file: "design/sch/main.teda", line: 12, col: 3 });
  });

  test("falls back to the project schematic's first line when no location is available, without dropping the diagnostic", () => {
    const diagnostics = checkConnectivity({ ...base, nets: [{ id: "N1", members: ["R1.1"] }] });
    expect(diagnostics[0]!.location).toEqual({ file: "design/sch/main.teda", line: 1, col: 1 });
  });
});
