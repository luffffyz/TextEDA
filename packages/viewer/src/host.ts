// The seams between the review app and whatever hosts it.
//
// Two rules live here, because they are the two places where a host can change what the app
// does: how a refusal is read, and whose keys the app may take. Both are pure functions, so they
// can be tested without a browser (ADR-0142 D2, D9).

/**
 * The message a refusal carries.
 *
 * A host answers a write with a status and a body; the body may name one error, a list of them,
 * or nothing at all. The app shows one line, whichever it is.
 */
export function refusalMessage(payload: Record<string, unknown>): string {
  const errors = payload["errors"];
  const message =
    payload["error"] ??
    (Array.isArray(errors) ? errors.join("; ") : undefined) ??
    "the host refused the request";
  return String(message);
}

/**
 * The editor's unsaved text for a page, when there is one.
 *
 * A draft that is the same as the page the app knows is not an edit: sending it would write the
 * app's snapshot over whatever the file says now, which is the hazard this seam exists to avoid
 * in the other direction (F54). No draft and an unchanged draft both answer "nothing to send".
 */
export function unsavedSource(draft: string | null, source: string | undefined): string | undefined {
  if (draft === null) return undefined;
  if (draft === (source ?? "")) return undefined;
  return draft;
}

/**
 * Whether a key press belongs to a text field that is not ours.
 *
 * In a plugin the host has fields of its own — the chat input above all — and a key press there
 * is text for the host, not a command for the app. A key press inside our own root is ours, and
 * so is one that landed on something that is not a text field at all.
 */
export function isForeignEditable(target: EventTarget | null, root: Element): boolean {
  const element = target as Element | null;
  if (element === null || typeof element !== "object") return false;
  const closest = (element as { closest?: (selector: string) => Element | null }).closest;
  if (typeof closest !== "function") return false;
  if (root.contains(element)) return false;
  return closest.call(element, "input, textarea, select, [contenteditable]") !== null;
}
