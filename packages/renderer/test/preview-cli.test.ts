// Behavior of the preview command (a thin shell, but failure messages must clearly say which step failed).
// The rendering itself is verified in packages/renderer/test/roundtrip.test.ts.
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

describe("preview command", () => {
  test("component: emits a symbol drawing and a footprint drawing", () => {
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
    // 25 pin lines in the symbol drawing (the outline is a rect and does not count).
    const symbolSvg = readFileSync(symbol, "utf8");
    expect((symbolSvg.match(/<line /g) ?? []).length).toBe(25);
    expect(symbolSvg).toContain("<rect");
    // 25 pads in the footprint drawing (filled rectangles in copper color #b45309).
    const footprintSvg = readFileSync(footprint, "utf8");
    expect((footprintSvg.match(/fill="#b45309" stroke="none"/g) ?? []).length).toBe(25);
  });

  test("id not in library: report it clearly and exit non-zero", () => {
    const run = runPreview(["footprint", "nonexistent"]);
    expect(run.code).not.toBe(0);
    expect(run.stderr).toContain("nonexistent");
    expect(run.stderr).toContain("not in library");
  });

  test("view: draws a page from its view file", () => {
    const out = mkdtempSync(join(tmpdir(), "texteda-preview-test-"));
    const run = runPreview(["view", "charger-buck/buck-5v", "--out", out]);
    expect(run.stderr).toBe("");
    expect(run.code).toBe(0);
    const files = run.stdout.trim().split("\n").filter((l) => l.length > 0);
    expect(files).toHaveLength(1);
    const svg = readFileSync(files[0]!, "utf8");
    expect(svg).toContain("<title>charger-buck/buck-5v</title>");
    // The placed instances name themselves; the library placeholder (`U`) must not survive.
    expect(svg).toContain("<title>C19</title>");
    expect(svg).toContain("<title>U2</title>");
    expect(svg).toContain("<title>GND</title>");
  });

  test("view without a view file: report it clearly and exit non-zero", () => {
    const run = runPreview(["view", "charger-buck/nonexistent"]);
    expect(run.code).not.toBe(0);
    expect(run.stderr).toContain("no print page");
  });

  test("unknown argument: report it clearly and exit non-zero", () => {
    const run = runPreview(["footprint", "sot-23", "--nope"]);
    expect(run.code).not.toBe(0);
    expect(run.stderr).toContain("unknown argument");
  });
});
