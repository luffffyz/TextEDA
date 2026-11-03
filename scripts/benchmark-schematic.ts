#!/usr/bin/env bun
// Deterministic synthetic S0 workloads for measuring the project schematic checker.
//
// Usage: bun run bench:schematic -- [--shape all|sparse|fanout] [--sizes 128,512,2048]
//        [--repeats 3] [--warmups 1] [--json] [--keep]
// Each case runs in its own worker so peak RSS is isolated. Timings cover checkProject(), not
// process startup or project generation. The benchmark reports measurements; it sets no limit.
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject, checkProject } from "../packages/cli/src/check.ts";

const UID_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
const MAX_UIDS = UID_ALPHABET.length ** 6;
const MAX_LINE_LENGTH = 80;
const REFERENCE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../examples/reference-project");
const SCRIPT_PATH = fileURLToPath(import.meta.url);

export type Shape = "sparse" | "fanout";
type ShapeOption = Shape | "all";

interface Options {
  shape: ShapeOption;
  sizes: number[];
  repeats: number;
  warmups: number;
  json: boolean;
  keep: boolean;
}

interface WorkerMetrics {
  samples_ms: number[];
  error_count: number;
  warning_count: number;
  note_count: number;
  peak_rss_mib: number;
}

interface CaseMetrics extends WorkerMetrics {
  shape: "sparse-ring" | "high-fanout";
  instances: number;
  nets: number;
  max_net_members: number;
  schematic_bytes: number;
  schematic_lines: number;
  project_source_bytes: number;
  min_ms: number;
  median_ms: number;
  max_ms: number;
  retained_project?: string;
}

function usage(): string {
  return [
    "Usage: bun run bench:schematic -- [options]",
    "  --shape all|sparse|fanout   Workload shape (default: all)",
    "  --sizes N,N,...            Instance counts, each at least 2 (default: 128,512,2048)",
    "  --repeats N                Timed checks per case (default: 3)",
    "  --warmups N                Untimed checks per worker (default: 1)",
    "  --json                     Print machine-readable JSON",
    "  --keep                     Retain generated projects under the temporary directory",
    "  --help                     Show this help",
  ].join("\n");
}

function positiveInteger(value: string, flag: string, allowZero = false): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < (allowZero ? 0 : 1)) {
    throw new Error(`${flag} expects ${allowZero ? "a non-negative" : "a positive"} integer`);
  }
  return parsed;
}

function parseOptions(args: string[]): Options {
  const options: Options = {
    shape: "all",
    sizes: [128, 512, 2048],
    repeats: 3,
    warmups: 1,
    json: false,
    keep: false,
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--keep") {
      options.keep = true;
      continue;
    }
    if (arg === "--shape" || arg === "--sizes" || arg === "--repeats" || arg === "--warmups") {
      const value = args[++i];
      if (value === undefined || value.startsWith("--")) throw new Error(`${arg} requires a value`);
      if (arg === "--shape") {
        if (value !== "all" && value !== "sparse" && value !== "fanout") {
          throw new Error("--shape must be all, sparse, or fanout");
        }
        options.shape = value;
      } else if (arg === "--sizes") {
        const sizes = value.split(",").map((item) => positiveInteger(item, "--sizes"));
        if (sizes.some((size) => size < 2)) throw new Error("--sizes values must be at least 2");
        if (sizes.some((size) => size > MAX_UIDS)) throw new Error(`--sizes values cannot exceed ${MAX_UIDS}`);
        if (new Set(sizes).size !== sizes.length) throw new Error("--sizes values must be unique");
        options.sizes = sizes;
      } else if (arg === "--repeats") {
        options.repeats = positiveInteger(value, arg);
      } else {
        options.warmups = positiveInteger(value, arg, true);
      }
      continue;
    }
    throw new Error(`unknown option: ${arg}\n\n${usage()}`);
  }
  return options;
}

