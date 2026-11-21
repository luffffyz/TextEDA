#!/usr/bin/env bun
/**
 * Enforces ADR-0038 D1 at the package boundary.
 *
 * The CLI package is the filesystem-owning layer and is intentionally outside this check. Every
 * other package source file must remain portable to Node and browser hosts. The only Bun API
 * exception is the review-app build helper, which runs on the Bun side of the viewer.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

export type PackageSourceFile = { path: string; text: string };
export type PackageBoundaryViolation = { path: string; line: number; rule: string; text: string };

const repoRoot = join(import.meta.dir, "..");
const excludedPackage = "packages/cli/src";
const allowedBunApis: Record<string, readonly string[]> = {
  "packages/viewer/src/build.ts": ["build"],
};

function slash(path: string): string {
  return path.replaceAll("\\", "/");
}

function codeLines(text: string): string[] {
  let inBlockComment = false;
  return text.split(/\r?\n/).map((line) => {
    let code = line;
    while (true) {
      if (inBlockComment) {
        const end = code.indexOf("*/");
        if (end < 0) return "";
        code = code.slice(end + 2);
        inBlockComment = false;
        continue;
      }
      const blockStart = code.indexOf("/*");
      const lineComment = code.indexOf("//");
      if (lineComment >= 0 && (blockStart < 0 || lineComment < blockStart)) return code.slice(0, lineComment);
      if (blockStart < 0) return code;
      const blockEnd = code.indexOf("*/", blockStart + 2);
      if (blockEnd < 0) {
        inBlockComment = true;
        return code.slice(0, blockStart);
      }
      code = code.slice(0, blockStart) + code.slice(blockEnd + 2);
    }
  });
}

function walk(root: string, directory: string, files: PackageSourceFile[]): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(root, fullPath, files);
    } else if (entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name)) {
      files.push({ path: slash(relative(root, fullPath)), text: readFileSync(fullPath, "utf8") });
    }
  }
}

export function packageSourceFiles(root: string = repoRoot): PackageSourceFile[] {
  const packagesRoot = join(root, "packages");
  const files: PackageSourceFile[] = [];
  for (const entry of readdirSync(packagesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const sourceRoot = slash(join("packages", entry.name, "src"));
    if (sourceRoot === excludedPackage) continue;
    const fullSourceRoot = join(root, sourceRoot);
    try {
      walk(root, fullSourceRoot, files);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export function findBoundaryViolations(files: PackageSourceFile[]): PackageBoundaryViolation[] {
  const violations: PackageBoundaryViolation[] = [];
  for (const file of files) {
    const allowedApis = allowedBunApis[file.path];
    const lines = codeLines(file.text);
    for (const [index, text] of lines.entries()) {
      for (const match of text.matchAll(/\bBun\.([A-Za-z_$][\w$]*)/g)) {
        const api = match[1];
        if (!api || allowedApis?.includes(api)) continue;
        violations.push({
          path: file.path,
          line: index + 1,
          rule: `Bun.${api}`,
          text,
        });
      }
      if (/\bprocess\.env\b/.test(text)) {
        violations.push({ path: file.path, line: index + 1, rule: "process.env", text });
      }
      for (const match of text.matchAll(/\bnode:(fs|path|os)\b/g)) {
        violations.push({
          path: file.path,
          line: index + 1,
          rule: match[0],
          text,
        });
      }
    }
  }
  return violations;
}

if (import.meta.main) {
  const files = packageSourceFiles();
  const violations = findBoundaryViolations(files);
  if (violations.length > 0) {
    for (const violation of violations) {
      console.error(`check:packages: ${violation.path}:${violation.line}: forbidden ${violation.rule}: ${violation.text.trim()}`);
    }
    console.error(`\n${violations.length} package-boundary violation(s)`);
    process.exit(1);
  }
  console.log(`check:packages ok — ${files.length} library source files scanned`);
}
