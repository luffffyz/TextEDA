// Schematic print page -> drawing primitives.
//
// The view (S1) knows where symbols, wires, labels, fields, ports, and notes go. Field text and
// symbol geometry come from the caller's symbol and component facts; field anchors are resolved
// here from either view overrides or deterministic painted-body placement.
import type { SchematicView } from "@texteda/ir/schematic-view";
import { pinDirection, type SvgDoc, type SvgPrimitive, type SvgText } from "./svg.ts";
import { textAdvance } from "@texteda/core/font";
import { renderSymbol, type SymbolBody, type SymbolPart } from "./symbol.ts";
import { resolveSchematicFields } from "./field-placement.ts";
import {
  fieldTextAnchor,
  pageFacts,
  placePageFields,
  portTextAnchor,
  textBox,
  LABEL_SIZE_NM,
  NOTE_SIZE_NM,
  PORT_BODY_NM,
  PORT_HALF_NM,
  PORT_SIZE_NM,
  type FieldPlacement,
  type PageProjection,
} from "./field-layout.ts";
 
/** What the renderer needs to draw one placed instance: the symbol's geometry and the pin facts from `component`. */
export interface SchematicInstance {
  symbol: SymbolBody;
  part: SymbolPart;
  /**
   * The instance's value as the page should print it (`10kΩ`, `100nF`), when the device has one.
   *
   * The symbol's `Value` field is a library placeholder -- a generic part's file has no value to
   * name -- so the placed instance names itself, exactly as it does for `Reference`. A device
   * without a value column keeps the symbol's text.
   */
  value?: string;
}

type Place = SchematicView["place"][number];
type Wire = NonNullable<SchematicView["wire"]>[number];
type Label = NonNullable<SchematicView["label"]>[number];
type Port = NonNullable<SchematicView["port"]>[number];
type Note = NonNullable<SchematicView["text"]>[number];

/** Wire stroke width (0.1524mm, KiCad's 6 mil default). */
const WIRE_WIDTH_NM = 152_400;
/**
 * Junction dot radius. A join is drawn, not inferred: the dot says "these runs meet here", and its
 * absence is what tells a reader a crossing is not a connection. KiCad's default diameter (0.9144mm,
 * 36 mil) keeps the dot familiar and visible when a whole page is zoomed out.
 */
const JUNCTION_RADIUS_NM = 457_200;
const FRAME_WIDTH_NM = 127_000;

interface Point {
  x: number;
  y: number;
}

/** Placement rotation in whole quadrants; the parser only accepts 0/90/180/270. */
function rotationOf(rotMdeg: number | undefined): 0 | 90 | 180 | 270 {
  const r = (((rotMdeg ?? 0) % 360_000) + 360_000) % 360_000;
  return (r / 1000) as 0 | 90 | 180 | 270;
}

/**
 * Symbol coordinates (+y up) -> sheet coordinates (+y down).
 *
 * The view's rotation is clockwise positive on the sheet (spec/schematic-view.md §2.1). In a y-down
 * frame a clockwise turn is the plain rotation matrix, so the four quadrants reduce to sign swaps.
 */
function toSheet(place: Place, x: number, y: number): Point {
  const { x_nm: x0, y_nm: y0 } = place;
  switch (rotationOf(place.rot_mdeg)) {
    case 90:
      return { x: x0 + y, y: y0 + x };
    case 180:
      return { x: x0 - x, y: y0 + y };
    case 270:
      return { x: x0 - y, y: y0 - x };
    default:
      return { x: x0 + x, y: y0 - y };
  }
}

/**
 * Sheet coordinates (+y down) -> symbol coordinates (+y up): the inverse of `toSheet`.
 *
 * A field that stepped aside is placed on the sheet, and the symbol's own frame is where a field
 * row would write it, so the sheet place goes back into the symbol's frame to be drawn.
 */
function toLocal(place: Place, x: number, y: number): Point {
  const { x_nm: x0, y_nm: y0 } = place;
  switch (rotationOf(place.rot_mdeg)) {
    case 90:
      return { x: y - y0, y: x - x0 };
    case 180:
      return { x: x0 - x, y: y - y0 };
    case 270:
      return { x: y0 - y, y: x0 - x };
    default:
      return { x: x - x0, y: y0 - y };
  }
}

/**
 * Symbol pin direction (`pinDirection`'s +y-up frame) -> sheet pin orientation (`pin` primitives are
 * drawn in the document's frame without an extra flip, so a sheet document needs the encoded angle).
 */
