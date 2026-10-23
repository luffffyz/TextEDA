// The device rule table (ADR-0038 D7).
//
// Device engineering knowledge, not language structure: the table changes when the device world
// changes, so it lives next to the language (in the tool), not inside it. Closed and
// fail-closed — an unknown construction is an error, because the rules that branch on it
// (ADR-0029's envelope rule: a land pattern may carry a generic body only where the package
// determines the body) would otherwise be skipped silently. A silent miss is worse than an error.
//
// Pure functions: they consume facts, touch no filesystem and know no syntax, so the parser,
// the LSP and `check` all apply the same rules.
import type { Diagnostic } from "@texteda/ir/diagnostics";

/** One parameter column of a device: the role, its quantity, and whether it must be stated. */
export interface DeviceRole {
  /** The role name — the `params` column name. */
  readonly name: string;
  /** The quantity — the `params` column type. */
  readonly type: string;
  /** Required when the value decides whether the specification is realisable in the fixed package. */
  readonly required: boolean;
}

/** One construction: the technology of a generic device, and the roles it accepts. */
export interface DeviceConstruction {
  /** The quantity of the primary role (`value`). */
  readonly primary: string;
  readonly roles: readonly DeviceRole[];
}

/**
 * The closed set of constructions.
 *
 * The roles per construction are the baseline of `spec/teda.md` §6.2.2: a role is **required**
 * when the specification is incomplete without it — the required set of a construction is what a
 * purchasing document says about it (`100nF ±10% 16V X7R`, `10k ±1%`, `10uH ±20% 3A`). A role is
 * **optional** when it picks within the class (ESR, DCR) or when the package already decides it
 * (a resistor's power rating).
 *
 * The roles are listed in the conventional order; a device file declares them in its own order
 * (the `params` section order is the instance row's column order), and only the set is checked.
 *
 * `film` has no `dielectric` role: that role's values are the IEC 60068-4 temperature
 * characteristic codes, which are an MLCC's vocabulary. A film's material class would need a
 * second vocabulary, which is not decided (ADR-0038, open points).
 */
export const DEVICE_CONSTRUCTIONS: Record<string, DeviceConstruction> = {
  mlcc: {
    primary: "capacitance",
    roles: [
      { name: "value", type: "capacitance", required: true },
      { name: "tolerance", type: "percent", required: true },
      { name: "voltage", type: "voltage", required: true },
      { name: "dielectric", type: "string", required: true },
    ],
  },
  film: {
    primary: "capacitance",
    roles: [
      { name: "value", type: "capacitance", required: true },
      { name: "tolerance", type: "percent", required: true },
      { name: "voltage", type: "voltage", required: true },
      { name: "esr", type: "resistance", required: false },
    ],
  },
  tantalum: {
    primary: "capacitance",
    roles: [
      { name: "value", type: "capacitance", required: true },
      { name: "tolerance", type: "percent", required: true },
      { name: "voltage", type: "voltage", required: true },
      { name: "esr", type: "resistance", required: false },
    ],
  },
  electrolytic: {
    primary: "capacitance",
    roles: [
      { name: "value", type: "capacitance", required: true },
      { name: "tolerance", type: "percent", required: true },
      { name: "voltage", type: "voltage", required: true },
      { name: "esr", type: "resistance", required: false },
    ],
  },
  thick: {
    primary: "resistance",
    roles: [
      { name: "value", type: "resistance", required: true },
      { name: "tolerance", type: "percent", required: true },
      { name: "power", type: "power", required: false },
    ],
  },
  thin: {
    primary: "resistance",
    roles: [
      { name: "value", type: "resistance", required: true },
      { name: "tolerance", type: "percent", required: true },
      { name: "power", type: "power", required: false },
    ],
  },
  shielded: {
    primary: "inductance",
    roles: [
      { name: "value", type: "inductance", required: true },
      { name: "tolerance", type: "percent", required: true },
      { name: "rated_current", type: "current", required: true },
      { name: "sat_current", type: "current", required: false },
      { name: "dcr", type: "resistance", required: false },
    ],
  },
  molded: {
    primary: "inductance",
    roles: [
      { name: "value", type: "inductance", required: true },
      { name: "tolerance", type: "percent", required: true },
      { name: "rated_current", type: "current", required: true },
      { name: "sat_current", type: "current", required: false },
      { name: "dcr", type: "resistance", required: false },
    ],
  },
};

/** The constructions, in a stable order (for diagnostics and generated docs). */
export const DEVICE_CONSTRUCTION_NAMES: readonly string[] = Object.keys(DEVICE_CONSTRUCTIONS);

