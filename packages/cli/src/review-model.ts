// The review model's own module.
//
// The model is what the app draws: the boards, their print pages, the drawings — a board's canvas,
// a library symbol, a library footprint, a reusable module drawing — the findings and the build
// hash. It is not the server and not the document — the command line serves it and writes it into
// a page, and a plugin host serves it over its own transport (ADR-0043 D9). So it lives here,
// apart from the HTTP server, and can be built by either.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  formatQuantity,
  parseModuleView,
  parsePcb,
  parseProjectToml,
  parseSchematic,
  parseSchematicDocument,
  parseSheetTemplate,
  parseView,
  type Document as ModuleDocument,
  type ModuleSource,
  type QuantityKind,
} from "@texteda/parser";
import type { Schematic } from "@texteda/ir/schematic";
import type { ModulePlace, SchematicView } from "@texteda/ir/schematic-view";
import type { ModuleView as ModuleViewIr } from "@texteda/ir/module-view";
import type { SheetTemplate as SheetTemplateIr } from "@texteda/ir/sheet-template";
import type { Component } from "@texteda/ir/component";
import type { Symbol } from "@texteda/ir/symbol";
import type { Footprint } from "@texteda/ir/footprint";
import type { Diagnostic } from "@texteda/ir/diagnostics";
import {
  bounds,
  composedGeometry,
  moduleGeometry,
  renderComposedPage,
  renderFootprint,
  renderModuleDrawing,
  renderSchematic,
  renderSymbol,
  schematicGeometry,
  toSvgText,
  type SheetGeometry,
  type SvgDoc,
} from "@texteda/renderer";
import { renderPcb } from "@texteda/renderer/pcb";
import { viewMetrics } from "@texteda/core";
import type {
  ReviewBox,
  ReviewBoard,
  ReviewDiagnostic,
  ReviewDrawing,
  ReviewInstance,
  ReviewMetrics,
  ReviewModel,
  ReviewPcbPart,
  ReviewSymbol,
  ReviewField,
  ReviewText,
} from "@texteda/viewer";
import { checkProject } from "./check.ts";
import { buildIrTree } from "./ir-tree.ts";
import { LAYOUT } from "./paths.ts";
import {
  listPcbs,
  loadComponents,
  loadModuleViews,
  loadModules,
  loadPcb,
  loadSchematic,
  loadSheetTemplates,
  loadViews,
} from "./project.ts";
import { loadFootprintLibrary } from "./pads.ts";
import {
  instanceValueText,
  loadSymbolLibrary,
  schematicInstances,
  type DeviceFacts,
  type SchematicInstances,
} from "./symbols.ts";
import {
  moduleInstances,
  type DeviceLookup,
} from "./module-facts.ts";

