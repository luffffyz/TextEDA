// Quantity parsing: the surface writes `16V` / `100n` / `±1%` / `0.010Ω` / `4R7`; the IR stores **integers in canonical units**.
//
// Division of labor with `units.ts`: `units.ts` serves only symbols and footprints (the two geometric quantities, length and angle); this file is the general-purpose one for schematics.
//
// Conversion goes through decimal strings + BigInt, never through floating point (same rationale as `units.ts`): `0.1` is not an exact value in binary floating point,
// and using it to decide "is it an integer" would misreport. If an exact integer cannot be parsed, report an error; do not round.
//
// Unit conventions (an application of ADR-0008 decision 4, not a new standard):
//   resistance → µΩ, capacitance → fF, inductance → pH, voltage → µV, current → nA, power → µW, impedance → mΩ,
//   ratio → ppm, frequency → mHz, temperature → m°C.
// Within realistic value ranges every one of these tiers stays inside exact-integer range (100nF = 1e5 fF, 1F = 1e12 fF,
// both far below the 9.007e15 safe-integer limit), so no tier needs changing for safe-integer safety.
import type { DiagnosticCodeId } from "./diagnostics.ts";
import { IR_QUANTITY_SPECS, type IRQuantityKind, type IRQuantitySpec } from "@texteda/ir/units";

/**
 * The supported quantities. The dimensions themselves are defined by the IR (ADR-0008 decision 4); here we only add the fields parsing needs.
 *
 * Length and angle are not listed here: they are geometric quantities, parsed separately by `units.ts` (for symbols and footprints).
 */
export type QuantityKind = Exclude<IRQuantityKind, "length" | "angle">;

export interface QuantitySpec extends IRQuantitySpec {
  /** Explicit unit spellings (not eligible for prefix decoration, e.g. `%` / `C`). */
  units: readonly string[];
  /** Decimal exponent of the unit relative to the base unit (`%` = -2, everything else 0). */
  unitExp: number;
  /** Decimal exponent of the canonical unit relative to the base unit. */
  canonicalExp: number;
}

export const QUANTITY_SPECS: Record<QuantityKind, QuantitySpec> = {
  resistance: { ...IR_QUANTITY_SPECS.resistance, units: ["Ω", "ohm"], unitExp: 0, canonicalExp: 6 },
  capacitance: { ...IR_QUANTITY_SPECS.capacitance, units: ["F"], unitExp: 0, canonicalExp: 15 },
  inductance: { ...IR_QUANTITY_SPECS.inductance, units: ["H"], unitExp: 0, canonicalExp: 12 },
  voltage: { ...IR_QUANTITY_SPECS.voltage, units: ["V"], unitExp: 0, canonicalExp: 6 },
  current: { ...IR_QUANTITY_SPECS.current, units: ["A"], unitExp: 0, canonicalExp: 9 },
  power: { ...IR_QUANTITY_SPECS.power, units: ["W"], unitExp: 0, canonicalExp: 6 },
  impedance: { ...IR_QUANTITY_SPECS.impedance, units: ["Ω", "ohm"], unitExp: 0, canonicalExp: 3 },
  percent: { ...IR_QUANTITY_SPECS.percent, units: ["%"], unitExp: -2, canonicalExp: 6 },
  frequency: { ...IR_QUANTITY_SPECS.frequency, units: ["Hz"], unitExp: 0, canonicalExp: 3 },
  temperature: { ...IR_QUANTITY_SPECS.temperature, units: ["C", "°C"], unitExp: 0, canonicalExp: 3 },
};

/** Decimal exponent of the SI prefix. Both `u` and `µ` read as micro. */
const PREFIX_EXP: Record<string, number> = {
  p: -12,
  n: -9,
  u: -6,
  "µ": -6,
  m: -3,
  k: 3,
  K: 3,
  M: 6,
  G: 9,
};

/** Safe-integer limit: the IR only allows exact integers; beyond it, report an error instead of approximating. */
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/** Integer powers of 10 (all conversion depends on them; the exponent is the essence of the dimension). */
function pow10(exp: number): bigint {
  return 10n ** BigInt(exp);
}

export interface QuantityParseOk {
  ok: true;
  /** Integer in canonical units. */
  value: number;
  /** The input used tolerance syntax (`±1%` / `+-1%`) — the sign was consumed; the value is the magnitude. */
  tolerant: boolean;
}

export interface QuantityParseFail {
  ok: false;
  /** Diagnostic message (no location; the caller fills that in). */
  reason: string;
}

export type QuantityParseResult = QuantityParseOk | QuantityParseFail;

export interface QuantityParseOptions {
  /** Diagnostic code (supplied by the caller, from the registry, e.g. `value.invalid-value`). */
  code: DiagnosticCodeId;
}

/**
 * Parse one quantity.
 *
 * Supported spellings:
 * - `16V`, `0.010Ω`, `40mΩ`: digits + optional prefix + explicit unit;
 * - `10k`, `100n`: digits + prefix, unit determined by the column type;
 * - `1u`, `25`: digits only, unit determined by the column type;
 * - `4R7`, `0R05`: the R decimal-point spelling for resistance;
 * - `5k1`, `4u7`: prefix in the middle, last digit is the fractional digit;
 * - `±1%`, `+-1%`: tolerance spelling; returns the magnitude.
 */
