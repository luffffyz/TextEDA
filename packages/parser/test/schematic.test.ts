// Unit tests for `schematic` / `page` parsing and flattening.
//
// Positive cases use real descriptions from the reference project (mcu-board single-file board, charger-buck board root + two pages);
// negative cases use minimal inline sources -- each negative case breaks exactly one thing, and the diagnostic code must line up.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { validate } from "@texteda/ir";
import { readComponentIndex } from "../src/component-index.ts";
import {
  parseSchematic,
  type ComponentFactsLite,
  type ComponentResolver,
  type PageSource,
} from "../src/schematic.ts";

const projectDir = "examples/reference-project";

/** Load components from the reference project into a resolver. */
function loadResolver(): ComponentResolver {
  const dir = join(projectDir, "components");
  const files: string[] = [];
  const walk = (path: string): void => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const full = join(path, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".teda")) files.push(full);
    }
  };
  walk(dir);
  const table = new Map<string, ComponentFactsLite>();
  for (const file of files) {
    const result = readComponentIndex(readFileSync(file, "utf8"));
    if (!result.ok || !result.facts) continue;
    table.set(result.facts === undefined ? "" : fileToId(file), result.facts);
  }
  return {
    resolve: (id) => table.get(id),
  };
}

function fileToId(file: string): string {
  const base = file.slice(file.lastIndexOf("/") + 1);
  return base.slice(0, base.length - ".teda".length);
}

function pageSources(board: string): PageSource[] {
  const dir = join(projectDir, "sch", board);
  const files = readdirSync(dir).filter((f) => f.endsWith(".teda"));
  return files.map((f) => ({
    pageId: f.slice(0, f.length - ".teda".length),
    file: `sch/${board}/${f}`,
    text: readFileSync(join(dir, f), "utf8"),
  }));
}

const resolver = loadResolver();

