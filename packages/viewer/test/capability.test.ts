// The modes a person may enter, resolved from the drawing and the host's capability (ADR-0043 D3,
// D6; ADR-0048 D2). These tests need no DOM: the drawing is built literally, and the helper is
// pure.
import { describe, expect, test } from "bun:test";
import { availableModes } from "../src/capability.ts";
import type { ReviewCapability, ReviewDrawing, ReviewDrawingKind, ReviewMode } from "../src/types.ts";

/** A drawing of the given kind. The fields of the other kinds are absent on it. */
function drawing(kind: ReviewDrawingKind): ReviewDrawing {
  return {
    kind,
    key: `${kind}/x`,
    label: "x",
    file: "x.teda",
    sheet: { w: 10, h: 10 },
    svg: "",
    symbols: [],
    texts: [],
    problems: [],
  };
}

/** A capability that may enter only the named modes, and write only the page's place rows. */
function capability(modes: ReviewMode[], write: "places" | "layout"): ReviewCapability {
  return { modes, write };
}

describe("availableModes with no capability", () => {
  test("a print page gets the three modes it can act in", () => {
    expect(availableModes(drawing("sch"), undefined)).toEqual(["review", "layout", "edit"]);
  });

  test("a board canvas is read", () => {
    expect(availableModes(drawing("pcb"), undefined)).toEqual(["review"]);
  });

  test("a library symbol is read", () => {
    expect(availableModes(drawing("symbol"), undefined)).toEqual(["review"]);
  });

  test("a library footprint is read", () => {
    expect(availableModes(drawing("footprint"), undefined)).toEqual(["review"]);
  });

  test("nothing to show still leaves review", () => {
    expect(availableModes(undefined, undefined)).toEqual(["review"]);
  });
});

describe("availableModes with a capability", () => {
  test("a capability removes what the drawing supports", () => {
    expect(availableModes(drawing("sch"), capability(["review", "layout"], "places"))).toEqual([
      "review",
      "layout",
    ]);
  });

  test("a capability cannot add a mode the drawing does not support", () => {
    expect(availableModes(drawing("pcb"), capability(["review", "layout", "edit"], "places"))).toEqual([
      "review",
    ]);
  });

  test("a capability whose modes are in another order does not add modes", () => {
    expect(availableModes(drawing("sch"), capability(["edit", "review"], "places"))).toEqual([
      "review",
      "edit",
    ]);
  });

  test("the canonical order wins when the capability orders the modes differently", () => {
    expect(availableModes(drawing("sch"), capability(["edit", "review", "layout"], "layout"))).toEqual([
      "review",
      "layout",
      "edit",
    ]);
  });
});
