// Project-root schematic parser tests (ADR-0069).
//
// The root owns project nets, ports, constraints and interconnects; module files own every
// component instance and internal net. Test-only flat-module sources keep focused parser cases
// small while passing them through a real `schematic main` composition.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validate } from "@texteda/ir";
import {
  parseSchematic,
  parseSchematicDocument,
  type ModuleSource,
} from "../src/schematic.ts";
import { loadResolver } from "./project.ts";

const projectDir = "examples/reference-project";

const resolver = loadResolver();

const rootFile = "design/sch/main.teda";
const rootText = readFileSync(join(projectDir, rootFile), "utf8");
const rootDoc = parseSchematicDocument(rootText, { file: rootFile }).doc!;
const referenceModules: ModuleSource[] = [...new Set(rootDoc.modules.map((row) => row.moduleId))].map((moduleId) => ({
  moduleId,
  file: `design/sch/modules/${moduleId}.teda`,
  text: readFileSync(join(projectDir, "design/sch/modules", `${moduleId}.teda`), "utf8"),
}));
const referenceResult = parseSchematic(rootText, {
  file: rootFile,
  components: resolver,
  modules: referenceModules,
});

const testRootFile = "design/sch/main.teda";

/** Compose a focused module parser case under the valid project schematic root. */
function parseFlatModule(
  sourceText: string,
  components: Parameters<typeof parseSchematic>[1]["components"] = resolver,
) {
  const moduleText = sourceText;
  const moduleFile = "design/sch/modules/test.teda";
  const doc = parseSchematicDocument(moduleText, { file: moduleFile, kind: "module" }).doc;
  const netNames = new Set<string>();
  const ports = doc?.ports ?? [];
  if (doc) {
    for (const net of doc.nets) netNames.add(net.name);
    for (const bus of doc.buses) {
      for (const member of bus.members) netNames.add(`${bus.id}.${member.member}`);
    }
  }
  const orderedNetNames = [...netNames].sort();

  // Root net IDs cannot contain the dot used by module bus-member identities. Keep ordinary
  // names unchanged, and give qualified bus members deterministic legal aliases at the root.
  const rootNetIds = new Map<string, string>();
  const usedRootNetIds = new Set<string>();
  for (const net of orderedNetNames) {
    const base = /^[A-Za-z0-9_+-]+$/.test(net) ? net : net.replace(/[^A-Za-z0-9_+-]/g, "_");
    let alias = base;
    let suffix = 2;
    while (usedRootNetIds.has(alias)) alias = `${base}_${suffix++}`;
    usedRootNetIds.add(alias);
    rootNetIds.set(net, alias);
  }

  const portForNet = new Map<string, string>();
  const usedPortIds = new Set<string>();
  for (const port of ports) {
    if (/^[A-Za-z0-9_+-]+$/.test(port.id)) usedPortIds.add(port.id);
    if (/^[A-Za-z0-9_+-]+$/.test(port.id) && port.net !== "no_connect" && netNames.has(port.net) && !portForNet.has(port.net)) {
      portForNet.set(port.net, port.id);
    }
  }
  const generatedPorts: string[] = [];
  let nextPort = 1;
  for (const net of orderedNetNames) {
    if (portForNet.has(net)) continue;
    let id = `T${nextPort++}`;
    while (usedPortIds.has(id)) id = `T${nextPort++}`;
    usedPortIds.add(id);
    portForNet.set(net, id);
    generatedPorts.push(`  ${id}  ${net}`);
  }
  const composedModuleText = generatedPorts.length === 0
    ? moduleText
    : `${moduleText.trimEnd()}\n\nports\n${generatedPorts.join("\n")}\n`;
  const rootRows = [...portForNet].map(([net, port]) => `  ${rootNetIds.get(net)!}:  M1.${port}`);
  const projectPorts = ports
    .filter((port) => /^[A-Za-z0-9_+-]+$/.test(port.id) && port.net !== "no_connect" && netNames.has(port.net))
    .map((port) => `  ${port.id}  ${rootNetIds.get(port.net)!}`);
  const projectText = [
    "version 0.14.0",
    "schematic main",
    "",
    "modules",
    "  M1  test",
    ...(rootRows.length > 0 ? ["", "nets", ...rootRows] : []),
    ...(projectPorts.length > 0 ? ["", "ports", ...projectPorts] : []),
    "",
  ].join("\n");
  return parseSchematic(projectText, {
    file: testRootFile,
    components,
    modules: [{ moduleId: "test", file: moduleFile, text: composedModuleText }],
  });
}
describe("project schematic root (ADR-0069)", () => {
  const result = referenceResult;

  test("parses the one project root without error diagnostics", () => {
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.ok).toBe(true);
    expect(validate("schematic", result.ir).errors).toEqual([]);
  });

  test("the root has project identity and the current language format", () => {
    expect(result.ir!.project).toBe("main");
    expect(result.ir!.format).toBe("0.14");
    expect(result.modules!.length).toBeGreaterThan(0);
  });

  test("module ownership and flattened instance identities are explicit", () => {
    const ir = result.ir!;
    for (const module of result.modules!) {
      expect(module.instance_id).toMatch(/^M\d+$/);
      const instances = ir.instances.filter((instance) => instance.id.startsWith(`${module.instance_id}.`));
      expect(instances.length).toBeGreaterThan(0);
      expect(instances.every((instance) => instance.id.startsWith(`${module.instance_id}.`))).toBe(true);
    }
    expect(ir.instances.every((instance) => /^M\d+\./.test(instance.id))).toBe(true);
  });

  test("flattened pin membership carries its owning module instance", () => {
    expect(result.ir!.nets.length).toBeGreaterThan(0);
    for (const net of result.ir!.nets) {
      expect(net.members.every((member) => /^M\d+\./.test(member))).toBe(true);
    }
  });

  test("module port facts retain their pins and project-net bindings", () => {
    for (const module of result.modules!) {
      for (const port of module.ports) {
        expect(Array.isArray(port.pins)).toBe(true);
        expect(port.pins.every((pin) => pin.startsWith(`${module.instance_id}.`))).toBe(true);
        if (port.net !== undefined) {
          const net = result.ir!.nets.find((candidate) => candidate.id === port.net)!;
          for (const pin of port.pins) expect(net.members).toContain(pin);
        }
      }
    }
  });

  test("root-owned constraints and ports use project net identities", () => {
    for (const constraint of result.ir!.constraints ?? []) {
      const subject = "subject" in constraint ? constraint.subject : undefined;
      if (subject !== undefined && !subject.startsWith("M")) {
        expect(result.ir!.nets.some((net) => net.id === subject)).toBe(true);
      }
    }
    for (const port of result.ir!.ports ?? []) {
      expect(result.ir!.nets.some((net) => net.id === port.net)).toBe(true);
    }
  });
});

