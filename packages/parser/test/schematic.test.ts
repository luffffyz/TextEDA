// Unit tests for `schematic` parsing (one flat file per board, ADR-0025).
//
// Positive cases use real descriptions from the reference project (mcu-board, charger-buck);
// negative cases use minimal inline sources -- each negative case breaks exactly one thing, and the diagnostic code must line up.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validate } from "@texteda/ir";
import {
  parseSchematic,
  type ModuleSource,
} from "../src/schematic.ts";
import { loadResolver } from "./project.ts";

const projectDir = "examples/reference-project";

const resolver = loadResolver();

describe("single-file board (mcu-board)", () => {
  const text = readFileSync(join(projectDir, "design/sch", "mcu-board.teda"), "utf8");
  const result = parseSchematic(text, { file: "sch/mcu-board.teda", board: "mcu-board", components: resolver });

  test("parses successfully with no error diagnostics", () => {
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.ok).toBe(true);
  });

  test("IR satisfies the schematic contract", () => {
    const check = validate("schematic", result.ir);
    expect(check.errors).toEqual([]);
    expect(check.ok).toBe(true);
  });

  test("instances and nets are unique sets of the board", () => {
    const ir = result.ir!;
    expect(ir.board).toBe("mcu-board");
    expect(ir.format).toBe("0.2");
    expect(ir.instances.length).toBe(21);
    expect(ir.nets.length).toBe(10);
  });

  test("pin references use numbers, not pin names", () => {
    const gnd = result.ir!.nets.find((n) => n.id === "GND")!;
    expect(gnd.members.length).toBe(27);
    // VSS_1 is a pin name; the IR may only contain pin numbers.
    expect(gnd.members.every((m) => /^[A-Z]+\d+\.[A-Za-z0-9_+-]+$/.test(m))).toBe(true);
    expect(gnd.members.some((m) => m.includes("VSS"))).toBe(false);
  });

  test("params land in the IR in component declaration order, units converted to integers", () => {
    const c1 = result.ir!.instances.find((i) => i.id === "C1")!;
    expect(c1.component).toBe("cap-mlcc-0402");
    expect(c1.params).toEqual([
      { name: "value", value: 100_000_000 }, // 100nF → fF
      { name: "tolerance", value: 100_000 }, // 10% → ppm
      { name: "voltage", value: 16_000_000 }, // 16V → µV
      { name: "dielectric", text: "X7R" },
    ]);
  });

  test("constraints land in the unit field matching their type", () => {
    const constraints = result.ir!.constraints!;
    expect(constraints).toEqual([
      { type: "voltage", subject: "VIN_5V", min_uv: 4_500_000, max_uv: 5_500_000 },
      { type: "voltage", subject: "V3V3", min_uv: 3_000_000, max_uv: 3_600_000 },
      { type: "current", subject: "V3V3", max_na: 300_000_000 },
    ]);
  });

  test("ports only name existing nets", () => {
    const ports = result.ir!.ports!;
    expect(ports.length).toBe(7);
    expect(ports.find((p) => p.id === "VOUT_3V3")!.net).toBe("V3V3");
  });

  test("ERC warning: unconnected pins", () => {
    const warnings = result.diagnostics.filter((d) => d.severity === "warning");
    // Each reserved GPIO on the board gets an unconnected warning.
    const unconnected = warnings.filter((d) => d.code === "net.pin-unassigned");
    expect(unconnected.length).toBe(78);
  });

  test("single-member nets warn only when truly unconnected", () => {
    const warnings = result.diagnostics.filter((d) => d.severity === "warning");
    // SWDIO / SWCLK on the board each connect only one pin, but they hang off board-level ports (going off-board), so they are not unconnected.
    expect(warnings.filter((d) => d.code === "drc.single-member-net").length).toBe(0);

    // The same nets become unconnected once the ports are removed, and must be reported.
    const withoutPorts = text.replace(/^ports\n(?:.*\n)*?$/m, "");
    const stripped = parseSchematic(withoutPorts, {
      file: "sch/mcu-board.teda",
      board: "mcu-board",
      components: resolver,
    });
    expect(
      stripped.diagnostics.filter((d) => d.code === "drc.single-member-net").length,
    ).toBeGreaterThan(0);
  });
});