/**
 * The roles whose quantity the vocabulary fixes (`spec/teda.md` §6.2.1).
 *
 * `value` is deliberately not here: its quantity is the construction's primary (resistance,
 * capacitance, inductance), and a part declares no construction — it states the quantity of its
 * own `value` row (ADR-0039 D3).
 */
export const DEVICE_ROLE_TYPES: Record<string, string> = {
  tolerance: "percent",
  voltage: "voltage",
  power: "power",
  dielectric: "string",
  esr: "resistance",
  dcr: "resistance",
  rated_current: "current",
  sat_current: "current",
};

/** The role that names a device's primary quantity, whatever its construction. */
export const DEVICE_PRIMARY_ROLE = "value";

/**
 * Closed value sets, keyed by role.
 *
 * A member is the only legal spelling: no normalisation, no aliases. Two spellings of one code
 * would be two BOM lines (the BOM line key is the device id plus the parameter values).
 */
export const DEVICE_PARAM_VALUE_SETS: Record<string, readonly string[]> = {
  // IEC 60068-4 temperature characteristic codes.
  dielectric: ["C0G", "NP0", "X5R", "X5S", "X6S", "X7R", "Y5V"],
};

/** One declared parameter column, with where it was written. */
export interface DeviceParamFact {
  readonly name: string;
  readonly type: string;
  readonly required: boolean;
  readonly line: number;
  readonly col: number;
}

/** What the declaration checks need to know about a device file. */
export interface DeviceDeclarationFacts {
  /** The file the facts come from (path relative to the project root). */
  readonly file: string;
  /** The construction of a generic (`mlcc`, `tantalum`, …). Absent for a part. */
  readonly construction?: string | undefined;
  /** Where the construction was written. */
  readonly constructionLine?: number | undefined;
  readonly constructionCol?: number | undefined;
  /** The declared parameter columns. */
  readonly params: readonly DeviceParamFact[];
}

/** The roles a construction accepts, as a readable list. */
function roleList(construction: DeviceConstruction): string {
  return construction.roles.map((r) => `${r.name}${r.required ? "" : " (optional)"}`).join(", ");
}

/**
 * Check a generic's declaration against the rule table.
 *
 * Four things can be wrong (ADR-0038 D4/D6):
 * 1. the construction is not in the closed set — the rules that branch on it would be skipped;
 * 2. a declared role is not a role of this construction;
 * 3. the role's quantity is not the one the table gives it;
 * 4. a role the construction requires is missing, or a required role is declared optional.
 */
export function checkDeviceDeclaration(facts: DeviceDeclarationFacts): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const construction = facts.construction;
  // A part has no construction and no parameters: the part number fixes the device (ADR-0027).
  if (construction === undefined) return diagnostics;

  const rule = DEVICE_CONSTRUCTIONS[construction];
  if (rule === undefined) {
    diagnostics.push({
      code: "value.component-construction-invalid",
      severity: "error",
      message: `unknown construction: ${construction}`,
      location: { file: facts.file, line: facts.constructionLine ?? 1, col: facts.constructionCol ?? 1 },
      expected: `one of: ${DEVICE_CONSTRUCTION_NAMES.join(", ")}`,
      actual: construction,
      hint: "the construction is a closed vocabulary: the rules that branch on it (a land pattern may carry a generic body only where the package fixes the body) cannot run on an unknown value",
    });
    return diagnostics;
  }

  const byName = new Map(rule.roles.map((r) => [r.name, r]));

  for (const param of facts.params) {
    const expected = byName.get(param.name);
    if (expected === undefined) {
      diagnostics.push({
        code: "value.component-param-invalid",
        severity: "error",
        message: `${param.name} is not a parameter of a ${construction}`,
        location: { file: facts.file, line: param.line, col: param.col },
        expected: `one of: ${roleList(rule)}`,
        actual: param.name,
        hint: "a parameter column is a role (what it measures) and a quantity (its unit); the roles of a construction are fixed",
      });
      continue;
    }
    if (expected.type !== param.type) {
      diagnostics.push({
        code: "value.component-param-invalid",
        severity: "error",
        message: `${param.name} has type ${param.type}, but a ${construction} measures it as ${expected.type}`,
        location: { file: facts.file, line: param.line, col: param.col },
        expected: expected.type,
        actual: param.type,
      });
    }
    if (expected.required !== param.required) {
      diagnostics.push({
        code: "value.component-param-invalid",
        severity: "error",
        message: expected.required
          ? `${param.name} is required for a ${construction}, but it is declared optional`
          : `${param.name} is optional for a ${construction}, but it is declared required`,
        location: { file: facts.file, line: param.line, col: param.col },
        expected: expected.required ? "required" : "optional",
        actual: param.required ? "required" : "optional",
        hint: "a parameter is required when the specification is incomplete without it: the required set of a construction is what a purchasing document says about it",
      });
    }
  }

  for (const role of rule.roles) {
    if (!role.required) continue;
    if (facts.params.some((p) => p.name === role.name)) continue;
    diagnostics.push({
      code: "value.component-param-invalid",
      severity: "error",
      message: `a ${construction} must declare the parameter ${role.name}`,
      location: { file: facts.file, line: facts.constructionLine ?? 1, col: facts.constructionCol ?? 1 },
      expected: `params ${role.name} ${role.type} required`,
      actual: "not declared",
      hint: "the specification is incomplete without it: the required set of a construction is what a purchasing document says about it",
    });
  }

  return diagnostics;
}

