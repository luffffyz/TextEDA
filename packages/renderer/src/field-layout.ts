// The page-level half of the automatic field placement.
//
// A symbol's field has a preferred place: the side of its painted body the symbol's own text points
// at. That place is only good while the page around it stays as it was. Move a symbol next to its
// neighbour and the two fields face each other; push one of them aside and it lands on the
// neighbour's body. So the renderer places a page's fields together: a field keeps the place it
// wants while that place is free, and steps to the next free slot around its body when it is not.
//
// Everything here is sheet geometry in nanometres. The caller projects the symbol-local facts with
// its own transform and its own reading of the placement rotation (ADR-0055 D6), so this module
// never converts between the two frames itself.
import { boxesOverlap, ON_LINE_NM, segmentInBox, type Point } from "@texteda/core";
import { textAdvance } from "@texteda/core/font";
import type { SchematicView } from "@texteda/ir/schematic-view";
import { renderSymbol } from "./symbol.ts";
import { bodyBounds, resolveSchematicFields } from "./field-placement.ts";
import { pinDirection } from "./svg.ts";
import type { SchematicInstance } from "./schematic.ts";

type Place = NonNullable<SchematicView["place"]>[number];
type Port = NonNullable<SchematicView["port"]>[number];

/** The clearance between a field and the body it belongs to, and between a field and a neighbour. */
const FIELD_CLEARANCE_NM = 1_000_000;
/** How much further out a field steps when the slot next to its body is taken as well. */
const FIELD_STEP_NM = 2_000_000;
/** Tangential search along a body edge, on the view's half-millimetre drawing lattice. */
const FIELD_SLIDE_NM = 500_000;

/** Label, port tag and note text size, and the port tag's shape, in sheet coordinates. */
export const LABEL_SIZE_NM = 1_270_000;
export const PORT_SIZE_NM = 1_270_000;
export const NOTE_SIZE_NM = 2_000_000;
/** Port tag: half height and body length, in sheet coordinates. */
export const PORT_HALF_NM = 1_270_000;
export const PORT_BODY_NM = 7_620_000;

/** A rectangle on the sheet, in nanometres. */
export interface FieldBox {
  readonly min_x_nm: number;
  readonly min_y_nm: number;
  readonly max_x_nm: number;
  readonly max_y_nm: number;
}

/** One field, as the page sees it. */
export interface PageField {
  readonly instance_id: string;
  /** The symbol's field name (`Reference` / `Value`). */
  readonly name: string;
  /** What is printed: the instance's designator or value. */
  readonly text: string;
  readonly size_nm: number;
  /** The anchor the field wants, on the sheet. */
  readonly x_nm: number;
  readonly y_nm: number;
  /** The text anchor it wants; absent keeps the symbol's own anchor. */
  readonly anchor?: "start" | "middle" | "end";
  /** The instance's painted body on the sheet; a bodyless symbol has none. */
  readonly body?: FieldBox;
  /** The field's own rotation on the sheet: `0` is an upright text. */
  readonly rotate_mdeg: number;
}

/** A placed symbol's painted body on the sheet. */
export interface PageBody {
  readonly instance_id: string;
  readonly box: FieldBox;
}

/** A wire run on the sheet. */
export interface PageWire {
  readonly points: readonly Point[];
}

/** Where a field ended up: the sheet anchor and the text anchor to draw it with. */
export interface FieldPlacement {
  readonly x_nm: number;
  readonly y_nm: number;
  readonly anchor?: "start" | "middle" | "end";
}

/** The page facts the field placement reads. */
export interface PageFacts {
  /** Every automatic field on the page, with the place it wants. */
  readonly fields: readonly PageField[];
  /** Every placed symbol's painted body. */
  readonly bodies: readonly PageBody[];
  /** The page's own text: label tags, port tags and notes. */
  readonly texts: readonly FieldBox[];
  /** The fields a `field` row in the view put by hand: they stand where the author put them. */
  readonly fixed: readonly FieldBox[];
  /** Every wire run the page draws. */
  readonly wires: readonly PageWire[];
}

