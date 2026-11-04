// Print-page house style: every stored coordinate is anchored on the 0.5 mm drawing lattice
// (ADR-0059 D1).
//
// Kept out of the gate entry points so importing the rule does not run the whole gate.
import type { SchematicView } from "@texteda/ir/schematic-view";

/** The drawing lattice every print-page coordinate is anchored on (ADR-0059 D1). */
export const VIEW_LATTICE_NM = 500_000;

function offLattice(xNm: number, yNm: number): boolean {
  return xNm % VIEW_LATTICE_NM !== 0 || yNm % VIEW_LATTICE_NM !== 0;
}

/**
 * House style for one print page (ADR-0059 D1).
 *
 * The rule covers every coordinate the page stores: a symbol's placement origin, a field anchor
 * (symbol-local), a wire bend, a label position, a port position, and a note position. Wire
 * *endpoints* are pin references rather than free coordinates, so they are not checked here — the
 * pin's own lattice is ADR-0057's business, and the pin's position depends on the symbol the
 * page places.
 */
export function viewHouseStyleProblems(
  name: string,
  view: SchematicView,
): string[] {
  const problems: string[] = [];
  const lattice = VIEW_LATTICE_NM / 1e6;

  const report = (what: string, xNm: number, yNm: number): void => {
    problems.push(
      `${name}: ${what} at (${xNm / 1e6}, ${yNm / 1e6}) mm is off the ${lattice} mm lattice (ADR-0059)`,
    );
  };

  for (const place of view.place ?? []) {
    if (offLattice(place.x_nm, place.y_nm)) report(`placement of ${place.instance_id}`, place.x_nm, place.y_nm);
  }
  for (const field of view.field ?? []) {
    if (offLattice(field.x_nm, field.y_nm)) {
      report(`field ${field.instance_id}.${field.name}`, field.x_nm, field.y_nm);
    }
  }
  for (const wire of view.wire ?? []) {
    for (const point of wire.points ?? []) {
      if (offLattice(point.x_nm, point.y_nm)) {
        report(`bend of wire ${wire.net} ${wire.from_pin}->${wire.to_pin}`, point.x_nm, point.y_nm);
      }
    }
  }
  for (const label of view.label ?? []) {
    if (offLattice(label.x_nm, label.y_nm)) report(`label of net ${label.net}`, label.x_nm, label.y_nm);
  }
  for (const port of view.port ?? []) {
    if (offLattice(port.x_nm, port.y_nm)) report(`port ${port.id}`, port.x_nm, port.y_nm);
  }
  for (const note of view.text ?? []) {
    if (offLattice(note.x_nm, note.y_nm)) report("note", note.x_nm, note.y_nm);
  }
  return problems;
}
