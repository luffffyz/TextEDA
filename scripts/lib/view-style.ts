// Print-page house style: every stored coordinate is anchored on the 0.5 mm drawing lattice
// (ADR-0059 D1).
//
// Kept out of the gate entry points so importing the rule does not run the whole gate.
import type { SchematicView } from "@texteda/ir/schematic-view";

/** The drawing lattice every print-page coordinate is anchored on (ADR-0059 D1). */
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
 * House style for one print page (ADR-0059 D1).
 *
 * The rule covers every coordinate the page stores: a symbol's placement origin, a field anchor
 * (symbol-local), a module box corner and size, a module port, a wire bend, a label position, a
 * port position, and a note position. Wire *endpoints* are pin references rather than free
 * coordinates, so they are not checked here — the pin's own lattice is ADR-0057's business, and
 * the pin's position depends on the symbol the page places.
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

  for (const module of view.module ?? []) {
    if (offLattice(module.x_nm, module.y_nm)) report(`module ${module.instance_id} corner`, module.x_nm, module.y_nm);
    if (offLattice(module.width_nm, module.height_nm)) report(`module ${module.instance_id} size`, module.width_nm, module.height_nm);
  }
  for (const modulePort of view.module_port ?? []) {
    if (offLattice(modulePort.x_nm, modulePort.y_nm)) report(`module port ${modulePort.id}`, modulePort.x_nm, modulePort.y_nm);
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