/** Existing project pages, indexed without building the renderer/checker review model. */
export function reviewPageIndex(root: string): {
  boards: Set<string>;
  pages: { page: string; file: string }[];
  modules: { module: string; file: string }[];
} {
  const sources = loadViews(root);
  const ordered = [...sources].sort((a, b) => (a.pageId === "main" ? -1 : b.pageId === "main" ? 1 : a.pageId.localeCompare(b.pageId)));
  return {
    boards: new Set(["main"]),
    pages: ordered.map((view) => ({ page: view.pageId, file: view.file })),
    modules: loadModuleViews(root).map((view) => ({ module: view.moduleId, file: view.file })),
  };
}

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
  schematic: Schematic,
  viewText: string,
  viewFile: string,
  pageId: string,
  instances: SchematicInstances,
  artifacts: ViewArtifacts,
): ReviewDrawing {
  const parsed = parseView(viewText, { file: viewFile });
  if (!parsed.ir) {
    return {
      kind: "sch",
      key: `page/${pageId}`,
      label: pageId,
      file: viewFile,
      sheet: { w: 0, h: 0 },
      svg: "",
      symbols: [],
      texts: [],
      fields: [],
      problems: parsed.diagnostics.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`),
      board: "main",
      page: pageId,
    };
  }
  const view = parsed.ir;

  // What the page composes, if anything (ADR-0068 D4): a template gives the page its extent and
  // its furniture, and a `module_place` row puts a module drawing on the page. A page that
  // composes nothing is an ordinary page and is drawn as one.
  const templateId = view.template;
  const template = templateId === undefined ? undefined : artifacts.templates.get(templateId);
  const placements = view.module_place ?? [];

  let svg = "";
  const problems: string[] = [];
  if (templateId !== undefined) {
    if (template === undefined) {
      problems.push(`the page names the template ${templateId}, which the project does not have`);
    } else {
      // The template is there but does not compile: the page is drawn without its furniture, and
      // the template's own file says why.
      problems.push(...template.problems);
    }
  }
  const drawablePlacements = placements.filter((placement) => {
    const drawing = artifacts.drawings.get(placement.module_id);
    if (drawing === undefined) {
      problems.push(`the page places the module ${placement.module_id}, which has no drawing`);
      return false;
    }
    if (drawing.problems.length > 0 || drawing.ir === undefined) {
      problems.push(...drawing.problems);
      return false;
    }
    return true;
  });
  const effectiveView = template?.ir === undefined ? view : { ...view, sheet: template.ir.size };
  const renderView = drawablePlacements.length === placements.length
    ? effectiveView
    : { ...effectiveView, module_place: drawablePlacements };
  // Invalid references are reported above and excluded from composition, so they cannot block
  // valid placements or make the renderer infer module geometry.
  // Match the review app's default-off Auto fields control, including hotspot geometry.
  const renderOptions = { automaticFields: false };
  try {
    svg = toSvgText(
      template === undefined && placements.length === 0
        ? renderSchematic(view, instances, renderOptions)
        : renderComposedPage(renderView, instances, {
            ...(template?.ir === undefined ? {} : { template: template.ir }),
            drawings: composedDrawings(drawablePlacements, artifacts),
            moduleInstances: composedInstances(drawablePlacements, artifacts),
          }, renderOptions),
    );
  } catch (error) {
    // A view that references geometry nobody supplied cannot be drawn. The cross-check owns the
    // diagnosis; here the honest answer is "no drawing, and why".
    problems.push(error instanceof Error ? error.message : String(error));
  }

  let pageGeometry: SheetGeometry;
  try {
    pageGeometry = composedGeometry(renderView, instances, {
      ...(template?.ir === undefined ? {} : { template: template.ir }),
      drawings: composedDrawings(drawablePlacements, artifacts),
      moduleInstances: composedInstances(drawablePlacements, artifacts),
    }, renderOptions);
  } catch (error) {
    // Invalid placement facts must not hide the page or the checks' authoritative diagnostics.
    problems.push(error instanceof Error ? error.message : String(error));
    try {
      pageGeometry = schematicGeometry(effectiveView, instances, renderOptions);
    } catch {
      pageGeometry = { texts: [], fields: [], symbols: [], modules: [] };
    }
  }
  const geometry = reviewGeometry(pageGeometry);
  const { symbols, texts, fields } = geometry;
  const metrics = reviewMetrics(effectiveView, schematic, pageGeometry);

  // The page's own extent: a page that carries a template has none of its own — the template's size
  // is the page's extent (ADR-0068 D4).
  const sheet = effectiveView.sheet;

  return {
    kind: "sch",
    key: `page/${pageId}`,
    label: pageId,
    file: viewFile,
    sheet: sheet === undefined
      ? { w: 0, h: 0 }
      : { w: mm(sheet.width_nm), h: mm(sheet.height_nm) },
    svg,
    symbols,
    texts,
    fields,
    problems,
    board: "main",
    page: pageId,
    ...(metrics === undefined ? {} : { metrics }),
    // The source is exposed for the explicit Source panel; placements are the pending view actions
    // that can be applied to this page. Both are the page's own facts, not a second drawing
    // (ADR-0056 D1, D2).
    source: viewText,
    places: (view.place ?? []).map((place) => ({
      instance_id: place.instance_id,
      x: mm(place.x_nm),
      y: mm(place.y_nm),
      rot: Math.round((place.rot_mdeg ?? 0) / 1000),
    })),
  };
}

/**
 * The module drawings a page places, by module id (ADR-0068 D4).
 *
 * The same drawing may be placed more than once and on more than one page: the placement says
 * where it goes, the drawing says what it is.
 */
function composedDrawings(
  placements: readonly ModulePlace[],
  artifacts: ViewArtifacts,
): Map<string, ModuleViewIr> {
  const drawings = new Map<string, ModuleViewIr>();
  for (const placement of placements) {
    const drawing = artifacts.drawings.get(placement.module_id);
    if (drawing?.ir === undefined) continue;
    drawings.set(placement.module_id, drawing.ir);
  }
  return drawings;
}

/**
 * The module definitions' own instances, by module id (ADR-0068 D2).
 *
 * A placed drawing names the module's local instances; the geometry behind them is the module
 * definition's fact, not the board's.
 */
function composedInstances(
  placements: readonly ModulePlace[],
  artifacts: ViewArtifacts,
): Map<string, SchematicInstances> {
  const instances = new Map<string, SchematicInstances>();
  for (const placement of placements) {
    const drawing = artifacts.drawings.get(placement.module_id);
    if (drawing === undefined) continue;
    instances.set(placement.module_id, drawing.instances);
  }
  return instances;
}

/**
 * The board's physical canvas, or the reason it has none.
 *
 * The canvas is the board description drawn by the renderer: the outline, the placed parts with
 * their pads, the copper and the silkscreen. A board with no `pcb` description has no canvas —
 * the app says so rather than inventing one (ADR-0042 D7).
 */
function reviewPcb(
  root: string,
  pcbId: string,
  schematic: Schematic,
  footprintOf: (componentId: string) => string | undefined,
  library: ReadonlyMap<string, Footprint>,
  deviceOf: (componentId: string) => DeviceFacts | undefined,
): ReviewDrawing | undefined {
  const loaded = loadPcb(root, pcbId);
  if (loaded === null) return undefined;
  const parsed = parsePcb(loaded.text, { file: loaded.file, pcb: pcbId });
  if (!parsed.ir) {
    return {
      kind: "pcb",
      key: `pcb/${pcbId}`,
      label: pcbId,
      file: loaded.file,
      sheet: { w: 0, h: 0 },
      svg: "",
      symbols: [],
      texts: [],
      parts: [],
      problems: parsed.diagnostics
        .filter((diagnostic) => diagnostic.severity === "error")
        .map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`),
      board: pcbId,
    };
  }
  const pcb = parsed.ir;

  // The parts the board places, resolved through the schematic's own devices: a part whose
  // footprint is unknown contributes no pads, and the binding check says so (ADR-0019).
  const parts = pcb.place.flatMap((placement) => {
    const instance = schematic.instances.find((candidate) => candidate.id === placement.instance_id);
    if (instance === undefined) return [];
    const ref = footprintOf(instance.component);
    const footprint = ref === undefined ? undefined : library.get(ref);
    if (footprint === undefined) return [];
    // The printed value is not a fact of the land pattern, so it comes from the schematic's instance
    // row -- the same string the print page and the manufacturing export use (ADR-0024).
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
    kind: "pcb",
    key: `pcb/${pcbId}`,
    label: pcbId,
    file: loaded.file,
    sheet: { w: mm(Math.max(...xs) - Math.min(...xs)), h: mm(Math.max(...ys) - Math.min(...ys)) },
    svg,
    symbols: [],
    texts: [],
    parts: partList,
    problems,
    board: pcbId,
  };
}

