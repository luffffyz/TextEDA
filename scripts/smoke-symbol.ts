#!/usr/bin/env bun
// End-to-end smoke: `symbol` source → IR → `.kicad_sym` → KiCad can read and render it.
//
// Usage: bun run scripts/smoke-symbol.ts [example-symbol.teda] [component-description.teda]
// Artifacts are written under /tmp/texteda-sym-smoke/.
import { mkdirSync, readFileSync, writeFileSync, rmSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { validate } from "@texteda/ir";
import { missingPartPins, symbolLibrary } from "@texteda/exporter";
import { canonicalJson, formatDiagnostic, formatSymbol } from "@texteda/parser";
import { loadComponent, loadSymbol } from "./lib/project.ts";

const symbolFile = process.argv[2] ?? "examples/reference-project/assets/symbols/power/bq24610rger.teda";
const componentFile = process.argv[3] ?? "examples/reference-project/assets/components/power/bq24610rger.teda";
const work = "/tmp/texteda-sym-smoke";
rmSync(work, { recursive: true, force: true });
// The classification directory (ADR-0049) is what KiCad sees as the library name.
const klass = basename(dirname(symbolFile));
mkdirSync(join(work, `${klass}.kicad_sym`), { recursive: true });

// 0) canonical form: the source file must be a fixed point of fmt
const source = readFileSync(symbolFile, "utf8");
const formatted = formatSymbol(source, { file: symbolFile, library: klass });
if (!formatted.ok || formatted.text !== source) {
  for (const d of formatted.diagnostics) console.error(formatDiagnostic(d));
  console.error("source file is not in canonical form: run bun run fmt:teda " + symbolFile);
  process.exit(1);
}
console.log(`[0] canonical form: ${symbolFile} is a fmt fixed point`);

// 1) compile: .teda → IR (contract validation)
const parsed = loadSymbol(symbolFile, klass);
for (const d of parsed.diagnostics) console.error(formatDiagnostic(d));
if (!parsed.ok) {
  console.error("compilation failed");
  process.exit(1);
}
const check = validate("symbol", parsed.value);
if (!check.ok) {
  console.error("contract validation failed:", check.errors);
  process.exit(1);
}
writeFileSync(join(work, "symbol.json"), canonicalJson(parsed.value));
console.log(`[1] compiled ${symbolFile} → IR (contract passed, ${parsed.value.symbol.pins.length} pins)`);

// 2) component: pin names and electrical types live here
const component = loadComponent(componentFile);
for (const d of component.diagnostics) console.error(formatDiagnostic(d));
if (!component.ok) {
  console.error("component description could not be read");
  process.exit(1);
}
const sym = parsed.value.symbol;
const missing = missingPartPins(sym, component.value);
if (missing.length > 0) {
  console.error(`symbol pins do not exist in the component: ${missing.join(", ")}`);
  process.exit(1);
}
console.log(`[2] component ${componentFile}: pin names and electrical types in place (${component.value.pins.length} pins)`);

// 3) export .kicad_sym
const libPath = join(work, `${klass}.kicad_sym`, `${klass}.kicad_sym`);
writeFileSync(libPath, symbolLibrary(sym, component.value));
const pinCount = (readFileSync(libPath, "utf8").match(/\(pin /g) ?? []).length;
if (pinCount !== sym.pins.length) {
  console.error(`exported pin count is wrong: ${pinCount} ≠ ${sym.pins.length}`);
  process.exit(1);
}
console.log(`[3] wrote ${libPath} (${pinCount} pins)`);

// 4) KiCad parsing (sym upgrade rewrites the file: it can only write what it can read)
const upgraded = join(work, "upgraded.kicad_sym");
const upgrade = Bun.spawnSync(["kicad-cli", "sym", "upgrade", "--force", "--output", upgraded, libPath], {
  stdout: "pipe",
  stderr: "pipe",
});
if (upgrade.exitCode !== 0) {
  console.error("KiCad failed to parse the symbol library:", upgrade.stderr.toString());
  process.exit(1);
}
console.log("[4] KiCad parsed the symbol library successfully (sym upgrade)");

// 5) KiCad rendering: producing an SVG means the symbol is actually usable
const svgDir = join(work, "svg");
mkdirSync(svgDir, { recursive: true });
const svg = Bun.spawnSync(["kicad-cli", "sym", "export", "svg", "--output", svgDir, libPath], {
  stdout: "pipe",
  stderr: "pipe",
});
if (svg.exitCode !== 0) {
  console.error("KiCad failed to render the symbol:", svg.stderr.toString());
  process.exit(1);
}
const rendered = Bun.spawnSync(["find", svgDir, "-name", "*.svg"], { stdout: "pipe" })
  .stdout.toString()
  .trim()
  .split("\n")
  .filter((f) => f.length > 0);
if (rendered.length === 0) {
  console.error("KiCad did not render any SVG");
  process.exit(1);
}
for (const file of rendered) {
  if (statSync(file).size === 0) {
    console.error(`rendered file is empty: ${file}`);
    process.exit(1);
  }
}
console.log(`[5] KiCad rendered successfully: ${rendered.map((f) => f.split("/").pop()).join(", ")}`);
console.log("smoke passed");
