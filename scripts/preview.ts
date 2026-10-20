#!/usr/bin/env bun
// 预览：把库里的符号 / 封装画成 SVG，自己画，不借 KiCad。
//
//   bun run preview symbol   <id> [--lib <name>] [--out <dir>] [--project <dir>] [--scale <n>]
//   bun run preview footprint <id> [--lib <name>] [--out <dir>] [--project <dir>] [--scale <n>]
//   bun run preview component <id> [--out <dir>] [--project <dir>] [--scale <n>]
//
// 用途：agent 造完一个封装/符号要立刻看一眼（引脚朝向、箭头、courtyard、丝印压焊盘），
// 这些在 IR 与契约校验里全是绿的——校验只看自洽，不看像不像。
// 输出：SVG 路径打印到 stdout；产物落在 /tmp/texteda-preview/<id>/（可用 --out 改）。
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { formatDiagnostic } from "@texteda/parser";
import { renderFootprint, renderSymbol, toSvgText, validateDoc } from "@texteda/renderer";
import {
  componentUsingSymbol,
  loadComponent,
  loadFootprint,
  loadSymbol,
  tedaFiles,
} from "./lib/project.ts";

interface Options {
  kind: "symbol" | "footprint" | "component";
  id: string;
  lib: string;
  out: string | null;
  project: string;
  scale: number;
}

function fail(message: string): never {
  console.error(`预览失败：${message}`);
  process.exit(1);
}

function parseArgs(argv: string[]): Options {
  const positional: string[] = [];
  let lib = "project";
  let out: string | null = null;
  let project = "examples/reference-project";
  let scale = 1;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--lib") lib = argv[++i] ?? fail("--lib 后面要跟库名");
    else if (arg === "--out") out = argv[++i] ?? fail("--out 后面要跟目录");
    else if (arg === "--project") project = argv[++i] ?? fail("--project 后面要跟目录");
    else if (arg === "--scale") scale = Number(argv[++i] ?? fail("--scale 后面要跟倍数"));
    else if (arg.startsWith("--")) fail(`未知参数 ${arg}`);
    else positional.push(arg);
  }
  const kind = positional[0];
  const id = positional[1];
  if (kind !== "symbol" && kind !== "footprint" && kind !== "component") {
    fail("用法：preview symbol|footprint|component <id>");
  }
  if (!id) fail("用法：preview symbol|footprint|component <id>");
  if (!Number.isFinite(scale) || scale <= 0) fail("--scale 要是正数");
  return { kind, id, lib, out, project, scale };
}

