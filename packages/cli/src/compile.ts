// `texteda compile`: compile a board's schematic into an IR shard (canonical JSON).
//
// Usage:
//   texteda compile <project dir> <board_id>              print canonical JSON
//   texteda compile <project dir> <board_id> --json       print only the diagnostic payload (ADR-0016)
//   texteda compile <project dir> <board_id> --out <file>  write the IR to a file
import { existsSync, readFileSync } from "node:fs";
import { schemaDiagnosticsToDiagnostics, validate } from "@texteda/ir";
import { diagnosticsToPayload } from "@texteda/ir/diagnostics";
import { canonicalJson, parsePcb, parseProcurement, parseSchematic } from "@texteda/parser";
import { join } from "node:path";
import { LAYOUT } from "./paths.ts";
import { loadBoard, loadComponents, loadModules, loadProcurement } from "./project.ts";
import { writeOut } from "./output.ts";

export interface CompileOptions {
  /** Project root directory. */
  root: string;
  /** Board id. */
  board: string;
  /** Emit only the diagnostic payload. */
  json: boolean;
  /** IR output file; defaults to stdout (in `--json` mode the IR only goes through `--out`). */
  outFile?: string | undefined;
  /** Compile `pcb/<board>.teda` instead of the schematic. */
  pcb?: boolean | undefined;
  /** Compile the board's procurement file instead of the schematic. */
  procurement?: boolean | undefined;
}

/**
 * Compile one board. Returns the process exit code: 0 success, 1 errors present, 2 usage or missing file.
 */
export function runCompile(options: CompileOptions): number {
  const { root, board, json, outFile } = options;
  if (options.pcb === true) return runCompilePcb({ root, board, json, outFile });
  if (options.procurement === true) return runCompileProcurement({ root, board, json, outFile });
  const loaded = loadBoard(root, board);
  if (!loaded) {
    console.error(`Board root file not found: ${LAYOUT.sch}/${board}.teda`);
    return 2;
  }
  const { resolver, problems } = loadComponents(root);
  const result = parseSchematic(loaded.text, {
    file: loaded.file,
    board,
    components: resolver,
    modules: loadModules(root),
  });

  for (const problem of problems) {
    console.error(`Component index: ${problem.file}:${problem.line}: ${problem.message}`);
  }

  if (json) {
    // Payload shape per ADR-0016: code / severity / location / data are the machine contract.
    console.log(JSON.stringify(diagnosticsToPayload(result.diagnostics), null, 2));
  } else {
    for (const diagnostic of result.diagnostics) {
      const where = diagnostic.location
        ? `${diagnostic.location.file}:${diagnostic.location.line}:${diagnostic.location.col}: `
        : "";
      console.error(`${where}${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`);
    }
  }

  if (!result.ir) return 1;
  const check = validate("schematic", result.ir);
  if (!check.ok) {
    console.error("IR does not satisfy the schematic contract:");
    for (const diagnostic of schemaDiagnosticsToDiagnostics(check.errors)) {
      console.error(`  ${diagnostic.code}: ${diagnostic.message}`);
    }
    return 1;
  }

  const jsonText = canonicalJson(result.ir);
  if (outFile) {
    writeOut(outFile, `${jsonText}\n`);
    console.error(`Wrote ${outFile}`);
  } else if (!json) {
    // --json means "diagnostics as JSON output"; stdout is already taken by diagnostics, so the IR only lands on disk via --out or in default mode.
    console.log(jsonText);
  }
  return 0;
}

/** Compile `pcb/<board>.teda`. Same contract as the schematic (`schemas/ir/v0.5/pcb.schema.json`). */
/**
 * Compile the board's primary procurement file (`assets/procurement/primary/<board>.teda`).
 *
 * The primary is the normative one: it is the parts the board is built from. The alternatives are
 * advisory and reach the shard tree through `texteda ir`.
 */
function runCompileProcurement(options: {
  root: string;
  board: string;
  json: boolean;
  outFile: string | undefined;
}): number {
  const { root, board, json, outFile } = options;
  const source = loadProcurement(root, board, "primary");
  if (!source) {
    console.error(`Procurement description not found: ${LAYOUT.procurement}/primary/${board}.teda`);
    return 2;
  }
  const { resolver, problems } = loadComponents(root);
  const result = parseProcurement(source.text, {
    file: source.file,
    board,
    role: "primary",
    components: resolver,
  });

  for (const problem of problems) {
    console.error(`Component index: ${problem.file}:${problem.line}: ${problem.message}`);
  }

  if (json) {
    console.log(JSON.stringify(diagnosticsToPayload(result.diagnostics), null, 2));
  } else {
    for (const diagnostic of result.diagnostics) {
      const where = diagnostic.location
        ? `${diagnostic.location.file}:${diagnostic.location.line}:${diagnostic.location.col}: `
        : "";
      console.error(`${where}${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`);
    }
  }

  if (!result.ir) return 1;
  const check = validate("procurement", result.ir);
  if (!check.ok) {
    console.error("IR does not satisfy the procurement contract:");
    for (const diagnostic of schemaDiagnosticsToDiagnostics(check.errors)) {
      console.error(`  ${diagnostic.code}: ${diagnostic.message}`);
    }
    return 1;
  }

  const jsonText = canonicalJson(result.ir);
  if (outFile) {
    writeOut(outFile, `${jsonText}\n`);
    console.error(`Wrote ${outFile}`);
  } else if (!json) {
    console.log(jsonText);
  }
  return 0;
}

function runCompilePcb(options: {
  root: string;
  board: string;
  json: boolean;
  outFile: string | undefined;
}): number {
  const { root, board, json, outFile } = options;
  const path = join(root, LAYOUT.pcb, `${board}.teda`);
  if (!existsSync(path)) {
    console.error(`PCB description not found: ${LAYOUT.pcb}/${board}.teda`);
    return 2;
  }
  const file = `${LAYOUT.pcb}/${board}.teda`;
  const result = parsePcb(readFileSync(path, "utf8"), { file, board });
  for (const diagnostic of result.diagnostics) {
    const where = diagnostic.location
      ? `${diagnostic.location.file}:${diagnostic.location.line}:${diagnostic.location.col}: `
      : "";
    console.error(`${where}${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`);
  }
  if (json) {
    console.log(JSON.stringify(diagnosticsToPayload(result.diagnostics), null, 2));
  }
  if (!result.ir) return 1;
  const check = validate("pcb", result.ir);
  if (!check.ok) {
    for (const diagnostic of schemaDiagnosticsToDiagnostics(check.errors)) {
      console.error(`${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`);
    }
    return 1;
  }
  const text = `${canonicalJson(result.ir)}\n`;
  if (outFile === undefined) {
    if (!json) process.stdout.write(text);
  } else {
    writeOut(outFile, text);
    console.error(`Wrote ${outFile}`);
  }
  return result.diagnostics.some((d) => d.severity === "error") ? 1 : 0;
}