function toSheetPinRotation(place: Place, rotMdeg: number): number {
  const d = pinDirection(rotMdeg);
  let x: number;
  let y: number;
  switch (rotationOf(place.rot_mdeg)) {
    case 90:
      [x, y] = [d.y, d.x];
      break;
    case 180:
      [x, y] = [-d.x, d.y];
      break;
    case 270:
      [x, y] = [-d.y, -d.x];
      break;
    default:
      [x, y] = [d.x, -d.y];
      break;
  }
  if (x > 0) return 0;
  if (y > 0) return 90_000;
  if (x < 0) return 180_000;
  return 270_000;
}

/** Whether a primitive belongs to the drawn unit. `unit = 0` is shared by every unit (spec/symbol.md §3). */
function inUnit(primitive: SvgPrimitive, unit: number): boolean {
  const u = primitive.kind === "pad" ? 1 : (primitive.unit ?? 1);
  return u === 0 || u === unit;
}

/** One symbol primitive, moved from symbol coordinates into sheet coordinates. */
function placePrimitive(
  primitive: SvgPrimitive,
  place: Place,
  textAnchor?: "start" | "middle" | "end",
): SvgPrimitive {
  switch (primitive.kind) {
    case "line": {
      const a = toSheet(place, primitive.x1, primitive.y1);
      const b = toSheet(place, primitive.x2, primitive.y2);
      return { ...primitive, x1: a.x, y1: a.y, x2: b.x, y2: b.y };
    }
    case "rect": {
      const a = toSheet(place, primitive.x1, primitive.y1);
      const b = toSheet(place, primitive.x2, primitive.y2);
      return {
        ...primitive,
        x1: Math.min(a.x, b.x),
        y1: Math.min(a.y, b.y),
        x2: Math.max(a.x, b.x),
        y2: Math.max(a.y, b.y),
      };
    }
    case "circle": {
      const c = toSheet(place, primitive.cx, primitive.cy);
      return { ...primitive, cx: c.x, cy: c.y };
    }
    case "arc": {
      const a = toSheet(place, primitive.x1, primitive.y1);
      const m = toSheet(place, primitive.xm, primitive.ym);
      const b = toSheet(place, primitive.x2, primitive.y2);
      return { ...primitive, x1: a.x, y1: a.y, xm: m.x, ym: m.y, x2: b.x, y2: b.y };
    }
    case "poly":
    case "polyline":
      return { ...primitive, points: primitive.points.map((p) => toSheet(place, p.x, p.y)) };
    case "text": {
      const at = toSheet(place, primitive.x, primitive.y);
      const rotate = primitive.rotateMdeg;
      // A part turned a quarter turn carries its fields to the left and right of its body, where two
      // centered texts of any length run into each other (`220uF` under `M2.C3`). The text stays
      // horizontal and grows away from the part instead: the left field ends where it stands, the
      // right one starts there.
      const quarter = rotationOf(place.rot_mdeg) === 90 || rotationOf(place.rot_mdeg) === 270;
      const anchor =
        textAnchor ??
        fieldTextAnchor(quarter && primitive.role === "field", at.x, place.x_nm);
      return {
        ...primitive,
        ...(anchor === undefined ? {} : { anchor }),
        x: at.x,
        y: at.y,
        // Symbol text rotation is expressed in the symbol's +y-up frame. Placement rotation is clockwise
        // on the y-down sheet, so subtract it; the SVG serializer applies the resulting sheet rotation.
        ...(rotate === undefined
          ? {}
          : { rotateMdeg: (((rotate - rotationOf(place.rot_mdeg) * 1000) % 360_000 + 360_000) % 360_000) }),
      };
    }
    case "pin": {
      const at = toSheet(place, primitive.x, primitive.y);
      return {
        ...primitive,
        x: at.x,
        y: at.y,
        rotMdeg: toSheetPinRotation(place, primitive.rotMdeg),
      };
    }
    case "pad": {
      const c = toSheet(place, primitive.x, primitive.y);
      return { ...primitive, x: c.x, y: c.y };
    }
  }
}

function splitPinRef(ref: string): { instance: string; pin: string } {
  // The instance id may be module-qualified (`M1.U1`), so the split is at the last dot.
  const dot = ref.lastIndexOf(".");
  if (dot <= 0 || dot === ref.length - 1) {
    throw new Error(`schematic view: not a pin reference: ${ref}`);
  }
  return { instance: ref.slice(0, dot), pin: ref.slice(dot + 1) };
}

