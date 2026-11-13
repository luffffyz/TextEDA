// `texteda view png`: the print page painted into a picture (spec/rendering.md §2).
//
// The picture is for looking at, so what matters here is that the command produces a real PNG of
// the page, that the crop and the width reach the renderer, and that a bad argument says so
// instead of writing a broken file.
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = join(import.meta.dir, "../scripts/texteda.ts");
const projectRoot = join(import.meta.dir, "../../../examples/reference-project");

function run(args: string[]): { code: number; stdout: string; stderr: string } {
  const proc = Bun.spawnSync(["bun", "run", script, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    code: proc.exitCode,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}

function pngHeader(file: string): { width: number; height: number } {
  const bytes = readFileSync(file);
  expect(Array.from(bytes.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!)).toBe("IHDR");
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

describe("view png", () => {
  test("paints the page into a PNG file", () => {
    const dir = mkdtempSync(join(tmpdir(), "texteda-png-"));
    try {
      const out = join(dir, "page.png");
      const result = run(["view", "png", projectRoot, "main", "--out", out, "--width", "400"]);
      expect(result.stderr).toBe("");
      expect(result.code).toBe(0);
      expect(existsSync(out)).toBe(true);
      const header = pngHeader(out);
      expect(header.width).toBe(400);
      expect(header.height).toBeGreaterThan(0);
      expect(result.stdout).toContain("400×");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a crop paints only the cropped part of the page", () => {
    const dir = mkdtempSync(join(tmpdir(), "texteda-png-"));
    try {
      const whole = join(dir, "whole.png");
      const cropped = join(dir, "cropped.png");
      const width = 300;
      run(["view", "png", projectRoot, "main", "--out", whole, "--width", String(width)]);
      run([
        "view",
        "png",
        projectRoot,
        "main",
        "--out",
        cropped,
        "--width",
        String(width),
        "--crop",
        "40,40,140,140",
      ]);
      const wholeHeader = pngHeader(whole);
      const croppedHeader = pngHeader(cropped);
      expect(croppedHeader.width).toBe(width);
      // The crop is a 100 mm square of a 594 × 420 mm sheet: square in the picture, and bigger than
      // the whole page at the same width, because the crop is a zoom.
      expect(croppedHeader.height).toBe(width);
      expect(croppedHeader.height).toBeGreaterThan(wholeHeader.height);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a malformed crop is a usage error and writes nothing", () => {
    const dir = mkdtempSync(join(tmpdir(), "texteda-png-"));
    try {
      const out = join(dir, "page.png");
      const result = run(["view", "png", projectRoot, "main", "--out", out, "--crop", "40,40"]);
      expect(result.code).toBe(2);
      expect(result.stderr).toContain("cli.bad-usage");
      expect(existsSync(out)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a page that does not exist says so", () => {
    const result = run(["view", "png", projectRoot, "no-such-page"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("Print page no-such-page not found");
  });
});