/** The margin the renderer leaves around a drawing, in nanometres (2 mm on each side). */
const DRAWING_MARGIN_NM = 2_000_000;

/**
 * What the page measures, in the numbers the app shows.
 *
 * The measurement is the core's own (spec/schematic-view.md §9.4): the app measures nothing
 * itself, it only reports what the measurement says. A page that cannot be measured has no
 * measurements, and the app says nothing rather than a wrong number.
 */
function reviewMetrics(
  view: SchematicView,
  schematic: Schematic,
  geometry: SheetGeometry,
): ReviewMetrics | undefined {
  try {
    const measured = viewMetrics({ view, schematic, geometry });
    return {
      content_fill_ppm: measured.content_fill_ppm,
      ...(measured.text_min_gap_nm === null ? {} : { text_min_gap_nm: measured.text_min_gap_nm }),
      wire_total_nm: measured.wire_total_nm,
      wire_crossings: measured.wire_crossings,
      wires_through_bodies: measured.wires_through_bodies,
    };
  } catch {
    return undefined;
  }
}

/**
 * The sheet a standalone drawing gets: its own bounds plus the renderer's margin.
 *
 * A print page has a sheet of its own (the page says how big it is). A library symbol or footprint
 * has none, so the sheet is what the drawing occupies — the same box the renderer's viewBox uses,
 * so the app sizes the canvas to the ink and no more.
 */
function drawingSheet(doc: SvgDoc): { w: number; h: number } {
  const b = bounds(doc);
  return {
    w: mm(b.maxX - b.minX + 2 * DRAWING_MARGIN_NM),
    h: mm(b.maxY - b.minY + 2 * DRAWING_MARGIN_NM),
  };
}

