// 契约测试：valid/ 必须通过、invalid/ 必须失败。
// 这些夹具只证明 schema 自洽；`source → IR` 的黄金文件随解析器一起落。
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

describe("IR 契约夹具", () => {
  for (const kind of kinds) {
    const validDir = join(fixtureRoot, "valid", kind);
    const invalidDir = join(fixtureRoot, "invalid", kind);
    // common 是共享定义，不是可落盘的分片，没有夹具。
    if (!existsSync(validDir)) continue;

    test(`${kind}: valid/ 通过、invalid/ 失败`, () => {
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