function uid(index: number): string {
  let value = index;
  let suffix = "";
  for (let digit = 0; digit < 6; digit++) {
    suffix = UID_ALPHABET[value % UID_ALPHABET.length]! + suffix;
    value = Math.floor(value / UID_ALPHABET.length);
  }
  if (value !== 0) throw new Error(`UID index is out of range: ${index}`);
  return `ID${suffix}`;
}

function wrapNet(name: string, members: readonly string[]): string[] {
  const rows: string[] = [];
  let row = `  ${name}:`;
  for (const member of members) {
    const candidate = `${row}  ${member}`;
    if (candidate.length <= MAX_LINE_LENGTH) {
      row = candidate;
      continue;
    }
    rows.push(row);
    row = `  :        ${member}`;
  }
  rows.push(row);
  return rows;
}

export function schematicSource(shape: Shape, count: number): string {
  const instances = Array.from(
    { length: count },
    (_, index) => `  R${index + 1}  ${uid(index)}  res-thick-0402  10k  ±1%`,
  );
  const netRows =
    shape === "sparse"
      ? Array.from({ length: count }, (_, index) => {
          const previous = (index + count - 1) % count;
          return `  N${index + 1}:  R${previous + 1}.2  R${index + 1}.1`;
        })
      : [
          ...wrapNet("BUS", Array.from({ length: count }, (_, index) => `R${index + 1}.1`)),
          ...wrapNet("RETURN", Array.from({ length: count }, (_, index) => `R${index + 1}.2`)),
        ];
  return ["version 0.9.2", "schematic benchmark", "", "instances", ...instances, "", "nets", ...netRows, ""].join("\n");
}

export function makeProject(root: string, shape: Shape, count: number): { schematic: string; nets: number; maxNetMembers: number } {
  const component = "assets/components/passives/res-thick-0402.teda";
  const symbol = "assets/symbols/passives/r.teda";
  const footprint = "assets/footprints/chip/chip-0402.teda";
  for (const relative of [component, symbol, footprint]) {
    const destination = join(root, relative);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(join(REFERENCE_ROOT, relative), destination);
  }
  mkdirSync(join(root, "design/sch"), { recursive: true });
  writeFileSync(
    join(root, "project.toml"),
    '[project]\nname = "schematic-benchmark"\nversion = "0.1.0"\nformat = "0.9.2"\n',
  );
  const source = schematicSource(shape, count);
  const schematic = join(root, "design/sch/benchmark.teda");
  writeFileSync(schematic, source);
  return {
    schematic,
    nets: shape === "sparse" ? count : 2,
    maxNetMembers: shape === "sparse" ? 2 : count,
  };
}

function errorDiagnostics(diagnostics: readonly { severity: string; code: string; message: string; location?: { file: string; line: number; col: number } }[]): string[] {
  return diagnostics
    .filter((diagnostic) => diagnostic.severity === "error")
    .map((diagnostic) => {
      const at = diagnostic.location === undefined ? "" : ` ${diagnostic.location.file}:${diagnostic.location.line}:${diagnostic.location.col}`;
      return `${diagnostic.code}${at}: ${diagnostic.message}`;
    });
}

function verifyGeneratedProject(root: string, count: number, expectedNets: number): void {
  const result = analyzeProject(root);
  const errors = errorDiagnostics(result.diagnostics);
  if (errors.length > 0) throw new Error(`generated project has ${errors.length} error diagnostic(s):\n${errors.slice(0, 8).join("\n")}`);
  if (result.boards.length !== 1 || result.boards[0] !== "benchmark") {
    throw new Error(`expected only the benchmark board, got ${JSON.stringify(result.boards)}`);
  }
  const schematic = result.analyses[0]?.ir;
  if (schematic === undefined) throw new Error("generated benchmark schematic did not produce IR");
  if (schematic.instances.length !== count || schematic.nets.length !== expectedNets) {
    throw new Error(
      `generated IR has ${schematic.instances.length} instances and ${schematic.nets.length} nets; expected ${count} and ${expectedNets}`,
    );
  }
}

