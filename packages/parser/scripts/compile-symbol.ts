#!/usr/bin/env bun
// Compile a `symbol` description: `.teda` source -> IR shard (canonical JSON).
//
// Usage: bun run scripts/compile-symbol.ts <file.teda> [--library <name>] [--json] [--out <file>]
//   --library  library name (IR's symbol.library); defaults to the containing directory name.
//   --json     output only the diagnostics payload (ADR-0003): stdout has the shape of `diagnosticsToPayload`.
//   --out      output file; defaults to stdout (in --json mode the IR only goes through --out).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import { schemaDiagnosticsToDiagnostics, spanOf, validate } from "@texteda/ir";
import { diagnosticsToPayload, type Diagnostic } from "@texteda/ir/diagnostics";
import { canonicalJson, formatDiagnostic, parseSymbol } from "../src/index.ts";

const args = process.argv.slice(2);
/** Flags that take a value: the next argument is not positional. */
const VALUE_FLAGS: Record<string, true> = { "--library": true, "--out": true };

const positional: string[] = [];
let library: string | undefined;
let outFile: string | undefined;
let jsonMode = false;
for (let i = 0; i < args.length; i++) {
  const arg = args[i]!;
  if (arg === "--json") {
    jsonMode = true;
    continue;
  }
  if (VALUE_FLAGS[arg] === true) {
    const value = args[i + 1];
    if (value === undefined) {
      console.error(`Usage: bun run scripts/compile-symbol.ts <file.teda> [--library <name>] [--json] [--out <file>]`);
      console.error(`flag ${arg} is missing its value`);
      process.exit(2);
    }
    if (arg === "--library") library = value;
    else outFile = value;
    i++;
    continue;
  }
  if (arg.startsWith("--")) continue;
  positional.push(arg);
}

const file = positional[0];
if (!file) {
  console.error("Usage: bun run scripts/compile-symbol.ts <file.teda> [--library <name>] [--json] [--out <file>]");
  process.exit(2);
}
if (library === undefined) library = basename(dirname(file));

const text = readFileSync(file, "utf8");
// IR's `source.file` must be a path relative to the project root (schema contract); an absolute path violates it outright.
const sourceFile = relative(process.cwd(), resolve(file));
if (sourceFile.startsWith("..")) {
  console.error(`file must be under the current directory: ${file} (the IR contract requires source.file to be relative)`);
  process.exit(2);
}
const parsed = parseSymbol(text, { file: sourceFile, library });

// Merge parse diagnostics and schema diagnostics into one payload: agents only need a single array.
const diagnostics: Diagnostic[] = [...parsed.diagnostics];
let schemaFailed = false;
if (parsed.ir) {
  const check = validate("symbol", parsed.ir);
  if (!check.ok) {
    const sources = parsed.sources;
    diagnostics.push(
      ...schemaDiagnosticsToDiagnostics(
        check.errors,
        sources === undefined ? undefined : (irPath) => spanOf(sources, irPath),
      ),
    );
    schemaFailed = true;
  }
}

if (jsonMode) {
  // Payload shape see ADR-0003: code / severity / location / data are the machine contract.
  console.log(JSON.stringify(diagnosticsToPayload(diagnostics), null, 2));
} else {
  for (const d of diagnostics) console.error(formatDiagnostic(d));
}

if (!parsed.ok || !parsed.ir || schemaFailed) process.exit(1);

const json = canonicalJson(parsed.ir);
if (outFile !== undefined) {
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, json);
  console.error(`wrote ${outFile}`);
} else if (!jsonMode) {
  // --json means "diagnostics as JSON output": stdout is already taken by diagnostics, so the IR only lands on disk via --out or in default mode.
  console.log(json);
}
