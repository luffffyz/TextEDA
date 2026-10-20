// 项目库读取：预览命令与冒烟脚本共用"编译"这一半。
//
// 三件事：找文件、编译（.teda → IR）、把器件事实读出来。
// 渲染在 @texteda/renderer，导出在 @texteda/exporter——这里只管"读进来"。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  parseFootprint,
  parseSymbol,
  readComponentFacts,
  type ComponentFacts,
  type Diagnostic,
} from "@texteda/parser";
import type { Footprint } from "@texteda/ir/footprint";
import type { Symbol } from "@texteda/ir/symbol";

/** 递归列出目录下的 `.teda` 源文件（按路径排序，顺序稳定）。 */
export function tedaFiles(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries.sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tedaFiles(full));
    else if (entry.endsWith(".teda")) out.push(full);
  }
  return out;
}

export type Loaded<T> =
  | { ok: true; value: T; diagnostics: Diagnostic[] }
  | { ok: false; diagnostics: Diagnostic[] };

/** 编译一个符号源文件。 */
export function loadSymbol(file: string, library: string): Loaded<Symbol> {
  const parsed = parseSymbol(readFileSync(file, "utf8"), { file, library });
  if (!parsed.ok || !parsed.ir) return { ok: false, diagnostics: parsed.diagnostics };
  return { ok: true, value: parsed.ir, diagnostics: parsed.diagnostics };
}

/** 编译一个封装源文件。 */
export function loadFootprint(file: string, library: string): Loaded<Footprint> {
  const parsed = parseFootprint(readFileSync(file, "utf8"), { file, library });
  if (!parsed.ok || !parsed.ir) return { ok: false, diagnostics: parsed.diagnostics };
  return { ok: true, value: parsed.ir, diagnostics: parsed.diagnostics };
}

/** 读一个器件描述的事实（引脚名与电气类型的唯一所有者，ADR-0012）。 */
export function loadComponent(file: string): Loaded<ComponentFacts> {
  const facts = readComponentFacts(readFileSync(file, "utf8"), { file });
  if (!facts.ok || !facts.facts) return { ok: false, diagnostics: facts.diagnostics };
  return { ok: true, value: facts.facts, diagnostics: facts.diagnostics };
}

/** 引用某个符号的器件（一个符号可被多个器件复用，取第一个）。 */
export function componentUsingSymbol(
  projectRoot: string,
  ref: string,
): { file: string; facts: ComponentFacts } | null {
  for (const file of tedaFiles(join(projectRoot, "components"))) {
    const text = readFileSync(file, "utf8");
    const m = /^symbol\s+(\S+)$/m.exec(text);
    if (!m || m[1] !== ref) continue;
    const loaded = loadComponent(file);
    if (!loaded.ok) continue;
    return { file, facts: loaded.value };
  }
  return null;
}
