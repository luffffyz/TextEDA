// What a host behind this document allows (ADR-0043 D3, D6), and what the current drawing offers.
//
// This helper is the one place the viewer decides what a person may enter, so it is pure: no
// DOM, no window, no state — the drawing and the host's answer are the only inputs, and the output
// is an ordered list of modes. The mode bar, which renders the buttons, is a shell: it only asks
// this function what may be offered and follows the canonical order.
import type { ReviewCapability, ReviewDrawing, ReviewMode } from "./types.ts";

/** The modes in the order the mode bar shows them: what the capability order is not allowed to set. */
export const REVIEW_MODE_ORDER: readonly ReviewMode[] = ["review", "layout", "edit"];

/**
 * The modes this drawing offers, in the canonical order (ADR-0048 D2).
 *
 * A print page can be moved and edited; a board canvas and a library drawing are read. The
 * `placement` mode is gone: the board's physical canvas is a drawing of its own now, and reading
 * it is what `review` does (ADR-0048 D3).
 */
function drawingModes(drawing: ReviewDrawing | undefined): ReviewMode[] {
  if (drawing === undefined) return ["review"];
  if (drawing.kind !== "sch") return ["review"];
  return ["review", "layout", "edit"];
}

/**
 * Resolve the modes a person may enter: the modes the drawing supports, minus whatever the host's
 * capability denies.
 *
 * With no capability the result is the drawing's own set. With a capability it is the intersection
 * of that set with `capability.modes`, and the canonical order is kept: a capability may remove a
 * mode, never add one the drawing does not support (ADR-0043 D3, D6).
 */
export function availableModes(
  drawing: ReviewDrawing | undefined,
  capability: ReviewCapability | undefined,
): ReviewMode[] {
  const supported = drawingModes(drawing);
  if (capability === undefined) return supported;
  const allowed = new Set(capability.modes);
  return supported.filter((mode) => allowed.has(mode));
}
