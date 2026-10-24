// Bidirectional completeness check of the error-code registry (ADR-0016).
//
// Methodology copied from cohdl's `tests/error_registry.rs`:
//   - every entry in the code table must have a real call site (guards against "documented but never implemented");
//   - every code literal in the code must be in the code table (guards against "wild codes").
//
// Scan scope: each package's `src/` (excluding `src/generated/`) and `scripts/`; not `test/`
// — referencing a code in a test does not count as "implementing that code".
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DIAGNOSTIC_CODES, DIAGNOSTIC_CODE_IDS, DIAGNOSTIC_DOMAINS } from "../src/diagnostics/codes.ts";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const packagesDir = join(repoRoot, "packages");
/** The registry itself does not count as a call site — otherwise every code could "find itself". */
const registryFile = join(packagesDir, "ir/src/diagnostics/codes.ts");

function filesIn(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...filesIn(path));
    else if (entry.endsWith(".ts")) out.push(path);
  }
  return out;
}

/** Scan `.ts` files in sources (skipping generated output, tests and the registry itself). */
function sourceFiles(): string[] {
  const out: string[] = [];
  for (const pkg of readdirSync(packagesDir)) {
    const src = join(packagesDir, pkg, "src");
    if (statSync(src).isDirectory()) {
      out.push(...filesIn(src).filter((f) => !f.includes("/generated/") && f !== registryFile));
    }
    const scripts = join(packagesDir, pkg, "scripts");
    if (existsSync(scripts) && statSync(scripts).isDirectory()) out.push(...filesIn(scripts));
  }
  return out;
}

/** Strip comments so codes mentioned in comments are not counted as implementations. */
function stripComments(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      const trimmed = line.trimStart();
      if (trimmed.startsWith("*") || trimmed.startsWith("/*")) return "";
      const at = line.indexOf("//");
      return at < 0 ? line : line.slice(0, at);
    })
    .join("\n");
}

const sources = sourceFiles().map((path) => ({ path, text: stripComments(readFileSync(path, "utf8")) }));

const FILE_EXTENSIONS = /^(toml|md|json|jsonl|ts|js|svg|kicad_mod|kicad_sym|teda)$/;

describe("diagnostic error code registry", () => {
  test("every code has a real call site", () => {
    const missing: string[] = [];
    for (const code of DIAGNOSTIC_CODE_IDS) {
      // A deprecated code keeps its row but is no longer emitted (ADR-0016).
      if (DIAGNOSTIC_CODES[code].summary.startsWith("[DEPRECATED")) continue;
      const literal = `"${code}"`;
      const hit = sources.some((s) => s.text.includes(literal));
      if (!hit) missing.push(code);
    }
    expect(missing).toEqual([]);
  });

  test("every code literal in the code is in the registry", () => {
    const known = new Set<string>(DIAGNOSTIC_CODE_IDS);
    const wild: { file: string; code: string }[] = [];
    const pattern = /"([a-z]+)\.([a-z0-9-]+)"/g;
    for (const source of sources) {
      for (const match of source.text.matchAll(pattern)) {
        const domain = match[1]!;
        if (!(DIAGNOSTIC_DOMAINS as readonly string[]).includes(domain)) continue;
        // A file name is not a code: `library.toml` names the library's manifest, and no diagnostic
        // code carries a file extension (codes are `domain.slug`, and slugs are kebab-case words).
        if (FILE_EXTENSIONS.test(match[2]!)) continue;
        const code = `${domain}.${match[2]!}`;
        if (!known.has(code)) wild.push({ file: source.path, code });
      }
    }
    expect(wild).toEqual([]);
  });

  test("generated docs are consistent with the registry", () => {
    const doc = readFileSync(join(repoRoot, "docs/error-codes.md"), "utf8");
    for (const code of DIAGNOSTIC_CODE_IDS) {
      expect(doc).toContain(`\`${code}\``);
    }
    // The docs must not contain codes outside the registry.
    for (const match of doc.matchAll(/\| `([a-z]+\.[a-z0-9-]+)` \|/g)) {
      expect(DIAGNOSTIC_CODE_IDS as readonly string[]).toContain(match[1]!);
    }
  });

  test("code shape is `domain.slug`", () => {
    for (const code of DIAGNOSTIC_CODE_IDS) {
      expect(code).toMatch(/^[a-z]+\.[a-z0-9-]+$/);
    }
  });
});
