// Export on the reference project: the whole chain (pcb IR → fill → image → text) against a board
// that has a real pour. The numbers here are anchors measured when the fill landed (ADR-0054); if the
// kernel or the policy changes, they move and the test says so instead of drifting quietly.
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { area, normalize, type Point } from "@texteda/geom";
import { runExport, type ExportResult } from "../src/export.ts";

const project = join(import.meta.dir, "../../../examples/reference-project");

function exportTo(): { dir: string; result: ExportResult } {
  const dir = mkdtempSync(join(tmpdir(), "texteda-fab-"));
  const result = runExport({ root: project, board: "charger-buck", outDir: dir, json: true });
  return { dir, result };
}

/** Every `G36`/`G37` ring in a Gerber file, as board-space points. */
function regions(text: string): Point[][] {
  const rings: Point[][] = [];
  let current: Point[] | null = null;
  for (const line of text.split("\n")) {
    if (line === "G36*") {
      current = [];
      continue;
    }
    if (line === "G37*") {
      if (current !== null && current.length > 2) rings.push(current);
      current = null;
      continue;
    }
    if (current === null) continue;
    const match = /^X(-?\d+)Y(-?\d+)D0[12]\*$/.exec(line);
    if (match) current.push({ x_nm: Number(match[1]), y_nm: Number(match[2]) });
  }
  return rings;
}

describe("export gerbers on the reference board", () => {
  test("writes one file per copper layer, the edge layer, and one drill file", () => {
    const { dir, result } = exportTo();
    try {
      expect(result.exitCode).toBe(0);
      expect(result.files.map((file) => file.name)).toEqual([
        "charger-buck-F_Cu.gbr",
        "charger-buck-B_Cu.gbr",
        "charger-buck-Edge_Cuts.gbr",
        "charger-buck.drl",
      ]);
      for (const file of result.files) expect(existsSync(join(dir, file.name))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the GND pour keeps the area the fill computed", () => {
    const { dir, result } = exportTo();
    try {
      // The anchor: 1672.0632 mm² with `min_width 0.15` on the reference board.
      expect(result.pours.length).toBe(1);
      expect(result.pours[0]!.net).toBe("GND");
      expect(result.pours[0]!.layer).toBe("B.Cu");
      expect(result.pours[0]!.area_nm2 / 1_000_000_000_000).toBeCloseTo(1672.0632, 3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the written Gerber says the same area the fill computed (the file is a projection)", () => {
    const { dir, result } = exportTo();
    try {
      const text = readFileSync(join(dir, "charger-buck-B_Cu.gbr"), "utf8");
      const rings = regions(text).map((ring) => normalize(ring));
      const total = rings.reduce((sum, ring) => sum + area(ring), 0);
      expect(rings.length).toBe(result.pours[0]!.area_nm2 > 0 ? rings.length : 0);
      expect(total).toBe(result.pours[0]!.area_nm2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("two exports of the same project are byte-identical", () => {
    const first = exportTo();
    const second = exportTo();
    try {
      for (const file of first.result.files) {
        expect(readFileSync(join(second.dir, file.name), "utf8")).toBe(readFileSync(join(first.dir, file.name), "utf8"));
      }
    } finally {
      rmSync(first.dir, { recursive: true, force: true });
      rmSync(second.dir, { recursive: true, force: true });
    }
  });

  test("every file carries the project hash, not a hash of its own bytes", () => {
    const { dir, result } = exportTo();
    try {
      const stamp = result.stamp.source_hash;
      expect(stamp).toMatch(/^[0-9a-f]{64}$/);
      expect(readFileSync(join(dir, "charger-buck-B_Cu.gbr"), "utf8")).toContain(`G04 source ${stamp}*`);
      expect(readFileSync(join(dir, "charger-buck.drl"), "utf8")).toContain(`;source ${stamp}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the drill file has one tool per diameter, ascending, and states the unplated count", () => {
    const { dir } = exportTo();
    try {
      const text = readFileSync(join(dir, "charger-buck.drl"), "utf8");
      const lines = text.split("\n");
      expect(lines[0]).toBe("M48");
      expect(lines).toContain("FMAT,2");
      expect(lines).toContain("METRIC,TZ");
      // Vias are 0.3 mm plated; the four mounting holes are 3.2 mm non-plated.
      expect(lines).toContain("T1C0.300000");
      expect(lines).toContain("T2C3.200000");
      expect(lines).toContain(";unplated: 4");
      expect(text.endsWith("M30\n")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a board without a pcb description is refused, not silently empty", () => {
    const dir = mkdtempSync(join(tmpdir(), "texteda-fab-"));
    try {
      const result = runExport({ root: project, board: "mcu-board", outDir: dir, json: true });
      expect(result.exitCode).toBe(1);
      expect(result.files).toEqual([]);
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain("cli.export-no-board");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("an unknown board is refused with the same code", () => {
    const dir = mkdtempSync(join(tmpdir(), "texteda-fab-"));
    try {
      const result = runExport({ root: project, board: "no-such-board", outDir: dir, json: true });
      expect(result.exitCode).toBe(1);
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "cli.export-no-board")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
