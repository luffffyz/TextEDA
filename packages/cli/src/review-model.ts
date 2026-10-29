// The review model's own module.
//
// The model is what the app draws: the boards, their print pages, the drawings, the findings and
// the build hash. It is not the server and not the document — the command line serves it and
// writes it into a page, and a plugin host serves it over its own transport (ADR-0142 D9). So it
// lives here, apart from the HTTP server, and can be built by either.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parsePcb, parseProjectToml, parseSchematic, parseView, formatQuantity, type QuantityKind } from "@texteda/parser";
import type { Schematic } from "@texteda/ir/schematic";
import type { Footprint } from "@texteda/ir/footprint";
import type { Diagnostic } from "@texteda/ir/diagnostics";
import { schematicGeometry, renderSchematic, toSvgText, type SheetGeometry } from "@texteda/renderer";
import { renderPcb } from "@texteda/renderer/pcb";
import type {
  ReviewBox,
  ReviewBoard,
  ReviewDiagnostic,
  ReviewInstance,
  ReviewModel,
  ReviewPage,
  ReviewPcb,
  ReviewPcbPart,
  ReviewSymbol,
  ReviewText,
} from "@texteda/viewer";
import { checkProject } from "./check.ts";
import { buildIrTree } from "./ir-tree.ts";
import { listBoards, loadBoard, loadComponents, loadModules, loadPcb } from "./project.ts";
import { loadFootprintLibrary } from "./pads.ts";
import {
  instanceValueText,
  loadSymbolLibrary,
  schematicInstances,
  type DeviceFacts,
  type SchematicInstances,
} from "./symbols.ts";

/** Integer nanometres → millimetres, three decimals (a micrometre): the drawing's own resolution. */
function mm(nm: number): number {
  return Math.round(nm / 1000) / 1000;
}

function box(minX: number, minY: number, maxX: number, maxY: number): ReviewBox {
  return { x: mm(minX), y: mm(minY), w: mm(maxX - minX), h: mm(maxY - minY) };
}

/** Flatten a diagnostic for the browser: what to read, where, and how bad. */
export function reviewDiagnostic(diagnostic: Diagnostic): ReviewDiagnostic {
  const location = diagnostic.location;
  return {
    code: diagnostic.code,
    severity: diagnostic.severity,
    message: diagnostic.message,
    ...(diagnostic.hint === undefined ? {} : { hint: diagnostic.hint }),
    ...(location === undefined ? {} : { file: location.file, line: location.line, col: location.col }),
  };
}

