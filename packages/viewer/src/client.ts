// The review app: one page, no framework, no build step of its own (ADR-0134 decision 7).
//
// What it is allowed to do: show the SVG the renderer produced, add behaviour to it (hover, click,
// pan, zoom), and report what the page is made of. What it must not do: place symbols, move wires,
// or write anything back — the drawing is a function of (logic IR, view IR), and a viewer that
// adjusted it would become a second source of truth (ADR-0134, AGENTS.md §2 invariant 3).
//
// The model is injected as `window.__TEXTEDA_REVIEW__` (see `packages/cli/src/review.ts`).
import { definitionLocations, editorUri } from "./definitions.ts";
import type {
  ReviewBoard,
  ReviewDiagnostic,
  ReviewInstance,
  ReviewModel,
  ReviewPage,
  ReviewSourceLocation,
} from "./types.ts";

interface Highlight {
  readonly kind: "symbol" | "text";
  readonly id: string;
}

declare global {
  interface Window {
    __TEXTEDA_REVIEW__: ReviewModel;
  }
}

const model: ReviewModel = window.__TEXTEDA_REVIEW__;

/** Sheet millimetres → pixels: the sheet is shown at a fixed 4 px/mm before the user zooms. */
const PX_PER_MM = 4;
/** Findings shown before "show all": enough to act on, few enough to leave the drawing room. */
const DIAGNOSTIC_PREVIEW = 5;
/** Instances listed for a board with no print page: a board is a few dozen parts, not a library. */
const INSTANCE_PREVIEW = 60;
let expanded = false;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 12;