describe("single-file board (mcu-board)", () => {
  const text = readFileSync(join(projectDir, "sch", "mcu-board.teda"), "utf8");
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

  test("instances and nets are both flattened unique sets", () => {
    const ir = result.ir!;
    expect(ir.board).toBe("mcu-board");
    expect(ir.format).toBe("0.2");
    expect(ir.instances.length).toBe(21);
    expect(ir.nets.length).toBe(10);
    expect(ir.pages).toBeUndefined();
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
    expect(c1.component).toBe("c-0402");
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

describe("board root + pages (charger-buck)", () => {
  const text = readFileSync(join(projectDir, "sch", "charger-buck.teda"), "utf8");
  const result = parseSchematic(text, {
    file: "sch/charger-buck.teda",
    board: "charger-buck",
    pages: pageSources("charger-buck"),
    components: resolver,
  });

  test("parses successfully and the IR satisfies the contract", () => {
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const check = validate("schematic", result.ir);
    expect(check.errors).toEqual([]);
  });

  test("page instantiation relationships stay in the pages section", () => {
    expect(result.ir!.pages).toEqual([
      { id: "M1", page: "charger-power", file: "sch/charger-buck/charger-power.teda" },
      { id: "M2", page: "buck-5v", file: "sch/charger-buck/buck-5v.teda" },
    ]);
  });

  test("in-page instance ids carry the page prefix", () => {
    const ids = result.ir!.instances.map((i) => i.id);
    // The board root has no instances; every instance comes from a page and carries the page prefix.
    expect(ids.every((id) => id.startsWith("M1.") || id.startsWith("M2."))).toBe(true);
    expect(ids.filter((id) => id.startsWith("M1.")).length).toBe(52);
    expect(ids.filter((id) => id.startsWith("M2.")).length).toBe(9);
  });

  test("in-page nets referenced by the board root via ports merge into the board-level net", () => {
    const sys = result.ir!.nets.find((n) => n.id === "SYS")!;
    // The board-level net SYS gains members from both pages.
    expect(sys.members.some((m) => m.startsWith("M1."))).toBe(true);
    expect(sys.members.some((m) => m.startsWith("M2."))).toBe(true);
    // The page port references themselves are not pins and do not appear among the members.
    expect(sys.members.some((m) => m.includes("SYS_OUT") || m.includes("SYS_IN"))).toBe(false);
  });

  test("unreferenced in-page nets are kept as <page_instance_id>.<net>", () => {
    const ids = result.ir!.nets.map((n) => n.id);
    expect(ids).toContain("M2.BOOT");
    expect(ids).toContain("M2.PH");
    expect(ids).toContain("M1.VCC");
    // Board-level net names contain no dot.
    expect(ids.filter((id) => id.includes(".")).every((id) => /^M\d+\./.test(id))).toBe(true);
  });

  test("page ports in the IR point at the flattened net and carry the page tag", () => {
    const ports = result.ir!.ports!;
    const vout = ports.find((p) => p.page === "M2" && p.id === "VOUT")!;
    expect(vout.net).toBe("VOUT");
    const gnd = ports.find((p) => p.page === "M1" && p.id === "GND")!;
    expect(gnd.net).toBe("GND");
  });

  test("constraints travel with their page, subject replaced by the flattened name", () => {
    const constraints = result.ir!.constraints!;
    const buckVfb = constraints.find((c) => c.type === "voltage" && c.subject === "M2.VFB");
    expect(buckVfb).toEqual({ type: "voltage", subject: "M2.VFB", min_uv: 1_203_000, max_uv: 1_239_000 });
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
    "  R1  r-0402  10k",
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
  const board = ["version 0.3", "schematic b", "", "instances", "  R1  r-0402  10k", "", "nets", "  A:  R1.1"].join("\n");

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
    const text = board.replace("r-0402", "no-such-part");
    expect(codes(text)).toContain("ref.unknown-component");
  });

  test("diagnostics carry machine-usable data (ADR-0016)", () => {
    const result = parseSchematic(board.replace("r-0402", "no-such-part"), {
      file: "sch/b.teda",
      board: "b",
      components: resolver,
    });
    const diagnostic = result.diagnostics.find((d) => d.code === "ref.unknown-component")!;
    expect(diagnostic.data).toEqual({ component_id: "no-such-part", refdes: "R1" });
  });

  test("duplicate refdes", () => {
    const text = board.replace("nets", "  R1  r-0402  10k\n\nnets");
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
      "  R1  r-0402  10k",
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

  test("referenced page has no source file", () => {
    const text = board + "\n\npages\n  M1  some-page";
    expect(codes(text)).toContain("ref.unknown-page");
  });

  test("port not declared in the referenced page", () => {
    const text = board + "\n\npages\n  M1  p1\n\nnets\n  A:  R1.1  M1.NOPE";
    const pages: PageSource[] = [
      { pageId: "p1", file: "sch/b/p1.teda", text: "version 0.3\npage p1\n\ninstances\n  R2  r-0402  10k" },
    ];
    expect(codes(text, { pages })).toContain("ref.unknown-port");
  });

  test("version higher than the tool supports", () => {
    const text = board.replace("version 0.3", "version 0.9");
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
  // A board-root net made up only of page ports: it is an on-board node declaration, so it is not warned as "single-member".
  const boardWithPort = [
    "version 0.3",
    "schematic b",
    "",
    "instances",
    "  R1  r-0402  10k",
    "",
    "pages",
    "  M1  p1",
    "",
    "nets",
    "  A:  M1.P1",
  ].join("\n");

  const pageWithOnePin = [
    "version 0.3",
    "page p1",
    "",
    "instances",
    "  R2  r-0402  10k",
    "",
    "nets",
    "  N1:  R2.1",
    "",
    "ports",
    "  P1  N1",
  ].join("\n");

  const pages: PageSource[] = [{ pageId: "p1", file: "sch/b/p1.teda", text: pageWithOnePin }];

  test("judged by the flattened net: an in-page net merged into a board-level net is reported once", () => {
    const result = parseSchematic(boardWithPort, {
      file: "sch/b.teda",
      board: "b",
      pages,
      components: resolver,
    });
    const warnings = result.diagnostics.filter((d) => d.code === "drc.single-member-net");
    // After flattening, board-level net A's member is the one pin from in-page N1: it really is a single-pin net, reported once, at the board level.
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
      "  R1  r-0402  10k",
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
