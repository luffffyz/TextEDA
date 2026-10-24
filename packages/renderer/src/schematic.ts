// Schematic print page -> drawing primitives.
//
// The view (S1) knows only *where*: symbol placements, wire runs, labels, ports, notes (ADR-0021).
// The electrical facts -- which pin belongs to which net, what the pin is called -- live in the
// logical IR, so the caller resolves each placed instance to its symbol and its component pin
// facts and passes them in. The renderer never reads the file system and never places anything:
// no view, no drawing.
import type { SchematicView } from "@texteda/ir/schematic-view";
import { pinDirection, type SvgDoc, type SvgPrimitive } from "./svg.ts";
import { textAdvance } from "./font/index.ts";
import { renderSymbol, type SymbolBody, type SymbolPart } from "./symbol.ts";

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
const LABEL_SIZE_NM = 1_270_000;
const PORT_SIZE_NM = 1_270_000;
const NOTE_SIZE_NM = 2_000_000;
/** Port tag: half height and body length, in sheet coordinates. */
const PORT_HALF_NM = 1_270_000;
const PORT_BODY_NM = 7_620_000;

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
function placePrimitive(primitive: SvgPrimitive, place: Place): SvgPrimitive {
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
      const fieldAnchor =
        primitive.role === "field" && quarter && Math.abs(at.x - place.x_nm) > 1_000
          ? at.x < place.x_nm
            ? ("end" as const)
            : ("start" as const)
          : undefined;
      return {
        ...primitive,
        ...(fieldAnchor === undefined ? {} : { anchor: fieldAnchor }),
        x: at.x,
        y: at.y,
        // A symbol's text rotation is visually counterclockwise; the placed symbol turned clockwise by
        // `rot` removes that much, and a y-down document reads `rotateMdeg` as clockwise.
        ...(rotate === undefined
          ? {}
          : { rotateMdeg: (((rotationOf(place.rot_mdeg) * 1000 - rotate) % 360_000) + 360_000) % 360_000 }),
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

  // Wires first: they run underneath the symbols, so a wire that ends on a pin is covered by the pin line.
  const runs: { net: string; points: Point[] }[] = [];
  for (const wire of view.wire ?? []) {
    const points = [
      wireEndpoint(placed, wire.from_pin, "from_pin"),
      ...(wire.points ?? []).map((p) => ({ x: p.x_nm, y: p.y_nm })),
      wireEndpoint(placed, wire.to_pin, "to_pin"),
    ];
    if (points.length < 2) continue;
    runs.push({ net: wire.net, points });
    primitives.push({
      kind: "polyline",
      points,
      widthNm: WIRE_WIDTH_NM,
      fill: "none",
      layer: "wire",
    });
  }

  // Junction dots, over the wires and under the symbols.
  for (const dot of junctionDots(runs)) {
    primitives.push({
      kind: "circle",
      cx: dot.x,
      cy: dot.y,
      rNm: JUNCTION_RADIUS_NM,
      widthNm: WIRE_WIDTH_NM,
      fill: "solid",
      layer: "junction",
    });
  }

  // Symbols, with the drawn unit filtered out of pins, body, and pin decoration.
  for (const { place, instance } of placed.values()) {
    const unit = place.unit ?? 1;
    primitives.push(...placeSymbol(instance, place, unit));
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

/**
 * Where three or more runs of one net meet.
 *
 * The view carries no junction records: a connection point is a property of the drawn geometry, so
 * it is derived here and stays out of the IR (a dot that was written down could contradict the runs
 * it sits on). The rule counts **arms**: a run ending on the point is one arm, a run passing through
 * it is two, and three or more is a join -- an L bend between two runs is a corner, not a junction.
 *
 * Arms are counted per net, so two runs of different nets that merely touch draw no dot: the absence
 * of a dot is the drawing's way of saying "not connected", and drawing one there would be a false
 * claim about connectivity.
 */
function junctionDots(runs: readonly { net: string; points: Point[] }[]): Point[] {
  const seen = new Set<string>();
  const dots: Point[] = [];
  for (const run of runs) {
    for (const point of run.points) {
      const key = `${point.x},${point.y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      let arms = 0;
      for (const other of runs) {
        if (other.net !== run.net) continue;
        for (let i = 0; i + 1 < other.points.length; i += 1) {
          arms += armsAt(point, other.points[i]!, other.points[i + 1]!);
          if (arms >= 3) break;
        }
        if (arms >= 3) break;
      }
      if (arms >= 3) dots.push(point);
    }
  }
  return dots;
}

/** How many arms one segment contributes at a point: 0 (away), 1 (an end) or 2 (passing through). */
function armsAt(point: Point, a: Point, b: Point): number {
  if ((point.x === a.x && point.y === a.y) || (point.x === b.x && point.y === b.y)) return 1;
  const cross = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
  if (cross !== 0) return 0;
  const dot = (point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y);
  const length = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  return dot > 0 && dot < length ? 2 : 0;
}

function wireEndpoint(
  placed: ReadonlyMap<string, { place: Place; instance: SchematicInstance }>,
  ref: string,
  column: string,
): Point {
  const { instance: instanceId, pin } = splitPinRef(ref);
  const entry = placed.get(instanceId);
  if (!entry) {
    throw new Error(`schematic view: wire ${column} ${ref} refers to an instance that is not placed`);
  }
  return pinPoint(entry.place, entry.instance, pin);
}

/**
 * Symbol primitives in sheet coordinates for one placed unit.
 *
 * `renderSymbol` already computes the symbol's own drawing (body, pin graphics, pin names/numbers
 * and fields) in symbol coordinates; this function reuses that computation and only moves it.
 */
function placeSymbol(instance: SchematicInstance, place: Place, unit: number): SvgPrimitive[] {
  const symbolDoc = renderSymbol(instance.symbol, instance.part);
  const out: SvgPrimitive[] = [];
  for (const primitive of symbolDoc.primitives) {
    if (!inUnit(primitive, unit)) continue;
    const moved = placePrimitive(primitive, place);
    // The symbol's Reference field is a placeholder (`U` in the library); the placed instance names itself.
    if (moved.kind === "text" && moved.role === "field" && moved.name === "Reference") {
      out.push({ ...moved, text: place.instance_id });
      continue;
    }
    // The same for Value: `10k` is a fact about this instance, not about the resistor symbol.
    if (moved.kind === "text" && moved.role === "field" && moved.name === "Value" && instance.value !== undefined) {
      out.push({ ...moved, text: instance.value });
      continue;
    }
    out.push(moved);
  }
  return out;
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
  const center = rotateVector(rot, PORT_BODY_NM / 2 + PORT_HALF_NM, 0);
  return [
    {
      kind: "poly",
      points,
      widthNm: FRAME_WIDTH_NM,
      fill: "none",
      layer: "port",
    },
    {
      kind: "text",
      x: port.x_nm + center.x,
      y: port.y_nm + center.y,
      text: port.id,
      sizeNm: PORT_SIZE_NM,
      anchor: "middle",
      role: "text",
      layer: "port",
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

export interface SheetGeometry {
  readonly texts: readonly SheetText[];
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

/** The box a text primitive occupies: the stroke font's advance wide, one cap height about the anchor. */
function textBox(x: number, y: number, text: string, sizeNm: number, anchor: "start" | "middle" | "end"): SheetBox {
  const width = textAdvance(text, sizeNm);
  const left = anchor === "start" ? x : anchor === "end" ? x - width : x - width / 2;
  const half = sizeNm / 2;
  return { min_x_nm: left, min_y_nm: y - half, max_x_nm: left + width, max_y_nm: y + half };
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
): SheetGeometry {
  const texts: SheetText[] = [];
  const symbols: SheetSymbol[] = [];

  for (const place of view.place) {
    const instance = instances.get(place.instance_id);
    if (!instance) continue; // the cross-check reports a missing instance; geometry cannot invent one
    const drawn = placeSymbol(instance, place, place.unit ?? 1);
    const box = graphicsBox(drawn.filter((p) => p.kind !== "text" && p.kind !== "pin"));
    const pins = new Map<string, { x_nm: number; y_nm: number }>();
    for (const pin of instance.symbol.pins) {
      const at = pinPoint(place, instance, pin.number);
      pins.set(pin.number, { x_nm: at.x, y_nm: at.y });
    }
    if (box) symbols.push({ instance_id: place.instance_id, box, pins });
    else symbols.push({ instance_id: place.instance_id, pins, box: { min_x_nm: place.x_nm, min_y_nm: place.y_nm, max_x_nm: place.x_nm, max_y_nm: place.y_nm } });
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

  return { texts, symbols };
}
