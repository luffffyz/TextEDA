// Unit tests for module composition beneath the project schematic root (ADR-0013, ADR-0069).
//
// Component instances and local nets belong to modules. The project root binds declared module
// ports into project nets and records explicit interconnects separately from net membership.
// Positive cases use minimal inline sources; negative cases break one contract at a time.
import { describe, expect, test } from "bun:test";
import { parseSchematic, type ModuleSource } from "../src/schematic.ts";
import { loadResolver } from "./project.ts";

const resolver = loadResolver();

/** One module with an internal net and a two-pin project port. */
const moduleText = [
  "version 0.14.0",
  "module power",
  "",
  "instances",
  "  R1  res-thick-0402  10k  ±1%",
  "  R2  res-thick-0402  10k  ±1%",
  "",
  "nets",
  "  IN:   R1.1",
  "  VCC:  R1.2  R2.1",
  "",
  "ports",
  "  VCC_OUT  VCC",
  "",
  "constraints",
  "  voltage  VCC  3.0V..3.6V",
  "",
].join("\n");

/** Two module instances merge their declared ports into one project net. */
const projectText = [
  "version 0.14.0",
  "schematic main",
  "",
  "modules",
  "  M1  power",
  "  M2  power",
  "",
  "nets",
  "  VCC:  M1.VCC_OUT  M2.VCC_OUT",
  "",
  "ports",
  "  VCC_3V3  VCC",
  "",
  "interconnects",
  "  link1  M1.VCC_OUT  M2.VCC_OUT",
  "",
  "interconnect_pins",
  "  link1  M1.R1.2  M2.R1.2",
  "",
].join("\n");

function moduleSource(moduleId: string, text = moduleText): ModuleSource {
  return { moduleId, file: `design/sch/modules/${moduleId}.teda`, text };
}

function parse(project: string, modules: ModuleSource[] = [moduleSource("power")]) {
  return parseSchematic(project, {
    file: "design/sch/main.teda",
    components: resolver,
    modules,
  });
}

describe("project module composition", () => {
  const result = parse(projectText, [moduleSource("power")]);

  test("no error diagnostics and a valid project root", () => {
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.ir!.project).toBe("main");
    expect(result.ir!.format).toBe("0.14");
  });

  test("module instances own every flattened component instance", () => {
    expect(result.ir!.instances.map((i) => i.id)).toEqual([
      "M1.R1",
      "M1.R2",
      "M2.R1",
      "M2.R2",
    ]);
    expect(result.modules!.map((m) => [m.instance_id, m.module_id])).toEqual([
      ["M1", "power"],
      ["M2", "power"],
    ]);
  });

  test("unbound module-local nets keep their qualified names", () => {
    expect(result.ir!.nets.find((n) => n.id === "M1.IN")!.members).toEqual(["M1.R1.1"]);
    expect(result.ir!.nets.find((n) => n.id === "M2.IN")!.members).toEqual(["M2.R1.1"]);
  });

  test("module ports merge into a project net and retain their flattened pins", () => {
    const net = result.ir!.nets.find((n) => n.id === "VCC")!;
    expect(net.members).toEqual(["M1.R1.2", "M1.R2.1", "M2.R1.2", "M2.R2.1"]);
    expect(result.ir!.nets.map((n) => n.id)).not.toContain("M1.VCC");
    expect(result.modules!.map((module) => module.ports[0])).toEqual([
      { id: "VCC_OUT", net: "VCC", pins: ["M1.R1.2", "M1.R2.1"] },
      { id: "VCC_OUT", net: "VCC", pins: ["M2.R1.2", "M2.R2.1"] },
    ]);
  });

  test("module constraints resolve to the project net they constrain", () => {
    expect(result.ir!.constraints).toContainEqual({
      type: "voltage",
      subject: "VCC",
      min_uv: 3_000_000,
      max_uv: 3_600_000,
    });
  });

  test("root ports and explicit interconnect facts remain distinct", () => {
    expect(result.ir!.ports).toEqual([{ id: "VCC_3V3", net: "VCC" }]);
    expect(result.ir!.interconnects).toEqual([
      { id: "link1", from: "M1.VCC_OUT", to: "M2.VCC_OUT" },
    ]);
    expect(result.ir!.interconnect_pins).toEqual([
      { interconnect: "link1", from: "M1.R1.2", to: "M2.R1.2" },
    ]);
  });

  test("an unmerged module constraint keeps its qualified local net", () => {
    const module = moduleSource(
      "power",
      moduleText.replace(
        "  voltage  VCC  3.0V..3.6V",
        "  voltage  VCC  3.0V..3.6V\n  voltage  IN   0V..1V",
      ),
    );
    const result = parse(projectText, [module]);
    expect(result.ir!.constraints).toContainEqual({
      type: "voltage",
      subject: "M1.IN",
      min_uv: 0,
      max_uv: 1_000_000,
    });
  });
});