const state = {
  board: model.boards[0]?.id ?? "",
  page: 0,
  zoom: 1,
  panX: 0,
  panY: 0,
  selected: null as Highlight | null,
  /** The definition menu is open for the current selection (F34 source jump). */
  definitionsOpen: false,
  /** Set once the reviewer pans or zooms: a window resize must not undo their framing. */
  adjusted: false,
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function board(): ReviewBoard | undefined {
  return model.boards.find((candidate) => candidate.id === state.board);
}

function page(): ReviewPage | undefined {
  return board()?.pages[state.page];
}

/** The instance behind a refdes, with the nets its pins land on. */
function instanceOf(id: string): ReviewInstance | undefined {
  return board()?.instances.find((candidate) => candidate.id === id);
}

function severityRank(diagnostic: ReviewDiagnostic): number {
  return diagnostic.severity === "error" ? 0 : diagnostic.severity === "warning" ? 1 : 2;
}

// --- the frame -------------------------------------------------------------------------------
//
// The app is three columns: what a project is made of, the sheet, and the facts about whatever is
// under the cursor. No toolbar: a reviewer's hands stay on the drawing.

const root = document.getElementById("app")!;
root.textContent = "";

const sidebar = el("aside", "sidebar");
const stageWrap = el("main", "stage-wrap");
const inspector = el("aside", "inspector");
root.append(sidebar, stageWrap, inspector);

const projectName = el("div", "project-name", model.project.name);
const projectHash = el("div", "project-hash", model.hash === undefined ? "not compiled" : `build ${model.hash.slice(0, 12)}`);
sidebar.append(projectName, projectHash);

const boardList = el("nav", "boards");
sidebar.append(boardList);

const diagSummary = el("div", "diag-summary");
const diagList = el("ol", "diagnostics");
sidebar.append(el("h2", undefined, "Check"), diagSummary, diagList);

const stage = el("div", "stage");
const canvas = el("div", "canvas");
stage.append(canvas);
stageWrap.append(stage);

const status = el("div", "status");
stageWrap.append(status);

const inspectorTitle = el("h2", undefined, "Nothing selected");
const inspectorBody = el("div", "inspector-body", "Point at a symbol, a label or a port.");
inspector.append(inspectorTitle, inspectorBody);

// --- navigation ------------------------------------------------------------------------------

function renderBoards(): void {
  boardList.textContent = "";
  for (const candidate of model.boards) {
    const group = el("div", "board");
    const button = el("button", "board-name", candidate.id);
    button.type = "button";
    if (candidate.id === state.board) button.classList.add("active");
    button.addEventListener("click", () => {
      state.board = candidate.id;
      state.page = 0;
      fit();
      renderAll();
    });
    group.append(button);
    if (candidate.pages.length === 0) {
      group.append(el("div", "page-note", candidate.note ?? "no view file: the board has no drawing"));
      // No drawing is not no design: the board's instances are still there to look at, and this is
      // the only way to reach them from the app (ADR-0134 decision 6: report, never invent a layout).
      const list = el("div", "instance-list");
      for (const instance of candidate.instances.slice(0, INSTANCE_PREVIEW)) {
        const item = el("button", "instance-name", instance.id);
        item.type = "button";
        item.title = `${instance.component} ${instance.params.join(" ")}`.trim();
        if (state.selected?.kind === "symbol" && state.selected.id === instance.id) {
          item.classList.add("picked");
        }
        item.addEventListener("click", () => {
          state.selected = { kind: "symbol", id: instance.id };
          state.definitionsOpen = false;
          renderBoards();
          renderInspector();
        });
        list.append(item);
      }
      if (candidate.instances.length > INSTANCE_PREVIEW) {
        list.append(el("div", "page-note", `… ${candidate.instances.length - INSTANCE_PREVIEW} more`));
      }
      group.append(list);
    } else {
      candidate.pages.forEach((candidatePage, index) => {
        const pageButton = el("button", "page-name", candidatePage.id);
        pageButton.type = "button";
        if (candidate.id === state.board && index === state.page) pageButton.classList.add("active");
        if (candidatePage.problems.length > 0) pageButton.classList.add("problem");
        pageButton.addEventListener("click", () => {
          state.board = candidate.id;
          state.page = index;
          fit();
          renderAll();
        });
        group.append(pageButton);
      });
    }
    boardList.append(group);
  }
}

function renderDiagnostics(): void {
  const counts = { error: 0, warning: 0, note: 0 };
  for (const diagnostic of model.diagnostics) counts[diagnostic.severity] += 1;
  diagSummary.textContent = `${counts.error} errors · ${counts.warning} warnings · ${counts.note} notes`;
  diagSummary.className = `diag-summary ${counts.error > 0 ? "has-error" : counts.warning > 0 ? "has-warning" : ""}`;

  diagList.textContent = "";
  const sorted = [...model.diagnostics].sort((a, b) => severityRank(a) - severityRank(b));
  // The head of the list, then a button: a hundred findings in a sidebar buries the drawing, and the
  // first ones are what a reviewer acts on.
  const shown = expanded ? sorted : sorted.slice(0, DIAGNOSTIC_PREVIEW);
  for (const diagnostic of shown) {
    const row = el("li", `diag ${diagnostic.severity}`);
    row.append(el("span", "diag-code", diagnostic.code));
    row.append(el("span", "diag-message", diagnostic.message));
    if (diagnostic.file !== undefined) {
      row.append(
        el("span", "diag-where", `${diagnostic.file}${diagnostic.line === undefined ? "" : `:${diagnostic.line}`}`),
      );
    }
    diagList.append(row);
  }
  if (sorted.length === 0) diagList.append(el("li", "diag-none", "nothing to report"));
  if (sorted.length > DIAGNOSTIC_PREVIEW) {
    const toggle = el("button", "diag-toggle", expanded ? "show fewer" : `show all ${sorted.length}`);
    toggle.type = "button";
    toggle.addEventListener("click", () => {
      expanded = !expanded;
      renderDiagnostics();
    });
    diagList.append(toggle);
  }
}

// --- the sheet -------------------------------------------------------------------------------

/** The sheet's own coordinate system is millimetres; the canvas is scaled from that. */
function applyTransform(): void {
  // Pan with a transform (cheap, and a moved layer stays sharp), zoom by resizing the SVG instead.
  // A CSS `scale()` would let the browser scale a rasterised copy of the sheet and re-rasterise it
  // afterwards, which is exactly the "blurry for a moment, then sharp" the reviewer sees; sizing the
  // SVG re-renders its vectors at the new size every time, so a zoom step is never blurry.
  canvas.style.transform = `translate(${state.panX}px, ${state.panY}px)`;
  resizeSheet();
  padMarks();
}

/** Give the sheet's SVG its size on screen; its viewBox stays in millimetres. */
function resizeSheet(): void {
  const svg = canvas.querySelector<SVGSVGElement>(".sheet-svg");
  const current = page();
  if (svg === null || current === undefined) return;
  const scale = PX_PER_MM * state.zoom;
  svg.setAttribute("width", `${current.sheet.w * scale}`);
  svg.setAttribute("height", `${current.sheet.h * scale}`);
}

function fit(): void {
  const current = page();
  if (current === undefined) return;
  const { w, h } = current.sheet;
  const box = stage.getBoundingClientRect();
  const margin = 32;
  const available = { w: Math.max(box.width - margin * 2, 80), h: Math.max(box.height - margin * 2, 80) };
  const scale = Math.min(available.w / (w * PX_PER_MM), available.h / (h * PX_PER_MM));
  state.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, scale));
  // Centre the sheet: the canvas is in millimetres × PX_PER_MM × zoom, and its origin is the sheet's.
  const drawnW = w * PX_PER_MM * state.zoom;
  const drawnH = h * PX_PER_MM * state.zoom;
  state.panX = (box.width - drawnW) / 2;
  state.panY = (box.height - drawnH) / 2;
  state.adjusted = false;
  applyTransform();
}

