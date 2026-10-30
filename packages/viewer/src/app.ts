// The review app: one page, no framework, no build step of its own (ADR-0035 decision 7).
//
// What it is allowed to do: show the SVG the renderer produced, add behaviour to it (hover, click,
// pan, zoom), and report what the page is made of. What it must not do: place symbols, move wires,
// or write anything back — the drawing is a function of (logic IR, view IR), and a viewer that
// adjusted it would become a second source of truth (ADR-0035, AGENTS.md §2 invariant 3).
//
// The app is mounted, not loaded: `mountReview(root, model, api)` hands it a place to draw, a
// model to draw, and a channel to ask its host for a write (ADR-0043 D2). The standalone page
// (`./client.ts`) and a plugin host both call it, and neither is the app's only caller.
import { definitionLocations, editorUri } from "./definitions.ts";
import { APP_ROOT_CLASS, APP_STYLES } from "./styles.ts";
import { availableModes, REVIEW_MODE_ORDER } from "./capability.ts";
import { refusalMessage, unsavedSource } from "./host.ts";
import type {
  ReviewBoard,
  ReviewDiagnostic,
  ReviewDrawing,
  ReviewDrawingKind,
  ReviewInstance,
  ReviewMode,
  ReviewModel,
  ReviewApi,
  ReviewPlace,
  ReviewSourceLocation,
  ReviewSymbol,
  ReviewText,
} from "./types.ts";

interface Highlight {
  readonly kind: "symbol" | "text";
  readonly id: string;
}

/** What the app draws: set by `mountReview`, never read before it. */
let model = undefined as unknown as ReviewModel;
/** Where the app asks for a write; set by `mountReview`. */
let api = undefined as unknown as ReviewApi;
/** The element the app draws into; set by `mountReview`. */
let root = undefined as unknown as HTMLElement;

/** Sheet millimetres → pixels: the sheet is shown at a fixed 4 px/mm before the user zooms. */
const PX_PER_MM = 4;
/** Findings shown before "show all": enough to act on, few enough to leave the drawing room. */
const DIAGNOSTIC_PREVIEW = 5;
/** Instances listed for a board with no print page: a board is a few dozen parts, not a library. */
const INSTANCE_PREVIEW = 60;
/**
 * The grid a placement snaps to: 1.27 mm, the 0.05 inch the pin pitch is made of. The view's own
 * grid is finer (0.01 mm); this one is the step a person can hit by eye (ADR-0042 D4).
 */
const SNAP_MM = 1.27;
let expanded = false;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 12;

/** A placement the layout mode has moved but not yet committed. */
interface PendingPlace {
  instance_id: string;
  x: number;
  y: number;
  rot: number;
}

/** The server's answer to a preview request: the page as it would be drawn. */
/**
 * The server's answer to a preview request: the page as it would be drawn.
 *
 * Three ways a write disturbs the drawing, because two write paths report different things: the
 * standalone server re-anchors the wires a move disturbs and reports what it could not keep
 * (`conflicts`) or had to put back (`reseated`); a host that may write only `place` rows writes no
 * wire at all and reports the nets whose wires went stale (`stale`), for `texteda view rewire` to
 * finish (ADR-0043 D10). The drawing is the same in every case; only the repair differs.
 */
interface Preview {
  svg: string;
  symbols: ReviewSymbol[];
  texts: ReviewText[];
  conflicts: string[];
  reseated: string[];
  stale: string[];
}

/** The mode bar's action buttons; they follow what the mode can do. */
let applyButton: HTMLButtonElement | undefined;
let revertButton: HTMLButtonElement | undefined;
let saveButton: HTMLButtonElement | undefined;

/**
 * What the app is showing right now. One per mount: a second mount starts fresh.
 */
interface AppState {
  /** The key of the drawing on the stage (ADR-0048). */
  drawing: string;
  zoom: number;
  panX: number;
  panY: number;
  selected: Highlight | null;
  /** The definition menu is open for the current selection (F34 source jump). */
  definitionsOpen: boolean;
  /**
   * The kind blocks the person folded, by key (`kind/symbol`).
   *
   * The tree re-renders on every selection, and a re-render that unfolded what the person closed
   * would make the sidebar unusable. The class blocks are not in here: they are hover reveals, and
   * their open state is the pointer's, not the app's.
   */
  folded: Set<string>;
  /** Set once the reviewer pans or zooms: a window resize must not undo their framing. */
  adjusted: boolean;
  /** Which of the app's four modes is showing (ADR-0042 D1). */
  mode: ReviewMode;
  /** The layout mode's moves: the instance id → where the user put it. */
  pending: Map<string, PendingPlace>;
  /** The server's preview of the pending moves, once it has answered. */
  preview: Preview | null;
  /** The edit mode's source, when it differs from the file. */
  draft: string | null;
  /** The edit mode's rendered draft. */
  draftSvg: string;
  draftErrors: string[];
  /** Where each row of the draft is, so a click on the drawing can put the cursor on it. */
  anchors: { key: string; kind: string; line: number }[];
}

/** The state a mount starts in: the first board, zoom 1, nothing selected, no moves pending. */
function initialState(): AppState {
  return {
    drawing: model.drawings[0]?.key ?? "",
    zoom: 1,
    panX: 0,
    panY: 0,
    selected: null,
    definitionsOpen: false,
    folded: new Set<string>(),
    adjusted: false,
    mode: "review",
    pending: new Map<string, PendingPlace>(),
    preview: null,
    draft: null,
    draftSvg: "",
    draftErrors: [],
    anchors: [],
  };
}

/** The state of the current mount; `mountReview` replaces it. Nothing reads it before then. */
let state = undefined as unknown as AppState;


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

/** The drawing on the stage right now. */
function drawing(): ReviewDrawing | undefined {
  return model.drawings.find((candidate) => candidate.key === state.drawing);
}

/**
 * The board the current drawing belongs to.
 *
 * A print page and a board canvas belong to a board; a library symbol or footprint belongs to
 * none, and the app says so rather than inventing one (ADR-0048 D2).
 */
function board(): ReviewBoard | undefined {
  const current = drawing();
  if (current?.board === undefined) return undefined;
  return model.boards.find((candidate) => candidate.id === current.board);
}

/** The instance behind a refdes, with the nets its pins land on. */
function instanceOf(id: string): ReviewInstance | undefined {
  return board()?.instances.find((candidate) => candidate.id === id);
}

function severityRank(diagnostic: ReviewDiagnostic): number {
  return diagnostic.severity === "error" ? 0 : diagnostic.severity === "warning" ? 1 : 2;
}

/** The edit mode's draft belongs to one page: another page starts from its own source. */
function resetDraft(): void {
  state.draft = null;
  state.draftSvg = "";
  state.draftErrors = [];
  state.anchors = [];
}

// --- the modes ------------------------------------------------------------------------------
//
// Three modes, one app (ADR-0042 D1, as ADR-0048 amends it). They share everything that finds a
// thing — the selection, the hover mark, the jump to its source — and differ only in what the stage
// shows and what a press means. A mode the current drawing cannot offer is not offered: only a
// print page can be laid out or edited, and a board canvas and a library drawing are read.

const MODE_LABEL: Record<ReviewMode, string> = {
  review: "Review",
  layout: "Layout",
  edit: "Edit",
};

/** What each mode is for, in one line, under the buttons. */
const MODE_HINT: Record<ReviewMode, string> = {
  review: "Read the drawing: hover, click, jump to the source.",
  layout: "Move the symbols of this page. Apply writes the page file.",
  edit: "The page's source, and the drawing of it.",
};

/** The modes this drawing and this host both allow (ADR-0043 D6). */
function modesFor(current: ReviewDrawing | undefined): ReviewMode[] {
  return availableModes(current, model.capability);
}

/**
 * Why a mode is not offered: the drawing's own limits first, then the host's.
 *
 * Only a print page can be laid out or edited; a board canvas and a library drawing are read, and
 * that is the project's fact. A mode the drawing has but the host does not grant is the host's
 * decision and says so (ADR-0043 D3).
 */