/**
 * How the caller turns symbol-local facts into sheet facts.
 *
 * Each side of the round trip keeps its own implementation (ADR-0055 D6): the renderer reads the
 * placement as a sign swap, the projection as a matrix. They agree because the page says so, not
 * because they share a helper.
 */
export interface PageProjection {
  /** Symbol coordinates (+y up) -> sheet coordinates (+y down). */
  readonly toSheet: (place: Place, x: number, y: number) => { x: number; y: number };
  /** A rotation in millidegrees -> whole quadrants, clockwise on the sheet. */
  readonly quadrant: (mdeg: number | undefined) => number;
}

/**
 * The text anchor a field is drawn with.
 *
 * A part turned a quarter turn carries its fields to the left and right of its body, where two
 * centered texts of any length run into each other. The text stays horizontal and grows away from
 * the part instead: the left field ends where it stands, the right one starts there.
 */
export function fieldTextAnchor(
  quarter: boolean,
  atX: number,
  placeX: number,
): "start" | "middle" | "end" | undefined {
  if (!quarter || Math.abs(atX - placeX) <= 1_000) return undefined;
  return atX < placeX ? "end" : "start";
}

/**
 * The box a text occupies on the sheet: its advance wide, one cap height about the anchor.
 *
 * A turned text is measured by the box around the turned corners, the same way the readability
 * checks measure it, so a slot that looks free here looks free there too.
 */
export function textBox(
  x: number,
  y: number,
  text: string,
  sizeNm: number,
  anchor: "start" | "middle" | "end",
  rotateMdeg = 0,
): FieldBox {
  const width = textAdvance(text, sizeNm);
  const half = sizeNm / 2;
  const left = anchor === "start" ? 0 : anchor === "end" ? -width : -width / 2;
  const rad = (rotateMdeg * Math.PI) / 180_000;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const xs: number[] = [];
  const ys: number[] = [];
  for (const corner of [
    { x: left, y: -half },
    { x: left + width, y: -half },
    { x: left + width, y: half },
    { x: left, y: half },
  ]) {
    xs.push(x + corner.x * cos - corner.y * sin);
    ys.push(y + corner.x * sin + corner.y * cos);
  }
  return {
    min_x_nm: Math.min(...xs),
    min_y_nm: Math.min(...ys),
    max_x_nm: Math.max(...xs),
    max_y_nm: Math.max(...ys),
  };
}

/** Where a port tag's name sits: the tip plus half the tag's body, turned with the port. */
export function portTextAnchor(port: Port, quadrant: number): { x_nm: number; y_nm: number } {
  const center = turnVector(PORT_BODY_NM / 2 + PORT_HALF_NM, 0, quadrant);
  return { x_nm: port.x_nm + center.x, y_nm: port.y_nm + center.y };
}

/** A vector turned by whole quadrants, clockwise on the sheet. */
function turnVector(x: number, y: number, quadrant: number): { x: number; y: number } {
  let u = x;
  let v = y;
  for (let i = 0; i < quadrant; i += 1) {
    const t = u;
    u = -v;
    v = t;
  }
  return { x: u, y: v };
}

/** The sheet box of a symbol-local body, turned by the placement's quadrant. */
function sheetBodyBox(
  local: { minX: number; minY: number; maxX: number; maxY: number },
  quadrant: number,
  place: Place,
): FieldBox {
  const corners = [
    { x: local.minX, y: local.minY },
    { x: local.maxX, y: local.minY },
    { x: local.maxX, y: local.maxY },
    { x: local.minX, y: local.maxY },
  ];
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const corner of corners) {
    const turned = turnVector(corner.x, -corner.y, quadrant);
    const x = place.x_nm + turned.x;
    const y = place.y_nm + turned.y;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { min_x_nm: minX, min_y_nm: minY, max_x_nm: maxX, max_y_nm: maxY };
}

/**
 * The page facts the field placement reads.
 *
 * The symbol bodies come from the same painted-body bounds the automatic placement measures
 * against, so the slots around a body and the body itself are one geometry.
 */
