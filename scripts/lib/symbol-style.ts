// Symbol house style shared by the library verifier and its tests (ADR-0057 §1, ADR-0058 §1, §2,
// ADR-0074 D1).
//
// Kept out of scripts/verify-libs.ts so importing the rule does not run the whole verification.
import type { Symbol } from "@texteda/ir/symbol";

/** The symbol lattice and row-pitch house style: every pin point on both axes, rows >= 2.5 mm when numbered. */
const SYMBOL_LATTICE_NM = 500_000;
const SYMBOL_MIN_PITCH_NM = 2_500_000;

/** How far a pin's inner end may sit off the body's edge: the file resolution, `0.01 mm`. */
const SYMBOL_BODY_TOLERANCE_NM = 10_000;

/**
 * The direction a pin's tail runs, from its connection point toward the body.
 * The same convention the renderer draws with (`packages/renderer/src/svg.ts`, `pinDirection`).
 */
function pinTailDirection(rotationMdeg: number): { x: number; y: number } {
  const r = (((Math.round(rotationMdeg / 1000) % 360) + 360) % 360);
  switch (r) {
    case 90:
      return { x: 0, y: 1 };
    case 180:
      return { x: -1, y: 0 };
    case 270:
      return { x: 0, y: -1 };
    default:
      return { x: 1, y: 0 };
  }
}

/**
 * House style for one symbol (ADR-0057 §1, ADR-0058 §1, §2, ADR-0074 D1).
 *
 * Three rules, and they are different rules: the first is about every pin point on **both** axes, the
 * second only about the distance between adjacent pins on one side, the third about the pin's tail
 * reaching the body. A symbol that hides its pin numbers has nothing to separate, so the second
 * does not apply to it.
 *
 * The pin's **connection point** is on the lattice because a wire has to reach it (ADR-0074 D1).
 * The pin's inner end — the point where its tail meets the body — and the body itself are drawing:
 * they are anchored on the lattice where that is convenient, and nothing here rejects them when it
 * is not (ADR-0074 D2). One thing is not drawing: a tail that stops short of the body draws a pin
 * that touches nothing (`spec/symbol.md` §4.1), so the third rule asks the
 * inner end to land on the edge of the unit's visible `rect` body. A unit whose body is artwork
 * rather than a frame has no such edge, and is not checked.
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
  problems.push(...tailMissesBodyProblems(name, symbol));
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

/**
 * The pins whose tail stops short of their unit's visible `rect` body.
 *
 * The body is a frame: its edges are where the tails land. A unit whose body is artwork rather than
 * a frame (`c`, `l`, `led`) has no frame to land on and is not checked.
 */
function tailMissesBodyProblems(name: string, symbol: Symbol["symbol"]): string[] {
  const problems: string[] = [];
  const frames = (symbol.body ?? []).filter((item) => item.kind === "rect" && item.start && item.end);
  if (frames.length === 0) return problems;
  for (const pin of symbol.pins) {
    const unit = pin.unit ?? 1;
    const frame = frames.find((item) => (item.unit ?? 1) === unit);
    if (!frame || !frame.start || !frame.end) continue;
    const dir = pinTailDirection(pin.at.rotation_mdeg ?? 0);
    const innerX = pin.at.x_nm + dir.x * pin.length_nm;
    const innerY = pin.at.y_nm + dir.y * pin.length_nm;
    const minX = Math.min(frame.start.x_nm, frame.end.x_nm);
    const maxX = Math.max(frame.start.x_nm, frame.end.x_nm);
    const minY = Math.min(frame.start.y_nm, frame.end.y_nm);
    const maxY = Math.max(frame.start.y_nm, frame.end.y_nm);
    const tol = SYMBOL_BODY_TOLERANCE_NM;
    const onVerticalEdge =
      (Math.abs(innerX - minX) <= tol || Math.abs(innerX - maxX) <= tol) &&
      innerY >= minY - tol &&
      innerY <= maxY + tol;
    const onHorizontalEdge =
      (Math.abs(innerY - minY) <= tol || Math.abs(innerY - maxY) <= tol) &&
      innerX >= minX - tol &&
      innerX <= maxX + tol;
    if (onVerticalEdge || onHorizontalEdge) continue;
    problems.push(
      `${name}: pin ${pin.number} (unit ${unit}) ends at (${innerX / 1e6}, ${innerY / 1e6}) mm, ` +
        `off the body frame [${minX / 1e6}, ${minY / 1e6}, ${maxX / 1e6}, ${maxY / 1e6}]; ` +
        `the tail must meet the body`,
    );
  }
  return problems;
}
