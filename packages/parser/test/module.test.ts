// Unit tests for the module layer (spec/module.md, ADR-0026).
//
// A board composes modules; a module owns its refdes and net names and exposes them through ports.
// The IR stays flat: the module's instances and nets carry the `M` prefix, and a port merges the
// module's net into a board-level net.
//
// Positive cases use minimal inline sources; negative cases break exactly one thing and the
// diagnostic code must line up.
import { describe, expect, test } from "bun:test";
import { parseSchematic, type ModuleSource } from "../src/schematic.ts";
import { loadResolver } from "./project.ts";

const resolver = loadResolver();

/** A module with two resistors: one net (VCC) with a port, one net (IN) without. */
const moduleText = [
  "version 0.8",
  "module m1",
  "",
  "instances",
  "  R1  r-0402  10k",
  "  R2  r-0402  10k",
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

/** A board that instantiates the module and binds its port. */
const boardText = [
  "version 0.8",
  "schematic b",
  "",
  "modules",
  "  M1  m1",
  "",
  "instances",
  "  R9  r-0402  10k",
  "",
  "nets",
  "  VCC:  M1.VCC_OUT  R9.1",
  "",
  "ports",
  "  VCC_3V3  VCC",
  "",
].join("\n");

function moduleSource(moduleId: string, text = moduleText): ModuleSource {
  return { moduleId, file: `modules/${moduleId}.teda`, text };
}

function parse(board: string, modules: ModuleSource[] = [moduleSource("m1")]) {
  return parseSchematic(board, { file: "sch/b.teda", board: "b", components: resolver, modules });
}

describe("module composition", () => {
  const result = parse(boardText);

  test("no error diagnostics", () => {
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.ok).toBe(true);
  });

  test("the module's instances carry the module instance id", () => {
    expect(result.ir!.instances.map((i) => i.id)).toEqual(["M1.R1", "M1.R2", "R9"]);
  });

  test("a net without a port keeps its qualified name", () => {
    const net = result.ir!.nets.find((n) => n.id === "M1.IN")!;
    expect(net.members).toEqual(["M1.R1.1"]);
  });

  test("a port merges the module's net into the board's net", () => {
    const net = result.ir!.nets.find((n) => n.id === "VCC")!;
    expect(net.members).toEqual(["M1.R1.2", "M1.R2.1", "R9.1"]);
    // The module's own name is gone: the board's net took its place.
    expect(result.ir!.nets.map((n) => n.id)).not.toContain("M1.VCC");
  });

  test("the module's constraint lands on the net it constrains", () => {
    // VCC was merged into the board's net, so the constraint names the board's net.
    expect(result.ir!.constraints).toEqual([
      { type: "voltage", subject: "VCC", min_uv: 3_000_000, max_uv: 3_600_000 },
    ]);
  });

  test("a constraint on an unmerged net keeps the qualified name", () => {
    const board = boardText.replace(
      "  voltage  VCC  3.0V..3.6V",
      "  voltage  VCC  3.0V..3.6V\n  voltage  IN   0V..1V",
    );
    const module = moduleSource("m1", moduleText.replace(
      "  voltage  VCC  3.0V..3.6V",
      "  voltage  VCC  3.0V..3.6V\n  voltage  IN   0V..1V",
    ));
    const result = parse(board, [module]);
    expect(result.ir!.constraints).toContainEqual({
      type: "voltage",
      subject: "M1.IN",
      min_uv: 0,
      max_uv: 1_000_000,
    });
  });
});

