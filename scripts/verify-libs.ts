#!/usr/bin/env bun
// 库级校验：参考工程的每个器件都能解析到自建符号/封装，每个库文件都能编译、
// 导出、被 KiCad 读进来，全部封装摆在一块板上 DRC 干净。
//
// 用法：bun run lib:verify [项目目录]        默认 examples/reference-project
//
// 检查项：
//   1. component 的 symbol / footprint 都指向项目自建库（不出现 kicad: 等外部前缀）；
//   2. 引用的库文件存在；符号引脚号集合 == 器件引脚号集合；封装焊盘号集合 ⊇ 器件引脚号集合；
//   3. 每个库文件是 canonical form、编译成 IR 且通过契约；
//   4. 导出 .kicad_sym / .kicad_mod，KiCad 能解析（sym upgrade / fp export svg）；
//   5. 所有封装放到一块板上，`kicad-cli pcb drc` 0 违规。
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { validate } from "@texteda/ir";
import { footprintInline, footprintModule, symbolLibrary } from "@texteda/exporter";
import { renderSymbol, toSvgText, validateDoc } from "@texteda/renderer";
import {
  canonicalJson,
  formatDiagnostic,
  formatFootprint,
  formatSymbol,
  parseFootprint,
  parseSymbol,
  readComponentFacts,
} from "@texteda/parser";

const projectRoot = process.argv[2] ?? "examples/reference-project";
const libName = "project";
const work = "/tmp/texteda-lib-verify";
rmSync(work, { recursive: true, force: true });
mkdirSync(join(work, "project.pretty"), { recursive: true });
mkdirSync(join(work, "svg"), { recursive: true });
mkdirSync(join(work, "symbol-svg"), { recursive: true });

const problems: string[] = [];
const fail = (message: string): void => {
  problems.push(message);
  console.error(`  ✗ ${message}`);
};

function listTeda(dir: string): string[] {
  const out: string[] = [];
  if (!statSync(dir).isDirectory()) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listTeda(full));
    else if (name.endsWith(".teda")) out.push(full);
  }
  return out.sort();
}

interface ComponentEntry {
  file: string;
  id: string;
  symbol: string;
  footprint: string;
  pins: string[];
}

// 1) 扫器件：解析 symbol/footprint 引用与引脚号
const components: ComponentEntry[] = [];
for (const file of listTeda(join(projectRoot, "components"))) {
  const text = readFileSync(file, "utf8");
  const facts = readComponentFacts(text, { file });
  if (!facts.ok || !facts.facts) {
    for (const d of facts.diagnostics) console.error(`  ${formatDiagnostic(d)}`);
    fail(`${file}: 器件描述读不出来`);
    continue;
  }
  const symbol = /^symbol\s+(\S+)$/m.exec(text)?.[1];
  const footprint = /^footprint\s+(\S+)$/m.exec(text)?.[1];
  if (!symbol || !footprint) {
    fail(`${file}: 缺 symbol 或 footprint`);
    continue;
  }
  components.push({
    file,
    id: facts.facts.id,
    symbol,
    footprint,
    pins: facts.facts.pins.map((p) => p.number),
  });
}

const parseRef = (ref: string): { lib: string; name: string } | null => {
  const at = ref.indexOf(":");
  if (at <= 0 || at === ref.length - 1) return null;
  return { lib: ref.slice(0, at), name: ref.slice(at + 1) };
};

const symbolDir = join(projectRoot, "symbols", libName);
const footprintDir = join(projectRoot, "footprints", libName);

console.log(`[1] 器件 ${components.length} 个`);
for (const c of components) {
  for (const [kind, ref] of [
    ["symbol", c.symbol],
    ["footprint", c.footprint],
  ] as const) {
    const parsed = parseRef(ref);
    if (!parsed) {
      fail(`${c.id}: ${kind} 引用格式不对：${ref}`);
      continue;
    }
    if (parsed.lib !== libName) {
      fail(`${c.id}: ${kind} 指向外部库 ${parsed.lib}（应全部自建）`);
      continue;
    }
    const dir = kind === "symbol" ? symbolDir : footprintDir;
    if (!existsSync(join(dir, `${parsed.name}.teda`))) {
      fail(`${c.id}: ${kind} 指向不存在的文件 ${join(dir, `${parsed.name}.teda`)}`);
    }
  }
}

// 2) 符号：canonical / 契约 / 引脚号 / 导出 / KiCad 解析
const symbolFiles = listTeda(symbolDir);
const symbolUsers = new Map<string, ComponentEntry[]>();
for (const c of components) {
  const parsed = parseRef(c.symbol);
  if (!parsed) continue;
  const list = symbolUsers.get(parsed.name) ?? [];
  list.push(c);
  symbolUsers.set(parsed.name, list);
}