/** `<class>:<id>` → the classification directory and the id (ADR-0049). */
function splitRef(ref: string): [string, string] {
  const dot = ref.indexOf(":");
  if (dot < 0) return ["", ref];
  return [ref.slice(0, dot), ref.slice(dot + 1)];
}

/* ------------------------------------------------------------------ *
 * The reusable view artifacts of ADR-0068: the module drawings and the
 * sheet templates. Both are advisory — they can show a design, they can
 * never change one.
 * ------------------------------------------------------------------ */

/**
 * One reusable module drawing (ADR-0068 D1/D2).
 *
 * The drawing is the view layer's own picture of one module: its own local bounds and rows that
 * use the module definition's local identities. It is advisory — it can show a module, it can
 * never change one.
 */
interface ModuleDrawing {
  /** The module the drawing draws. */
  readonly moduleId: string;
  /** The drawing's file, relative to the project root. */
  readonly file: string;
  /** The drawing's source, verbatim. */
  readonly source: string;
  /** The parsed drawing; absent when the file does not compile. */
  readonly ir?: ModuleViewIr;
  /** Why the drawing has no ink. */
  readonly problems: readonly string[];
  /** The module definition's own instances, as the renderer needs them. */
  readonly instances: SchematicInstances;
}

/** One reusable sheet template (ADR-0068 D1/D3): a size and static furniture. */
interface SheetTemplate {
  /** The template's id. */
  readonly templateId: string;
  /** The template's file, relative to the project root. */
  readonly file: string;
  /** The parsed template; absent when the file does not compile. */
  readonly ir?: SheetTemplateIr;
  /** Why the template has no ink. */
  readonly problems: readonly string[];
}

/**
 * The project's reusable view artifacts (ADR-0068 D1).
 *
 * The module drawings and the sheet templates are parsed once and handed to whoever draws them:
 * a page that places the same module twice draws the same drawing twice, from one parse.
 */
interface ViewArtifacts {
  /** The module drawings, by module id. */
  readonly drawings: ReadonlyMap<string, ModuleDrawing>;
  /** The sheet templates, by template id. */
  readonly templates: ReadonlyMap<string, SheetTemplate>;
}

/** What the model knows about a device: the symbol it draws and the pins it names (ADR-0031). */
type ComponentFacts = Component["component"];


/**
 * The project's reusable view artifacts, parsed (ADR-0068 D1).
 *
 * The module definitions are read as well: a module drawing names the module's own instances, and
 * the symbol behind an instance is a fact of the module file — the device names the pins, the
 * symbol draws them (ADR-0031). The drawing itself never declares a component, a pin, a net or a
 * port (ADR-0068 D2).
 */
function loadViewArtifacts(
  root: string,
  modules: readonly ModuleSource[],
  facts: DeviceLookup,
): ViewArtifacts {
  const definitions = new Map<string, ModuleDocument>();
  for (const source of modules) {
    const parsed = parseSchematicDocument(source.text, { file: source.file, kind: "module" });
    if (parsed.doc === undefined) continue;
    definitions.set(source.moduleId, parsed.doc);
  }

  const drawings = new Map<string, ModuleDrawing>();
  for (const source of loadModuleViews(root)) {
    const parsed = parseModuleView(source.text, { file: source.file });
    const definition = definitions.get(source.moduleId);
    const problems = parsed.ir === undefined
      ? parsed.diagnostics.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`)
      : [];
    if (definition === undefined) {
      // The drawing draws the module's own instances; without the module definition there are no
      // symbols to draw, and the project says why the definition is unusable.
      problems.push(`the module ${source.moduleId} has no usable definition, so its drawing has no geometry`);
    }
    drawings.set(source.moduleId, {
      moduleId: source.moduleId,
      file: source.file,
      source: source.text,
      ...(parsed.ir === undefined ? {} : { ir: parsed.ir }),
      problems,
      instances: definition === undefined ? new Map() : moduleInstances(definition, facts),
    });
  }

  const templates = new Map<string, SheetTemplate>();
  for (const source of loadSheetTemplates(root)) {
    const parsed = parseSheetTemplate(source.text, { file: source.file });
    templates.set(source.templateId, {
      templateId: source.templateId,
      file: source.file,
      ...(parsed.ir === undefined ? {} : { ir: parsed.ir }),
      problems: parsed.ir === undefined
        ? parsed.diagnostics.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`)
        : [],
    });
  }

  return { drawings, templates };
}

