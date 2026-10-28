// `texteda review <project dir>` — the review app (ADR-0134 decision 7).
//
// A browser app served by the CLI on 127.0.0.1: the file system stays here, the browser receives JSON
// and SVG only. Two things this file deliberately does not do: it does not parse or lay out anything
// itself (the parser, the renderer and the checks already own that), and it does not add behaviour to
// the drawing (the app does, around the SVG it is given).
//
// `--out <file>` writes the same document as one self-contained HTML file, which is the static review
// report CI can attach to a pull request (ADR-0134 decision 7: one bundle, three hosts).
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
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
  ReviewPlace,
  ReviewSymbol,
  ReviewText,
} from "@texteda/viewer";
import { clientScript } from "@texteda/viewer/build";
import {
  commitPlan,
  planLayout,
  renderPageSource,
  savePageSource,
  type LayoutPlace,
} from "./layout.ts";
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

export interface ReviewOptions {
  readonly root: string;
  /** Port to listen on; 0 asks the OS for a free one. Ignored with `--out`. */
  readonly port: number;
  /** Write a static HTML report here instead of serving. */
  readonly outFile: string | undefined;
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

/** The page's symbols and texts as the browser needs them: boxes in millimetres. */
function reviewGeometry(geometry: SheetGeometry): { symbols: ReviewSymbol[]; texts: ReviewText[] } {
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

/** Escape text for a `<script>` element: `</script>` inside the JSON would end the block. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * The whole app as one document: styles, the model, the script.
 *
 * Self-contained on purpose — it is served to `127.0.0.1` and written to disk for CI with the same
 * bytes, so what a reviewer looked at and what the report contains cannot differ.
 */
export async function renderReviewHtml(model: ReviewModel): Promise<string> {
  const script = await clientScript();
  const title = `${model.project.name} — TextEDA review`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLES}</style>
</head>
<body>
<div id="app"><p class="boot">Loading the review model…</p></div>
<script>window.__TEXTEDA_REVIEW__ = ${scriptJson(model)};</script>
<script type="module">${script}</script>
</body>
</html>
`;
}

const STYLES = `
:root {
  color-scheme: dark;
  --fg: #e6e6e6;
  --muted: #9aa0a6;
  --bg: #131416;
  --panel: #1b1d21;
  --line: #2c3037;
  --accent: #6ea8fe;
  --error: #ff6b6b;
  --warning: #f0b429;
  --note: #7f8a99;
}
* { box-sizing: border-box; }
html, body { height: 100%; margin: 0; }
body {
  background: var(--bg); color: var(--fg);
  font: 13px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
}
.boot { padding: 24px; color: var(--muted); }
#app { display: grid; grid-template-columns: 260px 1fr 300px; height: 100vh; }
aside { background: var(--panel); overflow: auto; }
.sidebar { border-right: 1px solid var(--line); padding: 12px; }
.inspector { border-left: 1px solid var(--line); padding: 12px; }
.project-name { font-weight: 600; font-size: 14px; }
.project-hash { color: var(--muted); font: 11px ui-monospace, monospace; margin-bottom: 12px; }
.board { margin-bottom: 10px; }
.board-name {
  display: block; width: 100%; text-align: left; background: none; border: 0;
  color: var(--fg); font: inherit; font-weight: 600; padding: 4px 6px; border-radius: 4px; cursor: pointer;
}
.board-name:hover { background: #23262c; }
.board-name.active { color: var(--accent); }
.page-name {
  display: block; width: 100%; text-align: left; background: none; border: 0;
  color: var(--muted); font: inherit; padding: 3px 6px 3px 18px; border-radius: 4px; cursor: pointer;
}
.page-name:hover { background: #23262c; }
.page-name.active { color: var(--fg); background: #262a31; }
.page-name.problem { color: var(--warning); }
.page-note { color: var(--muted); font-size: 11px; padding: 2px 6px 2px 18px; }
.instance-list { display: flex; flex-wrap: wrap; gap: 3px; padding: 2px 6px 4px 18px; }
.instance-name {
  background: none; border: 1px solid var(--line); border-radius: 3px; padding: 1px 4px;
  color: var(--muted); font: 10px ui-monospace, monospace; cursor: pointer;
}
.instance-name:hover { color: var(--fg); border-color: var(--muted); }
.instance-name.picked { color: var(--accent); border-color: var(--accent); }
h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin: 16px 0 6px; }
.diag-summary { font-size: 11px; color: var(--muted); }
.diag-summary.has-error { color: var(--error); }
.diag-summary.has-warning { color: var(--warning); }
.diagnostics { list-style: none; margin: 6px 0 0; padding: 0; }
.diag { border-left: 2px solid var(--note); padding: 3px 6px; margin-bottom: 4px; font-size: 11px; }
.diag.error { border-color: var(--error); }
.diag.warning { border-color: var(--warning); }
.diag-code { display: block; font: 11px ui-monospace, monospace; color: var(--muted); }
.diag-message { display: block; }
.diag-where { display: block; color: var(--muted); font: 10px ui-monospace, monospace; }
.diag-none { color: var(--muted); font-size: 11px; }
.diag-toggle {
  display: block; width: 100%; margin-top: 4px; padding: 4px 6px; text-align: left;
  background: none; border: 1px solid var(--line); border-radius: 4px;
  color: var(--muted); font: inherit; font-size: 11px; cursor: pointer;
}
.diag-toggle:hover { color: var(--fg); background: #23262c; }
.stage-wrap { display: flex; flex-direction: column; min-width: 0; }
.modes {
  display: flex; align-items: center; gap: 4px; padding: 6px 10px;
  border-bottom: 1px solid var(--line); background: var(--panel); flex-wrap: wrap;
}
.mode {
  background: none; border: 1px solid var(--line); border-radius: 4px; padding: 3px 10px;
  color: var(--muted); font: inherit; font-size: 12px; cursor: pointer;
}
.mode:hover:not(:disabled) { color: var(--fg); background: #23262c; }
.mode.active { color: var(--accent); border-color: var(--accent); }
.mode:disabled { opacity: .45; cursor: default; }
.mode-action {
  background: none; border: 1px solid var(--accent); border-radius: 4px; padding: 3px 10px;
  color: var(--accent); font: inherit; font-size: 12px; cursor: pointer; margin-left: 4px;
}
.mode-action:hover:not(:disabled) { background: #6ea8fe18; }
.mode-action:disabled { opacity: .4; cursor: default; border-color: var(--line); color: var(--muted); }
.mode-hint {
  color: var(--muted); font-size: 11px; margin-left: 10px;
  flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.panes { flex: 1; display: flex; min-height: 0; }
.source-pane {
  width: 42%; min-width: 240px; border-right: 1px solid var(--line); background: var(--panel);
  display: flex; overflow: hidden;
}
.source-pane.hidden { display: none; }
.source {
  flex: 1; width: 100%; border: 0; resize: none; padding: 10px 12px;
  background: var(--panel); color: var(--fg); font: 12px/1.5 ui-monospace, SFMono-Regular, monospace;
  outline: none; white-space: pre; overflow: auto;
}
.stage {
  flex: 1; position: relative; overflow: hidden; cursor: grab;
  background: radial-gradient(circle at 50% 40%, #1a1c20, #101113 70%);
}
.stage.dragging { cursor: grabbing; }
.stage.empty::after {
  content: attr(data-empty); position: absolute; inset: 0; display: grid; place-items: center;
  padding: 48px; text-align: center; white-space: pre-line; color: var(--muted);
}
.canvas { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
.sheet { box-shadow: 0 8px 32px #0008; }
.sheet-svg { display: block; background: #fff; }
/* The hit rect is invisible and exactly the object's box: no stroke, because a transparent stroke
   still counts for pointer-events and would make neighbouring 0402s steal each other's hover. */
/* The placement mode picks the board's own objects, so the page's hotspots stand aside. */
.picking .hotspots, .picking .marks { pointer-events: none; }
.hotspot { fill: transparent; stroke: none; pointer-events: all; }
/* The mark is a screen annotation, not part of the drawing: its box and stroke width are written
   per zoom in sheet units by the app, so it stays 1-2 px at any magnification. No filter glow
   either: a drop-shadow blur is in the element's own units, so zooming in turns it into a blob. */
.mark { fill: none; stroke: transparent; stroke-linejoin: round; pointer-events: none; }
.mark.hot { stroke: var(--accent); stroke-opacity: 0.9; }
.mark.selected { stroke: var(--accent); fill: #6ea8fe12; }
/* The net highlight on the board's canvas. The rules are per element type: a pad is a filled
   polygon, a track is a stroked polyline, and the zone's outline is neither. */
g.net-hot[data-ref^="pad:"] polygon { fill: var(--accent); }
g.net-hot[data-ref^="net:"] polyline { stroke: var(--accent); stroke-width: .45; }
g.net-hot[data-ref^="net:"] circle:first-of-type { fill: var(--accent); }
.status {
  border-top: 1px solid var(--line); padding: 6px 10px; color: var(--muted);
  font: 11px ui-monospace, monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.inspector h2 { margin-top: 0; color: var(--fg); text-transform: none; font-size: 15px; letter-spacing: 0; }
.inspector-body { font-size: 12px; }
.muted { color: var(--muted); }
.definition { display: grid; grid-template-columns: 64px 1fr; gap: 2px 8px; margin-bottom: 10px; }
.definition .label { color: var(--muted); }
.members { list-style: none; margin: 4px 0 0; padding: 0; }
.members li { display: flex; gap: 8px; padding: 2px 0; border-bottom: 1px solid var(--line); }
.refdes, .net-name { font: 12px ui-monospace, monospace; color: var(--accent); }
.pins, .component { color: var(--muted); font: 11px ui-monospace, monospace; }
.definitions-toggle {
  display: block; width: 100%; margin: 8px 0 0; padding: 4px 6px; text-align: left;
  background: none; border: 1px solid var(--line); border-radius: 4px;
  color: var(--muted); font: inherit; font-size: 11px; cursor: pointer;
}
.definitions-toggle:hover { color: var(--fg); background: #23262c; }
.definitions { list-style: none; margin: 4px 0 0; padding: 0; }
.definitions li { border-bottom: 1px solid var(--line); }
.definition-open {
  display: grid; grid-template-columns: 1fr auto; gap: 8px; width: 100%;
  padding: 4px 2px; background: none; border: 0; color: var(--fg);
  font: inherit; font-size: 11px; text-align: left; cursor: pointer;
}
.definition-open:hover, .definition-open:focus-visible { color: var(--accent); outline: none; }
.definition-kind { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.definition-where { color: var(--muted); font: 10px ui-monospace, monospace; }
`;

/**
 * The two write routes.
 *
 * Both take the board and page from the request and check them against the model the server
 * already holds: a route may only touch a print page the project actually has, so a request cannot
 * name a path of its own. The layout route either plans (the browser draws the result and the user
 * decides) or commits (the file is written and the model is rebuilt). The edit route saves the
 * source it is given, in the formatter's form, and answers with the page as it is drawn.
 */
async function handleApi(
  root: string,
  url: string,
  request: IncomingMessage,
  response: ServerResponse,
  rebuild: () => ReviewModel,
): Promise<void> {
  const send = (status: number, body: unknown): void => {
    const text = JSON.stringify(body);
    response.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(text);
  };
  try {
    const body = JSON.parse(await readBody(request)) as Record<string, unknown>;
    if (url === "/api/layout") {
      const model = rebuild();
      const board = model.boards.find((candidate) => candidate.id === body["board"]);
      if (board === undefined) {
        send(400, { error: `no such board: ${String(body["board"])}` });
        return;
      }
      const page = board.pages.find((candidate) => candidate.id === body["page"]);
      if (page === undefined) {
        send(400, { error: `no such print page: ${String(body["page"])}` });
        return;
      }
      const places = Array.isArray(body["places"]) ? (body["places"] as LayoutPlace[]) : [];
      const plan = planLayout(root, { board: board.id, page: page.id, places });
      if (body["commit"] === true) {
        commitPlan(root, plan);
        const after = rebuild();
        send(200, {
          changed: plan.changed,
          conflicts: plan.conflicts,
          reseated: plan.reseated,
          svg: plan.svg,
          model: after,
        });
        return;
      }
      send(200, {
        changed: plan.changed,
        conflicts: plan.conflicts,
        reseated: plan.reseated,
        svg: plan.svg,
      });
      return;
    }

    // The edit route: the source of a page the project has.
    const model = rebuild();
    const file = String(body["file"] ?? "");
    const owner = model.boards.find((candidate) => candidate.pages.some((candidatePage) => candidatePage.file === file));
    if (owner === undefined) {
      send(400, { error: `no such print page: ${file}` });
      return;
    }
    const page = owner.pages.find((candidatePage) => candidatePage.file === file)!;
    const text = String(body["text"] ?? "");
    if (body["save"] === true) {
      const saved = savePageSource(root, owner.id, page.id, text);
      if (saved.errors.length > 0) {
        send(400, { errors: saved.errors });
        return;
      }
      const after = rebuild();
      send(200, { changed: saved.changed, model: after });
      return;
    }
    const drawn = renderPageSource(root, owner.id, page.id, text);
    send(200, { svg: drawn.svg, errors: drawn.errors, anchors: drawn.anchors });
  } catch (error) {
    send(400, { error: error instanceof Error ? error.message : String(error) });
  }
}

/** The request's body, as text. */
function readBody(request: IncomingMessage): Promise<string> {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  let text = "";
  request.setEncoding("utf8");
  request.on("data", (chunk: string) => {
    text += chunk;
    if (text.length > 4_000_000) reject(new Error("the request body is too large"));
  });
  request.on("end", () => resolve(text));
  request.on("error", reject);
  return promise;
}

/**
 * Serve the app on `127.0.0.1:port`, or write it to `outFile` and return.
 *
 * The server answers the document, and two write routes: the layout Apply and the edit mode's
 * save. Both own the file system: the browser asks, the server writes (ADR-0141 D9). The static
 * export (`--out`) has no routes at all — it is a document, not a server — and the app says so
 * when a write is asked of it.
 */
export async function runReview(options: ReviewOptions): Promise<number> {
  let model = { ...buildReviewModel(options.root), writable: true };
  const html = await renderReviewHtml(model);

  if (options.outFile !== undefined) {
    const target = resolve(options.outFile);
    mkdirSync(dirname(target), { recursive: true });
    // A static document has no server behind it: the app must not offer to write (ADR-0141 D9).
    writeFileSync(target, await renderReviewHtml({ ...model, writable: false }));
    process.stdout.write(`${target}\n`);
    return 0;
  }

  const server = createServer((request, response) => {
    const url = request.url ?? "/";
    if (request.method === "POST" && (url === "/api/layout" || url === "/api/source")) {
      void handleApi(options.root, url, request, response, () => {
        model = { ...buildReviewModel(options.root), writable: true };
        return model;
      });
      return;
    }
    if (request.url !== "/" && request.url !== "/index.html") {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("not found\n");
      return;
    }
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      // The document is regenerated on every start; a cached copy would show a stale drawing.
      "cache-control": "no-store",
    });
    response.end(html);
  });

  const listening = Promise.withResolvers<void>();
  server.once("error", listening.reject);
  server.listen(options.port, "127.0.0.1", listening.resolve);
  await listening.promise;
  // Ctrl-C stops a dev server: that is a normal end, not a failure. Without this the signal reaches
  // Bun's wrapper, which reports the process as killed (a failing exit code in a script or a
  // supervisor) for something the user asked for.
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      server.close();
      process.exit(0);
    });
  }

  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : options.port;
  process.stdout.write(`review ${model.project.name} at http://127.0.0.1:${port}/\n`);
  process.stdout.write(`${model.boards.length} boards, ${model.diagnostics.length} diagnostics\n`);
  return 0;
}