/** Connection point of one pin on the sheet; the view's wire endpoints must land exactly here. */
function pinPoint(place: Place, instance: SchematicInstance, pinNumber: string): Point {
  const pin = instance.symbol.pins.find((p) => p.number === pinNumber);
  if (!pin) {
    throw new Error(
      `schematic view: instance ${place.instance_id} has no symbol pin ${pinNumber}`,
    );
  }
  return toSheet(place, pin.at.x_nm, pin.at.y_nm);
}

/** Rotate a local vector clockwise by a quadrant, in sheet coordinates. */
function rotateVector(rot: 0 | 90 | 180 | 270, x: number, y: number): Point {
  switch (rot) {
    case 90:
      return { x: -y, y: x };
    case 180:
      return { x: -x, y: -y };
    case 270:
      return { x: y, y: -x };
    default:
      return { x, y };
  }
}

/** Optional page rendering decisions; omitted values preserve the current automatic behavior. */
export interface SchematicRenderOptions {
  /** Place Reference/Value fields around the page, or leave them at symbol-local positions. */
  readonly automaticFields?: boolean;
}

/**
 * Draw one print page: the sheet frame, every placed symbol, the wire runs, then the labels, ports and notes.
 *
 * Throws on a view that references an instance, symbol pin, or instance geometry that the caller did
 * not supply. Silence would draw a lie; the board cross-check (packages/core, backlog F3) owns the
 * diagnostic report, this renderer only refuses to invent geometry.
 */
export function renderSchematic(
  view: SchematicView,
  instances: ReadonlyMap<string, SchematicInstance>,
  options: SchematicRenderOptions = {},
): SvgDoc {
  const primitives: SvgPrimitive[] = [];

  // The sheet itself, at the view's declared size (origin = upper-left, +y down).
  primitives.push({
    kind: "rect",
    x1: 0,
    y1: 0,
    x2: view.sheet.width_nm,
    y2: view.sheet.height_nm,
    widthNm: FRAME_WIDTH_NM,
    fill: "none",
    layer: "sheet",
  });

  const placed = new Map<string, { place: Place; instance: SchematicInstance }>();
  for (const place of view.place) {
    if (placed.has(place.instance_id)) {
      throw new Error(`schematic view: instance ${place.instance_id} is placed twice`);
    }
    const instance = instances.get(place.instance_id);
    if (!instance) {
      throw new Error(`schematic view: no symbol facts for placed instance ${place.instance_id}`);
    }
    placed.set(place.instance_id, { place, instance });
  }

  // The fields are placed for the page as a whole: a designator that cannot stay where its symbol
  // wanted it steps aside (ADR-0064).
  const layout = pageLayout(view, instances, options);

  // A run may end at a port this page draws: the port's own anchor is the end point. Every point
  // on a sheet is nanometres here, the millimetre conversion happens when the drawing is written.
  const endpointPoints = new Map<string, Point>();
  for (const port of view.port ?? []) endpointPoints.set(port.id, { x: port.x_nm, y: port.y_nm });
  for (const junction of view.junction ?? []) endpointPoints.set(junction.id, { x: junction.x_nm, y: junction.y_nm });
  // Wires first: they run underneath the symbols, so a wire that ends on a pin is covered by the pin line.
  const runs: { net: string; points: Point[] }[] = [];
  for (const wire of view.wire ?? []) {
    const points = [
      wireEndpoint(placed, endpointPoints, wire.from_pin, "from_pin"),
      ...(wire.points ?? []).map((p) => ({ x: p.x_nm, y: p.y_nm })),
      wireEndpoint(placed, endpointPoints, wire.to_pin, "to_pin"),
    ];
    if (points.length < 2) continue;
    runs.push({ net: wire.net, points });
    primitives.push({
      kind: "polyline",
      points,
      widthNm: WIRE_WIDTH_NM,
      fill: "none",
      layer: "wire",
      ref: `net:${wire.net}`,
      net: wire.net,
    });
  }

  // Dots are authored graph nodes. Geometric crossings and coincident endpoints do not invent joins.
  for (const junction of view.junction ?? []) {
    primitives.push({
      kind: "circle",
      cx: junction.x_nm,
      cy: junction.y_nm,
      rNm: JUNCTION_RADIUS_NM,
      widthNm: WIRE_WIDTH_NM,
      fill: "solid",
      layer: "junction",
      ref: `junction:${junction.id}`,
    });
  }

  for (const { place } of placed.values()) {
    const ref = `instance:${place.instance_id}`;
    for (const primitive of layout.symbols.get(place.instance_id) ?? []) {
      const identity =
        primitive.kind === "text" && primitive.role === "field" && primitive.name !== undefined
          ? `field:${place.instance_id}:${primitive.name}`
          : ref;
      primitives.push({ ...primitive, ref: identity });
    }
  }
  for (const label of view.label ?? []) {
    primitives.push(labelPrimitive(label));
  }
  for (const port of view.port ?? []) {
    primitives.push(...portPrimitives(port));
  }
  for (const note of view.text ?? []) {
    primitives.push(notePrimitive(note));
  }

  return {
    kind: "schematic",
    title: `${view.board}/${view.page}`,
    orientation: "y-down",
    primitives,
  };
}

