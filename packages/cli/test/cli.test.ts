// CLI argument parsing and command dispatch (ADR-0019).
//
// The focus is errors like "a flag's value being treated as a positional argument": they don't crash, but they steer the command off course.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const script = join(import.meta.dir, "../scripts/texteda.ts");

/** Run the CLI once, capturing the exit code and output. */
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

describe("argument parsing", () => {
  test("a flag with a value does not consume a positional argument", () => {
    const root = mkdtempSync(join(tmpdir(), "texteda-cli-"));
    try {
      const out = join(root, "mcu.json");
      const result = run(["compile", "examples/reference-project", "mcu-board", "--out", out]);
      expect(result.stderr).not.toContain("cli.bad-usage");
      expect(result.code).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a flag missing its value yields a usage error", () => {
    const result = run(["compile", "examples/reference-project", "mcu-board", "--out"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("cli.bad-usage");
  });

  test("an unknown flag errors", () => {
    const result = run(["check", "examples/reference-project", "--nope"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("cli.bad-flag");
  });

  test("an unknown command errors and prints usage", () => {
    const result = run(["frobnicate"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("cli.bad-usage");
    expect(result.stderr).toContain("texteda check");
  });

  test("a missing command prints usage", () => {
    const result = run([]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("cli.bad-usage");
  });
});

describe("check exit codes", () => {
  test("exit code 0 when there are only warnings", () => {
    const result = run(["check", "examples/reference-project"]);
    expect(result.code).toBe(0);
    expect(result.stderr).toContain("errors");
  });

  test("exit code 1 when there are errors", () => {
    const root = mkdtempSync(join(tmpdir(), "texteda-cli-bad-"));
    try {
      mkdirSync(join(root, "sch"), { recursive: true });
      writeFileSync(
        join(root, "sch", "b.teda"),
        "version 0.3\nschematic b\n\ninstances\n  R1  no-such-part  10k\n",
      );
      const result = run(["check", root]);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("ref.unknown-component");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