export function pageFacts(
  view: SchematicView,
  instances: ReadonlyMap<string, SchematicInstance>,
  project: PageProjection,
): PageFacts {
  const fields: PageField[] = [];
  const fixed: FieldBox[] = [];
  const bodies: PageBody[] = [];
  const texts: FieldBox[] = [];
  const wires: PageWire[] = [];
  const pins = new Map<string, ReadonlyMap<string, Point>>();
  const endpoints = new Map<string, Point>([
    ...(view.port ?? []).map((port) => [port.id, { x_nm: port.x_nm, y_nm: port.y_nm }] as const),
    ...(view.junction ?? []).map((junction) => [junction.id, { x_nm: junction.x_nm, y_nm: junction.y_nm }] as const),
  ]);

  for (const place of view.place ?? []) {
    const instance = instances.get(place.instance_id);
    if (!instance) continue; // the cross-check reports a missing instance; the geometry cannot invent one
    const unit = place.unit ?? 1;
    const quadrant = project.quadrant(place.rot_mdeg);
    const primitives = renderSymbol(instance.symbol, instance.part).primitives;
    const resolved = resolveSchematicFields(
      primitives,
      place.instance_id,
      unit,
      instance.value,
      view.field,
      place.rot_mdeg,
    );
    const local = bodyBounds(primitives, unit);
    const body = local === undefined ? undefined : sheetBodyBox(local, quadrant, place);
    if (body !== undefined) bodies.push({ instance_id: place.instance_id, box: body });

    const pinPoints = new Map<string, Point>();
    for (const pin of instance.symbol.pins) {
      const at = project.toSheet(place, pin.at.x_nm, pin.at.y_nm);
      pinPoints.set(pin.number, { x_nm: at.x, y_nm: at.y });
    }
    pins.set(place.instance_id, pinPoints);

    for (const primitive of primitives) {
      if (primitive.kind !== "pin" && primitive.kind !== "text") continue;
      if ((primitive.unit ?? 1) !== 0 && (primitive.unit ?? 1) !== unit) continue;
      if (primitive.kind === "pin") {
        const direction = pinDirection(primitive.rotMdeg);
        const from = project.toSheet(place, primitive.x, primitive.y);
        const to = project.toSheet(place,
          primitive.x + direction.x * primitive.lengthNm,
          primitive.y + direction.y * primitive.lengthNm);
        wires.push({ points: [{ x_nm: from.x, y_nm: from.y }, { x_nm: to.x, y_nm: to.y }] });
        continue;
      }
      const rotate = primitive.rotateMdeg === undefined
        ? 0
        : ((((primitive.rotateMdeg - quadrant * 90_000) % 360_000) + 360_000) % 360_000);
      if (primitive.role !== "field") {
        if (!primitive.hidden) {
          const at = project.toSheet(place, primitive.x, primitive.y);
          texts.push(textBox(at.x, at.y, primitive.text, primitive.sizeNm, primitive.anchor ?? "middle", rotate));
        }
        continue;
      }
      const field = resolved.get(primitive);
      if (field === undefined) continue;
      const at = project.toSheet(place, field.x, field.y);
      // The anchor the field will be drawn with: the quarter-turn rule, else the symbol's own.
      const anchor = fieldTextAnchor(quadrant === 1 || quadrant === 3, at.x, place.x_nm) ?? primitive.anchor;
      const box = textBox(at.x, at.y, field.text, primitive.sizeNm, anchor ?? "middle", rotate);
      // A field the author placed by hand stands where it was put; the page only routes around it.
      if (field.manual) {
        fixed.push(box);
        continue;
      }
      fields.push({
        instance_id: place.instance_id,
        name: primitive.name ?? "field",
        text: field.text,
        size_nm: primitive.sizeNm,
        x_nm: at.x,
        y_nm: at.y,
        ...(anchor === undefined ? {} : { anchor }),
        ...(body === undefined ? {} : { body }),
        rotate_mdeg: rotate,
      });
    }
  }

  texts.push(
    ...(view.label ?? []).map((label) =>
      textBox(label.x_nm, label.y_nm, label.net, LABEL_SIZE_NM, "start"),
    ),
    ...(view.port ?? []).map((port) => {
      const at = portTextAnchor(port, project.quadrant(port.rot_mdeg));
      return textBox(at.x_nm, at.y_nm, port.id, PORT_SIZE_NM, "middle");
    }),
    ...(view.text ?? []).map((note) =>
      textBox(note.x_nm, note.y_nm, note.text, NOTE_SIZE_NM, "start"),
    ),
  );

  for (const wire of view.wire ?? []) {
    const from = endpointOf(wire.from_pin, pins, endpoints);
    const to = endpointOf(wire.to_pin, pins, endpoints);
    if (from === undefined || to === undefined) continue;
    wires.push({
      points: [
        from,
        ...(wire.points ?? []).map((point) => ({ x_nm: point.x_nm, y_nm: point.y_nm })),
        to,
      ],
    });
  }

  return { fields, bodies, texts, fixed, wires };
}

