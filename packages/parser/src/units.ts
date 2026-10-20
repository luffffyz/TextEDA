// 单位换算：`.teda` 表面用带单位的数，IR 里只用整数纳米 / 毫度 / 百万分比（ADR-0004 决策 3）。
//
// 换算用十进制字符串 + BigInt 做，**不经浮点**：`16.51mm` 在二进制浮点里是
// 16510000.000000002，用它判断"是否整数纳米"会误报。换算结果不是整数时报错，不四舍五入。
import type { Diagnostic } from "./diagnostics.ts";

export const LENGTH_UNITS: Record<string, bigint> = {
  m: 1_000_000_000n,
  mm: 1_000_000n,
  mil: 25_400n,
  in: 25_400_000n,
};

export const ANGLE_UNITS: Record<string, bigint> = {
  deg: 1_000n,
};

/** 百万分比：比例 × 1e6。 */
const PPM_FACTOR = 1_000_000n;

/** 安全整数上限：超出就不再是精确整数（IR 只允许整数，宁可直接报错）。 */
const SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/** 解析结果：成功必有值，失败必有诊断（判别联合，调用方靠 `ok` 收窄）。 */
export type Parsed<T> = { ok: true; value: T } | { ok: false; diagnostic: Diagnostic };

interface Decimal {
  negative: boolean;
  /** 去掉小数点的数字串，如 `0.95` → `95`、`1e-3` 不支持。 */
  digits: string;
  /** 小数位数。 */
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
 * 十进制数 × 整数因子 → 精确整数；除不尽（精度超过最小单位）返回 null。
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

function fail(file: string, line: number, col: number, code: string, message: string): Parsed<never> {
  return { ok: false, diagnostic: { file, line, col, severity: "error", code, message } };
}

function parseScaled(
  text: string,
  file: string,
  line: number,
  col: number,
  defaultUnit: string,
  code: string,
  units: Record<string, bigint>,
  unitLabel: string,
  precisionLabel: string,
): Parsed<number> {
  const parsed = parseDecimal(text);
  if (!parsed) return fail(file, line, col, code, `不是合法的数值：${text}`);
  const unitName = parsed.unit === "" ? defaultUnit : parsed.unit;
  const factor = units[unitName];
  if (factor === undefined) {
    return fail(
      file,
      line,
      col,
      code,
      `未知的${unitLabel}单位：${unitName}（可用 ${Object.keys(units).join(" / ")}）`,
    );
  }
  const scaled = scaleExactly(parsed.decimal, factor);
  if (scaled === null) {
    return fail(file, line, col, code, `精度超过${precisionLabel}：${text}`);
  }
  const value = toSafeNumber(scaled);
  if (value === null) return fail(file, line, col, code, `数值超出范围：${text}`);
  return { ok: true, value };
}

/** 长度 → 整数纳米。默认单位 mm（列类型给出）。 */
export function parseLengthNm(
  text: string,
  file: string,
  line: number,
  col: number,
  defaultUnit = "mm",
  code = "F100",
): Parsed<number> {
  return parseScaled(text, file, line, col, defaultUnit, code, LENGTH_UNITS, "长度", "纳米");
}

/** 角度 → 整数毫度。默认单位度。 */
export function parseAngleMdeg(
  text: string,
  file: string,
  line: number,
  col: number,
  defaultUnit = "deg",
  code = "F100",
): Parsed<number> {
  return parseScaled(text, file, line, col, defaultUnit, code, ANGLE_UNITS, "角度", "毫度");
}

/**
 * 比例（0…0.5）→ 整数百万分比。如 `0.25` → `250000`。
 * IR 不许浮点（ADR-0004 决策 3），所以比例在边界就换算成整数。
 */
export function parsePpm(
  text: string,
  file: string,
  line: number,
  col: number,
  code = "F101",
): Parsed<number> {
  const parsed = parseDecimal(text);
  if (!parsed) return fail(file, line, col, code, `不是合法的数值：${text}`);
  if (parsed.unit !== "") return fail(file, line, col, code, `比例不带单位：${text}`);
  const ppm = scaleExactly(parsed.decimal, PPM_FACTOR);
  if (ppm === null) return fail(file, line, col, code, `比例精度超过百万分比：${text}`);
  if (ppm < 0n || ppm > 500_000n) {
    return fail(file, line, col, code, `比例超出范围 0…0.5：${text}`);
  }
  return { ok: true, value: Number(ppm) };
}

// 反向渲染：整数边界值 → canonical 表面文本（单位一律省略，按列默认单位写）。
// 与上面的解析互为逆运算：parse(format(v)) === v。

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

/** 纳米 → mm（最多 6 位小数，去尾零）。 */
export function formatLengthNm(nm: number): string {
  return fixedFromInt(nm, 6);
}

/** 毫度 → 度（最多 3 位小数，去尾零）。 */
export function formatAngleMdeg(mdeg: number): string {
  return fixedFromInt(mdeg, 3);
}

/** 百万分比 → 比例（最多 6 位小数，去尾零）。 */
export function formatPpm(ppm: number): string {
  return fixedFromInt(ppm, 6);
}