describe("module facts (spec/module.md §7.2)", () => {
  test("a project with no modules has an empty facts list", () => {
    const plain = parseSchematic("version 0.14.0\nschematic main\n", {
      file: rootFile,
      components: resolver,
    });
    expect(plain.modules).toEqual([]);
  });

  describe("module port pin facts", () => {
    const moduleText = [
      "version 0.14.0",
      "module m1",
      "",
      "instances",
      "  R1  res-thick-0402  10k  ±1%",
      "",
      "nets",
      "  VCC:  R1.1",
      "  AUX:  R1.2",
      "",
      "ports",
      "  BOUND  VCC",
      "  SPARE  no_connect",
      "  LOOSE  AUX",
      "",
    ].join("\n");
    const projectText = [
      "version 0.14.0",
      "schematic main",
      "",
      "modules",
      "  M1  m1",
      "",
      "nets",
      "  VCC:  M1.BOUND",
      "",
    ].join("\n");
    const facts = parseSchematic(projectText, {
      file: rootFile,
      components: resolver,
      modules: [{ moduleId: "m1", file: "design/sch/modules/m1.teda", text: moduleText }],
    });

    test("every declared port has complete flattened pins", () => {
      expect(facts.modules![0]!.ports).toEqual([
        { id: "BOUND", net: "VCC", pins: ["M1.R1.1"] },
        { id: "LOOSE", pins: ["M1.R1.2"] },
        { id: "SPARE", pins: [] },
      ]);
    });

    test("an unbound port remains a diagnostic without losing its pins", () => {
      expect(facts.diagnostics.map((d) => d.code)).toContain("ref.unbound-port");
      expect(facts.modules![0]!.ports.find((port) => port.id === "LOOSE")).toEqual({
        id: "LOOSE",
        pins: ["M1.R1.2"],
      });
    });
  });
});


