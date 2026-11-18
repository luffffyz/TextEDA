// The device rule table (ADR-0025 D7).
//
// Device engineering knowledge, not language structure: the table changes when the device world
// changes, so it lives next to the language (in the tool), not inside it. Closed and
// fail-closed — an unknown construction is an error, because the rules that branch on it
// (ADR-0028's envelope rule: a land pattern may carry a generic body only where the package
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
  /**
   * The language version this construction joined the closed vocabulary in.
   *
   * Omitted means it was in the vocabulary from the start. A file's version line declares the
   * language surface it is written against, so a file below this version has no such member in its
   * vocabulary and may not name it (ADR-0077 D5).
   */
  readonly since?: string;
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
 * second vocabulary, which is not decided (ADR-0025, open points).
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
  // A DC barrel jack (ADR-0077 D1): the class is a plug size, and a plug size is a fit, not a
  // range — 2.0 mm and 2.5 mm are different jacks. The current it carries and the voltage it
  // survives are requirements of the class, not of one part number.
  barrel: {
    primary: "length",
    since: "0.16",
    roles: [
      { name: "value", type: "length", required: true },
      { name: "rated_current", type: "current", required: true },
      { name: "voltage", type: "voltage", required: true },
    ],
  },
  // An indicator LED (ADR-0077 D2): the class is a colour, and the colour is a code, not a
  // quantity — there is no better green. The wavelength says how the colour was measured.
  indicator: {
    primary: "string",
    since: "0.16",
    roles: [
      { name: "value", type: "string", required: true },
      { name: "wavelength", type: "length", required: true },
    ],
  },
};

/** The constructions, in a stable order (for diagnostics and generated docs). */
export const DEVICE_CONSTRUCTION_NAMES: readonly string[] = Object.keys(DEVICE_CONSTRUCTIONS);

/**
 * What a rating role is (ADR-0026 D6) and how a stress check reads it (D5).
 *
 * `kind` says whether the role is a boundary the design must stay inside, a property used to
 * choose or describe a part, or a closed code. `direction` says how a stress check reads the
 * role's polarity: `symmetric` (either polarity stresses the part), `from` / `to` (only that
 * polarity does), `none` (the role is not a voltage stress). The four are the vocabulary of
 * directions; the roles that use them are listed in `DEVICE_ROLES` below (ADR-0075 D2: no role
 * reads `from` today — a MOSFET's `V_DS` and `V_GS` cover both polarities).
 */
export type RoleKind = "limit" | "characteristic" | "code";
export type RoleDirection = "symmetric" | "from" | "to" | "none";

export interface DeviceRoleRule {
  /** The role's quantity, when the vocabulary fixes it (`value`'s is the construction's primary). */
  readonly type?: string;
  /** What the role is. */
  readonly kind: RoleKind;
  /** How a stress check reads the role's polarity. */
  readonly direction: RoleDirection;
  /**
   * The language version this role joined the closed vocabulary in; omitted means it was there
   * from the start. A file below this version may not name it (ADR-0077 D5).
   */
  readonly since?: string;
}

/**
 * The closed role vocabulary (ADR-0025 D7, ADR-0026 D3/D5/D6, ADR-0075).
 *
 * `value` is deliberately not given a quantity here: its quantity is the construction's primary
 * (resistance, capacitance, inductance), and a part declares no construction — it states the
 * quantity of its own `value` row (ADR-0026 D3).
 *
 * The three voltage roles that name a pair of terminals say, in their direction, which polarity
 * of that pair their number bounds (ADR-0026 D4, ADR-0075 D1):
 *
 * - `drain_source_voltage` — the pair is the drain and the source, and the rating covers **both**
 *   polarities: a datasheet's `V_DS` bounds the difference in either direction;
 * - `gate_source_voltage` — the pair is the gate and the source, and the rating covers **both**
 *   polarities: `V_GS` is written with an explicit `±`;
 * - `reverse_voltage` — the pair is the anode and the cathode, and the rating covers **one**
 *   polarity, the reverse one: a diode's forward voltage is a characteristic, not a limit.
 *
 * The polarity is the role's, so it is not repeated in the part's file (ADR-0075 D1).
 */
export const DEVICE_ROLES: Record<string, DeviceRoleRule> = {
  value: { kind: "characteristic", direction: "none" },
  tolerance: { type: "percent", kind: "limit", direction: "none" },
  voltage: { type: "voltage", kind: "limit", direction: "symmetric" },
  power: { type: "power", kind: "limit", direction: "none" },
  dielectric: { type: "string", kind: "code", direction: "none" },
  esr: { type: "resistance", kind: "characteristic", direction: "none" },
  dcr: { type: "resistance", kind: "characteristic", direction: "none" },
  rated_current: { type: "current", kind: "limit", direction: "none" },
  sat_current: { type: "current", kind: "limit", direction: "none" },
  drain_source_voltage: { type: "voltage", kind: "limit", direction: "symmetric" },
  gate_source_voltage: { type: "voltage", kind: "limit", direction: "symmetric" },
  reverse_voltage: { type: "voltage", kind: "limit", direction: "to" },
  // The peak wavelength of a light source (ADR-0077 D2). It is a characteristic, not a limit:
  // nothing stresses an LED at 565 nm, and a part's wavelength says which bin its colour came
  // from. It is compared for equality, because a wavelength has no better direction.
  wavelength: { type: "length", kind: "characteristic", direction: "none", since: "0.16" },
};