/** One page, drawn; or a page that says why it has no drawing. */
function reviewPage(
  root: string,
  boardId: string,
  schematic: Schematic,
  viewText: string,
  viewFile: string,
  pageId: string,
  instances: SchematicInstances,
): ReviewPage {
  const parsed = parseView(viewText, { file: viewFile, board: boardId });
  if (!parsed.ir) {
    return {
      id: pageId,
      file: viewFile,
      sheet: { w: 0, h: 0 },
      svg: "",
      symbols: [],
      texts: [],
      problems: parsed.diagnostics.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`),
    };
  }
  const view = parsed.ir;

  let svg = "";
  const problems: string[] = [];
  try {
    svg = toSvgText(renderSchematic(view, instances));
  } catch (error) {
    // A view that references geometry nobody supplied cannot be drawn. The cross-check (backlog F3)
    // owns the diagnosis; here the honest answer is "no drawing, and why".
    problems.push(error instanceof Error ? error.message : String(error));
  }

  const { symbols, texts } = reviewGeometry(schematicGeometry(view, instances));

  return {
    id: pageId,
    file: viewFile,
    sheet: { w: mm(view.sheet.width_nm), h: mm(view.sheet.height_nm) },
    svg,
    symbols,
    texts,
    problems,
    // The source is what the edit mode shows and edits; the placements are what the layout mode
    // moves. Both are the page's own facts, not a second drawing (ADR-0141 D3, D7).
    source: viewText,
    places: view.place.map((place) => ({
      instance_id: place.instance_id,
      x: mm(place.x_nm),
      y: mm(place.y_nm),
      rot: Math.round((place.rot_mdeg ?? 0) / 1000),
    })),
  };
}

/**
 * The board's physical canvas, or the reason it has none.
 *
 * The canvas is the board description drawn by the renderer: the outline, the placed parts with
 * their pads, the copper and the silkscreen. A board with no `pcb` description has no canvas —
 * the app says so rather than inventing one (ADR-0141 D7).
 */
function reviewPcb(
  root: string,
  boardId: string,
  schematic: Schematic,
  footprintOf: (componentId: string) => string | undefined,
  library: ReadonlyMap<string, Footprint>,
  deviceOf: (componentId: string) => DeviceFacts | undefined,
): ReviewPcb | undefined {
  const loaded = loadPcb(root, boardId);
  if (loaded === null) return undefined;
  const parsed = parsePcb(loaded.text, { file: loaded.file, board: boardId });
  if (!parsed.ir) {
    return {
      file: loaded.file,
      sheet: { w: 0, h: 0 },
      svg: "",
      parts: [],
      problems: parsed.diagnostics
        .filter((diagnostic) => diagnostic.severity === "error")
        .map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`),
    };
  }
  const pcb = parsed.ir;

  // The parts the board places, resolved through the schematic's own devices: a part whose
  // footprint is unknown contributes no pads, and the binding check says so (ADR-0118).
  const parts = pcb.place.flatMap((placement) => {
    const instance = schematic.instances.find((candidate) => candidate.id === placement.instance_id);
    if (instance === undefined) return [];
    const ref = footprintOf(instance.component);
    const footprint = ref === undefined ? undefined : library.get(ref);
    if (footprint === undefined) return [];
    // The printed value is not a fact of the land pattern, so it comes from the schematic's instance
    // row -- the same string the print page and the manufacturing export use (ADR-0123).
    const value = instanceValueText(instance, deviceOf(instance.component));
    return [{ instance_id: placement.instance_id, footprint, ...(value === undefined ? {} : { value }) }];
  });

  // The net of every pad, from the schematic's nets: a member names an instance and a pin, and the
  // pin number is the pad number (spec/pcb.md §5.1).
  const padNets = new Map<string, string>();
  for (const net of schematic.nets) {
    for (const member of net.members) {
      const dot = member.lastIndexOf(".");
      if (dot <= 0) continue;
      padNets.set(`${member.slice(0, dot)}.${member.slice(dot + 1)}`, net.id);
    }
  }

  const problems: string[] = [];
  let svg = "";
  try {
    svg = toSvgText(renderPcb({ pcb, parts, padNets }));
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error));
  }

  const outline = pcb.outline;
  const xs = outline.map((point) => point.x_nm);
  const ys = outline.map((point) => point.y_nm);
  const partList: ReviewPcbPart[] = pcb.place.map((placement) => {
    const instance = schematic.instances.find((candidate) => candidate.id === placement.instance_id);
    const ref = instance === undefined ? undefined : footprintOf(instance.component);
    return {
      instance_id: placement.instance_id,
      x: mm(placement.x_nm),
      y: mm(placement.y_nm),
      rot: Math.round(placement.rot_mdeg / 1000),
      side: placement.side,
      ...(ref === undefined ? {} : { footprint: ref }),
    };
  });

  return {
    file: loaded.file,
    sheet: { w: mm(Math.max(...xs) - Math.min(...xs)), h: mm(Math.max(...ys) - Math.min(...ys)) },
    svg,
    parts: partList,
    problems,
  };
}

/**
 * The page's symbols and texts as the browser needs them: boxes in millimetres.
 *
 * Exported because a layout plan hands back the renderer's geometry (`SheetGeometry`, integer
 * nanometres) and the app reads boxes in millimetres: the plugin host converts with the same rule
 * the model does, instead of keeping a second one.
 */
export function reviewGeometry(geometry: SheetGeometry): { symbols: ReviewSymbol[]; texts: ReviewText[] } {
  return {
    symbols: geometry.symbols.map((symbol) => ({
      id: symbol.instance_id,
      box: box(symbol.box.min_x_nm, symbol.box.min_y_nm, symbol.box.max_x_nm, symbol.box.max_y_nm),
      pins: Object.fromEntries(
        [...symbol.pins].map(([number, point]) => [number, { x: mm(point.x_nm), y: mm(point.y_nm) }]),
      ),
    })),
    texts: geometry.texts.map((text) => ({
      kind: text.kind,
      text: text.text,
      ...(text.subject === undefined ? {} : { subject: text.subject }),
      box: box(text.box.min_x_nm, text.box.min_y_nm, text.box.max_x_nm, text.box.max_y_nm),
    })),
  };
}