function missingReason(mode: ReviewMode): string {
  if (!availableModes(drawing(), undefined).includes(mode)) {
    return mode === "layout" || mode === "edit"
      ? "only a print page can be laid out or edited"
      : "this drawing has no such mode";
  }
  return `this host does not offer ${MODE_LABEL[mode].toLowerCase()}`;
}

function renderModes(): void {
  frame.modeBar.textContent = "";
  const available = modesFor(drawing());
  for (const mode of REVIEW_MODE_ORDER) {
    const button = el("button", "mode", MODE_LABEL[mode]);
    button.type = "button";
    button.title = MODE_HINT[mode];
    if (mode === state.mode) button.classList.add("active");
    if (!available.includes(mode)) {
      button.disabled = true;
      button.title = missingReason(mode);
    }
    button.addEventListener("click", () => {
      if (state.mode === mode) return;
      state.mode = mode;
      state.pending.clear();
      state.preview = null;
      state.draft = null;
      state.draftSvg = "";
      state.draftErrors = [];
      renderAll();
      // The fit comes after the redraw: the edit mode shows the source pane, which narrows the
      // stage, and a sheet fitted to the old stage would hang out of it.
      fit();
    });
    frame.modeBar.append(button);
  }
  if (state.mode === "layout") {
    const apply = el("button", "mode-action", "Apply");
    apply.type = "button";
    apply.addEventListener("click", () => {
      void applyPendingMoves();
    });
    const revert = el("button", "mode-action", "Revert");
    revert.type = "button";
    revert.title = "drop the moves (Escape)";
    revert.addEventListener("click", revertPendingMoves);
    applyButton = apply;
    revertButton = revert;
    frame.modeBar.append(apply, revert);
  }
  if (state.mode === "edit") {
    const save = el("button", "mode-action", "Save");
    save.type = "button";
    save.title = canWrite() ? "write the page file" : "this document cannot write";
    save.addEventListener("click", () => {
      void saveDraft();
    });
    saveButton = save;
    frame.modeBar.append(save);
  }
  frame.modeBar.append(el("span", "mode-hint", MODE_HINT[state.mode]));
  updateActions();
}

/** The buttons of the mode bar follow what the mode can do right now. */
function updateActions(): void {
  if (applyButton !== undefined) {
    applyButton.disabled = state.pending.size === 0 || !canWrite();
    applyButton.title = canWrite() ? "write the page file (Ctrl+Enter)" : "this document cannot write";
  }
  if (revertButton !== undefined) revertButton.disabled = state.pending.size === 0;
  if (saveButton !== undefined) saveButton.disabled = !canWrite();
}

// --- the frame -------------------------------------------------------------------------------
//
// The app is three columns: what a project is made of, the sheet, and the facts about whatever is
// under the cursor. No toolbar: a reviewer's hands stay on the drawing.

/**
 * The frame elements of one mount.
 *
 * They belong to a mount, not to the module: a host may mount the app more than once in one page
 * — two sidebar tabs, two sessions — and a second mount that reused the first one's nodes would
 * draw into a frame the first still owned.
 */
interface Frame {
  sidebar: HTMLElement;
  stageWrap: HTMLElement;
  inspector: HTMLElement;
  projectName: HTMLElement;
  projectHash: HTMLElement;
  boardList: HTMLElement;
  metricsBox: HTMLElement;
  diagSummary: HTMLElement;
  diagList: HTMLElement;
  stage: HTMLElement;
  canvas: HTMLElement;
  modeBar: HTMLElement;
  panes: HTMLElement;
  sourcePane: HTMLElement;
  sourceText: HTMLTextAreaElement;
  status: HTMLElement;
  inspectorTitle: HTMLElement;
  inspectorBody: HTMLElement;
}

/** The frame of the current mount; `buildShell` sets it. Nothing reads it before then. */
let frame = undefined as unknown as Frame;

/**
 * Build the frame and put it into the root the app was mounted into.
 *
 * The root belongs to the shell — the standalone app's page, or a plugin's element — and is
 * cleared first, because the shell may have left a placeholder in it.
 */
function buildShell(): void {
  const sidebar = el("aside", "sidebar");
  const stageWrap = el("main", "stage-wrap");
  const inspector = el("aside", "inspector");

  const projectName = el("div", "project-name", model.project.name);
  const projectHash = el(
    "div",
    "project-hash",
    model.hash === undefined ? "not compiled" : `build ${model.hash.slice(0, 12)}`,
  );
  sidebar.append(projectName, projectHash);

  const boardList = el("nav", "boards");
  sidebar.append(boardList);

  // What the current print page measures (spec/schematic-view.md §9.4): the findings say that
  // something is wrong, these say how much of the sheet it takes and how far it is.
  const metricsBox = el("div", "metrics");
  sidebar.append(metricsBox);

  const diagSummary = el("div", "diag-summary");
  const diagList = el("ol", "diagnostics");
  sidebar.append(el("h2", undefined, "Check"), diagSummary, diagList);

  const stage = el("div", "stage");
  const canvas = el("div", "canvas");
  stage.append(canvas);

  // The mode bar picks what the stage shows; the panes hold the stage and, in the edit mode, the
  // page's source next to it.
  const modeBar = el("div", "modes");
  const panes = el("div", "panes");
  const sourcePane = el("div", "source-pane");
  const sourceText = el("textarea", "source");
  sourceText.spellcheck = false;
  sourcePane.append(sourceText);
  panes.append(sourcePane, stage);
  stageWrap.append(modeBar, panes);

  const status = el("div", "status");
  stageWrap.append(status);

  const inspectorTitle = el("h2", undefined, "Nothing selected");
  const inspectorBody = el("div", "inspector-body", "Point at a symbol, a label or a port.");
  inspector.append(inspectorTitle, inspectorBody);

  root.textContent = "";
  root.append(sidebar, stageWrap, inspector);
  frame = {
    sidebar,
    stageWrap,
    inspector,
    projectName,
    projectHash,
    boardList,
    metricsBox,
    diagSummary,
    diagList,
    stage,
    canvas,
    modeBar,
    panes,
    sourcePane,
    sourceText,
    status,
    inspectorTitle,
    inspectorBody,
  };
  wireStage();
}

/**
 * Hook the stage's pointer and wheel input to this mount's frame.
 *
 * Nothing here lives past the mount: the handlers read `frame` and `state`, which `mountReview`
 * replaces, and the element they are attached to is the one this mount built.
 */
function wireStage(): void {
  // `pointerout` instead of `pointerleave` on the hotspots' account: see `awayFromStage`.
  frame.stage.addEventListener("pointerout", awayFromStage);
  frame.stage.addEventListener("pointerdown", onStagePointerDown);
  frame.stage.addEventListener("pointermove", onStagePointerMove);
  frame.stage.addEventListener("pointerup", stopDrag);
  frame.stage.addEventListener("pointercancel", stopDrag);
  // The placement mode reads the drawing, not the rows: a plain move reports the net under the
  // pointer while the stage is not being dragged.
  frame.stage.addEventListener("pointermove", onStageHover);
  frame.stage.addEventListener("wheel", onStageWheel, { passive: false });
  frame.sourceText.addEventListener("input", onSourceInput);
}

// --- navigation ------------------------------------------------------------------------------

/**
 * Make sure the drawing's kind block is not folded.
 *
 * A drawing can be chosen from somewhere other than the tree — the arrow keys, a finding's show
 * button — and a row inside a closed block is selected in no useful sense. The class blocks need no
 * work here: they are not folds but hovers, and the block holding the selected drawing stays open by
 * itself (`.reveal`), so its row is visible whether or not the pointer is on it.
 */
function revealDrawing(key: string): void {
  const target = model.drawings.find((candidate) => candidate.key === key);
  if (target !== undefined) state.folded.delete(`kind/${target.kind}`);
}