/** What the status line says about the page itself; hover replaces it and moving away restores it. */
let pageStatus = "";

function setStatus(text: string): void {
  pageStatus = text;
  status.textContent = text;
}

function renderStage(): void {
  const current = page();
  canvas.textContent = "";
  state.selected = null;
  state.definitionsOpen = false;
  status.classList.remove("error");
  if (current === undefined) {
    const note = board()?.note ?? "this board has no print page";
    stage.classList.add("empty");
    // The empty stage says why it is empty rather than showing a black rectangle.
    stage.dataset["empty"] = `${board()?.id ?? "this board"}\n${note}`;
    setStatus(note);
    renderInspector();
    return;
  }
  stage.classList.remove("empty");
  delete stage.dataset["empty"];

  if (current.problems.length > 0) {
    setStatus(`this page has no drawing: ${current.problems.join("; ")}`);
    renderInspector();
    return;
  }

  // The renderer's SVG is inserted as markup and then measured: the app adds hotspots on top of it
  // rather than drawing the sheet a second time.
  const holder = el("div", "sheet");
  holder.innerHTML = current.svg;
  canvas.append(holder);
  applyTransform();

  const svg = holder.querySelector("svg");
  if (svg === null) {
    setStatus("the renderer produced no SVG for this page");
    return;
  }
  pinchSheet(svg);
  overlay(svg, current);
  applyTransform();
  setStatus(`${current.file} · ${current.sheet.w} × ${current.sheet.h} mm · ${current.symbols.length} symbols`);
}

/**
 * The page's own SVG is a stand-alone document: it paints its own paper. Its viewBox stays in
 * millimetres; `resizeSheet` sets the pixel size, which is what zooms it without blurring.
 */
function pinchSheet(svg: SVGSVGElement): void {
  svg.setAttribute("preserveAspectRatio", "xMinYMin meet");
  svg.classList.add("sheet-svg");
}

/** The bounds each visible mark was drawn from, in sheet millimetres. */
const markBounds = new WeakMap<SVGRectElement, { x: number; y: number; w: number; h: number }>();

