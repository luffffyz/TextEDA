#!/usr/bin/env bun
// 端到端冒烟：`symbol` 源码 → IR → `.kicad_sym` → KiCad 能读、能渲染。
//
// 用法：bun run scripts/smoke-symbol.ts [示例符号.teda] [器件描述.teda]
// 产物写在 /tmp/texteda-sym-smoke/ 下。
import { mkdirSync, readFileSync, writeFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { validate } from "@texteda/ir";
import { missingPartPins, symbolLibrary } from "@texteda/exporter";
import { canonicalJson, formatDiagnostic, formatSymbol } from "@texteda/parser";
import { loadComponent, loadSymbol } from "./lib/project.ts";

const symbolFile = process.argv[2] ?? "examples/reference-project/symbols/project/bq24610rger.teda";
const componentFile = process.argv[3] ?? "examples/reference-project/components/power/bq24610rger.teda";
const work = "/tmp/texteda-sym-smoke";
rmSync(work, { recursive: true, force: true });
mkdirSync(join(work, "project.pretty"), { recursive: true });

// 0) canonical form：源文件必须是 fmt 的固定点
const source = readFileSync(symbolFile, "utf8");
const formatted = formatSymbol(source, { file: symbolFile, library: "project" });
if (!formatted.ok || formatted.text !== source) {
  for (const d of formatted.diagnostics) console.error(formatDiagnostic(d));
  console.error("源文件不是 canonical form：运行 bun run fmt:teda " + symbolFile);
  process.exit(1);
}
console.log(`[0] canonical form：${symbolFile} 是 fmt 固定点`);

// 1) 编译：.teda → IR（契约校验）
const parsed = loadSymbol(symbolFile, "project");
for (const d of parsed.diagnostics) console.error(formatDiagnostic(d));
if (!parsed.ok) {
  console.error("编译失败");
  process.exit(1);
}
const check = validate("symbol", parsed.value);
if (!check.ok) {
  console.error("契约校验失败：", check.errors);
  process.exit(1);
}
writeFileSync(join(work, "symbol.json"), canonicalJson(parsed.value));
console.log(`[1] 编译 ${symbolFile} → IR（契约通过，${parsed.value.symbol.pins.length} 个引脚）`);

// 2) 器件：引脚名与电气类型在这里
const component = loadComponent(componentFile);
for (const d of component.diagnostics) console.error(formatDiagnostic(d));
if (!component.ok) {
  console.error("器件描述读不出来");
  process.exit(1);
}
const sym = parsed.value.symbol;
const missing = missingPartPins(sym, component.value);
if (missing.length > 0) {
  console.error(`符号引脚在器件里不存在：${missing.join(", ")}`);
  process.exit(1);
}
console.log(`[2] 器件 ${componentFile}：引脚名与电气类型就位（${component.value.pins.length} 个引脚）`);

// 3) 导出 .kicad_sym
const libPath = join(work, "project.pretty", "project.kicad_sym");
writeFileSync(libPath, symbolLibrary(sym, component.value));
const pinCount = (readFileSync(libPath, "utf8").match(/\(pin /g) ?? []).length;
if (pinCount !== sym.pins.length) {
  console.error(`导出的引脚数不对：${pinCount} ≠ ${sym.pins.length}`);
  process.exit(1);
}
console.log(`[3] 写出 ${libPath}（${pinCount} 个引脚）`);

// 4) KiCad 解析（sym upgrade 会把文件重写一遍：读得懂才写得出）
const upgraded = join(work, "upgraded.kicad_sym");
const upgrade = Bun.spawnSync(["kicad-cli", "sym", "upgrade", "--force", "--output", upgraded, libPath], {
  stdout: "pipe",
  stderr: "pipe",
});
if (upgrade.exitCode !== 0) {
  console.error("KiCad 解析符号库失败：", upgrade.stderr.toString());
  process.exit(1);
}
console.log("[4] KiCad 解析符号库成功（sym upgrade）");

// 5) KiCad 渲染：能出 SVG 说明符号真的可用
const svgDir = join(work, "svg");
mkdirSync(svgDir, { recursive: true });
const svg = Bun.spawnSync(["kicad-cli", "sym", "export", "svg", "--output", svgDir, libPath], {
  stdout: "pipe",
  stderr: "pipe",
});
if (svg.exitCode !== 0) {
  console.error("KiCad 渲染符号失败：", svg.stderr.toString());
  process.exit(1);
}
const rendered = Bun.spawnSync(["find", svgDir, "-name", "*.svg"], { stdout: "pipe" })
  .stdout.toString()
  .trim()
  .split("\n")
  .filter((f) => f.length > 0);
if (rendered.length === 0) {
  console.error("KiCad 没有渲染出任何 SVG");
  process.exit(1);
}
for (const file of rendered) {
  if (statSync(file).size === 0) {
    console.error(`渲染结果是空文件：${file}`);
    process.exit(1);
  }
}
console.log(`[5] KiCad 渲染成功：${rendered.map((f) => f.split("/").pop()).join(", ")}`);
console.log("冒烟通过");
