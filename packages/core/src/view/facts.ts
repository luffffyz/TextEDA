// The geometry facts the drawing checks and metrics read (spec/schematic-view.md §9.2).
//
// The shapes mirror `packages/renderer`'s `schematicGeometry` output field for field: the renderer
// computes them with the same transforms and stroke-font metrics as the drawing itself, and the CLI
// hands them over structurally. Declaring them here (rather than importing the renderer) keeps
// `core` free of any drawing dependency — the two packages agree by shape, checked at the handoff.
export interface ReadabilityBox {
  readonly min_x_nm: number;
  readonly min_y_nm: number;
  readonly max_x_nm: number;
  readonly max_y_nm: number;
}

export interface ReadabilityText {
  /** `label` and `port` carry a net (or a port id) and must sit on it; `text` is an annotation. */
  readonly kind: "label" | "port" | "text";
  readonly text: string;
  /** The anchor point: the label's position, the port's tip, the note's start. */
  readonly x_nm: number;
  readonly y_nm: number;
  readonly box: ReadabilityBox;
  readonly line?: number;
  /** The net a label names, or the board port a tag shows. */
  readonly subject?: string;
}

export interface ReadabilitySymbol {
  readonly instance_id: string;
  readonly box: ReadabilityBox;
  readonly pins: ReadonlyMap<string, { readonly x_nm: number; readonly y_nm: number }>;
}

export interface ReadabilityGeometry {
  readonly texts: readonly ReadabilityText[];
  readonly symbols: readonly ReadabilitySymbol[];
}
