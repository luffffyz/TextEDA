// Extract from a `component` description **the few facts exporting a symbol needs**: the pin table, footprint, datasheet, description.
//
// This is not the `component` parser: full component parsing (`params` column types, category/mpn rules,
// lcsc validation) is not implemented yet (AGENTS.md §11). This projection only reads what it needs and strictly validates what it reads;
// all other sections and scalars are passed through as-is, without pretending they were validated.
import type { Diagnostic, DiagnosticCodeId } from "./diagnostics.ts";
import { lex } from "./lexer.ts";
import { checkVersion, typeRange } from "./version.ts";

/** Pin electrical types from `teda.md` §10.1. */
export const PIN_TYPES = new Set([
  "input",
  "output",
  "bidirectional",
  "tri_state",
  "passive",
  "power_in",
  "power_out",
  "power",
  "open_collector",
  "open_emitter",
  "no_connect",
  "unspecified",
]);

export interface ComponentPinFact {
  number: string;
  name: string;
  type: string;
}

export interface ComponentFacts {
  id: string;
  pins: ComponentPinFact[];
  footprint?: string;
  datasheet?: string;
  description?: string;
}

export interface ComponentFactsResult {
  ok: boolean;
  facts?: ComponentFacts;
  diagnostics: Diagnostic[];
}

/** The `component` type exists since 0.1 (teda.md §13). */
const VERSION_RANGE = typeRange(1);

const PIN_NUMBER_RE = /^[A-Za-z0-9_+-]+$/;
const PIN_NAME_RE = /^[A-Za-z0-9_+-]+$/;

export function readComponentFacts(text: string, options: { file: string }): ComponentFactsResult {
  const { file } = options;
  const diagnostics: Diagnostic[] = [];
  const error = (line: number, col: number, code: DiagnosticCodeId, message: string) => {
    diagnostics.push({ code, severity: "error", message, location: { file, line, col } });
  };

  const lines = lex(text);
  let index = 0;
  const next = () => {
    while (index < lines.length) {
      const line = lines[index]!;
      index += 1;
      if (line.blank || line.comment) continue;
      return line;
    }
    return null;
  };

  const versionLine = next();
  if (!versionLine || versionLine.cells[0]?.text !== "version") {
    error(versionLine?.number ?? 1, 1, "syntax.header-invalid", "the first line must be version <ver>");
    return { ok: false, diagnostics };
  }
  const version = versionLine.cells[1]?.text ?? "";
  const verdict = checkVersion(version, VERSION_RANGE, "component");
  if (!verdict.ok) {
    error(versionLine.number, versionLine.cells[1]?.col ?? 1, verdict.code, verdict.message);
    return { ok: false, diagnostics };
  }
  const typeLine = next();
  if (!typeLine || typeLine.cells.length !== 2 || typeLine.cells[0]!.text !== "component") {
    error(typeLine?.number ?? 1, 1, "syntax.header-invalid", "the second line must be component <id>");
    return { ok: false, diagnostics };
  }

  const facts: ComponentFacts = { id: typeLine.cells[1]!.text, pins: [] };
  let section: string | null = null;
  for (let line = next(); line !== null; line = next()) {
    if (line.cells.length === 1) {
      section = line.cells[0]!.text;
      continue;
    }
    if (section === null) {
      const key = line.cells[0]!.text;
      const value = line.cells.slice(1).map((c) => c.text).join(" ");
      if (key === "footprint") facts.footprint = value;
      else if (key === "datasheet") facts.datasheet = value;
      else if (key === "description") facts.description = value;
      continue;
    }
    if (section !== "pins") continue;
    if (line.cells.length < 3) {
      error(line.number, line.cells[0]!.col, "syntax.row-too-short", "a pins row needs at least 3 columns: number name type");
      continue;
    }
    const [number, name, type] = line.cells as [
      (typeof line.cells)[number],
      (typeof line.cells)[number],
      (typeof line.cells)[number],
    ];
    // The trailing columns are the optional columns allowed by `teda.md` §6.3 (unit / alt); this projection does not use them, but the syntax must be checked.
    let tailOk = true;
    for (const cell of line.cells.slice(3)) {
      const eq = cell.text.indexOf("=");
      const key = eq > 0 ? cell.text.slice(0, eq) : "";
      const value = eq > 0 ? cell.text.slice(eq + 1) : "";
      if (key === "unit") {
        if (!/^\d+$/.test(value) || Number(value) < 0) {
          error(line.number, cell.col, "value.pin-column-invalid", `unit must be a non-negative integer: ${value}`);
          tailOk = false;
        }
      } else if (key === "alt") {
        if (!PIN_NAME_RE.test(value)) {
          error(line.number, cell.col, "value.pin-column-invalid", `invalid alt: ${value}`);
          tailOk = false;
        }
      } else {
        error(line.number, cell.col, "value.pin-column-invalid", `unknown pin column: ${cell.text}`);
        tailOk = false;
      }
    }
    if (!tailOk) continue;
    if (!PIN_NUMBER_RE.test(number.text)) {
      error(line.number, number.col, "value.pin-number-invalid", `invalid pin number: ${number.text}`);
      continue;
    }
    if (!PIN_NAME_RE.test(name.text)) {
      error(line.number, name.col, "value.pin-name-invalid", `invalid pin name: ${name.text}`);
      continue;
    }
    if (!PIN_TYPES.has(type.text)) {
      error(line.number, type.col, "value.electrical-type-unknown", `unknown electrical type: ${type.text}`);
      continue;
    }
    if (facts.pins.some((p) => p.number === number.text)) {
      error(line.number, number.col, "library.duplicate-pin-number", `duplicate pin number: ${number.text}`);
      continue;
    }
    facts.pins.push({ number: number.text, name: name.text, type: type.text });
  }

  // Self-authored symbols store only views (ADR-0012): the pin facts needed to export a symbol can only come from a component.
  if (facts.pins.length === 0) {
    error(1, 1, "library.pins-empty", "the pins section must not be empty: pin facts for a self-authored symbol can only come from a component");
  }
  if (diagnostics.some((d) => d.severity === "error")) return { ok: false, diagnostics };
  return { ok: true, facts, diagnostics };
}
