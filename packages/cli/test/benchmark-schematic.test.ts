import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeProject } from "../src/check.ts";
import { makeProject, schematicSource, type Shape } from "../../../scripts/benchmark-schematic.ts";

describe("schematic benchmark generator", () => {
  test("produces deterministic, error-free sparse and fan-out projects", () => {
    const root = mkdtempSync(join(tmpdir(), "texteda-schematic-bench-test-"));
    try {
      for (const shape of ["sparse", "fanout"] as const satisfies readonly Shape[]) {
        const projectRoot = join(root, shape);
        const generated = makeProject(projectRoot, shape, 8);
        const source = schematicSource(shape, 8);
        expect(schematicSource(shape, 8)).toBe(source);
        expect(readFileSync(generated.module, "utf8")).toBe(source);
        expect(readFileSync(generated.schematic, "utf8")).toBe("version 0.14.0\nschematic main\n\nmodules\n  M1  benchmark\n");

        const result = analyzeProject(projectRoot);
        expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
        const schematic = result.main.ir;
        if (schematic === undefined) throw new Error("generated project did not produce schematic IR");
        expect(schematic.instances).toHaveLength(8);
        expect(schematic.nets).toHaveLength(shape === "sparse" ? 8 : 2);
        expect(schematic.nets.map((net) => net.members.length).sort((a, b) => a - b)).toEqual(
          shape === "sparse" ? Array.from({ length: 8 }, () => 2) : [8, 8],
        );
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