/** Pixels the mark stands off the object's ink edge, at any zoom. */
const MARK_PAD_PX = 4;
/**
 * Half the stroke the drawing typically uses, in millimetres.
 *
 * The boxes in the model are centreline boxes, but a stroke is painted half inside and half outside
 * the line: at 1x that is a fraction of a pixel, at 8x it is a millimetre of ink growing outward.
 * Standing a fixed number of pixels off the centreline therefore looks tighter the further you zoom
 * in. Adding half a stroke to the stand-off keeps the gap between mark and drawn edge constant.
 */
const INK_HALF_MM = 0.125;
/** Screen thickness of a mark: hovered, then picked. Converted to sheet units by `padMarks`. */
const MARK_STROKE_PX = 1.25;
const MARK_STROKE_SELECTED_PX = 1.75;

/**
 * Re-inflate the marks for the current zoom.
 *
 * The boxes are in millimetres and the canvas is scaled, so a fixed millimetre padding would vanish
 * when zoomed out and swamp the drawing when zoomed in. The padding is therefore computed in screen
 * pixels and the marks are rewritten whenever the transform changes.
 */
function padMarks(): void {
  const scale = PX_PER_MM * state.zoom;
  const pad = MARK_PAD_PX / scale + INK_HALF_MM;
  const radius = 2 / scale;
  for (const mark of canvas.querySelectorAll<SVGRectElement>(".mark")) {
    const bounds = markBounds.get(mark);
    if (bounds === undefined) continue;
    mark.setAttribute("x", `${bounds.x - pad}`);
    mark.setAttribute("y", `${bounds.y - pad}`);
    mark.setAttribute("width", `${bounds.w + pad * 2}`);
    mark.setAttribute("height", `${bounds.h + pad * 2}`);
    mark.setAttribute("rx", `${radius}`);
    // Stroke width is in millimetres too. `vector-effect: non-scaling-stroke` does not help here:
    // it compensates the SVG's own viewBox, not the CSS scale() on the canvas around it, so a
    // "1.5 px" stroke would be 1.5 mm — a slug, not an outline.
    const px = mark.classList.contains("selected") ? MARK_STROKE_SELECTED_PX : MARK_STROKE_PX;
    mark.style.strokeWidth = `${px / scale}`;
  }
}

/** Hotspots for symbols and net texts, drawn in the sheet's own millimetres. */
function overlay(svg: SVGSVGElement, current: ReviewPage): void {
  const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
  group.setAttribute("class", "hotspots");

  const boxOf = new WeakMap<SVGRectElement, { x: number; y: number; w: number; h: number }>();

  const hotspot = (box: { x: number; y: number; w: number; h: number }, highlight: Highlight): SVGRectElement => {
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x", `${box.x}`);
    rect.setAttribute("y", `${box.y}`);
    rect.setAttribute("width", `${box.w}`);
    rect.setAttribute("height", `${box.h}`);
    rect.setAttribute("class", "hotspot");
    rect.dataset["kind"] = highlight.kind;
    rect.dataset["id"] = highlight.id;
    boxOf.set(rect, box);
    rect.addEventListener("mouseenter", () => {
      hover(highlight);
    });
    // The stage captures the pointer to pan, so `click` never reaches this element: a press is
    // remembered here and turned into a selection on release when the pointer did not travel.
    rect.addEventListener("pointerdown", () => {
      pressed = highlight;
    });
    return rect;
  };

  const rows: SVGRectElement[] = [];
  for (const symbol of current.symbols) rows.push(hotspot(symbol.box, { kind: "symbol", id: symbol.id }));
  for (const text of current.texts) {
    rows.push(hotspot(text.box, { kind: "text", id: text.subject ?? text.text }));
  }
  group.append(...rows);
  svg.append(group);

  // The visible marks go in a second group on top: a mark is the object's box inflated by a
  // constant number of screen pixels, so a 0402 capacitor is as easy to point at as a QFP, and the
  // outline never sits exactly on the drawing's own lines.
  const marks = document.createElementNS("http://www.w3.org/2000/svg", "g");
  marks.setAttribute("class", "marks");
  for (const rect of rows) {
    const mark = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    mark.setAttribute("class", "mark");
    mark.dataset["kind"] = rect.dataset["kind"];
    mark.dataset["id"] = rect.dataset["id"];
    marks.append(mark);
    const bounds = boxOf.get(rect);
    if (bounds !== undefined) markBounds.set(mark, bounds);
  }
  svg.append(marks);
  padMarks();
}