/** Where a run ends: a pin or a declared page endpoint. */
function endpointOf(
  ref: string,
  pins: ReadonlyMap<string, ReadonlyMap<string, Point>>,
  endpoints: ReadonlyMap<string, Point>,
): Point | undefined {
  const dot = ref.lastIndexOf(".");
  if (dot <= 0) return endpoints.get(ref);
  return pins.get(ref.slice(0, dot))?.get(ref.slice(dot + 1));
}

/** A candidate place for a field: the anchor, the text anchor, and the box the text occupies. */
interface Candidate {
  readonly x_nm: number;
  readonly y_nm: number;
  readonly anchor?: "start" | "middle" | "end";
  readonly box: FieldBox;
}

/** The four sides of a body a field can sit on. */
type Side = "above" | "below" | "left" | "right";

function fieldKey(field: PageField): string {
  return `${field.instance_id}:${field.name}`;
}

/** The box the field's own text occupies at its preferred place. */
function preferredBox(field: PageField): FieldBox {
  return textBox(field.x_nm, field.y_nm, field.text, field.size_nm, field.anchor ?? "middle");
}

/** Try the preferred anchor, then search the body's perimeter before increasing clearance. */
function* candidatesFor(field: PageField, preferred: Candidate): Generator<Candidate> {
  yield preferred;
  const body = field.body;
  if (body === undefined) return;

  const height = field.size_nm;
  const width = preferred.box.max_x_nm - preferred.box.min_x_nm;
  const centerX = (body.min_x_nm + body.max_x_nm) / 2;
  const centerY = (body.min_y_nm + body.max_y_nm) / 2;
  // Include the corners: the text's near edge can align with the body's far edge.
  const spanX = (body.max_x_nm - body.min_x_nm + width) / 2;
  const spanY = (body.max_y_nm - body.min_y_nm + height) / 2;
  const slot = (side: Side, step: number, offset: number): Candidate => {
    const gap = FIELD_CLEARANCE_NM + step * FIELD_STEP_NM;
    let x = centerX;
    let y = centerY;
    let anchor: "start" | "middle" | "end" = "middle";
    if (side === "above" || side === "below") {
      x += offset;
      y = side === "above" ? body.min_y_nm - gap - height / 2 : body.max_y_nm + gap + height / 2;
    } else {
      x = side === "left" ? body.min_x_nm - gap : body.max_x_nm + gap;
      y += offset;
      anchor = side === "left" ? "end" : "start";
    }
    return { x_nm: x, y_nm: y, anchor, box: textBox(x, y, field.text, field.size_nm, anchor) };
  };

  const sides: readonly Side[] = preferred.y_nm < body.min_y_nm
    ? ["above", "below", "left", "right"]
    : preferred.y_nm > body.max_y_nm
      ? ["below", "above", "left", "right"]
      : preferred.x_nm < body.min_x_nm
        ? ["left", "right", "above", "below"]
        : ["right", "left", "above", "below"];
  const maxSpan = Math.max(spanX, spanY);
  for (let step = 0; step <= 2; step += 1) {
    for (const side of sides) yield slot(side, step, 0);
    for (let offset = FIELD_SLIDE_NM; offset < maxSpan + FIELD_SLIDE_NM; offset += FIELD_SLIDE_NM) {
      for (const side of sides) {
        const span = side === "above" || side === "below" ? spanX : spanY;
        if (offset - FIELD_SLIDE_NM >= span) continue;
        const distance = Math.min(offset, span);
        yield slot(side, step, distance);
        yield slot(side, step, -distance);
      }
    }
  }
}