function existsDir(dir: string): boolean {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function existsFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

function readRef(text: string, key: "symbol" | "footprint"): string | null {
  const m = new RegExp(`^${key}\\s+(\\S+)$`, "m").exec(text);
  return m ? m[1]! : null;
}

/** `lib:name` → 库名与名字；没写库名就用默认库。 */
function splitRef(ref: string, defaultLib: string): { lib: string; name: string } {
  const i = ref.indexOf(":");
  if (i < 0) return { lib: defaultLib, name: ref };
  return { lib: ref.slice(0, i), name: ref.slice(i + 1) };
}

const options = parseArgs(process.argv.slice(2));
const projectRoot = resolve(options.project);
if (!existsDir(projectRoot)) fail(`项目目录不存在：${options.project}`);

const outDir = options.out
  ? resolve(options.out)
  : join("/tmp", "texteda-preview", options.id);
mkdirSync(outDir, { recursive: true });

function writeSvg(name: string, doc: ReturnType<typeof renderSymbol>): string {
  const problems = validateDoc(doc);
  if (problems.length > 0) {
    console.error(`  ！${name} 图形自检有 ${problems.length} 处问题：`);
    for (const p of problems.slice(0, 5)) console.error(`    ${p}`);
  }
  const path = join(outDir, `${name}.svg`);
  // 放大只改 width/height，不动 viewBox：几何比例不变，方便肉眼看细节。
  const svg = toSvgText(doc).replace(
    /width="([\d.]+)mm" height="([\d.]+)mm"/,
    (_, w: string, h: string) =>
      `width="${(Number(w) * options.scale).toFixed(3)}mm" height="${(Number(h) * options.scale).toFixed(3)}mm"`,
  );
  writeFileSync(path, svg);
  return path;
}

const written: string[] = [];

if (options.kind === "symbol" || options.kind === "component") {
  let symbolId = options.id;
  let symbolLib = options.lib;
  let part: { pins: { number: string; name: string; type: string }[] } | null = null;
  if (options.kind === "component") {
    const file = tedaFiles(join(projectRoot, "components")).find(
      (f) => basename(f, ".teda") === options.id,
    );
    if (!file) fail(`项目里没有器件 ${options.id}`);
    const text = readFileSync(file, "utf8");
    const ref = readRef(text, "symbol");
    if (!ref) fail(`器件 ${options.id} 没有 symbol 引用`);
    const split = splitRef(ref, options.lib);
    symbolLib = split.lib;
    symbolId = split.name;
    const facts = loadComponent(file);
    if (!facts.ok) fail(`器件 ${options.id} 读不出来`);
    part = {
      pins: facts.value.pins.map((p) => ({ number: p.number, name: p.name, type: p.type })),
    };
  } else {
    const owner = componentUsingSymbol(projectRoot, `${options.lib}:${symbolId}`);
    part = owner
      ? {
          pins: owner.facts.pins.map((p) => ({
            number: p.number,
            name: p.name,
            type: p.type,
          })),
        }
      : null;
  }
  const file = join(projectRoot, "symbols", symbolLib, `${symbolId}.teda`);
  if (!existsDir(join(projectRoot, "symbols", symbolLib)) || !existsFile(file)) {
    fail(`库里没有符号 ${symbolLib}:${symbolId}（找 ${file}）`);
  }
  const parsed = loadSymbol(file, symbolLib);
  if (!parsed.ok) {
    console.error(parsed.diagnostics.map((d) => `  ${formatDiagnostic(d)}`).join("\n"));
    fail(`符号 ${symbolId} 编译失败`);
  }
  if (!part) {
    console.error(
      `  ！没有器件引用 ${symbolLib}:${symbolId}，引脚名画不出来（用空名渲染）`,
    );
  }
  const doc = renderSymbol(parsed.value.symbol, { pins: part?.pins ?? [] });
  written.push(writeSvg(`${symbolId}.symbol`, doc));
}

if (options.kind === "footprint" || options.kind === "component") {
  let footprintId = options.id;
  let footprintLib = options.lib;
  if (options.kind === "component") {
    const file = tedaFiles(join(projectRoot, "components")).find(
      (f) => basename(f, ".teda") === options.id,
    );
    if (!file) fail(`项目里没有器件 ${options.id}`);
    const ref = readRef(readFileSync(file, "utf8"), "footprint");
    if (!ref) fail(`器件 ${options.id} 没有 footprint 引用`);
    const split = splitRef(ref, options.lib);
    footprintLib = split.lib;
    footprintId = split.name;
  }
  const file = join(projectRoot, "footprints", footprintLib, `${footprintId}.teda`);
  if (!existsDir(join(projectRoot, "footprints", footprintLib)) || !existsFile(file)) {
    fail(`库里没有封装 ${footprintLib}:${footprintId}（找 ${file}）`);
  }
  const parsed = loadFootprint(file, footprintLib);
  if (!parsed.ok) {
    console.error(parsed.diagnostics.map((d) => `  ${formatDiagnostic(d)}`).join("\n"));
    fail(`封装 ${footprintId} 编译失败`);
  }
  const doc = renderFootprint(parsed.value.footprint);
  written.push(writeSvg(`${footprintId}.footprint`, doc));
}

for (const path of written) console.log(path);