export function parseQuantity(
  text: string,
  kind: QuantityKind,
  options: QuantityParseOptions,
): QuantityParseResult {
  const spec = QUANTITY_SPECS[kind];
  let body = text.trim();
  if (body.length === 0) return { ok: false, reason: "value must not be empty" };

  let tolerant = false;
  let negative = false;
  if (body.startsWith("±") || body.startsWith("+-")) {
    tolerant = true;
    body = body.slice(body.startsWith("±") ? 1 : 2);
  } else if (body.startsWith("-")) {
    negative = true;
    body = body.slice(1);
  } else if (body.startsWith("+")) {
    body = body.slice(1);
  }

  const plain = /^(\d*)(?:\.(\d*))?([^\d.]*)$/.exec(body);
  const embedded = /^(\d+)([A-Za-zµΩ°%]+)(\d+)$/.exec(body);
  if (!plain && !embedded) {
    return { ok: false, reason: `not a valid ${spec.label}: ${text}` };
  }

  let digits: string;
  let decimals: number;
  let suffix: string;
  let embeddedMarker = false;

  if (plain && plain[1] !== "" && (plain[2] !== undefined || plain[3] !== "")) {
    digits = plain[1]! + (plain[2] ?? "");
    decimals = plain[2]?.length ?? 0;
    suffix = plain[3] ?? "";
  } else if (embedded) {
    // `4R7` / `5k1` / `4u7`: the letter sits in the middle; the last digit is the fractional digit.
    digits = embedded[1]! + embedded[3]!;
    decimals = embedded[3]!.length;
    suffix = embedded[2]!;
    embeddedMarker = true;
  } else {
    return { ok: false, reason: `not a valid ${spec.label}: ${text}` };
  }

  if (digits.length === 0) return { ok: false, reason: `not a valid ${spec.label}: ${text}` };
  digits = digits.replace(/^0+(?=\d)/, "");

  // Suffix: prefix + unit, or prefix only (unit determined by the column type), or empty.
  let prefixExp = 0;

  if (suffix.length > 0) {
    if (embeddedMarker) {
      if (suffix === "R") {
        // R is just the decimal-point marker: neither prefix nor unit.
        if (kind !== "resistance") {
          return { ok: false, reason: `the R decimal-point spelling is only for resistance: ${text}` };
        }
      } else {
        const exp = PREFIX_EXP[suffix];
        if (exp === undefined) {
          return { ok: false, reason: `unknown unit or prefix: ${suffix}` };
        }
        prefixExp = exp;
      }
    } else {
      const isUnit = spec.units.some((u) => u === suffix);
      if (!isUnit) {
        // Try prefix + unit.
        let matched = false;
        for (const u of spec.units) {
          if (u.length < suffix.length && suffix.endsWith(u)) {
            const prefix = suffix.slice(0, suffix.length - u.length);
            const exp = PREFIX_EXP[prefix];
            if (exp !== undefined) {
              prefixExp = exp;
              matched = true;
              break;
            }
          }
        }
        if (!matched) {
          const exp = PREFIX_EXP[suffix];
          if (exp === undefined) {
            return { ok: false, reason: `unknown unit or prefix: ${suffix}` };
          }
          prefixExp = exp;
        }
      }
    }
  }

  const totalExp = prefixExp + spec.unitExp + spec.canonicalExp - decimals;
  let scaled: bigint;
  if (totalExp >= 0) {
    scaled = BigInt(digits) * pow10(totalExp);
  } else {
    const denom = pow10(-totalExp);
    const numerator = BigInt(digits);
    if (numerator % denom !== 0n) {
      return {
        ok: false,
        reason: `${spec.label} value is finer than the smallest unit (${spec.suffix}): ${text}`,
      };
    }
    scaled = numerator / denom;
  }
  if (negative) scaled = -scaled;
  if (scaled > MAX_SAFE || scaled < -MAX_SAFE) {
    return { ok: false, reason: `${spec.label} value exceeds the safe-integer range: ${text}` };
  }
  return { ok: true, value: Number(scaled), tolerant };
}

/** Parse a range `a..b` (closed interval). */
export function parseQuantityRange(
  text: string,
  kind: QuantityKind,
  options: QuantityParseOptions,
): { ok: true; min: number; max: number } | { ok: false; reason: string } {
  const parts = text.split("..");
  if (parts.length !== 2 || parts[0] === "" || parts[1] === "") {
    return { ok: false, reason: `range must be written as a..b: ${text}` };
  }
  const low = parseQuantity(parts[0]!, kind, options);
  if (!low.ok) return { ok: false, reason: low.reason };
  const high = parseQuantity(parts[1]!, kind, options);
  if (!high.ok) return { ok: false, reason: high.reason };
  if (low.value > high.value) {
    return { ok: false, reason: `range lower bound is greater than the upper bound: ${text}` };
  }
  return { ok: true, min: low.value, max: high.value };
}
