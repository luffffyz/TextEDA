// `texteda check`: validate a project's schematics.
//
// Validation has two layers (AGENTS.md §10 "error quality"):
//   1. Semantic layer: parsing and ERC from `packages/parser` (unconnected pins, net member conflicts, missing components, ...);
//   2. Contract layer: whether the produced IR satisfies `schemas/ir/v0.5/schematic.schema.json`.
//
// Output shape matches `compile`: human-readable mode prints to stderr, `--json` mode prints the diagnostic payload to stdout
// (ADR-0016: code / severity / location / data are the machine contract).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { schemaDiagnosticsToDiagnostics, validate } from "@texteda/ir";
import type { Schematic } from "@texteda/ir/schematic";
import type { Procurement } from "@texteda/ir/procurement";
import type { Diagnostic } from "@texteda/ir/diagnostics";
import { PROCUREMENT_ROLES, parsePcb, parseProcurement, parseSchematic, parseSystem } from "@texteda/parser";
import {
  listBoards,
  listPcbBoards,
  listProcurement,
  listSystems,
  loadBoard,
  loadComponents,
  loadModules,
  loadPcb,
  loadProcurement,
  loadProject,
} from "./project.ts";
import { checkBinding, checkCopperCoverage, checkProcurement, checkReviews, checkSystem } from "@texteda/core";
import { buildProcurementFacts } from "./procurement.ts";
import { loadReviews } from "./reviews.ts";
import { loadFootprintLibrary, padsByInstance } from "./pads.ts";
import { LAYOUT } from "./paths.ts";

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
  const { resolver, problems, devices } = loadComponents(root);
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

  // The project file: the metadata, the board list, the variants. It carries no circuit, so
  // there is nothing to check in it beyond its own shape.
  const project = loadProject(root);
  diagnostics.push(...project.diagnostics);

  const analyses: BoardAnalysis[] = [];
  const modules = loadModules(root);
  const footprints = loadFootprintLibrary(root);
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
          // Whether the drawing implements the declaration (ADR-0041): it needs pad geometry,
          // which comes from the project's footprint library, so it is loaded once per project.
          boardDiagnostics.push(
            ...checkCopperCoverage({
              file: pcbSource.file,
              schematic: result.ir,
              pcb: pcbResult.ir,
              pads: padsByInstance(result.ir, devices, footprints),
            }),
          );
        }
      } else {
        // A skipped check is not a passed check (AGENTS.md §4.4 rule 6): say so, at `note` severity.
        boardDiagnostics.push({
          code: "bind.not-checked",
          severity: "note",
          message: `board ${board} has no pcb description: the sch/pcb binding was not checked`,
          location: { file: loaded.file, line: 1, col: 1 },
          data: { board, present: "sch", missing: "pcb" },
        });
      }
    }
    // The procurement layer: the parse, the contract check and the selection check (whether the
    // selected part satisfies the line is a cross-file question, so it lives in packages/core).
    const procurementShards: { ir: Procurement; file: string }[] = [];
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
        procurementShards.push({ ir: parsed.ir, file: procurement.file });
      }
    }
    if (result.ir && procurementShards.length > 0) {
      boardDiagnostics.push(
        ...checkProcurement(
          buildProcurementFacts({
            schematic: result.ir,
            procurements: procurementShards,
            devices: devices,
          }),
        ),
      );
    }

    diagnostics.push(...boardDiagnostics);
    analyses.push({
      board,
      ...(result.ir === undefined ? {} : { ir: result.ir }),
      diagnostics: boardDiagnostics,
    });
  }

  // A pcb whose board has no schematic is not checked either — and would otherwise not even be
  // read, since boards are found from `design/sch/`. Say it rather than drop the file silently.
  for (const board of listPcbBoards(root)) {
    if (boards.includes(board)) continue;
    diagnostics.push({
      code: "bind.not-checked",
      severity: "note",
      message: `board ${board} has a pcb description but no schematic: the sch/pcb binding was not checked`,
      location: { file: `${LAYOUT.pcb}/${board}.teda`, line: 1, col: 1 },
      data: { board, present: "pcb", missing: "sch" },
    });
  }

  // The system layer: how the boards are wired to each other. The systems are checked against
  // the boards, so they come after them.
  const boardIrs = new Map<string, Schematic>();
  for (const analysis of analyses) {
    if (analysis.ir) boardIrs.set(analysis.board, analysis.ir);
  }
  const declaredBoards = project.ir?.boards?.map((board) => board.id) ?? boards;
  for (const source of listSystems(root)) {
    const parsed = parseSystem(readFileSync(join(root, source.file), "utf8"), { file: source.file });
    diagnostics.push(...parsed.diagnostics);
    if (!parsed.ir) continue;
    const contract = validate("system", parsed.ir);
    if (!contract.ok) diagnostics.push(...schemaDiagnosticsToDiagnostics(contract.errors));
    diagnostics.push(
      ...checkSystem({
        system: { ...parsed.ir, source: { file: source.file } },
        declaredBoards,
        boards: boardIrs,
      }),
    );
  }

  // The review layer (ADR-0033): a fact about a human process, not about the design, so it
  // changes no shard and no hash -- but a note nobody answered must not be invisible either.
  const reviews = loadReviews(root);
  diagnostics.push(...reviews.diagnostics);
  diagnostics.push(
    ...checkReviews({
      ...(project.owner !== undefined ? { projectOwner: project.owner } : {}),
      rounds: reviews.rounds,
    }),
  );

  return { boards, analyses, diagnostics };
}