/**
 * One row of the tree: the drawing's name, and the board it belongs to when it has one.
 *
 * The row is a button whatever the drawing is — a print page, a board canvas, a symbol — so the
 * sidebar has one thing to press and one shape to style.
 */
function drawingRow(candidate: ReviewDrawing): HTMLElement {
  const button = el("button", "page-name");
  button.type = "button";
  if (candidate.key === state.drawing) button.classList.add("active");
  if (candidate.problems.length > 0) button.classList.add("problem");
  button.title = candidate.file;
  button.append(el("span", "row-name", candidate.label));
  if (candidate.board !== undefined) button.append(el("span", "row-note", candidate.board));
  button.addEventListener("click", () => {
    state.drawing = candidate.key;
    revealDrawing(candidate.key);
    resetDraft();
    fit();
    renderAll();
  });
  return button;
}

/**
 * A foldable block of the tree: a summary line and the rows under it.
 *
 * `<details>` is the boring way to fold: the browser owns the disclosure, the keyboard and the
 * accessibility, and the app only remembers what the person folded so a re-render does not undo it.
 */
function foldingBlock(key: string, label: string, count: number, rows: HTMLElement[]): HTMLElement {
  const node = el("details", "fold");
  node.open = !state.folded.has(key);
  // A toggle that came from the browser is the only thing that changes the folded set; the guard
  // against `open` being set here is that the handler states what the element says, so a stray event
  // re-states the same answer.
  node.addEventListener("toggle", () => {
    if (node.open) state.folded.delete(key);
    else state.folded.add(key);
  });
  const summary = el("summary", "group-title");
  summary.append(el("span", "group-name", label));
  summary.append(el("span", "group-count", String(count)));
  node.append(summary, ...rows);
  return node;
}

/**
 * A class block: the class's name, its count, and the drawings filed under it.
 *
 * This level is not a fold the person has to click: a project with forty passives would be forty
 * rows under one heading, so the block stays closed and opens while the pointer is on it (ADR-0048
 * D1). One gesture instead of two — the pointer is already there to pick a row — and nothing has to
 * be remembered or reset. `reveal` keeps the block of the *selected* drawing open, so a drawing
 * chosen from the arrow keys or a finding is never hidden behind a closed class.
 *
 * The title takes focus so the keyboard can walk into a closed class: it is not an action, and a
 * key on it does nothing — focusing it opens the rows, which is the whole of what a hover does.
 */
function classBlock(label: string, count: number, rows: HTMLElement[], reveal: boolean): HTMLElement {
  const node = el("div", "class-block");
  if (reveal) node.classList.add("reveal");
  const title = el("div", "group-title");
  title.tabIndex = 0;
  title.append(el("span", "group-name", label));
  title.append(el("span", "group-count", String(count)));
  const body = el("div", "class-rows");
  body.append(...rows);
  node.append(title, body);
  return node;
}

/**
 * The sidebar's tree: what the project is made of, grouped by what kind of thing it is.
 *
 * The drawings come first, in kind groups — print pages, board canvases, symbols, footprints —
 * because that is what a reviewer picks from (ADR-0048 D1). Symbols and footprints are filed by
 * their classification directory (ADR-0049), so those two kinds go one level further: a class
 * block that opens on hover (see `classBlock`).
 *
 * The kind blocks fold, and the fold is remembered per mount: re-rendering after a selection must
 * not unfold what the person closed.
 *
 * A board with no print page comes last, with the note that says why and the instances that are
 * still there to look at.
 */
function renderTree(): void {
  frame.boardList.textContent = "";

  const kinds: { title: string; kind: ReviewDrawingKind }[] = [
    { title: "Schematics", kind: "sch" },
    { title: "PCBs", kind: "pcb" },
    { title: "Symbols", kind: "symbol" },
    { title: "Footprints", kind: "footprint" },
  ];

  for (const kind of kinds) {
    const drawings = model.drawings.filter((candidate) => candidate.kind === kind.kind);
    if (drawings.length === 0) continue;
    // A classification directory inside a foldable kind; absent for print pages and board canvases,
    // which are one flat list under their board.
    const classified = drawings.some((candidate) => candidate.group !== undefined);
    const rows: HTMLElement[] = [];
    if (!classified) {
      rows.push(...drawings.map(drawingRow));
    } else {
      const groups = new Map<string, ReviewDrawing[]>();
      for (const candidate of drawings) {
        const group = candidate.group ?? "";
        groups.set(group, [...(groups.get(group) ?? []), candidate]);
      }
      // The model already arrives sorted by `<class>:<id>`, so the classes and their rows come out
      // sorted without a second ordering rule here.
      for (const [group, members] of groups) {
        rows.push(
          classBlock(
            group === "" ? "unclassified" : group,
            members.length,
            members.map(drawingRow),
            members.some((member) => member.key === state.drawing),
          ),
        );
      }
    }
    frame.boardList.append(foldingBlock(`kind/${kind.kind}`, kind.title, drawings.length, rows));
  }

  // The boards that have no print page: no drawing is not no design, and the board's instances are
  // still there to look at (ADR-0035 decision 6: report, never invent a layout).
  const bare = model.boards.filter(
    (candidate) => !model.drawings.some((entry) => entry.kind === "sch" && entry.board === candidate.id),
  );
  if (bare.length === 0) return;
  const bareRows: HTMLElement[] = [];
  for (const candidate of bare) {
    bareRows.push(
      el("div", "page-note", `${candidate.id}: ${candidate.note ?? "no view file: the board has no drawing"}`),
    );
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
        renderTree();
        renderInspector();
      });
      list.append(item);
    }
    if (candidate.instances.length > INSTANCE_PREVIEW) {
      list.append(el("div", "page-note", `… ${candidate.instances.length - INSTANCE_PREVIEW} more`));
    }
    bareRows.push(list);
  }
  frame.boardList.append(foldingBlock("kind/boards", "Boards", bare.length, bareRows));
}

/**
 * What the current print page measures, in the words the sidebar uses.
 *
 * The findings are binary — a label is on its net or it is not — and these are the other half of
 * the signal: how much of the sheet the drawing takes, how close the texts are, how much wire is
 * drawn (spec/schematic-view.md §9.4).
 */
function renderMetrics(): void {
  frame.metricsBox.textContent = "";
  const current = drawing();
  const metrics = current?.metrics;
  if (current === undefined || metrics === undefined) return;
  frame.metricsBox.append(el("h2", undefined, "Measurements"));
  const list = el("ul", "metric-list");
  const rows: [string, string][] = [
    ["content", `${(metrics.content_fill_ppm / 10000).toFixed(1)}% of the sheet`],
    [
      "text gap",
      metrics.text_min_gap_nm === undefined ? "one text" : `${(metrics.text_min_gap_nm / 1e6).toFixed(2)} mm`,
    ],
    ["wiring", `${(metrics.wire_total_nm / 1e6).toFixed(0)} mm`],
    ["crossings", `${metrics.wire_crossings}`],
  ];
  for (const [name, value] of rows) {
    const item = el("li");
    item.append(el("span", "metric-name", name));
    item.append(el("span", "metric-value", value));
    list.append(item);
  }
  frame.metricsBox.append(list);
}

/**
 * Where each identity sits, by place: the reverse of the model's identity index.
 *
 * The index is keyed by identity ("what is this?"), and a finding names a place ("where is it?").
 * This turns the second into the first. It is built once per model and dropped when the model is
 * replaced by a fresh one.
 */
let sourceIndex: Map<string, { key: string; kind: string }[]> | undefined;

function placesByLocation(): Map<string, { key: string; kind: string }[]> {
  if (sourceIndex !== undefined) return sourceIndex;
  const index = new Map<string, { key: string; kind: string }[]>();
  for (const [key, locations] of Object.entries(model.sources)) {
    for (const location of locations) {
      const at = `${location.file}:${location.line ?? 0}`;
      const list = index.get(at) ?? [];
      list.push({ key, kind: location.kind });
      index.set(at, list);
    }
  }
  sourceIndex = index;
  return index;
}

