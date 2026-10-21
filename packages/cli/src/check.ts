// `texteda check`: validate a project's schematics.
//
// Validation has two layers (AGENTS.md §10 "error quality"):
//   1. Semantic layer: parsing and ERC from `packages/parser` (unconnected pins, net member conflicts, missing components, ...);
//   2. Contract layer: whether the produced IR satisfies `schemas/ir/v0.2/schematic.schema.json`.
//
// Output shape matches `compile`: human-readable mode prints to stderr, `--json` mode prints the diagnostic payload to stdout
// (ADR-0016: code / severity / location / data are the machine contract).
import { schemaDiagnosticsToDiagnostics, validate } from "@texteda/ir";
import type { Schematic } from "@texteda/ir/schematic";
import type { Diagnostic } from "@texteda/ir/diagnostics";
import { parsePcb, parseSchematic } from "@texteda/parser";
import { listBoards, loadBoard, loadComponents, loadPcb } from "./project.ts";
import { checkBinding } from "@texteda/core";

export interface BoardAnalysis {
  board: string;
  /** The parsed IR; absent when parsing fails. */
  ir?: Schematic;
  /** Diagnostics for this board (parse + ERC + contract). */
  diagnostics: Diagnostic[];
}

export interface AnalyzeResult {
  /** Board ids in the project, in file order. */
  boards: string[];
  /** Per-board analysis results, in the same order as `boards`. */
  analyses: BoardAnalysis[];
  /** All diagnostics, ordered by board. */
  diagnostics: Diagnostic[];
}

export interface CheckResult {
  /** Boards validated. */
  boards: string[];
  /** All diagnostics, ordered by board. */
  diagnostics: Diagnostic[];
}

/** Validate all boards in the project. */
export function checkProject(root: string): CheckResult {
  const { boards, diagnostics } = analyzeProject(root);
  return { boards, diagnostics };
}

/**
 * Run one full pipeline: parsing (incl. ERC) -> contract validation, keeping each board's IR.
 *
 * Exporters want the IR and checkers want the diagnostics; both come from the same parse — otherwise the same pipeline would run twice and the two sides could see different things.
 */
export function analyzeProject(root: string): AnalyzeResult {
  const diagnostics: Diagnostic[] = [];
  const boards = listBoards(root);
  const { resolver, problems } = loadComponents(root);
  for (const problem of problems) {
    const diagnostic: Diagnostic = {
      severity: "error",
      code: problem.code,
      message: problem.message,
      location: { file: problem.file, line: problem.line, col: 1 },
    };
    if (problem.data) diagnostic.data = problem.data;
    diagnostics.push(diagnostic);
  }

  const analyses: BoardAnalysis[] = [];
  for (const board of boards) {
    const loaded = loadBoard(root, board);
    if (!loaded) continue;
    const result = parseSchematic(loaded.text, {
      file: loaded.file,
      board,
      components: resolver,
    });
    const boardDiagnostics = [...result.diagnostics];
    if (result.ir) {
      const check = validate("schematic", result.ir);
      if (!check.ok) boardDiagnostics.push(...schemaDiagnosticsToDiagnostics(check.errors));
      // Board-level consistency: run binding validation when a pcb description exists (spec/pcb.md §5.2).
      const pcbSource = loadPcb(root, board);
      if (pcbSource !== null) {
        const pcbResult = parsePcb(pcbSource.text, { file: pcbSource.file, board });
        boardDiagnostics.push(...pcbResult.diagnostics);
        if (pcbResult.ir) {
          const pcbCheck = validate("pcb", pcbResult.ir);
          if (!pcbCheck.ok) boardDiagnostics.push(...schemaDiagnosticsToDiagnostics(pcbCheck.errors));
          boardDiagnostics.push(
            ...checkBinding({ file: pcbSource.file, schematic: result.ir, pcb: pcbResult.ir }),
          );
        }
      }
    }
    diagnostics.push(...boardDiagnostics);
    analyses.push({
      board,
      ...(result.ir === undefined ? {} : { ir: result.ir }),
      diagnostics: boardDiagnostics,
    });
  }
  return { boards, analyses, diagnostics };
}