describe("module diagnostics", () => {
  test("a module id without a file", () => {
    const result = parse(boardText, []);
    expect(result.diagnostics.map((d) => d.code)).toContain("ref.unknown-module");
  });

  test("a module whose header id does not match the file name", () => {
    // The file is modules/other.teda, but its header declares `module m1`.
    const board = boardText.replace("  M1  m1", "  M1  other");
    const result = parse(board, [moduleSource("other", moduleText)]);
    expect(result.diagnostics.map((d) => d.code)).toContain("ref.module-id-mismatch");
  });

  test("a board net naming a port the module does not declare", () => {
    const board = boardText.replace("M1.VCC_OUT", "M1.NOPE");
    const result = parse(board);
    expect(result.diagnostics.map((d) => d.code)).toContain("ref.unknown-port");
  });

  test("a module port that no board net binds", () => {
    const board = boardText.replace("  VCC:  M1.VCC_OUT  R9.1", "  VCC:  R9.1");
    const result = parse(board);
    expect(result.diagnostics.map((d) => d.code)).toContain("ref.unbound-port");
  });

  test("a module port bound to two board nets", () => {
    const board = boardText.replace(
      "  VCC:  M1.VCC_OUT  R9.1",
      "  VCC:  M1.VCC_OUT  R9.1\n  VCC2: M1.VCC_OUT",
    );
    const result = parse(board);
    expect(result.diagnostics.map((d) => d.code)).toContain("net.port-in-two-nets");
  });

  test("a board net reaching into a module's internals", () => {
    const board = boardText.replace("M1.VCC_OUT", "M1.R1.2");
    const result = parse(board);
    expect(result.diagnostics.map((d) => d.code)).toContain("ref.module-internal-ref");
  });

  test("a board refdes taking the module instance form", () => {
    const board = boardText.replace("  R9  r-0402  10k", "  M1  r-0402  10k");
    const result = parse(board);
    expect(result.diagnostics.map((d) => d.code)).toContain("syntax.invalid-identifier");
  });

  test("a module instance id that is not M plus digits", () => {
    const board = boardText.replace("  M1  m1", "  X1  m1");
    const result = parse(board);
    expect(result.diagnostics.map((d) => d.code)).toContain("syntax.invalid-identifier");
  });

  test("a module file below the language version that introduced the type", () => {
    const result = parse(boardText, [moduleSource("m1", moduleText.replace("version 0.8", "version 0.7"))]);
    expect(result.diagnostics.map((d) => d.code)).toContain("format.unsupported-version");
  });

  test("a module that contains modules: the hierarchy is one level deep", () => {
    const nested = moduleText.replace(
      "instances",
      "modules\n  M9  other\n\ninstances",
    );
    const result = parse(boardText, [moduleSource("m1", nested)]);
    expect(result.diagnostics.map((d) => d.code)).toContain("syntax.unknown-section");
  });

  test("a port declared no_connect needs no board net", () => {
    const module = moduleSource(
      "m1",
      moduleText.replace("  VCC_OUT  VCC", "  VCC_OUT  VCC\n  SPARE    no_connect"),
    );
    const result = parse(boardText, [module]);
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });

  test("a board net binding a no_connect port", () => {
    const module = moduleSource(
      "m1",
      moduleText.replace("  VCC_OUT  VCC", "  VCC_OUT  VCC\n  SPARE    no_connect"),
    );
    const board = boardText.replace("  VCC:  M1.VCC_OUT  R9.1", "  VCC:  M1.VCC_OUT  R9.1\n  X:  M1.SPARE");
    const result = parse(board, [module]);
    expect(result.diagnostics.map((d) => d.code)).toContain("ref.no-connect-port");
  });

  test("two module ports on one net inside the module", () => {
    const module = moduleSource("m1", moduleText.replace("  VCC_OUT  VCC", "  VCC_OUT  VCC\n  VCC2     VCC"));
    const result = parse(boardText, [module]);
    expect(result.diagnostics.map((d) => d.code)).toContain("ref.duplicate-port-net");
  });

  test("a module instance can be instantiated twice", () => {
    const board = boardText
      .replace("  M1  m1", "  M1  m1\n  M2  m1")
      .replace("  VCC:  M1.VCC_OUT  R9.1", "  VCC:  M1.VCC_OUT  M2.VCC_OUT  R9.1");
    const result = parse(board);
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.ir!.instances.map((i) => i.id)).toEqual(["M1.R1", "M1.R2", "M2.R1", "M2.R2", "R9"]);
  });
});