/**
 * Highlight what is under the cursor.
 *
 * Emphasis is a class on the hotspot (the app's own layer), plus the dimming of the others: the
 * renderer's drawing is never touched, so what a reviewer sees highlighted is the same picture that
 * a static export shows.
 */
function hover(highlight: Highlight): void {
  paintHighlights(highlight);
  const facts = highlight.kind === "symbol" ? instanceOf(highlight.id) : undefined;
  if (highlight.kind === "symbol") {
    status.textContent =
      facts === undefined
        ? `${highlight.id}`
        : `${facts.id} · ${facts.component} · ${facts.nets.join(" ") || "no nets"}`;
  } else {
    status.textContent = `net ${highlight.id}`;
  }
}

/** Keep the selected element marked while the pointer moves away from it. */
function paintHighlights(under: Highlight | null): void {
  const selected = state.selected;
  for (const node of canvas.querySelectorAll<SVGRectElement>(".hotspot, .mark")) {
    const picked =
      selected !== null && node.dataset["kind"] === selected.kind && node.dataset["id"] === selected.id;
    const hovered = under !== null && node.dataset["kind"] === under.kind && node.dataset["id"] === under.id;
    node.classList.toggle("selected", picked);
    // A picked object keeps its selection look; hovering it again does not add a second outline.
    node.classList.toggle("hot", hovered && !picked);
  }
  padMarks();
}

/** The pointer left the stage: drop the hover mark, keep the selection. */
stage.addEventListener("pointerleave", () => {
  paintHighlights(null);
  status.textContent = pageStatus;
});

/**
 * The pointer moved off a hotspot onto the sheet or out of the stage.
 *
 * `pointerout` fires on every pass from one hotspot to another, so the move only counts as "away"
 * when what is being entered is not a hotspot: otherwise the mark would blink between neighbours.
 */
stage.addEventListener("pointerout", (event) => {
  const entering = event.relatedTarget;
  if (entering instanceof Element && entering.closest(".hotspot") !== null) return;
  paintHighlights(null);
  status.textContent = pageStatus;
});

/** Drop the selection and everything that showed it: the marks, the chips, the inspector. */
function clearSelection(): void {
  if (state.selected === null) return;
  state.selected = null;
  state.definitionsOpen = false;
  paintHighlights(null);
  renderBoards();
  renderInspector();
}

function locationsFor(selected: Highlight): ReviewSourceLocation[] {
  const facts = instanceOf(selected.id);
  const symbol = page()?.symbols.find((candidate) => candidate.id === selected.id);
  return definitionLocations({
    sources: model.sources,
    board: state.board,
    selected,
    ...(facts === undefined ? {} : { instance: facts }),
    pins: Object.keys(symbol?.pins ?? {}),
  });
}

/** Open a source location in the editor the user has bound to `vscode://file/…`. */
function openLocation(location: ReviewSourceLocation): void {
  window.location.href = editorUri(model.project.root, location);
  setStatus(`opening ${location.file}:${location.line}:${location.col}`);
}

function showDefinitions(): void {
  if (state.selected === null) return;
  state.definitionsOpen = true;
  renderInspector();
  inspectorBody.querySelector<HTMLButtonElement>(".definition-open")?.focus();
}