function runWorker(root: string, count: number, expectedNets: number, repeats: number, warmups: number): WorkerMetrics {
  verifyGeneratedProject(root, count, expectedNets);
  for (let run = 0; run < warmups; run++) {
    const result = checkProject(root);
    const errors = errorDiagnostics(result.diagnostics);
    if (errors.length > 0) throw new Error(`warm-up check produced errors:\n${errors.slice(0, 8).join("\n")}`);
  }

  const samples: number[] = [];
  let finalDiagnostics: ReturnType<typeof checkProject>["diagnostics"] = [];
  for (let run = 0; run < repeats; run++) {
    const start = process.hrtime.bigint();
    const result = checkProject(root);
    samples.push(Number(process.hrtime.bigint() - start) / 1_000_000);
    const errors = errorDiagnostics(result.diagnostics);
    if (errors.length > 0) throw new Error(`timed check produced errors:\n${errors.slice(0, 8).join("\n")}`);
    if (result.boards.length !== 1 || result.boards[0] !== "benchmark") {
      throw new Error(`timed check returned unexpected boards: ${JSON.stringify(result.boards)}`);
    }
    finalDiagnostics = result.diagnostics;
  }

  const counts = (severity: string): number => finalDiagnostics.filter((diagnostic) => diagnostic.severity === severity).length;
  const maxRss = process.resourceUsage().maxRSS;
  const maxRssBytes = maxRss * (process.platform === "darwin" ? 1 : 1024);
  return {
    samples_ms: samples,
    error_count: counts("error"),
    warning_count: counts("warning"),
    note_count: counts("note"),
    peak_rss_mib: maxRssBytes / (1024 * 1024),
  };
}

function workerArguments(args: string[]): { root: string; count: number; nets: number; repeats: number; warmups: number } {
  const [root, count, nets, repeats, warmups] = args;
  if (root === undefined || count === undefined || nets === undefined || repeats === undefined || warmups === undefined) {
    throw new Error("worker mode requires project path, instance count, net count, repeats, and warm-ups");
  }
  return {
    root,
    count: positiveInteger(count, "worker instance count"),
    nets: positiveInteger(nets, "worker net count"),
    repeats: positiveInteger(repeats, "worker repeats"),
    warmups: positiveInteger(warmups, "worker warm-ups", true),
  };
}

function summarize(samples: readonly number[]): { min: number; median: number; max: number } {
  const ordered = [...samples].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  const median = ordered.length % 2 === 0 ? (ordered[middle - 1]! + ordered[middle]!) / 2 : ordered[middle]!;
  return { min: ordered[0]!, median, max: ordered[ordered.length - 1]! };
}

function measureCase(
  workRoot: string,
  shape: Shape,
  count: number,
  repeats: number,
  warmups: number,
  keep: boolean,
): CaseMetrics {
  const projectRoot = join(workRoot, `${shape}-${count}`);
  mkdirSync(projectRoot, { recursive: true });
  const generated = makeProject(projectRoot, shape, count);
  const sourceBytes = statSync(generated.schematic).size;
  const projectSourceBytes = [
    "project.toml",
    "assets/components/passives/res-thick-0402.teda",
    "assets/symbols/passives/r.teda",
    "assets/footprints/chip/chip-0402.teda",
    "design/sch/benchmark.teda",
  ].reduce((total, relative) => total + statSync(join(projectRoot, relative)).size, 0);
  const child = Bun.spawnSync(
    [process.execPath, SCRIPT_PATH, "--worker", projectRoot, String(count), String(generated.nets), String(repeats), String(warmups)],
    { stdin: "ignore", stdout: "pipe", stderr: "pipe" },
  );
  if (child.exitCode !== 0) {
    throw new Error(`benchmark worker failed for ${shape}/${count}:\n${child.stderr.toString() || child.stdout.toString()}`);
  }
  let worker: WorkerMetrics;
  try {
    worker = JSON.parse(child.stdout.toString()) as WorkerMetrics;
  } catch (error) {
    throw new Error(`benchmark worker returned invalid JSON for ${shape}/${count}: ${String(error)}\n${child.stdout.toString()}`);
  }
  if (worker.error_count !== 0 || worker.samples_ms.length !== repeats) {
    throw new Error(`benchmark worker returned invalid measurements for ${shape}/${count}`);
  }
  const summary = summarize(worker.samples_ms);
  return {
    ...worker,
    shape: shape === "sparse" ? "sparse-ring" : "high-fanout",
    instances: count,
    nets: generated.nets,
    max_net_members: generated.maxNetMembers,
    schematic_bytes: sourceBytes,
    schematic_lines: readFileSync(generated.schematic, "utf8").split("\n").length - 1,
    project_source_bytes: projectSourceBytes,
    min_ms: summary.min,
    median_ms: summary.median,
    max_ms: summary.max,
    ...(keep ? { retained_project: projectRoot } : {}),
  };
}