/** The object an identity names, as the app selects it. */
function highlightFor(key: string, kind: string): Highlight | undefined {
  const colon = key.indexOf(":");
  if (colon < 0) return undefined;
  const namespace = key.slice(0, colon);
  const rest = key.slice(colon + 1);
  const slash = rest.indexOf("/");
  const id = slash < 0 ? rest : rest.slice(slash + 1);
  if (namespace === "instance") return { kind: "symbol", id };
  if (namespace === "net" && kind === "view-label") return { kind: "text", id };
  if (namespace === "port" && kind === "view-port") return { kind: "text", id };
  return undefined;
}

/** The drawing that holds an object: the page that places the instance or draws the label. */
function holderOf(key: string, highlight: Highlight): ReviewDrawing | undefined {
  for (const location of model.sources[key] ?? []) {
    const drawing = model.drawings.find(
      (candidate) => candidate.kind === "sch" && candidate.file === location.file,
    );
    if (drawing === undefined) continue;
    const holds =
      (highlight.kind === "symbol" && drawing.symbols.some((symbol) => symbol.id === highlight.id)) ||
      (highlight.kind === "text" && drawing.texts.some((text) => (text.subject ?? text.text) === highlight.id));
    if (holds) return drawing;
  }
  return undefined;
}

/**
 * The object a finding is about, and the drawing that holds it.
 *
 * A finding names a place in a file. The identity index says which object sits at that place, and
 * the same index says where else that object appears — so a finding on a board row leads to the
 * page that draws the instance (ADR-0048 D5).
 */
function findingTarget(diagnostic: ReviewDiagnostic): { drawing: string; highlight: Highlight } | undefined {
  if (diagnostic.file === undefined) return undefined;
  const at = placesByLocation().get(`${diagnostic.file}:${diagnostic.line ?? 0}`);
  if (at === undefined) return undefined;
  for (const entry of at) {
    const highlight = highlightFor(entry.key, entry.kind);
    if (highlight === undefined) continue;
    const holder = holderOf(entry.key, highlight);
    if (holder === undefined) continue;
    return { drawing: holder.key, highlight };
  }
  return undefined;
}

function renderDiagnostics(): void {
  const counts = { error: 0, warning: 0, note: 0 };
  for (const diagnostic of model.diagnostics) counts[diagnostic.severity] += 1;
  frame.diagSummary.textContent = `${counts.error} errors · ${counts.warning} warnings · ${counts.note} notes`;
  frame.diagSummary.className = `diag-summary ${counts.error > 0 ? "has-error" : counts.warning > 0 ? "has-warning" : ""}`;

  frame.diagList.textContent = "";
  const sorted = [...model.diagnostics].sort((a, b) => severityRank(a) - severityRank(b));
  // The head of the list, then a button: a hundred findings in a frame.sidebar buries the drawing, and the
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
    // A finding that names an object can be taken to: the app selects the object on the drawing
    // that holds it, so the reviewer does not have to hunt for it on the sheet (ADR-0048 D5).
    const target = findingTarget(diagnostic);
    if (target !== undefined) {
      const jump = el("button", "diag-jump", "show");
      jump.type = "button";
      jump.title = "select this on the drawing";
      jump.addEventListener("click", () => {
        state.drawing = target.drawing;
        revealDrawing(target.drawing);
        resetDraft();
        fit();
        renderAll();
        state.selected = target.highlight;
        paintHighlights(target.highlight);
        renderInspector();
      });
      row.append(jump);
    }
    frame.diagList.append(row);
  }
  if (sorted.length === 0) frame.diagList.append(el("li", "diag-none", "nothing to report"));
  if (sorted.length > DIAGNOSTIC_PREVIEW) {
    const toggle = el("button", "diag-toggle", expanded ? "show fewer" : `show all ${sorted.length}`);
    toggle.type = "button";
    toggle.addEventListener("click", () => {
      expanded = !expanded;
      renderDiagnostics();
    });
    frame.diagList.append(toggle);
  }
}

// --- the sheet -------------------------------------------------------------------------------

/** The sheet's own coordinate system is millimetres; the frame.canvas is scaled from that. */
function applyTransform(): void {
  // Pan with a transform (cheap, and a moved layer stays sharp), zoom by resizing the SVG instead.
  // A CSS `scale()` would let the browser scale a rasterised copy of the sheet and re-rasterise it
  // afterwards, which is exactly the "blurry for a moment, then sharp" the reviewer sees; sizing the
  // SVG re-renders its vectors at the new size every time, so a zoom step is never blurry.
  frame.canvas.style.transform = `translate(${state.panX}px, ${state.panY}px)`;
  resizeSheet();
  padMarks();
}

/**
 * What the frame.stage shows right now: the drawing, its size, and the objects it holds.
 *
 * The mode decides which drawing it is: the page's own, the layout mode's preview of the page
 * after the pending moves, or the edit mode's drawing of the draft.
 */
function stageDrawing():
  | { svg: string; sheet: { w: number; h: number }; symbols: ReviewSymbol[]; texts: ReviewText[] }
  | undefined {
  const current = drawing();
  if (current === undefined) return undefined;
  if (state.mode === "edit") {
    return {
      svg: state.draftSvg !== "" ? state.draftSvg : current.svg,
      sheet: current.sheet,
      symbols: current.symbols,
      texts: current.texts,
    };
  }
  if (state.mode === "layout" && state.preview !== null) {
    return {
      svg: state.preview.svg,
      sheet: current.sheet,
      symbols: state.preview.symbols,
      texts: state.preview.texts,
    };
  }
  return { svg: current.svg, sheet: current.sheet, symbols: current.symbols, texts: current.texts };
}

/** What the drawing holds, in the words the status line uses. */
function drawnCount(current: ReviewDrawing, shown: { symbols: ReviewSymbol[] }): string {
  if (current.kind === "pcb") return `${current.parts?.length ?? 0} parts`;
  if (current.kind === "symbol") return "symbol";
  if (current.kind === "footprint") return "footprint";
  return `${shown.symbols.length} symbols`;
}

/** Give the sheet's SVG its size on screen; its viewBox stays in millimetres. */
function resizeSheet(): void {
  const svg = frame.canvas.querySelector<SVGSVGElement>(".sheet-svg");
  const current = stageDrawing();
  if (svg === null || current === undefined) return;
  const scale = PX_PER_MM * state.zoom;
  svg.setAttribute("width", `${current.sheet.w * scale}`);
  svg.setAttribute("height", `${current.sheet.h * scale}`);
}

function fit(): void {
  const current = stageDrawing();
  if (current === undefined) return;
  const { w, h } = current.sheet;
  const box = frame.stage.getBoundingClientRect();
  const margin = 32;
  const available = { w: Math.max(box.width - margin * 2, 80), h: Math.max(box.height - margin * 2, 80) };
  const scale = Math.min(available.w / (w * PX_PER_MM), available.h / (h * PX_PER_MM));
  state.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, scale));
  // Centre the sheet: the frame.canvas is in millimetres × PX_PER_MM × zoom, and its origin is the sheet's.
  const drawnW = w * PX_PER_MM * state.zoom;
  const drawnH = h * PX_PER_MM * state.zoom;
  state.panX = (box.width - drawnW) / 2;
  state.panY = (box.height - drawnH) / 2;
  state.adjusted = false;
  applyTransform();
}

/** What the frame.status line says about the page itself; hover replaces it and moving away restores it. */
let pageStatus = "";

function setStatus(text: string): void {
  pageStatus = text;
  frame.status.textContent = text;
}

/**
 * Draw the frame.stage.
 *
 * `keepSelection` is for the redraws that are not a change of subject: the layout mode redraws the
 * page when a symbol moves, and the selection has to survive that.
 */
