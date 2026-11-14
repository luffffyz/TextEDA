// The keyboard hint that sits in the sheet's top-left corner.
//
// The hint's whole claim is that it names the keys that answer *now*. A hint that names a dead key
// teaches the wrong thing, so the list is derived from the state rather than written out — and the
// derivation is a pure function, so that claim can be checked without a browser.
import { describe, expect, test } from "bun:test";
import { keyHints, moveStatus, type KeyHintState } from "../src/app.ts";

/** A state with nothing selected, on a schematic page, with a host that may write. */
function state(overrides: Partial<KeyHintState> = {}): KeyHintState {
  return {
    drawingKind: "sch",
    selected: null,
    moving: false,
    canWriteFull: true,
    fieldIsManual: false,
    keysOpen: true,
    sketch: { armed: false, strokes: 0 },
    ...overrides,
  };
}

/** The keys the hint names, in order. */
function keys(of: KeyHintState): string[] {
  return keyHints(of).map((hint) => hint.key);
}

describe("the hint names the keys that answer right now", () => {
  test("with nothing selected it offers no selection-only key", () => {
    expect(keys(state())).not.toContain("M");
    expect(keys(state())).not.toContain("R");
    expect(keys(state())).not.toContain("Enter");
    expect(keys(state())).not.toContain("Esc");
  });

  test("the keys that always answer are always there", () => {
    expect(keys(state())).toEqual(expect.arrayContaining(["0", "+", "-", "←/→", "?"]));
  });

  test("a selected symbol adds the keys that act on it", () => {
    const hints = keys(state({ selected: { kind: "symbol", id: "M2.C1" } }));
    expect(hints).toContain("Enter");
    expect(hints).toContain("M");
    expect(hints).toContain("R");
    expect(hints).toContain("Esc");
  });

  test("a host that may not write does not offer the move", () => {
    const hints = keys(state({ selected: { kind: "symbol", id: "M2.C1" }, canWriteFull: false }));
    expect(hints).not.toContain("M");
    // the rest of the selection's keys still answer
    expect(hints).toContain("Enter");
  });

  test("a drawing that is not a print page offers no move and no rotation", () => {
    const hints = keys(state({ drawingKind: "pcb", selected: { kind: "symbol", id: "M2.C1" } }));
    expect(hints).not.toContain("M");
    expect(hints).not.toContain("R");
    expect(hints).toContain("Enter");
  });

  test("a field offers Backspace only when it carries an override", () => {
    const selected = { kind: "field", id: "M2.C1:Value" } as const;
    expect(keys(state({ selected, fieldIsManual: false }))).not.toContain("Backspace");
    expect(keys(state({ selected, fieldIsManual: true }))).toContain("Backspace");
  });

  test("a field is not offered the move or the rotation", () => {
    const hints = keys(state({ selected: { kind: "field", id: "M2.C1:Value" }, fieldIsManual: true }));
    expect(hints).not.toContain("M");
    expect(hints).not.toContain("R");
  });

  test("a move in flight offers only the keys that end it", () => {
    const hints = keys(state({ moving: true, selected: { kind: "symbol", id: "M2.C1" } }));
    expect(hints).toEqual(["Enter", "Esc"]);
  });
});

describe("the hint follows the pen", () => {
  test("a drawing the pen is offered on offers the pen", () => {
    expect(keys(state({ drawingKind: "symbol" }))).toContain("B");
  });

  test("a drawing the pen is not offered on does not offer it", () => {
    expect(keys(state({ drawingKind: "pcb" }))).not.toContain("B");
    expect(keys(state({ drawingKind: "sch" }))).not.toContain("B");
  });

  test("an armed pen offers the keys that end it, and not the key that arms it", () => {
    const hints = keys(state({ drawingKind: "symbol", sketch: { armed: true, strokes: 0 } }));
    expect(hints).toContain("Esc");
    expect(hints).not.toContain("B");
  });

  test("the undo is offered only when there is a stroke to drop", () => {
    const empty = keys(state({ drawingKind: "symbol", sketch: { armed: true, strokes: 0 } }));
    const drawn = keys(state({ drawingKind: "symbol", sketch: { armed: true, strokes: 2 } }));
    expect(empty).not.toContain("Ctrl+Z");
    expect(drawn).toContain("Ctrl+Z");
  });
});

describe("the hint says which way its own key goes", () => {
  test("while it is up, its key folds it away", () => {
    const hint = keyHints(state({ keysOpen: true })).find((entry) => entry.key === "?");
    expect(hint?.what).toBe("hide this list");
  });

  test("while it is folded, its key brings it back", () => {
    const hint = keyHints(state({ keysOpen: false })).find((entry) => entry.key === "?");
    expect(hint?.what).toBe("show this list");
  });
});

describe("the status line after a move", () => {
  test("it names the object that is still selected", () => {
    const line = moveStatus({ kind: "symbol", id: "M2.C1" }, true, "cap-mlcc-1210");
    expect(line).toContain("M2.C1");
    expect(line).toContain("cap-mlcc-1210");
  });

  test("it says the move is local until Apply", () => {
    expect(moveStatus({ kind: "symbol", id: "M2.C1" }, true, "cap-mlcc-1210")).toContain("Apply to write it");
  });

  test("a move that changed nothing says so instead of claiming a pending change", () => {
    const line = moveStatus({ kind: "symbol", id: "M2.C1" }, false, "cap-mlcc-1210");
    expect(line).toContain("without changes");
    expect(line).not.toContain("Apply to write it");
  });

  test("an object with no symbol still names itself", () => {
    expect(moveStatus({ kind: "symbol", id: "M2.C1" }, true, undefined)).toContain("M2.C1");
  });

  test("a field or a label has no name to add, only the notice", () => {
    expect(moveStatus({ kind: "field", id: "M2.C1:Value" }, true, undefined)).toBe(
      "move kept locally; Apply to write it",
    );
  });
});
