// Component index: extract from a `component` file **the two things schematic parsing needs** — parameter declarations and pin facts.
//
// This is not a full component parser (a full parse would also enforce category/mpn/lcsc rules);
// it is the projection needed at the schematic layer. Pin electrical types are **not validated** here (that is the component layer's job),
// but pin numbers, names, and units must parse correctly, or pin-reference resolution will point at the wrong place.
//
// Section syntax: see teda.md §6.2 (`params`) and §6.3 (`pins`).
import { lex } from "./lexer.ts";
import type { ComponentFactsLite, ComponentParamDecl, ComponentPinFactLite } from "./schematic.ts";

export interface ComponentIndexResult {
  ok: boolean;
  /** The component id declared in the file header (the `component <id>` line). */
  id?: string;
  facts?: ComponentFactsLite;
  /** Where and why things went wrong (line number + message). */
  problems: { line: number; message: string }[];
}

const PARAM_TYPE_RE = /^[a-z][a-z0-9_]*$/;
const PIN_NUMBER_RE = /^[A-Za-z0-9_+-]+$/;
const PIN_NAME_RE = /^[A-Za-z0-9_+-]+$/;

/** Read out one component's parameter declarations and pin facts. */
export function readComponentIndex(text: string): ComponentIndexResult {
  const problems: { line: number; message: string }[] = [];
  const lines = lex(text).filter((l) => !l.blank && !l.comment);

  const versionLine = lines[0];
  if (!versionLine || versionLine.cells[0]?.text !== "version") {
    problems.push({ line: 1, message: "the first line must be version <ver>" });
    return { ok: false, problems };
  }
  const typeLine = lines[1];
  if (!typeLine || typeLine.cells.length !== 2 || typeLine.cells[0]!.text !== "component") {
    problems.push({ line: 2, message: "the second line must be component <id>" });
    return { ok: false, problems };
  }

  const params: ComponentParamDecl[] = [];
  const pins: ComponentPinFactLite[] = [];
  let section: string | null = null;

  for (const line of lines.slice(2)) {
    const cells = line.cells;
    if (cells.length === 0) continue;
    const head = cells[0]!.text;
    if (head === "params" || head === "pins") {
      section = head;
      continue;
    }
    if (section === "params") {
      if (cells.length !== 3) {
        problems.push({ line: line.number, message: "a params row must be written as name type required|optional" });
        continue;
      }
      const [name, type, requirement] = cells.map((c) => c.text) as [string, string, string];
      if (!PARAM_TYPE_RE.test(name)) {
        problems.push({ line: line.number, message: `invalid parameter name: ${name}` });
        continue;
      }
      if (!PARAM_TYPE_RE.test(type)) {
        problems.push({ line: line.number, message: `invalid parameter type: ${type}` });
        continue;
      }
      if (requirement !== "required" && requirement !== "optional") {
        problems.push({ line: line.number, message: `invalid required/optional marker for parameter ${name}: ${requirement}` });
        continue;
      }
      params.push({ name, type, required: requirement === "required" });
      continue;
    }
    if (section === "pins") {
      if (cells.length < 3) {
        problems.push({ line: line.number, message: "a pins row needs at least 3 columns: number name type" });
        continue;
      }
      const number = cells[0]!.text;
      const name = cells[1]!.text;
      const type = cells[2]!.text;
      if (!PIN_NUMBER_RE.test(number)) {
        problems.push({ line: line.number, message: `invalid pin number: ${number}` });
        continue;
      }
      if (!PIN_NAME_RE.test(name)) {
        problems.push({ line: line.number, message: `invalid pin name: ${name}` });
        continue;
      }
      let unit = 1;
      for (const cell of cells.slice(3)) {
        const eq = cell.text.indexOf("=");
        if (eq <= 0) {
          problems.push({ line: line.number, message: `unrecognized trailing column: ${cell.text}` });
          continue;
        }
        const key = cell.text.slice(0, eq);
        const value = cell.text.slice(eq + 1);
        if (key === "unit") {
          const parsed = Number(value);
          if (!Number.isInteger(parsed) || parsed < 1) {
            problems.push({ line: line.number, message: `unit must be an integer no less than 1: ${value}` });
            continue;
          }
          unit = parsed;
          continue;
        }
        if (key === "alt") continue;
        problems.push({ line: line.number, message: `unknown pin column: ${key}` });
      }
      pins.push({ number, name, type, unit });
      continue;
    }
  }

  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, id: typeLine.cells[1]!.text, facts: { params, pins }, problems };
}
