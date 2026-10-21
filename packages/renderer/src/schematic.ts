// Schematic print page -> drawing primitives.
//
// The view (S1) knows only *where*: symbol placements, wire runs, labels, ports, notes (ADR-0021).
// The electrical facts -- which pin belongs to which net, what the pin is called -- live in the
// logical IR, so the caller resolves each placed instance to its symbol and its component pin
// facts and passes them in. The renderer never reads the file system and never places anything:
// no view, no drawing.
import type { SchematicView } from "@texteda/ir/schematic-view";
import { pinDirection, type SvgDoc, type SvgPrimitive } from "./svg.ts";
import { renderSymbol, type SymbolBody, type SymbolPart } from "./symbol.ts";

/** What the renderer needs to draw one placed instance: the symbol's geometry and the pin facts from `component`. */
export interface SchematicInstance {
  symbol: SymbolBody;
  part: SymbolPart;
}

type Place = SchematicView["place"][number];
type Wire = NonNullable<SchematicView["wire"]>[number];
type Label = NonNullable<SchematicView["label"]>[number];
type Port = NonNullable<SchematicView["port"]>[number];
type Note = NonNullable<SchematicView["text"]>[number];

/** Wire stroke width (0.1524mm, KiCad's 6 mil default). */
const WIRE_WIDTH_NM = 152_400;
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
      return {
        ...primitive,
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
  const dot = ref.indexOf(".");
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
  for (const wire of view.wire ?? []) {
    const points = [
      wireEndpoint(placed, wire.from_pin, "from_pin"),
      ...(wire.points ?? []).map((p) => ({ x: p.x_nm, y: p.y_nm })),
      wireEndpoint(placed, wire.to_pin, "to_pin"),
    ];
    if (points.length < 2) continue;
    primitives.push({
      kind: "polyline",
      points,
      widthNm: WIRE_WIDTH_NM,
      fill: "none",
      layer: "wire",
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
