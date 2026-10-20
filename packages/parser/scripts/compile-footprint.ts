#!/usr/bin/env bun
// 编译 `footprint` 描述：`.teda` 源码 → IR 分片（canonical JSON）。
//
// 用法：bun run scripts/compile-footprint.ts <file.teda> [--library <name>] [--out <file>]
//   --library  库名（IR 的 footprint.library）；缺省取文件所在目录名。
//   --out      输出文件；缺省打到标准输出。
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { validate } from "@texteda/ir";
import { canonicalJson, formatDiagnostic, parseFootprint } from "../src/index.ts";

const args = process.argv.slice(2);
const file = args[0];
if (!file) {
  console.error("用法：bun run scripts/compile-footprint.ts <file.teda> [--library <name>] [--out <file>]");
  process.exit(2);
}

const libraryIdx = args.indexOf("--library");
const outIdx = args.indexOf("--out");
const library =
  libraryIdx >= 0 ? args[libraryIdx + 1]! : basename(dirname(file));

const text = readFileSync(file, "utf8");
const parsed = parseFootprint(text, { file, library });

for (const d of parsed.diagnostics) console.error(formatDiagnostic(d));
if (!parsed.ok || !parsed.ir) process.exit(1);

const check = validate("footprint", parsed.ir);
if (!check.ok) {
  for (const e of check.errors) {
    console.error(`${file}:1:1: error SCHEMA: ${e.path || "/"}: ${e.message}`);
  }
  process.exit(1);
}

const json = canonicalJson(parsed.ir);
if (outIdx >= 0) {
  const out = args[outIdx + 1]!;
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, json);
  console.log(`wrote ${out}`);
} else {
  process.stdout.write(json);
}
