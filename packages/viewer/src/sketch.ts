// The sketch overlay: a freehand pen on top of a drawing, for saying something to the agent that
// no coordinate can say.
//
// A sketch is a **message, not a design**. It never enters the IR, never changes a hash, never
// touches a source file: the reviewer draws on the picture, the app saves a picture, and the
// picture is read by the agent ([ADR-0043](adr/09-view/0043-the-review-app-is-a-plugin-of-the-agent-workbench.md)
// D5 — the gesture says *where*, and never *what*).
//
// The pen's line weight is the drawing's own (0.25 mm), so a stroke reads as part of the sheet
// rather than as a different kind of mark. The ink is grey, so nobody mistakes it for the symbol's
// own lines; the picture carries a caption that says what it is a sketch of.
//
// The saved sketch is a picture **and** the ink's own numbers, side by side: the picture is for
// the agent's eyes, the numbers are for its hands. Without them the agent has to measure the
// picture to find out where the reviewer pointed, which is the one thing the reviewer already
// knew and the one thing a hand-drawn mark cannot say precisely. The numbers are *where*, never
// *what*: they are the ink, in the drawing's own millimetres, and the agent still decides what
// to change.

/** The pen's line weight, in sheet millimetres — the same weight the drawings use. */
export const SKETCH_STROKE_WIDTH_MM = 0.25;

/** The pen's colour: grey, so it is never mistaken for the drawing's own ink. */
export const SKETCH_STROKE = "#7f7f7f";

/** One stroke: the points the pen passed through, in the drawing's own millimetres. */
export interface SketchStroke {
  readonly points: readonly { readonly x: number; readonly y: number }[];
}

/**
 * The ink as plain numbers, the shape it travels in.
 *
 * One stroke is one list of points; a point is `[x, y]` in the drawing's own millimetres.
 */
export interface SketchInk {
  readonly points: readonly (readonly [number, number])[];
}

/** The ink, in the shape the host takes it. */
export function sketchInk(strokes: readonly SketchStroke[]): SketchInk[] {
  return strokes.map((stroke) => ({
    points: stroke.points.map((point): readonly [number, number] => [point.x, point.y]),
  }));
}

/**
 * The drawing kinds the pen is offered on.
 *
 * A library symbol is the first one: it is a drawing of geometry the agent owns, the reviewer can
 * see something wrong with it ("this triangle should be sharper"), and no coordinate can say it.
 */
export function canSketch(kind: string | undefined): boolean {
  return kind === "symbol";
}

/** The path data of every stroke, as one path. */
export function sketchPathData(strokes: readonly SketchStroke[]): string {
  const parts: string[] = [];
  for (const stroke of strokes) {
    const [first, ...rest] = stroke.points;
    if (first === undefined) continue;
    parts.push(`M ${first.x} ${first.y}${rest.map((point) => ` L ${point.x} ${point.y}`).join("")}`);
  }
  return parts.join(" ");
}

/**
 * The overlay markup, to be drawn over the sheet.
 *
 * One path for the whole sketch, so the picture carries one object rather than one per stroke.
 */
export function sketchOverlayMarkup(strokes: readonly SketchStroke[]): string {
  const data = sketchPathData(strokes);
  if (data === "") return "";
  return (
    `<g class="sketch-ink" fill="none" stroke="${SKETCH_STROKE}" stroke-width="${SKETCH_STROKE_WIDTH_MM}"` +
    ` stroke-linecap="round" stroke-linejoin="round"><path d="${data}"/></g>`
  );
}

/**
 * What the picture says about itself.
 *
 * A picture without a caption is a riddle: the agent cannot tell which drawing it is a sketch of,
 * so the caption names the kind, the drawing, and the day.
 */
export function sketchCaption(kind: string, label: string, when: string): string {
  return `${kind} · ${label} · ${when}`;
}

/**
 * The stem of a sketch's file name: the drawing's own name, flattened.
 *
 * The drawing's name comes first, so a folder of sketches sorts by what they are about. The stem is
 * what the host matches on to number the next picture of the same drawing.
 */
