// Export on the reference project: the whole chain (pcb IR → fill → image → text) against a board
// that has a real pour. The numbers here are anchors measured when the fill landed (ADR-0117); if the
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
  test("writes the copper, mask, paste and silk layers, the edge layer, and one drill file", () => {
    const { dir, result } = exportTo();
    try {
      expect(result.exitCode).toBe(0);
      // Copper from the stackup, then each side's mask/paste/silk (top first), then the edge; the
      // drill file last (spec/pcb.md §8.2).
      expect(result.files.map((file) => file.name)).toEqual([
        "charger-buck-F_Cu.gbr",
        "charger-buck-B_Cu.gbr",
        "charger-buck-F_Mask.gbr",
        "charger-buck-F_Paste.gbr",
        "charger-buck-F_SilkS.gbr",
        "charger-buck-B_Mask.gbr",
        "charger-buck-B_Paste.gbr",
        "charger-buck-B_SilkS.gbr",
        "charger-buck-Edge_Cuts.gbr",
        "charger-buck.drl",
      ]);
      for (const file of result.files) expect(existsSync(join(dir, file.name))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the mask openings are the pads grown by the board's 0.05 mm expansion", () => {
    const { dir } = exportTo();
    try {
      const text = readFileSync(join(dir, "charger-buck-F_Mask.gbr"), "utf8");
      // Every pad on this board is a rectangle or a rounded rectangle, so an opening is a region and
      // not a flash: a flash would bury the expansion inside a diameter the reader has to derive.
      expect(text).toContain("G36*");
      const maskRings = regions(text);
      // The copper image holds the same pads (the pour is on B.Cu, traces are strokes), so the two
      // counts match one for one and the areas differ by the expansion.
      const padRings = regions(readFileSync(join(dir, "charger-buck-F_Cu.gbr"), "utf8"));
      expect(maskRings.length).toBe(padRings.length);
      const mm2 = (rings: Point[][]) => rings.reduce((sum, ring) => sum + area(normalize(ring)), 0) / 1_000_000_000_000;
      // 0.05 mm on every edge of 25 small pads: tens of square millimetres more than the pads alone.
      expect(mm2(maskRings)).toBeGreaterThan(mm2(padRings));
      expect(mm2(maskRings) - mm2(padRings)).toBeGreaterThan(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the stencil file carries an aperture for every SMD pad, scaled to the 0.9 area ratio", () => {
    const { dir } = exportTo();
    try {
      const text = readFileSync(join(dir, "charger-buck-F_Paste.gbr"), "utf8");
      expect(text).toContain("%LPD*%");
      const apertures = regions(text).map((ring) => normalize(ring));
      expect(apertures.length).toBeGreaterThan(0);
      // 0.9 of the pad's area, less the 0.02 mm per-edge offset: strictly smaller than the pad.
      const padArea = apertures.reduce((sum, ring) => sum + area(ring), 0);
      const maskArea = regions(readFileSync(join(dir, "charger-buck-F_Mask.gbr"), "utf8"))
        .map((ring) => normalize(ring))
        .reduce((sum, ring) => sum + area(ring), 0);
      expect(padArea).toBeLessThan(maskArea);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the silk layer prints the reference of every placed part and hides the value", () => {
    const { dir } = exportTo();
    try {
      const text = readFileSync(join(dir, "charger-buck-F_SilkS.gbr"), "utf8");
      // Reference text at 1 mm draws wider than the 0.12–0.15 mm footprint outlines: two apertures.
      expect(text).toContain("%ADD10C,0.100000*%");
      expect(text).toContain("%ADD11C,0.150000*%");
      const statements = text.split("\n").filter((line) => /^X-?\d+Y-?\d+D0[123]\*$/.test(line));
      expect(statements.length).toBeGreaterThan(100);
      // Nine placements, nine references, each several strokes: far more than the outlines alone.
      expect(text).not.toContain("G36*");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the back side of this board is bare: empty files, not missing ones", () => {
    const { dir, result } = exportTo();
    try {
      for (const name of ["charger-buck-B_Mask.gbr", "charger-buck-B_Paste.gbr", "charger-buck-B_SilkS.gbr"]) {
        const text = readFileSync(join(dir, name), "utf8");
        // A complete file with a complete header and no statement between `%LPD*%` and `M02*`: the
        // board house reads "nothing on this layer", where a missing file reads "not defined"
        // (spec/pcb.md §8.2).
        expect(text.startsWith("G04 TextEDA ")).toBe(true);
        expect(text).toContain(`G04 source ${result.stamp.source_hash}*`);
        expect(text).toContain("%LPD*%");
        expect(text.endsWith("M02*\n")).toBe(true);
        expect(text.match(/D0[123]\*/g)).toBeNull();
        expect(text).not.toContain("%ADD");
      }
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
