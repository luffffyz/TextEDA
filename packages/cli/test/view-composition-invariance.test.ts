import { describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeProject } from "../src/check.ts";
import { buildIr } from "../src/ir.ts";
import { buildNetlist } from "../src/netlist.ts";

const project = join(import.meta.dir, "../../../examples/reference-project");

function snapshot(root: string) {
  const analysis = analyzeProject(root);
  const netlist = buildNetlist({ root });
  const ir = buildIr({ root, outDir: join(root, "tmp-ir") });

  expect(analysis.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  expect(netlist.ok).toBe(true);
  expect(ir.ok).toBe(true);

  return {
    main: { main: analysis.main.main, ir: analysis.main.ir },
    pcbs: analysis.pcbs.map(({ pcb, ir: pcbIr }) => ({ pcb, ir: pcbIr })),
    netlist: netlist.value!.payload,
    projectHash: ir.value!.project_hash,
    pcbHashes: ir.value!.board_hashes,
    advisoryHash: ir.value!.advisory_hash,
  };
}

describe("view composition invariance", () => {
  test("module drawings, templates, and composed pages do not affect normative project output", () => {
    const root = mkdtempSync(join(tmpdir(), "texteda-view-composition-invariance-"));
    try {
      cpSync(project, root, { recursive: true });
      const baseline = snapshot(root);

      for (const relativePath of [
        "views/modules/buck-5v.module-view.teda",
        "views/templates/a4.sheet-template.teda",
        "views/composed.view.teda",
      ]) {
        rmSync(join(root, relativePath));
      }

      const withoutAdvisoryViews = snapshot(root);
      expect(withoutAdvisoryViews.main).toEqual(baseline.main);
      expect(withoutAdvisoryViews.pcbs).toEqual(baseline.pcbs);
      expect(withoutAdvisoryViews.netlist).toEqual(baseline.netlist);
      expect(withoutAdvisoryViews.projectHash).toBe(baseline.projectHash);
      expect(withoutAdvisoryViews.pcbHashes).toEqual(baseline.pcbHashes);
      expect(withoutAdvisoryViews.advisoryHash).not.toBe(baseline.advisoryHash);
      // Advisory identity is allowed to change when these drawing artifacts are removed.
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