/**
 * The module definition's own instances, as the renderer needs them (ADR-0068 D2).
 *
 * A module drawing names the module's local instances (`U1`), and the geometry behind an instance
 * is the device's: the symbol draws the body, the device names the pins (ADR-0031). An instance
 * whose device or symbol is unknown is left out — the module file's own check says so, and
 * geometry cannot be invented for it.
 */


/**
 * One symbol from the library, drawn on its own.
 *
 * A symbol is a view (ADR-0031): the device names the pins, the symbol draws them. The drawing
 * takes the pins of a device that uses the symbol, so what a reviewer sees is what the board sees;
 * a symbol no device uses is still drawn, with unnamed pins. `group` is its device category, the
 * directory it is filed under (ADR-0049), and the sidebar groups by it.
 */
function reviewSymbol(
  ref: string,
  symbol: Symbol,
  pins: readonly { number: string; name: string; type: string }[],
): ReviewDrawing {
  const [group, id] = splitRef(ref);
  const doc = renderSymbol(symbol.symbol, { pins: pins.map((pin) => ({ ...pin })) });
  return {
    kind: "symbol",
    key: `symbol/${ref}`,
    label: id,
    group,
    file: `${LAYOUT.symbols}/${group}/${id}.teda`,
    sheet: drawingSheet(doc),
    svg: toSvgText(doc),
    symbols: [],
    texts: [],
    problems: [],
  };
}

/**
 * One footprint from the library, drawn on its own.
 *
 * A footprint is pure geometry (ADR-0030): the pads, the silkscreen and the courtyard. It needs no
 * device to be drawn. `group` is its package family, the directory it is filed under (ADR-0049).
 */
function reviewFootprint(ref: string, footprint: Footprint): ReviewDrawing {
  const [group, id] = splitRef(ref);
  const doc = renderFootprint(footprint.footprint);
  return {
    kind: "footprint",
    key: `footprint/${ref}`,
    label: id,
    group,
    file: `${LAYOUT.footprints}/${group}/${id}.teda`,
    sheet: drawingSheet(doc),
    svg: toSvgText(doc),
    symbols: [],
    texts: [],
    problems: [],
  };
}

/**
 * One reusable module drawing, drawn on its own.
 *
 * A module drawing is the view layer's own picture of one module, with its own local bounds
 * (ADR-0068 D2): it is not a page of a board, so its sheet is its own extent plus the renderer's
 * margin — the sheet a library symbol gets, not a board page's size. The drawing is advisory: it
 * shows a module, it never changes one.
 */
