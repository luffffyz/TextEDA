// The modes a person may enter, resolved from the board and the host's capability (ADR-0043 D3,
// D6). These tests need no DOM: the board is built literally, and the helper is pure.
import { describe, expect, test } from "bun:test";
import { availableModes } from "../src/capability.ts";
import type { ReviewBoard, ReviewCapability, ReviewMode, ReviewPage } from "../src/types.ts";

/** A board with the given pages, and with a PCB description when `withPcb` is set. */
function board(pages: ReviewPage[] = [], withPcb = false): ReviewBoard {
  return {
    id: "b",
    file: "board.teda",
    pages,
    instances: [],
    nets: [],
    ...(withPcb
      ? {
          pcb: {
            file: "pcb.teda",
            sheet: { w: 10, h: 10 },
            svg: "",
            parts: [],
            problems: [],
          },
        }
      : {}),
  };
}

/** A page with no drawing, so the page exists without any symbol. */
function page(id: string): ReviewPage {
  return {
    id,
    file: `views/b/${id}.view.teda`,
    sheet: { w: 10, h: 10 },
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
  test("a board with pages and a PCB gets all four modes", () => {
    expect(availableModes(board([page("v1")], true), undefined)).toEqual([
      "review",
      "layout",
      "placement",
      "edit",
    ]);
  });

  test("a board with no pages and no PCB only gets review", () => {
    expect(availableModes(board(), undefined)).toEqual(["review"]);
  });

  test("a board with pages but no PCB skips placement", () => {
    expect(availableModes(board([page("v1")]), undefined)).toEqual([
      "review",
      "layout",
      "edit",
    ]);
  });
});

describe("availableModes with a capability", () => {
  test("a capability removes what the board supports", () => {
    expect(
      availableModes(
        board([page("v1")], true),
        capability(["review", "layout"], "places"),
      ),
    ).toEqual(["review", "layout"]);
  });

  test("a capability cannot add a mode the board does not support", () => {
    expect(
      availableModes(
        board(),
        capability(["review", "placement"], "places"),
      ),
    ).toEqual(["review"]);
  });

  test("a capability whose modes are in another order does not add modes", () => {
    expect(
      availableModes(
        board([page("v1")]),
        capability(["edit", "review", "layout"], "places"),
      ),
    ).toEqual(["review", "layout", "edit"]);
  });

  test("the canonical order wins when the capability orders the modes differently", () => {
    expect(
      availableModes(
        board([page("v1")], true),
        capability(["placement", "edit", "review", "layout"], "layout"),
      ),
    ).toEqual(["review", "layout", "placement", "edit"]);
  });
});
