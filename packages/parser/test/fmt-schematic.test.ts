// Tests for the `schematic` canonical form (teda.md §12).
//
// Asserts three things: idempotence (fmt(fmt(x)) == fmt(x)), semantic invariance (parse(fmt(x)) equivalent to parse(x)),
// and a few concrete canonical rules (section order, row order, the colon and alignment of net rows).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { formatSchematic } from "../src/fmt-schematic.ts";
import { parseSchematicDocument, type Document } from "../src/schematic.ts";

const projectDir = "examples/reference-project";

function fmt(file: string, text: string) {
  const result = formatSchematic(text, { file });
  if (!result.ok) throw new Error(`${file}: ${result.diagnostics.map((d) => d.code).join(", ")}`);
  return result.text!;
}

/** The canonical form of a `module` file (the module has no `modules` section). */
function fmtModule(file: string, text: string) {
  const result = formatSchematic(text, { file, kind: "module" });
  if (!result.ok) throw new Error(`${file}: ${result.diagnostics.map((d) => d.code).join(", ")}`);
  return result.text!;
}

describe("canonical form (schematic)", () => {
  const file = `${projectDir}/design/sch/main.teda`;
  const text = readFileSync(file, "utf8");
  const canonical = fmt(file, text);

  test("idempotent", () => {
    expect(fmt(file, canonical)).toBe(canonical);
  });

  test("semantics unchanged: parsed section contents match", () => {
    const before = parseSchematicDocument(text, { file });
    const after = parseSchematicDocument(canonical, { file });
    expect(after.ok).toBe(true);
    // Locations (line/col) change with layout, and row order within a section may be rearranged by the canonical form;
    // when comparing semantics, sort by key and compare as sets.
    const normalize = (doc: Document): string =>
      JSON.stringify({
        id: doc.id,
        version: doc.version,
        modules: doc.modules.map((m) => `${m.instanceId} ${m.uid ?? ""} ${m.moduleId}`).sort(),
        instances: doc.instances
          .map((i) => `${i.refdes} ${i.uid ?? ""} ${i.componentId} ${i.paramCells.join(" ")}`)
          .sort(),
        nets: doc.nets
          .map((n) => `${n.name}: ${[...n.memberRefs].sort().join(" ")}`)
          .sort(),
        ports: doc.ports.map((p) => `${p.id} ${p.net}`).sort(),
        constraints: doc.constraints.map((c) => `${c.type} ${c.args.join(" ")}`).sort(),
        buses: doc.buses.map((b) => `${b.id}=${b.type}`).sort(),
        interconnects: doc.interconnects.map((i) => `${i.id} ${i.from} ${i.to}`).sort(),
        interconnectPins: doc.interconnectPins.map((i) => `${i.interconnect} ${i.from} ${i.to}`).sort(),
      });
    expect(normalize(after.doc!)).toBe(normalize(before.doc!));
  });

  test("section order is fixed", () => {
    const order = [...canonical.matchAll(/^(\w+)$/gm)].map((m) => m[1]!);
    expect(order).toEqual(["modules", "nets", "ports", "constraints", "interconnects"]);
  });

  test("module UID values survive formatting unchanged", () => {
    const before = parseSchematicDocument(text, { file });
    const after = parseSchematicDocument(canonical, { file });
    expect(after.doc!.modules.map((m) => m.uid)).toEqual(before.doc!.modules.map((m) => m.uid));
  });

  test("the colon in each net row hugs the net name and members share a column", () => {
    const lines = canonical.split("\n").filter((l) => /^  [A-Z0-9_]+:/.test(l));
    expect(lines.length).toBeGreaterThan(0);
    const columns = lines.map((l) => l.indexOf(l.trim().split(/\s+/)[1]!));
    expect(new Set(columns).size).toBe(1);
  });

  test("one blank line between sections, one trailing newline at end of file", () => {
    expect(canonical).toContain("\n\nnets\n");
    expect(canonical.endsWith("\n")).toBe(true);
    expect(canonical.endsWith("\n\n")).toBe(false);
  });
});

describe("canonical form (a module file)", () => {
  const moduleFile = `${projectDir}/design/sch/modules/buck-5v.teda`;
  const moduleText = readFileSync(moduleFile, "utf8");
  const moduleCanonical = fmtModule(moduleFile, moduleText);

  test("module file idempotent", () => {
    expect(fmtModule(moduleFile, moduleCanonical)).toBe(moduleCanonical);
  });

  test("the section order is instances, nets, ports, constraints", () => {
    const order = [...moduleCanonical.matchAll(/^(\w+)$/gm)].map((m) => m[1]!);
    expect(order).toEqual(["instances", "nets", "ports", "constraints"]);
  });

  test("the instances are ordered by refdes naturally", () => {
    const rows = moduleCanonical.split("\n").filter((l) => /^  [A-Z]+\d+\s/.test(l));
    const refs = rows.map((l) => l.trim().split(/\s+/)[0]!);
    expect(refs).toEqual(["C1", "C2", "C3", "C4", "D1", "L1", "R1", "R2", "U1"]);
  });

  test("a module file has no modules section", () => {
    expect(moduleCanonical).not.toContain("\nmodules\n");
  });
});