function reviewModuleDrawing(drawing: ModuleDrawing): ReviewDrawing {
  const problems = [...drawing.problems];
  let svg = "";
  if (drawing.ir !== undefined) {
    try {
      svg = toSvgText(renderModuleDrawing(drawing.ir, drawing.instances));
    } catch (error) {
      // A drawing that asks for geometry nobody supplied cannot be drawn. The module file's own
      // check owns the diagnosis; here the honest answer is "no ink, and why".
      problems.push(error instanceof Error ? error.message : String(error));
    }
  }
  const geometry = drawing.ir === undefined
    ? undefined
    : reviewGeometry(moduleGeometry(drawing.ir, drawing.instances));
  const local = drawing.ir?.bounds;
  return {
    kind: "module",
    key: `module/${drawing.moduleId}`,
    label: drawing.moduleId,
    file: drawing.file,
    module: drawing.moduleId,
    source: drawing.source,
    // The drawing's own bounds, plus the margin the renderer leaves around a drawing: the sheet
    // says how much room the drawing takes, not how much room a page would give it.
    sheet: local === undefined
      ? { w: 0, h: 0 }
      : { w: mm(local.width_nm + 2 * DRAWING_MARGIN_NM), h: mm(local.height_nm + 2 * DRAWING_MARGIN_NM) },
    svg,
    symbols: geometry?.symbols ?? [],
    texts: geometry?.texts ?? [],
    fields: geometry?.fields ?? [],
    places: (drawing.ir?.place ?? []).map((place) => ({
      instance_id: place.instance_id,
      x: mm(place.x_nm),
      y: mm(place.y_nm),
      rot: Math.round((place.rot_mdeg ?? 0) / 1000),
    })),
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
export function reviewGeometry(geometry: SheetGeometry): {
  symbols: ReviewSymbol[];
  texts: ReviewText[];
  fields: ReviewField[];
} {
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
      x: mm(text.x_nm),
      y: mm(text.y_nm),
      box: box(text.box.min_x_nm, text.box.min_y_nm, text.box.max_x_nm, text.box.max_y_nm),
    })),
    fields: geometry.fields.map((field) => ({
      instance_id: field.instance_id,
      name: field.name as ReviewField["name"],
      text: field.text,
      box: box(field.box.min_x_nm, field.box.min_y_nm, field.box.max_x_nm, field.box.max_y_nm),
      x: mm(field.local_x_nm),
      y: mm(field.local_y_nm),
      ...(field.anchor === undefined ? {} : { anchor: field.anchor }),
      manual: field.ir_path?.startsWith("/field/") === true,
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

/** Build the project-level review payload: one logical root, project pages, and physical PCB canvases. */
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
  const drawings: ReviewDrawing[] = [];
  const footprintLibrary = loadFootprintLibrary(root);
  const footprintOf = (componentId: string): string | undefined => componentOf(componentId)?.footprint;
  const artifacts = loadViewArtifacts(root, modules, {
    componentOf,
    pinsOf,
    symbolOf,
    deviceOf,
    symbols: symbolLibrary,
  });
  const source = loadSchematic(root);
  const schematicFile = source?.file ?? "design/sch/main.teda";
  const parsed = source === null ? undefined : parseSchematic(source.text, {
    file: source.file,
    components: resolver,
    modules,
  });
  if (parsed?.ir === undefined) {
    const reason = source === null
      ? "the project has no logical root schematic"
      : `the project does not compile: ${(parsed?.diagnostics ?? [])
          .filter((diagnostic) => diagnostic.severity === "error")
          .map((diagnostic) => diagnostic.code)
          .slice(0, 3)
          .join(", ")}`;
    boards.push({ id: "main", file: schematicFile, instances: [], nets: [], note: reason });
  } else {
    const schematic = parsed.ir as Schematic;
    const instances = schematicInstances(schematic, pinsOf, symbolOf, symbolLibrary, deviceOf);
    const pages = loadViews(root).map((view) =>
      reviewPage(schematic, view.text, view.file, view.pageId, instances, artifacts),
    );
    drawings.push(...pages);
    for (const pcbId of listPcbs(root)) {
      const pcb = reviewPcb(root, pcbId, schematic, footprintOf, footprintLibrary, deviceOf);
      if (pcb !== undefined) drawings.push(pcb);
    }
    boards.push({
      id: "main",
      file: schematicFile,
      instances: reviewInstances(schematic, paramTypes, componentOf, schematicFile),
      nets: schematic.nets.map((net) => ({ id: net.id, members: [...net.members] })),
      ...(pages.length === 0 ? { note: "no view file: this project has no print page to draw (ADR-0069)" } : {}),
    });
  }

  // The library's own drawings: every symbol and every footprint, drawn alone (ADR-0048 D4).
  // A symbol takes the pins of a device that uses it — the device names the pins, the symbol draws
  // them (ADR-0031) — so a symbol no device uses is drawn with unnamed pins.
  const pinsOfSymbol = (ref: string): { number: string; name: string; type: string }[] => {
    for (const shard of shards) {
      if (shard.ir.component.symbol === ref) {
        return pinsOf(shard.id).map((pin) => ({ number: pin.number, name: pin.name, type: pin.type }));
      }
    }
    return [];
  };
  // Sorted by the classification key (`<class>:<id>`): the sidebar groups by the class and sorts the
  // rows inside it, and the arrow keys walk the same order — one order, computed once, so what a
  // reviewer sees and what the arrows do cannot disagree.
  for (const [ref, symbol] of [...symbolLibrary].sort((a, b) => a[0].localeCompare(b[0]))) {
    drawings.push(reviewSymbol(ref, symbol, pinsOfSymbol(ref)));
  }
  for (const [ref, footprint] of [...footprintLibrary].sort((a, b) => a[0].localeCompare(b[0]))) {
    drawings.push(reviewFootprint(ref, footprint));
  }

  // The reusable module drawings, each drawn on its own (ADR-0068 D2): a module drawing is not a
  // page of a board, so it is previewed by itself, with its own bounds. They come after the
  // library's drawings because they are the project's own artifacts, in module-id order.
  for (const drawing of artifacts.drawings.values()) {
    drawings.push(reviewModuleDrawing(drawing));
  }

  const diagnostics = checkProject(root).diagnostics.map(reviewDiagnostic);
  const tree = buildIrTree(root);
  const hash = tree.projectHash;
  return {
    project: { name: projectName, root },
    ...(hash === undefined || hash === "" ? {} : { hash }),
    boards,
    drawings,
    diagnostics,
    sources: tree.identity.identities,
  };
}
