#!/usr/bin/env bun
/**
 * Pre-flight check for making this repository public (docs/backlog.md F6, ADR-0039 decision 1).
 *
 * A public repository is a one-way door: once the history is reachable, anything it contains is
 * permanently exposed, and forks may already exist. So this check runs against the **history**, not
 * just the working tree -- a file that was committed and later deleted is just as public as one that
 * is still there.
 *
 * Usage:
 *   bun run check:public          # check the working tree and the current history
 *   bun run check:public --staged # also require the index to be clean (i.e. nothing uncommitted)
 *
 * Checks:
 *   1. no vendor datasheet PDF is reachable from any commit (git log --all --name-only);
 *   2. no credential-shaped string is tracked (API keys, private keys, tokens);
 *   3. no absolute path from a maintainer's machine is tracked (/home/<user>, /Users/<user>, C:\Users);
 *   4. no email address is tracked;
 *   5. every tracked package.json carries "license" and "private";
 *   6. the NOTICE file reproduces the license text of every third-party component vendored into the tree.
 *
 * Exit code 1 if there is any error.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const repoRoot = join(import.meta.dir, "..");
const problems: string[] = [];

function fail(message: string): void {
  problems.push(message);
}

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 });
}

/** All file paths that have ever been committed, across every ref. */
function trackedPaths(): string[] {
  const out = new Set<string>();
  for (const line of git(["rev-list", "--objects", "--all"]).split("\n")) {
    const path = line.slice(line.indexOf(" ") + 1).trim();
    if (path) out.add(path);
  }
  return [...out].sort();
}

/** The content of the current working tree, restricted to paths git tracks. */
function trackedFiles(): { path: string; text: string }[] {
  const files: { path: string; text: string }[] = [];
  for (const path of git(["ls-files"]).split("\n")) {
    if (!path) continue;
    const full = join(repoRoot, path);
    if (!existsSync(full) || !statSync(full).isFile()) continue;
    if (/\.(png|jpg|jpeg|gif|ico|pdf|zip|gz|woff2?|ttf|otf)$/i.test(path)) continue;
    try {
      files.push({ path, text: readFileSync(full, "utf-8") });
    } catch {
      // binary or unreadable: not our concern here
    }
  }
  return files;
}

// ---------------------------------------------------------------- 1. vendor PDFs in history

const everTracked = trackedPaths();
const pdfs = everTracked.filter((path) => /\.pdf$/i.test(path));
if (pdfs.length > 0) {
  fail(
    `vendor PDFs are reachable from the history: ${pdfs.slice(0, 5).join(", ")}` +
      (pdfs.length > 5 ? ` (and ${pdfs.length - 5} more)` : "") +
      ". Rewrite the history before making the repository public.",
  );
}

// ---------------------------------------------------------------- 2-4. secret / path / email scan

const credentialPatterns: { name: string; pattern: RegExp }[] = [
  { name: "private key block", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "GitHub token", pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/ },
  { name: "GitHub fine-grained token", pattern: /\bgithub_pat_[A-Za-z0-9_]{22,}\b/ },
  { name: "AWS access key id", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: "Slack token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: "generic API key assignment", pattern: /\b(?:api[_-]?key|secret[_-]?key|access[_-]?token)\s*[:=]\s*["'][^"']{16,}["']/i },
];

const homePathPattern = /(?:\/home\/[a-z][a-z0-9_-]*|\/Users\/[A-Za-z][A-Za-z0-9_-]*|[A-Z]:\\Users\\[A-Za-z])/g;
const emailPattern = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

const files = trackedFiles();
for (const { path, text } of files) {
  for (const { name, pattern } of credentialPatterns) {
    if (pattern.test(text)) fail(`${path}: looks like a credential (${name})`);
  }

  // A path under /tmp is a generic scratch directory and says nothing about the maintainer.
  // A URL path is not a local path: a vendor URL whose path starts with `home/tools` says nothing
  // about the maintainer's machine, so strip URLs before looking for a home directory.
  const homePathText = text.replace(/https?:\/\/\S+/g, "");
  const homeMatches = [...homePathText.matchAll(homePathPattern)].map((m) => m[0]);
  for (const match of homeMatches) fail(`${path}: absolute path from a maintainer's machine: ${match}`);

  const emails = [...text.matchAll(emailPattern)].map((m) => m[0]);
  for (const email of emails) fail(`${path}: email address: ${email}`);
}

// ---------------------------------------------------------------- 5. package.json license fields

const packageFiles = files.filter((f) => /^packages\/[^/]+\/package\.json$/.test(f.path) || f.path === "package.json");
if (packageFiles.length === 0) fail("no package.json found -- is this the right directory?");
for (const { path, text } of packageFiles) {
  const parsed = JSON.parse(text) as { license?: string; private?: boolean };
  if (!parsed.license) fail(`${path}: no "license" field`);
  if (parsed.private !== true) fail(`${path}: no "private": true (the packages are not published to npm)`);
}

// ---------------------------------------------------------------- 6. NOTICE covers vendored components

const noticePath = join(repoRoot, "NOTICE");
if (!existsSync(noticePath)) {
  fail("NOTICE is missing");
} else {
  const notice = readFileSync(noticePath, "utf-8");
  // The Hershey glyph data is vendored into packages/core/src/font/. MIT requires the license
  // text to travel with the data.
  if (existsSync(join(repoRoot, "packages/core/src/font/hershey-sans.ts"))) {
    if (!notice.includes("Permission is hereby granted")) {
      fail("NOTICE does not reproduce the MIT license text of the vendored Hershey glyph data (MIT requires it)");
    }
    if (!notice.includes("James T")) {
      fail("NOTICE does not credit the copyright holder of the vendored Hershey glyph data");
    }
  }
  // The brand logos in docs/assets/svg/ contain outline paths derived from Cascadia Code and
  // Noto Sans CJK. SIL OFL 1.1 requires the licence text to travel with the font software,
  // and the licence text itself must stay in the tree.
  const brandSvg = join(repoRoot, "docs/assets/svg");
  if (existsSync(brandSvg)) {
    if (!notice.includes("Cascadia")) {
      fail("NOTICE does not credit Cascadia Code, the face the brand wordmark is set in (SIL OFL-1.1)");
    }
    if (!notice.includes("Noto Sans CJK")) {
      fail("NOTICE does not credit Noto Sans CJK, used for the Chinese tagline (SIL OFL-1.1)");
    }
    const ofl = join(repoRoot, "docs/assets/_font/OFL.txt");
    if (!existsSync(ofl)) {
      fail("docs/assets/_font/OFL.txt is missing -- SIL OFL-1.1 requires the licence text to travel with the derived outlines");
    } else if (!readFileSync(ofl, "utf-8").includes("SIL OPEN FONT LICENSE Version 1.1")) {
      fail("docs/assets/_font/OFL.txt does not contain the SIL Open Font License 1.1 text");
    }
  }
}

// ---------------------------------------------------------------- index state (optional)

if (process.argv.includes("--staged")) {
  const status = git(["status", "--porcelain"]).trim();
  if (status) fail(`the working tree is not clean:\n${status}`);
}

// ---------------------------------------------------------------- report

if (problems.length > 0) {
  for (const problem of problems) console.error(`check:public: ${problem}`);
  console.error(`\n${problems.length} pre-publication problem(s) — do not make the repository public yet.`);
  process.exit(1);
}

console.log(
  `check:public ok — ${everTracked.length} paths ever tracked, ${files.length} tracked text files scanned, ` +
    `${packageFiles.length} package.json files checked`,
);