describe("module and interconnect diagnostics", () => {
  test("a module id without a corresponding file", () => {
    const result = parse(projectText, []);
    expect(result.diagnostics.map((d) => d.code)).toContain("ref.unknown-module");
  });

  test("a module header id must match its file id", () => {
    const project = projectText.replace("  M1  power", "  M1  other");
    const result = parse(project, [moduleSource("other")]);
    expect(result.diagnostics.map((d) => d.code)).toContain("ref.module-id-mismatch");
  });

  test("a project net naming a port the module does not declare", () => {
    const project = projectText.replace("M1.VCC_OUT", "M1.NOPE");
    const result = parse(project);
    expect(result.diagnostics.map((d) => d.code)).toContain("ref.unknown-port");
  });

  test("a module port that no project net binds", () => {
    const project = projectText.replace("  VCC:  M1.VCC_OUT  M2.VCC_OUT", "  VCC:  M2.VCC_OUT");
    const result = parse(project);
    expect(result.diagnostics.map((d) => d.code)).toContain("ref.unbound-port");
  });

  test("a module port cannot belong to two project nets", () => {
    const project = projectText.replace(
      "  VCC:  M1.VCC_OUT  M2.VCC_OUT",
      "  VCC:  M1.VCC_OUT  M2.VCC_OUT\n  OTHER: M1.VCC_OUT",
    );
    const result = parse(project);
    expect(result.diagnostics.map((d) => d.code)).toContain("net.port-in-two-nets");
  });

  test("a project net cannot reach into a module's internals", () => {
    const project = projectText.replace("M1.VCC_OUT", "M1.R1.2");
    const result = parse(project);
    expect(result.diagnostics.map((d) => d.code)).toContain("ref.module-internal-ref");
  });

  test("root-level component instances are not permitted", () => {
    const project = projectText.replace("\ninterconnects\n", "\ninstances\n  R9  res-thick-0402  10k  ±1%\n\ninterconnects\n");
    const result = parse(project);
    expect(result.diagnostics.map((d) => d.code)).toContain("syntax.unknown-section");
  });

  test("a module instance id is an M-number", () => {
    const project = projectText.replace("  M1  power", "  X1  power");
    const result = parse(project);
    expect(result.diagnostics.map((d) => d.code)).toContain("syntax.invalid-identifier");
  });

  test("module definitions below their type's language floor are rejected", () => {
    const result = parse(projectText, [moduleSource("power", moduleText.replace("version 0.14.0", "version 0.7"))]);
    expect(result.diagnostics.map((d) => d.code)).toContain("format.unsupported-version");
  });

  test("a module cannot contain another modules section", () => {
    const nested = moduleText.replace("instances", "modules\n  M9  other\n\ninstances");
    const result = parse(projectText, [moduleSource("power", nested)]);
    expect(result.diagnostics.map((d) => d.code)).toContain("syntax.unknown-section");
  });

  test("a no_connect module port needs no project net", () => {
    const module = moduleSource("power", moduleText.replace("  VCC_OUT  VCC", "  VCC_OUT  VCC\n  SPARE    no_connect"));
    const result = parse(projectText, [module]);
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.modules![0]!.ports.find((p) => p.id === "SPARE")).toEqual({ id: "SPARE", pins: [] });
  });

  test("a project net cannot bind a no_connect module port", () => {
    const module = moduleSource("power", moduleText.replace("  VCC_OUT  VCC", "  VCC_OUT  VCC\n  SPARE    no_connect"));
    const project = projectText.replace("  VCC:  M1.VCC_OUT  M2.VCC_OUT", "  VCC:  M1.VCC_OUT  M2.VCC_OUT\n  X:    M1.SPARE");
    const result = parse(project, [module]);
    expect(result.diagnostics.map((d) => d.code)).toContain("ref.no-connect-port");
  });

  test("two module ports cannot expose the same module net", () => {
    const module = moduleSource("power", moduleText.replace("  VCC_OUT  VCC", "  VCC_OUT  VCC\n  VCC2     VCC"));
    const result = parse(projectText, [module]);
    expect(result.diagnostics.map((d) => d.code)).toContain("ref.duplicate-port-net");
  });

  test("an interconnect's endpoints must belong to the same project net", () => {
    const moduleText2 = moduleText.replace("module power", "module other").replace("  VCC_OUT  VCC", "  VCC_OUT  VCC\n  IN_PORT  IN");
    const project = projectText
      .replace("M2  power", "M2  other")
      .replace("  VCC:  M1.VCC_OUT  M2.VCC_OUT", "  VCC:  M1.VCC_OUT  M2.VCC_OUT\n  IN:   M2.IN_PORT")
      .replace("link1  M1.VCC_OUT  M2.VCC_OUT", "link1  M1.VCC_OUT  M2.IN_PORT");
    const result = parse(project, [moduleSource("power"), moduleSource("other", moduleText2)]);
    expect(result.diagnostics.map((d) => d.code)).toContain("value.invalid-value");
  });

  test("an interconnect cannot connect two ports on one module instance", () => {
    const module = moduleText.replace("  VCC_OUT  VCC", "  VCC_OUT  VCC\n  IN_PORT  IN");
    const project = projectText.replace("link1  M1.VCC_OUT  M2.VCC_OUT", "link1  M1.VCC_OUT  M1.VCC_OUT");
    const result = parse(project, [moduleSource("power", module)]);
    expect(result.diagnostics.map((d) => d.code)).toContain("value.invalid-value");
  });

  test("an interconnect pin mapping must belong to each endpoint port net", () => {
    const project = projectText.replace("link1  M1.R1.2  M2.R1.2", "link1  M1.R1.1  M2.R1.2");
    const result = parse(project);
    expect(result.diagnostics.map((d) => d.code)).toContain("ref.pin-off-endpoint-net");
  });

  test("a module definition can be instantiated more than once", () => {
    expect(parse(projectText).diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(parse(projectText).ir!.instances.map((i) => i.id)).toEqual([
      "M1.R1",
      "M1.R2",
      "M2.R1",
      "M2.R2",
    ]);
  });
});
