// The ten difficult cases (AGENTS.md §10, docs/backlog.md F12): each case is a small project whose
// compiled IR and whose diagnostics are pinned under `expected/`.
//
// Why a case is a whole project rather than a snippet: the language's risk is not the syntax of one
// line, it is whether the tables stay readable and the IR stays correct when a real board is written
// with them. A snippet cannot show that a 200-pin device or a three-unit amplifier compiles into the
// shape the contract promises.
//
// What is pinned:
//
//   expected/ir/**        every IR shard, byte for byte (canonical JSON)
//   expected/netlist.txt  the connectivity projection of every board, in board order
//   expected/manifest.json the manifest without `tool_version` (a release bump is not a language change)
//   expected/diagnostics.json  code + severity + file + line, sorted; the wording is not pinned,
//                          because a reworded message is not a different design
//
// `--update` rewrites the three. Everything else is read-only: a case that changes without its
// expectation changing is a regression, and that is the whole point.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { Diagnostic } from "@texteda/ir/diagnostics";
import { formatNetlist, toNetlist } from "@texteda/exporter/netlist";
import { analyzeProject, checkProject } from "../packages/cli/src/check.ts";
import { buildIrTree } from "../packages/cli/src/ir-tree.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
export const CASES_DIR = join(repoRoot, "examples", "cases");

/** One expectation row: what the checker said about a file, without the prose. */
interface PinnedDiagnostic {
  code: string;
  severity: string;
  file: string;
  line: number;
}

export interface CaseResult {
  id: string;
  /** Problems found while comparing against `expected/`; empty means the case passes. */
  problems: string[];
}

/** Case directories, in name order: a directory with a `project.toml`. */
export function listCases(): string[] {
  if (!existsSync(CASES_DIR)) return [];
  return readdirSync(CASES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((id) => existsSync(join(CASES_DIR, id, "project.toml")))
    .sort();
}

/** Every file under a directory, as `/`-separated paths relative to it. */
function filesUnder(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...filesUnder(join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out;
}

function pinDiagnostics(diagnostics: Diagnostic[], root: string): PinnedDiagnostic[] {
  return diagnostics
    .map((diagnostic) => ({
      code: diagnostic.code,
      severity: diagnostic.severity,
      // Diagnostics name source files relative to the project already; a path outside the project
      // (a component of another tree) would make the pin machine-dependent.
      file: diagnostic.location === undefined ? "" : relative(root, join(root, diagnostic.location.file)),
      line: diagnostic.location?.line ?? 0,
    }))
    .sort((a, b) =>
      a.file < b.file ? -1 : a.file > b.file ? 1
      : a.line !== b.line ? a.line - b.line
      : a.code < b.code ? -1 : a.code > b.code ? 1 : 0);
}

/**
 * Compare one case with its expectation, or (`update`) rewrite the expectation from it.
 *
 * A case with an error diagnostic is not a case: the corpus is the shape of *valid* designs. An
 * error belongs in a negative fixture, where the expectation is the error code alone.
 */
function runCase(id: string, update: boolean): CaseResult {
  const dir = join(CASES_DIR, id);
  const expected = join(dir, "expected");
  const problems: string[] = [];

  const tree = buildIrTree(dir);
  const errors = [...tree.diagnostics, ...checkProject(dir).diagnostics].filter((d) => d.severity === "error");
  if (errors.length > 0) {
    return { id, problems: errors.map((d) => `error in a case: ${d.code} ${d.message}`) };
  }

  const shards = new Map(tree.shards.map((shard) => [shard.path, shard.bytes]));
  const manifest = { ...tree.manifest } as Record<string, unknown>;
  delete manifest["tool_version"];
  const manifestBytes = `${JSON.stringify(manifest, null, 2)}\n`;
  const diagnostics = pinDiagnostics(checkProject(dir).diagnostics, dir);
  const diagnosticsBytes = `${JSON.stringify(diagnostics, null, 2)}\n`;
  // The netlist is what every downstream consumer reads, and it is a projection of the IR rather
  // than of the source; pinning it catches a projection change the IR alone would not show.
  const netlists = analyzeProject(dir)
    .analyses.filter((analysis) => analysis.ir !== undefined)
    .map((analysis) => formatNetlist(toNetlist(analysis.ir!)));
  const netlistBytes = netlists.join("\n");

  if (update) {
    rmSync(join(expected, "ir"), { recursive: true, force: true });
    mkdirSync(join(expected, "ir"), { recursive: true });
    for (const [path, bytes] of shards) {
      const target = join(expected, "ir", path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, bytes);
    }
    writeFileSync(join(expected, "manifest.json"), manifestBytes);
    writeFileSync(join(expected, "diagnostics.json"), diagnosticsBytes);
    writeFileSync(join(expected, "netlist.txt"), netlistBytes);
    return { id, problems: [] };
  }

  // The IR: same set of shards, same bytes.
  const irDir = join(expected, "ir");
  if (!existsSync(irDir)) return { id, problems: ["expected/ir is missing (run cases --update)"] };
  const pinned = filesUnder(irDir);
  for (const path of pinned) {
    const want = readFileSync(join(irDir, path), "utf8");
    const got = shards.get(path);
    if (got === undefined) {
      problems.push(`${path}: pinned but not produced`);
      continue;
    }
    if (got !== want) problems.push(`${path}: the IR changed`);
  }
  for (const path of shards.keys()) {
    if (!pinned.includes(path)) problems.push(`${path}: produced but not pinned`);
  }

  const wantNetlist = readFileSync(join(expected, "netlist.txt"), "utf8");
  if (wantNetlist !== netlistBytes) problems.push("netlist.txt: the connectivity projection changed");

  const wantManifest = readFileSync(join(expected, "manifest.json"), "utf8");
  if (wantManifest !== manifestBytes) problems.push("manifest.json: the project hash or the shard list changed");

  const wantDiagnostics = readFileSync(join(expected, "diagnostics.json"), "utf8");
  if (wantDiagnostics !== diagnosticsBytes) {
    const before = (JSON.parse(wantDiagnostics) as PinnedDiagnostic[]).map(brief);
    const after = diagnostics.map(brief);
    const added = after.filter((row) => !before.includes(row));
    const removed = before.filter((row) => !after.includes(row));
    problems.push(
      `diagnostics.json: ${added.length} added, ${removed.length} removed` +
        (added.length > 0 ? ` (added: ${added.slice(0, 5).join("; ")})` : "") +
        (removed.length > 0 ? ` (removed: ${removed.slice(0, 5).join("; ")})` : ""),
    );
  }

  return { id, problems };
}

function brief(row: PinnedDiagnostic): string {
  return `${row.code}@${row.file}:${row.line}`;
}

/** Run every case; with `update`, rewrite the expectations instead of comparing. */
export function runCases(update = false): CaseResult[] {
  return listCases().map((id) => runCase(id, update));
}

function main(): number {
  const update = process.argv.includes("--update");
  const results = runCases(update);
  if (results.length === 0) {
    console.error(`no cases found under ${relative(repoRoot, CASES_DIR)}`);
    return 1;
  }
  let failed = 0;
  for (const result of results) {
    if (result.problems.length === 0) {
      console.log(`${update ? "updated" : "passed "}  ${result.id}`);
      continue;
    }
    failed += 1;
    console.error(`failed   ${result.id}`);
    for (const problem of result.problems) console.error(`  ${problem}`);
  }
  console.log(`${results.length - failed} of ${results.length} cases ${update ? "updated" : "pass"}`);
  return failed === 0 ? 0 : 1;
}

if (import.meta.main) process.exit(main());
