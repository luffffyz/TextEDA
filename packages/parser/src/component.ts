// The `component` description type: parse the whole file and enforce the part/family rules.
//
// Two kinds of device live in this one type (ADR-0027):
//
//   kind: part    a specific purchasable device. It names a manufacturer part number, and its
//                 identity is closed: the MPN fixes everything, so it declares no parameters.
//   kind: family  a device family. It names no part at all: the value, the tolerance and the
//                 ratings live in the `instances` row, and the family's own facts are its
//                 construction (the technology) and whether it is polarised.
//
// The pin table is the identity boundary (ADR-0027 decision 3): if the pin table changes, it is a
// different device, so only attributes that do not change a pin's electrical behaviour may become
// `params`. `package` and `footprint` are fixed attributes of the device, never parameters.
//
// The parser is filesystem-free (ADR-0009 decision 1): the caller supplies the text.

import type { Diagnostic, DiagnosticCodeId } from "./diagnostics.ts";
import { lex } from "./lexer.ts";
import { checkVersion, typeRange } from "./version.ts";

/** Pin electrical types from `teda.md` §10.1. */
export const PIN_TYPES: Record<string, true> = {
  input: true,
  output: true,
  bidirectional: true,
  tri_state: true,
  passive: true,
  power_in: true,
  power_out: true,
  power: true,
  open_collector: true,
  open_emitter: true,
  polarized: true,
  no_connect: true,
  unspecified: true,
};

/** The two kinds of device (ADR-0027 decision 1). */
export type ComponentKind = "part" | "family";

export const COMPONENT_KINDS: readonly ComponentKind[] = ["part", "family"];

/** Parameter types a `params` column may declare (`teda.md` §6.2). */
export const PARAM_TYPES: Record<string, true> = {
  resistance: true,
  capacitance: true,
  inductance: true,
  voltage: true,
  current: true,
  power: true,
  frequency: true,
  length: true,
  temperature: true,
  percent: true,
  integer: true,
  string: true,
};

/** One declared parameter column. */
export interface ComponentParamDecl {
  name: string;
  type: string;
  required: boolean;
}

/** One pin row. */
export interface ComponentPin {
  number: string;
  name: string;
  type: string;
  unit: number;
  alt?: string;
}

/** The parsed component file. */
export interface ComponentFile {
  /** The id in the `component <id>` header line. */
  id: string;
  kind: ComponentKind;
  mpn?: string;
  manufacturer?: string;
  category?: string;
  /** The technology of the device (family only): `mlcc`, `tantalum`, `film`, `shielded`, … */
  construction?: string;
  /** Whether the device is polarised (family only). */
  polarized?: boolean;
  package?: string;
  symbol: string;
  footprint: string;
  datasheet?: string;
  lcsc?: string;
  description?: string;
  params: ComponentParamDecl[];
  pins: ComponentPin[];
}

export interface ComponentParseResult {
  ok: boolean;
  component?: ComponentFile;
  diagnostics: Diagnostic[];
}

/** The `component` type exists since 0.1 (teda.md §13). */
const VERSION_RANGE = typeRange(1);

const PIN_NUMBER_RE = /^[A-Za-z0-9_+-]+$/;
const PIN_NAME_RE = /^[A-Za-z0-9_+-]+$/;
const PARAM_NAME_RE = /^[a-z][a-z0-9_]*$/;

/** Scalar keys a component file may carry before its first section (`teda.md` §6.1). */
const SCALAR_KEYS: Record<string, true> = {
  kind: true,
  mpn: true,
  manufacturer: true,
  category: true,
  construction: true,
  polarized: true,
  package: true,
  symbol: true,
  footprint: true,
  datasheet: true,
  lcsc: true,
  description: true,
};

/** Parameter names that may never become a `params` column (they are fixed attributes). */
const RESERVED_PARAM_NAMES: Record<string, true> = { package: true, footprint: true };

/**
 * Parse a component file.
 *
 * The rules enforced here are the ones a file can violate on its own: the part/family split
 * (ADR-0027), the parameter identity rule, and the pin table's syntax. Cross-file rules — that the
 * id matches the file name, that the symbol and footprint resolve, that the boards use the device —
 * belong to the caller.
 */
