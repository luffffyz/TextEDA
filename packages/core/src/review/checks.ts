// The review process as a check (ADR-0033 D6/D7): a round's state is a fact about a human
// process, not about the design. Nothing here reads a description file or a shard — the caller
// parses the Markdown and the decision TOML, and this function judges what it found.
//
// Two questions, both answered with a warning so the build never depends on a process:
//   1. does a round with notes have a decision?
//   2. was the decision made by the project's accountable person?
//
// A note carries no verdict (ADR-0033 D6). This file must never infer one from the notes' text:
// the only verdict is the one written in `docs/reviews/<round>.decision.toml`.
import type { Diagnostic } from "@texteda/ir/diagnostics";

/** One note of a round: the author, the date, and the observation (kept only to report who raised what). */
export interface ReviewNote {
  author: string;
  date: string;
  text: string;
}

/** A decision as written in the decision file; every field optional so a malformed file is reported, not thrown. */
export interface ReviewDecision {
  file: string;
  target?: string;
  owner?: string;
  date?: string;
  verdict?: string;
}

export interface ReviewRound {
  /** The round id: the file stem of `<round_id>.md`. */
  id: string;
  /** Notes file, relative to the project root. */
  file: string;
  /** The target declared in the notes' heading, when it can be read (`board:<id>`, `page:<id>/<page>`, `component:<id>`). */
  target?: string;
  notes: ReviewNote[];
  /** The decision file of this round, if one exists. */
  decision?: ReviewDecision;
}

export interface ReviewFacts {
  /** The project's accountable person (`project.toml` `[project].owner`); absent when the project has not named one. */
  projectOwner?: string;
  rounds: ReviewRound[];
}

/** The verdicts ADR-0033 D4 allows. Anything else is a malformed decision. */
export const REVIEW_VERDICTS = ["accepted", "declined", "deferred"] as const;

/**
 * Check the review rounds.
 *
 * Rule 1 (ADR-0033 D7): notes and no decision → `review.round-unclosed` (warning).
 * Rule 2 (ADR-0033 D5): a decision owned by someone other than the project's owner →
 *   `review.owner-mismatch` (warning). "Either somebody decided without the authority, or the
 *   handover was never recorded" — the diagnostic cannot tell which, so it says both.
 * Rule 3 (ADR-0033 D4): a decision missing a field or carrying an unknown verdict →
 *   `review.decision-invalid` (error): a malformed decision is not a decision, and a round that
 *   looks closed to a human while being unreadable to the tool is worse than an open one.
 */
export function checkReviews(facts: ReviewFacts): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  // Rule 0 (ADR-0033 D5, F33): a project with reviews but no accountable person cannot close
  // anything, and every decision it writes would be unauthorised. One error, not one per round.
  if (facts.projectOwner === undefined && facts.rounds.some((round) => round.notes.length > 0)) {
    diagnostics.push({
      code: "review.owner-missing",
      severity: "error",
      message: "the project has review rounds but project.toml names no accountable person (`[project].owner`)",
      location: { file: "project.toml", line: 1, col: 1 },
      hint: "add `owner = \"<name>\"` under `[project]`; nobody can close a round without it",
      data: { rounds: facts.rounds.filter((round) => round.notes.length > 0).length },
    });
  }

  for (const round of facts.rounds) {
    const { decision } = round;

    if (decision === undefined) {
      if (round.notes.length === 0) continue;
      const authors = [...new Set(round.notes.map((note) => note.author))].sort();
      diagnostics.push({
        code: "review.round-unclosed",
        severity: "warning",
        message:
          `round ${round.id} has ${round.notes.length} ${round.notes.length === 1 ? "note" : "notes"} and no decision` +
          (round.target === undefined ? "" : ` (target ${round.target})`) +
          `: raised by ${authors.join(", ")}`,
        location: { file: round.file, line: 1, col: 1 },
        hint: `write docs/reviews/${round.id}.decision.toml with target, owner, date and a verdict (accepted / declined / deferred)`,
        data: { round: round.id, notes: round.notes.length, authors: authors.join(",") },
      });
      continue;
    }

    const missing = (["target", "owner", "date", "verdict"] as const).filter((key) => decision[key] === undefined);
    const badVerdict =
      decision.verdict !== undefined && !(REVIEW_VERDICTS as readonly string[]).includes(decision.verdict);
    if (missing.length > 0 || badVerdict) {
      diagnostics.push({
        code: "review.decision-invalid",
        severity: "error",
        message:
          badVerdict
            ? `the decision of round ${round.id} has verdict \`${decision.verdict}\`; the closed set is accepted / declined / deferred`
            : `the decision of round ${round.id} is missing ${missing.join(", ")}`,
        location: { file: decision.file, line: 1, col: 1 },
        data: { round: round.id },
      });
      continue;
    }

    if (facts.projectOwner !== undefined && decision.owner !== facts.projectOwner) {
      diagnostics.push({
        code: "review.owner-mismatch",
        severity: "warning",
        message:
          `the decision of round ${round.id} is owned by ${decision.owner}, but the project's accountable person is ${facts.projectOwner}`,
        location: { file: decision.file, line: 1, col: 1 },
        hint: "either the decision was made without the authority, or the handover belongs in project.toml `[project].owner`",
        data: { round: round.id, decision_owner: decision.owner!, project_owner: facts.projectOwner },
      });
    }
  }

  return diagnostics;
}
