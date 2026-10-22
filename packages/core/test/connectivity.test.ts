// The connectivity rules are pure functions: they only consume facts, no text parsing, no
// filesystem access.
// So there is no need to construct .teda source here — supplying nets and pins directly tests
// the rules themselves.
import { describe, expect, test } from "bun:test";
import { checkConnectivity, type ConnectivityFacts } from "../src/index.ts";

const base: ConnectivityFacts = {
  file: "sch/b.teda",
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

describe("location", () => {
  test("prefers the net location supplied by the caller", () => {
    const diagnostics = checkConnectivity({
      ...base,
      nets: [{ id: "N1", members: ["R1.1"] }],
      locateNet: (id) => (id === "N1" ? { file: "sch/b/p1.teda", line: 12, col: 3 } : undefined),
    });
    expect(diagnostics[0]!.location).toEqual({ file: "sch/b/p1.teda", line: 12, col: 3 });
  });

  test("falls back to the board file's first line when no location is available, without dropping the diagnostic", () => {
    const diagnostics = checkConnectivity({ ...base, nets: [{ id: "N1", members: ["R1.1"] }] });
    expect(diagnostics[0]!.location).toEqual({ file: "sch/b.teda", line: 1, col: 1 });
  });
});