/**
 * Check a parameter value against its role's closed value set.
 *
 * Only roles whose value is a code (not a quantity) have one; a role without a set accepts any
 * text. The spelling must be a member: no normalisation, no aliases.
 */
export function checkDeviceParamValue(
  role: string,
  text: string,
  location: { file: string; line: number; col: number },
): Diagnostic[] {
  return valueSetDiagnostic(role, text, location, "value.component-param-value-invalid");
}

/**
 * Check a rating value against its role's closed value set.
 *
 * The same sets as the parameters' (a `dielectric` is spelled the same way wherever it is
 * written), but a different construct: this is a part's own rating, not a column an instance
 * row fills (ADR-0039 D1).
 */
export function checkDeviceRatingValue(
  role: string,
  text: string,
  location: { file: string; line: number; col: number },
): Diagnostic[] {
  return valueSetDiagnostic(role, text, location, "value.component-rating-value-invalid");
}

/** The shared body of the two value-set checks. */
function valueSetDiagnostic(
  role: string,
  text: string,
  location: { file: string; line: number; col: number },
  code: "value.component-param-value-invalid" | "value.component-rating-value-invalid",
): Diagnostic[] {
  const set = DEVICE_PARAM_VALUE_SETS[role];
  if (set === undefined) return [];
  if (set.includes(text)) return [];
  return [
    {
      code,
      severity: "error",
      message: `invalid ${role}: ${text}`,
      location,
      expected: `one of: ${set.join(", ")}`,
      actual: text,
      hint: "the value set is closed and the spelling is exact: two spellings of one code would be two BOM lines",
    },
  ];
}

/** One rating row of a part. */
export interface DeviceRatingFact {
  readonly name: string;
  readonly type: string;
  readonly value: string;
  readonly line: number;
  readonly col: number;
}

/** What the rating checks need to know about a device file. */
export interface DeviceRatingFacts {
  /** The file the facts come from (path relative to the project root). */
  readonly file: string;
  readonly ratings: readonly DeviceRatingFact[];
}

/**
 * Check a part's ratings against the role vocabulary (ADR-0039 D3).
 *
 * Three things can be wrong: the role is not one of the vocabulary's, the row's quantity is not
 * the one the vocabulary gives that role, and the same rating is written twice. The value
 * itself is the caller's business (the parser owns the syntax) and its closed value set is
 * checked by `checkDeviceRatingValue`.
 */
export function checkDeviceRatings(facts: DeviceRatingFacts): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const seen = new Set<string>();
  for (const rating of facts.ratings) {
    const location = { file: facts.file, line: rating.line, col: rating.col };
    const isPrimary = rating.name === DEVICE_PRIMARY_ROLE;
    const expected = isPrimary ? undefined : DEVICE_ROLE_TYPES[rating.name];
    if (!isPrimary && expected === undefined) {
      diagnostics.push({
        code: "value.component-rating-invalid",
        severity: "error",
        message: `${rating.name} is not a rating role`,
        location,
        expected: `one of: ${Object.keys(DEVICE_ROLE_TYPES).join(", ")}, ${DEVICE_PRIMARY_ROLE}`,
        actual: rating.name,
        hint: "a rating is a role (what it measures) and a quantity (its unit); the roles are closed",
      });
      continue;
    }
    if (expected !== undefined && expected !== rating.type) {
      diagnostics.push({
        code: "value.component-rating-invalid",
        severity: "error",
        message: `${rating.name} has quantity ${rating.type}, but the vocabulary measures it as ${expected}`,
        location,
        expected,
        actual: rating.type,
      });
      continue;
    }
    if (seen.has(rating.name)) {
      diagnostics.push({
        code: "value.component-rating-invalid",
        severity: "error",
        message: `${rating.name} is written twice`,
        location,
        expected: "one row per rating",
        actual: rating.name,
      });
      continue;
    }
    seen.add(rating.name);
  }
  return diagnostics;
}
