// Unit tests for source spans (ADR-0004): positions are Unicode-scalar columns and UTF-8 bytes,
// the IR stays byte-identical when the source is reordered, and a record's span follows it.
//
// The three properties here are the ones the ADR promises: D1 (spans never enter the IR), D3 (what a
// column is) and D8 (a contract diagnostic can name a line).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spanOf, schemaDiagnosticsToDiagnostics, validate } from "@texteda/ir";
import { lex } from "../src/lexer.ts";
import { parseSchematic, parseSchematicDocument, type ModuleSource } from "../src/schematic.ts";
import { parsePcb } from "../src/pcb.ts";
import { parseModuleView, parseView } from "../src/view.ts";
import { canonicalJson } from "../src/canonical.ts";
import { loadResolver } from "./project.ts";

const resolver = loadResolver();
const projectDir = "examples/reference-project";

describe("lexer positions", () => {
  test("a code point is one column, whatever it costs in bytes", () => {
    const [line] = lex("R1 10k Ω");
    expect(line!.cells.map((cell) => cell.text)).toEqual(["R1", "10k", "Ω"]);
    // `R1 ` is three scalars and three bytes; `10k ` four of each.
    expect(line!.cells[1]!.col).toBe(4);
    expect(line!.cells[1]!.byte).toBe(3);
    expect(line!.cells[2]!.col).toBe(8);
    expect(line!.cells[2]!.byte).toBe(7);
  });

  test("CJK text advances the byte offset by three, the column by one", () => {
    const [line] = lex("名称 值");
    expect(line!.cells[1]!.col).toBe(4);
    expect(line!.cells[1]!.byte).toBe(7);
    expect(line!.end.col).toBe(5);
    expect(line!.end.byte).toBe(10);
  });

  test("byte offsets count from the start of the file, not of the line", () => {
    const lines = lex("version 0.8\nschematic b\n");
    expect(lines[1]!.byte).toBe(12);
    expect(lines[1]!.cells[0]!.byte).toBe(12);
    expect(lines[2]!.byte).toBe(24);
  });

  test("a CRLF file keeps its carriage return out of the content end", () => {
    const [line] = lex("R1 r-0402\r");
    expect(line!.end.col).toBe(10);
    expect(line!.end.byte).toBe(9);
  });
});

describe("spans of a project schematic", () => {
  const rootFile = "design/sch/main.teda";
  const rootText = readFileSync(join(projectDir, rootFile), "utf8");
  const rootDoc = parseSchematicDocument(rootText, { file: rootFile }).doc!;
  const moduleSources: ModuleSource[] = [...new Set(rootDoc.modules.map((row) => row.moduleId))].map((moduleId) => ({
    moduleId,
    file: `design/sch/modules/${moduleId}.teda`,
    text: readFileSync(join(projectDir, "design/sch/modules", `${moduleId}.teda`), "utf8"),
  }));
  const result = parseSchematic(rootText, { file: rootFile, components: resolver, modules: moduleSources });
  const sources = result.sources!;
  const moduleByInstance = new Map(rootDoc.modules.map((row) => [row.instanceId, row.moduleId]));
  const sourceByModule = new Map(moduleSources.map((source) => [source.moduleId, source]));

  test("every instance and net has a span in its owning source file", () => {
    const ir = result.ir!;
    expect(ir.instances.length).toBeGreaterThan(0);
    expect(ir.nets.length).toBeGreaterThan(0);
    for (const [index, instance] of ir.instances.entries()) {
      const span = sources.get(`/instances/${index}`);
      expect(span).toBeDefined();
      const [moduleInstance, localId] = instance.id.split(".", 2);
      const moduleId = moduleByInstance.get(moduleInstance!);
      const source = sourceByModule.get(moduleId!);
      expect(span!.file).toBe(source!.file);
      const line = source!.text.split("\n")[span!.line - 1]!;
      expect(line.trim().startsWith(`${localId} `)).toBe(true);
    }
    for (const [index, net] of ir.nets.entries()) {
      const span = sources.get(`/nets/${index}`);
      expect(span).toBeDefined();
      const prefix = net.id.match(/^(M\d+)\.(.*)$/);
      const source = prefix === null ? { file: rootFile, text: rootText } : sourceByModule.get(moduleByInstance.get(prefix[1]!)!)!;
      expect(span!.file).toBe(source.file);
      const line = source.text.split("\n")[span!.line - 1]!;
      const localId = prefix === null ? net.id : prefix[2]!;
      expect(line.trim().startsWith(`${localId}:`) || line.trim().startsWith(":")).toBe(true);
    }
  });

  test("a span carries the byte offset of its own first token", () => {
    const span = sources.get("/instances/0")!;
    const firstModule = result.ir!.instances[0]!.id.split(".", 1)[0]!;
    const source = sourceByModule.get(moduleByInstance.get(firstModule)!)!;
    const linesBefore = source.text.split("\n").slice(0, span.line - 1).join("\n");
    const bytes = Buffer.byteLength(`${linesBefore}${linesBefore.length > 0 ? "\n" : ""}`, "utf8");
    expect(span.byte).toBeGreaterThanOrEqual(bytes);
    expect(span.byte).toBeLessThan(bytes + 200);
  });

  test("the IR is byte-identical when module source rows are reordered; spans follow new lines", () => {
    const module = moduleSources.find((source) => source.moduleId === "mcu-board")!;
    const rows = module.text.split("\n");
    const first = rows.findIndex((row) => row.trimStart().startsWith("C1 "));
    const second = rows.findIndex((row) => row.trimStart().startsWith("C2 "));
    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(-1);
    const swapped = [...rows];
    [swapped[first], swapped[second]] = [swapped[second]!, swapped[first]!];
    const reorderedModules = moduleSources.map((source) => source.moduleId === "mcu-board" ? { ...source, text: swapped.join("\n") } : source);
    const reordered = parseSchematic(rootText, { file: rootFile, components: resolver, modules: reorderedModules });
    expect(canonicalJson(reordered.ir)).toBe(canonicalJson(result.ir));
    const c1Index = result.ir!.instances.findIndex((instance) => instance.id === "M3.C1");
    expect(c1Index).toBeGreaterThan(-1);
    const before = sources.get(`/instances/${c1Index}`)!;
    const after = reordered.sources!.get(`/instances/${c1Index}`)!;
    expect(after.file).toBe(module.file);
    expect(after.line).toBe(second + 1);
    expect(before.line).toBe(first + 1);
  });
});