function wireEndpoint(
  placed: ReadonlyMap<string, { place: Place; instance: SchematicInstance }>,
  endpoints: ReadonlyMap<string, Point>,
  ref: string,
  column: string,
): Point {
  // A bare id names either a page port or a declared view junction.
  if (!ref.includes(".")) {
    const at = endpoints.get(ref);
    if (at === undefined) {
      throw new Error(`schematic view: wire ${column} ${ref} ends at a port or junction this page does not draw`);
    }
    return at;
  }
  const { instance: instanceId, pin } = splitPinRef(ref);
  const entry = placed.get(instanceId);
  if (!entry) {
    throw new Error(`schematic view: wire ${column} ${ref} refers to an instance that is not placed`);
  }
  return pinPoint(entry.place, entry.instance, pin);
}

/** Move one placed symbol; its fields use per-instance overrides or automatic painted-body anchors. */
function placeSymbol(
  instance: SchematicInstance,
  place: Place,
  unit: number,
  overrides: SchematicView["field"],
  placements?: ReadonlyMap<string, FieldPlacement>,
): SvgPrimitive[] {
  const symbolDoc = renderSymbol(instance.symbol, instance.part);
  const fieldPositions = resolveSchematicFields(symbolDoc.primitives, place.instance_id, unit, instance.value, overrides, place.rot_mdeg);
  const out: SvgPrimitive[] = [];
  for (const primitive of symbolDoc.primitives) {
    if (primitive.kind === "text" && primitive.role === "field") {
      const field = fieldPositions.get(primitive);
      if (!field) continue;
      // The page may have moved this field aside; the sheet place goes back into the symbol's frame
      // so the field keeps travelling with its symbol (ADR-0064).
      const placement = placements?.get(`${place.instance_id}:${primitive.name ?? "field"}`);
      if (placement === undefined) {
        out.push(placePrimitive({ ...primitive, x: field.x, y: field.y, text: field.text }, place));
        continue;
      }
      const local = toLocal(place, placement.x_nm, placement.y_nm);
      out.push(placePrimitive({ ...primitive, x: local.x, y: local.y, text: field.text }, place, placement.anchor));
      continue;
    }
    if (!inUnit(primitive, unit)) continue;
    out.push(placePrimitive(primitive, place));
  }
  return out;
}

/** How the renderer turns symbol-local facts into sheet facts. */
const RENDERER_PROJECTION: PageProjection = {
  toSheet,
  quadrant: (mdeg) => rotationOf(mdeg) / 90,
};

/**
 * The page as it is drawn: every placed symbol's primitives, and where each field ended up.
 *
 * The field placement is a page-level decision: a field that cannot stay where its symbol wanted it
 * steps aside, so that two symbols drawn close together still show readable designators and values
 * (ADR-0064).
 */
function pageLayout(
  view: SchematicView,
  instances: ReadonlyMap<string, SchematicInstance>,
  options: SchematicRenderOptions = {},
): {
  readonly symbols: ReadonlyMap<string, SvgPrimitive[]>;
  readonly placements: ReadonlyMap<string, FieldPlacement>;
} {
  const placements = options.automaticFields === false
    ? new Map<string, FieldPlacement>()
    : placePageFields(pageFacts(view, instances, RENDERER_PROJECTION));
  const symbols = new Map<string, SvgPrimitive[]>();
  for (const place of view.place) {
    const instance = instances.get(place.instance_id);
    if (!instance) continue;
    symbols.set(
      place.instance_id,
      placeSymbol(instance, place, place.unit ?? 1, view.field, placements),
    );
  }
  return { symbols, placements };
}

