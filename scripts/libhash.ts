#!/usr/bin/env bun
/**
 * 计算项目自建库的内容哈希（ADR-0010 决策 2 与「两个根」补充）。
 *
 * 规范：SHA-256( 所有库根下全部文件，按**项目相对路径**排序后逐行
 * "<path>:<file_sha256>\n" 拼接 )。
 * `path` 就是命令行给出的根路径 + 文件相对路径，"/" 分隔、不带 "./" 前缀、
 * 不带结尾斜杠；排序按字节序（LC_ALL=C）。
 *
 * 用法：bun run lib:hash <库目录>...      # 例如 symbols/project footprints/project
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

function walk(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full, base));
    else out.push(relative(base, full).split(sep).join("/"));
  }
  return out;
}

/** 命令行的根路径规整：去掉 "./" 前缀与结尾斜杠，反斜杠统一成 "/"。 */
function normalizeRoot(root: string): string {
  return root.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

const roots = process.argv.slice(2).map(normalizeRoot).filter((r) => r.length > 0);
if (roots.length === 0) {
  console.error("用法：bun run lib:hash <库目录>...");
  process.exit(2);
}

const entries: string[] = [];
for (const root of roots) {
  let files: string[];
  try {
    files = walk(root);
  } catch (error) {
    console.error(`${root}: 无法读取（${(error as Error).message}）`);
    process.exit(1);
  }
  if (files.length === 0) {
    console.error(`目录为空：${root}`);
    process.exit(1);
  }
  for (const rel of files) entries.push(`${root}/${rel}`);
}

entries.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
const hash = createHash("sha256");
for (const path of entries) {
  const fileHash = createHash("sha256").update(readFileSync(path)).digest("hex");
  hash.update(`${path}:${fileHash}\n`);
}

console.log(hash.digest("hex"));
console.error(`共 ${entries.length} 个文件，${roots.length} 个根`);