describe("composed board (charger-buck)", () => {
  const text = readFileSync(join(projectDir, "design/sch", "charger-buck.teda"), "utf8");
  const modules: ModuleSource[] = ["charger-power", "buck-5v"].map((id) => ({
    moduleId: id,
    file: `modules/${id}.teda`,
    text: readFileSync(join(projectDir, "design/modules", `${id}.teda`), "utf8"),
  }));
  const result = parseSchematic(text, {
    file: "sch/charger-buck.teda",
    board: "charger-buck",
    components: resolver,
    modules,
  });

  test("parses successfully and the IR satisfies the contract", () => {
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const check = validate("schematic", result.ir);
    expect(check.errors).toEqual([]);
  });

  test("the board's instances carry their module's prefix", () => {
    const ids = result.ir!.instances.map((i) => i.id);
    expect(ids.length).toBe(61);
    expect(ids).toContain("M1.U1");
    expect(ids).toContain("M2.U1");
    expect(ids).toContain("M1.C1");
    expect(ids).toContain("M2.C1");
  });

  test("a module's internal nets keep the qualified name", () => {
    const ids = result.ir!.nets.map((n) => n.id);
    expect(ids).toContain("M1.VFB");
    expect(ids).toContain("M2.VFB");
    expect(ids).toContain("M2.BOOT");
    expect(ids).toContain("M1.PH");
    expect(ids).toContain("M2.PH");
  });

  test("a port merges the module's net into the board's net", () => {
    const ids = result.ir!.nets.map((n) => n.id);
    // The merged nets keep the board's name; the module's own name is gone.
    expect(ids).toContain("GND");
    expect(ids).toContain("SYS");
    expect(ids).toContain("VOUT");
    expect(ids).not.toContain("M2.SYS");
    expect(ids).not.toContain("M2.GND");
  });

  test("the nets both modules share are one net", () => {
    const sys = result.ir!.nets.find((n) => n.id === "SYS")!;
    // The power path's SYS and the buck's SYS are one board net. The IR names pins by number.
    expect(sys.members).toContain("M1.U1.1");
    expect(sys.members).toContain("M2.U1.7");
    const gnd = result.ir!.nets.find((n) => n.id === "GND")!;
    expect(gnd.members).toContain("M1.U1.17");
    expect(gnd.members).toContain("M2.U1.6");
  });

  test("the board's ports name board nets", () => {
    const ports = result.ir!.ports!;
    expect(ports.length).toBe(5);
    expect(ports.find((p) => p.id === "VOUT_5V")!.net).toBe("VOUT");
    expect(ports.find((p) => p.id === "GND")!.net).toBe("GND");
  });

  test("the constraints name the board's nets and the modules' qualified nets", () => {
    const constraints = result.ir!.constraints!;
    const buckVfb = constraints.find((c) => c.type === "voltage" && c.subject === "M2.VFB");
    expect(buckVfb).toEqual({ type: "voltage", subject: "M2.VFB", min_uv: 1_203_000, max_uv: 1_239_000 });
    const chargerVfb = constraints.find((c) => c.type === "voltage" && c.subject === "M1.VFB");
    expect(chargerVfb).toEqual({ type: "voltage", subject: "M1.VFB", min_uv: 2_079_000, max_uv: 2_121_000 });
  });

  test("ERC warning: ENA intentionally left open (internal pull-up)", () => {
    const warnings = result.diagnostics.filter((d) => d.severity === "warning");
    expect(warnings.map((w) => w.message)).toEqual(["pin M2.U1.5 (ENA) is not connected"]);
  });
});

