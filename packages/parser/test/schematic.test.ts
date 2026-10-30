// Unit tests for `schematic` parsing (one flat file per board, ADR-0012).
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
    expect(ir.format).toBe("0.9.1");
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
      { type: "voltage", subject: "GND", min_uv: 0, max_uv: 0 },
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


describe("stable instance UIDs (ADR-0010)", () => {
  const board = (rows: string) => [
    "version 0.9",
    "schematic b",
    "",
    "instances",
    ...rows.split("\n"),
    "",
    "nets",
    "  A:  R1.1",
    "  B:  R1.2",
  ].join("\n");

  test("a top-level row carries its UID into the IR", () => {
    const result = parseSchematic(board("  R1  ID7k3m9q  res-thick-0402  10k  ±1%"), {
      file: "sch/b.teda",
      board: "b",
      components: resolver,
    });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.ir!.instances[0]!.uid).toBe("ID7k3m9q");
  });

  test("a module-local UID is path-qualified by the module instance UID", () => {
    const moduleText = [
      "version 0.9",
      "module m",
      "",
      "instances",
      "  R1  ID7k3m9q  res-thick-0402  10k  ±1%",
      "",
      "nets",
      "  N:  R1.1",
      "",
      "ports",
      "  P  N",
    ].join("\n");
    const boardText = [
      "version 0.9",
      "schematic b",
      "",
      "modules",
      "  M1  IDp8x2n4  m",
      "  M2  IDq4m7sc  m",
      "",
      "nets",
      "  A:  M1.P  M2.P",
    ].join("\n");
    const composed = parseSchematic(boardText, {
      file: "sch/b.teda",
      board: "b",
      components: resolver,
      modules: [{ moduleId: "m", file: "modules/m.teda", text: moduleText }],
    });
    expect(composed.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const m1 = composed.ir!.instances.find((i) => i.id === "M1.R1")!;
    const m2 = composed.ir!.instances.find((i) => i.id === "M2.R1")!;
    expect(m1.uid).toBe("IDp8x2n4/ID7k3m9q");
    expect(m2.uid).toBe("IDq4m7sc/ID7k3m9q");
  });

  test("a module-local UID stays bare when the module instance has no UID", () => {
    const moduleText = [
      "version 0.9",
      "module m",
      "",
      "instances",
      "  R1  ID7k3m9q  res-thick-0402  10k  ±1%",
      "",
      "nets",
      "  N:  R1.1",
      "",
      "ports",
      "  P  N",
    ].join("\n");
    const boardText = [
      "version 0.9",
      "schematic b",
      "",
      "modules",
      "  M1  m",
      "",
      "nets",
      "  A:  M1.P",
    ].join("\n");
    const composed = parseSchematic(boardText, {
      file: "sch/b.teda",
      board: "b",
      components: resolver,
      modules: [{ moduleId: "m", file: "modules/m.teda", text: moduleText }],
    });
    expect(composed.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(composed.ir!.instances.find((i) => i.id === "M1.R1")!.uid).toBe("ID7k3m9q");
  });

  test("a duplicate UID in one file is an error", () => {
    const result = parseSchematic(
      board("  R1  ID7k3m9q  res-thick-0402  10k  ±1%\n  R2  ID7k3m9q  res-thick-0402  1k  ±1%"),
      { file: "sch/b.teda", board: "b", components: resolver },
    );
    expect(result.diagnostics.map((d) => d.code)).toContain("value.duplicate-instance-uid");
  });

  test("a malformed UID is a syntax error", () => {
    const result = parseSchematic(board("  R1  ID7K3M9Q  res-thick-0402  10k  ±1%"), {
      file: "sch/b.teda",
      board: "b",
      components: resolver,
    });
    expect(result.diagnostics.map((d) => d.code)).toContain("syntax.invalid-identifier");
  });

  test("a 0.9 row without a UID warns; an older file does not", () => {
    const current = parseSchematic(board("  R1  res-thick-0402  10k  ±1%"), {
      file: "sch/b.teda",
      board: "b",
      components: resolver,
    });
    expect(current.diagnostics.map((d) => d.code)).toContain("value.instance-uid-missing");
    const legacy = parseSchematic(
      "version 0.8\nschematic b\n\ninstances\n  R1  res-thick-0402  10k  ±1%\n\nnets\n  A:  R1.1\n  B:  R1.2\n",
      { file: "sch/b.teda", board: "b", components: resolver },
    );
    expect(legacy.diagnostics.map((d) => d.code)).not.toContain("value.instance-uid-missing");
  });

  test("a UID below language 0.9 is rejected", () => {
    const result = parseSchematic(
      "version 0.8\nschematic b\n\ninstances\n  R1  ID7k3m9q  res-thick-0402  10k  ±1%\n\nnets\n  A:  R1.1\n  B:  R1.2\n",
      { file: "sch/b.teda", board: "b", components: resolver },
    );
    expect(result.diagnostics.map((d) => d.code)).toContain("format.unsupported-version");
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

describe("row order", () => {
  // The IR depends on the semantics only: where a row was written is not part of it, and neither
  // is the order of the rows (spec/teda.md §12; ADR-0004 D1 removed the last field that leaked it).
  const source = [
    "version 0.3",
    "schematic b",
    "",
    "instances",
    "  R1  res-thick-0402  10k  ±1%",
    "  R2  res-thick-0402  4k7  ±1%",
    "",
    "nets",
    "  A:  R1.1  R2.1",
    "  B:  R1.2",
    "  C:  R2.2",
  ].join("\n");
  const shuffled = [
    "version 0.3",
    "schematic b",
    "",
    "instances",
    "  R2  res-thick-0402  4k7  ±1%",
    "  R1  res-thick-0402  10k  ±1%",
    "",
    "nets",
    "  C:  R2.2",
    "  A:  R2.1  R1.1",
    "  B:  R1.2",
  ].join("\n");

  test("row order and member order do not affect IR bytes", () => {
    const a = parseSchematic(source, { file: "sch/b.teda", board: "b", components: resolver });
    const b = parseSchematic(shuffled, { file: "sch/b.teda", board: "b", components: resolver });
    expect(b.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(JSON.stringify(b.ir)).toBe(JSON.stringify(a.ir));
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

  test("diagnostics carry machine-usable data (ADR-0003)", () => {
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

  test("a row that fails against a declaration names the declaration (ADR-0004 D5)", () => {
    const text = board.replace("10k", "10k 1% 2W 3X");
    const result = parseSchematic(text, {
      file: "sch/b.teda",
      board: "b",
      components: resolver,
    });
    const diagnostic = result.diagnostics.find((d) => d.code === "value.param-count-mismatch")!;
    // The row is the place to fix; the declaration is the file that decides how many columns there are.
    expect(diagnostic.location).toMatchObject({ file: "sch/b.teda", line: 5 });
    const related = diagnostic.related ?? [];
    expect(related).toHaveLength(1);
    expect(related[0]!.file).toContain("res-thick-0402.teda");
    expect(related[0]!.line).toBeGreaterThan(1);
  });

  test("parameter value is not a value of that quantity", () => {
    const text = board.replace("10k", "10V");
    expect(codes(text)).toContain("value.invalid-param");
  });

  test("a code-valued parameter outside its closed value set is an error (ADR-0025)", () => {
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

describe("pin references into a multi-unit device (teda.md §4.5)", () => {
  // A dual op-amp has `OUT` in unit 1 and unit 2. A bare `U1.OUT` names neither of them.
  const resolverWithOpamp: Parameters<typeof parseSchematic>[1]["components"] = {
    resolve: (id) =>
      id === "dual-opamp"
        ? {
            params: [],
            pins: [
              { number: "1", name: "OUT", type: "output", unit: 1 },
              { number: "2", name: "IN+", type: "input", unit: 1 },
              { number: "5", name: "IN+", type: "input", unit: 2 },
              { number: "7", name: "OUT", type: "output", unit: 2 },
            ],
          }
        : undefined,
  };
  const text = (member: string): string =>
    ["version 0.8", "schematic b", "", "instances", "  U1  dual-opamp", "", "nets", `  A:  ${member}`].join("\n");
  const parse = (member: string) =>
    parseSchematic(text(member), { file: "sch/b.teda", board: "b", components: resolverWithOpamp });

  test("naming the unit resolves to that unit's pin", () => {
    const result = parse("U1.2.OUT");
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.ir!.nets[0]!.members).toEqual(["U1.7"]);
  });

  test("a name that two units share is ambiguous, not unit 1", () => {
    const result = parse("U1.OUT");
    expect(result.ok).toBe(false);
    const diagnostic = result.diagnostics.find((d) => d.code === "ref.ambiguous-pin")!;
    expect(diagnostic.data).toEqual({ component_id: "dual-opamp", pin: "OUT", units: "1,2" });
    expect(diagnostic.hint).toContain("U1.1.OUT");
  });

  test("a name repeated inside one unit is ambiguous too, and points at the number", () => {
    const repeated: Parameters<typeof parseSchematic>[1]["components"] = {
      resolve: () => ({
        params: [],
        pins: [
          { number: "2", name: "GND", type: "power_in", unit: 1 },
          { number: "4", name: "GND", type: "power_in", unit: 1 },
        ],
      }),
    };
    const result = parseSchematic(["version 0.8", "schematic b", "", "instances", "  U1  x", "", "nets", "  A:  U1.GND"].join("\n"), {
      file: "sch/b.teda",
      board: "b",
      components: repeated,
    });
    expect(result.diagnostics.find((d) => d.code === "ref.ambiguous-pin")!.hint).toContain("pin number");
    expect(result.diagnostics.find((d) => d.code === "ref.ambiguous-pin")!.data).toEqual({
      component_id: "x",
      pin: "GND",
      units: "1",
    });
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

  test("a member net may be named by a port", () => {
    // `i2c0.scl` is a net with no row of its own; the bus declaration is what brings it into existence.
    const result = parseSchematic(`${header}\n  scl:  R1.1\n  sda:  R2.2\n\nports\n  I2C_SCL  i2c0.scl`, {
      file: "sch/b.teda",
      board: "b",
      components: resolver,
    });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.ir!.ports).toEqual([{ id: "I2C_SCL", net: "i2c0.scl" }]);
  });

  test("a member net may be the subject of a constraint", () => {
    const result = parseSchematic(`${header}\n  scl:  R1.1\n  sda:  R2.2\n\nconstraints\n  voltage  i2c0.scl  3.0V..3.6V`, {
      file: "sch/b.teda",
      board: "b",
      components: resolver,
    });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.ir!.constraints).toEqual([{ type: "voltage", subject: "i2c0.scl", min_uv: 3_000_000, max_uv: 3_600_000 }]);
  });

  test("the same bus declared twice is an error, and only the first block reaches the IR", () => {
    const result = parseSchematic(`${header}\n  scl:  R1.1\n  sda:  R2.2\n\nbus i2c0 = I2C\n  scl:  R2.1`, {
      file: "sch/b.teda",
      board: "b",
      components: resolver,
    });
    expect(result.diagnostics.map((d) => d.code)).toContain("ref.duplicate-bus");
    expect(result.ir!.buses).toHaveLength(1);
    const scl = result.ir!.nets.find((n) => n.id === "i2c0.scl")!;
    expect(scl.members).toEqual(["R1.1"]);
  });

  test("a repeated member row merges into one member net", () => {
    const result = parseSchematic(`${header}\n  scl:  R1.1\n  scl:  R2.1\n  sda:  R2.2`, {
      file: "sch/b.teda",
      board: "b",
      components: resolver,
    });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.ir!.nets.filter((n) => n.id === "i2c0.scl")).toHaveLength(1);
    expect(result.ir!.nets.find((n) => n.id === "i2c0.scl")!.members).toEqual(["R1.1", "R2.1"]);
  });

  test("a pin repeated across two member rows is an error", () => {
    const result = parseSchematic(`${header}\n  scl:  R1.1\n  scl:  R1.1`, {
      file: "sch/b.teda",
      board: "b",
      components: resolver,
    });
    expect(result.diagnostics.map((d) => d.code)).toContain("net.duplicate-member");
    expect(result.ir!.nets.find((n) => n.id === "i2c0.scl")!.members).toEqual(["R1.1"]);
  });
});