export function parseComponent(text: string, options: { file: string }): ComponentParseResult {
  const { file } = options;
  const diagnostics: Diagnostic[] = [];
  const error = (
    line: number,
    col: number,
    code: DiagnosticCodeId,
    message: string,
    extra?: { expected?: string; actual?: string; hint?: string },
  ) => {
    diagnostics.push({
      code,
      severity: "error",
      message,
      location: { file, line, col },
      ...(extra?.expected !== undefined ? { expected: extra.expected } : {}),
      ...(extra?.actual !== undefined ? { actual: extra.actual } : {}),
      ...(extra?.hint !== undefined ? { hint: extra.hint } : {}),
    });
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

  const component: ComponentFile = {
    id: typeLine.cells[1]!.text,
    kind: "part",
    symbol: "",
    footprint: "",
    params: [],
    pins: [],
  };

  /** Where each scalar was written, so a diagnostic can point at it. */
  const scalarAt = new Map<string, { line: number; col: number }>();
  const params: ComponentParamDecl[] = [];
  let section: string | null = null;
  let sectionLine = 0;

  for (let line = next(); line !== null; line = next()) {
    if (line.cells.length === 1) {
      section = line.cells[0]!.text;
      sectionLine = line.number;
      if (section !== "params" && section !== "pins") {
        error(line.number, line.cells[0]!.col, "syntax.unknown-section", `unknown section: ${section}`);
        section = null;
      }
      continue;
    }
    if (section === null) {
      const key = line.cells[0]!.text;
      const value = line.cells.slice(1).map((c) => c.text).join(" ");
      if (!SCALAR_KEYS[key]) {
        error(line.number, line.cells[0]!.col, "syntax.unknown-field", `unknown scalar: ${key}`);
        continue;
      }
      if (scalarAt.has(key)) {
        error(line.number, line.cells[0]!.col, "value.duplicate-field", `duplicate scalar: ${key}`);
        continue;
      }
      scalarAt.set(key, { line: line.number, col: line.cells[0]!.col });
      switch (key) {
        case "kind":
          if (value !== "part" && value !== "family") {
            error(line.number, line.cells[1]!.col, "value.component-kind-invalid", `kind must be part or family: ${value}`, {
              expected: "part | family",
              actual: value,
            });
          } else {
            component.kind = value;
          }
          break;
        case "polarized":
          if (value !== "yes" && value !== "no") {
            error(line.number, line.cells[1]!.col, "value.invalid-value", `polarized must be yes or no: ${value}`, {
              expected: "yes | no",
              actual: value,
            });
          } else {
            component.polarized = value === "yes";
          }
          break;
        case "mpn":
          component.mpn = value;
          break;
        case "manufacturer":
          component.manufacturer = value;
          break;
        case "category":
          component.category = value;
          break;
        case "construction":
          component.construction = value;
          break;
        case "package":
          component.package = value;
          break;
        case "symbol":
          component.symbol = value;
          break;
        case "footprint":
          component.footprint = value;
          break;
        case "datasheet":
          component.datasheet = value;
          break;
        case "lcsc":
          component.lcsc = value;
          break;
        case "description":
          component.description = value;
          break;
      }
      continue;
    }
    if (section === "params") {
      if (line.cells.length < 3) {
        error(line.number, line.cells[0]!.col, "syntax.row-too-short", "a params row needs 3 columns: name type required|optional");
        continue;
      }
      const [name, type, requirement] = line.cells as [
        (typeof line.cells)[number],
        (typeof line.cells)[number],
        (typeof line.cells)[number],
      ];
      if (!PARAM_NAME_RE.test(name.text)) {
        error(line.number, name.col, "syntax.invalid-identifier", `invalid parameter name: ${name.text}`);
        continue;
      }
      if (RESERVED_PARAM_NAMES[name.text]) {
        error(line.number, name.col, "value.component-param-reserved", `${name.text} is a fixed attribute, not a parameter`, {
          expected: "a parameter that is not part of the pin table's electrical behaviour",
          actual: name.text,
        });
        continue;
      }
      if (!PARAM_TYPES[type.text]) {
        error(line.number, type.col, "value.unknown-param-type", `unknown parameter type: ${type.text}`);
        continue;
      }
      if (requirement.text !== "required" && requirement.text !== "optional") {
        error(line.number, requirement.col, "value.invalid-value", `a params row ends with required or optional: ${requirement.text}`, {
          expected: "required | optional",
          actual: requirement.text,
        });
        continue;
      }
      if (params.some((p) => p.name === name.text)) {
        error(line.number, name.col, "value.duplicate-field", `duplicate parameter: ${name.text}`);
        continue;
      }
      params.push({ name: name.text, type: type.text, required: requirement.text === "required" });
      continue;
    }
    if (section === "pins") {
      if (line.cells.length < 3) {
        error(line.number, line.cells[0]!.col, "syntax.row-too-short", "a pins row needs at least 3 columns: number name type");
        continue;
      }
      const [number, name, type] = line.cells as [
        (typeof line.cells)[number],
        (typeof line.cells)[number],
        (typeof line.cells)[number],
      ];
      let tailOk = true;
      let unit = 1;
      let alt: string | undefined;
      for (const cell of line.cells.slice(3)) {
        const eq = cell.text.indexOf("=");
        const key = eq > 0 ? cell.text.slice(0, eq) : "";
        const value = eq > 0 ? cell.text.slice(eq + 1) : "";
        if (key === "unit") {
          if (!/^\d+$/.test(value) || Number(value) < 1) {
            error(line.number, cell.col, "value.pin-column-invalid", `unit must be a positive integer: ${value}`);
            tailOk = false;
          } else {
            unit = Number(value);
          }
        } else if (key === "alt") {
          if (!PIN_NAME_RE.test(value)) {
            error(line.number, cell.col, "value.pin-column-invalid", `invalid alt: ${value}`);
            tailOk = false;
          } else {
            alt = value;
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
      if (!PIN_TYPES[type.text]) {
        error(line.number, type.col, "value.electrical-type-unknown", `unknown electrical type: ${type.text}`);
        continue;
      }
      if (component.pins.some((p) => p.number === number.text)) {
        error(line.number, number.col, "library.duplicate-pin-number", `duplicate pin number: ${number.text}`);
        continue;
      }
      // An alternate function name must not collide with another pin's name in the same unit: the
      // names are what the schematic refers to. Repeated primary names are fine (two GND pins).
      if (alt && component.pins.some((p) => p.unit === unit && (p.name === alt || p.alt === alt))) {
        error(line.number, name.col, "library.field-invalid", `alternate pin name ${alt} collides with another pin name in unit ${unit}`);
        continue;
      }
      component.pins.push({ number: number.text, name: name.text, type: type.text, unit, ...(alt ? { alt } : {}) });
    }
  }

  component.params = params;

  /* ---- the part/family rules (ADR-0027) ---- */

  const kindAt = scalarAt.get("kind");
  if (!kindAt) {
    error(sectionLine || 1, 1, "value.component-kind-invalid", "a component file must declare its kind", {
      expected: "kind part | kind family",
      hint: "add a `kind` line: `part` for a specific device, `family` for a device family (teda.md §6.1.1; migration note: teda.md §13.4)",
    });
  }

  if (component.kind === "part") {
    if (!component.mpn) {
      error(scalarAt.get("mpn")?.line ?? (sectionLine || 1), scalarAt.get("mpn")?.col ?? 1, "value.component-mpn-invalid", "a part must declare its manufacturer part number", {
        expected: "mpn <part number>",
        hint: "a part is a specific device: it names the part number it is bought as",
      });
    }
    if (component.construction !== undefined || component.polarized !== undefined) {
      error(scalarAt.get("construction")?.line ?? scalarAt.get("polarized")?.line ?? (sectionLine || 1), 1, "value.component-family-fact-invalid", "construction and polarized are family facts, not part facts", {
        expected: "a part declares neither construction nor polarized",
        hint: "a part inherits its construction and polarity from the family it is chosen for",
      });
    }
    if (params.length > 0) {
      error(sectionLine || 1, 1, "value.component-identity-invalid", "a part must not declare parameters: its identity is closed", {
        expected: "a part declares no params section",
        hint: "the part number fixes the device; a value that varies belongs to a family",
      });
    }
  } else if (component.kind === "family") {
    if (component.mpn !== undefined) {
      error(scalarAt.get("mpn")?.line ?? (sectionLine || 1), scalarAt.get("mpn")?.col ?? 1, "value.component-mpn-invalid", "a family must not declare a manufacturer part number", {
        expected: "no mpn line",
        hint: "which part to buy is a project-local procurement decision, not a fact of the family",
      });
    }
    if (!component.construction) {
      error(scalarAt.get("construction")?.line ?? (sectionLine || 1), 1, "value.component-family-fact-invalid", "a family must declare its construction", {
        expected: "construction <technology>",
        hint: "the technology (mlcc, tantalum, film, shielded, …) is what tells two families apart",
      });
    }
    if (component.polarized === undefined) {
      error(scalarAt.get("polarized")?.line ?? (sectionLine || 1), 1, "value.component-family-fact-invalid", "a family must declare whether it is polarised", {
        expected: "polarized yes | polarized no",
      });
    }
    const identity = params.find((p) => p.name === "value" && p.required);
    if (!identity) {
      error(sectionLine || 1, 1, "value.component-identity-invalid", "a family must declare a required value parameter", {
        expected: "params value <type> required",
        hint: "the value is what tells two instances of the same family apart",
      });
    }
  }

  // Required parameters come first, so an instances row can omit optional columns from the right.
  const seenOptional = params.findIndex((p) => !p.required);
  if (seenOptional >= 0) {
    const late = params.findIndex((p, i) => i > seenOptional && p.required);
    if (late >= 0) {
      error(sectionLine || 1, 1, "value.component-param-order", "required parameters must come before optional ones", {
        expected: "all required columns first, then the optional ones",
        actual: params[late]!.name,
      });
    }
  }

  if (!component.symbol) {
    error(sectionLine || 1, 1, "syntax.unknown-field", "a component file must declare its symbol");
  }
  if (!component.footprint) {
    error(sectionLine || 1, 1, "syntax.unknown-field", "a component file must declare its footprint");
  }

  // Self-authored symbols store only views (ADR-0012): the pin facts needed to export a symbol can only come from a component.
  if (component.pins.length === 0) {
    error(sectionLine || 1, 1, "library.pins-empty", "the pins section must not be empty: pin facts for a self-authored symbol can only come from a component");
  }

  if (diagnostics.some((d) => d.severity === "error")) return { ok: false, diagnostics };
  return { ok: true, component, diagnostics };
}
