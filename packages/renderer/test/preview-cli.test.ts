// 预览命令的行为（薄壳，但失败信息要说清是哪一步）。
// 渲染本身在 packages/renderer/test/roundtrip.test.ts 里验。
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const script = join(repoRoot, "scripts", "preview.ts");

function runPreview(args: string[]): { code: number; stdout: string; stderr: string } {
  const proc = Bun.spawnSync(["bun", "run", script, ...args], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    code: proc.exitCode,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}

describe("preview 命令", () => {
  test("component：出符号与封装两张图", () => {
    const out = mkdtempSync(join(tmpdir(), "texteda-preview-test-"));
    const run = runPreview(["component", "bq24610rger", "--out", out]);
    expect(run.stderr).toBe("");
    expect(run.code).toBe(0);
    const files = run.stdout.trim().split("\n").filter((l) => l.length > 0);
    expect(files.length).toBe(2);
    for (const file of files) {
      expect(statSync(file).size).toBeGreaterThan(0);
    }
    const symbol = files.find((f) => f.endsWith(".symbol.svg"))!;
    const footprint = files.find((f) => f.endsWith(".footprint.svg"))!;
    // 符号图里 25 条引脚线（外形是 rect，不混进来）。
    const symbolSvg = readFileSync(symbol, "utf8");
    expect((symbolSvg.match(/<line /g) ?? []).length).toBe(25);
    expect(symbolSvg).toContain("<rect");
    // 封装图里 25 个焊盘（铜层颜色 #b45309 的填充矩形）。
    const footprintSvg = readFileSync(footprint, "utf8");
    expect((footprintSvg.match(/fill="#b45309" stroke="none"/g) ?? []).length).toBe(25);
  });

  test("库里没有这个 id：报清楚并退出非 0", () => {
    const run = runPreview(["footprint", "nonexistent"]);
    expect(run.code).not.toBe(0);
    expect(run.stderr).toContain("nonexistent");
    expect(run.stderr).toContain("库里没有");
  });

  test("未知参数：报清楚并退出非 0", () => {
    const run = runPreview(["footprint", "sot-23", "--nope"]);
    expect(run.code).not.toBe(0);
    expect(run.stderr).toContain("未知参数");
  });
});
