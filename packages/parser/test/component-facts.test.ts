// `component` 事实投影的单元测试：只覆盖导出符号需要的部分。
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { readComponentFacts } from "../src/index.ts";

const example = readFileSync(
  "examples/reference-project/components/power/bq24610rger.teda",
  "utf8",
);

describe("component 事实投影", () => {
  test("读出引脚表、footprint、datasheet 与描述", () => {
    const result = readComponentFacts(example, { file: "x.teda" });
    expect(result.diagnostics).toEqual([]);
    expect(result.ok).toBe(true);
    const facts = result.facts!;
    expect(facts.id).toBe("bq24610rger");
    expect(facts.pins.length).toBe(25);
    expect(facts.pins[0]).toEqual({ number: "1", name: "ACN", type: "input" });
    expect(facts.footprint).toBe("project:vqfn-24-ep");
    expect(facts.datasheet).toContain("bq24610");
  });

  test("可选尾列 unit / alt 被接受", () => {
    const text = [
      "version 0.1",
      "component opamp",
      "",
      "pins",
      "  1  OUT  output  unit=2",
      "  2  IN   input   alt=AUX",
      "",
    ].join("\n");
    const result = readComponentFacts(text, { file: "x.teda" });
    expect(result.diagnostics).toEqual([]);
    expect(result.facts!.pins.length).toBe(2);
  });

  test("未知尾列报错", () => {
    const text = ["version 0.1", "component c", "", "pins", "  1  IN  input  colour=red"].join("\n");
    const result = readComponentFacts(text, { file: "x.teda" });
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]!.code).toBe("C007");
  });

  test("引脚号重复报错", () => {
    const text = ["version 0.1", "component c", "", "pins", "  1  IN  input", "  1  OUT output"].join(
      "\n",
    );
    const result = readComponentFacts(text, { file: "x.teda" });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "C005")).toBe(true);
  });

  test("未知电气类型报错", () => {
    const text = ["version 0.1", "component c", "", "pins", "  1  IN  weird"].join("\n");
    const result = readComponentFacts(text, { file: "x.teda" });
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]!.code).toBe("C004");
  });

  test("省略 pins（委托第三方库）在符号导出路径上被拒绝", () => {
    const text = ["version 0.1", "component r-0402", "", "symbol kicad:Device:R", ""].join("\n");
    const result = readComponentFacts(text, { file: "x.teda" });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "C006")).toBe(true);
  });

  test("类型行不是 component 报错", () => {
    const result = readComponentFacts("version 0.1\nsymbol s\n", { file: "x.teda" });
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]!.code).toBe("C001");
  });
});
