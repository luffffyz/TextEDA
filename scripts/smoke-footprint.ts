#!/usr/bin/env bun
// 端到端冒烟：`.teda` 源码 → IR → KiCad 产物 → KiCad 能读、能 DRC、能出 Gerber。
//
// 用法：bun run scripts/smoke-footprint.ts [示例封装.teda]
// 产物写在 /tmp/texteda-fp-smoke/ 下。
import { mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { validate } from "@texteda/ir";
import type { Footprint } from "@texteda/ir/footprint";
import { footprintModule, footprintInline, type FootprintBody } from "@texteda/exporter";
import { canonicalJson, formatDiagnostic, formatFootprint } from "@texteda/parser";
import { loadFootprint } from "./lib/project.ts";

const example = process.argv[2] ?? "examples/reference-project/footprints/project/sot-23-5.teda";
const work = "/tmp/texteda-fp-smoke";
rmSync(work, { recursive: true, force: true });
mkdirSync(join(work, "project.pretty"), { recursive: true });
mkdirSync(join(work, "gerbers"), { recursive: true });

function isFootprintDoc(value: unknown): value is Footprint {
  return typeof value === "object" && value !== null && "footprint" in value;
}

// 0) canonical form：源文件必须是 fmt 的固定点，否则评审看到的是噪声
const source = readFileSync(example, "utf8");
const formatted = formatFootprint(source, { file: example, library: "project" });
if (!formatted.ok || formatted.text !== source) {
  for (const d of formatted.diagnostics) console.error(formatDiagnostic(d));
  console.error("源文件不是 canonical form：运行 bun run fmt:teda " + example);
  process.exit(1);
}
console.log(`[0] canonical form：${example} 是 fmt 固定点`);

// 1) 编译：.teda → IR
const parsed = loadFootprint(example, "project");
for (const d of parsed.diagnostics) console.error(formatDiagnostic(d));
if (!parsed.ok) {
  console.error("编译失败");
  process.exit(1);
}
const check = validate("footprint", parsed.value);
if (!check.ok) {
  console.error("契约校验失败：", check.errors);
  process.exit(1);
}
const fp: FootprintBody = parsed.value.footprint;
writeFileSync(join(work, "footprint.json"), canonicalJson(parsed.value));
console.log(`[1] 编译 ${example} → IR（契约通过）`);

// 2) 独立库文件
const modPath = join(work, "project.pretty", `${fp.name}.kicad_mod`);
writeFileSync(modPath, footprintModule(fp));
console.log(`[2] 写出 ${modPath}`);

// 3) KiCad 能解析这个库文件（导出 SVG 即证明能读）
const svgOut = join(work, "svg");
mkdirSync(svgOut, { recursive: true });
const svg = Bun.spawnSync([
  "kicad-cli",
  "fp",
  "export",
  "svg",
  "--output",
  svgOut,
  join(work, "project.pretty"),
]);
if (svg.exitCode !== 0) {
  console.error("kicad-cli fp export svg 失败：", svg.stderr.toString());
  process.exit(1);
}
console.log(`[3] KiCad 解析库文件成功，SVG：${readdirSync(svgOut).join(", ")}`);

// 4) 板文件：内联封装 + 板框
const board = [
  `(kicad_pcb`,
  `\t(version 20241229)`,
  `\t(generator "textEDA")`,
  `\t(general (thickness 1.6))`,
  `\t(paper "A4")`,
  `\t(layers`,
  `\t\t(0 "F.Cu" signal)`,
  `\t\t(2 "B.Cu" signal)`,
  `\t\t(13 "F.Paste" user)`,
  `\t\t(15 "B.Paste" user)`,
  `\t\t(5 "F.SilkS" user "F.Silkscreen")`,
  `\t\t(7 "B.SilkS" user "B.Silkscreen")`,
  `\t\t(1 "F.Mask" user)`,
  `\t\t(3 "B.Mask" user)`,
  `\t\t(17 "Dwgs.User" user "User.Drawings")`,
  `\t\t(19 "Cmts.User" user "User.Comments")`,
  `\t\t(21 "Eco1.User" user "User.Eco1")`,
  `\t\t(23 "Eco2.User" user "User.Eco2")`,
  `\t\t(25 "Edge.Cuts" user)`,
  `\t\t(27 "Margin" user)`,
  `\t\t(31 "F.CrtYd" user "F.Courtyard")`,
  `\t\t(29 "B.CrtYd" user "B.Courtyard")`,
  `\t\t(35 "F.Fab" user)`,
  `\t\t(33 "B.Fab" user)`,
  `\t)`,
  `\t(net 0 "")`,
  footprintInline(fp, { xNm: 25_000_000, yNm: 20_000_000, reference: "U1", value: "SOT-23-5" }),
  `\t(gr_line (start 10 10) (end 40 10) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts"))`,
  `\t(gr_line (start 40 10) (end 40 30) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts"))`,
  `\t(gr_line (start 40 30) (end 10 30) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts"))`,
  `\t(gr_line (start 10 30) (end 10 10) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts"))`,
  `)`,
  "",
].join("\n");
const boardPath = join(work, "smoke.kicad_pcb");
writeFileSync(boardPath, board);
// 库表：板里的封装 id 是 "project:sot-23-5"，KiCad 要能按前缀找到库，否则 DRC 报 lib_footprint_issues。
writeFileSync(
  join(work, "fp-lib-table"),
  `(fp_lib_table\n  (lib (name "project")(type "KiCad")(uri "\${KIPRJMOD}/project.pretty")(options "")(descr ""))\n)\n`,
);
console.log(`[4] 写出板文件 ${boardPath}`);

// 5) DRC
const drcJson = join(work, "drc.json");
const drc = Bun.spawnSync([
  "kicad-cli",
  "pcb",
  "drc",
  "--severity-all",
  "--format",
  "json",
  "--output",
  drcJson,
  boardPath,
]);
if (drc.exitCode !== 0) {
  console.error("kicad-cli pcb drc 失败：", drc.stderr.toString());
  process.exit(1);
}
const drcReport = JSON.parse(readFileSync(drcJson, "utf8")) as {
  violations: unknown[];
  unconnected_items: unknown[];
};
console.log(
  `[5] DRC：violations=${drcReport.violations.length} unconnected=${drcReport.unconnected_items.length}`,
);
if (drcReport.violations.length > 0) console.error(JSON.stringify(drcReport.violations, null, 2));

// 6) Gerber
const gerb = Bun.spawnSync([
  "kicad-cli",
  "pcb",
  "export",
  "gerbers",
  "--output",
  join(work, "gerbers"),
  boardPath,
]);
if (gerb.exitCode !== 0) {
  console.error("kicad-cli pcb export gerbers 失败：", gerb.stderr.toString());
  process.exit(1);
}
console.log(`[6] Gerber：${readdirSync(join(work, "gerbers")).sort().join(", ")}`);

if (drcReport.violations.length > 0) process.exit(1);
console.log("冒烟通过");