export function sketchFileStem(drawingKey: string): string {
  const name = drawingKey
    .replace(/^symbol\//, "")
    .replace(/^footprint\//, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return name === "" ? "sketch" : name;
}

/**
 * The file name a saved sketch gets.
 *
 * The number keeps the order the pictures were drawn in.
 */
export function sketchFileName(drawingKey: string, index: number): string {
  return `${sketchFileStem(drawingKey)}-${index}.png`;
}

/** The name of the file that carries a sketch's numbers, next to its picture. */
export function sketchNotesFileName(drawingKey: string, index: number): string {
  return `${sketchFileStem(drawingKey)}-${index}.json`;
}

/**
 * What the sidecar says about a sketch.
 *
 * It is the picture's own facts and nothing else: which drawing the ink is on, the ink itself,
 * and enough to say which build it was drawn on. There is no "what to change" field, because
 * that is the agent's decision and not the reviewer's.
 */
export interface SketchNotes {
  /** The drawing's key in the model (`symbol/<class>:<id>`). */
  readonly drawing: string;
  /** The drawing's kind. */
  readonly kind: string;
  /** The drawing's name. */
  readonly label: string;
  /** The space the ink is measured in. */
  readonly space: string;
  /** The ink, in that space. */
  readonly strokes: readonly SketchInk[];
  /** The project's build hash, when the project compiles. */
  readonly source_hash: string;
  /** The tool that wrote the file. */
  readonly tool_version: string;
  /** When the sketch was saved. */
  readonly saved_at: string;
}

/** The space the ink is measured in: the drawing's own source frame, in millimetres. */
export const SKETCH_SPACE = "source-millimetres";

/** How far the ink's numbers are rounded, in millimetres — a micrometre. */
const SKETCH_NOTE_PRECISION = 1000;

/** The ink, rounded to the micrometre: the sidecar is read, not measured. */
function notePoints(ink: readonly SketchInk[]): { points: [number, number][] }[] {
  return ink.map((stroke) => ({
    points: stroke.points.map(([x, y]) => [
      Math.round(x * SKETCH_NOTE_PRECISION) / SKETCH_NOTE_PRECISION,
      Math.round(y * SKETCH_NOTE_PRECISION) / SKETCH_NOTE_PRECISION,
    ]),
  }));
}

/**
 * Whether a drawing's own source has y pointing up.
 *
 * A symbol follows the KiCad convention (+x right, +y up); a footprint and a print page follow the
 * PCB and sheet conventions (+y down). The drawing on the screen is always y-down — that is what
 * SVG is — so the ink has to be turned back before it is written down.
 */
export function sourceYIsUp(kind: string): boolean {
  return kind === "symbol";
}

/**
 * The ink in the drawing's own source frame.
 *
 * The numbers are written down in the frame the file uses, so they drop straight into the source
 * the agent is about to edit: no sign to remember, no offset to subtract. The picture is not
 * affected — it is drawn from the SVG, where the ink already sits where it belongs.
 */
export function sketchSourceInk(kind: string, strokes: readonly SketchStroke[]): SketchInk[] {
  const up = sourceYIsUp(kind);
  return sketchInk(strokes).map((stroke) => ({
    points: stroke.points.map(([x, y]): readonly [number, number] => (up ? [x, -y] : [x, y])),
  }));
}

/**
 * The sidecar: the sketch's facts, as the file the agent reads beside the picture.
 *
 * It is written with the keys in a fixed order and the ink rounded to the micrometre, so the file
 * is stable to read and to diff.
 */
export function sketchNotes(input: {
  readonly drawing: string;
  readonly kind: string;
  readonly label: string;
  readonly ink: readonly SketchInk[];
  readonly source_hash: string;
  readonly tool_version: string;
  readonly saved_at: string;
}): SketchNotes {
  return {
    drawing: input.drawing,
    kind: input.kind,
    label: input.label,
    space: SKETCH_SPACE,
    strokes: notePoints(input.ink),
    source_hash: input.source_hash,
    tool_version: input.tool_version,
    saved_at: input.saved_at,
  };
}

/** The sidecar, as the text of the file. */
export function sketchNotesJson(notes: SketchNotes): string {
  // Written by hand rather than by `JSON.stringify`, because the file is read by a person and by
  // an agent: one stroke on one line, with its points side by side, is a thing you can read at a
  // glance. It is still JSON, and it parses to exactly `notes`.
  const fields: [string, string][] = [
    ["drawing", notes.drawing],
    ["kind", notes.kind],
    ["label", notes.label],
    ["space", notes.space],
  ];
  const lines = fields.map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)}`);
  const strokes = notes.strokes.length === 0
    ? "  \"strokes\": []"
    : `  "strokes": [\n${notes.strokes
      .map((stroke) => `    { "points": [${stroke.points.map(([x, y]) => `[${x}, ${y}]`).join(", ")}] }`)
      .join(",\n")}\n  ]`;
  const tail: [string, string][] = [
    ["source_hash", notes.source_hash],
    ["tool_version", notes.tool_version],
    ["saved_at", notes.saved_at],
  ];
  const tailLines = tail.map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)}`);
  return `{\n${[...lines, strokes, ...tailLines].join(",\n")}\n}\n`;
}

/**
 * The picture: the drawing with the pen's ink on top.
 *
 * The overlay goes in at the end of the document, so the ink is painted over the drawing rather
 * than under it.
 */
export function sketchSvg(drawingSvg: string, strokes: readonly SketchStroke[]): string {
  const markup = sketchOverlayMarkup(strokes);
  if (markup === "") return drawingSvg;
  const close = drawingSvg.lastIndexOf("</svg>");
  if (close < 0) return drawingSvg;
  return `${drawingSvg.slice(0, close)}${markup}${drawingSvg.slice(close)}`;
}
