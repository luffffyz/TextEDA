// The payload of the review app: what the CLI hands the browser (ADR-0134 decision 7).
//
// Two rules shape it. **Lengths are millimetres** as numbers, already divided by 1e6 from the IR's
// integer nanometres: the payload is a drawing, not a contract, and a consumer that wanted
// nanometres would be re-deriving a contract this file is not. **Identity is a string the reader can
// search for** (`U1`, `SIG_MID`), because the app's only job is to connect what is drawn to what is
// written — the file it came from is a path, and the line is a number.
//
// The page's SVG is a string: the renderer produced it from the view and the symbols, and the app
// adds behaviour around it rather than drawing again (ADR-0134: the viewer does not become a second
// renderer).

/** A rectangle on the sheet, in millimetres, origin at the sheet's top-left (SVG orientation). */
export interface ReviewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A placed instance, as the drawing sees it: the refdes, and where its body sits. */
export interface ReviewSymbol {
  /** Instance id (refdes, `M1.R1` for a module instance) — the identity a click reports. */
  id: string;
  box: ReviewBox;
  /** Pin connection points by pin number, in sheet millimetres. */
  pins: Record<string, { x: number; y: number }>;
}

/** A text on the sheet: a net label, a port tag, or a note. */
export interface ReviewText {
  kind: "label" | "port" | "text";
  text: string;
  /** The net a label names or the port id a tag shows; absent for a note. */
  subject?: string;
  box: ReviewBox;
}

/**
 * The modes the app offers (ADR-0141 D1).
 *
 * `review` reads, `layout` moves symbols on a print page, `placement` shows the board's physical
 * canvas, `edit` shows the page's source. They share one highlight and one jump: the mode decides
 * what the stage shows and what a press means, not how a thing is found.
 */
export type ReviewMode = "review" | "layout" | "placement" | "edit";

/** What the host behind this document allows (ADR-0142 D3, D6). */
export interface ReviewCapability {
  /** The modes the person may enter, in the order the mode bar shows them. */
  modes: ReviewMode[];
  /**
   * What a write may touch: `places` — the page's `place` rows only, the plugin's write
   * (ADR-0142 D3); `layout` — the whole layout, the standalone app's write (ADR-0141 D3).
   */
  write: "places" | "layout";
}

/** Where a symbol sits on a print page: the page's own millimetres and a turn in whole quadrants. */
export interface ReviewPlace {
  /** Instance id (`M2.C1`). */
  instance_id: string;
  x: number;
  y: number;
  /** Degrees, clockwise: 0, 90, 180 or 270. */
  rot: number;
}

/** A part the board places, in board millimetres. */
export interface ReviewPcbPart {
  instance_id: string;
  x: number;
  y: number;
  rot: number;
  side: "top" | "bottom";
  /** Footprint reference (`lib:id`), when the part's device names one. */
  footprint?: string;
}

/** The board's physical canvas: what the placement mode shows. */
export interface ReviewPcb {
  /** Source file of the board description, relative to the project root. */
  file: string;
  /** Board size in millimetres (the outline's bounding box). */
  sheet: { w: number; h: number };
  /** The renderer's SVG, verbatim. Empty when the board could not be drawn. */
  svg: string;
  parts: ReviewPcbPart[];
  /** Why the board has no canvas. Empty when it has one. */
  problems: string[];
}

/** One print page, ready to show. */
export interface ReviewPage {
  /** Print page id (`views/<board>/<page>.view.teda`). */
  id: string;
  /** Source file of the view, relative to the project root. */
  file: string;
  /** Sheet size in millimetres. */
  sheet: { w: number; h: number };
  /** The renderer's SVG, verbatim. Empty when the page could not be drawn. */
  svg: string;
  symbols: ReviewSymbol[];
  texts: ReviewText[];
  /** Why the page has no drawing. Empty when it has one. */
  problems: string[];
  /** The page's source, verbatim: what the edit mode shows and edits. */
  source?: string;
  /** Where the page's symbols sit: what the layout mode moves. */
  places?: ReviewPlace[];
}

