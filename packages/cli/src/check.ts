// `texteda check`: validate a project's schematics.
//
// Validation has two layers (AGENTS.md §10 "error quality"):
//   1. Semantic layer: parsing and ERC from `packages/parser` (unconnected pins, net member conflicts, missing components, ...);
//   2. Contract layer: whether the produced IR satisfies `schemas/ir/v0.14/schematic.schema.json`.
//
// Output shape matches `compile`: human-readable mode prints to stderr, `--json` mode prints the diagnostic payload to stdout
// (ADR-0102: code / severity / location / data are the machine contract).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { schemaDiagnosticsToDiagnostics, validate } from "@texteda/ir";
import type { Schematic } from "@texteda/ir/schematic";
import { schematicGeometry } from "@texteda/renderer";
import type { SchematicView } from "@texteda/ir/schematic-view";
import type { Procurement } from "@texteda/ir/procurement";
import type { Diagnostic, DiagnosticLocation, DiagnosticsPayload } from "@texteda/ir/diagnostics";
import { diagnosticsToPayload } from "@texteda/ir/diagnostics";
import type { SourceMap } from "@texteda/ir/spans";
import { PROCUREMENT_ROLES, parsePcb, parseProcurement, parseSchematic, parseSystem, parseView } from "@texteda/parser";
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
import {
  checkBinding,
  checkCopperCoverage,
  fillBoard,
  fillBoardFacts,
  checkProcurement,
  checkRatings,
  checkReviews,
  checkSystem,
  checkReadability,
  checkViews,
  type RatingDevice,
  type ReadabilityGeometry,
  type ViewPage,
} from "@texteda/core";
import { buildProcurementFacts } from "./procurement.ts";

/** Which net each pin belongs to: what a pour needs to tell its own copper from a stranger's. */
function pinNets(schematic: Schematic): Map<string, string> {
  const out = new Map<string, string>();
  for (const net of schematic.nets) for (const member of net.members) out.set(member, net.id);
  return out;
}

/** A parsed procurement shard, with the locator its parse produced (ADR-0103 D1). */
type ProcurementPage = {
  ir: Procurement;
  file: string;
  locate?: (irPath: string) => DiagnosticLocation | undefined;
};
import { checkDeviceUsage } from "@texteda/core";
import { loadReviews } from "./reviews.ts";
import { footprintsByInstance, loadFootprintLibrary, padsByInstance, withPackageCodes } from "./pads.ts";
import { loadSymbolLibrary, schematicInstances, type DeviceFacts } from "./symbols.ts";
import { LAYOUT } from "./paths.ts";
import { idLocator, locateWith } from "./locate.ts";
import { checkProjectInstanceUids, type ProjectUidInput } from "./uids.ts";
import type { VerbResult } from "./result.ts";

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
 * The project's diagnostics as the machine payload — the value `texteda check --json` prints.
 *
 * The command line and a host's tool registry call the same function, so the two faces of the
 * verb cannot drift (ADR-0143 D2).
 */
export function buildCheck(root: string): VerbResult<{ payload: DiagnosticsPayload; boards: string[] }> {
  const result = checkProject(root);
  const payload = diagnosticsToPayload(result.diagnostics);
  // The project has errors when the command line would exit non-zero: that is the answer the
  // caller needs, whether it is a person or a host's tool registry.
  return { ok: payload.errorCount === 0, value: { payload, boards: result.boards } };
}

/**
 * Run one full pipeline: parsing (incl. ERC) -> contract validation, keeping each board's IR.
 *
 * Exporters want the IR and checkers want the diagnostics; both come from the same parse — otherwise the same pipeline would run twice and the two sides could see different things.
 */
