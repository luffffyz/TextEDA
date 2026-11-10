// `texteda check`: validate the logical root and physical PCBs.
//
// Validation has two layers (AGENTS.md §10 "error quality"):
//   1. Semantic layer: parsing and ERC from `packages/parser` (unconnected pins, net member conflicts, missing components, ...);
//   2. Contract layer: whether the produced IR satisfies `schemas/ir/v0.19/schematic.schema.json`.
//
// Output shape matches `compile`: human-readable mode prints to stderr, `--json` mode prints the diagnostic payload to stdout
// (ADR-0003: code / severity / location / data are the machine contract).
import { schemaDiagnosticsToDiagnostics, validate } from "@texteda/ir";
import type { Pcb } from "@texteda/ir/pcb";
import type { Schematic } from "@texteda/ir/schematic";
import type { Procurement } from "@texteda/ir/procurement";
import type { Diagnostic, DiagnosticLocation, DiagnosticsPayload } from "@texteda/ir/diagnostics";
import { diagnosticsToPayload } from "@texteda/ir/diagnostics";
import type { SourceMap } from "@texteda/ir/spans";
import { composedGeometry, schematicGeometry } from "@texteda/renderer";
import {
  parseModuleView,
  parsePcb,
  parseProcurement,
  parseSchematic,
  parseSchematicDocument,
  parseSheetTemplate,
  parseView,
  PROCUREMENT_ROLES,
} from "@texteda/parser";
import {
  listPcbs,
  listProcurement,
  loadComponents,
  loadModuleViews,
  loadModules,
  loadPcb,
  loadProcurement,
  loadProject,
  loadSchematic,
  loadSheetTemplates,
  loadViews,
} from "./project.ts";
import { loadPageComposition } from "./page-composition.ts";
import {
  checkBinding,
  checkCopperCoverage,
  checkDeviceUsage,
  fillBoard,
  fillBoardFacts,
  checkProcurement,
  checkRatings,
  checkReviews,
  checkReadability,
  checkViews,
  type RatingDevice,
  type ReadabilityGeometry,
  type ViewPage,
} from "@texteda/core";
import { buildProcurementFacts } from "./procurement.ts";
import { loadReviews } from "./reviews.ts";
import { footprintsByInstance, loadFootprintLibrary, padsByInstance, withPackageCodes } from "./pads.ts";
import { loadSymbolLibrary, schematicInstances, type DeviceFacts } from "./symbols.ts";
import { idLocator, locateWith } from "./locate.ts";
import { checkProjectInstanceUids, type ProjectUidInput } from "./uids.ts";
import type { VerbResult } from "./result.ts";

/** Which net each pin belongs to: what a pour needs to tell its own copper from a stranger's. */
function pinNets(schematic: Schematic): Map<string, string> {
  const out = new Map<string, string>();
  for (const net of schematic.nets) for (const member of net.members) out.set(member, net.id);
  return out;
}

/** A parsed procurement shard, with the locator its parse produced (ADR-0004 D1). */
type ProcurementPage = {
  ir: Procurement;
  file: string;
  locate?: (irPath: string) => DiagnosticLocation | undefined;
};
export interface MainAnalysis {
  /** The sole logical root schematic. */
  main: "main";
  /** The parsed IR; absent when parsing fails or the root file is missing. */
  ir?: Schematic;
  diagnostics: Diagnostic[];
}

export interface PcbAnalysis {
  /** Physical PCB id, taken from `design/pcb/<pcb>.teda`. */
  pcb: string;
  /** The parsed IR; absent when parsing fails. */
  ir?: Pcb;
  diagnostics: Diagnostic[];
}

export interface AnalyzeResult {
  main: MainAnalysis;
  /** Physical PCB analyses, in file order. */
  pcbs: PcbAnalysis[];
  diagnostics: Diagnostic[];
}

export interface CheckResult {
  /** The project's sole logical root. */
  main: "main";
  /** Physical PCB ids validated. */
  pcbs: string[];
  diagnostics: Diagnostic[];
}

/** Validate the project's logical root and all physical PCBs. */
export function checkProject(root: string): CheckResult {
  const { pcbs, diagnostics } = analyzeProject(root);
  return { main: "main", pcbs: pcbs.map(({ pcb }) => pcb), diagnostics };
}

/**
 * The project's diagnostics as the machine payload — the value `texteda check --json` prints.
 *
 * The command line and a host's tool registry call the same function, so the two faces of the
 * verb cannot drift (ADR-0044 D2).
 */