describe("constraint types", () => {
  const text = [
    "version 0.3",
    "schematic b",
    "",
    "instances",
    "  R1  res-thick-0402  10k  ±1%",
    "",
    "nets",
    "  A:  R1.1",
    "  B:  R1.2",
    "",
    "constraints",
    "  impedance  A   90Ω",
    "  diff      A   B   90Ω   ±10%",
    "  skew      A   B   <    1mm",
    "  length    A   0.5mm..2mm",
    "  current   A   100mA",
    "  power     A   1W",
    "",
  ].join("\n");
  const result = parseSchematic(text, { file: "sch/b.teda", board: "b", components: resolver });

  test("all seven constraint types land in the matching unit field", () => {
    expect(result.ir!.constraints).toEqual([
      { type: "impedance", net: "A", value_mohm: 90_000 },
      { type: "diff", net_a: "A", net_b: "B", impedance_mohm: 90_000, tolerance_ppm: 100_000 },
      { type: "skew", net_a: "A", net_b: "B", op: "<", length_nm: 1_000_000 },
      { type: "length", net: "A", min_nm: 500_000, max_nm: 2_000_000 },
      { type: "current", subject: "A", max_na: 100_000_000 },
      { type: "power", subject: "A", max_uw: 1_000_000 },
    ]);
  });

  test("errors when a constraint's subject does not exist", () => {
    const bad = text.replace("  current   A   100mA", "  current   NOPE   100mA");
    const result2 = parseSchematic(bad, { file: "sch/b.teda", board: "b", components: resolver });
    expect(result2.diagnostics.map((d) => d.code)).toContain("ref.unknown-net");
  });

  test("errors when a range's lower bound exceeds its upper bound", () => {
    const bad = text.replace("0.5mm..2mm", "2mm..0.5mm");
    const result2 = parseSchematic(bad, { file: "sch/b.teda", board: "b", components: resolver });
    expect(result2.diagnostics.some((d) => d.message.includes("lower bound exceeds upper bound"))).toBe(true);
  });
});

