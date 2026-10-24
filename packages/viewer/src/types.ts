// The payload of the review app: what the CLI hands the browser (ADR-0021 decision 3).
//
// Two rules shape it. **Lengths are millimetres** as numbers, already divided by 1e6 from the IR's
// integer nanometres: the payload is a drawing, not a contract, and a consumer that wanted
// nanometres would be re-deriving a contract this file is not. **Identity is a string the reader can
// search for** (`U1`, `SIG_MID`), because the app's only job is to connect what is drawn to what is
// written — the file it came from is a path, and the line is a number.
//
// The page's SVG is a string: the renderer produced it from the view and the symbols, and the app
// adds behaviour around it rather than drawing again (ADR-0021: the viewer does not become a second
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
}

/** An instance of the board: what a click on its symbol reports beyond the refdes. */
export interface ReviewInstance {
  id: string;
  component: string;
  /** Parameter values as a person writes them (`10kΩ`, `±1%`, …), in the device's declared order. */
  params: string[];
  /** Net ids this instance has a pin on. */
  nets: string[];
  /** Source file of the board (the instance row lives there). */
  file: string;
}

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

/** What the page shows: the whole project, because a board is small and a fetch per page is slower. */
export interface ReviewModel {
  project: { name: string; root: string };
  /** IR project hash (`texteda ir`), when the project compiles; the drawing belongs to that build. */
  hash?: string;
  boards: ReviewBoard[];
  diagnostics: ReviewDiagnostic[];
}