function renderStage(keepSelection = false): void {
  frame.canvas.textContent = "";
  if (!keepSelection) {
    state.selected = null;
    state.definitionsOpen = false;
  }
  frame.status.classList.remove("error");
  frame.sourcePane.classList.toggle("hidden", state.mode !== "edit");
  const current = drawing();
  // A board canvas is picked by the drawing's own objects (a net's copper), so the page's hotspots
  // — which cover the page's symbols — must not swallow the click there. The edit mode keeps them:
  // its objects are the page's, and a hotspot resolves a 0402 as well as a QFP does.
  frame.stage.classList.toggle("picking", current?.kind === "pcb");

  if (current === undefined) {
    const note = board()?.note ?? "this project has no drawing to show";
    frame.stage.classList.add("empty");
    // The empty frame.stage says why it is empty rather than showing a black rectangle.
    frame.stage.dataset["empty"] = `${board()?.id ?? "this project"}\n${note}`;
    setStatus(note);
    renderInspector();
    return;
  }
  frame.stage.classList.remove("empty");
  delete frame.stage.dataset["empty"];

  if (current.problems.length > 0) {
    setStatus(`this drawing has no ink: ${current.problems.join("; ")}`);
    renderInspector();
    return;
  }

  if (state.mode === "edit") {
    renderEdit(current);
    return;
  }

  const shown = stageDrawing();
  if (shown === undefined) {
    setStatus("there is nothing to draw");
    return;
  }

  // The renderer's SVG is inserted as markup and then measured: the app adds hotspots on top of it
  // rather than drawing the sheet a second time.
  const holder = el("div", "sheet");
  holder.innerHTML = shown.svg;
  frame.canvas.append(holder);
  applyTransform();

  const svg = holder.querySelector("svg");
  if (svg === null) {
    setStatus("the renderer produced no SVG for this drawing");
    return;
  }
  pinchSheet(svg);
  overlay(svg, shown.symbols, shown.texts);
  if (state.mode === "layout" && state.preview === null) applyPending(svg);
  if (keepSelection) paintHighlights(state.selected);
  applyTransform();
  const pending = state.pending.size;
  setStatus(
    `${current.file} · ${shown.sheet.w} × ${shown.sheet.h} mm · ${drawnCount(current, shown)}` +
      (pending === 0 ? "" : ` · ${pending} moved, not applied`),
  );
}

/**
 * The layout mode's pending moves, drawn where the user put them.
 *
 * The renderer groups what belongs to one instance under `data-ref`, so a moved symbol is moved by
 * transforming its groups (ADR-0042 D2). The transform is the same one the renderer would have
 * applied: a turn about the old origin, then a move to the new one.
 */
function applyPending(svg: SVGSVGElement): void {
  for (const [id, place] of state.pending) {
    const from = placedPlaces().get(id);
    if (from === undefined) continue;
    const dx = place.x - from.x;
    const dy = place.y - from.y;
    const turn = place.rot - from.rot;
    const transform =
      turn === 0 ? `translate(${dx} ${dy})` : `translate(${dx} ${dy}) rotate(${turn} ${from.x} ${from.y})`;
    for (const group of svg.querySelectorAll<SVGGElement>("g[data-ref]")) {
      if (group.getAttribute("data-ref") !== `instance:${id}`) continue;
      group.setAttribute("transform", transform);
    }
  }
}

/** Where the page places each instance, as the page says it. */
function placedPlaces(): Map<string, ReviewPlace> {
  const out = new Map<string, ReviewPlace>();
  for (const place of drawing()?.places ?? []) out.set(place.instance_id, place);
  return out;
}

