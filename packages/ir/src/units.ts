/**
 * IR quantity table (ADR-0008 decision 4).
 *
 * The IR contains **no floating point**: quantities are always integers, and the canonical unit
 * is determined by the field-name suffix: `min_uv` is voltage (µV), `max_na` is current (nA),
 * `value_mohm` is impedance (mΩ).
 *
 * This table is the single source of truth of that convention, shared by three consumers:
 * - the parser (surface unit → canonical integer): `packages/parser/src/quantities.ts`;
 * - the generator (the "unit" column of the IR contract reference): `packages/ir/scripts/generate.ts`;
 * - any third-party implementation (convert according to the field-name suffix).
 *
 * Every conversion tier lands on exact integers within realistic ranges (100nF = 1e5 fF, 1F = 1e12 fF,
 * all far below the 9.007e15 safe-integer limit), so no tier needs changing for safe integers.
 */

/** Quantities supported by the IR. */
export type IRQuantityKind =
  | "resistance"
  | "capacitance"
  | "inductance"
  | "voltage"
  | "current"
  | "power"
  | "impedance"
  | "percent"
  | "frequency"
  | "temperature"
  | "length"
  | "angle";

export interface IRQuantitySpec {
  /** Human-readable name of the quantity, used in diagnostic messages and documentation. */
  readonly label: string;
  /** Suffix of the canonical unit in IR field names (`_uv` / `_na` / …). */
  readonly suffix: string;
  /** Base unit (the base of `µV` is `V`). */
  readonly baseLabel: string;
  /** Canonical unit symbol: the integer in the IR is a value in this unit. */
  readonly canonicalLabel: string;
  /** One-sentence description, cited directly by the documentation generator. */
  readonly description: string;
}

export const IR_QUANTITY_SPECS: Record<IRQuantityKind, IRQuantitySpec> = {
  resistance: {
    label: "Resistance",
    suffix: "uohm",
    baseLabel: "Ω",
    canonicalLabel: "µΩ",
    description: "Resistance, canonical unit µΩ (10⁻⁶ Ω).",
  },
  capacitance: {
    label: "Capacitance",
    suffix: "ff",
    baseLabel: "F",
    canonicalLabel: "fF",
    description: "Capacitance, canonical unit fF (10⁻¹⁵ F).",
  },
  inductance: {
    label: "Inductance",
    suffix: "ph",
    baseLabel: "H",
    canonicalLabel: "pH",
    description: "Inductance, canonical unit pH (10⁻¹² H).",
  },
  voltage: {
    label: "Voltage",
    suffix: "uv",
    baseLabel: "V",
    canonicalLabel: "µV",
    description: "Voltage, canonical unit µV (10⁻⁶ V).",
  },
  current: {
    label: "Current",
    suffix: "na",
    baseLabel: "A",
    canonicalLabel: "nA",
    description: "Current, canonical unit nA (10⁻⁹ A).",
  },
  power: {
    label: "Power",
    suffix: "uw",
    baseLabel: "W",
    canonicalLabel: "µW",
    description: "Power, canonical unit µW (10⁻⁶ W).",
  },
  impedance: {
    label: "Impedance",
    suffix: "mohm",
    baseLabel: "Ω",
    canonicalLabel: "mΩ",
    description: "Impedance, canonical unit mΩ (10⁻³ Ω).",
  },
  percent: {
    label: "Ratio",
    suffix: "ppm",
    baseLabel: "Ratio",
    canonicalLabel: "ppm",
    description: "Ratio, canonical unit ppm (10⁻⁶, i.e. 1% = 10⁴ ppm).",
  },
  frequency: {
    label: "Frequency",
    suffix: "mhz",
    baseLabel: "Hz",
    canonicalLabel: "mHz",
    description: "Frequency, canonical unit mHz (10⁻³ Hz).",
  },
  temperature: {
    label: "Temperature",
    suffix: "mdegc",
    baseLabel: "°C",
    canonicalLabel: "m°C",
    description: "Temperature, canonical unit m°C (10⁻³ °C).",
  },
  length: {
    label: "Length",
    suffix: "nm",
    baseLabel: "m",
    canonicalLabel: "nm",
    description: "Length, canonical unit nm (10⁻⁹ m).",
  },
  angle: {
    label: "Angle",
    suffix: "mdeg",
    baseLabel: "°",
    canonicalLabel: "m°",
    description: "Angle, canonical unit millidegrees (10⁻³ °).",
  },
};

/** Suffix → quantity. The generator looks up the unit by the last segment of a field name. */
export const IR_QUANTITY_BY_SUFFIX: Readonly<Record<string, IRQuantityKind>> = Object.freeze(
  Object.fromEntries(
    Object.entries(IR_QUANTITY_SPECS).map(([kind, spec]) => [spec.suffix, kind as IRQuantityKind]),
  ),
);

/**
 * Derive the quantity from an IR field name: `min_uv` → `voltage`.
 *
 * Only the last segment (the suffix after `_`) is recognized, to avoid mismatches like
 * reading `uv` as `u` + `v`. Returns `undefined` for non-quantity fields (e.g. `pin_number`, `net_id`).
 */
export function quantityOfField(fieldName: string): IRQuantityKind | undefined {
  const at = fieldName.lastIndexOf("_");
  if (at < 0) return undefined;
  return IR_QUANTITY_BY_SUFFIX[fieldName.slice(at + 1)];
}
