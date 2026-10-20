// round-trip：`extract(render(ir)) == ir`（AGENTS.md §10）。
//
// 两端各算一次"语义投影"，比的是投影不是 IR 本体——
// IR 里有些字段（比如符号的单元数）图形上表达不出来，投影里只留能反解的部分。
// 覆盖面用参考工程的整库（16 个封装 + 全部符号），不是几个手挑样例。
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFootprint, parseSymbol, readComponentFacts } from "@texteda/parser";
import {
  extractFootprint,
  extractSymbol,
  footprintProjection,
  renderFootprint,
  renderSymbol,
  symbolProjection,
  toSvgText,
} from "../src/index.ts";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const projectRoot = join(repoRoot, "examples/reference-project");

function tedaFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tedaFiles(full));
    else if (entry.endsWith(".teda")) out.push(full);
  }
  return out;
}

const symbolFiles = tedaFiles(join(projectRoot, "symbols", "project"));
const footprintFiles = tedaFiles(join(projectRoot, "footprints", "project"));
const componentFiles = tedaFiles(join(projectRoot, "components"));

/** 引用某个符号的器件（引脚名与电气类型的唯一所有者，ADR-0012）。 */
function partForSymbol(ref: string): { pins: { number: string; name: string; type: string }[] } {
  for (const file of componentFiles) {
    const text = readFileSync(file, "utf8");
    const m = /^symbol\s+(\S+)$/m.exec(text);
    if (!m || m[1] !== ref) continue;
    const facts = readComponentFacts(text, { file });
    if (!facts.ok || !facts.facts) continue;
    return {
      pins: facts.facts.pins.map((p) => ({ number: p.number, name: p.name, type: p.type })),
    };
  }
  return { pins: [] };
}

describe("符号 round-trip", () => {
  test("参考工程的每个符号：渲染后能反解回等价投影", () => {
    expect(symbolFiles.length).toBeGreaterThan(0);
    for (const file of symbolFiles) {
      const parsed = parseSymbol(readFileSync(file, "utf8"), { file, library: "project" });
      expect(parsed.ok).toBe(true);
      if (!parsed.ok || !parsed.ir) continue;
      const sym = parsed.ir.symbol;
      const part = partForSymbol(`project:${sym.name}`);
      const doc = renderSymbol(sym, part);
      expect(extractSymbol(doc)).toEqual(symbolProjection(sym));
    }
  });

  test("引脚名与电气类型不写进符号：换个器件渲染，符号投影不变", () => {
    const file = symbolFiles.find((f) => f.endsWith("bq24610rger.teda"))!;
    const parsed = parseSymbol(readFileSync(file, "utf8"), { file, library: "project" });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok || !parsed.ir) return;
    const sym = parsed.ir.symbol;
    const withNames = renderSymbol(sym, {
      pins: sym.pins.map((p) => ({ number: p.number, name: "X", type: "input" })),
    });
    const withOtherNames = renderSymbol(sym, {
      pins: sym.pins.map((p) => ({ number: p.number, name: "Y", type: "output" })),
    });
    const strip = (doc: ReturnType<typeof renderSymbol>) =>
      extractSymbol(doc).pins.map((p) => ({ ...p }));
    expect(strip(withNames)).toEqual(strip(withOtherNames));
    // 名字会出现在图上，但不在投影里（名字归器件所有）。
    expect(toSvgText(withNames)).not.toBe(toSvgText(withOtherNames));
  });
});

describe("投影的敏感度", () => {
  test("改一个焊盘的位置，反解结果就不同（round-trip 不是空转）", () => {
    const file = footprintFiles.find((f) => f.endsWith("vqfn-24-ep.teda"))!;
    const parsed = parseFootprint(readFileSync(file, "utf8"), { file, library: "project" });
    if (!parsed.ok || !parsed.ir) throw new Error("参考封装解析失败");
    const before = extractFootprint(renderFootprint(parsed.ir.footprint));
    const moved = structuredClone(parsed.ir.footprint);
    moved.pads[0]!.at.x_nm += 1_000_000;
    const after = extractFootprint(renderFootprint(moved));
    expect(after.pads[0]!.x_nm).toBe(before.pads[0]!.x_nm + 1_000_000);
    expect(after).not.toEqual(before);
  });

  test("符号引脚都能在器件里找到名字（隐藏开关才可反解）", () => {
    for (const file of symbolFiles) {
      const parsed = parseSymbol(readFileSync(file, "utf8"), { file, library: "project" });
      if (!parsed.ok || !parsed.ir) continue;
      const sym = parsed.ir.symbol;
      const part = partForSymbol(`project:${sym.name}`);
      const named = new Set(part.pins.filter((p) => p.name.length > 0).map((p) => p.number));
      for (const pin of sym.pins) {
        if (sym.pin_names_hidden) continue;
        expect(named.has(pin.number)).toBe(true);
      }
    }
  });
});

describe("封装 round-trip", () => {
  test("参考工程的每个封装：渲染后能反解回等价投影", () => {
    expect(footprintFiles.length).toBeGreaterThan(0);
    for (const file of footprintFiles) {
      const parsed = parseFootprint(readFileSync(file, "utf8"), { file, library: "project" });
      expect(parsed.ok).toBe(true);
      if (!parsed.ok || !parsed.ir) continue;
      const fp = parsed.ir.footprint;
      const doc = renderFootprint(fp);
      expect(extractFootprint(doc)).toEqual(footprintProjection(fp));
    }
  });
});

describe("确定性", () => {
  test("同一份 IR 渲染两次：字节相同", () => {
    const symbolFile = symbolFiles[0]!;
    const parsed = parseSymbol(readFileSync(symbolFile, "utf8"), {
      file: symbolFile,
      library: "project",
    });
    if (!parsed.ok || !parsed.ir) throw new Error("参考符号解析失败");
    const part = partForSymbol(`project:${parsed.ir.symbol.name}`);
    const a = toSvgText(renderSymbol(parsed.ir.symbol, part));
    const b = toSvgText(renderSymbol(parsed.ir.symbol, part));
    expect(a).toBe(b);
  });

  test("同一份封装 IR 渲染两次：字节相同", () => {
    const fpFile = footprintFiles[0]!;
    const parsed = parseFootprint(readFileSync(fpFile, "utf8"), {
      file: fpFile,
      library: "project",
    });
    if (!parsed.ok || !parsed.ir) throw new Error("参考封装解析失败");
    const a = toSvgText(renderFootprint(parsed.ir.footprint));
    const b = toSvgText(renderFootprint(parsed.ir.footprint));
    expect(a).toBe(b);
  });
});