/** The edit mode: the page's source, and the drawing of exactly that text. */
function renderEdit(current: ReviewDrawing): void {
  if (state.draft === null) {
    state.draft = current.source ?? "";
    frame.sourceText.value = state.draft;
  }
  if (state.anchors.length === 0) {
    // The rows of the page are the server's to say: it parses the file and knows which line each
    // object came from. The first draw asks for them, so a click on the drawing can find its row.
    void refreshDraft();
  }
  const drawing = stageDrawing();
  if (drawing === undefined) {
    setStatus("there is nothing to draw");
    return;
  }
  const holder = el("div", "sheet");
  holder.innerHTML = drawing.svg;
  frame.canvas.append(holder);
  applyTransform();
  const svg = holder.querySelector("svg");
  if (svg === null) {
    setStatus("the renderer produced no SVG for this page");
    return;
  }
  pinchSheet(svg);
  // The same hotspots as the page modes: in `edit` a click is resolved by position, and the boxes
  // are what a person aims at (a 0402's ink is a 0.4 mm stroke).
  overlay(svg, drawing.symbols, drawing.texts);
  applyTransform();
  const errors = state.draftErrors;
  setStatus(
    errors.length === 0
      ? `${current.file} · the drawing is of the text on the left`
      : `${errors.length} errors in the text: ${errors[0]}`,
  );
  frame.status.classList.toggle("error", errors.length > 0);
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
 * The boxes are in millimetres and the frame.canvas is scaled, so a fixed millimetre padding would vanish
 * when zoomed out and swamp the drawing when zoomed in. The padding is therefore computed in screen
 * pixels and the marks are rewritten whenever the transform changes.
 */
function padMarks(): void {
  const scale = PX_PER_MM * state.zoom;
  const pad = MARK_PAD_PX / scale + INK_HALF_MM;
  const radius = 2 / scale;
  for (const mark of frame.canvas.querySelectorAll<SVGRectElement>(".mark")) {
    const bounds = markBounds.get(mark);
    if (bounds === undefined) continue;
    mark.setAttribute("x", `${bounds.x - pad}`);
    mark.setAttribute("y", `${bounds.y - pad}`);
    mark.setAttribute("width", `${bounds.w + pad * 2}`);
    mark.setAttribute("height", `${bounds.h + pad * 2}`);
    mark.setAttribute("rx", `${radius}`);
    // Stroke width is in millimetres too. `vector-effect: non-scaling-stroke` does not help here:
    // it compensates the SVG's own viewBox, not the CSS scale() on the frame.canvas around it, so a
    // "1.5 px" stroke would be 1.5 mm — a slug, not an outline.
    const px = mark.classList.contains("selected") ? MARK_STROKE_SELECTED_PX : MARK_STROKE_PX;
    mark.style.strokeWidth = `${px / scale}`;
  }
}

/** Hotspots for symbols and net texts, drawn in the sheet's own millimetres. */
function overlay(svg: SVGSVGElement, symbols: ReviewSymbol[], texts: ReviewText[]): void {
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
    // The hotspot also carries the drawing's identity, so a press resolved by position (`pickedAt`)
    // finds the object from its box and not only from its ink: the edit mode jumps to a row from
    // whatever was clicked, and a 0402's body is a 0.4 mm stroke (ADR-0042 D2, D7).
    rect.setAttribute("data-ref", `${highlight.kind === "symbol" ? "instance" : "text"}:${highlight.id}`);
    boxOf.set(rect, box);
    rect.addEventListener("mouseenter", () => {
      hover(highlight);
    });
    // The frame.stage captures the pointer to pan, so `click` never reaches this element: a press is
    // remembered here and turned into a selection on release when the pointer did not travel.
    rect.addEventListener("pointerdown", () => {
      pressed = highlight;
    });
    return rect;
  };

  const rows: SVGRectElement[] = [];
  for (const symbol of symbols) rows.push(hotspot(symbol.box, { kind: "symbol", id: symbol.id }));
  for (const text of texts) {
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
  if (state.mode === "edit") {
    // The edit mode's frame.status line reports the action — the row that was jumped to, and whether the
    // draft parses. The drawing is redrawn after a jump, which makes the browser enter the new
    // hotspot under the pointer and would otherwise overwrite that message with the object's facts.
    return;
  }
  const facts = highlight.kind === "symbol" ? instanceOf(highlight.id) : undefined;
  if (highlight.kind === "symbol") {
    frame.status.textContent =
      facts === undefined
        ? `${highlight.id}`
        : `${facts.id} · ${facts.component} · ${facts.nets.join(" ") || "no nets"}`;
  } else {
    frame.status.textContent = `net ${highlight.id}`;
  }
}

/** Keep the selected element marked while the pointer moves away from it. */
function paintHighlights(under: Highlight | null): void {
  const selected = state.selected;
  for (const node of frame.canvas.querySelectorAll<SVGRectElement>(".hotspot, .mark")) {
    const picked =
      selected !== null && node.dataset["kind"] === selected.kind && node.dataset["id"] === selected.id;
    const hovered = under !== null && node.dataset["kind"] === under.kind && node.dataset["id"] === under.id;
    node.classList.toggle("selected", picked);
    // A picked object keeps its selection look; hovering it again does not add a second outline.
    node.classList.toggle("hot", hovered && !picked);
  }
  padMarks();
}

/**
 * The pointer left the stage or a hotspot: drop the hover mark, keep the selection.
 *
 * `pointerout` fires on every pass from one hotspot to another, so the move only counts as "away"
 * when what is being entered is not a hotspot: otherwise the mark would blink between neighbours.
 * `relatedTarget` is absent when the pointer leaves the window, and absent is "away".
 */
function awayFromStage(event: PointerEvent): void {
  const entering = event.relatedTarget;
  if (entering instanceof Element && entering.closest(".hotspot") !== null) return;
  paintHighlights(null);
  frame.status.textContent = pageStatus;
}

/** Drop the selection and everything that showed it: the marks, the chips, the frame.inspector. */
function clearSelection(): void {
  if (state.selected === null) return;
  state.selected = null;
  state.definitionsOpen = false;
  paintHighlights(null);
  renderTree();
  renderInspector();
}

function locationsFor(selected: Highlight): ReviewSourceLocation[] {
  const facts = instanceOf(selected.id);
  const symbol = drawing()?.symbols.find((candidate) => candidate.id === selected.id);
  return definitionLocations({
    sources: model.sources,
    board: board()?.id ?? "",
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
  frame.inspectorBody.querySelector<HTMLButtonElement>(".definition-open")?.focus();
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
  frame.inspectorBody.append(toggle);
  if (!state.definitionsOpen) return;

  const locations = locationsFor(selected);
  if (locations.length === 0) {
    frame.inspectorBody.append(el("div", "muted", "no source location recorded for this identity"));
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
  frame.inspectorBody.append(list);
}

function renderInspector(): void {
  frame.inspectorBody.textContent = "";
  const selected = state.selected;
  if (selected === null) {
    frame.inspectorTitle.textContent = "Nothing selected";
    frame.inspectorBody.append(el("div", "muted", "Click a symbol, a label or a port."));
    return;
  }
  if (selected.kind === "text") {
    const net = board()?.nets.find((candidate) => candidate.id === selected.id);
    frame.inspectorTitle.textContent = `net ${selected.id}`;
    if (net === undefined) {
      frame.inspectorBody.append(el("div", "muted", "this text names nothing on the board"));
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
    frame.inspectorBody.append(el("div", "muted", `${net.members.length} pins`), list);
    appendDefinitions(selected);
    return;
  }

  frame.inspectorTitle.textContent = selected.id;
  const facts = instanceOf(selected.id);
  if (facts === undefined) {
    frame.inspectorBody.append(el("div", "muted", "the drawing places an instance the board does not list"));
    appendDefinitions(selected);
    return;
  }
  const definition = el("div", "definition");
  definition.append(el("span", "label", "device"), el("span", "value", facts.component));
  if (facts.symbol !== undefined) definition.append(el("span", "label", "symbol"), el("span", "value", facts.symbol));
  if (facts.footprint !== undefined) definition.append(el("span", "label", "footprint"), el("span", "value", facts.footprint));
  if (facts.params.length > 0) definition.append(el("span", "label", "spec"), el("span", "value", facts.params.join(" ")));
  definition.append(el("span", "label", "source"), el("span", "value", facts.file));
  frame.inspectorBody.append(definition);

  const nets = el("ul", "members");
  for (const netId of facts.nets) {
    const net = board()?.nets.find((candidate) => candidate.id === netId);
    const item = el("li");
    item.append(el("span", "net-name", netId));
    item.append(el("span", "pins", (net?.members ?? []).filter((m) => m.startsWith(`${facts.id}.`)).join(" ")));
    nets.append(item);
  }
  frame.inspectorBody.append(el("h3", undefined, "nets"), nets.children.length === 0 ? el("div", "muted", "no nets") : nets);
  appendDefinitions(selected);
}

// --- the server ------------------------------------------------------------------------------
//
// The browser asks; the server writes (ADR-0042 D9). The app never touches the file system, and a
// static export — a document with no server behind it — says so instead of pretending.

/** Whether this document was served by the CLI, and can therefore write. */
function canWrite(): boolean {
  return model.writable === true;
}

/** Ask the server to do something; the answer is JSON. */
async function postJson(path: string, body: unknown): Promise<Record<string, unknown>> {
  const answer = await api.post(path, body);
  if (answer.status < 200 || answer.status >= 300) {
    throw new Error(refusalMessage(answer.payload));
  }
  return answer.payload;
}

/** The moves the layout mode has pending, as the server wants them. */
function pendingPlaces(): { instance_id: string; x: number; y: number; rot: number }[] {
  return [...state.pending.values()].map((place) => ({
    instance_id: place.instance_id,
    x: place.x,
    y: place.y,
    rot: place.rot,
  }));
}

/**
 * The editor's unsaved text for this page, when there is one.
 *
 * Only a text that differs from the page the app knows is sent: an unchanged editor holds the
 * snapshot, and sending that would write the snapshot over whatever the file says now — the very
 * thing this fixes in the other direction (ADR-0042 D6).
 */
function unsavedDraft(current: ReviewDrawing): string | undefined {
  return unsavedSource(state.draft, current.source);
}

/**
 * Ask the server what the page would look like after the pending moves.
 *
 * The answer is the page with its wires re-anchored — not routed, re-anchored: the wires keep
 * their shape and get their corners back (ADR-0042 D5). Nothing is written.
 */
async function requestPreview(): Promise<void> {
  const places = pendingPlaces();
  if (places.length === 0) return;
  if (!canWrite()) {
    setStatus("this document cannot write: run `texteda review` to serve the app");
    return;
  }
  const current = drawing();
  if (current === undefined) return;
  try {
    const payload = await postJson("/api/layout", {
      board: board()?.id ?? "",
      page: current.page ?? "",
      places,
      commit: false,
      // The unsaved text is the base the layout is computed on, so the preview is the page that
      // would be written — the edit and the move together (ADR-0042 D6).
      ...(unsavedDraft(current) === undefined ? {} : { text: unsavedDraft(current) }),
    });
    state.preview = {
      svg: String(payload["svg"] ?? ""),
      symbols: (payload["symbols"] as ReviewSymbol[] | undefined) ?? [],
      texts: (payload["texts"] as ReviewText[] | undefined) ?? [],
      conflicts: (payload["conflicts"] as string[] | undefined) ?? [],
      reseated: (payload["reseated"] as string[] | undefined) ?? [],
      stale: (payload["stale"] as string[] | undefined) ?? [],
    };
    updateActions();
    renderStage(true);
    // A stale net is the places-only path's version of a conflict: the move happened, the wire no
    // longer reaches its pin, and `texteda view rewire` is what puts it back (ADR-0043 D10).
    const notes = [
      ...state.preview.conflicts,
      ...state.preview.reseated.map((note) => `${note} put back`),
      ...state.preview.stale.map((net) => `${net} wire stale: run \`texteda view rewire\``),
    ];
    setStatus(
      notes.length === 0
        ? "the page as it would be written: press Apply to write it"
        : `the page as it would be written · ${notes.join("; ")}`,
    );
  } catch (error) {
    setStatus(`the preview failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Write the pending moves: the page file changes, and nothing else does. */
async function applyPendingMoves(): Promise<void> {
  const places = pendingPlaces();
  if (places.length === 0) {
    setStatus("nothing to apply");
    return;
  }
  if (!canWrite()) {
    setStatus("this document cannot write: run `texteda review` to serve the app");
    return;
  }
  const current = drawing();
  if (current === undefined) return;
  const draft = unsavedDraft(current);
  try {
    const payload = await postJson("/api/layout", {
      board: board()?.id ?? "",
      page: current.page ?? "",
      places,
      commit: true,
      // The write is the editor's text with the moved rows applied: the edit is not thrown away
      // by the move (ADR-0042 D6).
      ...(draft === undefined ? {} : { text: draft }),
    });
    const next = payload["model"];
    if (next !== undefined) {
      model = next as ReviewModel;
      // The identity index changed with the model; the reverse of it must be rebuilt.
      sourceIndex = undefined;
    }
    state.pending.clear();
    state.preview = null;
    // The draft is on disk now, so it is no longer an unsaved edit; the editor shows what is
    // written.
    if (draft !== undefined) {
      state.draft = null;
      state.draftSvg = "";
      state.draftErrors = [];
      const written = drawing();
      if (written !== undefined) frame.sourceText.value = written.source ?? "";
    }
    renderAll();
    const conflicts = (payload["conflicts"] as string[] | undefined) ?? [];
    const stale = (payload["stale"] as string[] | undefined) ?? [];
    // A net that went stale is a wire the write did not touch: this host may write only `place`
    // rows, and the wire is `texteda view rewire`'s to put back (ADR-0043 D10).
    const repairs = [
      ...(conflicts.length === 0 ? [] : [`${conflicts.length} wire could not keep their shape`]),
      ...(stale.length === 0 ? [] : [`${stale.length} net stale: run \`texteda view rewire\``]),
    ];
    setStatus(
      repairs.length === 0
        ? `applied: ${places.length} symbol${places.length === 1 ? "" : "s"} moved, ${current.file} written`
        : `applied, but ${repairs.join("; ")}`,
    );
  } catch (error) {
    setStatus(`the apply failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Throw the pending moves away: the page is as it was on disk. */
function revertPendingMoves(): void {
  if (state.pending.size === 0) return;
  state.pending.clear();
  state.preview = null;
  updateActions();
  renderStage(true);
  setStatus("the moves were dropped");
}

// --- the edit mode ---------------------------------------------------------------------------

/** The edit mode's text changed: draw it again (the browser cannot parse a `.teda` file). */
let draftTimer: number | undefined;

function onSourceInput(): void {
  state.draft = frame.sourceText.value;
  state.draftErrors = [];
  clearTimeout(draftTimer);
  draftTimer = window.setTimeout(() => {
    void refreshDraft();
  }, 250);
}

/** The newest draft request: an answer to an older one is stale and is dropped. */
let draftTicket = 0;

/** Draw the draft and learn where its rows are. */
async function refreshDraft(): Promise<void> {
  const current = drawing();
  if (current === undefined || state.draft === null) return;
  if (!canWrite()) {
    setStatus("this document cannot draw a draft: it was exported without a server");
    return;
  }
  draftTicket += 1;
  const ticket = draftTicket;
  try {
    const payload = await postJson("/api/source", { file: current.file, text: state.draft, save: false });
    // Two requests can be in flight after a save redraws; the answer to the older one would draw
    // text the person has already replaced, so it is dropped.
    if (ticket !== draftTicket) return;
    state.draftErrors = (payload["errors"] as string[] | undefined) ?? [];
    state.anchors = (payload["anchors"] as { key: string; kind: string; line: number }[] | undefined) ?? [];
    const svg = String(payload["svg"] ?? "");
    // A draft that does not parse has no drawing; the last good one stays on the sheet.
    if (svg !== "") state.draftSvg = svg;
    renderStage(true);
  } catch (error) {
    if (ticket !== draftTicket) return;
    setStatus(`the draft could not be drawn: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Write the draft: the page file changes, in the formatter's form. */
async function saveDraft(): Promise<void> {
  const current = drawing();
  if (current === undefined || state.draft === null) return;
  if (!canWrite()) {
    setStatus("this document cannot write: run `texteda review` to serve the app");
    return;
  }
  try {
    const payload = await postJson("/api/source", { file: current.file, text: state.draft, save: true });
    const next = payload["model"];
    if (next !== undefined) {
      model = next as ReviewModel;
      // The identity index changed with the model; the reverse of it must be rebuilt.
      sourceIndex = undefined;
    }
    state.draft = null;
    state.draftSvg = "";
    state.draftErrors = [];
    state.anchors = [];
    renderAll();
    // The redraw of the saved text comes first, so that the message about the save is the last
    // thing the frame.status line says.
    await refreshDraft();
    setStatus(`saved: ${current.file}`);
  } catch (error) {
    setStatus(`the save failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Put the cursor on the row the drawing was clicked on. */
function jumpToRow(ref: string): void {
  const key = ref.includes(":") ? ref.slice(ref.indexOf(":") + 1) : ref;
  const anchor = state.anchors.find((candidate) => candidate.key === key);
  if (anchor === undefined) return;
  const lines = frame.sourceText.value.split("\n");
  let offset = 0;
  for (let index = 0; index < anchor.line - 1 && index < lines.length; index += 1) {
    offset += (lines[index]?.length ?? 0) + 1;
  }
  const text = lines[anchor.line - 1] ?? "";
  frame.sourceText.focus();
  frame.sourceText.setSelectionRange(offset, offset + text.length);
  setStatus(`${anchor.kind} row, line ${anchor.line}`);
}

/** Turn the selected symbol a quarter turn, in the layout mode. */
function rotateSelected(): void {
  if (state.mode !== "layout" || state.selected?.kind !== "symbol") return;
  const id = state.selected.id;
  const from = state.pending.get(id) ?? placedPlaces().get(id);
  if (from === undefined) return;
  const place: PendingPlace = { instance_id: id, x: from.x, y: from.y, rot: (from.rot + 90) % 360 };
  state.pending.set(id, place);
  state.preview = null;
  updateActions();
  renderStage(true);
  void requestPreview();
}

// --- input -----------------------------------------------------------------------------------

/** Pixels a pointer must travel before a press counts as a pan rather than a click. */
const DRAG_SLOP = 3;

let dragging: { x: number; y: number; panX: number; panY: number; moved: boolean } | null = null;
/** The hotspot under the pointer at press time; a press that does not travel selects it. */
let pressed: Highlight | null = null;
/** The previous click, for double-click detection on our own pointer-up selection. */
let lastPress: { kind: Highlight["kind"]; id: string; at: number } | null = null;
/** The symbol the layout mode is dragging: the press, the place it came from, and where it is. */
let symbolDrag: { id: string; from: ReviewPlace; start: { x: number; y: number }; moved: boolean } | null = null;

/** The pointer's place on the sheet, in the sheet's own millimetres. */
function sheetPoint(event: PointerEvent): { x: number; y: number } | undefined {
  const svg = frame.canvas.querySelector<SVGSVGElement>(".sheet-svg");
  const matrix = svg?.getScreenCTM();
  if (svg === null || matrix === undefined || matrix === null) return undefined;
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
  return { x: point.x, y: point.y };
}

/** A length on the 1.27 mm grid: the step a person can hit by eye. */
function snap(value: number): number {
  return Math.round(value / SNAP_MM) * SNAP_MM;
}

function onStagePointerDown(event: PointerEvent): void {
  if (event.button !== 0) return;
  dragging = { x: event.clientX, y: event.clientY, panX: state.panX, panY: state.panY, moved: false };
  frame.stage.setPointerCapture(event.pointerId);
  frame.stage.classList.add("dragging");
  // In the layout mode a press on a symbol is a drag of that symbol, not a pan (ADR-0042 D4).
  if (state.mode !== "layout" || pressed === null || pressed.kind !== "symbol") return;
  const from = placedPlaces().get(pressed.id);
  const start = sheetPoint(event);
  if (from === undefined || start === undefined) return;
  symbolDrag = { id: pressed.id, from, start, moved: false };
  // The preview answered the last move; it is stale the moment the symbol moves again.
  state.preview = null;
}

function onStagePointerMove(event: PointerEvent): void {
  if (symbolDrag !== null) {
    const point = sheetPoint(event);
    if (point === undefined) return;
    const dx = point.x - symbolDrag.start.x;
    const dy = point.y - symbolDrag.start.y;
    if (!symbolDrag.moved && Math.hypot(dx, dy) * PX_PER_MM * state.zoom <= DRAG_SLOP) return;
    symbolDrag.moved = true;
    const current = state.pending.get(symbolDrag.id) ?? symbolDrag.from;
    const place: PendingPlace = {
      instance_id: symbolDrag.id,
      x: snap(symbolDrag.from.x + dx),
      y: snap(symbolDrag.from.y + dy),
      rot: current.rot,
    };
    state.pending.set(symbolDrag.id, place);
    updateActions();
    applyPendingToCanvas();
    setStatus(`${symbolDrag.id} → ${place.x.toFixed(2)}, ${place.y.toFixed(2)} mm · not applied yet`);
    return;
  }
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
}

/** Draw the pending moves on the sheet that is on screen. */
function applyPendingToCanvas(): void {
  const svg = frame.canvas.querySelector<SVGSVGElement>(".sheet-svg");
  if (svg === null) return;
  applyPending(svg);
}

const stopDrag = (event: PointerEvent): void => {
  const selection = pressed;
  const travelled = dragging?.moved ?? false;
  const drag = symbolDrag;
  dragging = null;
  pressed = null;
  symbolDrag = null;
  frame.stage.classList.remove("dragging");
  if (drag !== null && drag.moved) {
    // The symbol was moved: ask the server what the page would look like, so the wires can be
    // re-anchored before anything is written (ADR-0042 D5).
    lastPress = null;
    void requestPreview();
    return;
  }
  if (travelled) {
    lastPress = null;
    return;
  }
  const current = drawing();
  if (current?.kind === "pcb" || state.mode === "edit") {
    // A board canvas and the edit mode work from the drawing, so the press is resolved by position:
    // the pointer capture the frame.stage takes for panning retargets the event.
    lastPress = null;
    const group = pickedAt(event.clientX, event.clientY);
    if (current?.kind === "pcb") {
      highlightNet(group?.getAttribute("data-net") ?? null);
      return;
    }
    const ref = group?.getAttribute("data-ref");
    if (ref !== null && ref !== undefined) jumpToRow(ref);
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
  renderTree();
  renderInspector();
  if (double) showDefinitions();
};


/**
 * The drawn object under a point of the screen.
 *
 * The frame.stage captures the pointer to pan, so the events that follow a press are retargeted to it:
 * what was clicked is resolved by position instead.
 */
function pickedAt(clientX: number, clientY: number): Element | null {
  const target = document.elementFromPoint(clientX, clientY);
  if (!(target instanceof Element)) return null;
  return target.closest("[data-ref], [data-net]");
}

/**
 * What the drawing itself was clicked on.
 *
 * The renderer gives every drawn object its identity (`data-ref`, `data-net`), so the readings that
 * are not about the page's rows can work from the drawing alone: a board canvas highlights a net,
 * the edit mode puts the cursor on the row the object came from (ADR-0042 D2).
 */
function onStageHover(event: PointerEvent): void {
  if (drawing()?.kind !== "pcb") return;
  const group = pickedAt(event.clientX, event.clientY);
  const net = group?.getAttribute("data-net");
  if (net === undefined || net === null) return;
  frame.status.textContent = `net ${net}`;
}

/** Light the copper of one net on the board's frame.canvas. */
function highlightNet(net: string | null): void {
  for (const group of frame.canvas.querySelectorAll<SVGGElement>("g[data-net]")) {
    const hot = net !== null && group.getAttribute("data-net") === net;
    group.classList.toggle("net-hot", hot);
  }
  setStatus(net === null ? "the board's copper" : `net ${net}`);
}

function onStageWheel(event: WheelEvent): void {
  event.preventDefault();
  // Zoom about the cursor: the point under it stays put, which is the only zoom that does not
  // make a reviewer hunt for the thing they were looking at.
  const box = frame.stage.getBoundingClientRect();
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
}

function onKeyDown(event: KeyboardEvent): void {
  // The edit mode's text field owns the keyboard while it has the focus: a key press there is
  // text, not a command.
  const inSource = event.target === frame.sourceText;
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
  } else if (event.key === "r" && !inSource) {
    // A quarter turn of the selected symbol, in the layout mode.
    rotateSelected();
    event.preventDefault();
  } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    // Apply: the page file is written (ADR-0042 D5: Apply is the commit point).
    void applyPendingMoves();
    event.preventDefault();
  } else if (event.key === "Enter") {
    // A focused button owns Enter: the definition row must open its own file, not reopen the menu.
    if (event.target instanceof HTMLElement && event.target.closest("button") !== null) return;
    if (inSource) return;
    if (state.selected === null) return;
    showDefinitions();
    event.preventDefault();
  } else if (event.key === "Escape") {
    if (state.definitionsOpen) {
      state.definitionsOpen = false;
      renderInspector();
    } else if (state.mode === "layout" && state.pending.size > 0) {
      revertPendingMoves();
    } else {
      clearSelection();
    }
    event.preventDefault();
  } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    if (inSource) return;
    // The arrows walk the drawings of the same kind: the print pages among themselves, the library
    // symbols among themselves (ADR-0048 D1).
    const current = drawing();
    if (current === undefined) return;
    const siblings = model.drawings.filter((candidate) => candidate.kind === current.kind);
    if (siblings.length < 2) return;
    const at = siblings.findIndex((candidate) => candidate.key === current.key);
    if (at < 0) return;
    const delta = event.key === "ArrowLeft" ? -1 : 1;
    const next = siblings[(at + delta + siblings.length) % siblings.length];
    if (next === undefined) return;
    state.drawing = next.key;
    revealDrawing(next.key);
    resetDraft();
    fit();
    renderAll();
    event.preventDefault();
  }
}

function onResize(): void {
  if (!state.adjusted) fit();
}

function renderAll(): void {
  renderTree();
  renderMetrics();
  renderDiagnostics();
  renderModes();
  renderStage();
  renderInspector();
}

// --- mounting --------------------------------------------------------------------------------

/** What a mounted app hands back to whoever mounted it. */
export interface ReviewHandle {
  /** Take the app off the page: the window listeners go, the frame stays where it is. */
  destroy(): void;
}

/**
 * Mount the review app.
 *
 * The root is where the app draws, the model is what it shows, and the api is how it asks its
 * host for a write — the standalone app's CLI routes, or a plugin's host half. The handle takes
 * the app off the window again, so a host that unmounts its surface gets its listeners back.
 */
export function mountReview(
  rootElement: HTMLElement,
  reviewModel: ReviewModel,
  reviewApi: ReviewApi,
): ReviewHandle {
  root = rootElement;
  model = reviewModel;
  api = reviewApi;
  state = initialState();
  expanded = false;
  // The root carries the class every rule in APP_STYLES is scoped to, so the app paints its own
  // frame and leaves the host's page alone. The stylesheet travels with the mount: a host that
  // unmounts the surface takes the rules with it.
  root.classList.add(APP_ROOT_CLASS);
  buildShell();
  const stylesheet = document.createElement("style");
  stylesheet.dataset.tedaReview = "app";
  stylesheet.textContent = APP_STYLES;
  root.prepend(stylesheet);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("resize", onResize);
  renderAll();
  // After the first stage render: before it there is no sheet to measure.
  fit();
  return {
    destroy(): void {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onResize);
      stylesheet.remove();
      root.classList.remove(APP_ROOT_CLASS);
    },
  };
}