/** How much of a wire run lies inside a box: a wire that crosses a text makes it unreadable. */
function wireLengthInBox(wire: PageWire, box: FieldBox): number {
  let total = 0;
  for (let i = 0; i + 1 < wire.points.length; i += 1) {
    const a = wire.points[i]!;
    const b = wire.points[i + 1]!;
    const clipped = segmentInBox(a, b, box);
    if (clipped === null) continue;
    total += (clipped[1] - clipped[0]) * Math.hypot(b.x_nm - a.x_nm, b.y_nm - a.y_nm);
  }
  return total;
}

/**
 * Where every field on the page is drawn.
 *
 * A field keeps the place it wants while that place touches no other field, no page text, no other
 * symbol's body and no wire run. The fields are placed in page order, and each one reserves the
 * place it wants even before it is placed, so two fields never aim at the same spot.
 *
 * `fieldPositions` carries the page's previous automatic placements, as a review passes them back
 * during a drag. A field tries its previous place first and keeps it while it is free, so fields
 * that were moved aside do not snap back when an unrelated symbol moves away; a previous place
 * that something new covers falls back to the usual body-relative search.
 */
export function placePageFields(
  facts: PageFacts,
  fieldPositions?: ReadonlyMap<string, FieldPlacement>,
): Map<string, FieldPlacement> {
  const placements = new Map<string, FieldPlacement>();
  const reserved = new Map<string, FieldBox>();
  for (const field of facts.fields) reserved.set(fieldKey(field), preferredBox(field));

  for (const field of facts.fields) {
    const key = fieldKey(field);
    const preferred: Candidate = {
      x_nm: field.x_nm,
      y_nm: field.y_nm,
      ...(field.anchor === undefined ? {} : { anchor: field.anchor }),
      box: reserved.get(key)!,
    };
    let chosen: Candidate = preferred;
    // The review's previous place, tried before the canonical search: it wins while it is free.
    const hint = fieldPositions?.get(key);
    if (hint !== undefined) {
      const anchor = hint.anchor ?? field.anchor;
      const hinted: Candidate = {
        x_nm: hint.x_nm,
        y_nm: hint.y_nm,
        ...(anchor === undefined ? {} : { anchor }),
        box: textBox(hint.x_nm, hint.y_nm, field.text, field.size_nm, anchor ?? "middle"),
      };
      if (isFree(field, hinted.box, facts, reserved, key)) chosen = hinted;
    }
    if (chosen === preferred) {
      for (const candidate of candidatesFor(field, preferred)) {
        if (isFree(field, candidate.box, facts, reserved, key)) {
          chosen = candidate;
          break;
        }
      }
    }
    reserved.set(key, chosen.box);
    placements.set(key, {
      x_nm: chosen.x_nm,
      y_nm: chosen.y_nm,
      ...(chosen.anchor === undefined ? {} : { anchor: chosen.anchor }),
    });
  }
  return placements;
}

/** Whether a box touches nothing a field must not cover. */
function isFree(
  field: PageField,
  candidate: FieldBox,
  facts: PageFacts,
  reserved: ReadonlyMap<string, FieldBox>,
  key: string,
): boolean {
  for (const text of facts.texts) {
    if (boxesOverlap(candidate, text)) return false;
  }
  for (const fixed of facts.fixed) {
    if (boxesOverlap(candidate, fixed)) return false;
  }
  for (const body of facts.bodies) {
    // A field's own body is measured by the placement's own clearance, not by this test.
    if (body.instance_id === field.instance_id) continue;
    if (boxesOverlap(candidate, body.box)) return false;
  }
  for (const [otherKey, otherBox] of reserved) {
    if (otherKey === key) continue;
    if (boxesOverlap(candidate, otherBox)) return false;
  }
  for (const wire of facts.wires) {
    if (wireLengthInBox(wire, candidate) > ON_LINE_NM) return false;
  }
  return true;
}
