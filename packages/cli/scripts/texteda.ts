#!/usr/bin/env bun
// `texteda` command-line entry point.
//
// The file system appears only at this layer: the CLI does not enter core/ir/parser (ADR-0137 decision 1).
//
// Usage:
//   texteda init <dir> [--force] [--name <project name>]
//   texteda id <project dir> [--count N] [--json]
//   texteda renumber <project dir> <board_id> [--policy preserve|compact|position] [--mapping <file>] [--apply] [--dry-run] [--json]
//   texteda compile <project dir> <board_id> [--json] [--out <file>] [--pcb] [--procurement]
//   texteda check <project dir> [--json]
//   texteda netlist <project dir> [--board <board_id>] [--json] [--out <file>]
//   texteda ir <project dir> [--out <dir>] [--json]
//   texteda bom <project dir> <board_id> [--json] [--out <file>]
//   texteda view metrics <project dir> <board>/<page> [--json]
//   texteda view rewire <project dir> <board>/<page> [--dry-run] [--json]
//   texteda view render <project dir> <board>/<page> [--out <file>] [--json]
//   texteda review <project dir> [--port <n>] [--out <file>]
//   texteda export gerbers <project dir> <board_id> [--out <dir>] [--json]
//   texteda tools --json
//   texteda lib import <name> --from <dir> --rev <rev> [--only <id>,…] [--dest <lib>] [--project <dir>] [--trust <file>] [--force]
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { initTree, projectNameFromDir } from "../src/init.ts";
import { runCompile } from "../src/compile.ts";
import { buildCheck } from "../src/check.ts";
import { runIr } from "../src/ir.ts";
import { runBom } from "../src/bom.ts";
import { runViewMetrics, runViewRender, runViewRewire, splitPageRef } from "../src/view.ts";
import { runReview } from "../src/review.ts";
import { runId } from "../src/id.ts";
import { runRenumber } from "../src/renumber.ts";
import { runLibImport } from "../src/lib-import.ts";
import { buildNetlist } from "../src/netlist.ts";
import { toolCatalogue } from "../src/tools.ts";
import { reportExport, runExport } from "../src/export.ts";
import { writeOut } from "../src/output.ts";

/** Known flags. Failures in the cli domain do not go into the --json diagnostics array; they go to stderr plus an exit code (ADR-0102). */
const KNOWN_FLAGS = new Set([
  "--force",
  "--name",
  "--json",
  "--out",
  "--board",
  "--pcb",
  "--procurement",
  "--from",
  "--rev",
  "--project",
  "--only",
  "--dest",
  "--trust",
  "--port",
  "--count",
  "--apply",
  "--dry-run",
  "--policy",
  "--mapping",
]);
/** Flags that take a value: the argument after them is not a positional argument. */
const VALUE_FLAGS = new Set([
  "--name",
  "--out",
  "--board",
  "--from",
  "--rev",
  "--project",
  "--only",
  "--dest",
  "--trust",
  "--port",
  "--count",
  "--policy",
  "--mapping",
]);

