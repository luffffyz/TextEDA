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

/** The pen's line weight, in sheet millimetres — the same weight the drawings use. */
export const SKETCH_STROKE_WIDTH_MM = 0.25;

/** The pen's colour: grey, so it is never mistaken for the drawing's own ink. */
export const SKETCH_STROKE = "#7f7f7f";

/** One stroke: the points the pen passed through, in the drawing's own millimetres. */
export interface SketchStroke {
  readonly points: readonly { readonly x: number; readonly y: number }[];
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