describe("bus blocks (teda.md §7.3)", () => {
  const header = ["version 0.14.0", "module test", "", "instances", "  R1  res-thick-0402  10k", "  R2  res-thick-0402  10k", "", "bus pwr = PWR"].join("\n");

  test("two bus blocks both survive formatting", () => {
    // The blocks share the section name `bus` but are separate statements: keying them by the name
    // alone let the second overwrite the first, and the lost members went with it.
    const canonical = fmtModule("design/sch/modules/test.teda", `${header}\n  gnd:  R1.2  R2.2\n  vdd:  R1.1\n\nbus i2c0 = I2C\n  scl:  R2.1`);
    expect(canonical).toContain("bus pwr = PWR");
    expect(canonical).toContain("  gnd:  R1.2  R2.2");
    expect(canonical).toContain("bus i2c0 = I2C");
    expect(canonical).toContain("  scl:  R2.1");
    expect(fmtModule("design/sch/modules/test.teda", canonical)).toBe(canonical);
  });
});

describe("negative cases", () => {
  test("no text is produced on a syntax error", () => {
    // Unknown section: the parser reports an error and the formatter produces no text.
    const text = "version 0.14.0\nmodule test\n\nwidgets\n  x  y\n";
    const result = formatSchematic(text, { file: "design/sch/modules/test.teda", kind: "module" });
    expect(result.ok).toBe(false);
    expect(result.text).toBeUndefined();
  });

  test("reports an error when the file header is incomplete", () => {
    const result = formatSchematic("version 0.14.0\n", { file: "design/sch/main.teda" });
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.code).toBe("syntax.header-invalid");
  });
});

describe("continuation rows and wide nets (teda.md §7.2, §12)", () => {
  const header = ["version 0.14.0", "module test", "", "instances", "  R1  res-thick-0402  10k", "  R2  res-thick-0402  10k", "", "nets"].join("\n");

  test("a net that fits on one line is written as one line", () => {
    // The continuation row is merged back: the wrapping is a layout decision, not a fact about the net.
    const canonical = fmtModule("design/sch/modules/test.teda", `${header}\n  A:  R1.1\n  :  R2.1`);
    expect(canonical).toContain("  A:  R1.1  R2.1");
    expect(canonical).not.toContain("\n  :");
  });

  test("members of one net are merged, whatever rows they came from", () => {
    const canonical = fmtModule("design/sch/modules/test.teda", `${header}\n  A:  R1.1\n  A:  R2.1`);
    expect(canonical).toContain("  A:  R1.1  R2.1");
  });

  test("a wide net is wrapped into continuation rows within 80 columns", () => {
    const members = Array.from({ length: 40 }, (_, i) => `R${i}.1`);
    const canonical = fmtModule("design/sch/modules/test.teda", `${header}\n  A:  ${members.join("  ")}`);
    const netLines = canonical.split("\n").filter((l) => /^  (A:|:)/.test(l));
    expect(netLines.length).toBeGreaterThan(1);
    for (const line of netLines) expect(line.length).toBeLessThanOrEqual(80);
    // The first line carries the net name, the rest are continuation rows.
    expect(netLines[0]).toMatch(/^ {2}A:/);
    for (const line of netLines.slice(1)) expect(line).toMatch(/^ {2}:/);
    // Every member survives the wrapping.
    const written = netLines.flatMap((l) => l.trim().split(/\s+/).filter((c) => c.includes(".")));
    expect(written.sort()).toEqual(members.sort());
  });

  test("continuation members are aligned with the first row's members", () => {
    const members = Array.from({ length: 40 }, (_, i) => `R${i}.1`);
    const canonical = fmtModule("design/sch/modules/test.teda", `${header}\n  A:  ${members.join("  ")}`);
    const netLines = canonical.split("\n").filter((l) => /^  (A:|:)/.test(l));
    const columns = netLines.map((l) => l.indexOf(l.trim().split(/\s+/)[1]!));
    expect(new Set(columns).size).toBe(1);
  });

  test("wrapping is idempotent", () => {
    const members = Array.from({ length: 40 }, (_, i) => `R${i}.1`);
    const canonical = fmtModule("design/sch/modules/test.teda", `${header}\n  A:  ${members.join("  ")}`);
    expect(fmtModule("design/sch/modules/test.teda", canonical)).toBe(canonical);
  });

  test("a net written on one line and the same net written in pieces format identically", () => {
    const members = ["R1.1", "R2.1"];
    const oneLine = fmtModule("design/sch/modules/test.teda", `${header}\n  A:  R1.1  R2.1`);
    const twoLines = fmtModule("design/sch/modules/test.teda", `${header}\n  A:  R1.1\n  :  R2.1`);
    expect(twoLines).toBe(oneLine);
  });
});
