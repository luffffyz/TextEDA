// Contract test: valid/ must pass, invalid/ must fail.
// These fixtures only prove the schema is self-consistent; golden files for `source → IR` land with the parser.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { schemaKinds, validate, type SchemaKind } from "../src/index.ts";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const fixtureRoot = join(repoRoot, "tests/schemas");

function fixturesIn(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...fixturesIn(p));
    else if (entry.endsWith(".json")) out.push(p);
  }
  return out;
}

const kinds = schemaKinds as readonly SchemaKind[];

describe("IR contract fixtures", () => {
  for (const kind of kinds) {
    const validDir = join(fixtureRoot, "valid", kind);
    const invalidDir = join(fixtureRoot, "invalid", kind);
    // common holds shared definitions, not a persistable shard, so it has no fixtures.
    if (!existsSync(validDir)) continue;

    test(`${kind}: valid/ passes, invalid/ fails`, () => {
      const validFiles = fixturesIn(validDir);
      expect(validFiles.length).toBeGreaterThan(0);
      for (const file of validFiles) {
        const result = validate(kind, JSON.parse(readFileSync(file, "utf8")));
        expect({ file, ...result }).toEqual({ file, ok: true, errors: [] });
      }

      const invalidFiles = fixturesIn(invalidDir);
      expect(invalidFiles.length).toBeGreaterThan(0);
      for (const file of invalidFiles) {
        const result = validate(kind, JSON.parse(readFileSync(file, "utf8")));
        expect(result.ok).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
      }
    });
  }
});