describe("spans of a pcb and a print page", () => {
  test("pcb records are located after the canonical sort", () => {
    const text = readFileSync(join(projectDir, "design/pcb", "charger-buck.teda"), "utf8");
    const parsed = parsePcb(text, { file: "design/pcb/charger-buck.teda", pcb: "charger-buck" });
    const ir = parsed.ir!;
    for (const [index, placement] of ir.place.entries()) {
      const span = parsed.sources!.get(`/place/${index}`)!;
      const row = text.split("\n")[span.line - 1]!;
      expect(row.trim().startsWith(`${placement.instance_id} `)).toBe(true);
    }
  });

  test("module view records are located by their own line", () => {
    const file = "views/modules/charger-power.module-view.teda";
    const text = readFileSync(join(projectDir, file), "utf8");
    const parsed = parseModuleView(text, { file });
    const ir = parsed.ir!;
    expect(ir.module_id).toBe("charger-power");
    for (const [index, place] of ir.place!.entries()) {
      const span = parsed.sources!.get(`/place/${index}`)!;
      expect(span.line).toBeGreaterThan(0);
      expect(span.byte).toBeGreaterThanOrEqual(0);
      const row = text.split("\n")[span.line - 1]!;
      expect(row.trim().startsWith(`${place.instance_id} `)).toBe(true);
    }
  });
});

describe("a contract violation names the line", () => {
  test("an IR path resolves to the record's source span, nearest enclosing record first", () => {
    const text = "version 0.8\nschematic b\ninstances\nR1 r-0402 10k\n";
    const sourceMap = new Map([
      ["/instances/0", { file: "design/sch/b.teda", line: 4, col: 1, byte: 31 }],
    ]);
    expect(spanOf(sourceMap, "/instances/0")!.line).toBe(4);
    expect(spanOf(sourceMap, "/instances/0/params/3")!.line).toBe(4);
    expect(spanOf(sourceMap, "/instances/9")).toBeUndefined();

    const diagnostics = schemaDiagnosticsToDiagnostics(
      [{ path: "/instances/0/params/1", keyword: "type", message: "must be object" }],
      (path) => spanOf(sourceMap, path),
    );
    expect(diagnostics[0]!.location).toEqual({ file: "design/sch/b.teda", line: 4, col: 1, byte: 31 });
    expect(diagnostics[0]!.cause?.instancePath).toBe("/instances/0/params/1");
    expect(text).toContain("R1");
  });

  test("without a locator the diagnostic keeps only the IR path", () => {
    const [diagnostic] = schemaDiagnosticsToDiagnostics([
      { path: "/nets/2", keyword: "required", message: "must have required property 'id'" },
    ]);
    expect(diagnostic!.location).toBeUndefined();
    expect(diagnostic!.cause?.instancePath).toBe("/nets/2");
  });

  test("the reference project satisfies the schematic contract", () => {
    const rootFile = "design/sch/main.teda";
    const text = readFileSync(join(projectDir, rootFile), "utf8");
    const doc = parseSchematicDocument(text, { file: rootFile }).doc!;
    const modules: ModuleSource[] = [...new Set(doc.modules.map((row) => row.moduleId))].map((moduleId) => ({
      moduleId,
      file: `design/sch/modules/${moduleId}.teda`,
      text: readFileSync(join(projectDir, "design/sch/modules", `${moduleId}.teda`), "utf8"),
    }));
    const parsed = parseSchematic(text, { file: rootFile, components: resolver, modules });
    const check = validate("schematic", parsed.ir);
    expect(check.ok).toBe(true);
  });
});
