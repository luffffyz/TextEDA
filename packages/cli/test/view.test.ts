// The `texteda view` commands: the numbers an agent iterates on while drawing a page, and the
// drawing it can look at (spec/schematic-view.md §9.4).
//
// Exercised on the reference project: the buck page is fully wired, the charger-power page is a
// placement sketch with no wires, so the two pages show both ends of the signal.
import { describe, expect, test } from "bun:test";
import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const script = join(import.meta.dir, "../scripts/texteda.ts");
const project = join(import.meta.dir, "../../../examples/reference-project");

function run(args: string[]): { code: number; stdout: string; stderr: string } {
  const proc = Bun.spawnSync(["bun", "run", script, ...args], { stdout: "pipe", stderr: "pipe" });
  return { code: proc.exitCode, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
}

interface Metrics {
  board: string;
  page: string;
  content_fill_ppm: number;
  counts: Record<string, number>;
  label_min_gap_nm: number | null;
  wire_total_nm: number;
  wire_crossings: number;
  wires_through_bodies: number;
  net_texts: { kind: string; text: string; net: string; distance_nm: number }[];
}

describe("texteda view metrics", () => {
  test("a wired page reports every label on its net", () => {
    const result = run(["view", "metrics", project, "charger-buck/buck-5v", "--json"]);
    expect(result.code).toBe(0);
    const metrics = JSON.parse(result.stdout) as Metrics;
    expect(metrics.board).toBe("charger-buck");
    expect(metrics.page).toBe("buck-5v");
    expect(metrics.counts.labels).toBe(9);
    expect(metrics.wire_total_nm).toBeGreaterThan(0);
    expect(metrics.content_fill_ppm).toBeGreaterThan(0);
    expect(metrics.content_fill_ppm).toBeLessThan(1_000_000);
    expect(metrics.net_texts.filter((text) => text.distance_nm > 0)).toEqual([]);
  });

  test("a placement sketch reports each port's distance from its net", () => {
    const result = run(["view", "metrics", project, "charger-buck/charger-power", "--json"]);
    expect(result.code).toBe(0);
    const metrics = JSON.parse(result.stdout) as Metrics;
    expect(metrics.counts.wires).toBe(0);
    expect(metrics.counts.ports).toBe(4);
    // No wiring at all: every port is a tag in empty space, and the distance says how far.
    expect(metrics.net_texts.every((text) => text.distance_nm > 0)).toBe(true);
  });

  test("the human form names the page and its spacing", () => {
    const result = run(["view", "metrics", project, "charger-buck/buck-5v"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("charger-buck/buck-5v");
    expect(result.stdout).toContain("label min gap");
    expect(result.stdout).toContain("net texts all sit on their nets");
  });

  test("a page that does not exist is a usage failure, not a crash", () => {
    const missing = run(["view", "metrics", project, "charger-buck/nope"]);
    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain("not found");

    const malformed = run(["view", "metrics", project, "charger-buck"]);
    expect(malformed.code).toBe(2);
    expect(malformed.stderr).toContain("board/page");
  });

  test("the old command name says where it went", () => {
    const result = run(["view-metrics", project, "charger-buck/buck-5v"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("texteda view metrics");
  });
});

describe("texteda view rewire", () => {
  /** A copy of the reference project, so a test can move a symbol without touching the original. */
  function copyProject(): string {
    const dir = join(tmpdir(), `texteda-view-rewire-${process.pid}-${Math.random().toString(36).slice(2)}`);
    cpSync(project, dir, { recursive: true });
    return dir;
  }

  test("a moved symbol pulls its wires onto it", () => {
    const dir = copyProject();
    const page = join(dir, "views/charger-buck/buck-5v.view.teda");
    const text = readFileSync(page, "utf8").replace("  M2.U1  140.0  105.0  0", "  M2.U1  150.0  105.0  0");
    writeFileSync(page, text);

    // Before: the wires that left the moved symbol are no longer on the axes.
    const before = run(["check", dir]);
    expect(before.stderr).toContain("view.wire-diagonal");

    const dry = run(["view", "rewire", dir, "charger-buck/buck-5v", "--dry-run", "--json"]);
    expect(dry.code).toBe(0);
    const preview = JSON.parse(dry.stdout) as { written: boolean; rewired: string[]; conflicts: string[] };
    expect(preview.written).toBe(false);
    expect(preview.rewired.length).toBeGreaterThan(0);
    expect(preview.conflicts).toEqual([]);
    // A dry run writes nothing.
    expect(readFileSync(page, "utf8")).toBe(text);

    const applied = run(["view", "rewire", dir, "charger-buck/buck-5v", "--json"]);
    expect(applied.code).toBe(0);
    const result = JSON.parse(applied.stdout) as { written: boolean; file: string };
    expect(result.written).toBe(true);
    expect(result.file).toBe("views/charger-buck/buck-5v.view.teda");

    // After: every wire is back on the axes, and the interior corners kept their place.
    const after = run(["check", dir]);
    expect(after.stderr).not.toContain("view.wire-diagonal");
    const rewritten = readFileSync(page, "utf8");
    expect(rewritten).toContain("M2.U1  150.0  105.0  0");
    // The wire's interior corner (120, 120) is where it was; only the end moved.
    expect(rewritten).toContain("120.0 120.0");
  });

  test("a page that needs nothing is reported as such", () => {
    const dir = copyProject();
    const result = run(["view", "rewire", dir, "charger-buck/buck-5v"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("No wire needed re-anchoring");
  });
});

describe("texteda view render", () => {
  test("the drawing is written as an SVG file", () => {
    const out = join(tmpdir(), `texteda-view-render-${process.pid}.svg`);
    const result = run(["view", "render", project, "charger-buck/buck-5v", "--out", out]);
    expect(result.code).toBe(0);
    expect(existsSync(out)).toBe(true);
    const svg = readFileSync(out, "utf8");
    expect(svg).toContain("<svg");
    // The page's nine labels are on the drawing: the same page the review app shows.
    expect(svg).toContain("M2.BOOT");
  });

  test("the json form names the file it wrote", () => {
    const out = join(tmpdir(), `texteda-view-render-json-${process.pid}.svg`);
    const result = run(["view", "render", project, "charger-buck/buck-5v", "--out", out, "--json"]);
    expect(result.code).toBe(0);
    const value = JSON.parse(result.stdout) as { file: string; svg_file: string; bytes: number };
    expect(value.file).toBe("views/charger-buck/buck-5v.view.teda");
    expect(value.svg_file).toBe(out);
    expect(value.bytes).toBeGreaterThan(0);
  });

  test("an unknown subcommand is a usage failure", () => {
    const result = run(["view", "nope", project, "charger-buck/buck-5v"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("Unknown view subcommand");
  });
});
