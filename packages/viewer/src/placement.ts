/**
 * Layout placement uses a 0.5 mm grid for symbols and field anchors.
 *
 * The grid is the symbol pin lattice (ADR-0057): every pin connection point is a multiple of
 * 0.5 mm, so a symbol dropped on this grid keeps every pin reachable by a wire bend on the same
 * lattice. The view file's own coordinate resolution stays `0.01 mm` (`VIEW_GRID_NM` in the
 * parser): resolution and the review grid are different things.
 */
export const VIEW_GRID_MM = 0.5;

/** Snap a placement coordinate to the layout grid. */
export function snapPlacement(value: number): number {
  return Math.round(value / VIEW_GRID_MM) * VIEW_GRID_MM;
}
