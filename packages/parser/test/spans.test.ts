// Unit tests for source spans (ADR-0020): positions are Unicode-scalar columns and UTF-8 bytes,
// the IR stays byte-identical when the source is reordered, and a record's span follows it.
//
// The three properties here are the ones the ADR promises: D1 (spans never enter the IR), D3 (what a
// column is) and D8 (a contract diagnostic can name a line).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spanOf, schemaDiagnosticsToDiagnostics, validate } from "@texteda/ir";
import { lex } from "../src/lexer.ts";
import { parseSchematic } from "../src/schematic.ts";
import { parsePcb } from "../src/pcb.ts";
import { parseView } from "../src/view.ts";
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

describe("spans of a board", () => {
  const text = readFileSync(join(projectDir, "design/sch", "mcu-board.teda"), "utf8");
  const result = parseSchematic(text, { file: "design/sch/mcu-board.teda", board: "mcu-board", components: resolver });
  const sources = result.sources!;

  test("every instance and net has a span, and it points at its row", () => {
    const ir = result.ir!;
    expect(ir.instances.length).toBeGreaterThan(0);
    expect(ir.nets.length).toBeGreaterThan(0);
    for (const [index, instance] of ir.instances.entries()) {
      const span = sources.get(`/instances/${index}`);
      expect(span).toBeDefined();
      const line = text.split("\n")[span!.line - 1]!;
      expect(line.trim().startsWith(`${instance.id} `)).toBe(true);
    }
    for (const [index, net] of ir.nets.entries()) {
      const span = sources.get(`/nets/${index}`);
      expect(span).toBeDefined();
      const line = text.split("\n")[span!.line - 1]!;
      // A continuation row starts with `:`, so the net's own name may be on the row above.
      expect(line.trim().startsWith(`${net.id}:`) || line.trim().startsWith(":")).toBe(true);
    }
  });

  test("a span carries the byte offset of its own first token", () => {
    const span = sources.get("/instances/0")!;
    const bytes = Buffer.byteLength(text.slice(0, text.indexOf(text.split("\n")[span.line - 1]!)), "utf8");
    expect(span.byte).toBeGreaterThanOrEqual(bytes);
    expect(span.byte).toBeLessThan(bytes + 200);
  });

  test("the IR is byte-identical when the source rows are reordered; the spans follow the new lines", () => {
    const rows = text.split("\n");
    // Swap two instance rows inside the `instances` section without touching anything else.
    const first = rows.findIndex((row) => row.trimStart().startsWith("C1 "));
    const second = rows.findIndex((row) => row.trimStart().startsWith("C2 "));
    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(-1);
    const swapped = [...rows];
    [swapped[first], swapped[second]] = [swapped[second]!, swapped[first]!];

    const reordered = parseSchematic(swapped.join("\n"), {
      file: "design/sch/mcu-board.teda",
      board: "mcu-board",
      components: resolver,
    });
    expect(canonicalJson(reordered.ir)).toBe(canonicalJson(result.ir));

    const before = sources.get("/instances/1")!;
    const after = reordered.sources!.get("/instances/1")!;
    expect(after.line).toBe(before.line === first + 1 ? second + 1 : first + 1);
    expect(reordered.sources!.get("/instances/0")!.line).toBeGreaterThan(0);
  });
});

describe("spans of a pcb and a print page", () => {
  test("pcb records are located after the canonical sort", () => {
    const text = readFileSync(join(projectDir, "design/pcb", "charger-buck.teda"), "utf8");
    const parsed = parsePcb(text, { file: "design/pcb/charger-buck.teda", board: "charger-buck" });
    const ir = parsed.ir!;
    for (const [index, placement] of ir.place.entries()) {
      const span = parsed.sources!.get(`/place/${index}`)!;
      const row = text.split("\n")[span.line - 1]!;
      expect(row.trim().startsWith(`${placement.instance_id} `)).toBe(true);
    }
  });

  test("view records are located by their own line", () => {
    const text = readFileSync(join(projectDir, "views", "charger-buck", "buck-5v.view.teda"), "utf8");
    const parsed = parseView(text, { file: "views/charger-buck/buck-5v.view.teda", board: "charger-buck" });
    const ir = parsed.ir!;
    for (const [index, place] of ir.place.entries()) {
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

  test("the reference project's shards satisfy the contract, so validation has nothing to locate", () => {
    const text = readFileSync(join(projectDir, "design/sch", "mcu-board.teda"), "utf8");
    const parsed = parseSchematic(text, { file: "design/sch/mcu-board.teda", board: "mcu-board", components: resolver });
    const check = validate("schematic", parsed.ir);
    expect(check.ok).toBe(true);
  });
});