export function buildCheck(root: string): VerbResult<{ payload: DiagnosticsPayload; main: "main"; pcbs: string[] }> {
  const result = checkProject(root);
  const payload = diagnosticsToPayload(result.diagnostics);
  // The project has errors when the command line would exit non-zero: that is the answer the
  // caller needs, whether it is a person or a host's tool registry.
  return { ok: payload.errorCount === 0, value: { payload, main: result.main, pcbs: result.pcbs } };
}



/**
 * Run one full pipeline: parse the single logical root and every physical PCB, then validate their
 * bindings and preserve both layers' IR for exporters and advisory checkers.
 *
 * Exporters want the IR and checkers want the diagnostics; both come from the same parse — otherwise the same pipeline would run twice and the two sides could see different things.
 */
export function analyzeProject(root: string): AnalyzeResult {
  const projectDiagnostics: Diagnostic[] = [];
  const pcbIds = listPcbs(root);
  const knownPcbs = new Set(pcbIds);
  const uidInputs: ProjectUidInput[] = [];
  const {
    resolver,
    problems,
    devices: loadedDevices,
    shards: componentShards,
    diagnostics: componentDiagnostics,
  } = loadComponents(root);
  projectDiagnostics.push(...componentDiagnostics);
  for (const problem of problems) {
    const diagnostic: Diagnostic = {
      severity: "error",
      code: problem.code,
      message: problem.message,
      location: { file: problem.file, line: problem.line, col: 1 },
    };
    if (problem.data) diagnostic.data = problem.data;
    projectDiagnostics.push(diagnostic);
  }

  // Procurement selections belong to physical PCBs; preserve the source id from each shard.
  for (const file of listProcurement(root)) {
    if (knownPcbs.has(file.board)) continue;
    projectDiagnostics.push({
      code: "ref.unknown-board",
      severity: "error",
      message: `PCB ${file.board} not found: ${file.file} selects parts for a PCB this project does not have`,
      hint: `a procurement file belongs to a PCB: use the id of a design/pcb/${file.board}.teda file`,
      location: { file: file.file, line: 2, col: 1 },
    });
  }

  const project = loadProject(root);
  projectDiagnostics.push(...project.diagnostics);

  const moduleDrawings: Array<{
    module_id: string;
    bounds: { width_nm: number; height_nm: number };
    place: { instance_id: string }[];
    port: { id: string; x_nm: number; y_nm: number }[];
    nets: { id: string }[];
    ports: { id: string }[];
    points?: { x_nm: number; y_nm: number }[];
    wire?: { net: string; from_pin: string; to_pin: string; points?: { x_nm: number; y_nm: number }[] }[];
    label?: { net: string; x_nm: number; y_nm: number }[];
    file: string;
    locate?: (irPath: string) => DiagnosticLocation | undefined;
  }> = [];
  for (const source of loadModuleViews(root)) {
    const parsed = parseModuleView(source.text, { file: source.file });
    projectDiagnostics.push(...parsed.diagnostics);
    if (!parsed.ir) continue;
    const contract = validate("module-view", parsed.ir);
    if (!contract.ok)
      projectDiagnostics.push(...schemaDiagnosticsToDiagnostics(contract.errors, locateWith(parsed.sources)));
    const locate = locateWith(parsed.sources);
    moduleDrawings.push({
      module_id: parsed.ir.module_id,
      bounds: parsed.ir.bounds,
      place: parsed.ir.place,
      nets: [],
      ports: [],
      port: parsed.ir.port ?? [],
      ...(parsed.ir.junction === undefined ? {} : { points: parsed.ir.junction }),
      ...(parsed.ir.wire === undefined ? {} : { wire: parsed.ir.wire }),
      ...(parsed.ir.label === undefined ? {} : { label: parsed.ir.label }),
      file: source.file,
      ...(locate === undefined ? {} : { locate }),
    });
  }
  const templates: Array<{
    template_id: string;
    size: { width_nm: number; height_nm: number };
    line?: { start: { x_nm: number; y_nm: number }; end: { x_nm: number; y_nm: number } }[];
    rect?: { start: { x_nm: number; y_nm: number }; end: { x_nm: number; y_nm: number } }[];
    polyline?: { points: { x_nm: number; y_nm: number }[] }[];
    text?: { x_nm: number; y_nm: number }[];
    file: string;
    locate?: (irPath: string) => DiagnosticLocation | undefined;
  }> = [];
  for (const source of loadSheetTemplates(root)) {
    const parsed = parseSheetTemplate(source.text, { file: source.file });
    projectDiagnostics.push(...parsed.diagnostics);
    if (!parsed.ir) continue;
    const contract = validate("sheet-template", parsed.ir);
    if (!contract.ok)
      projectDiagnostics.push(...schemaDiagnosticsToDiagnostics(contract.errors, locateWith(parsed.sources)));
    const locate = locateWith(parsed.sources);
    templates.push({
      template_id: source.templateId,
      size: parsed.ir.size,
      file: source.file,
      ...(parsed.ir.line === undefined ? {} : { line: parsed.ir.line }),
      ...(parsed.ir.rect === undefined ? {} : { rect: parsed.ir.rect }),
      ...(parsed.ir.polyline === undefined ? {} : { polyline: parsed.ir.polyline }),
      ...(parsed.ir.text === undefined ? {} : { text: parsed.ir.text }),
      ...(locate === undefined ? {} : { locate }),
    });
  }

  const modules = loadModules(root);
  let brokenModuleParse = false;
  const moduleDefinitions = modules.flatMap((source) => {
    const parsed = parseSchematicDocument(source.text, { file: source.file, kind: "module" });
    if (!parsed.ok) brokenModuleParse = true;
    if (!parsed.doc) return [];
    return [{
      module_id: source.moduleId,
      instance_ids: parsed.doc.instances.map((instance) => instance.refdes),
      net_ids: parsed.doc.nets.map((net) => net.name),
      ports: parsed.doc.ports.map((port) => ({ id: port.id })),
    }];
  });

  for (const drawing of moduleDrawings) {
    const definition = moduleDefinitions.find((candidate) => candidate.module_id === drawing.module_id);
    if (definition === undefined) continue;
    drawing.nets = definition.net_ids.map((id) => ({ id }));
    drawing.ports = definition.ports.map((port) => ({ id: port.id }));
  }
  const moduleDrawingById = new Map(moduleDrawings.map((drawing) => [drawing.module_id, drawing]));
  const templateById = new Map(templates.map((template) => [template.template_id, template]));

  const footprints = loadFootprintLibrary(root, projectDiagnostics);
  const devices = withPackageCodes(loadedDevices, footprints);
  const symbols = loadSymbolLibrary(root, projectDiagnostics);
  const symbolOf = (componentId: string): string | undefined =>
    componentShards.find((shard) => shard.id === componentId)?.ir.component.symbol;
  const deviceOf = (componentId: string): DeviceFacts | undefined => {
    const component = componentShards.find((shard) => shard.id === componentId)?.ir.component;
    if (component === undefined) return undefined;
    return { params: component.params ?? [], ...(component.mpn === undefined ? {} : { mpn: component.mpn }) };
  };
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

  const mainSource = loadSchematic(root);
  const mainDocument = mainSource === null
    ? undefined
    : parseSchematicDocument(mainSource.text, { file: mainSource.file });
  const mainResult = mainSource === null
    ? undefined
    : parseSchematic(mainSource.text, {
        file: mainSource.file,
        components: resolver,
        modules,
      });
  const mainDiagnostics: Diagnostic[] = [...(mainResult?.diagnostics ?? [])];
  const mainIr = mainResult?.ir;
  const referencedDevices = new Set<string>();
  let referencesComplete = mainIr !== undefined && !brokenModuleParse;
  if (mainSource !== null && mainResult !== undefined) {
    uidInputs.push({
      board: "main",
      file: mainSource.file,
      ...(mainResult.sourceUids === undefined ? {} : { sourceUids: mainResult.sourceUids }),
      ...(mainIr === undefined ? {} : { ir: mainIr }),
      ...(mainResult.sources === undefined ? {} : { sources: mainResult.sources }),
    });
  }
  if (mainIr !== undefined) {
    for (const instance of mainIr.instances) referencedDevices.add(instance.component);
    const contract = validate("schematic", mainIr);
    if (!contract.ok)
      mainDiagnostics.push(...schemaDiagnosticsToDiagnostics(contract.errors, locateWith(mainResult?.sources)));
  }

  const pages: ViewPage[] = [];
  for (const source of loadViews(root)) {
    const parsed = parseView(source.text, { file: source.file });
    mainDiagnostics.push(...parsed.diagnostics);
    if (!parsed.ir) continue;
    const contract = validate("schematic-view", parsed.ir);
    if (!contract.ok)
      mainDiagnostics.push(...schemaDiagnosticsToDiagnostics(contract.errors, locateWith(parsed.sources)));
    const locate = locateWith(parsed.sources);
    pages.push({ file: source.file, view: parsed.ir, ...(locate === undefined ? {} : { locate }) });
  }

  const pcbAnalyses: PcbAnalysis[] = [];
  const parsedPcbs: Array<{ pcb: string; file: string; ir: Pcb; sources?: SourceMap }> = [];
  for (const pcbId of pcbIds) {
    const source = loadPcb(root, pcbId);
    if (source === null) continue;
    const parsed = parsePcb(source.text, { file: source.file, pcb: pcbId });
    const pcbDiagnostics = [...parsed.diagnostics];
    const analysis: PcbAnalysis = {
      pcb: pcbId,
      ...(parsed.ir === undefined ? {} : { ir: parsed.ir }),
      diagnostics: pcbDiagnostics,
    };
    pcbAnalyses.push(analysis);
    if (parsed.ir === undefined) {
      referencesComplete = false;
      continue;
    }
    const contract = validate("pcb", parsed.ir);
    if (!contract.ok)
      pcbDiagnostics.push(...schemaDiagnosticsToDiagnostics(contract.errors, locateWith(parsed.sources)));
    parsedPcbs.push({
      pcb: pcbId,
      file: source.file,
      ir: parsed.ir,
      ...(parsed.sources === undefined ? {} : { sources: parsed.sources }),
    });
  }

  const mainLocate = locateWith(mainResult?.sources);
  const netLocator = mainIr === undefined
    ? undefined
    : idLocator(mainResult?.sources, mainIr.nets, "/nets");
  const instanceLocator = mainIr === undefined
    ? undefined
    : idLocator(mainResult?.sources, mainIr.instances, "/instances");
  if (mainSource !== null && mainIr !== undefined) {
    const modulesByInstance = new Map((mainResult?.modules ?? []).map((module) => [module.instance_id, module]));
    const endpointNet = (ref: string): string | undefined => {
      const dot = ref.indexOf(".");
      if (dot === -1) return undefined;
      const module = modulesByInstance.get(ref.slice(0, dot));
      return module?.ports.find((port) => port.id === ref.slice(dot + 1))?.net;
    };
    for (const interconnect of mainDocument?.doc?.interconnects ?? []) {
      const netA = endpointNet(interconnect.from);
      const netB = endpointNet(interconnect.to);
      if (netA === undefined || netB === undefined || netA === netB) continue;
      const related = netLocator?.(netA);
      mainDiagnostics.push({
        code: "bind.net-mismatch",
        severity: "error",
        message: `interconnect ${interconnect.id} joins project net ${netA} to ${netB}`,
        location: { file: mainSource.file, line: interconnect.line, col: interconnect.col },
        hint: "both interconnect endpoints must resolve to the same project net",
        data: { interconnect: interconnect.id, net_a: netA, net_b: netB },
        ...(related === undefined ? {} : { related: [related] }),
      });
    }
  }
  if (mainSource !== null && mainIr !== undefined) {
  if (pcbIds.length === 0) {
    mainDiagnostics.push({
      code: "bind.not-checked",
      severity: "note",
      message: "the schematic/PCB binding was not checked because the project has no PCB description",
      location: { file: mainSource.file, line: 1, col: 1 },
      hint: "add a PCB description to check physical placement and connectivity",
    });
  } else if (parsedPcbs.length === pcbIds.length) {
    mainDiagnostics.push(
      ...checkBinding({
        file: mainSource.file,
        schematic: mainIr,
        pcbs: parsedPcbs.map(({ file, ir, sources }) => {
          const locate = locateWith(sources);
          return {
            file,
            pcb: ir,
            ...(locate === undefined ? {} : { locate }),
            ...(netLocator === undefined ? {} : { locateNet: netLocator }),
          };
        }),
        ...(mainLocate === undefined ? {} : { locate: mainLocate }),
      }),
    );

    const instances = schematicInstances(
      mainIr,
      (componentId) => resolver.resolve(componentId)?.pins ?? [],
      symbolOf,
      symbols,
      deviceOf,
    );
    const checkedPages = pages.map((page) => {
      const loadedComposition = loadPageComposition(root, page.view, symbols, { resolver, shards: componentShards });
      if (loadedComposition.errors.length > 0) {
        return { ...page, view: loadedComposition.view, geometry: schematicGeometry(loadedComposition.view, instances) };
      }
      return {
        ...page,
        view: loadedComposition.view,
        geometry: composedGeometry(loadedComposition.view, instances, loadedComposition.composition),
      };
    });
    mainDiagnostics.push(
      ...checkRatings({
        file: mainSource.file,
        schematic: mainIr,
        devices: ratingDevices(),
        ...(instanceLocator === undefined ? {} : { locateInstance: instanceLocator }),
      }),
      ...checkViews({
        file: mainSource.file,
        schematic: mainIr,
        pages: checkedPages,
        ...(netLocator === undefined ? {} : { locateNet: netLocator }),
        ...(mainResult?.modules === undefined ? {} : { modules: mainResult.modules }),
        moduleDrawings,
        templates,
        moduleDefinitions,
        locateModuleDrawing: (moduleId, irPath) => {
          const drawing = moduleDrawingById.get(moduleId);
          return drawing?.locate?.(irPath) ?? (drawing === undefined ? undefined : { file: drawing.file, line: 1, col: 1 });
        },
        locateTemplate: (templateId, irPath) => {
          const template = templateById.get(templateId);
          return template?.locate?.(irPath) ?? (template === undefined ? undefined : { file: template.file, line: 1, col: 1 });
        },
      }),
    );
    for (const page of checkedPages) {
      const geometry: ReadabilityGeometry = page.geometry;
      mainDiagnostics.push(
        ...checkReadability({
          file: page.file,
          view: page.view,
          schematic: mainIr,
          geometry,
          ...(page.locate === undefined ? {} : { locate: page.locate }),
        }),
      );
    }
  }
  }

  if (mainIr !== undefined) {
    for (const pcb of parsedPcbs) {
      const analysis = pcbAnalyses.find(({ pcb: id }) => id === pcb.pcb);
      if (analysis === undefined) continue;
      const locate = locateWith(pcb.sources);
      analysis.diagnostics.push(
        ...checkCopperCoverage({
          file: pcb.file,
          schematic: mainIr,
          pcb: pcb.ir,
          pads: padsByInstance(mainIr, devices, footprints),
        }),
        ...fillBoard(
          fillBoardFacts({
            file: pcb.file,
            pcb: pcb.ir,
            placed: footprintsByInstance(mainIr, devices, footprints),
            pin_net: pinNets(mainIr),
            ...(locate === undefined ? {} : { locate }),
          }),
        ).diagnostics,
      );
    }
  }

  for (const pcbId of pcbIds) {
    const analysis = pcbAnalyses.find(({ pcb }) => pcb === pcbId);
    const procurementShards: ProcurementPage[] = [];
    for (const role of PROCUREMENT_ROLES) {
      const procurement = loadProcurement(root, pcbId, role);
      if (procurement === null) continue;
      const parsed = parseProcurement(procurement.text, {
        file: procurement.file,
        board: pcbId,
        role,
        components: resolver,
      });
      if (analysis !== undefined) analysis.diagnostics.push(...parsed.diagnostics);
      if (parsed.ir === undefined) {
        referencesComplete = false;
        continue;
      }
      const contract = validate("procurement", parsed.ir);
      if (!contract.ok && analysis !== undefined)
        analysis.diagnostics.push(...schemaDiagnosticsToDiagnostics(contract.errors, locateWith(parsed.sources)));
      const locate = locateWith(parsed.sources);
      procurementShards.push({ ir: parsed.ir, file: procurement.file, ...(locate === undefined ? {} : { locate }) });
      for (const selection of parsed.ir.procurement.selections) {
        referencedDevices.add(selection.generic);
        if (selection.part) referencedDevices.add(selection.part);
      }
    }
    if (mainIr !== undefined && analysis?.ir !== undefined && procurementShards.length > 0) {
      const procurementDiagnostics = checkProcurement(
        buildProcurementFacts({
          schematic: mainIr,
          moduleInstances: analysis?.ir?.modules ?? [],
          procurements: procurementShards,
          devices,
          ...(instanceLocator === undefined ? {} : { locateInstance: instanceLocator }),
        }),
      );
      if (analysis !== undefined) analysis.diagnostics.push(...procurementDiagnostics);
      else projectDiagnostics.push(...procurementDiagnostics);
    }
  }

  if (referencesComplete) {
    projectDiagnostics.push(
      ...checkDeviceUsage({
        devices: componentShards.map((shard) => ({ id: shard.id, file: shard.file })),
        referenced: referencedDevices,
      }),
    );
  }

  const reviews = loadReviews(root);
  projectDiagnostics.push(...reviews.diagnostics);
  projectDiagnostics.push(
    ...checkReviews({
      ...(project.owner !== undefined ? { projectOwner: project.owner } : {}),
      rounds: reviews.rounds,
    }),
  );
  projectDiagnostics.push(...checkProjectInstanceUids(uidInputs));

  const diagnostics = [
    ...mainDiagnostics,
    ...pcbAnalyses.flatMap(({ diagnostics: pcbDiagnostics }) => pcbDiagnostics),
    ...projectDiagnostics,
  ];
  return {
    main: {
      main: "main",
      ...(mainIr === undefined ? {} : { ir: mainIr }),
      diagnostics: mainDiagnostics,
    },
    pcbs: pcbAnalyses,
    diagnostics,
  };
}
