/**
 * Canonical order of the IR (teda.md §12).
 *
 * The IR depends on the semantics only: the order of rows and of members in the source must not leak into it.
 * These comparators are the single source of truth of that order, shared by the parser (which builds the IR),
 * the exporters (which project the IR), and any third-party implementation.
 *
 * Canonical order recognizes only two things — ASCII byte order and the natural order of identifiers.
 */

// ASCII byte order (not localeCompare: it is affected by the locale and the numeric option).
export function byteCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Split an identifier into digit and non-digit runs: "C10" → ["C", "10"], "U1.VSS_2" → ["U", "1", ".VSS_", "2"]. */
function runs(s: string): string[] {
  return s.match(/\d+|\D+/g) ?? [s];
}

/**
 * Natural order: digit runs compare numerically, so `C2` comes before `C10`.
 *
 * Everything else falls back to ASCII byte order. Identifiers that are equal
 * byte-wise but differ in digit runs (`C02` vs `C2`) are ordered by the number
 * of leading zeros, so the order stays total and stable.
 */
export function naturalCompare(a: string, b: string): number {
  if (a === b) return 0;
  const ra = runs(a);
  const rb = runs(b);
  const n = Math.min(ra.length, rb.length);
  for (let i = 0; i < n; i++) {
    const x = ra[i]!;
    const y = rb[i]!;
    if (x === y) continue;
    const xd = /^\d+$/.test(x);
    const yd = /^\d+$/.test(y);
    if (xd && yd) {
      const nx = Number(x);
      const ny = Number(y);
      if (nx !== ny) return nx < ny ? -1 : 1;
      // Same value, different spelling ("02" vs "2"): more leading zeros first.
      return x.length - y.length;
    }
    return byteCompare(x, y);
  }
  return ra.length - rb.length;
}

/**
 * Order pin references (`U1.2`, `U1.VSS_1`).
 *
 * The instance part comes first (natural order), then the pin. The instance part is everything before the last dot,
 * because a pin name may itself contain dots. A pin number is compared numerically when both
 * sides are numeric; otherwise the names compare by natural order, so `VSS_2` comes before `VSS_10`.
 */
export function pinRefCompare(a: string, b: string): number {
  const ai = a.lastIndexOf(".");
  const bi = b.lastIndexOf(".");
  if (ai < 0 || bi < 0) return naturalCompare(a, b);
  const instance = naturalCompare(a.slice(0, ai), b.slice(0, bi));
  if (instance !== 0) return instance;
  const pinA = a.slice(ai + 1);
  const pinB = b.slice(bi + 1);
  const aNum = /^\d+$/.test(pinA);
  const bNum = /^\d+$/.test(pinB);
  if (aNum && bNum) return Number(pinA) - Number(pinB);
  return naturalCompare(pinA, pinB);
}
