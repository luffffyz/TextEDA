// Contract tests for the IR shard tree (`texteda ir`, ADR-0008 decisions 1 and 5, ADR-0023).
//
// The tree is the bridge between the source descriptions and everything downstream (netlist,
// renderers, exporters): its layout, its hashes and its determinism are the contract, so they are
// checked here rather than only inside the CLI.
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { aggregateShardHash, buildIrTree, sha256Hex, writeIrTree } from "../src/ir-tree.ts";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const referenceProject = join(repoRoot, "examples", "reference-project");

/** A temp directory that is removed when the test process exits. */
function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "texteda-ir-"));
}

describe("IR shard tree layout", () => {
  const tree = buildIrTree(referenceProject);
  const paths = tree.shards.map((shard) => shard.path);

  test("every description with a producer becomes a shard", () => {
    expect(paths).toContain("boards/charger-buck/schematic.json");
    expect(paths).toContain("boards/charger-buck/pcb.json");
    expect(paths).toContain("boards/charger-buck/view/buck-5v.json");
    expect(paths).toContain("boards/mcu-board/schematic.json");
    expect(paths).toContain("symbols/project/r.json");
    expect(paths).toContain("footprints/project/chip-0402.json");
  });

  test("shard paths are unique and sorted", () => {
    expect(new Set(paths).size).toBe(paths.length);
    expect([...paths].sort()).toEqual(paths);
  });

  test("every shard is validated against its contract", () => {
    expect(tree.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });

  test("no absolute path leaks into the tree", () => {
    for (const shard of tree.shards) {
      expect(shard.source.startsWith("/")).toBe(false);
      expect(shard.bytes).not.toContain(repoRoot);
    }
    expect(tree.manifest.shards.map((s) => s.path).some((p) => p.startsWith("/"))).toBe(false);
  });
});

describe("IR shard tree hashes", () => {
  const tree = buildIrTree(referenceProject);

  test("the manifest lists every shard with its hash", () => {
    expect(tree.manifest.shards.length).toBe(tree.shards.length);
    expect(tree.manifest.shards.map((s) => s.path)).toEqual(tree.shards.map((s) => s.path));
    expect(tree.manifest.ir_version).toBe("0.2");
    expect(tree.manifest.tool_version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("the written bytes hash to the manifest entry", () => {
    const out = tempDir();
    try {
      writeIrTree(out, tree);
      for (const entry of tree.manifest.shards) {
        const bytes = readFileSync(join(out, entry.path), "utf8");
        expect(sha256Hex(bytes)).toBe(entry.sha256);
      }
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  test("the project hash is the aggregation over the manifest shards", () => {
    expect(aggregateShardHash(tree.manifest.shards)).toBe(tree.manifest.source_hash);
    expect(tree.projectHash).toBe(tree.manifest.source_hash);
  });

  test("a board hash covers that board's shards only", () => {
    for (const [board, hash] of tree.boardHashes) {
      const subset = tree.manifest.shards.filter((s) => s.path.startsWith(`boards/${board}/`));
      expect(subset.length).toBeGreaterThan(0);
      expect(aggregateShardHash(subset)).toBe(hash);
    }
  });
});

describe("IR shard tree determinism", () => {
  test("two builds of the same project are byte-identical", () => {
    const first = buildIrTree(referenceProject);
    const second = buildIrTree(referenceProject);
    expect(second.manifest).toEqual(first.manifest);
    expect(second.shards.map((s) => s.bytes)).toEqual(first.shards.map((s) => s.bytes));
  });

  test("writing the tree twice leaves the same bytes on disk", () => {
    const out = tempDir();
    try {
      const tree = buildIrTree(referenceProject);
      writeIrTree(out, tree);
      const first = readFileSync(join(out, "manifest.json"), "utf8");
      writeIrTree(out, tree);
      expect(readFileSync(join(out, "manifest.json"), "utf8")).toBe(first);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});

describe("IR shard tree pruning", () => {
  test("files the tree does not own are removed", () => {
    const out = tempDir();
    try {
      const tree = buildIrTree(referenceProject);
      writeIrTree(out, tree);
      mkdirSync(join(out, "boards", "gone"), { recursive: true });
      writeFileSync(join(out, "boards", "gone", "schematic.json"), "{}\n");
      writeFileSync(join(out, "stale.json"), "{}\n");
      writeIrTree(out, tree);
      expect(existsSync(join(out, "stale.json"))).toBe(false);
      expect(existsSync(join(out, "boards", "gone"))).toBe(false);
      expect(existsSync(join(out, "boards", "charger-buck", "schematic.json"))).toBe(true);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});

describe("texteda ir", () => {
  /** Run the CLI once. */
  function runIr(args: string[]): { code: number; stdout: string; stderr: string } {
    const proc = Bun.spawnSync(["bun", "run", join(import.meta.dir, "../scripts/texteda.ts"), ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });
    return {
      code: proc.exitCode,
      stdout: proc.stdout.toString(),
      stderr: proc.stderr.toString(),
    };
  }

  test("writes the tree and the manifest into the project", () => {
    const out = tempDir();
    try {
      const result = runIr(["ir", referenceProject, "--out", out]);
      expect(result.code).toBe(0);
      expect(existsSync(join(out, "manifest.json"))).toBe(true);
      expect(existsSync(join(out, "boards", "charger-buck", "schematic.json"))).toBe(true);
      expect(result.stdout).toContain("Project hash:");
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  test("the json payload carries the manifest and the hashes", () => {
    const out = tempDir();
    try {
      const result = runIr(["ir", referenceProject, "--out", out, "--json"]);
      expect(result.code).toBe(0);
      const payload = JSON.parse(result.stdout) as {
        manifest: { source_hash: string; shards: { path: string; sha256: string }[] };
        project_hash: string;
        board_hashes: Record<string, string>;
        shards: { path: string; sha256: string }[];
      };
      expect(payload.project_hash).toBe(payload.manifest.source_hash);
      expect(Object.keys(payload.board_hashes)).toContain("charger-buck");
      expect(payload.shards.length).toBe(payload.manifest.shards.length);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  test("a project with errors writes nothing and fails", () => {
    const project = tempDir();
    try {
      mkdirSync(join(project, "design/sch"), { recursive: true });
      writeFileSync(join(project, "design/sch", "broken.teda"), "schematic broken\ninstances\n  ???\n");
      const result = runIr(["ir", project]);
      expect(result.code).toBe(1);
      expect(existsSync(join(project, "dist", "ir", "manifest.json"))).toBe(false);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test("a project without any description is reported, not written", () => {
    const project = tempDir();
    try {
      const result = runIr(["ir", project]);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("cli.empty-project");
      expect(existsSync(join(project, "dist", "ir"))).toBe(false);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});
