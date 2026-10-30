// The seams between the review app and whatever hosts it.
//
// Two rules a host can change, and both are worth a test that needs no browser: what a refusal
// says, and whose keys the app may take (ADR-0043 D2, D9).
import { describe, expect, test } from "bun:test";
import { isForeignEditable, refusalMessage, unsavedSource } from "../src/host.ts";

/** A root that contains nothing. */
function emptyRoot(): Element {
  return { contains: () => false } as unknown as Element;
}

/** An element that is (or is not) a text field, and is outside the root. */
function field(selector: string | null): EventTarget {
  return {
    closest: (query: string) => (selector !== null && query.includes(selector) ? ({}) : null),
  } as unknown as EventTarget;
}

describe("a refusal says what went wrong", () => {
  test("one error is the message", () => {
    expect(refusalMessage({ error: "no such board: b" })).toBe("no such board: b");
  });

  test("a list of errors is one line", () => {
    expect(refusalMessage({ errors: ["first", "second"] })).toBe("first; second");
  });

  test("a refusal that says nothing still says something", () => {
    expect(refusalMessage({})).toBe("the host refused the request");
  });

  test("an error wins over a list", () => {
    expect(refusalMessage({ error: "the one", errors: ["the other"] })).toBe("the one");
  });
});

describe("the app takes only its own keys", () => {
  test("a key pressed in somebody else's text field is not ours", () => {
    expect(isForeignEditable(field("textarea"), emptyRoot())).toBe(true);
  });

  test("a key pressed on something that is not a text field is ours", () => {
    expect(isForeignEditable(field(null), emptyRoot())).toBe(false);
  });

  test("a key pressed inside our own root is ours, text field or not", () => {
    const root = { contains: () => true } as unknown as Element;
    expect(isForeignEditable(field("textarea"), root)).toBe(false);
  });

  test("a key press on something that is not an element is ours to ignore", () => {
    expect(isForeignEditable({} as EventTarget, emptyRoot())).toBe(false);
    expect(isForeignEditable(null, emptyRoot())).toBe(false);
  });
});

describe("the editor's unsaved text rides along with a write", () => {
  test("no draft means nothing to send", () => {
    expect(unsavedSource(null, "version 0.9.1\n")).toBeUndefined();
  });

  test("a draft that is the page the app knows is not an edit", () => {
    expect(unsavedSource("version 0.9.1\n", "version 0.9.1\n")).toBeUndefined();
    // A page the app has no source for: an empty draft is the same as no source, and a draft with
    // text in it is an edit.
    expect(unsavedSource("", undefined)).toBeUndefined();
    expect(unsavedSource("version 0.9.1\n", undefined)).toBe("version 0.9.1\n");
  });

  test("a draft that differs is sent", () => {
    expect(unsavedSource("version 0.9.1\nview a\n", "version 0.9.1\n")).toBe("version 0.9.1\nview a\n");
  });
});
