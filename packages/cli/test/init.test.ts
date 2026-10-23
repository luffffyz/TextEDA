// Contract tests for `texteda init` (AGENTS.md "init contract (settled)").
//
// Two layers: pure logic (which files to write and what their contents are) and disk writes (refusing non-empty directories, --force overwrite, deterministic output).
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CURRENT_FORMAT, initTree, projectNameFromDir, renderProjectToml } from "../src/init.ts";
import { SUPPORTED_LANGUAGE, checkVersion } from "@texteda/parser";

/** Run the CLI once in a temp directory. */
function runInit(args: string[]): { code: number; stdout: string; stderr: string } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args: unknown[]) => stdout.push(args.join(" "));
  console.error = (...args: unknown[]) => stderr.push(args.join(" "));
  try {
    const proc = Bun.spawnSync(["bun", "run", join(import.meta.dir, "../scripts/texteda.ts"), ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });
    return {
      code: proc.exitCode,
      stdout: proc.stdout.toString(),
      stderr: proc.stderr.toString(),
    };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

describe("init file set", () => {
  const tree = initTree({ name: "demo" });

  test("creates only the directories and files listed in the contract", () => {
    expect(tree.directories).toEqual([
      "assets/symbols",
      "assets/footprints",
      "assets/components",
      "assets/procurement/primary",
      "assets/procurement/alternatives",
      "external/libs",
      "external/simulation",
      "design/sch",
      "design/modules",
      "design/pcb",
      "design/system",
      "views",
      "docs",
    ]);
    expect(tree.files.map((f) => f.path)).toEqual([
      "project.toml",
      "assets/symbols/.gitkeep",
      "assets/footprints/.gitkeep",
      "assets/components/.gitkeep",
      "assets/procurement/primary/.gitkeep",
      "assets/procurement/alternatives/.gitkeep",
      "external/libs/.gitkeep",
      "external/simulation/.gitkeep",
      "design/sch/.gitkeep",
      "design/modules/.gitkeep",
      "design/pcb/.gitkeep",
      "design/system/.gitkeep",
      "views/.gitkeep",
      "docs/README.md",
    ]);
  });

  test("project.toml has only name/version/format as required entries", () => {
    const toml = renderProjectToml({ name: "demo" });
    expect(toml).toContain('name = "demo"');
    expect(toml).toContain('version = "0.1.0"');
    expect(toml).toContain(`format = "${CURRENT_FORMAT}"`);
    // The bare output carries no optional metadata.
    expect(toml).not.toContain("description");
    expect(toml).not.toContain("[boards");
    expect(toml).not.toContain("[libs");
  });

  test("output determinism: the same name yields byte-identical files", () => {
    expect(renderProjectToml({ name: "demo" })).toBe(renderProjectToml({ name: "demo" }));
    expect(initTree({ name: "demo" }).files).toEqual(initTree({ name: "demo" }).files);
  });

  test("the stamped format version is one this tool accepts", () => {
    // `init` must not stamp a version the tool cannot read back. The stamp is the whole language's
    // version (`project.toml` is not one description type with its own line), so it is checked
    // against the language's supported version, not against a type's narrower window (teda.md §13.3).
    const language = { required: { major: 0, minor: 0, patch: 0 }, supported: SUPPORTED_LANGUAGE };
    expect(checkVersion(CURRENT_FORMAT, language, "project").ok).toBe(true);
  });

  test("the project name defaults to the directory name", () => {
    expect(projectNameFromDir("/tmp/my-board/")).toBe("my-board");
    expect(projectNameFromDir("/tmp/my-board")).toBe("my-board");
  });
});

describe("init disk-write behavior", () => {
  test("creates the directory tree and files", () => {
    const dir = mkdtempSync(join(tmpdir(), "texteda-init-"));
    try {
      const result = runInit(["init", dir]);
      expect(result.code).toBe(0);
      expect(existsSync(join(dir, "project.toml"))).toBe(true);
      expect(existsSync(join(dir, "assets", "components", ".gitkeep"))).toBe(true);
      expect(existsSync(join(dir, "assets", "symbols", ".gitkeep"))).toBe(true);
      expect(existsSync(join(dir, "assets", "footprints", ".gitkeep"))).toBe(true);
      expect(existsSync(join(dir, "design", "sch", ".gitkeep"))).toBe(true);
      expect(existsSync(join(dir, "design", "modules", ".gitkeep"))).toBe(true);
      expect(existsSync(join(dir, "design", "pcb", ".gitkeep"))).toBe(true);
      expect(existsSync(join(dir, "design", "system", ".gitkeep"))).toBe(true);
      expect(existsSync(join(dir, "external", "libs", ".gitkeep"))).toBe(true);
      expect(existsSync(join(dir, "views", ".gitkeep"))).toBe(true);
      expect(existsSync(join(dir, "docs", "README.md"))).toBe(true);
      // Does not create dist/.
      expect(existsSync(join(dir, "dist"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("refuses to run on a non-empty directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "texteda-init-"));
    try {
      writeFileSync(join(dir, "keep.txt"), "x");
      const result = runInit(["init", dir]);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("not an empty directory");
      expect(existsSync(join(dir, "project.toml"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--force overwrites existing files", () => {
    const dir = mkdtempSync(join(tmpdir(), "texteda-init-"));
    try {
      writeFileSync(join(dir, "project.toml"), "old content");
      const result = runInit(["init", dir, "--force"]);
      expect(result.code).toBe(0);
      expect(readFileSync(join(dir, "project.toml"), "utf8")).toContain("[project]");
      // Existing files are not deleted (overwriting is not clearing).
      expect(readdirSync(dir)).toContain("project.toml");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("two init runs produce byte-identical output", () => {
    const first = mkdtempSync(join(tmpdir(), "texteda-init-"));
    const second = mkdtempSync(join(tmpdir(), "texteda-init-"));
    try {
      runInit(["init", first, "--name", "demo"]);
      runInit(["init", second, "--name", "demo"]);
      expect(readFileSync(join(first, "project.toml"), "utf8")).toBe(
        readFileSync(join(second, "project.toml"), "utf8"),
      );
      expect(readFileSync(join(first, "docs", "README.md"), "utf8")).toBe(
        readFileSync(join(second, "docs", "README.md"), "utf8"),
      );
    } finally {
      rmSync(first, { recursive: true, force: true });
      rmSync(second, { recursive: true, force: true });
    }
  });

  test("an unknown command errors and exits", () => {
    const result = runInit(["frobnicate"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("Unknown command");
  });

  test("cli-domain failures carry registry codes (ADR-0016)", () => {
    const unknownFlag = runInit(["init", "somewhere", "--bogus"]);
    expect(unknownFlag.code).toBe(2);
    expect(unknownFlag.stderr).toContain("cli.bad-flag");

    const missingCommand = runInit([]);
    expect(missingCommand.code).toBe(2);
    expect(missingCommand.stderr).toContain("cli.bad-usage");

    const missingTarget = runInit(["init"]);
    expect(missingTarget.code).toBe(2);
    expect(missingTarget.stderr).toContain("cli.bad-usage");
  });
});