describe("negative cases", () => {
  const board = ["version 0.3", "schematic b", "", "instances", "  R1  res-thick-0402  10k  ±1%", "", "nets", "  A:  R1.1"].join("\n");

  function codes(text: string, options: Partial<Parameters<typeof parseSchematic>[1]> = {}): string[] {
    const result = parseSchematic(text, {
      file: "sch/b.teda",
      board: "b",
      components: resolver,
      ...options,
    });
    return result.diagnostics.map((d) => d.code);
  }

  test("component not found", () => {
    const text = board.replace("res-thick-0402", "no-such-part");
    expect(codes(text)).toContain("ref.unknown-component");
  });

  test("diagnostics carry machine-usable data (ADR-0016)", () => {
    const result = parseSchematic(board.replace("res-thick-0402", "no-such-part"), {
      file: "sch/b.teda",
      board: "b",
      components: resolver,
    });
    const diagnostic = result.diagnostics.find((d) => d.code === "ref.unknown-component")!;
    expect(diagnostic.data).toEqual({ component_id: "no-such-part", refdes: "R1" });
  });

  test("duplicate refdes", () => {
    const text = board.replace("nets", "  R1  res-thick-0402  10k  ±1%\n\nnets");
    expect(codes(text)).toContain("ref.duplicate-refdes");
  });

  test("parameter column count does not match the component declaration", () => {
    const text = board.replace("10k", "10k 1% 2W 3X");
    expect(codes(text)).toContain("value.param-count-mismatch");
  });

  test("parameter value is not a value of that quantity", () => {
    const text = board.replace("10k", "10V");
    expect(codes(text)).toContain("value.invalid-param");
  });

  test("a code-valued parameter outside its closed value set is an error (ADR-0038)", () => {
    // The dielectric is a code, not a quantity: the spelling is exact, because two spellings of
    // one code would be two BOM lines.
    const text = [
      "version 0.3",
      "schematic b",
      "",
      "instances",
      "  C1  cap-mlcc-0402  100n  ±10%  16V  X7r",
      "",
      "nets",
      "  A:  C1.1",
    ].join("\n");
    expect(codes(text)).toContain("value.component-param-value-invalid");
  });

  test("pin does not exist", () => {
    const text = board.replace("R1.1", "R1.9");
    expect(codes(text)).toContain("net.member-unknown");
  });

  test("a no_connect pin is wired to a net", () => {
    // NC1 (pin 2) of tps5430ddar is no_connect.
    const text = [
      "version 0.3",
      "schematic b",
      "",
      "instances",
      "  U1  tps5430ddar",
      "",
      "nets",
      "  A:  U1.NC1",
      "",
    ].join("\n");
    expect(codes(text)).toContain("net.no-connect-connected");
  });

  test("one pin belongs to two nets", () => {
    const text = [
      "version 0.3",
      "schematic b",
      "",
      "instances",
      "  R1  res-thick-0402  10k  ±1%",
      "",
      "nets",
      "  A:  R1.1",
      "  B:  R1.1",
      "",
    ].join("\n");
    expect(codes(text)).toContain("net.pin-in-two-nets");
  });

  test("port points at a nonexistent net", () => {
    const text = board + "\n\nports\n  P1  NOPE";
    expect(codes(text)).toContain("ref.unknown-net");
  });

  test("two ports point at the same net", () => {
    const text = board + "\n\nports\n  P1  A\n  P2  A";
    expect(codes(text)).toContain("ref.duplicate-port-net");
  });

  test("single-member net produces a warning", () => {
    const result = parseSchematic(board, { file: "sch/b.teda", board: "b", components: resolver });
    const diagnostic = result.diagnostics.find((d) => d.code === "drc.single-member-net");
    expect(diagnostic?.severity).toBe("warning");
    expect(diagnostic?.message).toContain("net A");
  });

  test("the `pages` section is gone: it says so instead of 'unknown section'", () => {
    const text = board + "\n\npages\n  P1  some-page";
    const result = parseSchematic(text, { file: "sch/b.teda", board: "b", components: resolver });
    const diagnostic = result.diagnostics.find((d) => d.code === "syntax.removed-construct")!;
    expect(diagnostic.message).toContain("pages");
    expect(diagnostic.hint).toContain("teda.md §13.4");
  });

  test("the `page` description type is gone: it says so instead of 'unknown type'", () => {
    const text = "version 0.3\npage p1\n\ninstances\n  R2  res-thick-0402  10k  ±1%";
    const result = parseSchematic(text, { file: "sch/b/p1.teda", board: "b", components: resolver });
    const diagnostic = result.diagnostics.find((d) => d.code === "syntax.removed-construct")!;
    expect(diagnostic.message).toContain("page");
  });

  test("version higher than the tool supports", () => {
    const text = board.replace("version 0.3", "version 0.10");
    expect(codes(text)).toContain("format.unsupported-version");
  });

  test("unknown section", () => {
    // A stray line before any section starts: it belongs to no section.
    const text = "version 0.3\nschematic b\nwidgets  x\n";
    expect(codes(text)).toContain("syntax.unknown-section");
  });

  test("diagnostics carry file, line, and column", () => {
    const result = parseSchematic(board.replace("10k", "10V"), {
      file: "sch/b.teda",
      board: "b",
      components: resolver,
    });
    const diagnostic = result.diagnostics.find((d) => d.code === "value.invalid-param")!;
    expect(diagnostic.location).toEqual({ file: "sch/b.teda", line: 5, col: 3 });
  });
});

describe("single-member net semantics (teda.md §11.4)", () => {
  test("a net with one pin is reported", () => {
    const boardWithOnePin = [
      "version 0.3",
      "schematic b",
      "",
      "instances",
      "  R1  res-thick-0402  10k  ±1%",
      "",
      "nets",
      "  A:  R1.1",
    ].join("\n");
    const result = parseSchematic(boardWithOnePin, {
      file: "sch/b.teda",
      board: "b",
      components: resolver,
    });
    const warnings = result.diagnostics.filter((d) => d.code === "drc.single-member-net");
    expect(warnings.length).toBe(1);
    expect(warnings[0]!.message).toContain("A");
    expect(warnings[0]!.location?.file).toBe("sch/b.teda");
  });

  test("a net with a board-level port is not single-member", () => {
    const boardWithBoardPort = [
      "version 0.3",
      "schematic b",
      "",
      "instances",
      "  R1  res-thick-0402  10k  ±1%",
      "",
      "nets",
      "  SWD:  R1.1",
      "",
      "ports",
      "  SWDIO  SWD",
    ].join("\n");
    const result = parseSchematic(boardWithBoardPort, {
      file: "sch/b.teda",
      board: "b",
      components: resolver,
    });
    // That pin goes off-board; it is not an unconnected pin.
    expect(result.diagnostics.filter((d) => d.code === "drc.single-member-net").length).toBe(0);
  });
});