export function analyzeProject(root: string): AnalyzeResult {
  const diagnostics: Diagnostic[] = [];
  const boards = listBoards(root);
  /** Per-board UID declarations, checked across the project after all boards are parsed. */
  const uidInputs: ProjectUidInput[] = [];
  const {
    resolver,
    problems,
    devices: loadedDevices,
    shards: componentShards,
    diagnostics: componentDiagnostics,
  } = loadComponents(root);
  // Everything the device loader had to say: a file that does not compile, an id that disagrees
  // with its name, a tree under `external/libs/` that nothing reads (ADR-0133).
  diagnostics.push(...componentDiagnostics);
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
  /** Ids a board places or a procurement file names: the library's used half (ADR-0105). */
  const referencedDevices = new Set<string>();
  /**
   * Whether every description that could name a device was read. If one was not, the reference
   * set is incomplete and an unused-looking device may simply live on a board we could not parse:
   * a warning that fires on a broken file is worse than no warning.
   */
  let referencesComplete = true;
  const modules = loadModules(root);
  /** Devices as the rating check needs them: pin facts (terminal count) + the part's own ratings. */
  const ratingDevices = (): Map<string, RatingDevice> => {
    const built = new Map<string, RatingDevice>();
    for (const [id, device] of devices) {
      built.set(id, {
        pins: (resolver.resolve(id)?.pins ?? []).map((pin) => pin.number),
        ratings: device.ratings,
        params: device.params,
        ...(device.construction === undefined ? {} : { construction: device.construction }),
        ...(device.package_code === undefined ? {} : { package_code: device.package_code }),
      });
    }
    return built;
  };
  const footprints = loadFootprintLibrary(root, diagnostics);
  /** Devices with the land pattern's package code attached: the package floor is keyed by it (ADR-0126). */
  const devices = withPackageCodes(loadedDevices, footprints);
  const symbols = loadSymbolLibrary(root, diagnostics);
  /** The device's symbol reference: the device IR is the owner of it (ADR-0130). */
  const symbolOf = (componentId: string): string | undefined =>
    componentShards.find((shard) => shard.id === componentId)?.ir.component.symbol;
  /** What the drawing prints for an instance: its value column, or a part's MPN. */
  const deviceOf = (componentId: string): DeviceFacts | undefined => {
    const component = componentShards.find((shard) => shard.id === componentId)?.ir.component;
    if (component === undefined) return undefined;
    return { params: component.params ?? [], ...(component.mpn === undefined ? {} : { mpn: component.mpn }) };
  };
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
    /**
     * `locateInstance` for the rules that name an instance rather than a JSON path; empty when the
     * parse carried no spans (ADR-0103 D1: line numbers live beside the IR, not in it).
     */
    /** A board net's row: the definition the drawing and the pcb are checked against (ADR-0103 D5). */
    const netLocator = (nets: readonly { id: string }[]): { locateNet?: (netId: string) => DiagnosticLocation | undefined } => {
      const locate = idLocator(result.sources, nets, "/nets");
      return locate === undefined ? {} : { locateNet: locate };
    };

    /** A pcb record's span, as a `locate` for the rules that name a pcb row. */
    const pcbLocator = (
      sources: SourceMap | undefined,
    ): { locate?: (irPath: string) => DiagnosticLocation | undefined } => {
      const locate = locateWith(sources);
      return locate === undefined ? {} : { locate };
    };

    const instanceLocator = (): { locateInstance?: (instanceId: string) => DiagnosticLocation | undefined } => {
      const locate = idLocator(result.sources, result.ir?.instances ?? [], "/instances");
      return locate === undefined ? {} : { locateInstance: locate };
    };

    // Print pages are descriptions of their own (ADR-0134): parse them here and cross-check them
    // against the board. Coverage needs all pages at once, so the pages are collected first.
    const pages: ViewPage[] = [];
    for (const source of loaded.views) {
      const parsed = parseView(source.text, { file: source.file, board });
      boardDiagnostics.push(...parsed.diagnostics);
      if (parsed.ir) {
        const contract = validate("schematic-view", parsed.ir);
        if (!contract.ok)
          boardDiagnostics.push(...schemaDiagnosticsToDiagnostics(contract.errors, locateWith(parsed.sources)));
        const locate = locateWith(parsed.sources);
        pages.push({ file: source.file, view: parsed.ir, ...(locate === undefined ? {} : { locate }) });
      }
    }
    if (!result.ir) referencesComplete = false;
    uidInputs.push({
      board,
      file: loaded.file,
      ...(result.sourceUids === undefined ? {} : { sourceUids: result.sourceUids }),
      ...(result.ir === undefined ? {} : { ir: result.ir }),
      ...(result.sources === undefined ? {} : { sources: result.sources }),
    });
    if (result.ir) {
      for (const instance of result.ir.instances) referencedDevices.add(instance.component);
      const check = validate("schematic", result.ir);
      if (!check.ok)
        boardDiagnostics.push(...schemaDiagnosticsToDiagnostics(check.errors, locateWith(result.sources)));
      // The design against the parts it is built from (ADR-0125): the device limits and the
      // declared windows come together only here, so the check runs where both are in hand.
      boardDiagnostics.push(
        ...checkRatings({
          file: loaded.file,
          schematic: result.ir,
          devices: ratingDevices(),
          ...instanceLocator(),
        }),
        ...checkViews({
          file: loaded.file,
          schematic: result.ir,
          pages,
          ...netLocator(result.ir.nets),
        }),
      );
      // The drawing itself: text on top of text, a label away from its net, a wire through a body
      // (spec/schematic-view.md §9.2). Geometry comes from the renderer, so the check sees exactly
      // what a reader sees; the facts are handed over in `core`'s own shape, which the assignment
      // below type-checks.
      const instances = schematicInstances(
        result.ir,
        (componentId) => resolver.resolve(componentId)?.pins ?? [],
        symbolOf,
        symbols,
        deviceOf,
      );
      for (const page of pages) {
        const geometry: ReadabilityGeometry = schematicGeometry(page.view, instances);
        boardDiagnostics.push(
          ...checkReadability({
            file: page.file,
            view: page.view,
            schematic: result.ir,
            geometry,
            ...(page.locate === undefined ? {} : { locate: page.locate }),
          }),
        );
      }
      // Board-level consistency: run binding validation when a pcb description exists (spec/pcb.md §5.2).
      const pcbSource = loadPcb(root, board);
      if (pcbSource !== null) {
        const pcbResult = parsePcb(pcbSource.text, { file: pcbSource.file, board });
        boardDiagnostics.push(...pcbResult.diagnostics);
        if (pcbResult.ir) {
          const pcbCheck = validate("pcb", pcbResult.ir);
          if (!pcbCheck.ok)
            boardDiagnostics.push(...schemaDiagnosticsToDiagnostics(pcbCheck.errors, locateWith(pcbResult.sources)));
          boardDiagnostics.push(
            ...checkBinding({
              file: pcbSource.file,
              schematic: result.ir,
              pcb: pcbResult.ir,
              ...netLocator(result.ir.nets),
              ...pcbLocator(pcbResult.sources),
            }),
          );
          // Whether the drawing implements the declaration (ADR-0119): it needs pad geometry,
          // which comes from the project's footprint library, so it is loaded once per project.
          boardDiagnostics.push(
            ...checkCopperCoverage({
              file: pcbSource.file,
              schematic: result.ir,
              pcb: pcbResult.ir,
              pads: padsByInstance(result.ir, devices, footprints),
            }),
          );
          // Whether each pour can exist at all (ADR-0117 D3): the fill is derived, so the check runs
          // it here rather than reading a stored result. Its findings are about the description — a
          // non-copper layer, a ruled-out width, a pour that pours nothing — so they belong in
          // `check`, before anyone tries to export.
          boardDiagnostics.push(
            ...fillBoard(
              fillBoardFacts({
                file: pcbSource.file,
                pcb: pcbResult.ir,
                placed: footprintsByInstance(result.ir, devices, footprints),
                pin_net: pinNets(result.ir),
                ...pcbLocator(pcbResult.sources),
              }),
            ).diagnostics,
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
    const procurementShards: ProcurementPage[] = [];
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
      if (!parsed.ir) referencesComplete = false;
      if (parsed.ir) {
        const check = validate("procurement", parsed.ir);
        if (!check.ok)
          boardDiagnostics.push(...schemaDiagnosticsToDiagnostics(check.errors, locateWith(parsed.sources)));
        const locate = locateWith(parsed.sources);
        procurementShards.push({ ir: parsed.ir, file: procurement.file, ...(locate === undefined ? {} : { locate }) });
        for (const selection of parsed.ir.procurement.selections) {
          referencedDevices.add(selection.generic);
          if (selection.part) referencedDevices.add(selection.part);
        }
      }
    }
    if (result.ir && procurementShards.length > 0) {
      boardDiagnostics.push(
        ...checkProcurement(
          buildProcurementFacts({
            schematic: result.ir,
            procurements: procurementShards,
            devices: devices,
            ...instanceLocator(),
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

  // The library layer: a device file nothing places and nothing selects (ADR-0105 -- the shard
  // set is the project's content, so an abandoned candidate still changes the project hash).
  if (referencesComplete) {
    diagnostics.push(
      ...checkDeviceUsage({
        // Every device is the project's own file now (ADR-0133: an imported library is a copy), so
        // the rule applies to all of them.
        devices: componentShards.map((shard) => ({ id: shard.id, file: shard.file })),
        referenced: referencedDevices,
      }),
    );
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
    if (!contract.ok) diagnostics.push(...schemaDiagnosticsToDiagnostics(contract.errors, locateWith(parsed.sources)));
    diagnostics.push(
      ...checkSystem({
        system: { ...parsed.ir, source: { file: source.file } },
        declaredBoards,
        boards: boardIrs,
      }),
    );
  }

  // The review layer (ADR-0136): a fact about a human process, not about the design, so it
  // changes no shard and no hash -- but a note nobody answered must not be invisible either.
  const reviews = loadReviews(root);
  diagnostics.push(...reviews.diagnostics);
  diagnostics.push(
    ...checkReviews({
      ...(project.owner !== undefined ? { projectOwner: project.owner } : {}),
      rounds: reviews.rounds,
    }),
  );

  diagnostics.push(...checkProjectInstanceUids(uidInputs));

  return { boards, analyses, diagnostics };
}
