// Sorting comparators: canonical order recognizes only two things — ASCII byte order and the natural order of pad numbers.

/** ASCII byte order (not localeCompare: it is affected by the locale and the numeric option). */
export function byteCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Natural order: when both sides are pure digits, compare numerically (`2` comes before `10`); otherwise fall back to byte order. */
export function naturalCompare(a: string, b: string): number {
  if (/^\d+$/.test(a) && /^\d+$/.test(b)) return Number(a) - Number(b);
  return byteCompare(a, b);
}
