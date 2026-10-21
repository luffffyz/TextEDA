// Round-trip: `extract(render(ir)) == ir` (AGENTS.md §10).
//
// Each end computes a "semantic projection" once; what is compared is the projection, not the IR itself --
// some IR fields (such as a symbol's unit count) cannot be expressed graphically, so the projection
// keeps only the parts that can be reverse-parsed.
// Coverage uses the whole reference project library (16 footprints plus all symbols), not a few hand-picked samples.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFootprint, parseSymbol, readComponentFacts } from "@texteda/parser";
import {
  extractFootprint,
  extractSymbol,
  footprintProjection,
  renderFootprint,
  renderSymbol,
  symbolProjection,
  toSvgText,
} from "../src/index.ts";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const projectRoot = join(repoRoot, "examples/reference-project");

function tedaFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tedaFiles(full));
    else if (entry.endsWith(".teda")) out.push(full);
  }
  return out;
}

const symbolFiles = tedaFiles(join(projectRoot, "symbols", "project"));
const footprintFiles = tedaFiles(join(projectRoot, "footprints", "project"));
const componentFiles = tedaFiles(join(projectRoot, "components"));

/** The part that references a given symbol (the sole owner of pin names and electrical types, ADR-0012). */
function partForSymbol(ref: string): { pins: { number: string; name: string; type: string }[] } {
  for (const file of componentFiles) {
    const text = readFileSync(file, "utf8");
    const m = /^symbol\s+(\S+)$/m.exec(text);
    if (!m || m[1] !== ref) continue;
    const facts = readComponentFacts(text, { file });
    if (!facts.ok || !facts.facts) continue;
    return {
      pins: facts.facts.pins.map((p) => ({ number: p.number, name: p.name, type: p.type })),
    };
  }
  return { pins: [] };
}

describe("symbol round-trip", () => {
  test("every symbol in the reference project: rendering can be reverse-extracted into an equivalent projection", () => {
    expect(symbolFiles.length).toBeGreaterThan(0);
    for (const file of symbolFiles) {
      const parsed = parseSymbol(readFileSync(file, "utf8"), { file, library: "project" });
      expect(parsed.ok).toBe(true);
      if (!parsed.ok || !parsed.ir) continue;
      const sym = parsed.ir.symbol;
      const part = partForSymbol(`project:${sym.name}`);
      const doc = renderSymbol(sym, part);
      expect(extractSymbol(doc)).toEqual(symbolProjection(sym));
    }
  });

  test("pin names and electrical types are not baked into the symbol: rendering with a different part leaves the symbol projection unchanged", () => {
    const file = symbolFiles.find((f) => f.endsWith("bq24610rger.teda"))!;
    const parsed = parseSymbol(readFileSync(file, "utf8"), { file, library: "project" });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok || !parsed.ir) return;
    const sym = parsed.ir.symbol;
    const withNames = renderSymbol(sym, {
      pins: sym.pins.map((p) => ({ number: p.number, name: "X", type: "input" })),
    });
    const withOtherNames = renderSymbol(sym, {
      pins: sym.pins.map((p) => ({ number: p.number, name: "Y", type: "output" })),
    });
    const strip = (doc: ReturnType<typeof renderSymbol>) =>
      extractSymbol(doc).pins.map((p) => ({ ...p }));
    expect(strip(withNames)).toEqual(strip(withOtherNames));
    // Names do appear on the drawing, but not in the projection (names belong to the part).
    expect(toSvgText(withNames)).not.toBe(toSvgText(withOtherNames));
  });
});

describe("projection sensitivity", () => {
  test("moving one pad changes the reverse-extracted result (the round-trip is not a no-op)", () => {
    const file = footprintFiles.find((f) => f.endsWith("vqfn-24-ep.teda"))!;
    const parsed = parseFootprint(readFileSync(file, "utf8"), { file, library: "project" });
    if (!parsed.ok || !parsed.ir) throw new Error("failed to parse reference footprint");
    const before = extractFootprint(renderFootprint(parsed.ir.footprint));
    const moved = structuredClone(parsed.ir.footprint);
    moved.pads[0]!.at.x_nm += 1_000_000;
    const after = extractFootprint(renderFootprint(moved));
    expect(after.pads[0]!.x_nm).toBe(before.pads[0]!.x_nm + 1_000_000);
    expect(after).not.toEqual(before);
  });

  test("every symbol pin can find its name in the part (only then can it be reverse-extracted)", () => {
    for (const file of symbolFiles) {
      const parsed = parseSymbol(readFileSync(file, "utf8"), { file, library: "project" });
      if (!parsed.ok || !parsed.ir) continue;
      const sym = parsed.ir.symbol;
      const part = partForSymbol(`project:${sym.name}`);
      const named = new Set(part.pins.filter((p) => p.name.length > 0).map((p) => p.number));
      for (const pin of sym.pins) {
        if (sym.pin_names_hidden) continue;
        expect(named.has(pin.number)).toBe(true);
      }
    }
  });
});

describe("footprint round-trip", () => {
  test("every footprint in the reference project: rendering can be reverse-extracted into an equivalent projection", () => {
    expect(footprintFiles.length).toBeGreaterThan(0);
    for (const file of footprintFiles) {
      const parsed = parseFootprint(readFileSync(file, "utf8"), { file, library: "project" });
      expect(parsed.ok).toBe(true);
      if (!parsed.ok || !parsed.ir) continue;
      const fp = parsed.ir.footprint;
      const doc = renderFootprint(fp);
      expect(extractFootprint(doc)).toEqual(footprintProjection(fp));
    }
  });
});

describe("determinism", () => {
  test("rendering the same IR twice produces identical bytes", () => {
    const symbolFile = symbolFiles[0]!;
    const parsed = parseSymbol(readFileSync(symbolFile, "utf8"), {
      file: symbolFile,
      library: "project",
    });
    if (!parsed.ok || !parsed.ir) throw new Error("failed to parse reference symbol");
    const part = partForSymbol(`project:${parsed.ir.symbol.name}`);
    const a = toSvgText(renderSymbol(parsed.ir.symbol, part));
    const b = toSvgText(renderSymbol(parsed.ir.symbol, part));
    expect(a).toBe(b);
  });

  test("rendering the same footprint IR twice produces identical bytes", () => {
    const fpFile = footprintFiles[0]!;
    const parsed = parseFootprint(readFileSync(fpFile, "utf8"), {
      file: fpFile,
      library: "project",
    });
    if (!parsed.ok || !parsed.ir) throw new Error("failed to parse reference footprint");
    const a = toSvgText(renderFootprint(parsed.ir.footprint));
    const b = toSvgText(renderFootprint(parsed.ir.footprint));
    expect(a).toBe(b);
  });
});