/** The board's instances with the facts a click reports, in board order (the IR's own order). */
function reviewInstances(
  schematic: Schematic,
  paramTypes: (componentId: string) => ReadonlyMap<string, string>,
  componentOf: (componentId: string) => { symbol?: string; footprint?: string } | undefined,
  file: string,
): ReviewInstance[] {
  return schematic.instances.map((instance) => {
    const types = paramTypes(instance.component);
    const params = (instance.params ?? []).map((param) => {
      if ("text" in param) return param.text;
      const type = types.get(param.name);
      return type === undefined ? `${param.value}` : formatQuantity(param.value, type as QuantityKind);
    });
    const component = componentOf(instance.component);
    const prefix = `${instance.id}.`;
    return {
      id: instance.id,
      component: instance.component,
      ...(component?.symbol === undefined ? {} : { symbol: component.symbol }),
      ...(component?.footprint === undefined ? {} : { footprint: component.footprint }),
      params,
      nets: schematic.nets.filter((net) => net.members.some((member) => member.startsWith(prefix))).map((net) => net.id),
      file,
    };
  });
}

/**
 * Build the payload the page shows.
 *
 * Every board that has a schematic becomes a board; a board with no view file becomes a board with no
 * pages and a note saying so — the honest state of ADR-0134 decision 6, not an invented layout.
 */
export function buildReviewModel(root: string): ReviewModel {
  const projectFile = "project.toml";
  const projectName = (() => {
    try {
      const parsed = parseProjectToml(readFileSync(join(root, projectFile), "utf8"), { file: projectFile });
      return parsed.ir?.project.name ?? projectFile;
    } catch {
      return projectFile;
    }
  })();

  const { resolver, shards } = loadComponents(root);
  const modules = loadModules(root);
  const symbolLibrary = loadSymbolLibrary(root);
  const componentOf = (componentId: string) => shards.find((shard) => shard.id === componentId)?.ir.component;
  const paramTypes = (componentId: string): ReadonlyMap<string, string> => {
    const declared = componentOf(componentId)?.params ?? [];
    return new Map(declared.map((param) => [param.name, param.type]));
  };
  const pinsOf = (componentId: string) => resolver.resolve(componentId)?.pins ?? [];
  const deviceOf = (componentId: string): DeviceFacts | undefined => {
    const component = componentOf(componentId);
    if (component === undefined) return undefined;
    return { params: component.params ?? [], ...(component.mpn === undefined ? {} : { mpn: component.mpn }) };
  };
  const symbolOf = (componentId: string) => componentOf(componentId)?.symbol;

  const boards: ReviewBoard[] = [];
  const footprintLibrary = loadFootprintLibrary(root);
  const footprintOf = (componentId: string): string | undefined => componentOf(componentId)?.footprint;
  for (const boardId of listBoards(root)) {
    const loaded = loadBoard(root, boardId);
    if (!loaded) continue;
    const parsed = parseSchematic(loaded.text, {
      file: loaded.file,
      board: boardId,
      components: resolver,
      modules,
    });
    if (!parsed.ir) {
      boards.push({
        id: boardId,
        file: loaded.file,
        pages: [],
        instances: [],
        nets: [],
        note: `the board does not compile: ${parsed.diagnostics
          .filter((diagnostic) => diagnostic.severity === "error")
          .map((diagnostic) => diagnostic.code)
          .slice(0, 3)
          .join(", ")}`,
      });
      continue;
    }
    const schematic = parsed.ir as Schematic;
    const instances = schematicInstances(schematic, pinsOf, symbolOf, symbolLibrary, deviceOf);
    const pages = loaded.views.map((view) =>
      reviewPage(root, boardId, schematic, view.text, view.file, view.pageId, instances),
    );
    const pcb = reviewPcb(root, boardId, schematic, footprintOf, footprintLibrary, deviceOf);
    boards.push({
      id: boardId,
      file: loaded.file,
      pages,
      instances: reviewInstances(schematic, paramTypes, componentOf, loaded.file),
      nets: schematic.nets.map((net) => ({ id: net.id, members: [...net.members] })),
      ...(pcb === undefined ? {} : { pcb }),
      ...(pages.length === 0
        ? { note: `no view file: nothing in ${dirOf(loaded.file)} draws this board (ADR-0134)` }
        : {}),
    });
  }

  const diagnostics = checkProject(root).diagnostics.map(reviewDiagnostic);
  const tree = buildIrTree(root);
  const hash = tree.projectHash;
  return {
    project: { name: projectName, root },
    ...(hash === undefined || hash === "" ? {} : { hash }),
    boards,
    diagnostics,
    sources: tree.identity.identities,
  };
}

function dirOf(file: string): string {
  const slash = file.lastIndexOf("/");
  return slash === -1 ? "." : file.slice(0, slash);
}