function labelPrimitive(label: Label): SvgPrimitive {
  return {
    kind: "text",
    x: label.x_nm,
    y: label.y_nm,
    text: label.net,
    sizeNm: LABEL_SIZE_NM,
    anchor: "start",
    role: "text",
    layer: "label",
    ref: `label:${label.net}`,
    net: label.net,
  };
}

/**
 * Port tag: a pentagon whose tip sits on the net's wire/pin and whose body points in the rotation
 * direction; the port name stays horizontal so it reads without tilting the head.
 */
function portPrimitives(port: Port): SvgPrimitive[] {
  const rot = rotationOf(port.rot_mdeg);
  const local: Point[] = [
    { x: 0, y: 0 },
    { x: PORT_HALF_NM, y: -PORT_HALF_NM },
    { x: PORT_BODY_NM, y: -PORT_HALF_NM },
    { x: PORT_BODY_NM, y: PORT_HALF_NM },
    { x: PORT_HALF_NM, y: PORT_HALF_NM },
  ];
  const points = local.map((p) => {
    const q = rotateVector(rot, p.x, p.y);
    return { x: port.x_nm + q.x, y: port.y_nm + q.y };
  });
  const center = portTextAnchor(port, rot / 90);
  return [
    {
      kind: "poly",
      points,
      widthNm: FRAME_WIDTH_NM,
      fill: "none",
      layer: "port",
      ref: `port:${port.id}`,
    },
    {
      kind: "text",
      x: center.x_nm,
      y: center.y_nm,
      text: port.id,
      sizeNm: PORT_SIZE_NM,
      anchor: "middle",
      role: "text",
      layer: "port",
      ref: `port:${port.id}`,
    },
  ];
}

function notePrimitive(note: Note): SvgPrimitive {
  return {
    kind: "text",
    x: note.x_nm,
    y: note.y_nm,
    text: note.text,
    sizeNm: NOTE_SIZE_NM,
    anchor: "start",
    role: "text",
    layer: "text",
  };
}

/* -------- geometry, for the readability checks (spec/schematic-view.md §9.2) -------- */

/** An axis-aligned box in sheet coordinates (nanometres). */
export interface SheetBox {
  readonly min_x_nm: number;
  readonly min_y_nm: number;
  readonly max_x_nm: number;
  readonly max_y_nm: number;
}

/** A piece of text on the sheet: what the readability checks compare. */
export interface SheetText {
  /** `label` and `port` carry a net (or a port id) and must sit on it; `text` is an annotation. */
  readonly kind: "label" | "port" | "text";
  readonly text: string;
  /** The anchor point: the label's position, the port's tip, the note's start. */
  readonly x_nm: number;
  readonly y_nm: number;
  readonly box: SheetBox;
  /** The view record's IR path (`/label/3`); the drawing itself does not need a line number. */
  readonly ir_path?: string;
  /** The net a label names, or the board port a tag shows. */
  readonly subject?: string;
}

/** A placed symbol: the box of its **drawn body** (text excluded) and its pin connection points. */
export interface SheetSymbol {
  readonly instance_id: string;
  readonly box: SheetBox;
  readonly pins: ReadonlyMap<string, { readonly x_nm: number; readonly y_nm: number }>;
}

/**
 * A field text the symbol drew (its Reference or Value), as laid out on the sheet.
 *
 * Kept apart from `texts` on purpose: `texts` holds the *view's* records — the things an author can
 * move inside this file — while a field is placed by the symbol's own `field` segments. A reader
 * cannot tell the two apart on paper, so the checks read both.
 */
export interface SheetField {
  readonly instance_id: string;
  /** The symbol's field name (`Reference` / `Value`). */
  readonly name: string;
  /** What is actually printed: the instance's designator or value, not the symbol's placeholder. */
  readonly text: string;
  /** The resolved anchor in symbol-local coordinates, before the place transform. */
  readonly local_x_nm: number;
  readonly local_y_nm: number;
  readonly box: SheetBox;
  /** The view record that places the instance (`/place/3`): moving the field means editing the symbol. */
  readonly ir_path?: string;
}


export interface SheetGeometry {
  readonly texts: readonly SheetText[];
  /** Text the symbols drew (Reference / Value), in the same coordinates as `texts`. */
  readonly fields: readonly SheetField[];
  readonly symbols: readonly SheetSymbol[];
}

