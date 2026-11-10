// The geometry facts the drawing checks and metrics read (spec/schematic-view.md §9.2).
//
// The shapes mirror `packages/renderer`'s `schematicGeometry` output field for field: the renderer
// computes them with the same transforms and stroke-font metrics as the drawing itself, and the CLI
// hands them over structurally. Declaring them here (rather than importing the renderer) keeps
// `core` free of any drawing dependency — the two packages agree by shape, checked at the handoff.
import type { SchematicView } from "@texteda/ir/schematic-view";

export interface ReadabilityBox {
  readonly min_x_nm: number;
  readonly min_y_nm: number;
  readonly max_x_nm: number;
  readonly max_y_nm: number;
}

export interface ReadabilityText {
  /** `label` and `port` carry a net (or a port id) and must sit on it; `text` is an annotation. */
  readonly kind: "label" | "port" | "text";
  readonly text: string;
  /** The anchor point: the label's position, the port's tip, the note's start. */
  readonly x_nm: number;
  readonly y_nm: number;
  readonly box: ReadabilityBox;
  /**
   * The view record's IR path (`/label/3`). The line it was written on comes from the parse's
   * source map, keyed by that path (ADR-0004 D1: the IR carries no line numbers).
   */
  readonly ir_path?: string;
  /** `label` and `port` carry a net (or a project port id) and must sit on it; `text` is an annotation. */
  readonly subject?: string;
}

export interface ReadabilitySymbol {
  readonly instance_id: string;
  readonly box: ReadabilityBox;
  readonly pins: ReadonlyMap<string, { readonly x_nm: number; readonly y_nm: number }>;
}

/**
 * A field the symbol drew (Reference / Value), laid out on the sheet.
 *
 * Not a record of the view: the text is placed by the symbol's own `field` segments, so the author
 * cannot move it here. It is in these facts anyway because a reader cannot tell which text belongs
 * to which file — a line through a designator is unreadable whoever placed it.
 */
export interface ReadabilityField {
  readonly instance_id: string;
  /** The symbol's field name (`Reference` / `Value`). */
  readonly name: string;
  readonly text: string;
  readonly box: ReadabilityBox;
  /** The place row that put the instance there (`/place/3`): the record that owns the field's spot. */
  readonly ir_path?: string;
}

/**
 * A module box drawn on a project page.
 *
 * The box is a boundary, not a body: it says where the module's boundary is drawn, never what is
 * inside it (ADR-0067 D4). The module's parts live in the module file and are drawn on detail pages,
 * so a box carries no pins and no fields.
 */
export interface ReadabilityModule {
  readonly instance_id: string;
  readonly box: ReadabilityBox;
}

export interface ReadabilityGeometry {
  readonly texts: readonly ReadabilityText[];
  readonly fields: readonly ReadabilityField[];
  readonly symbols: readonly ReadabilitySymbol[];
  /** The module boxes the page draws; absent on a page that draws no module. */
  readonly modules?: readonly ReadabilityModule[];
  /** Transformed endpoints for reusable module placements, keyed `<instance>.<port>`. */
  readonly modulePortPoints?: ReadonlyMap<string, { readonly x_nm: number; readonly y_nm: number }>;
}

/**
 * A module box as the print page declares it (`module` section, ADR-0067 D3).
 *
 * The box carries its own position and size: the page's size is the page's extent, the box's size
 * is the module's drawn extent. Neither says what is inside the box.
 */
export interface ViewModuleBox {
  readonly instance_id: string;
  readonly module_id: string;
  readonly x_nm: number;
  readonly y_nm: number;
  readonly width_nm: number;
  readonly height_nm: number;
}

/**
 * A module port as the print page declares it (`module_port` section, ADR-0067 D3).
 *
 * The id is `<module_instance_id>.<port_id>`: it is the endpoint identity a wire may end on
 * (`M1.PORT`), not a pin of a symbol.
 */
export interface ViewModulePort {
  readonly id: string;
  readonly x_nm: number;
  readonly y_nm: number;
}

/** Module frame arrays retained as structural helpers for the generated view IR. */
export interface ViewModuleFacts {
  readonly module?: readonly ViewModuleBox[];
  readonly module_port?: readonly ViewModulePort[];
}
/** A reusable module drawing and the authoritative identities of its electrical definition. */
export interface ModuleDrawingFacts {
  readonly module_id: string;
  readonly bounds: { readonly width_nm: number; readonly height_nm: number };
  readonly place: readonly { readonly instance_id: string }[];
  readonly nets: readonly { readonly id: string }[];
  readonly ports: readonly { readonly id: string }[];
  readonly port: readonly { readonly id: string; readonly x_nm: number; readonly y_nm: number }[];
  /** Geometry anchors and bend points in the local drawing coordinate system. */
  readonly points?: readonly { readonly x_nm: number; readonly y_nm: number }[];
  readonly wire?: readonly { readonly net: string; readonly from_pin: string; readonly to_pin: string; readonly points?: readonly { readonly x_nm: number; readonly y_nm: number }[] }[];
  readonly label?: readonly { readonly net: string; readonly x_nm: number; readonly y_nm: number }[];
}

/** Static page furniture and its declared extent. */
export interface SheetTemplateFacts {
  readonly template_id: string;
  readonly size: { readonly width_nm: number; readonly height_nm: number };
  readonly line?: readonly { readonly start: { readonly x_nm: number; readonly y_nm: number }; readonly end: { readonly x_nm: number; readonly y_nm: number } }[];
  readonly rect?: readonly { readonly start: { readonly x_nm: number; readonly y_nm: number }; readonly end: { readonly x_nm: number; readonly y_nm: number } }[];
  readonly polyline?: readonly { readonly points: readonly { readonly x_nm: number; readonly y_nm: number }[] }[];
  readonly text?: readonly { readonly x_nm: number; readonly y_nm: number }[];
}

/** Optional composition fields, structural to keep core independent of renderer artifacts. */
export interface ViewCompositionFacts {
  readonly template?: string;
  readonly module_place?: readonly { readonly instance_id: string; readonly module_id: string; readonly x_nm: number; readonly y_nm: number; readonly rot_mdeg?: 0 | 90000 | 180000 | 270000 }[];
}

/** The composition fields on a page, as carried by the view IR. */
export function viewCompositionFacts(view: SchematicView): ViewCompositionFacts {
  return view as SchematicView & ViewCompositionFacts;
}

/**
 * The module facts of a print page.
 *
 * Both arrays are optional: a page may draw no module, and the view leaves the fields out entirely
 * rather than carrying them empty. They remain structurally available alongside reusable module
 * placements.
 */
export function viewModuleFacts(view: SchematicView): ViewModuleFacts {
  return view as SchematicView & ViewModuleFacts;
}