function fail(code: "cli.bad-flag" | "cli.bad-usage", message: string): never {
  console.error(`${code}: ${message}`);
  if (code === "cli.bad-usage") {
    console.error(
      [
        "Usage:",
        "  texteda init <dir> [--force] [--name <project name>]",
        "  texteda id <project dir> [--count N] [--json]",
        "  texteda renumber <project dir> <board_id> [--policy preserve|compact|position] [--mapping <file>] [--apply] [--dry-run] [--json]",
        "  texteda compile <project dir> <board_id> [--json] [--out <file>] [--pcb] [--procurement]",
        "  texteda check <project dir> [--json]",
        "  texteda netlist <project dir> [--board <board_id>] [--json] [--out <file>]",
        "  texteda ir <project dir> [--out <dir>] [--json]",
        "  texteda bom <project dir> <board_id> [--json] [--out <file>]",
        "  texteda view metrics <project dir> <board>/<page> [--json]",
        "  texteda view rewire <project dir> <board>/<page> [--dry-run] [--json]",
        "  texteda view render <project dir> <board>/<page> [--out <file>] [--json]",
        "  texteda review <project dir> [--port <n>] [--out <file>]",
        "  texteda export gerbers <project dir> <board_id> [--out <dir>] [--json]",
        "  texteda tools --json",
        "  texteda lib import <name> --from <dir> --rev <rev> [--only <id>,…] [--dest <lib>] [--project <dir>] [--trust <file>] [--force]",
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

  const built = buildCheck(resolve(target));
  const { payload, boards } = built.value!;
  if (args.flags.has("--json")) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    for (const diagnostic of payload.diagnostics) {
      const where = diagnostic.location
        ? `${diagnostic.location.file}:${diagnostic.location.line}:${diagnostic.location.col}: `
        : "";
      console.error(`${where}${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`);
      if (diagnostic.hint) console.error(`    How to fix: ${diagnostic.hint}`);
      // A reference has two ends (ADR-0103 D5): the line to fix, and where the thing is defined.
      for (const related of diagnostic.related ?? []) {
        console.error(`    See also: ${related.file}:${related.line}:${related.col}`);
      }
    }
    const byStage = payload.countsByStage;
    console.error(
      `Checked ${boards.length} boards: ${payload.errorCount} errors, ${payload.warningCount} warnings` +
        ` (stages: parse ${byStage.parse} · contract ${byStage.contract} · design ${byStage.semantic})`,
    );
  }
  if (payload.errorCount > 0) process.exit(1);
}

function runNetlist(args: ParsedArgs): void {
  const target = args.positional[0] ?? fail("cli.bad-usage", "Missing project directory");
  if (args.positional.length > 1) fail("cli.bad-usage", "Too many arguments");

  const only = args.values.get("--board");
  const built = buildNetlist({ root: resolve(target), ...(only === undefined ? {} : { board: only }) });
  if (!built.ok) {
    if (built.code === "cli.bad-usage") fail("cli.bad-usage", built.error ?? "Bad usage");
    console.error(built.error ?? "The netlist could not be exported");
    process.exit(1);
  }

  const value = built.value!;
  const text = args.flags.has("--json")
    ? `${JSON.stringify(value.payload, null, 2)}\n`
    : value.text;

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
} else if (command === "id") {
  const root = args.positional[0] ?? fail("cli.bad-usage", "Missing project directory");
  if (args.positional.length > 1) fail("cli.bad-usage", "Too many arguments");
  const countText = args.values.get("--count");
  const count = countText === undefined ? 1 : Number(countText);
  if (!Number.isInteger(count) || count < 1) fail("cli.bad-usage", `Not a positive integer: ${countText}`);
  process.exit(runId({ root: resolve(root), count, json: args.flags.has("--json") }));
} else if (command === "renumber") {
  const root = args.positional[0] ?? fail("cli.bad-usage", "Missing project directory");
  const board = args.positional[1] ?? fail("cli.bad-usage", "Missing board id");
  if (args.positional.length > 2) fail("cli.bad-usage", "Too many arguments");
  if (args.flags.has("--apply") && args.flags.has("--dry-run")) {
    fail("cli.bad-usage", "--apply and --dry-run are mutually exclusive");
  }
  const mapping = args.values.get("--mapping");
  const policyFlag = args.values.get("--policy");
  if (mapping !== undefined && policyFlag !== undefined) {
    fail("cli.bad-usage", "--mapping and --policy are mutually exclusive");
  }
  if (policyFlag !== undefined && policyFlag !== "preserve" && policyFlag !== "compact" && policyFlag !== "position") {
    fail("cli.bad-usage", "--policy must be preserve, compact, or position");
  }
  process.exit(
    runRenumber({
      root: resolve(root),
      board,
      ...(policyFlag === undefined ? {} : { policy: policyFlag }),
      ...(mapping === undefined ? {} : { mapping: resolve(mapping) }),
      apply: args.flags.has("--apply"),
      json: args.flags.has("--json"),
    }),
  );
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
} else if (command === "view") {
  const sub = args.positional[0] ?? fail("cli.bad-usage", "Missing view subcommand: metrics, rewire, render");
  const root = args.positional[1] ?? fail("cli.bad-usage", "Missing project directory");
  const ref = args.positional[2] ?? fail("cli.bad-usage", "Missing board/page");
  if (args.positional.length > 3) fail("cli.bad-usage", "Too many arguments");
  const pageRef = splitPageRef(ref) ?? fail("cli.bad-usage", `Not a board/page reference: ${ref}`);
  if (sub === "metrics") {
    process.exit(
      runViewMetrics({
        root: resolve(root),
        board: pageRef.board,
        page: pageRef.page,
        json: args.flags.has("--json"),
      }),
    );
  } else if (sub === "rewire") {
    process.exit(
      runViewRewire({
        root: resolve(root),
        board: pageRef.board,
        page: pageRef.page,
        dryRun: args.flags.has("--dry-run"),
        json: args.flags.has("--json"),
      }),
    );
  } else if (sub === "render") {
    const outFile = args.values.get("--out");
    process.exit(
      runViewRender({
        root: resolve(root),
        board: pageRef.board,
        page: pageRef.page,
        json: args.flags.has("--json"),
        ...(outFile === undefined ? {} : { outFile }),
      }),
    );
  } else {
    fail("cli.bad-usage", `Unknown view subcommand: ${sub} (metrics, rewire, render)`);
  }
} else if (command === "view-metrics") {
  fail("cli.bad-usage", "`texteda view-metrics` is now `texteda view metrics <project dir> <board>/<page>`");
} else if (command === "review") {
  const root = args.positional[0] ?? fail("cli.bad-usage", "Missing project directory");
  if (args.positional.length > 1) fail("cli.bad-usage", "Too many arguments");
  const portText = args.values.get("--port");
  const port = portText === undefined ? 0 : Number(portText);
  if (!Number.isInteger(port) || port < 0 || port > 65535) fail("cli.bad-usage", `Not a port: ${portText}`);
  // `exitCode`, not `exit`: the server keeps the event loop alive, and `process.exit` would close it
  // before the first request. With `--out` the process has nothing left to do and ends on its own.
  process.exitCode = await runReview({
    root: resolve(root),
    port,
    outFile: args.values.get("--out"),
  });
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
} else if (command === "export") {
  if (args.positional[0] !== "gerbers") {
    fail("cli.bad-usage", "Only `texteda export gerbers` exists: RS-274X layers and the NC drill file (ADR-0117, backlog F15)");
  }
  const root = args.positional[1] ?? fail("cli.bad-usage", "Missing project directory");
  const board = args.positional[2] ?? fail("cli.bad-usage", "Missing board id");
  if (args.positional.length > 3) fail("cli.bad-usage", "Too many arguments");
  const outDir = args.values.get("--out");
  const options = {
    root: resolve(root),
    board,
    ...(outDir === undefined ? {} : { outDir: resolve(outDir) }),
    json: args.flags.has("--json"),
  };
  const result = runExport(options);
  process.exit(
    reportExport(result, options, resolve(outDir ?? join(options.root, "dist", "fab", board))),
  );
} else if (command === "tools") {
  if (args.positional.length > 0) fail("cli.bad-usage", "Too many arguments");
  if (!args.flags.has("--json")) fail("cli.bad-usage", "`texteda tools` needs --json: the catalogue is machine-readable");
  console.log(JSON.stringify(toolCatalogue(), null, 2));
} else if (command === "lib") {
  if (args.positional[0] !== "import") {
    fail(
      "cli.bad-usage",
      "Only `texteda lib import` exists: it copies a library's devices into assets/ (an external library is a template, ADR-0133)",
    );
  }
  const name = args.positional[1] ?? fail("cli.bad-usage", "Missing library name");
  if (args.positional.length > 2) fail("cli.bad-usage", "Too many arguments");
  const from = args.values.get("--from") ?? fail("cli.bad-usage", "Missing --from <dir>");
  const rev = args.values.get("--rev") ?? fail("cli.bad-usage", "Missing --rev <tag or commit>");
  const only = (args.values.get("--only") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
  process.exit(
    runLibImport({
      root: resolve(args.values.get("--project") ?? process.cwd()),
      name,
      from: resolve(from),
      rev,
      only,
      ...(args.values.get("--dest") !== undefined ? { dest: args.values.get("--dest")! } : {}),
      ...(args.values.get("--trust") !== undefined ? { trust: resolve(args.values.get("--trust")!) } : {}),
      force: args.flags.has("--force"),
    }),
  );
} else {
  fail("cli.bad-usage", command === undefined ? "Missing command" : `Unknown command: ${command}`);
}
