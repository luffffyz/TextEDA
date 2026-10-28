// Unit conversion: the `.teda` surface uses numbers with units; the IR uses only integer nanometers / millidegrees / parts-per-million (ADR-0104 decision 3).
//
// Conversions are done with decimal strings + BigInt, **never through floating point**: `16.51mm` is
// 16510000.000000002 in binary floating point, and using that to decide "is it an integer nanometer value" would misreport.
// If the conversion result is not an integer, report an error; do not round.
import type { Diagnostic, DiagnosticCodeId } from "./diagnostics.ts";

export const LENGTH_UNITS: Record<string, bigint> = {
  m: 1_000_000_000n,
  mm: 1_000_000n,
  mil: 25_400n,
  in: 25_400_000n,
};

export const ANGLE_UNITS: Record<string, bigint> = {
  deg: 1_000n,
};

/** Parts per million: ratio × 1e6. */
const PPM_FACTOR = 1_000_000n;

/** Safe-integer limit: beyond it the value is no longer an exact integer (the IR only allows integers, so better to error out directly). */
const SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/** Parse result: success always carries a value, failure always carries a diagnostic (a discriminated union; callers narrow on `ok`). */
export type Parsed<T> = { ok: true; value: T } | { ok: false; diagnostic: Diagnostic };

interface Decimal {
  negative: boolean;
  /** Digit string with the decimal point removed, e.g. `0.95` → `95`; `1e-3` is not supported. */
  digits: string;
  /** Number of fractional digits. */
  scale: number;
}

const NUMBER_RE = /^([+-]?)(\d+(?:\.\d*)?|\.\d+)([a-zA-Zµ]*)$/;

function parseDecimal(text: string): { decimal: Decimal; unit: string } | null {
  const m = NUMBER_RE.exec(text);
  if (!m) return null;
  const body = m[2]!;
  const dot = body.indexOf(".");
  const intPart = dot === -1 ? body : body.slice(0, dot);
  const fracPart = dot === -1 ? "" : body.slice(dot + 1);
  return {
    decimal: {
      negative: m[1] === "-",
      digits: `${intPart === "" ? "0" : intPart}${fracPart}`,
      scale: fracPart.length,
    },
    unit: m[3] ?? "",
  };
}

/**
 * Decimal number × integer factor → exact integer; returns null when it does not divide evenly (precision finer than the smallest unit).
 */
function scaleExactly(decimal: Decimal, factor: bigint): bigint | null {
  const numerator = BigInt(decimal.digits) * factor;
  const denominator = 10n ** BigInt(decimal.scale);
  if (numerator % denominator !== 0n) return null;
  const value = numerator / denominator;
  return decimal.negative ? -value : value;
}

function toSafeNumber(value: bigint): number | null {
  if (value > SAFE || value < -SAFE) return null;
  return Number(value);
}

function fail(file: string, line: number, col: number, code: DiagnosticCodeId, message: string): Parsed<never> {
  return { ok: false, diagnostic: { code, severity: "error", message, location: { file, line, col } } };
}

function parseScaled(
  text: string,
  file: string,
  line: number,
  col: number,
  defaultUnit: string,
  code: DiagnosticCodeId,
  units: Record<string, bigint>,
  unitLabel: string,
  precisionLabel: string,
): Parsed<number> {
  const parsed = parseDecimal(text);
  if (!parsed) return fail(file, line, col, code, `not a valid number: ${text}`);
  const unitName = parsed.unit === "" ? defaultUnit : parsed.unit;
  const factor = units[unitName];
  if (factor === undefined) {
    return fail(
      file,
      line,
      col,
      code,
      `unknown ${unitLabel} unit: ${unitName} (available: ${Object.keys(units).join(" / ")})`,
    );
  }
  const scaled = scaleExactly(parsed.decimal, factor);
  if (scaled === null) {
    return fail(file, line, col, code, `finer than ${precisionLabel} precision: ${text}`);
  }
  const value = toSafeNumber(scaled);
  if (value === null) return fail(file, line, col, code, `value out of range: ${text}`);
  return { ok: true, value };
}

/** Length → integer nanometers. Default unit mm (given by the column type). */
export function parseLengthNm(
  text: string,
  file: string,
  line: number,
  col: number,
  defaultUnit = "mm",
  code: DiagnosticCodeId = "value.length-invalid",
): Parsed<number> {
  return parseScaled(text, file, line, col, defaultUnit, code, LENGTH_UNITS, "length", "nanometer");
}

/** Angle → integer millidegrees. Default unit degree. */
export function parseAngleMdeg(
  text: string,
  file: string,
  line: number,
  col: number,
  defaultUnit = "deg",
  code: DiagnosticCodeId = "value.angle-invalid",
): Parsed<number> {
  return parseScaled(text, file, line, col, defaultUnit, code, ANGLE_UNITS, "angle", "millidegree");
}

/**
 * Ratio (0…0.5) → integer parts per million. E.g. `0.25` → `250000`.
 * The IR forbids floating point (ADR-0104 decision 3), so ratios are converted to integers at the boundary.
 */
export function parsePpm(
  text: string,
  file: string,
  line: number,
  col: number,
  code: DiagnosticCodeId = "value.ratio-invalid",
): Parsed<number> {
  const parsed = parseDecimal(text);
  if (!parsed) return fail(file, line, col, code, `not a valid number: ${text}`);
  if (parsed.unit !== "") return fail(file, line, col, code, `ratio must not carry a unit: ${text}`);
  const ppm = scaleExactly(parsed.decimal, PPM_FACTOR);
  if (ppm === null) return fail(file, line, col, code, `ratio finer than parts-per-million precision: ${text}`);
  if (ppm < 0n || ppm > 500_000n) {
    return fail(file, line, col, code, `ratio out of range 0…0.5: ${text}`);
  }
  return { ok: true, value: Number(ppm) };
}

// Reverse rendering: integer boundary values → canonical surface text (units are always omitted; the column's default unit applies).
// These are the inverse of the parsing above: parse(format(v)) === v.

function fixedFromInt(value: number, decimals: number): string {
  const scale = 10 ** decimals;
  const negative = value < 0;
  const abs = Math.abs(value);
  const whole = Math.floor(abs / scale);
  const fraction = String(abs - whole * scale)
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction.length > 0 ? `.${fraction}` : ""}`;
}

/** Nanometers → mm (up to 6 decimal places, trailing zeros trimmed). */
export function formatLengthNm(nm: number): string {
  return fixedFromInt(nm, 6);
}

/** Millidegrees → degrees (up to 3 decimal places, trailing zeros trimmed). */
export function formatAngleMdeg(mdeg: number): string {
  return fixedFromInt(mdeg, 3);
}

/** Parts per million → ratio (up to 6 decimal places, trailing zeros trimmed). */
export function formatPpm(ppm: number): string {
  return fixedFromInt(ppm, 6);
}
