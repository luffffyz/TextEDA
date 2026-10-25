// The `texteda view-metrics` command: the numbers an agent iterates on while drawing a page
// (spec/schematic-view.md §9.4).
//
// Exercised on the reference project: the buck page is fully wired, the charger-power page is a
// placement sketch with no wires, so the two pages show both ends of the signal.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";

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

describe("texteda view-metrics", () => {
  test("a wired page reports every label on its net", () => {
    const result = run(["view-metrics", project, "charger-buck/buck-5v", "--json"]);
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
    const result = run(["view-metrics", project, "charger-buck/charger-power", "--json"]);
    expect(result.code).toBe(0);
    const metrics = JSON.parse(result.stdout) as Metrics;
    expect(metrics.counts.wires).toBe(0);
    expect(metrics.counts.ports).toBe(4);
    // No wiring at all: every port is a tag in empty space, and the distance says how far.
    expect(metrics.net_texts.every((text) => text.distance_nm > 0)).toBe(true);
  });

  test("the human form names the page and its spacing", () => {
    const result = run(["view-metrics", project, "charger-buck/buck-5v"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("charger-buck/buck-5v");
    expect(result.stdout).toContain("label min gap");
    expect(result.stdout).toContain("net texts all sit on their nets");
  });

  test("a page that does not exist is a usage failure, not a crash", () => {
    const missing = run(["view-metrics", project, "charger-buck/nope"]);
    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain("not found");

    const malformed = run(["view-metrics", project, "charger-buck"]);
    expect(malformed.code).toBe(2);
    expect(malformed.stderr).toContain("board/page");
  });
});
