// The review check is pure: rounds are handed in, diagnostics come out (ADR-0136 D6/D7).
import { describe, expect, test } from "bun:test";
import { checkReviews, type ReviewRound } from "../src/index.ts";

const note = (author: string) => ({ author, date: "2026-10-23", text: "something worth answering" });

const round = (over: Partial<ReviewRound> = {}): ReviewRound => ({
  id: "b-sch-r1",
  file: "docs/reviews/b-sch-r1.md",
  target: "board:b",
  notes: [note("power")],
  ...over,
});

const decision = (over: Record<string, string> = {}) => ({
  file: "docs/reviews/b-sch-r1.decision.toml",
  target: "board:b",
  owner: "carol",
  date: "2026-10-23",
  verdict: "accepted",
  ...over,
});

const codes = (rounds: ReviewRound[], projectOwner?: string) =>
  checkReviews({ ...(projectOwner === undefined ? {} : { projectOwner }), rounds }).map((d) => d.code);

describe("an unclosed round", () => {
  test("notes without a decision are a warning naming the authors", () => {
    const diagnostics = checkReviews({ projectOwner: "carol", rounds: [round({ notes: [note("power"), note("layout")] })] });
    expect(diagnostics.map((d) => d.code)).toEqual(["review.round-unclosed"]);
    expect(diagnostics[0]!.severity).toBe("warning");
    expect(diagnostics[0]!.data).toEqual({ round: "b-sch-r1", notes: 2, authors: "layout,power" });
  });

  test("a round with no notes and no decision is not a round anybody opened", () => {
    expect(codes([round({ notes: [] })], "carol")).toEqual([]);
  });

  test("a closed round by the accountable person is silent", () => {
    expect(codes([round({ decision: decision() })], "carol")).toEqual([]);
  });
});

describe("the accountable person", () => {
  test("reviews without an owner are an error: nothing can be closed", () => {
    // Both facts hold: there is nobody to close the round with, and the round is open.
    expect(codes([round()])).toEqual(["review.owner-missing", "review.round-unclosed"]);
  });

  test("no reviews and no owner is fine", () => {
    expect(codes([round({ notes: [] })])).toEqual([]);
  });

  test("a decision owned by someone else is a warning that names both people", () => {
    const diagnostics = checkReviews({ projectOwner: "carol", rounds: [round({ decision: decision({ owner: "dave" }) })] });
    expect(diagnostics.map((d) => d.code)).toEqual(["review.owner-mismatch"]);
    expect(diagnostics[0]!.data).toEqual({ round: "b-sch-r1", decision_owner: "dave", project_owner: "carol" });
  });
});

describe("a malformed decision is not a decision", () => {
  test("a missing field is an error", () => {
    const { date: _date, ...noDate } = decision();
    expect(codes([round({ decision: noDate })], "carol")).toEqual(["review.decision-invalid"]);
  });

  test("a verdict outside the closed set is an error", () => {
    expect(codes([round({ decision: decision({ verdict: "approved" }) })], "carol")).toEqual(["review.decision-invalid"]);
  });

  test("a malformed decision does not also report a missing decision", () => {
    expect(codes([round({ decision: decision({ verdict: "lpgtm" }) })], "carol")).not.toContain("review.round-unclosed");
  });
});
