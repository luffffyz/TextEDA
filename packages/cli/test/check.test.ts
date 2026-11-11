// Contract tests for `texteda check`.
//
// The fixtures model the current project shape: one logical root schematic, reusable module
// definitions, and physical PCB ownership declared by each PCB.
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeProject, checkProject } from "../src/check.ts";

const COMPONENT = `version 0.1.3
component res-thick-0402

kind         generic
category     resistor
construction thick
polarized    no
symbol project:r
footprint project:chip-0402

params
  value      resistance  required
  tolerance  percent     required

pins
  1  A  passive
  2  B  passive
`;

const MODULE = `version 0.8
module m

instances
  R1  res-thick-0402  10k  ±1%

nets
  VCC:  R1.1

ports
  VCC_OUT  VCC
`;


const MAIN = `version 0.14.0
schematic main

modules
  M1  m

nets
  VCC:  M1.VCC_OUT
`;

const MAIN_TWO = `version 0.14.0
schematic main

modules
  M1  ID7k3m9q  m
  M2  IDp8x2n4  m

nets
  VCC:  M1.VCC_OUT  M2.VCC_OUT

interconnects
  ic1  M1.VCC_OUT  M2.VCC_OUT
`;

const PROJECT = `[project]
name = "demo"
version = "0.1.0"
format = "0.9.1"
`;

/** A valid physical PCB fixture. `modules` is the complete root-module ownership list. */
function pcb(id: string, modules: string[] = ["M1"], places: string[] = modules): string {
  const moduleRows = modules.map((moduleId) => `  ${moduleId}`).join("\n");
  const placeRows = places.map((moduleId) => `  ${moduleId}.R1  [10,10]  0  top`).join("\n");
  return `version 0.14.0
pcb ${id}

modules
${moduleRows}

board_thickness 1.6mm

stackup
  F.Cu  copper     0.035mm  signal
  core   dielectric 1.53mm  FR4
  B.Cu  copper     0.035mm  signal

outline
  [0,0]
  [50,0]
  [50,36]

place
${placeRows}

connect

rules
  clearance  0.2mm
  width      0.25mm
  via        0.6mm  0.3mm
`;
}

type PcbFixture = { id: string; text: string };

/** Build a project in a temp directory. */
function makeProject(
  schematic: string = MAIN,
  module: string | null = MODULE,
  pcbs: PcbFixture[] = [{ id: "b", text: pcb("b") }],
): string {
  const root = mkdtempSync(join(tmpdir(), "texteda-check-"));
  mkdirSync(join(root, "assets/components"), { recursive: true });
  mkdirSync(join(root, "design/sch"), { recursive: true });
  mkdirSync(join(root, "design/pcb"), { recursive: true });
  writeFileSync(join(root, "project.toml"), PROJECT);
  writeFileSync(join(root, "assets/components", "res-thick-0402.teda"), COMPONENT);
  writeFileSync(join(root, "design/sch", "main.teda"), schematic);
  if (module !== null) {
    mkdirSync(join(root, "design/sch/modules"), { recursive: true });
    writeFileSync(join(root, "design/sch/modules", "m.teda"), module);
  }
  for (const item of pcbs) writeFileSync(join(root, "design/pcb", `${item.id}.teda`), item.text);
  return root;
}

const PART = `version 0.1.5
component rc0402fr-0710kl
kind         part
mpn          RC0402FR-0710KL
manufacturer Yageo
category     resistor
symbol project:r
footprint project:chip-0402

ratings
  value      resistance  10k
  tolerance  percent     1%

pins
  1  A  passive
  2  B  passive
`;

/** A procurement file: the selections of a PCB, in one of the two positions. */
function procurement(rows: string, role: "primary" | "alternatives" = "primary", pcbId = "b"): string {
  return `version 0.9
procurement ${pcbId}
role ${role}

selections
${rows}
`;
}

