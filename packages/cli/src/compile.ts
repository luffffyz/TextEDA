// `texteda compile`: compile one project description into an IR shard (canonical JSON).
//
// The project's logic has one root (ADR-0069 D1): `design/sch/main.teda` composes the module
// definitions of `design/sch/modules/`, and each physical implementation is its own `pcb` description
// at `design/pcb/<pcb_id>.teda` (ADR-0069 D2). Procurement stays board-scoped (spec/procurement.md):
// a file selects the parts of one PCB.
//
// Usage:
//   texteda compile <project dir> <board_id> [--json] [--out <file>] [--pcb] [--procurement]
// The default compiles the one logical root; the id selects a physical PCB for `--pcb` or procurement.
import { schemaDiagnosticsToDiagnostics, validate } from "@texteda/ir";
import { diagnosticsToPayload } from "@texteda/ir/diagnostics";
import { canonicalJson, parsePcb, parseProcurement, parseSchematic } from "@texteda/parser";
import { LAYOUT, MAIN_SCHEMATIC_ID } from "./paths.ts";
import { loadComponents, loadModules, loadPcb, loadProcurement, loadSchematic } from "./project.ts";
import { writeOut } from "./output.ts";

export interface CompileOptions {
  /** Project root directory. */
  root: string;
  /** Existing positional id; selects a physical PCB for `--pcb` and `--procurement`. */
  board: string;
  /** Emit only the diagnostic payload. */
  json: boolean;
  /** IR output file; defaults to stdout (in `--json` mode the IR only goes through `--out`). */
  outFile?: string | undefined;
  /** Compile the physical PCB `design/pcb/<board>.teda` instead of the logical root. */
  pcb?: boolean | undefined;
  /** Compile the PCB's primary procurement file instead of the logical root. */
  procurement?: boolean | undefined;
}

/**
 * Compile one description of the project. Returns the process exit code: 0 success, 1 errors present, 2 usage or missing file.
 */
export function runCompile(options: CompileOptions): number {
  const { root, board, json, outFile } = options;
  if (options.pcb === true) return runCompilePcb({ root, board, json, outFile });
  if (options.procurement === true) return runCompileProcurement({ root, board, json, outFile });
  return runCompileSchematic({ root, json, outFile });
}

/** Compile the logical root (`design/sch/main.teda`, `schemas/ir/v0.19/schematic.schema.json`). */
function runCompileSchematic(options: {
  root: string;
  json: boolean;
  outFile: string | undefined;
}): number {
  const { root, json, outFile } = options;
  const source = loadSchematic(root);
  if (!source) {
    console.error(`Logical root not found: ${LAYOUT.sch}/${MAIN_SCHEMATIC_ID}.teda`);
    return 2;
  }
  const { resolver, problems } = loadComponents(root);
  const result = parseSchematic(source.text, {
    file: source.file,
    components: resolver,
    modules: loadModules(root),
  });

  for (const problem of problems) {
    console.error(`Component index: ${problem.file}:${problem.line}: ${problem.message}`);
  }

  if (json) {
    // Payload shape per ADR-0003: code / severity / location / data are the machine contract.
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

/**
 * Compile the PCB's primary procurement file (`assets/procurement/primary/<board>.teda`).
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

/** Compile one physical PCB (`design/pcb/<board>.teda`, `schemas/ir/v0.19/pcb.schema.json`). */
function runCompilePcb(options: {
  root: string;
  board: string;
  json: boolean;
  outFile: string | undefined;
}): number {
  const { root, board, json, outFile } = options;
  const source = loadPcb(root, board);
  if (!source) {
    console.error(`PCB description not found: ${LAYOUT.pcb}/${board}.teda`);
    return 2;
  }
  const result = parsePcb(source.text, { file: source.file, pcb: board });
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
