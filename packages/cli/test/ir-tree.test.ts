// Contract tests for the IR shard tree (`texteda ir`, ADR-0008 decisions 1 and 5, ADR-0023).
//
// The tree is the bridge between the source descriptions and everything downstream (netlist,
// renderers, exporters): its layout, its hashes and its determinism are the contract, so they are
// checked here rather than only inside the CLI.
import { describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    expect(paths).toContain("components/bq24610rger.json");
    expect(paths).toContain("components/ch32v307vct6.json");
  });

  test("a component shard is the device projected onto the contract", () => {
    // The board is made of these parts, so the shard is normative; the body carries the facts the
    // schematic and the procurement rules read (pins, kind, footprint) and nothing of the parser.
    const shard = tree.shards.find((s) => s.path === "components/bq24610rger.json");
    expect(shard?.normative).toBe(true);
    expect(shard?.kind).toBe("component");
    const body = JSON.parse(shard!.bytes) as {
      component: { id: string; kind: string; pins: { number: string; electrical_type: string }[]; pins_source: string };
    };
    expect(body.component.kind).toBe("part");
    expect(body.component.pins_source).toBe("inline");
    expect(body.component.pins.find((pin) => pin.number === "24")?.electrical_type).toBe("power_in");
  });

  test("the description field of a component reaches the shard", () => {
    // It is a language scalar that used to be dropped on the way to the IR (ADR-0042).
    const shard = tree.shards.find((s) => s.path === "components/ch32v307vct6.json");
    expect(JSON.parse(shard!.bytes).component.description).toBeTruthy();
  });

  test("the procurement layer becomes one shard per file, with its own classification", () => {
    // The primary selections are part of the build; the second sources are not (ADR-0030 D12).
    const primary = tree.shards.find((s) => s.path === "boards/charger-buck/procurement.json");
    const alternatives = tree.shards.find(
      (s) => s.path === "boards/charger-buck/procurement-alternatives.json",
    );
    expect(primary?.normative).toBe(true);
    expect(alternatives?.normative).toBe(false);
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
    expect(tree.manifest.ir_version).toBe("0.8");
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

  test("the project hash is the aggregation over the normative shards", () => {
    const normative = tree.manifest.shards.filter((s) => s.normative);
    expect(normative.length).toBeGreaterThan(0);
    expect(aggregateShardHash(normative)).toBe(tree.manifest.source_hash);
    expect(tree.projectHash).toBe(tree.manifest.source_hash);
  });

  test("the advisory hash is the aggregation over the advisory shards", () => {
    const advisory = tree.manifest.shards.filter((s) => !s.normative);
    expect(advisory.length).toBeGreaterThan(0);
    expect(tree.manifest.advisory_hash).toBeDefined();
    expect(aggregateShardHash(advisory)).toBe(tree.manifest.advisory_hash!);
    expect(tree.advisoryHash).toBe(tree.manifest.advisory_hash!);
  });

  test("a print page is a drawing, not a build input: its shard is advisory", () => {
    // ADR-0032 decision 3: moving a label in a print page must not change the build identity.
    const pages = tree.manifest.shards.filter((s) => s.path.includes("/view/"));
    expect(pages.length).toBeGreaterThan(0);
    for (const page of pages) expect(page.normative).toBe(false);
  });

  test("a board hash covers that board's normative shards only", () => {
    for (const [board, hash] of tree.boardHashes) {
      const subset = tree.manifest.shards.filter(
        (s) => s.normative && s.path.startsWith(`boards/${board}/`),
      );
      expect(subset.length).toBeGreaterThan(0);
      expect(aggregateShardHash(subset)).toBe(hash);
    }
  });

  test("moving a label in a print page moves the advisory hash only", () => {
    // ADR-0032 decision 3: a drawing is not a build input, so a reviewer's label move must not
    // invalidate a signed manufacturing package.
    const project = tempDir();
    try {
      cpSync(referenceProject, project, { recursive: true });
      const before = buildIrTree(project);
      const page = join(project, "views", "charger-buck", "buck-5v.view.teda");
      const text = readFileSync(page, "utf8");
      const moved = text.replace(/^(\s*\w+\s+)([0-9.]+)(\s+[0-9.]+\s*)$/m, "$130.0$3");
      expect(moved).not.toBe(text);
      writeFileSync(page, moved);
      const after = buildIrTree(project);
      expect(after.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
      expect(after.shards.length).toBe(before.shards.length);
      expect(after.projectHash).toBe(before.projectHash);
      expect(after.advisoryHash).not.toBe(before.advisoryHash);
      for (const [board, hash] of before.boardHashes) {
        expect(after.boardHashes.get(board)).toBe(hash);
      }
    } finally {
      rmSync(project, { recursive: true, force: true });
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

  test("a component whose header id disagrees with its file name yields no shard", () => {
    // The id is the file name: a shard whose key disagrees with its path would make the tree's
    // identity depend on which reader looks at it.
    const project = tempDir();
    try {
      cpSync(referenceProject, project, { recursive: true });
      writeFileSync(
        join(project, "assets/components/misnamed.teda"),
        [
          "version 0.9",
          "component something-else",
          "kind part",
          "mpn ABC123",
          "symbol project:r",
          "footprint project:chip-0402",
          "pins",
          "  1 A passive",
          "  2 B passive",
          "",
        ].join("\n"),
      );
      const tree = buildIrTree(project);
      expect(tree.shards.some((s) => s.path === "components/misnamed.json")).toBe(false);
      expect(tree.diagnostics.some((d) => d.code === "ref.component-id-mismatch")).toBe(true);
    } finally {
      rmSync(project, { recursive: true, force: true });
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
