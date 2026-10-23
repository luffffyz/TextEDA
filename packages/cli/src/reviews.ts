// Reading a project's review rounds off disk (ADR-0033 D3/D4).
//
// The notes are Markdown and the tools do not parse them for meaning — only the header's target
// and the `- author (date): ...` shape of a bullet are read, to say *who raised what and when*.
// The decision is the small TOML file next to them, and that is what the checker judges.
//
// This module is the filesystem half; `checkReviews` in packages/core is the rule.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseToml, tableValue } from "@texteda/parser";
import type { Diagnostic } from "@texteda/ir/diagnostics";
import type { ReviewDecision, ReviewNote, ReviewRound } from "@texteda/core";
import { LAYOUT } from "./paths.ts";

/** `- author (2026-10-23): observation`; continuation lines (`→ addressed …`) are indented, so they are ignored. */
const NOTE = /^-\s+(.+?)\s+\((\d{4}-\d{2}-\d{2})\):\s*(.*)$/;
/** The target line of a round's heading: ``Target `board:mcu-board`, …``. */
const TARGET = /Target\s+`([^`]+)`/;

function parseNotes(text: string): ReviewNote[] {
  const notes: ReviewNote[] = [];
  for (const line of text.split("\n")) {
    const match = NOTE.exec(line);
    if (!match) continue;
    notes.push({ author: match[1]!.trim(), date: match[2]!, text: match[3]! });
  }
  return notes;
}

function parseDecision(file: string, text: string): { decision: ReviewDecision; diagnostics: Diagnostic[] } {
  const parsed = parseToml(text, { file });
  let decision: ReviewDecision = { file };
  if (parsed.value) {
    const value = (key: string) => {
      const raw = tableValue(parsed.value!, key);
      return typeof raw === "string" ? raw : undefined;
    };
    const target = value("target");
    const owner = value("owner");
    const date = value("date");
    const verdict = value("verdict");
    decision = {
      file,
      ...(target !== undefined ? { target } : {}),
      ...(owner !== undefined ? { owner } : {}),
      ...(date !== undefined ? { date } : {}),
      ...(verdict !== undefined ? { verdict } : {}),
    };
  }
  return { decision, diagnostics: parsed.diagnostics };
}

/** Every round of the project, with its decision when one exists. Missing directory = no rounds. */
export function loadReviews(root: string): { rounds: ReviewRound[]; diagnostics: Diagnostic[] } {
  const dir = join(root, LAYOUT.reviews);
  if (!existsSync(dir)) return { rounds: [], diagnostics: [] };

  const names = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);

  const rounds: ReviewRound[] = [];
  const diagnostics: Diagnostic[] = [];

  for (const name of names.filter((name) => name.endsWith(".md")).sort()) {
    const id = name.slice(0, -".md".length);
    const file = `${LAYOUT.reviews}/${name}`;
    const text = readFileSync(join(dir, name), "utf8");
    const round: ReviewRound = { id, file, notes: parseNotes(text) };
    const target = TARGET.exec(text);
    if (target) round.target = target[1]!;

    const decisionName = `${id}.decision.toml`;
    if (names.includes(decisionName)) {
      const decisionFile = `${LAYOUT.reviews}/${decisionName}`;
      const parsed = parseDecision(decisionFile, readFileSync(join(dir, decisionName), "utf8"));
      round.decision = parsed.decision;
      diagnostics.push(...parsed.diagnostics);
    }
    rounds.push(round);
  }

  // A decision whose round has no notes file is a decision about nothing; its fields and its
  // owner are still checked like any other, so a stray file cannot pass unnoticed.
  for (const name of names.filter((name) => name.endsWith(".decision.toml")).sort()) {
    const id = name.slice(0, -".decision.toml".length);
    if (rounds.some((round) => round.id === id)) continue;
    const decisionFile = `${LAYOUT.reviews}/${name}`;
    const parsed = parseDecision(decisionFile, readFileSync(join(dir, name), "utf8"));
    diagnostics.push(...parsed.diagnostics);
    rounds.push({ id, file: `${LAYOUT.reviews}/${id}.md`, notes: [], decision: parsed.decision });
  }

  return { rounds, diagnostics };
}