console.log(`[2] 符号 ${symbolFiles.length} 个`);
for (const file of symbolFiles) {
  const name = basename(file, ".teda");
  const source = readFileSync(file, "utf8");
  const formatted = formatSymbol(source, { file, library: libName });
  if (!formatted.ok || formatted.text !== source) {
    for (const d of formatted.diagnostics) console.error(`  ${formatDiagnostic(d)}`);
    fail(`${name}: 不是 canonical form`);
    continue;
  }
  const parsed = parseSymbol(source, { file, library: libName });
  if (!parsed.ok || !parsed.ir) {
    for (const d of parsed.diagnostics) console.error(`  ${formatDiagnostic(d)}`);
    fail(`${name}: 编译失败`);
    continue;
  }
  const check = validate("symbol", parsed.ir);
  if (!check.ok) {
    fail(`${name}: 契约校验失败 ${JSON.stringify(check.errors)}`);
    continue;
  }
  writeFileSync(join(work, `${name}.json`), canonicalJson(parsed.ir));

  const users = symbolUsers.get(name);
  if (!users || users.length === 0) {
    fail(`${name}: 没有任何器件引用它（孤儿符号）`);
    continue;
  }
  // 引脚号集合必须与每个引用它的器件一致
  const symbolPins = new Set(parsed.ir.symbol.pins.map((p) => p.number));
  for (const user of users) {
    const missing = user.pins.filter((p) => !symbolPins.has(p));
    const extra = [...symbolPins].filter((p) => !user.pins.includes(p));
    if (missing.length > 0) fail(`${name}: 器件 ${user.id} 的引脚 ${missing.join(",")} 没画`);
    if (extra.length > 0) fail(`${name}: 画了器件 ${user.id} 没有的引脚 ${extra.join(",")}`);
  }

  // 导出 .kicad_sym（用第一个引用它的器件提供引脚名/电气类型）
  const facts = readComponentFacts(readFileSync(users[0]!.file, "utf8"), { file: users[0]!.file });
  if (!facts.ok || !facts.facts) {
    fail(`${name}: 引用的器件读不出来`);
    continue;
  }
  const libPath = join(work, `${name}.kicad_sym`);
  writeFileSync(libPath, symbolLibrary(parsed.ir.symbol, facts.facts));
  const upgrade = Bun.spawnSync(["kicad-cli", "sym", "upgrade", "--force", "--output", `${work}/${name}.up.kicad_sym`, libPath], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (upgrade.exitCode !== 0) fail(`${name}: KiCad 解析失败 ${upgrade.stderr.toString().trim()}`);

  // 用**我们自己的**渲染器出图：不依赖 KiCad，也不依赖系统字体（文字画成路径）。
  // 封装那侧有 KiCad 的渲染图，这里补上符号的——整库一眼能看。
  const doc = renderSymbol(parsed.ir.symbol, {
    pins: facts.facts.pins.map((p) => ({ number: p.number, name: p.name, type: p.type })),
  });
  const problems = validateDoc(doc);
  if (problems.length > 0) fail(`${name}: 图形自检有 ${problems.length} 处问题：${problems[0]}`);
  writeFileSync(join(work, "symbol-svg", `${name}.svg`), toSvgText(doc));
}
console.log(`    我们渲染 ${symbolFiles.length} 个符号（symbol-svg/）`);

// 3) 封装：canonical / 契约 / 焊盘号 / 导出 / KiCad 渲染
const footprintFiles = listTeda(footprintDir);
const footprintUsers = new Map<string, ComponentEntry[]>();
for (const c of components) {
  const parsed = parseRef(c.footprint);
  if (!parsed) continue;
  const list = footprintUsers.get(parsed.name) ?? [];
  list.push(c);
  footprintUsers.set(parsed.name, list);
}

console.log(`[3] 封装 ${footprintFiles.length} 个`);
const inlineBlocks: string[] = [];
let slot = 0;
for (const file of footprintFiles) {
  const name = basename(file, ".teda");
  const source = readFileSync(file, "utf8");
  const formatted = formatFootprint(source, { file, library: libName });
  if (!formatted.ok || formatted.text !== source) {
    for (const d of formatted.diagnostics) console.error(`  ${formatDiagnostic(d)}`);
    fail(`${name}: 不是 canonical form`);
    continue;
  }
  const parsed = parseFootprint(source, { file, library: libName });
  if (!parsed.ok || !parsed.ir) {
    for (const d of parsed.diagnostics) console.error(`  ${formatDiagnostic(d)}`);
    fail(`${name}: 编译失败`);
    continue;
  }
  const check = validate("footprint", parsed.ir);
  if (!check.ok) {
    fail(`${name}: 契约校验失败 ${JSON.stringify(check.errors)}`);
    continue;
  }
  const body = parsed.ir.footprint;
  writeFileSync(join(work, `${name}.json`), canonicalJson(parsed.ir));
  writeFileSync(join(work, "project.pretty", `${name}.kicad_mod`), footprintModule(body));

  const users = footprintUsers.get(name);
  if (!users || users.length === 0) {
    fail(`${name}: 没有任何器件引用它（孤儿封装）`);
    continue;
  }
  const pads = new Set(body.pads.map((p) => p.number));
  for (const user of users) {
    const missing = user.pins.filter((p) => !pads.has(p));
    if (missing.length > 0) fail(`${name}: 器件 ${user.id} 的引脚 ${missing.join(",")} 没有焊盘`);
    const extra = [...pads].filter((p) => !user.pins.includes(p));
    if (extra.length > 0) console.error(`  ! ${name}: 多出焊盘 ${extra.join(",")}（${user.id} 没有对应引脚）`);
  }

  // 摆到板上的网格里（5 个一行，间距 25mm）
  const x = 25_000_000 * (slot % 5) + 25_000_000;
  const y = 25_000_000 * Math.floor(slot / 5) + 25_000_000;
  inlineBlocks.push(
    footprintInline(body, { xNm: x, yNm: y, reference: `U${slot + 1}`, value: name }),
  );
  slot += 1;
}

const svg = Bun.spawnSync(["kicad-cli", "fp", "export", "svg", "--output", join(work, "svg"), join(work, "project.pretty")], {
  stdout: "pipe",
  stderr: "pipe",
});
if (svg.exitCode !== 0) fail(`kicad-cli fp export svg 失败 ${svg.stderr.toString().trim()}`);
else console.log(`    KiCad 渲染 ${readdirSync(join(work, "svg")).length} 个封装`);

// 4) 全部封装摆一块板，DRC
const cols = Math.min(5, Math.max(1, slot));
const rows = Math.ceil(slot / 5);
const width = 25_000_000 * cols + 25_000_000;
const height = 25_000_000 * rows + 25_000_000;
const mm = (nm: number): string => (nm / 1_000_000).toFixed(3);
const edge = (x1: number, y1: number, x2: number, y2: number): string =>
  `\t(gr_line (start ${x1} ${y1}) (end ${x2} ${y2}) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts"))`;
const board = [
  "(kicad_pcb",
  "\t(version 20241229)",
  '\t(generator "textEDA")',
  "\t(general (thickness 1.6))",
  '\t(paper "A4")',
  "\t(layers",
  '\t\t(0 "F.Cu" signal)', '\t\t(2 "B.Cu" signal)', '\t\t(13 "F.Paste" user)', '\t\t(15 "B.Paste" user)',
  '\t\t(5 "F.SilkS" user "F.Silkscreen")', '\t\t(7 "B.SilkS" user "B.Silkscreen")',
  '\t\t(1 "F.Mask" user)', '\t\t(3 "B.Mask" user)',
  '\t\t(17 "Dwgs.User" user "User.Drawings")', '\t\t(19 "Cmts.User" user "User.Comments")',
  '\t\t(21 "Eco1.User" user "User.Eco1")', '\t\t(23 "Eco2.User" user "User.Eco2")',
  '\t\t(25 "Edge.Cuts" user)', '\t\t(27 "Margin" user)',
  '\t\t(31 "F.CrtYd" user "F.Courtyard")', '\t\t(29 "B.CrtYd" user "B.Courtyard")',
  '\t\t(35 "F.Fab" user)', '\t\t(33 "B.Fab" user)',
  "\t)",
  '\t(net 0 "")',
  ...inlineBlocks,
  edge(0, 0, Number(mm(width)), 0),
  edge(Number(mm(width)), 0, Number(mm(width)), Number(mm(height))),
  edge(Number(mm(width)), Number(mm(height)), 0, Number(mm(height))),
  edge(0, Number(mm(height)), 0, 0),
  ")",
  "",
].join("\n");
const boardPath = join(work, "libs.kicad_pcb");
writeFileSync(boardPath, board);
writeFileSync(
  join(work, "fp-lib-table"),
  `(fp_lib_table\n  (lib (name "${libName}")(type "KiCad")(uri "\${KIPRJMOD}/project.pretty")(options "")(descr ""))\n)\n`,
);
const drcPath = join(work, "drc.json");
const drc = Bun.spawnSync([
  "kicad-cli", "pcb", "drc", "--severity-all", "--format", "json", "--output", drcPath, boardPath,
], { stdout: "pipe", stderr: "pipe" });
if (drc.exitCode !== 0) {
  fail(`kicad-cli pcb drc 失败 ${drc.stderr.toString().trim()}`);
} else {
  const report = JSON.parse(readFileSync(drcPath, "utf8")) as {
    violations: { type?: string; description?: string }[];
  };
  console.log(`[4] 合并板 DRC：violations=${report.violations.length}`);
  for (const v of report.violations) fail(`DRC ${v.type ?? "?"}: ${v.description ?? ""}`);
}

// 5) 汇总
if (problems.length > 0) {
  console.error(`\n失败 ${problems.length} 项`);
  process.exit(1);
}
console.log(
  `\n通过：器件 ${components.length} 个 / 符号 ${symbolFiles.length} 个 / 封装 ${footprintFiles.length} 个`,
);
console.log(`产物在 ${work}`);