/** The definition menu: one row per place the selected identity appears. */
function appendDefinitions(selected: Highlight): void {
  const toggle = el(
    "button",
    "definitions-toggle",
    state.definitionsOpen ? "hide definitions" : "definitions (Enter)",
  );
  toggle.type = "button";
  toggle.addEventListener("click", () => {
    state.definitionsOpen = !state.definitionsOpen;
    renderInspector();
  });
  inspectorBody.append(toggle);
  if (!state.definitionsOpen) return;

  const locations = locationsFor(selected);
  if (locations.length === 0) {
    inspectorBody.append(el("div", "muted", "no source location recorded for this identity"));
    return;
  }
  const list = el("ul", "definitions");
  for (const location of locations) {
    const item = el("li");
    const open = el("button", "definition-open");
    open.type = "button";
    open.title = `open ${location.file}:${location.line}:${location.col}`;
    open.append(el("span", "definition-kind", location.label));
    open.append(el("span", "definition-where", `${location.file}:${location.line}`));
    open.addEventListener("click", () => openLocation(location));
    item.append(open);
    list.append(item);
  }
  inspectorBody.append(list);
}

function renderInspector(): void {
  inspectorBody.textContent = "";
  const selected = state.selected;
  if (selected === null) {
    inspectorTitle.textContent = "Nothing selected";
    inspectorBody.append(el("div", "muted", "Click a symbol, a label or a port."));
    return;
  }
  if (selected.kind === "text") {
    const net = board()?.nets.find((candidate) => candidate.id === selected.id);
    inspectorTitle.textContent = `net ${selected.id}`;
    if (net === undefined) {
      inspectorBody.append(el("div", "muted", "this text names nothing on the board"));
      return;
    }
    const list = el("ul", "members");
    for (const member of net.members) {
      const item = el("li");
      const [refdes, ...pins] = member.split(".");
      const instance = instanceOf(refdes ?? "");
      item.append(el("span", "refdes", refdes ?? member));
      item.append(el("span", "pins", pins.join(".")));
      if (instance !== undefined) item.append(el("span", "component", instance.component));
      list.append(item);
    }
    inspectorBody.append(el("div", "muted", `${net.members.length} pins`), list);
    appendDefinitions(selected);
    return;
  }

  inspectorTitle.textContent = selected.id;
  const facts = instanceOf(selected.id);
  if (facts === undefined) {
    inspectorBody.append(el("div", "muted", "the drawing places an instance the board does not list"));
    appendDefinitions(selected);
    return;
  }
  const definition = el("div", "definition");
  definition.append(el("span", "label", "device"), el("span", "value", facts.component));
  if (facts.symbol !== undefined) definition.append(el("span", "label", "symbol"), el("span", "value", facts.symbol));
  if (facts.footprint !== undefined) definition.append(el("span", "label", "footprint"), el("span", "value", facts.footprint));
  if (facts.params.length > 0) definition.append(el("span", "label", "spec"), el("span", "value", facts.params.join(" ")));
  definition.append(el("span", "label", "source"), el("span", "value", facts.file));
  inspectorBody.append(definition);

  const nets = el("ul", "members");
  for (const netId of facts.nets) {
    const net = board()?.nets.find((candidate) => candidate.id === netId);
    const item = el("li");
    item.append(el("span", "net-name", netId));
    item.append(el("span", "pins", (net?.members ?? []).filter((m) => m.startsWith(`${facts.id}.`)).join(" ")));
    nets.append(item);
  }
  inspectorBody.append(el("h3", undefined, "nets"), nets.children.length === 0 ? el("div", "muted", "no nets") : nets);
  appendDefinitions(selected);
}

// --- input -----------------------------------------------------------------------------------

/** Pixels a pointer must travel before a press counts as a pan rather than a click. */
const DRAG_SLOP = 3;

let dragging: { x: number; y: number; panX: number; panY: number; moved: boolean } | null = null;
/** The hotspot under the pointer at press time; a press that does not travel selects it. */
let pressed: Highlight | null = null;
/** The previous click, for double-click detection on our own pointer-up selection. */
let lastPress: { kind: Highlight["kind"]; id: string; at: number } | null = null;

stage.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  dragging = { x: event.clientX, y: event.clientY, panX: state.panX, panY: state.panY, moved: false };
  stage.setPointerCapture(event.pointerId);
  stage.classList.add("dragging");
});