describe("continuation rows (teda.md §7.2)", () => {
  // A row whose first column is a bare `:` continues the net named by the row above it.
  const header = ["version 0.3", "schematic b", "", "instances", "  R1  res-thick-0402  10k  ±1%", "  R2  res-thick-0402  10k  ±1%", "", "nets"].join("\n");

  function parse(text: string) {
    return parseSchematic(text, { file: "sch/b.teda", board: "b", components: resolver });
  }

  test("a continuation row adds members to the net above it", () => {
    const result = parse(`${header}\n  A:  R1.1\n  :  R2.1`);
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const net = result.ir!.nets.find((n) => n.id === "A")!;
    expect(net.members).toEqual(["R1.1", "R2.1"]);
  });

  test("several continuation rows all belong to the same net", () => {
    const result = parse(`${header}\n  A:  R1.1\n  :  R2.1\n  :  R1.2`);
    const net = result.ir!.nets.find((n) => n.id === "A")!;
    // The IR orders members by pin reference: R1.1, R1.2, R2.1.
    expect(net.members).toEqual(["R1.1", "R1.2", "R2.1"]);
  });

  test("a continuation row does not create a net of its own", () => {
    const result = parse(`${header}\n  A:  R1.1\n  :  R2.1`);
    expect(result.ir!.nets.map((n) => n.id)).toEqual(["A"]);
  });

  test("a continuation row without a net above is an error", () => {
    const result = parse(`${header}\n  :  R1.1`);
    expect(result.diagnostics.map((d) => d.code)).toContain("net.continuation-without-net");
  });

  test("a continuation row merges with a repeated net name", () => {
    const result = parse(`${header}\n  A:  R1.1\n  A:  R1.2\n  :  R2.1`);
    const net = result.ir!.nets.find((n) => n.id === "A")!;
    expect(net.members).toEqual(["R1.1", "R1.2", "R2.1"]);
  });

  test("the row order of the source does not change the IR", () => {
    const forward = parse(`${header}\n  A:  R1.1  R2.1\n  B:  R1.2`);
    const reversed = parse(`${header}\n  B:  R1.2\n  A:  R1.1  R2.1`);
    expect(reversed.ir!.nets).toEqual(forward.ir!.nets);
  });

  test("members are ordered by pin reference, not by source order", () => {
    const result = parse(`${header}\n  A:  R2.1  R1.1`);
    const net = result.ir!.nets.find((n) => n.id === "A")!;
    expect(net.members).toEqual(["R1.1", "R2.1"]);
  });
});

describe("bus continuation rows (teda.md §7.3)", () => {
  const header = ["version 0.3", "schematic b", "", "instances", "  R1  res-thick-0402  10k  ±1%", "  R2  res-thick-0402  10k  ±1%", "", "bus i2c0 = I2C"].join("\n");

  test("a continuation row adds pins to the bus member above it", () => {
    const result = parseSchematic(`${header}\n  scl:  R1.1\n  :  R2.1\n  sda:  R2.2`, {
      file: "sch/b.teda",
      board: "b",
      components: resolver,
    });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const net = result.ir!.nets.find((n) => n.id === "i2c0.scl")!;
    expect(net.members).toEqual(["R1.1", "R2.1"]);
    // The continuation belongs to the member above it, not to the member below it.
    const other = result.ir!.nets.find((n) => n.id === "i2c0.sda")!;
    expect(other.members).toEqual(["R2.2"]);
  });

  test("a continuation row without a bus member above is an error", () => {
    const result = parseSchematic(`${header}\n  :  R1.1`, {
      file: "sch/b.teda",
      board: "b",
      components: resolver,
    });
    expect(result.diagnostics.map((d) => d.code)).toContain("net.continuation-without-net");
  });
});