/** Bounding box of drawing primitives; text is left out on purpose (a field's width must not widen the body). */
function graphicsBox(primitives: readonly SvgPrimitive[]): SheetBox | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const put = (x: number, y: number): void => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  for (const p of primitives) {
    switch (p.kind) {
      case "line":
        put(p.x1, p.y1);
        put(p.x2, p.y2);
        break;
      case "rect":
        put(p.x1, p.y1);
        put(p.x2, p.y2);
        break;
      case "circle":
        put(p.cx - p.rNm, p.cy - p.rNm);
        put(p.cx + p.rNm, p.cy + p.rNm);
        break;
      case "arc":
        put(p.x1, p.y1);
        put(p.x2, p.y2);
        put(p.xm, p.ym);
        break;
      case "poly":
      case "polyline":
        for (const point of p.points) put(point.x, point.y);
        break;
      default:
        break;
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { min_x_nm: minX, min_y_nm: minY, max_x_nm: maxX, max_y_nm: maxY };
}

/**
 * The geometry the readability checks need, computed exactly as the drawing is drawn.
 *
 * Kept beside `renderSchematic` on purpose: a checker that re-derived text advance or a symbol's
 * extent would drift from what the reader sees. The caller passes the result to `packages/core`
 * (structural typing, no dependency in either direction — `core` declares the shape it reads).
 */
export function schematicGeometry(
  view: SchematicView,
  instances: ReadonlyMap<string, SchematicInstance>,
  options: SchematicRenderOptions = {},
): SheetGeometry {
  const texts: SheetText[] = [];
  const fields: SheetField[] = [];
  const symbols: SheetSymbol[] = [];
  const layout = pageLayout(view, instances, options);

  for (const [index, place] of view.place.entries()) {
    const instance = instances.get(place.instance_id);
    if (!instance) continue; // the cross-check reports a missing instance; geometry cannot invent one
    const drawn = layout.symbols.get(place.instance_id) ?? [];
    const box = graphicsBox(drawn.filter((p) => p.kind !== "text" && p.kind !== "pin"));
    const pins = new Map<string, { x_nm: number; y_nm: number }>();
    for (const pin of instance.symbol.pins) {
      const at = pinPoint(place, instance, pin.number);
      pins.set(pin.number, { x_nm: at.x, y_nm: at.y });
    }
    if (box) symbols.push({ instance_id: place.instance_id, box, pins });
    else symbols.push({ instance_id: place.instance_id, pins, box: { min_x_nm: place.x_nm, min_y_nm: place.y_nm, max_x_nm: place.x_nm, max_y_nm: place.y_nm } });
    for (const primitive of drawn) {
      if (primitive.kind !== "text" || primitive.role !== "field") continue;
      const overrideIndex = (view.field ?? []).findIndex(
        (field) => field.instance_id === place.instance_id && field.name === primitive.name,
      );
      // The field's own frame: the sheet place it was drawn at, turned back into the symbol's.
      const local = toLocal(place, primitive.x, primitive.y);
      fields.push({
        instance_id: place.instance_id,
        name: primitive.name ?? "field",
        text: primitive.text,
        local_x_nm: local.x,
        local_y_nm: local.y,
        box: textBox(primitive.x, primitive.y, primitive.text, primitive.sizeNm, primitive.anchor, primitive.rotateMdeg ?? 0),
        ir_path: overrideIndex >= 0 ? `/field/${overrideIndex}` : `/place/${index}`,
      });
    }
  }

  for (const [index, label] of (view.label ?? []).entries()) {
    texts.push({
      kind: "label",
      text: label.net,
      x_nm: label.x_nm,
      y_nm: label.y_nm,
      box: textBox(label.x_nm, label.y_nm, label.net, LABEL_SIZE_NM, "start"),
      ir_path: `/label/${index}`,
      subject: label.net,
    });
  }
  for (const [index, port] of (view.port ?? []).entries()) {
    const rot = rotationOf(port.rot_mdeg);
    const center = rotateVector(rot, PORT_BODY_NM / 2 + PORT_HALF_NM, 0);
    texts.push({
      kind: "port",
      text: port.id,
      x_nm: port.x_nm,
      y_nm: port.y_nm,
      box: textBox(port.x_nm + center.x, port.y_nm + center.y, port.id, PORT_SIZE_NM, "middle"),
      ir_path: `/port/${index}`,
      subject: port.id,
    });
  }
  for (const [index, note] of (view.text ?? []).entries()) {
    texts.push({
      kind: "text",
      text: note.text,
      x_nm: note.x_nm,
      y_nm: note.y_nm,
      box: textBox(note.x_nm, note.y_nm, note.text, NOTE_SIZE_NM, "start"),
      ir_path: `/text/${index}`,
    });
  }

  return { texts, fields, symbols };
}