stage.addEventListener("pointermove", (event) => {
  if (dragging === null) return;
  const dx = event.clientX - dragging.x;
  const dy = event.clientY - dragging.y;
  if (!dragging.moved) {
    // Below the slop this is still a click candidate; past it the press becomes a pan, and the pan
    // keeps the whole travel from the press point (resetting the origin here would swallow the
    // first few pixels of every drag).
    if (Math.hypot(dx, dy) <= DRAG_SLOP) return;
    dragging.moved = true;
  }
  state.panX = dragging.panX + dx;
  state.panY = dragging.panY + dy;
  state.adjusted = true;
  applyTransform();
});

const stopDrag = (): void => {
  const selection = pressed;
  const travelled = dragging?.moved ?? false;
  dragging = null;
  pressed = null;
  stage.classList.remove("dragging");
  if (travelled) {
    lastPress = null;
    return;
  }
  if (selection === null) {
    // A click on the paper, not a pan: the reviewer is done with whatever was picked.
    lastPress = null;
    clearSelection();
    return;
  }
  const now = Date.now();
  const double =
    lastPress !== null &&
    lastPress.kind === selection.kind &&
    lastPress.id === selection.id &&
    now - lastPress.at < 350;
  lastPress = { kind: selection.kind, id: selection.id, at: now };
  state.selected = selection;
  state.definitionsOpen = false;
  hover(selection);
  paintHighlights(selection);
  renderBoards();
  renderInspector();
  if (double) showDefinitions();
};
stage.addEventListener("pointerup", stopDrag);
stage.addEventListener("pointercancel", stopDrag);

stage.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    // Zoom about the cursor: the point under it stays put, which is the only zoom that does not
    // make a reviewer hunt for the thing they were looking at.
    const box = stage.getBoundingClientRect();
    const cursorX = event.clientX - box.left;
    const cursorY = event.clientY - box.top;
    const factor = Math.exp(-event.deltaY * 0.0015);
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, state.zoom * factor));
    const ratio = next / state.zoom;
    state.panX = cursorX - (cursorX - state.panX) * ratio;
    state.panY = cursorY - (cursorY - state.panY) * ratio;
    state.zoom = next;
    state.adjusted = true;
    applyTransform();
  },
  { passive: false },
);

window.addEventListener("keydown", (event) => {
  if (event.key === "0") {
    fit();
    event.preventDefault();
  } else if (event.key === "+" || event.key === "=") {
    state.zoom = Math.min(MAX_ZOOM, state.zoom * 1.25);
    state.adjusted = true;
    applyTransform();
    event.preventDefault();
  } else if (event.key === "-") {
    state.zoom = Math.max(MIN_ZOOM, state.zoom / 1.25);
    state.adjusted = true;
    applyTransform();
    event.preventDefault();
  } else if (event.key === "Enter") {
    // A focused button owns Enter: the definition row must open its own file, not reopen the menu.
    if (event.target instanceof HTMLElement && event.target.closest("button") !== null) return;
    if (state.selected === null) return;
    showDefinitions();
    event.preventDefault();
  } else if (event.key === "Escape") {
    if (state.definitionsOpen) {
      state.definitionsOpen = false;
      renderInspector();
    } else {
      clearSelection();
    }
    event.preventDefault();
  } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    const current = board();
    if (current === undefined || current.pages.length < 2) return;
    const delta = event.key === "ArrowLeft" ? -1 : 1;
    state.page = (state.page + delta + current.pages.length) % current.pages.length;
    fit();
    renderAll();
    event.preventDefault();
  }
});

window.addEventListener("resize", () => {
  if (!state.adjusted) fit();
});

// --- boot ------------------------------------------------------------------------------------

function renderAll(): void {
  renderBoards();
  renderDiagnostics();
  renderStage();
  renderInspector();
}

renderAll();
// After the first stage render: before it there is no sheet to measure.
fit();
