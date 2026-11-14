// Print-page house style: the coordinates that must reach each other sit on the 0.5 mm drawing
// lattice (ADR-0074 D1).
//
// Kept out of the gate entry points so importing the rule does not run the whole gate.
import type { SchematicView } from "@texteda/ir/schematic-view";

/** The drawing lattice the reachability coordinates are anchored on (ADR-0074 D1). */
export const VIEW_LATTICE_NM = 500_000;

/**
 * A module box as the overview page draws it (ADR-0067 D3): the module instance, the module it
 * instantiates, the box's upper-left corner and the box's own size. The box says where a boundary
 * is drawn, never what is inside it.
 *
 * The IR contract grows the `module` / `module_port` arrays with `v0.17`; the rule reads them
 * structurally, so a page that draws no module carries neither.
 */
export interface ViewModuleBox {
  readonly instance_id: string;
  readonly module_id: string;
  readonly x_nm: number;
  readonly y_nm: number;
  readonly width_nm: number;
  readonly height_nm: number;
}

/** A module port as the overview page draws it (ADR-0067 D3): where the port sits on the box. */
export interface ViewModulePort {
  readonly id: string;
  readonly x_nm: number;
  readonly y_nm: number;
}

/** A print page with the optional module rows of the `v0.17` contract. */
export type ViewWithModuleRows = SchematicView & {
  readonly module?: readonly ViewModuleBox[];
  readonly module_port?: readonly ViewModulePort[];
};

function offLattice(xNm: number, yNm: number): boolean {
  return xNm % VIEW_LATTICE_NM !== 0 || yNm % VIEW_LATTICE_NM !== 0;
}

/**
 * House style for one print page (ADR-0074 D1).
 *
 * The rule covers the coordinates that have to reach each other: a symbol's placement origin, a
 * wire's bend points, a port's position and a junction's position. The placement origin keeps the
 * placed symbol's pins on the lattice; a bend, a port and a junction are the places a wire turns or
 * ends, and a wire that leaves a lattice pin has to be able to reach them.
 *
 * The rest of the page is **free** — a field anchor, a label, a note, a module box's own geometry
 * (ADR-0074 D2). Those are drawing, not wiring: nothing on them has to line up with anything else,
 * and a label may sit anywhere along the wire it names, which is not a lattice point in general.
 * The lattice stays their convention, not their rule: anchor them on it where it is convenient.
 *
 * Wire *endpoints* are not free coordinates — they are pin references, a port or a junction, and
 * each of those is checked here or by the symbol's own lattice (ADR-0057 D1).
 */
export function viewHouseStyleProblems(
  name: string,
  view: SchematicView,
): string[] {
  const problems: string[] = [];
  const lattice = VIEW_LATTICE_NM / 1e6;

  const report = (what: string, xNm: number, yNm: number): void => {
    problems.push(
      `${name}: ${what} at (${xNm / 1e6}, ${yNm / 1e6}) mm is off the ${lattice} mm lattice (ADR-0074)`,
    );
  };

  for (const place of view.place ?? []) {
    if (offLattice(place.x_nm, place.y_nm)) report(`placement of ${place.instance_id}`, place.x_nm, place.y_nm);
  }
  for (const wire of view.wire ?? []) {
    for (const point of wire.points ?? []) {
      if (offLattice(point.x_nm, point.y_nm)) {
        report(`bend of wire ${wire.net} ${wire.from_pin}->${wire.to_pin}`, point.x_nm, point.y_nm);
      }
    }
  }
  for (const port of view.port ?? []) {
    if (offLattice(port.x_nm, port.y_nm)) report(`port ${port.id}`, port.x_nm, port.y_nm);
  }
  for (const junction of view.junction ?? []) {
    if (offLattice(junction.x_nm, junction.y_nm)) report(`junction ${junction.id}`, junction.x_nm, junction.y_nm);
  }
  return problems;
}
