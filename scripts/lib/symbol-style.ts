// Symbol house style shared by the library verifier and its tests (ADR-0057 §1, ADR-0058 §1, §2,
// ADR-0074 D1).
//
// Kept out of scripts/verify-libs.ts so importing the rule does not run the whole verification.
import type { Symbol } from "@texteda/ir/symbol";

/** The symbol lattice and row-pitch house style: every pin point on both axes, rows >= 2.5 mm when numbered. */
const SYMBOL_LATTICE_NM = 500_000;
const SYMBOL_MIN_PITCH_NM = 2_500_000;

/**
 * House style for one symbol (ADR-0057 §1, ADR-0058 §1, §2, ADR-0074 D1).
 *
 * Two rules, and they are different rules: the first is about every pin point on **both** axes, the
 * second only about the distance between adjacent pins on one side. A symbol that hides its pin
 * numbers has nothing to separate, so the second does not apply to it.
 *
 * The pin's **connection point** is on the lattice because a wire has to reach it (ADR-0074 D1).
 * The pin's inner end — the point where its tail meets the body — and the body itself are drawing:
 * they are anchored on the lattice where that is convenient, and nothing here rejects them when it
 * is not (ADR-0074 D2).
 */
export function symbolHouseStyleProblems(name: string, symbol: Symbol["symbol"]): string[] {
  const problems: string[] = [];
  const offLattice = symbol.pins.filter(
    (pin) => pin.at.x_nm % SYMBOL_LATTICE_NM !== 0 || pin.at.y_nm % SYMBOL_LATTICE_NM !== 0,
  );
  if (offLattice.length > 0) {
    problems.push(
      `${name}: pins off the ${SYMBOL_LATTICE_NM / 1e6} mm lattice: ${offLattice.map((p) => p.number).join(",")}`,
    );
  }
  if (symbol.pin_numbers_hidden) return problems;

  const rows = new Map<string, { axis: number; number: string }[]>();
  for (const pin of symbol.pins) {
    const rot = Math.round((pin.at.rotation_mdeg ?? 0) / 1000) % 360;
    const alongY = rot === 0 || rot === 180;
    const key = `${pin.unit}/${rot}/${alongY ? pin.at.x_nm : pin.at.y_nm}`;
    const row = rows.get(key) ?? [];
    row.push({ axis: alongY ? pin.at.y_nm : pin.at.x_nm, number: pin.number });
    rows.set(key, row);
  }
  for (const [key, row] of rows) {
    const sorted = [...row].sort((a, b) => a.axis - b.axis);
    for (let i = 1; i < sorted.length; i++) {
      const gap = sorted[i]!.axis - sorted[i - 1]!.axis;
      if (gap < SYMBOL_MIN_PITCH_NM) {
        problems.push(
          `${name}: pins ${sorted[i - 1]!.number}/${sorted[i]!.number} are ${gap / 1e6} mm apart ` +
            `(side ${key}); the floor is ${SYMBOL_MIN_PITCH_NM / 1e6} mm (ADR-0058)`,
        );
      }
    }
  }
  return problems;
}