function printHuman(cases: readonly CaseMetrics[], sizes: readonly number[], repeats: number, warmups: number): void {
  console.log(`TextEDA schematic checker benchmark — Bun ${Bun.version} (${process.platform}/${process.arch})`);
  console.log(`Timed checkProject() runs: ${repeats} per case; warm-ups: ${warmups}; each case uses an isolated process.`);
  console.log("Peak RSS includes that worker's Bun startup and module loading. No performance limit is set.");
  console.log(`Instance counts: ${sizes.join(", ")}`);
  console.log("shape        instances  nets  max fan-out  schematic KiB  lines  median ms  min–max ms  peak RSS MiB  warnings");
  for (const item of cases) {
    console.log(
      [
        item.shape.padEnd(12),
        String(item.instances).padStart(9),
        String(item.nets).padStart(5),
        String(item.max_net_members).padStart(12),
        (item.schematic_bytes / 1024).toFixed(1).padStart(14),
        String(item.schematic_lines).padStart(6),
        item.median_ms.toFixed(2).padStart(10),
        `${item.min_ms.toFixed(2)}–${item.max_ms.toFixed(2)}`.padStart(11),
        item.peak_rss_mib.toFixed(1).padStart(12),
        String(item.warning_count).padStart(9),
      ].join("  "),
    );
  }
  if (cases.some((item) => item.retained_project !== undefined)) {
    for (const item of cases) console.log(`${item.shape}/${item.instances}: ${item.retained_project}`);
  }
}

function runParent(args: string[]): void {
  const options = parseOptions(args);
  const shapes: Shape[] = options.shape === "all" ? ["sparse", "fanout"] : [options.shape];
  const workRoot = mkdtempSync(join(tmpdir(), "texteda-schematic-bench-"));
  const cases: CaseMetrics[] = [];
  try {
    for (const shape of shapes) {
      for (const count of options.sizes) {
        cases.push(measureCase(workRoot, shape, count, options.repeats, options.warmups, options.keep));
      }
    }
  } finally {
    if (!options.keep) rmSync(workRoot, { recursive: true, force: true });
  }

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          benchmark: "texteda-schematic-check",
          version: 1,
          runtime: { bun: Bun.version, platform: process.platform, arch: process.arch },
          measurement: "warm in-process checkProject() elapsed time; each case is a fresh worker process",
          peak_rss_note: "process high-water RSS includes worker startup and module loading",
          repeats: options.repeats,
          warmups: options.warmups,
          cases,
        },
        null,
        2,
      ),
    );
  } else {
    printHuman(cases, options.sizes, options.repeats, options.warmups);
  }
}

function main(): void {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  try {
    if (args[0] === "--worker") {
      const input = workerArguments(args.slice(1));
      console.log(JSON.stringify(runWorker(input.root, input.count, input.nets, input.repeats, input.warmups)));
    } else {
      runParent(args);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  }
}

if (import.meta.main) main();
