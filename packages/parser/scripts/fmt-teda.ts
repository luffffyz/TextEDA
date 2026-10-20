#!/usr/bin/env bun
// `.teda` 表面格式化：canonical form（各描述规范 §8）。
//
// 用法：bun run scripts/fmt-teda.ts [--check] [--stdout] [--library <name>] <file.teda|dir>...
//   目录   递归处理其中的 *.teda。
//   默认   就地重写（内容没变就不写）。
//   --check 只检查；不是 canonical 时打印文件并退出 1（CI / pre-commit 用）。
//   --stdout 打到标准输出，不改文件。
//   --library 库名；缺省取文件所在目录名。
//
// 按文件的类型行分发：目前实现了 `footprint` 与 `symbol`；其他描述类型先跳过
// （它们的 fmt 还没实现），显式点名则报错，避免"以为格式化过了"。
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import {
  descriptionType,
  formatDiagnostic,
  formatFootprint,
  formatSymbol,
  type FormatResult,
} from "../src/index.ts";

const argv = process.argv.slice(2);
const check = argv.includes("--check");
const toStdout = argv.includes("--stdout");
const libraryIdx = argv.indexOf("--library");
const libraryFlag = libraryIdx >= 0 ? argv[libraryIdx + 1] : undefined;
const targets = argv.filter(
  (arg, i) => !arg.startsWith("--") && !(libraryIdx >= 0 && i === libraryIdx + 1),
);

if (targets.length === 0) {
  console.error(
    "用法：bun run scripts/fmt-teda.ts [--check] [--stdout] [--library <name>] <file.teda|dir>...",
  );
  process.exit(2);
}

interface Work {
  file: string;
  /** 来自目录展开：类型还没实现的直接跳过。 */
  fromDirectory: boolean;
}

/** 目录递归展开（只收 .teda），保持字节序，输出稳定。 */
function expand(target: string): Work[] {
  if (!statSync(target).isDirectory()) return [{ file: target, fromDirectory: false }];
  return readdirSync(target, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".teda"))
    .map((entry) => ({ file: join(entry.parentPath, entry.name), fromDirectory: true }))
    .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
}

const files: Work[] = [];
let unreadable = false;
for (const target of targets) {
  try {
    files.push(...expand(target));
  } catch (error) {
    console.error(`${target}: 无法读取（${(error as Error).message}）`);
    unreadable = true;
  }
}
if (files.length === 0 && unreadable) process.exit(1);

let failed = false;
for (const { file, fromDirectory } of files) {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    console.error(`${file}: 无法读取（${(error as Error).message}）`);
    failed = true;
    continue;
  }
  const type = descriptionType(text);
  const library = libraryFlag ?? basename(dirname(file));
  let result: FormatResult;
  if (type === "footprint") {
    result = formatFootprint(text, { file, library });
  } else if (type === "symbol") {
    result = formatSymbol(text, { file, library });
  } else if (fromDirectory) {
    continue;
  } else {
    console.error(`${file}: 还没有实现这种描述类型的格式化（${type ?? "未知类型"}）`);
    failed = true;
    continue;
  }

  for (const diagnostic of result.diagnostics) console.error(formatDiagnostic(diagnostic));
  if (!result.ok || result.text === undefined) {
    failed = true;
    continue;
  }
  if (toStdout) {
    process.stdout.write(result.text);
    continue;
  }
  if (result.text === text) continue;
  if (check) {
    console.error(`${file}: 不是 canonical form（运行 fmt:teda 修复）`);
    failed = true;
    continue;
  }
  writeFileSync(file, result.text);
}

process.exit(failed ? 1 : 0);
