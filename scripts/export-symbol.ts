#!/usr/bin/env bun
// Symbol → KiCad `.kicad_sym`: IR shards + `component` description → symbol library file.
//
// Usage: bun run scripts/export-symbol.ts <symbol.json> --component <component.teda> [--out <file>]
//
// Pin names/electrical types come from the component (single owner, ADR-0031); pin numbers must exist on both sides:
// present in the symbol but not in the component → error; present in the component but not drawn in the symbol → warning (may be intentionally hidden power pins).
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Symbol } from "@texteda/ir/symbol";
import { validate } from "@texteda/ir";
import { missingPartPins, symbolLibrary, unplacedPartPins } from "@texteda/exporter";
import { formatDiagnostic, readComponentFacts } from "@texteda/parser";

const args = process.argv.slice(2);
const file = args[0];
const componentIdx = args.indexOf("--component");
const outIdx = args.indexOf("--out");
if (!file || componentIdx < 0 || !args[componentIdx + 1]) {
  console.error(
    "usage: bun run scripts/export-symbol.ts <symbol.json> --component <component.teda> [--out <file>]",
  );
  process.exit(2);
}
const componentFile = args[componentIdx + 1]!;

const ir = JSON.parse(readFileSync(file, "utf8")) as Symbol;
const check = validate("symbol", ir);
if (!check.ok) {
  for (const e of check.errors) {
    console.error(`${file}:1:1: error SCHEMA: ${e.path || "/"}: ${e.message}`);
  }
  process.exit(1);
}

const componentText = readFileSync(componentFile, "utf8");
const component = readComponentFacts(componentText, { file: componentFile });
for (const d of component.diagnostics) console.error(formatDiagnostic(d));
if (!component.ok || !component.facts) process.exit(1);

const sym = ir.symbol;
const missing = missingPartPins(sym, component.facts);
if (missing.length > 0) {
  console.error(
    `${componentFile}:1:1: error SYMBOL: pins of symbol ${sym.name} do not exist in the component: ${missing.join(", ")}`,
  );
  process.exit(1);
}
const unplaced = unplacedPartPins(sym, component.facts);
if (unplaced.length > 0) {
  console.error(
    `${componentFile}:1:1: warning SYMBOL: component pins are not drawn in the symbol: ${unplaced.join(", ")}`,
  );
}

const text = symbolLibrary(sym, component.facts);
if (outIdx >= 0) {
  const out = args[outIdx + 1]!;
  // When --out is given a directory, write <lib>.kicad_sym by library name (the KiCad library directory convention).
  const isDirectory = out.endsWith("/") || existsSync(out);
  const target = isDirectory ? join(out, `${sym.library}.kicad_sym`) : out;
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text);
  console.log(`wrote ${target}`);
} else {
  process.stdout.write(text);
}
