// `texteda id`: project-scoped UID generation (ADR-0109).
//
// The generator is pure enough to test with a deterministic random source; the command itself is
// covered through the CLI so a flag or output regression is visible.
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CROCKFORD_ALPHABET,
  UID_SUFFIX_LENGTH,
  collectProjectUidSources,
  generateInstanceUids,
} from "../src/id.ts";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const referenceProject = join(repoRoot, "examples", "reference-project");
const script = join(import.meta.dir, "../scripts/texteda.ts");
const UID_RE = /^ID[0-9a-hjkmnp-tv-z]{6}$/;

/** A deterministic random source: the indexes in order, then the sequence repeats. */
function sequence(values: number[]): () => number {
  let index = 0;
  return () => values[index++ % values.length]!;
}

describe("UID generation", () => {
  test("the alphabet is the 32-character Crockford set and the suffix is six characters", () => {
    expect(CROCKFORD_ALPHABET).toHaveLength(32);
    expect(UID_SUFFIX_LENGTH).toBe(6);
    expect(CROCKFORD_ALPHABET).not.toMatch(/[ilou]/);
  });

  test("a candidate is ID plus six alphabet characters", () => {
    const [uid] = generateInstanceUids([], 1, sequence([0, 1, 2, 3, 4, 5]));
    expect(uid).toBe("ID012345");
    expect(uid).toMatch(UID_RE);
  });

  test("an existing UID is rejected and the next candidate is used", () => {
    const random = sequence([0, 1, 2, 3, 4, 5, 0, 1, 2, 3, 4, 6]);
    const [uid] = generateInstanceUids(["ID012345"], 1, random);
    expect(uid).toBe("ID012346");
  });

  test("generated UIDs are unique and do not repeat existing ones", () => {
    const existing = ["ID012345", "IDabcdef"];
    const random = sequence(Array.from({ length: 64 }, (_, index) => index % CROCKFORD_ALPHABET.length));
    const uids = generateInstanceUids(existing, 8, random);
    expect(new Set(uids).size).toBe(uids.length);
    for (const uid of uids) {
      expect(uid).toMatch(UID_RE);
      expect(existing).not.toContain(uid);
    }
  });

  test("a positive integer count is required", () => {
    expect(() => generateInstanceUids([], 0)).toThrow("positive integer");
    expect(() => generateInstanceUids([], -1)).toThrow("positive integer");
    expect(() => generateInstanceUids([], 1.5)).toThrow("positive integer");
  });
});

describe("project UID collection", () => {
  test("collects board, module-instance and module-local UIDs", () => {
    const { uids, diagnostics } = collectProjectUidSources(referenceProject);
    expect(diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(uids.size).toBeGreaterThan(50);
    for (const uid of uids) expect(uid).toMatch(UID_RE);
    expect(uids.has("ID5w4pv5")).toBe(true); // a module-instance UID
    expect(uids.has("ID4dyg23")).toBe(true); // a module-local UID
  });
});

describe("texteda id command", () => {
  function run(args: string[]): { code: number; stdout: string; stderr: string } {
    const proc = Bun.spawnSync(["bun", "run", script, ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });
    return { code: proc.exitCode, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
  }

  test("prints one UID per line", () => {
    const result = run(["id", referenceProject, "--count", "3"]);
    expect(result.code).toBe(0);
    const lines = result.stdout.trimEnd().split("\n");
    expect(lines).toHaveLength(3);
    for (const line of lines) expect(line).toMatch(UID_RE);
  });

  test("the command avoids every UID already in the project", () => {
    const { uids } = collectProjectUidSources(referenceProject);
    const result = run(["id", referenceProject, "--count", "8"]);
    expect(result.code).toBe(0);
    for (const uid of result.stdout.trimEnd().split("\n")) expect(uids.has(uid)).toBe(false);
  });

  test("--json wraps the same IDs", () => {
    const result = run(["id", referenceProject, "--count", "2", "--json"]);
    expect(result.code).toBe(0);
    const payload = JSON.parse(result.stdout) as { uids: string[] };
    expect(payload.uids).toHaveLength(2);
    for (const uid of payload.uids) expect(uid).toMatch(UID_RE);
  });

  test("a source parse error blocks generation instead of hiding a UID", () => {
    const root = mkdtempSync(join(tmpdir(), "texteda-id-"));
    try {
      mkdirSync(join(root, "design", "sch"), { recursive: true });
      writeFileSync(
        join(root, "design", "sch", "b.teda"),
        "version 0.9\nschematic b\n\ninstances\n  R1  IDbad  res-thick-0402  10k  ±1%\n",
      );
      const result = run(["id", root]);
      expect(result.code).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("No IDs generated");
      expect(result.stderr).toContain("syntax.invalid-identifier");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a non-positive count is a usage error", () => {
    const result = run(["id", referenceProject, "--count", "0"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("cli.bad-usage");
  });
});
