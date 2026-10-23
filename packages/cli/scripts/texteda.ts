#!/usr/bin/env bun
// `texteda` command-line entry point.
//
// The file system appears only at this layer: the CLI does not enter core/ir/parser (ADR-0009 decision 1).
//
// Usage:
//   texteda init <dir> [--force] [--name <project name>]
//   texteda compile <project dir> <board_id> [--json] [--out <file>] [--pcb] [--procurement]
//   texteda check <project dir> [--json]
//   texteda netlist <project dir> [--board <board_id>] [--json] [--out <file>]
//   texteda ir <project dir> [--out <dir>] [--json]
//   texteda bom <project dir> <board_id> [--json] [--out <file>]
//   texteda view-metrics <project dir> <board>/<page> [--json]
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { initTree, projectNameFromDir } from "../src/init.ts";
import { runCompile } from "../src/compile.ts";
import { analyzeProject, checkProject } from "../src/check.ts";
import { runIr } from "../src/ir.ts";
import { runBom } from "../src/bom.ts";
import { runViewMetrics, splitPageRef } from "../src/view-metrics.ts";
import { formatNetlist, toNetlist } from "@texteda/exporter/netlist";
import { writeOut } from "../src/output.ts";
import { countByStage, diagnosticsToPayload, hintFor } from "@texteda/ir/diagnostics";

/** Known flags. Failures in the cli domain do not go into the --json diagnostics array; they go to stderr plus an exit code (ADR-0016). */
const KNOWN_FLAGS = new Set(["--force", "--name", "--json", "--out", "--board", "--pcb", "--procurement"]);
/** Flags that take a value: the argument after them is not a positional argument. */
const VALUE_FLAGS = new Set(["--name", "--out", "--board"]);

function fail(code: "cli.bad-flag" | "cli.bad-usage", message: string): never {
  console.error(`${code}: ${message}`);
  if (code === "cli.bad-usage") {
    console.error(
      [
        "Usage:",
        "  texteda init <dir> [--force] [--name <project name>]",
        "  texteda compile <project dir> <board_id> [--json] [--out <file>] [--pcb] [--procurement]",
        "  texteda check <project dir> [--json]",
        "  texteda netlist <project dir> [--board <board_id>] [--json] [--out <file>]",
        "  texteda ir <project dir> [--out <dir>] [--json]",
        "  texteda bom <project dir> <board_id> [--json] [--out <file>]",
        "  texteda view-metrics <project dir> <board>/<page> [--json]",
      ].join("\n"),
    );
  }
  process.exit(2);
}

interface ParsedArgs {
  /** Flags that appeared. */
  flags: Set<string>;
  /** Positional arguments (neither flags nor their values count). */
  positional: string[];
  /** Values of flags that take a value. */
  values: Map<string, string>;
}

/** Split arguments into three kinds: flags, flag values, and positional arguments. */
function parseArgs(args: string[]): ParsedArgs {
  const flags = new Set<string>();
  const values = new Map<string, string>();
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    if (!KNOWN_FLAGS.has(arg)) fail("cli.bad-flag", `Unknown flag ${arg}`);
    flags.add(arg);
    if (!VALUE_FLAGS.has(arg)) continue;
    const value = args[i + 1];
    if (value === undefined || value.startsWith("--")) {
      fail("cli.bad-usage", `Flag ${arg} is missing a value`);
    }
    values.set(arg, value);
    i++;
  }
  return { flags, positional, values };
}

function runInit(args: ParsedArgs): void {
  const target = args.positional[0] ?? fail("cli.bad-usage", "Missing target directory");
  if (args.positional.length > 1) fail("cli.bad-usage", "Too many arguments");
  const nameFlag = args.values.get("--name");

  const root = resolve(target);
  const name = nameFlag ?? projectNameFromDir(root);
  /** Display form of the target path: relative when inside the current directory, absolute otherwise. */
  const shown = (): string => {
    const rel = relative(process.cwd(), root);
    return rel && !rel.startsWith("..") ? rel : root;
  };

  // Refuse to run when the target directory is non-empty (--force overwrites); no merging, no guessing.
  if (existsSync(root)) {
    const entries = readdirSync(root);
    if (entries.length > 0 && !args.flags.has("--force")) {
      console.error(`${shown()} is not an empty directory, refusing to run (add --force to overwrite)`);
      process.exit(1);
    }
  }

  const tree = initTree({ name });
  for (const directory of tree.directories) mkdirSync(join(root, directory), { recursive: true });
  for (const file of tree.files) {
    const path = join(root, file.path);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, file.content);
  }

  console.log(`Created project ${name}: ${shown()}`);
  for (const file of tree.files) console.log(`  ${file.path}`);
}

