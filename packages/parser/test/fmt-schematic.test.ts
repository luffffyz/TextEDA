// Tests for the `schematic` / `page` canonical form (teda.md §12).
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

describe("canonical form (schematic)", () => {
  const file = `${projectDir}/sch/mcu-board.teda`;
  const text = readFileSync(file, "utf8");
  const canonical = fmt(file, text);

  test("idempotent", () => {
    expect(fmt(file, canonical)).toBe(canonical);
  });

  test("semantics unchanged: parsed section contents match", () => {
    const before = parseSchematicDocument(text, { file, kind: "schematic" });
    const after = parseSchematicDocument(canonical, { file, kind: "schematic" });
    expect(after.ok).toBe(true);
    // Locations (line/col) change with layout, and row order within a section may be rearranged by the canonical form;
    // when comparing semantics, sort by key and compare as sets.
    const normalize = (doc: Document): string =>
      JSON.stringify({
        kind: doc.kind,
        id: doc.id,
        version: doc.version,
        instances: doc.instances
          .map((i) => `${i.refdes} ${i.componentId} ${i.paramCells.join(" ")}`)
          .sort(),
        nets: doc.nets
          .map((n) => `${n.name}: ${[...n.memberRefs].sort().join(" ")}`)
          .sort(),
        ports: doc.ports.map((p) => `${p.id} ${p.net}`).sort(),
        pages: doc.pages.map((p) => `${p.id} ${p.pageId}`).sort(),
        constraints: doc.constraints.map((c) => `${c.type} ${c.args.join(" ")}`),
        buses: doc.buses.map((b) => `${b.id}=${b.type}`),
      });
    expect(normalize(after.doc!)).toBe(normalize(before.doc!));
  });

  test("section order is fixed", () => {
    const order = [...canonical.matchAll(/^(\w+)$/gm)].map((m) => m[1]!);
    expect(order).toEqual(["instances", "nets", "ports", "constraints"]);
  });

  test("instances are ordered by refdes naturally", () => {
    const rows = canonical.split("\n").filter((l) => /^  [A-Z]+\d+\s/.test(l));
    const refs = rows.map((l) => l.trim().split(/\s+/)[0]!);
    expect(refs.slice(0, 6)).toEqual(["C1", "C2", "C3", "C4", "C5", "C6"]);
  });

  test("the colon in a net row hugs the net name, members start in the same column", () => {
    const lines = canonical.split("\n").filter((l) => /^  [A-Z0-9_]+:/.test(l));
    expect(lines[0]).toMatch(/^  BOOT0: {4}R2\.1 {2}U1\.BOOT0$/);
    const columns = lines.map((l) => l.indexOf(l.trim().split(/\s+/)[1]!));
    expect(new Set(columns).size).toBe(1);
  });

  test("comments are preserved and follow their line", () => {
    expect(canonical).toContain("# CH32V307VCT6");
  });

  test("one blank line between sections, one trailing newline at end of file", () => {
    expect(canonical).toContain("\n\nnets\n");
    expect(canonical.endsWith("\n")).toBe(true);
    expect(canonical.endsWith("\n\n")).toBe(false);
  });
});

describe("canonical form (pages and board root)", () => {
  const boardFile = `${projectDir}/sch/charger-buck.teda`;
  const boardText = readFileSync(boardFile, "utf8");
  const boardCanonical = fmt(boardFile, boardText);

  test("board root idempotent", () => {
    expect(fmt(boardFile, boardCanonical)).toBe(boardCanonical);
  });

  test("board root section order: nets before pages", () => {
    const netsAt = boardCanonical.indexOf("\nnets\n");
    const pagesAt = boardCanonical.indexOf("\npages\n");
    expect(netsAt).toBeGreaterThan(0);
    expect(pagesAt).toBeGreaterThan(netsAt);
  });

  test("page file is idempotent with correct section order", () => {
    const file = `${projectDir}/sch/charger-buck/buck-5v.teda`;
    const text = readFileSync(file, "utf8");
    const canonical = fmt(file, text);
    expect(fmt(file, canonical)).toBe(canonical);
    const order = [...canonical.matchAll(/^(\w+)$/gm)].map((m) => m[1]!);
    expect(order).toEqual(["instances", "nets", "ports", "constraints"]);
  });
});

describe("negative cases", () => {
  test("no text is produced on a syntax error", () => {
    // Unknown section: the parser reports an error and the formatter produces no text.
    const text = "version 0.3\nschematic b\n\nwidgets\n  x  y\n";
    const result = formatSchematic(text, { file: "sch/b.teda" });
    expect(result.ok).toBe(false);
    expect(result.text).toBeUndefined();
  });

  test("reports an error when the file header is incomplete", () => {
    const result = formatSchematic("version 0.3\n", { file: "sch/b.teda" });
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.code).toBe("syntax.header-invalid");
  });
});

describe("continuation rows and wide nets (teda.md §7.2, §12)", () => {
  const header = ["version 0.3", "schematic b", "", "instances", "  R1  r-0402  10k", "  R2  r-0402  10k", "", "nets"].join("\n");

  test("a net that fits on one line is written as one line", () => {
    // The continuation row is merged back: the wrapping is a layout decision, not a fact about the net.
    const canonical = fmt("sch/b.teda", `${header}\n  A:  R1.1\n  :  R2.1`);
    expect(canonical).toContain("  A:  R1.1  R2.1");
    expect(canonical).not.toContain("\n  :");
  });

  test("members of one net are merged, whatever rows they came from", () => {
    const canonical = fmt("sch/b.teda", `${header}\n  A:  R1.1\n  A:  R2.1`);
    expect(canonical).toContain("  A:  R1.1  R2.1");
  });

  test("a wide net is wrapped into continuation rows within 80 columns", () => {
    const members = Array.from({ length: 40 }, (_, i) => `R${i}.1`);
    const canonical = fmt("sch/b.teda", `${header}\n  A:  ${members.join("  ")}`);
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
    const canonical = fmt("sch/b.teda", `${header}\n  A:  ${members.join("  ")}`);
    const netLines = canonical.split("\n").filter((l) => /^  (A:|:)/.test(l));
    const columns = netLines.map((l) => l.indexOf(l.trim().split(/\s+/)[1]!));
    expect(new Set(columns).size).toBe(1);
  });

  test("wrapping is idempotent", () => {
    const members = Array.from({ length: 40 }, (_, i) => `R${i}.1`);
    const canonical = fmt("sch/b.teda", `${header}\n  A:  ${members.join("  ")}`);
    expect(fmt("sch/b.teda", canonical)).toBe(canonical);
  });

  test("a net written on one line and the same net written in pieces format identically", () => {
    const members = ["R1.1", "R2.1"];
    const oneLine = fmt("sch/b.teda", `${header}\n  A:  R1.1  R2.1`);
    const twoLines = fmt("sch/b.teda", `${header}\n  A:  R1.1\n  :  R2.1`);
    expect(twoLines).toBe(oneLine);
  });
});
