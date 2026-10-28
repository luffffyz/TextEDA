// The board image: the last shape-bearing structure before RS-274X / Excellon text (ADR-0117 D4).
//
// The writers serialize; they do not own geometry. By the time an image reaches them, every item is
// already a polygon, a stroked polyline, or a circular flash in board nanometres, so a serializer
// has no clipping, no offsetting and no notion of nets. Assembly — pcb IR plus pads plus the fill
// policy's output into these items — happens above this file.
//
// Determinism (ADR-0117 D5, invariant 18): the items carry no order of their own. A writer sorts
// them, so two runs over the same board cannot differ because a map iterated differently.
import type { Point, Polygon } from "@texteda/geom";

/** A filled area: one region contour in the Gerber file (G36 / G37). */
export interface RegionItem {
  kind: "region";
  shape: Polygon;
}

/** A stroked polyline: a trace centre line with its width, or the board edge, drawn round. */
export interface DrawItem {
  kind: "draw";
  width_nm: number;
  points: Polygon;
}

/** A circular flash: a via pad or a circular pad, without an outline to emit. */
export interface FlashItem {
  kind: "flash";
  diameter_nm: number;
  at: Point;
}

export type ImageItem = RegionItem | DrawItem | FlashItem;

/** One output layer's complete image: a copper layer, or `Edge.Cuts`. */
export interface ImageLayer {
  /** Layer name as the IR spells it: `F.Cu`, `B.Cu`, `Edge.Cuts`. */
  layer: string;
  items: readonly ImageItem[];
}

/** One drilled hole. */
export interface DrillHit {
  x_nm: number;
  y_nm: number;
  diameter_nm: number;
  /** A plated hole carries copper and is drilled after plating; a mounting hole is not. */
  plated: boolean;
}

/** The whole board: one image per output layer, plus its drills. */
export interface BoardImage {
  /** Board id, used as the file-name stem. */
  board: string;
  layers: readonly ImageLayer[];
  drills: readonly DrillHit[];
}

/** A file the writers produced: a name relative to the output directory, and its bytes. */
export interface ManufacturingFile {
  name: string;
  text: string;
}

/** What every file carries about the run that produced it (invariant 11). */
export interface ManufacturingStamp {
  /** The tool's version, e.g. `0.0.0`. Passed in: this package reads no package.json and no env. */
  tool_version: string;
  /** `source_hash` of the build the image was projected from, for traceability. */
  source_hash: string;
}