function runCheck(args: ParsedArgs): void {
  const target = args.positional[0] ?? fail("cli.bad-usage", "Missing project directory");
  if (args.positional.length > 1) fail("cli.bad-usage", "Too many arguments");

  const result = checkProject(resolve(target));
  if (args.flags.has("--json")) {
    console.log(JSON.stringify(diagnosticsToPayload(result.diagnostics), null, 2));
  } else {
    for (const diagnostic of result.diagnostics) {
      const where = diagnostic.location
        ? `${diagnostic.location.file}:${diagnostic.location.line}:${diagnostic.location.col}: `
        : "";
      console.error(`${where}${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`);
      const hint = diagnostic.hint ?? hintFor(diagnostic.code);
      if (hint) console.error(`    How to fix: ${hint}`);
    }
    const errors = result.diagnostics.filter((d) => d.severity === "error").length;
    const warnings = result.diagnostics.filter((d) => d.severity === "warning").length;
    const byStage = countByStage(result.diagnostics);
    console.error(
      `Checked ${result.boards.length} boards: ${errors} errors, ${warnings} warnings` +
        ` (stages: parse ${byStage.parse} · contract ${byStage.contract} · design ${byStage.semantic})`,
    );
  }
  if (result.diagnostics.some((d) => d.severity === "error")) process.exit(1);
}

function runNetlist(args: ParsedArgs): void {
  const target = args.positional[0] ?? fail("cli.bad-usage", "Missing project directory");
  if (args.positional.length > 1) fail("cli.bad-usage", "Too many arguments");

  const only = args.values.get("--board");
  const result = analyzeProject(resolve(target));

  // Diagnostics go to stderr first: the netlist is a projection of the **validated** design — exporting with errors would only mislead downstream.
  for (const diagnostic of result.diagnostics) {
    if (diagnostic.severity !== "error") continue;
    const where = diagnostic.location
      ? `${diagnostic.location.file}:${diagnostic.location.line}:${diagnostic.location.col}: `
      : "";
    console.error(`${where}${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`);
  }
  const errors = result.diagnostics.filter((d) => d.severity === "error").length;
  if (errors > 0) {
    console.error(`Netlist not exported: ${errors} errors (run texteda check first to see how to fix them)`);
    process.exit(1);
  }

  const chosen = result.analyses.filter(
    (analysis) => analysis.ir !== undefined && (only === undefined || analysis.board === only),
  );
  if (chosen.length === 0) {
    fail(
      "cli.bad-usage",
      only === undefined
        ? "No exportable boards in the project"
        : `Board ${only} not found (available: ${result.boards.join(", ") || "none"})`,
    );
  }

  const netlists = chosen.map((analysis) => toNetlist(analysis.ir!));
  const text = args.flags.has("--json")
    ? `${JSON.stringify(netlists.length === 1 ? netlists[0] : netlists, null, 2)}\n`
    : netlists.map((netlist) => formatNetlist(netlist)).join("\n");

  const out = args.values.get("--out");
  if (out === undefined) {
    process.stdout.write(text);
    return;
  }
  const path = resolve(out);
  mkdirSync(dirname(path), { recursive: true });
  writeOut(path, text);
  console.error(`Wrote ${out}`);
}

const argv = process.argv.slice(2);
const command = argv[0];
const args = parseArgs(argv.slice(1));

if (command === "init") {
  runInit(args);
} else if (command === "compile") {
  const root = args.positional[0] ?? fail("cli.bad-usage", "Missing project directory");
  const board = args.positional[1] ?? fail("cli.bad-usage", "Missing board_id");
  if (args.positional.length > 2) fail("cli.bad-usage", "Too many arguments");
  process.exit(
    runCompile({
      root: resolve(root),
      board,
      json: args.flags.has("--json"),
      outFile: args.values.get("--out"),
      pcb: args.flags.has("--pcb"),
      procurement: args.flags.has("--procurement"),
    }),
  );
} else if (command === "check") {
  runCheck(args);
} else if (command === "netlist") {
  runNetlist(args);
} else if (command === "bom") {
  const root = args.positional[0] ?? fail("cli.bad-usage", "Missing project directory");
  const board = args.positional[1] ?? fail("cli.bad-usage", "Missing board_id");
  if (args.positional.length > 2) fail("cli.bad-usage", "Too many arguments");
  process.exit(
    runBom({
      root: resolve(root),
      board,
      json: args.flags.has("--json"),
      outFile: args.values.get("--out"),
    }),
  );
} else if (command === "view-metrics") {
  const root = args.positional[0] ?? fail("cli.bad-usage", "Missing project directory");
  const ref = args.positional[1] ?? fail("cli.bad-usage", "Missing board/page");
  if (args.positional.length > 2) fail("cli.bad-usage", "Too many arguments");
  const pageRef = splitPageRef(ref) ?? fail("cli.bad-usage", `Not a board/page reference: ${ref}`);
  process.exit(
    runViewMetrics({
      root: resolve(root),
      board: pageRef.board,
      page: pageRef.page,
      json: args.flags.has("--json"),
    }),
  );
} else if (command === "ir") {
  const root = args.positional[0] ?? fail("cli.bad-usage", "Missing project directory");
  if (args.positional.length > 1) fail("cli.bad-usage", "Too many arguments");
  process.exit(
    runIr({
      root: resolve(root),
      outDir: args.values.get("--out"),
      json: args.flags.has("--json"),
    }),
  );
} else {
  fail("cli.bad-usage", command === undefined ? "Missing command" : `Unknown command: ${command}`);
}
