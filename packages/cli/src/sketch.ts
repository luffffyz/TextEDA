// The sketch route's file side: a reviewer's freehand picture, written where the agent can read it.
//
// A sketch is a **message, not a design**: it never enters the IR, never changes a hash, and never
// lands in the project. It goes to a scratch directory, and the path is what the reviewer hands to
// the agent (ADR-0043 D5 — the gesture says *where*, and never *what*).
//
// The browser cannot write files, so it asks the server and the server writes — the same boundary
// the layout route has (ADR-0042 D9), with one difference: this file belongs to nobody's design.
//
// What lands is a pair: the picture, for the agent's eyes, and the ink's own millimetres beside
// it, for the agent's hands. A hand-drawn mark cannot say precisely where it points, so an agent
// that only had the picture would have to measure it to find out — which is the one thing the
// reviewer already knew and the one thing a freehand stroke cannot carry.
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  sketchFileName,
  sketchFileStem,
  sketchNotes,
  sketchNotesFileName,
  sketchNotesJson,
  type SketchInk,
} from "@texteda/viewer/sketch";

/**
 * Where the pictures go.
 *
 * `/tmp`, and not the project: a sketch is a note to the agent, and a note is not a record of the
 * design. It is meant to be read once and thrown away, not reviewed and not versioned.
 */
export const SKETCH_DIR = "/tmp/texteda-sketches";

/** How large a saved picture may be. A drawing's picture is a few hundred kilobytes. */
export const SKETCH_MAX_BYTES = 8_000_000;

/** A request the route cannot answer: the picture is missing, or is not a picture. */
export class SketchError extends Error {}

/** The PNG signature: every PNG file starts with it, and nothing else does. */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export interface SketchRequest {
  /** The drawing the picture is a sketch of, by its key (`symbol/<class>:<id>`). */
  readonly drawing: string;
  /** The drawing's kind. */
  readonly kind: string;
  /** The drawing's name. */
  readonly label: string;
  /** The picture, base64-encoded, as the browser sends it. */
  readonly png: string;
  /** The ink, in the drawing's own millimetres. */
  readonly ink: readonly SketchInk[];
  /** The project's build hash, when the project compiles. */
  readonly source_hash: string;
  /** The tool that writes the file. */
  readonly tool_version: string;
  /** When the sketch was saved. */
  readonly saved_at: string;
}

export interface SketchSaved {
  /** Where the picture landed. */
  readonly path: string;
  /** Where the ink's numbers landed, beside the picture. */
  readonly notes: string;
  /** The drawing it is a sketch of. */
  readonly drawing: string;
}

/** Decode the picture, and say so when it is not one. */
function decodePicture(png: string): Buffer {
  if (png === "") throw new SketchError("the picture is empty");
  const bytes = Buffer.from(png, "base64");
  if (bytes.length === 0) throw new SketchError("the picture is not a readable image");
  if (bytes.length > SKETCH_MAX_BYTES) throw new SketchError("the picture is too large");
  if (!PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) {
    throw new SketchError("the picture is not a PNG");
  }
  return bytes;
}

/**
 * The next number for this drawing's pictures.
 *
 * The number is the order the pictures were drawn in, so it is read off the folder: the highest
 * number already there plus one. A folder with a gap in its numbers keeps the gap — the numbers
 * are a history, not a counter to be reused.
 */
export function nextSketchIndex(dir: string, stem: string): number {
  if (!existsSync(dir)) return 1;
  const prefix = `${stem}-`;
  const suffix = ".png";
  let highest = 0;
  for (const name of readdirSync(dir)) {
    if (!name.startsWith(prefix) || !name.endsWith(suffix)) continue;
    const middle = name.slice(prefix.length, name.length - suffix.length);
    if (!/^\d+$/.test(middle)) continue;
    const index = Number(middle);
    if (index > highest) highest = index;
  }
  return highest + 1;
}

/**
 * Write the picture and the numbers, and say where they went.
 *
 * The names are the drawing's own name and the number of the picture, so a folder of sketches sorts
 * by what they are about (`led-1.png`, `led-2.png`) and the reviewer can say "the second one". The
 * numbers take the same stem and a `.json` suffix, so the pair is one thing with two faces.
 */
export function saveSketch(request: SketchRequest, dir: string = SKETCH_DIR): SketchSaved {
  const bytes = decodePicture(request.png);
  mkdirSync(dir, { recursive: true });
  const stem = sketchFileStem(request.drawing);
  const index = nextSketchIndex(dir, stem);
  const path = join(dir, sketchFileName(request.drawing, index));
  const notes = join(dir, sketchNotesFileName(request.drawing, index));
  writeFileSync(path, bytes);
  writeFileSync(
    notes,
    sketchNotesJson(
      sketchNotes({
        drawing: request.drawing,
        kind: request.kind,
        label: request.label,
        ink: request.ink,
        source_hash: request.source_hash,
        tool_version: request.tool_version,
        saved_at: request.saved_at,
      }),
    ),
  );
  return { path, notes, drawing: request.drawing };
}