/**
 * The roles whose quantity the vocabulary fixes (`spec/teda.md` §6.2.1).
 *
 * `value` is not here: its quantity is the construction's primary (resistance, capacitance,
 * inductance), and a part declares no construction — it states the quantity of its own `value`
 * row (ADR-0026 D3).
 */
export const DEVICE_ROLE_TYPES: Record<string, string> = Object.fromEntries(
  Object.entries(DEVICE_ROLES)
    .filter(([, rule]) => rule.type !== undefined)
    .map(([name, rule]) => [name, rule.type!]),
);

/** The role that names a device's primary quantity, whatever its construction. */
export const DEVICE_PRIMARY_ROLE = "value";

/** The electrical type the two poles of a polarised device carry. */
export const POLARIZED_PIN_TYPE = "polarized";

/**
 * The two poles of a polarised class: the pin it names as positive, and the other one.
 *
 * The poles are the pins typed `polarized` — a pin typed `passive` does not say which way round
 * it is — and the class names which of the two is the positive one (ADR-0078).
 *
 * `null` when the class does not say: a class written against a language before 0.17 names no
 * positive pin, and its requirement is then read as a magnitude, the way the language read it
 * before.
 */
export function polesOf(device: {
  readonly pins: readonly string[];
  readonly pin_types?: Readonly<Record<string, string>>;
  readonly positive_pin?: string;
}): { readonly positive: string; readonly negative: string } | null {
  const positive = device.positive_pin;
  if (positive === undefined) return null;
  const poles = device.pins.filter((pin) => device.pin_types?.[pin] === POLARIZED_PIN_TYPE);
  if (poles.length !== 2) return null;
  if (!poles.includes(positive)) return null;
  const negative = poles.find((pin) => pin !== positive);
  if (negative === undefined) return null;
  return { positive, negative };
}

/**
 * Closed value sets, keyed by role and then by the role's quantity.
 *
 * A member is the only legal spelling: no normalisation, no aliases. Two spellings of one code
 * would be two BOM lines (the BOM line key is the device id plus the parameter values).
 *
 * The second key is the quantity, because a role's quantity is what decides whether its value is
 * a code at all: `value` is a capacitance for an MLCC (no set — every capacitance is legal) and a
 * colour for an indicator (a set of seven). One table keyed by the role alone would have to hold
 * both, and the capacitor's capacitance would be read as a colour.
 */
export const DEVICE_PARAM_VALUE_SETS: Record<
  string,
  Readonly<Record<string, readonly string[]>>
> = {
  // IEC 60068-4 temperature characteristic codes. The quantity is `string`: a dielectric is a
  // class, not a measurement.
  dielectric: {
    string: ["C0G", "NP0", "X5R", "X5S", "X6S", "X7R", "Y5V"],
  },
  // The colours an indicator may show. A colour is a class, not a quantity (ADR-0077 D3), so the
  // set is closed like a dielectric's.
  //
  // `orange` is not a member: amber and orange are the same colour in two spellings, and a set
  // that held both would be the very failure mode a closed set exists to prevent — two BOM lines
  // for one colour. A project that needs a colour the set does not hold waits for a tool
  // upgrade (ADR-0025 D7), which is the price stated there.
  value: {
    string: ["red", "amber", "yellow", "green", "cyan", "blue", "white"],
  },
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
 * Four things can be wrong (ADR-0025 D4/D6):
 * 1. the construction is not in the closed set — the rules that branch on it would be skipped;
 * 2. a declared role is not a role of this construction;
 * 3. the role's quantity is not the one the table gives it;
 * 4. a role the construction requires is missing, or a required role is declared optional.
 */
export function checkDeviceDeclaration(facts: DeviceDeclarationFacts): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const construction = facts.construction;
  // A part has no construction and no parameters: the part number fixes the device (ADR-0024).
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
 * text. The spelling must be a member: no normalisation, no aliases. The quantity is part of the
 * key, so a set only applies to the values it was written for.
 */
export function checkDeviceParamValue(
  role: string,
  type: string,
  text: string,
  location: { file: string; line: number; col: number },
): Diagnostic[] {
  return valueSetDiagnostic(role, type, text, location, "value.component-param-value-invalid");
}

/**
 * Check a rating value against its role's closed value set.
 *
 * The same sets as the parameters' (a `dielectric` is spelled the same way wherever it is
 * written), but a different construct: this is a part's own rating, not a column an instance
 * row fills (ADR-0026 D1).
 */
export function checkDeviceRatingValue(
  role: string,
  type: string,
  text: string,
  location: { file: string; line: number; col: number },
): Diagnostic[] {
  return valueSetDiagnostic(role, type, text, location, "value.component-rating-value-invalid");
}

/** The shared body of the two value-set checks. */
function valueSetDiagnostic(
  role: string,
  type: string,
  text: string,
  location: { file: string; line: number; col: number },
  code: "value.component-param-value-invalid" | "value.component-rating-value-invalid",
): Diagnostic[] {
  const set = DEVICE_PARAM_VALUE_SETS[role]?.[type];
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
 * Check a part's ratings against the role vocabulary (ADR-0026 D3).
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
