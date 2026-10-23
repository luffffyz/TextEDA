// `texteda check`: validate a project's schematics.
//
// Validation has two layers (AGENTS.md §10 "error quality"):
//   1. Semantic layer: parsing and ERC from `packages/parser` (unconnected pins, net member conflicts, missing components, ...);
//   2. Contract layer: whether the produced IR satisfies `schemas/ir/v0.5/schematic.schema.json`.
//
// Output shape matches `compile`: human-readable mode prints to stderr, `--json` mode prints the diagnostic payload to stdout
// (ADR-0016: code / severity / location / data are the machine contract).
import { schemaDiagnosticsToDiagnostics, validate } from "@texteda/ir";
import type { Schematic } from "@texteda/ir/schematic";
import type { Diagnostic } from "@texteda/ir/diagnostics";
import { PROCUREMENT_ROLES, parsePcb, parseProcurement, parseSchematic } from "@texteda/parser";
import {
  listBoards,
  listProcurement,
  loadBoard,
  loadComponents,
  loadModules,
  loadPcb,
  loadProcurement,
} from "./project.ts";
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

  // A procurement file belongs to a board: one whose design exists (spec/procurement.md §1).
  const knownBoards = new Set(boards);
  for (const file of listProcurement(root)) {
    if (knownBoards.has(file.board)) continue;
    diagnostics.push({
      code: "ref.unknown-board",
      severity: "error",
      message: `board ${file.board} not found: ${file.file} selects parts for a board this project does not have`,
      hint: `a procurement file belongs to a board: use the board id of a design/sch/${file.board}.teda file`,
      location: { file: file.file, line: 2, col: 1 },
    });
  }

  const analyses: BoardAnalysis[] = [];
  const modules = loadModules(root);
  for (const board of boards) {
    const loaded = loadBoard(root, board);
    if (!loaded) continue;
    const result = parseSchematic(loaded.text, {
      file: loaded.file,
      board,
      components: resolver,
      modules,
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
    // The procurement layer: the parse and the contract check. Whether the selected part
    // satisfies the line is a separate check (the selection check), not the parser's job.
    for (const role of PROCUREMENT_ROLES) {
      const procurement = loadProcurement(root, board, role);
      if (!procurement) continue;
      const parsed = parseProcurement(procurement.text, {
        file: procurement.file,
        board,
        role,
        components: resolver,
      });
      boardDiagnostics.push(...parsed.diagnostics);
      if (parsed.ir) {
        const check = validate("procurement", parsed.ir);
        if (!check.ok) boardDiagnostics.push(...schemaDiagnosticsToDiagnostics(check.errors));
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