describe("check", () => {
  test("a clean project has no errors", () => {
    const root = makeProject();
    try {
      const result = checkProject(root);
      expect(result.main).toBe("main");
      expect(result.pcbs).toEqual(["b"]);
      expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("duplicate module-instance UIDs in the project root are errors", () => {
    const rootSchematic = MAIN.replace("  M1  m", "  M1  ID7k3m9q  m\n  M2  ID7k3m9q  m").replace(
      "VCC:  M1.VCC_OUT",
      "VCC:  M1.VCC_OUT  M2.VCC_OUT",
    );
    const root = makeProject(rootSchematic, MODULE, [{ id: "b", text: pcb("b", ["M1", "M2"]) }]);
    try {
      const duplicate = checkProject(root).diagnostics.filter((d) => d.code === "value.duplicate-instance-uid");
      expect(duplicate.length).toBeGreaterThan(0);
      expect(duplicate.every((d) => d.severity === "error")).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a project-root module row without a UID reports a warning", () => {
    const root = makeProject();
    try {
      const missing = checkProject(root).diagnostics.filter((d) => d.code === "value.instance-uid-missing");
      expect(missing).toHaveLength(1);
      expect(missing[0]!.severity).toBe("warning");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a line nobody sourced is a warning, not an error", () => {
    const root = makeProject();
    try {
      mkdirSync(join(root, "assets/procurement/primary"), { recursive: true });
      writeFileSync(join(root, "assets/procurement/primary", "b.teda"), procurement(""));
      const unsourced = checkProject(root).diagnostics.filter((d) => d.code === "value.procurement-generic-unsourced");
      expect(unsourced).toHaveLength(1);
      expect(unsourced[0]!.severity).toBe("warning");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a selection that satisfies the line is clean", () => {
    const root = makeProject();
    try {
      writeFileSync(join(root, "assets/components", "rc0402fr-0710kl.teda"), PART);
      mkdirSync(join(root, "assets/procurement/primary"), { recursive: true });
      writeFileSync(join(root, "assets/procurement/primary", "b.teda"), procurement("  res-thick-0402  10k  ±1%  ->  rc0402fr-0710kl"));
      expect(checkProject(root).diagnostics.filter((d) => d.code.startsWith("value.procurement-"))).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a part that changes the land pattern is an error in the primary", () => {
    const root = makeProject();
    try {
      writeFileSync(join(root, "assets/components", "rc0402fr-0710kl.teda"), PART.replace("footprint project:chip-0402", "footprint project:chip-0603"));
      mkdirSync(join(root, "assets/procurement/primary"), { recursive: true });
      writeFileSync(join(root, "assets/procurement/primary", "b.teda"), procurement("  res-thick-0402  10k  ±1%  ->  rc0402fr-0710kl"));
      const mismatch = checkProject(root).diagnostics.filter((d) => d.code === "bind.procurement-footprint-mismatch");
      expect(mismatch).toHaveLength(1);
      expect(mismatch[0]!.severity).toBe("error");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("the same broken selection is a warning in the alternatives", () => {
    const root = makeProject();
    try {
      writeFileSync(join(root, "assets/components", "rc0402fr-0710kl.teda"), PART.replace("footprint project:chip-0402", "footprint project:chip-0603"));
      mkdirSync(join(root, "assets/procurement/alternatives"), { recursive: true });
      writeFileSync(join(root, "assets/procurement/alternatives", "b.teda"), procurement("  res-thick-0402  10k  ±1%  ->  rc0402fr-0710kl", "alternatives"));
      const mismatch = checkProject(root).diagnostics.filter((d) => d.code === "bind.procurement-footprint-mismatch");
      expect(mismatch).toHaveLength(1);
      expect(mismatch[0]!.severity).toBe("warning");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a line marked not-required is not an unsourced line", () => {
    const root = makeProject();
    try {
      mkdirSync(join(root, "assets/procurement/primary"), { recursive: true });
      writeFileSync(join(root, "assets/procurement/primary", "b.teda"), procurement("  res-thick-0402  10k  ±1%  ->  not-required"));
      expect(checkProject(root).diagnostics.filter((d) => d.code === "value.procurement-generic-unsourced")).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("reports ref.unknown-component when a module component is not found", () => {
    const root = makeProject(MAIN, MODULE.replace("res-thick-0402", "no-such-part"));
    try {
      const diagnostic = checkProject(root).diagnostics.find((d) => d.code === "ref.unknown-component");
      expect(diagnostic).toBeDefined();
      expect(diagnostic?.severity).toBe("error");
      expect(diagnostic?.data).toMatchObject({ component_id: "no-such-part", refdes: "R1", module_instance_id: "M1" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("an unconnected module pin is a warning, not an error", () => {
    const root = makeProject();
    try {
      const result = checkProject(root);
      const diagnostic = result.diagnostics.find((d) => d.code === "net.pin-unassigned");
      expect(diagnostic?.severity).toBe("warning");
      expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("an unreadable component file counts as an error", () => {
    const root = makeProject();
    try {
      writeFileSync(join(root, "assets/components", "broken.teda"), "nonsense\n");
      const diagnostic = checkProject(root).diagnostics.find((d) => d.code === "syntax.header-invalid");
      expect(diagnostic).toBeDefined();
      expect(diagnostic?.severity).toBe("error");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("reports an error when the file-header id does not match the file name", () => {
    const root = makeProject();
    try {
      writeFileSync(join(root, "assets/components", "broken.teda"), COMPONENT.replace("component res-thick-0402", "component other"));
      const diagnostic = checkProject(root).diagnostics.find((d) => d.code === "ref.component-id-mismatch");
      expect(diagnostic?.severity).toBe("error");
      expect(diagnostic?.data).toEqual({ declared_id: "other", file_id: "broken" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a reference to a broken device file is not reported as a missing component", () => {
    const root = makeProject();
    try {
      writeFileSync(join(root, "assets/components", "res-thick-0402.teda"), COMPONENT.replace("construction thick", "construction thickh"));
      const result = checkProject(root);
      expect(result.diagnostics.find((d) => d.code === "ref.unknown-component")).toBeUndefined();
      const diagnostic = result.diagnostics.find((d) => d.code === "ref.component-invalid");
      expect(diagnostic?.severity).toBe("warning");
      expect(diagnostic?.data).toEqual({ component_id: "res-thick-0402", refdes: "R1", device_file: "assets/components/res-thick-0402.teda", module_instance_id: "M1" });
      expect(result.diagnostics.find((d) => d.code === "value.component-construction-invalid")?.severity).toBe("error");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("check (the project logical root composes modules)", () => {
  test("the module's instances are flattened with the module-instance prefix", () => {
    const root = makeProject();
    try {
      const result = analyzeProject(root);
      expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
      const ir = result.main.ir!;
      expect(ir.ir_version).toBe("0.19");
      expect(ir.project).toBe("main");
      expect(ir.instances.map((i) => i.id)).toEqual(["M1.R1"]);
      expect(ir.nets.map((n) => n.id)).toEqual(["VCC"]);
      expect(ir.nets[0]!.members).toEqual(["M1.R1.1"]);
      expect(result.pcbs.map((item) => item.pcb)).toEqual(["b"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a root referencing a module without a file is an error", () => {
    const root = makeProject(MAIN, null);
    try {
      const diagnostic = checkProject(root).diagnostics.find((d) => d.code === "ref.unknown-module");
      expect(diagnostic?.severity).toBe("error");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("project module ownership and explicit interconnects (ADR-0069)", () => {
  test("two PCBs can own complete module instances joined by an explicit root interconnect", () => {
    const root = makeProject(MAIN_TWO, MODULE, [
      { id: "b", text: pcb("b", ["M1"]) },
      { id: "c", text: pcb("c", ["M2"]) },
    ]);
    try {
      const result = checkProject(root);
      expect(result.pcbs).toEqual(["b", "c"]);
      expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
      expect(result.diagnostics.filter((d) => d.code === "bind.net-mismatch")).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a root module without a PCB owner is an error", () => {
    const root = makeProject(MAIN_TWO, MODULE, [
      { id: "b", text: pcb("b", ["M1"]) },
      { id: "c", text: pcb("c", []) },
    ]);
    try {
      const diagnostic = checkProject(root).diagnostics.find((d) => d.code === "bind.instance-unowned");
      expect(diagnostic?.severity).toBe("error");
      expect(diagnostic?.data).toMatchObject({ module_id: "M2" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a module instance claimed by two PCBs is an ownership error", () => {
    const root = makeProject(MAIN_TWO, MODULE, [
      { id: "b", text: pcb("b", ["M1", "M2"]) },
      { id: "c", text: pcb("c", ["M2"]) },
    ]);
    try {
      const duplicate = checkProject(root).diagnostics.find((d) => d.code === "bind.instance-split");
      expect(duplicate?.severity).toBe("error");
      expect(duplicate?.data).toMatchObject({ module_id: "M2", owners: 2 });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a PCB naming an unknown root module is an error", () => {
    const root = makeProject(MAIN_TWO, MODULE, [
      { id: "b", text: pcb("b", ["M1", "M9"], ["M1"]) },
      { id: "c", text: pcb("c", ["M2"]) },
    ]);
    try {
      const unknown = checkProject(root).diagnostics.find((d) => d.code === "ref.unknown-module-instance");
      expect(unknown?.severity).toBe("error");
      expect(unknown?.data).toMatchObject({ pcb: "b", module_id: "M9" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("placing a module's flattened instance on another PCB is rejected", () => {
    const root = makeProject(MAIN_TWO, MODULE, [
      { id: "b", text: pcb("b", ["M1"], ["M1"]) },
      { id: "c", text: pcb("c", ["M2"], ["M1", "M2"]) },
    ]);
    try {
      const misplaced = checkProject(root).diagnostics.find((d) => d.code === "bind.instance-not-owned");
      expect(misplaced?.severity).toBe("error");
      expect(misplaced?.data).toMatchObject({ instance_id: "M1.R1", pcb: "c" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("an interconnect naming an unknown endpoint module is rejected", () => {
    const schematic = MAIN_TWO.replace("ic1  M1.VCC_OUT  M2.VCC_OUT", "ic1  M1.VCC_OUT  M9.VCC_OUT");
    const root = makeProject(schematic, MODULE, [
      { id: "b", text: pcb("b", ["M1"]) },
      { id: "c", text: pcb("c", ["M2"]) },
    ]);
    try {
      expect(checkProject(root).diagnostics.some((d) => d.code === "ref.unknown-instance")).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("an interconnect naming an undeclared module port is rejected", () => {
    const schematic = MAIN_TWO.replace("ic1  M1.VCC_OUT  M2.VCC_OUT", "ic1  M1.VCC_OUT  M2.NO_SUCH_PORT");
    const root = makeProject(schematic, MODULE, [
      { id: "b", text: pcb("b", ["M1"]) },
      { id: "c", text: pcb("c", ["M2"]) },
    ]);
    try {
      expect(checkProject(root).diagnostics.some((d) => d.code === "ref.unknown-port")).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("an interconnect between different root nets is rejected", () => {
    const schematic = MAIN_TWO.replace("VCC:  M1.VCC_OUT  M2.VCC_OUT", "VCC:  M1.VCC_OUT\n  GND:  M2.VCC_OUT");
    const root = makeProject(schematic, MODULE, [
      { id: "b", text: pcb("b", ["M1"]) },
      { id: "c", text: pcb("c", ["M2"]) },
    ]);
    try {
      const mismatch = checkProject(root).diagnostics.find((d) => d.code === "bind.net-mismatch");
      expect(mismatch).toBeDefined();
      expect(mismatch?.severity).toBe("error");
      expect(mismatch?.data).toMatchObject({ interconnect: "ic1", net_a: "VCC", net_b: "GND" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("an interconnect whose endpoints share one PCB is rejected", () => {
    const root = makeProject(MAIN_TWO, MODULE, [{ id: "b", text: pcb("b", ["M1", "M2"]) }]);
    try {
      const mismatch = checkProject(root).diagnostics.find((d) => d.code === "bind.net-mismatch");
      expect(mismatch?.severity).toBe("error");
      expect(mismatch?.data).toMatchObject({ interconnect: "ic1", pcb: "b" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("equal local net names do not imply cross-PCB continuity", () => {
    const schematic = MAIN_TWO
      .replace("VCC:  M1.VCC_OUT  M2.VCC_OUT", "LEFT:  M1.VCC_OUT\n  RIGHT:  M2.VCC_OUT")
      .replace("\ninterconnects\n  ic1  M1.VCC_OUT  M2.VCC_OUT\n", "\n");
    const root = makeProject(schematic, MODULE, [
      { id: "b", text: pcb("b", ["M1"]) },
      { id: "c", text: pcb("c", ["M2"]) },
    ]);
    try {
      const result = analyzeProject(root);
      expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
      expect(result.main.ir?.interconnects).toBeUndefined();
      expect(result.main.ir?.nets.map((net) => net.id)).toEqual(["LEFT", "RIGHT"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("review rounds (ADR-0037)", () => {
  const ROUND = "# Review of project main, round 1\n\nTarget `board:b`. Roles: power.\n\n- power (2026-10-23): the rail has no margin.\n";

  function withReviews(root: string, owner: string | null, decision: string | null): void {
    if (owner !== null) writeFileSync(join(root, "project.toml"), `${PROJECT.replace('format = "0.9.1"', `format = "0.9.1"\nowner = "${owner}"`)}`);
    mkdirSync(join(root, "docs/reviews"), { recursive: true });
    writeFileSync(join(root, "docs/reviews", "b-sch-r1.md"), ROUND);
    if (decision !== null) writeFileSync(join(root, "docs/reviews", "b-sch-r1.decision.toml"), decision);
  }

  const decision = (owner: string) => `target = "board:b"\nowner = "${owner}"\ndate = "2026-10-23"\nverdict = "deferred"\n`;

  test("notes with no decision are reported, and the notes stay out of the exit code", () => {
    const root = makeProject();
    try {
      withReviews(root, "carol", null);
      const result = checkProject(root);
      const rounds = result.diagnostics.filter((d) => d.code === "review.round-unclosed");
      expect(rounds).toHaveLength(1);
      expect(rounds[0]!.data).toEqual({ round: "b-sch-r1", notes: 1, authors: "power" });
      expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a decision by the accountable person closes the round", () => {
    const root = makeProject();
    try {
      withReviews(root, "carol", decision("carol"));
      expect(checkProject(root).diagnostics.filter((d) => d.code.startsWith("review.")).length).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a decision by someone else is reported with both names", () => {
    const root = makeProject();
    try {
      withReviews(root, "carol", decision("dave"));
      const mismatch = checkProject(root).diagnostics.filter((d) => d.code === "review.owner-mismatch");
      expect(mismatch).toHaveLength(1);
      expect(mismatch[0]!.data).toEqual({ round: "b-sch-r1", decision_owner: "dave", project_owner: "carol" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("reviews without an owner cannot be closed", () => {
    const root = makeProject();
    try {
      withReviews(root, null, null);
      const missing = checkProject(root).diagnostics.filter((d) => d.code === "review.owner-missing");
      expect(missing).toHaveLength(1);
      expect(missing[0]!.severity).toBe("error");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("library curation (ADR-0006: the shard set is the project's content)", () => {
  test("a device file nothing uses is reported, not silently kept", () => {
    const root = makeProject();
    try {
      writeFileSync(join(root, "assets/components", "ldo-abandoned.teda"), COMPONENT.replace("component res-thick-0402", "component ldo-abandoned").replace("kind generic", "kind part\nmpn LDO1"));
      const unused = checkProject(root).diagnostics.filter((d) => d.code === "library.device-unused");
      expect(unused).toHaveLength(1);
      expect(unused[0]!.severity).toBe("warning");
      expect(unused[0]!.message).toContain("ldo-abandoned");
      expect(unused[0]!.location?.file).toBe("assets/components/ldo-abandoned.teda");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a device that only a procurement file names is in use", () => {
    const root = makeProject();
    try {
      writeFileSync(join(root, "assets/components", "rc0402-as-part.teda"), COMPONENT.replace("component res-thick-0402", "component rc0402-as-part").replace("kind generic\nconstruction thick\npolarized no", "kind part\nmpn RC0402FR-0710KL"));
      mkdirSync(join(root, "assets/procurement/alternatives"), { recursive: true });
      writeFileSync(join(root, "assets/procurement/alternatives", "b.teda"), procurement("res-thick-0402 10k -> rc0402-as-part", "alternatives"));
      expect(checkProject(root).diagnostics.filter((d) => d.code === "library.device-unused")).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a broken module does not turn its devices into false orphans", () => {
    const root = makeProject();
    try {
      writeFileSync(join(root, "design/sch/modules", "m.teda"), "nonsense\n");
      const result = checkProject(root);
      expect(result.diagnostics.some((d) => d.severity === "error")).toBe(true);
      expect(result.diagnostics.filter((d) => d.code === "library.device-unused")).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// The project's geometry is checked at the layer that reads it: every symbol and footprint file
// must compile and satisfy its contract. `ir` refuses to write a shard for a broken one, so a check
// that skipped them would go green while the build is red (ADR-0038 decision 7).
const SYMBOL = `version 0.11
symbol r

pins
  1  [-3.81,0]  0
  2  [3.81,0]   180
`;

const FOOTPRINT = `version 0.11
footprint chip-0402

package_code 0402

pads
  1  smd  roundrect  [-0.5,0]  [0.6,0.6]  rratio=0.25
  2  smd  roundrect  [0.5,0]   [0.6,0.6]  rratio=0.25
`;

function writeGeometry(root: string, symbol: string = SYMBOL, footprint: string = FOOTPRINT): void {
  mkdirSync(join(root, "assets/symbols/project"), { recursive: true });
  mkdirSync(join(root, "assets/footprints/project"), { recursive: true });
  writeFileSync(join(root, "assets/symbols/project", "r.teda"), symbol);
  writeFileSync(join(root, "assets/footprints/project", "chip-0402.teda"), footprint);
}

describe("check: the geometry it reads", () => {
  test("geometry that compiles adds no diagnostic", () => {
    const root = makeProject();
    try {
      writeGeometry(root);
      const result = checkProject(root);
      expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
      expect(result.diagnostics.filter((d) => d.code === "library.pins-empty" || d.code === "library.pads-empty")).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("an incomplete symbol is an error, not a silent skip", () => {
    const root = makeProject();
    try {
      writeGeometry(root, "version 0.11\nsymbol r\n");
      const codes = checkProject(root).diagnostics.filter((d) => d.severity === "error").map((d) => d.code);
      expect(codes).toContain("library.pins-empty");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a footprint that does not compile is an error, not a silent skip", () => {
    const root = makeProject();
    try {
      writeGeometry(root, undefined, "version 0.11\nfootprint chip-0402\npads\n");
      const codes = checkProject(root).diagnostics.filter((d) => d.severity === "error").map((d) => d.code);
      expect(codes).toContain("library.pads-empty");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
