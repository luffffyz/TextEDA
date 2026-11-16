// Reading a project's review rounds off disk (ADR-0037 D3/D4).
//
// A round is **one file**: `docs/reviews/<date>-<slug>.md`. The notes are Markdown and the tools do
// not parse them for meaning — only the head's four facts and the `- author (date): ...` shape of a
// bullet are read, to say *who raised what and when*, and *what was decided about it*.
//
// The decision's four facts are plain lines in the head of that same file:
//
//     target: board:mcu-board
//     owner: carol
//     date: 2026-10-23
//     verdict: accepted
//
// A file that carries none of them is a round that is still open; one that carries some of them is a
// decision that is missing the rest, and `checkReviews` says so.
//
// This module is the filesystem half; `checkReviews` in packages/core is the rule.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Diagnostic } from "@texteda/ir/diagnostics";
import type { ReviewDecision, ReviewNote, ReviewRound } from "@texteda/core";
import { LAYOUT } from "./paths.ts";

/** `- author (2026-10-23): observation`; continuation lines (`→ addressed …`) are indented, so they are ignored. */
const NOTE = /^-\s+(.+?)\s+\((\d{4}-\d{2}-\d{2})\):\s*(.*)$/;
/** One decision fact, written as a plain line in the head of the round file: `verdict: accepted`. */
const DECISION_FIELD = /^(target|owner|date|verdict):\s*(.+?)\s*$/;

function parseNotes(text: string): ReviewNote[] {
  const notes: ReviewNote[] = [];
  for (const line of text.split("\n")) {
    const match = NOTE.exec(line);
    if (!match) continue;
    notes.push({ author: match[1]!.trim(), date: match[2]!, text: match[3]! });
  }
  return notes;
}

/**
 * The decision written in the head of the round file, or nothing when the round is still open.
 *
 * Only the lines above the first note are read: the four facts sit under the title, and a note is
 * prose that must not be mistaken for a field.
 */
function parseDecision(file: string, text: string): ReviewDecision | undefined {
  const facts: Partial<Omit<ReviewDecision, "file">> = {};
  for (const line of text.split("\n")) {
    if (NOTE.test(line)) break;
    const match = DECISION_FIELD.exec(line);
    if (!match) continue;
    const value = match[2]!;
    if (match[1] === "target") facts.target = value;
    else if (match[1] === "owner") facts.owner = value;
    else if (match[1] === "date") facts.date = value;
    else facts.verdict = value;
  }
  if (Object.keys(facts).length === 0) return undefined;
  return { file, ...facts };
}

/** Every round of the project, with its decision when one is written. Missing directory = no rounds. */
export function loadReviews(root: string): { rounds: ReviewRound[]; diagnostics: Diagnostic[] } {
  const dir = join(root, LAYOUT.reviews);
  if (!existsSync(dir)) return { rounds: [], diagnostics: [] };

  const names = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);

  const rounds: ReviewRound[] = [];
  for (const name of names.filter((name) => name.endsWith(".md")).sort()) {
    const id = name.slice(0, -".md".length);
    const file = `${LAYOUT.reviews}/${name}`;
    const text = readFileSync(join(dir, name), "utf8");
    const decision = parseDecision(file, text);
    const round: ReviewRound = { id, file, notes: parseNotes(text) };
    if (decision?.target !== undefined) round.target = decision.target;
    if (decision !== undefined) round.decision = decision;
    rounds.push(round);
  }
  return { rounds, diagnostics: [] };
}
