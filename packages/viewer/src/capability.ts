// What a host behind this document allows (ADR-0043 D3, D6).
//
// This helper is the one place the viewer decides what a person may enter, so it is pure: no
// DOM, no window, no state — the board and the host's answer are the only inputs, and the output
// is an ordered list of modes. The mode bar, which renders the buttons, is a shell: it only asks
// this function what may be offered and follows the canonical order.
import type { ReviewBoard, ReviewCapability, ReviewMode } from "./types.ts";

/** The modes in the order the mode bar shows them: what the capability order is not allowed to set. */
export const REVIEW_MODE_ORDER: readonly ReviewMode[] = ["review", "layout", "placement", "edit"];

/** The modes this board can show, in the canonical order (ADR-0042 D1). */
function boardModes(board: ReviewBoard | undefined): ReviewMode[] {
  const modes: ReviewMode[] = ["review"];
  if (board !== undefined && board.pages.length > 0) modes.push("layout");
  if (board?.pcb !== undefined) modes.push("placement");
  if (board !== undefined && board.pages.length > 0) modes.push("edit");
  return modes;
}

/**
 * Resolve the modes a person may enter: the modes the board supports, minus whatever the host's
 * capability denies.
 *
 * With no capability the result is the board's own set. With a capability it is the intersection
 * of that set with `capability.modes`, and the canonical order is kept: a capability may remove a
 * mode, never add one the board does not support (ADR-0043 D3, D6).
 */
export function availableModes(
  board: ReviewBoard | undefined,
  capability: ReviewCapability | undefined,
): ReviewMode[] {
  const supported = boardModes(board);
  if (capability === undefined) return supported;
  const allowed = new Set(capability.modes);
  return supported.filter((mode) => allowed.has(mode));
}
