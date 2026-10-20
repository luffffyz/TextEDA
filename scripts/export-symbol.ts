#!/usr/bin/env bun
// 符号 → KiCad `.kicad_sym`：IR 分片 + `component` 描述 → 符号库文件。
//
// 用法：bun run scripts/export-symbol.ts <symbol.json> --component <component.teda> [--out <file>]
//
// 引脚名/电气类型来自 component（单一所有者，ADR-0012）；引脚号两边都要有：
// 符号里有、器件里没有 → 错误；器件里有、符号里没画 → 警告（可以是有意隐藏的电源脚）。
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
    "用法：bun run scripts/export-symbol.ts <symbol.json> --component <component.teda> [--out <file>]",
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
    `${componentFile}:1:1: error SYMBOL: 符号 ${sym.name} 的引脚在器件里不存在：${missing.join(", ")}`,
  );
  process.exit(1);
}
const unplaced = unplacedPartPins(sym, component.facts);
if (unplaced.length > 0) {
  console.error(
    `${componentFile}:1:1: warning SYMBOL: 器件的引脚没有在符号里画出来：${unplaced.join(", ")}`,
  );
}

const text = symbolLibrary(sym, component.facts);
if (outIdx >= 0) {
  const out = args[outIdx + 1]!;
  // --out 给目录时按库名写 <lib>.kicad_sym（KiCad 库目录的惯例）。
  const isDirectory = out.endsWith("/") || existsSync(out);
  const target = isDirectory ? join(out, `${sym.library}.kicad_sym`) : out;
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text);
  console.log(`wrote ${target}`);
} else {
  process.stdout.write(text);
}
