// Constraint agreement: does one net get one window, or two?
//
// A net's window is one fact. The root may state it, and a module may state it for the net it
// owns; when the module's net is merged into a project net, the two statements meet (ADR-0069
// D1). Nothing compared them, so the same rail could be written twice with two different values,
// and the comparison below took whichever came first — one fact with two homes and no rule
// (ADR-0041 D1: one fact, one house).
//
// Two declarations of the same net that agree are a redundancy, not a contradiction: the note
// says so and names both places, because "changing the 5 V rail means editing two files" is
// exactly the cost of a second home. Two that disagree are a contradiction: the design says two
// different things about one net, and the error says so.
//
// Pure: facts in, diagnostics out.
import type { Diagnostic, DiagnosticLocation } from "@texteda/ir/diagnostics";
import type { Schematic } from "@texteda/ir/schematic";

export interface ConstraintFacts {
  readonly file: string;
  readonly schematic: Schematic;
  /** Where a constraint was written (ADR-0004 D1: the IR carries no line numbers). */
  readonly locateConstraint?: (index: number) => DiagnosticLocation | undefined;
}

/** One declaration, with the index it has in the IR. */
interface Declaration {
  readonly index: number;
  /** The value it states, as a comparable string. */
  readonly value: string;
  /** How the value reads to a human. */
  readonly text: string;
}

/** `4.5V..5.5V`, `300mA` — the surface unit is volts and amperes. */
function volts(uv: number): string {
  const value = uv / 1e6;
  return `${Number.isInteger(value) ? value : Number(value.toFixed(4))}V`;
}

function amps(na: number): string {
  const value = na / 1e9;
  return `${Number.isInteger(value) ? value : Number(value.toFixed(4))}A`;
}

/**
 * Compare the declarations each net carries.
 *
 * Only the two facts a net states once are spoken about: its window (`voltage`) and its current
 * limit (`current`). A `power` constraint may be written several times for one pin — the
 * tightest one applies (ADR-0026 D11) — and the other kinds are not consumed by anything yet.
 */
export function checkConstraintAgreement(facts: ConstraintFacts): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const groups = new Map<string, { kind: "voltage" | "current"; subject: string; declarations: Declaration[] }>();

  (facts.schematic.constraints ?? []).forEach((constraint, index) => {
    if (constraint.type !== "voltage" && constraint.type !== "current") return;
    const value = constraint.type === "voltage"
      ? `${constraint.min_uv}..${constraint.max_uv}`
      : `${constraint.max_na}`;
    const text = constraint.type === "voltage"
      ? `${volts(constraint.min_uv)}..${volts(constraint.max_uv)}`
      : amps(constraint.max_na);
    // A net states one window and one current limit: the two kinds never compare with each other.
    const key = `${constraint.type} ${constraint.subject}`;
    const group = groups.get(key) ?? { kind: constraint.type, subject: constraint.subject, declarations: [] };
    group.declarations.push({ index, value, text });
    groups.set(key, group);
  });

  for (const group of groups.values()) {
    const declarations = group.declarations;
    if (declarations.length < 2) continue;
    const subject = group.subject;
    const first = declarations[0]!;
    const where = declarations
      .map((declaration) => facts.locateConstraint?.(declaration.index))
      .filter((location): location is DiagnosticLocation => location !== undefined);
    const distinct = new Set(declarations.map((declaration) => declaration.value));
    const noun = group.kind === "voltage" ? "window" : "current limit";

    if (distinct.size > 1) {
      diagnostics.push({
        code: "net.constraint-conflict",
        severity: "error",
        message: `net ${subject} is given ${declarations.length} different ${noun}s: ${declarations.map((declaration) => declaration.text).join(", ")}`,
        hint: "one net states one window; keep one declaration and make the others agree with it",
        location: where[0] ?? { file: facts.file, line: 1, col: 1 },
        ...(where.length > 1 ? { related: where.slice(1) } : {}),
        data: { subject, kind: group.kind, declarations: declarations.length },
      });
      continue;
    }

    diagnostics.push({
      code: "net.constraint-duplicate",
      severity: "note",
      message: `net ${subject} states its ${noun} (${first.text}) ${declarations.length} times`,
      hint: "keep one declaration: a fact with two homes is two files to edit",
      location: where[0] ?? { file: facts.file, line: 1, col: 1 },
      ...(where.length > 1 ? { related: where.slice(1) } : {}),
      data: { subject, kind: group.kind, declarations: declarations.length },
    });
  }

  return diagnostics;
}