/** One instance of the board: what a click on its symbol reports beyond the refdes. */
export interface ReviewInstance {
  id: string;
  component: string;
  /** Symbol reference (`lib:id`) the component points at, when it declares one. */
  symbol?: string;
  /** Footprint reference (`lib:id`) the component points at, when it declares one. */
  footprint?: string;
  /** Parameter values as a person writes them (`10kΩ`, `±1%`, …), in the device's declared order. */
  params: string[];
  /** Net ids this instance has a pin on. */
  nets: string[];
  /** Source file of the board (the instance row lives there). */
  file: string;
}

/** What a definition location names: the record a reviewer can open. */
export type ReviewSourceKind =
  | "instance"
  | "net"
  | "port"
  | "component"
  | "component-pin"
  | "symbol"
  | "footprint"
  | "view-place"
  | "view-wire"
  | "view-label"
  | "view-port"
  | "pcb-place";

/** One place an identity is defined or used, as a source location (ADR-0103 D6). */
export interface ReviewSourceLocation {
  kind: ReviewSourceKind;
  /** Human label for the definition menu (`sch instance row`, `view place (buck-5v)`, …). */
  label: string;
  /** Path relative to the project root. */
  file: string;
  line: number;
  col: number;
}

/** Identity key → locations. Keys are namespaced (`instance:<board>/<id>`, `component:<id>`). */
export type ReviewSources = Record<string, ReviewSourceLocation[]>;

/** A net of the board, with the pins it joins (`U1.7`). */
export interface ReviewNet {
  id: string;
  members: string[];
}

/** One board: its pages and the facts a page cannot repeat (the board has one netlist). */
export interface ReviewBoard {
  id: string;
  /** Source file of the board, relative to the project root. */
  file: string;
  pages: ReviewPage[];
  instances: ReviewInstance[];
  nets: ReviewNet[];
  /** The board's physical canvas; absent when the board has no `pcb` description. */
  pcb?: ReviewPcb;
  /** Why the board has no pages (no view file at all), or why it could not be read. */
  note?: string;
}

/** One diagnostic, flattened for the browser (`texteda check`'s payload). */
export interface ReviewDiagnostic {
  code: string;
  severity: "error" | "warning" | "note";
  message: string;
  hint?: string;
  file?: string;
  line?: number;
  col?: number;
}

/**
 * The host's answer to a write.
 *
 * The status is kept, not just the payload: a refusal is a status with a message in it, and the
 * app reads the message the same way whichever host it is mounted in.
 */
export interface ReviewAnswer {
  /** The host's status code. */
  readonly status: number;
  /** The host's JSON answer. */
  readonly payload: Record<string, unknown>;
}

/**
 * How the client half asks its host to write.
 *
 * The standalone app posts to the CLI's two routes; a plugin asks its own host half. The client
 * half names the route and hands over the body, and knows nothing else about the host
 * (ADR-0142 D2, D9).
 */
export interface ReviewApi {
  /** Post a JSON body to one of the host's routes. */
  post(path: string, body: unknown): Promise<ReviewAnswer>;
}

/** What the page shows: the whole project, because a board is small and a fetch per page is slower. */
export interface ReviewModel {
  project: { name: string; root: string };
  /**
   * Whether the app may write through the server that served this document. A static export
   * (`texteda review --out`) has no server behind it and cannot write (ADR-0141 D9).
   */
  writable?: boolean;
  /** IR project hash (`texteda ir`), when the project compiles; the drawing belongs to that build. */
  hash?: string;
  boards: ReviewBoard[];
  diagnostics: ReviewDiagnostic[];
  /** Identity → source locations (ADR-0103 D6); advisory, derived from the same parse as the IR. */
  sources: ReviewSources;
  /**
   * What the host behind this document allows. Absent means the standalone app's full set: every
   * mode the board supports, and the whole layout as the write (ADR-0142 D3, D6).
   */
  capability?: ReviewCapability;
}