describe("stable instance UIDs (ADR-0010)", () => {
  const flatModule = (rows: string) => [
    "version 0.14.0",
    "module test",
    "",
    "instances",
    ...rows.split("\n"),
    "",
    "nets",
    "  A:  R1.1",
    "  B:  R1.2",
  ].join("\n");

  test("a module instance row carries its UID into the IR", () => {
    const result = parseFlatModule(flatModule("  R1  ID7k3m9q  res-thick-0402  10k  ±1%"));
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.ir!.instances[0]!.uid).toBe("ID7k3m9q");
    expect(result.ir!.instances[0]!.id).toBe("M1.R1");
  });

  test("a module-local UID is path-qualified by the module instance UID", () => {
    const moduleText = [
      "version 0.14.0",
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
    const projectText = [
      "version 0.14.0",
      "schematic main",
      "",
      "modules",
      "  M1  IDp8x2n4  m",
      "  M2  IDq4m7sc  m",
      "",
      "nets",
      "  A:  M1.P  M2.P",
    ].join("\n");
    const composed = parseSchematic(projectText, {
      file: rootFile,
      components: resolver,
      modules: [{ moduleId: "m", file: "design/sch/modules/m.teda", text: moduleText }],
    });
    expect(composed.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const m1 = composed.ir!.instances.find((i) => i.id === "M1.R1")!;
    const m2 = composed.ir!.instances.find((i) => i.id === "M2.R1")!;
    expect(m1.uid).toBe("IDp8x2n4/ID7k3m9q");
    expect(m2.uid).toBe("IDq4m7sc/ID7k3m9q");
  });

  test("a module-local UID stays bare when the module instance has no UID", () => {
    const moduleText = [
      "version 0.14.0",
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
    const projectText = [
      "version 0.14.0",
      "schematic main",
      "",
      "modules",
      "  M1  m",
      "",
      "nets",
      "  A:  M1.P",
    ].join("\n");
    const composed = parseSchematic(projectText, {
      file: rootFile,
      components: resolver,
      modules: [{ moduleId: "m", file: "design/sch/modules/m.teda", text: moduleText }],
    });
    expect(composed.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(composed.ir!.instances.find((i) => i.id === "M1.R1")!.uid).toBe("ID7k3m9q");
  });

  test("a duplicate UID in one module file is an error", () => {
    const result = parseFlatModule(
      flatModule("  R1  ID7k3m9q  res-thick-0402  10k  ±1%\n  R2  ID7k3m9q  res-thick-0402  1k  ±1%"),
    );
    expect(result.diagnostics.map((d) => d.code)).toContain("value.duplicate-instance-uid");
  });

  test("a malformed UID is a syntax error", () => {
    const result = parseFlatModule(flatModule("  R1  ID7K3M9Q  res-thick-0402  10k  ±1%"));
    expect(result.diagnostics.map((d) => d.code)).toContain("syntax.invalid-identifier");
  });

  test("a missing UID warns in current and older supported module files", () => {
    const current = parseFlatModule(flatModule("  R1  res-thick-0402  10k  ±1%"));
    expect(current.diagnostics.map((d) => d.code)).toContain("value.instance-uid-missing");
    const older = parseFlatModule(
      "version 0.8\nmodule test\n\ninstances\n  R1  res-thick-0402  10k  ±1%\n\nnets\n  A:  R1.1\n  B:  R1.2\n",
    );
    expect(older.diagnostics.map((d) => d.code)).toContain("value.instance-uid-missing");
  });

  test("a UID below language 0.9 is rejected", () => {
    const result = parseFlatModule(
      "version 0.8\nmodule test\n\ninstances\n  R1  ID7k3m9q  res-thick-0402  10k  ±1%\n\nnets\n  A:  R1.1\n  B:  R1.2\n",
    );
    expect(result.diagnostics.map((d) => d.code)).toContain("format.unsupported-version");
  });
});

describe("constraint types", () => {
  const text = [
    "version 0.14.0",
    "module test",
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
  const result = parseFlatModule(text);

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
    const result2 = parseFlatModule(bad);
    expect(result2.diagnostics.map((d) => d.code)).toContain("ref.unknown-net");
  });

  test("errors when a range's lower bound exceeds its upper bound", () => {
    const bad = text.replace("0.5mm..2mm", "2mm..0.5mm");
    const result2 = parseFlatModule(bad);
    expect(result2.diagnostics.some((d) => d.message.includes("lower bound exceeds upper bound"))).toBe(true);
  });
});

describe("row order", () => {
  // The IR depends on the semantics only: where a row was written is not part of it, and neither
  // is the order of the rows (spec/teda.md §12; ADR-0004 D1 removed the last field that leaked it).
  const source = [
    "version 0.14.0",
    "module test",
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
    "version 0.14.0",
    "module test",
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
    const a = parseFlatModule(source);
    const b = parseFlatModule(shuffled);
    expect(b.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(JSON.stringify(b.ir)).toBe(JSON.stringify(a.ir));
  });
});

describe("negative cases", () => {
  const moduleText = ["version 0.14.0", "module test", "", "instances", "  R1  res-thick-0402  10k  ±1%", "", "nets", "  A:  R1.1"].join("\n");

  function codes(text: string, components: Parameters<typeof parseSchematic>[1]["components"] = resolver): string[] {
    return parseFlatModule(text, components).diagnostics.map((d) => d.code);
  }

  test("component not found", () => {
    expect(codes(moduleText.replace("res-thick-0402", "no-such-part"))).toContain("ref.unknown-component");
  });

  test("diagnostics carry machine-usable data (ADR-0003)", () => {
    const result = parseFlatModule(moduleText.replace("res-thick-0402", "no-such-part"));
    const diagnostic = result.diagnostics.find((d) => d.code === "ref.unknown-component")!;
    expect(diagnostic.data).toEqual({ component_id: "no-such-part", module_instance_id: "M1", refdes: "R1" });
  });

  test("duplicate refdes", () => {
    const text = moduleText.replace("nets", "  R1  res-thick-0402  10k  ±1%\n\nnets");
    expect(codes(text)).toContain("ref.duplicate-refdes");
  });

  test("parameter column count does not match the component declaration", () => {
    expect(codes(moduleText.replace("10k", "10k 1% 2W 3X"))).toContain("value.param-count-mismatch");
  });

  test("a row that fails against a declaration names the declaration (ADR-0004 D5)", () => {
    const result = parseFlatModule(moduleText.replace("10k", "10k 1% 2W 3X"));
    const diagnostic = result.diagnostics.find((d) => d.code === "value.param-count-mismatch")!;
    // The row is the place to fix; the declaration is the file that decides how many columns there are.
    expect(diagnostic.location).toMatchObject({ file: "design/sch/modules/test.teda", line: 5 });
    const related = diagnostic.related ?? [];
    expect(related).toHaveLength(1);
    expect(related[0]!.file).toContain("res-thick-0402.teda");
    expect(related[0]!.line).toBeGreaterThan(1);
  });

  test("parameter value is not a value of that quantity", () => {
    expect(codes(moduleText.replace("10k", "10V"))).toContain("value.invalid-param");
  });

  test("a code-valued parameter outside its closed value set is an error (ADR-0025)", () => {
    // The dielectric is a code, not a quantity: the spelling is exact, because two spellings of
    // one code would be two BOM lines.
    const text = [
      "version 0.14.0",
      "module test",
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
    expect(codes(moduleText.replace("R1.1", "R1.9"))).toContain("net.member-unknown");
  });

  test("a no_connect pin is wired to a net", () => {
    // NC1 (pin 2) of tps5430ddar is no_connect.
    const text = [
      "version 0.14.0",
      "module test",
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
      "version 0.14.0",
      "module test",
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
    expect(codes(`${moduleText}\n\nports\n  P1  NOPE`)).toContain("ref.unknown-net");
  });

  test("two ports point at the same net", () => {
    expect(codes(`${moduleText}\n\nports\n  P1  A\n  P2  A`)).toContain("ref.duplicate-port-net");
  });

  test("single-member net produces a warning", () => {
    const result = parseFlatModule(moduleText);
    const diagnostic = result.diagnostics.find((d) => d.code === "drc.single-member-net");
    expect(diagnostic?.severity).toBe("warning");
    expect(diagnostic?.message).toContain("net A");
  });

  test("the `pages` section is gone: it says so instead of 'unknown section'", () => {
    const text = ["version 0.14.0", "schematic main", "", "pages", "  P1  some-page"].join("\n");
    const result = parseSchematic(text, { file: rootFile, components: resolver });
    const diagnostic = result.diagnostics.find((d) => d.code === "syntax.removed-construct")!;
    expect(diagnostic.message).toContain("pages");
    expect(diagnostic.hint).toContain("teda.md §12.4");
  });

  test("the `page` description type is gone: it says so instead of 'unknown type'", () => {
    const result = parseSchematic("version 0.14.0\npage p1\n", { file: rootFile, components: resolver });
    const diagnostic = result.diagnostics.find((d) => d.code === "syntax.removed-construct")!;
    expect(diagnostic.message).toContain("page");
  });

  test("version higher than the tool supports", () => {
    expect(codes(moduleText.replace("version 0.14.0", "version 0.15"))).toContain("format.unsupported-version");
  });

  test("unknown section", () => {
    // A stray line before any section starts: it belongs to no section.
    const text = "version 0.14.0\nmodule test\nwidgets  x\n";
    expect(codes(text)).toContain("syntax.unknown-section");
  });

  test("diagnostics carry file, line, and column", () => {
    const result = parseFlatModule(moduleText.replace("10k", "10V"));
    const diagnostic = result.diagnostics.find((d) => d.code === "value.invalid-param")!;
    expect(diagnostic.location).toEqual({ file: "design/sch/modules/test.teda", line: 5, col: 3 });
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
    ["version 0.14.0", "module test", "", "instances", "  U1  dual-opamp", "", "nets", `  A:  ${member}`].join("\n");
  const parse = (member: string) => parseFlatModule(text(member), resolverWithOpamp);

  test("naming the unit resolves to that unit's pin", () => {
    const result = parse("U1.2.OUT");
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.ir!.nets[0]!.members).toEqual(["M1.U1.7"]);
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
    const result = parseFlatModule(
      ["version 0.14.0", "module test", "", "instances", "  U1  x", "", "nets", "  A:  U1.GND"].join("\n"),
      repeated,
    );
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
    const sourceWithOnePin = [
      "version 0.14.0",
      "module test",
      "",
      "instances",
      "  R1  res-thick-0402  10k  ±1%",
      "",
      "nets",
      "  A:  R1.1",
    ].join("\n");
    const result = parseFlatModule(sourceWithOnePin);
    const warnings = result.diagnostics.filter((d) => d.code === "drc.single-member-net");
    expect(warnings.length).toBe(1);
    expect(warnings[0]!.message).toContain("A");
    expect(warnings[0]!.location?.file).toBe(testRootFile);
  });

  test("a project-level port is not single-member", () => {
    const module = [
      "version 0.14.0",
      "module test",
      "",
      "instances",
      "  R1  res-thick-0402  10k  ±1%",
      "",
      "nets",
      "  SWD:  R1.1",
    ].join("\n");
    const result = parseFlatModule(`${module}\n\nports\n  SWDIO  SWD`);
    expect(result.diagnostics.filter((d) => d.code === "drc.single-member-net").length).toBe(0);
  });
});

describe("continuation rows (teda.md §7.2)", () => {
  // A row whose first column is a bare `:` continues the net named by the row above it.
  const header = ["version 0.14.0", "module test", "", "instances", "  R1  res-thick-0402  10k  ±1%", "  R2  res-thick-0402  10k  ±1%", "", "nets"].join("\n");

  function parse(text: string) {
    return parseFlatModule(text);
  }

  test("a continuation row adds members to the net above it", () => {
    const result = parse(`${header}\n  A:  R1.1\n  :  R2.1`);
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const net = result.ir!.nets.find((n) => n.id === "A")!;
    expect(net.members).toEqual(["M1.R1.1", "M1.R2.1"]);
  });

  test("several continuation rows all belong to the same net", () => {
    const result = parse(`${header}\n  A:  R1.1\n  :  R2.1\n  :  R1.2`);
    const net = result.ir!.nets.find((n) => n.id === "A")!;
    expect(net.members).toEqual(["M1.R1.1", "M1.R1.2", "M1.R2.1"]);
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
    expect(net.members).toEqual(["M1.R1.1", "M1.R1.2", "M1.R2.1"]);
  });

  test("the row order of the source does not change the IR", () => {
    const forward = parse(`${header}\n  A:  R1.1  R2.1\n  B:  R1.2`);
    const reversed = parse(`${header}\n  B:  R1.2\n  A:  R1.1  R2.1`);
    expect(reversed.ir!.nets).toEqual(forward.ir!.nets);
  });

  test("members are ordered by pin reference, not by source order", () => {
    const result = parse(`${header}\n  A:  R2.1  R1.1`);
    const net = result.ir!.nets.find((n) => n.id === "A")!;
    expect(net.members).toEqual(["M1.R1.1", "M1.R2.1"]);
  });
});

describe("bus continuation rows (teda.md §7.3)", () => {
  const header = ["version 0.14.0", "module test", "", "instances", "  R1  res-thick-0402  10k  ±1%", "  R2  res-thick-0402  10k  ±1%", "", "bus i2c0 = I2C"].join("\n");

  test("a continuation row adds pins to the bus member above it", () => {
    const result = parseFlatModule(`${header}\n  scl:  R1.1\n  :  R2.1\n  sda:  R2.2`);
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const net = result.ir!.nets.find((n) => n.id === "i2c0_scl")!;
    expect(net.members).toEqual(["M1.R1.1", "M1.R2.1"]);
    // The continuation belongs to the member above it, not to the member below it.
    const other = result.ir!.nets.find((n) => n.id === "i2c0_sda")!;
    expect(other.members).toEqual(["M1.R2.2"]);
  });

  test("a continuation row without a bus member above is an error", () => {
    const result = parseFlatModule(`${header}\n  :  R1.1`);
    expect(result.diagnostics.map((d) => d.code)).toContain("net.continuation-without-net");
  });

  test("a member net may be named by a port", () => {
    // `i2c0.scl` is a net with no row of its own; the bus declaration is what brings it into existence.
    const result = parseFlatModule(`${header}\n  scl:  R1.1\n  sda:  R2.2\n\nports\n  I2C_SCL  i2c0.scl`);
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.ir!.ports).toEqual([{ id: "I2C_SCL", net: "i2c0_scl" }]);
  });

  test("a member net may be the subject of a constraint", () => {
    const result = parseFlatModule(`${header}\n  scl:  R1.1\n  sda:  R2.2\n\nconstraints\n  voltage  i2c0.scl  3.0V..3.6V`);
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.ir!.constraints).toEqual([{ type: "voltage", subject: "i2c0_scl", min_uv: 3_000_000, max_uv: 3_600_000 }]);
  });

  test("the same bus declared twice is an error, and only the first block reaches the IR", () => {
    const result = parseFlatModule(`${header}\n  scl:  R1.1\n  sda:  R2.2\n\nbus i2c0 = I2C\n  scl:  R2.1`);
    expect(result.diagnostics.map((d) => d.code)).toContain("ref.duplicate-bus");
    const scl = result.ir!.nets.find((n) => n.id === "i2c0_scl")!;
    expect(scl.members).toEqual(["M1.R1.1"]);
  });

  test("a repeated member row merges into one member net", () => {
    const result = parseFlatModule(`${header}\n  scl:  R1.1\n  scl:  R2.1\n  sda:  R2.2`);
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.ir!.nets.filter((n) => n.id === "i2c0_scl")).toHaveLength(1);
    expect(result.ir!.nets.find((n) => n.id === "i2c0_scl")!.members).toEqual(["M1.R1.1", "M1.R2.1"]);
  });

  test("a pin repeated across two member rows is an error", () => {
    const result = parseFlatModule(`${header}\n  scl:  R1.1\n  scl:  R1.1`);
    expect(result.diagnostics.map((d) => d.code)).toContain("net.duplicate-member");
    expect(result.ir!.nets.find((n) => n.id === "i2c0_scl")!.members).toEqual(["M1.R1.1"]);
  });
});
