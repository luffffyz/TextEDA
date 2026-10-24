// Print page -> the semantic projection of the drawing, and back (ADR-0014 decision 5).
//
// `extract(render(ir)) == ir` cannot compare the view IR itself: the drawing does not carry
// placement origins, wire pin references or the unit of a placement -- a reader sees pins, wire
// runs, text and port tags in absolute sheet coordinates. The projection is therefore what lands on
// paper, and both ends compute it independently:
//
//   - `schematicProjection(view, instances)` transforms the view with a quadrant **matrix**, not
//     with the renderer's sign-swap switch, so the two implementations check each other;
//   - `extractSchematic(doc)` reads the drawing commands, which are already in sheet coordinates.
//
// Deliberately not in the projection: placement origin and rotation (a wrong origin that still lands
// every pin in the same place is not a defect of the drawing), stroke widths, text sizes and anchors
// (styling -- the symbol round-trip already gates what a symbol draws), and the shape of the port
// tag beyond its tip and direction. Also not in it: which instance a drawn pin belongs to. Two
// identical symbols swapped on the page draw the same picture; the Reference text is what a reader
// uses, and it is compared as text.
import type { SchematicView } from "@texteda/ir/schematic-view";
import type { SvgDoc } from "./svg.ts";
import { renderSymbol } from "./symbol.ts";
import type { SchematicInstance } from "./schematic.ts";

type Place = SchematicView["place"][number];
type Wire = NonNullable<SchematicView["wire"]>[number];

/** A pin's connection point, orientation and drawing length, in absolute sheet coordinates. */
export interface SchematicPinProjection {
  number: string;
  x_nm: number;
  y_nm: number;
  rotation_mdeg: number;
  length_nm: number;
  style: string;
  unit: number;
}

/** A piece of text as it appears on the sheet (the layer separates labels, notes and symbol text). */
export interface SchematicTextProjection {
  layer: string;
  role: string;
  name?: string;
  text: string;
  x_nm: number;
  y_nm: number;
  rotation_mdeg?: number;
}

/** Drawn geometry in sheet coordinates. The sheet frame is projected as a size; port tags by tip and direction. */
export type SchematicShapeProjection =
  | { kind: "line"; layer: string; x1_nm: number; y1_nm: number; x2_nm: number; y2_nm: number }
  | { kind: "rect"; layer: string; x1_nm: number; y1_nm: number; x2_nm: number; y2_nm: number; fill: string }
  | { kind: "circle"; layer: string; cx_nm: number; cy_nm: number; r_nm: number; fill: string }
  | { kind: "arc"; layer: string; x1_nm: number; y1_nm: number; xm_nm: number; ym_nm: number; x2_nm: number; y2_nm: number; fill: string }
  | { kind: "poly"; layer: string; points: { x_nm: number; y_nm: number }[]; fill: string }
  | { kind: "polyline"; layer: string; points: { x_nm: number; y_nm: number }[] };

/** A port tag: where its tip sits and which way the body points (a unit vector on one axis). */
export interface SchematicPortProjection {
  id: string;
  x_nm: number;
  y_nm: number;
  dir_x: number;
  dir_y: number;
}

export interface SchematicProjection {
  sheet: { width_nm: number; height_nm: number };
  pins: SchematicPinProjection[];
  texts: SchematicTextProjection[];
  shapes: SchematicShapeProjection[];
  ports: SchematicPortProjection[];
}

/**
 * Symbol layers are the symbol's own drawing; `wire` is the page's runs. Sheet frame and port tags
 * are projected separately.
 *
 * `junction` is deliberately absent: a dot is derived from the runs it sits on
 * (spec/schematic-view.md §5.1), so projecting it would put a second copy of that rule on the
 * extract side -- the round-trip would then be checking the rule against itself.
 */
const SHAPE_LAYERS = new Set(["symbol", "pin", "power", "wire"]);

/** Placement rotation in whole quadrants (the parser accepts 0/90/180/270 only). */
function quadrantOf(mdeg: number | undefined): number {
  const r = (((mdeg ?? 0) % 360_000) + 360_000) % 360_000;
  return Math.round(r / 90_000) % 4;
}

/**
 * Symbol coordinates (+y up) -> sheet coordinates (+y down) as a rotation matrix.
 *
 * The spec says the placement rotation is clockwise on the sheet (spec/schematic-view.md §2.1); in
 * a y-down frame one clockwise quadrant is `(u, v) -> (-v, u)`, applied on the y-flipped point. This
 * is the independent statement of `toSheet` in `schematic.ts`, written as a matrix on purpose.
 */
function toSheet(place: Place, x: number, y: number): { x: number; y: number } {
  const k = quadrantOf(place.rot_mdeg);
  let u = x;
  let v = -y;
  for (let i = 0; i < k; i += 1) {
    const t = u;
    u = -v;
    v = t;
  }
  return { x: place.x_nm + u, y: place.y_nm + v };
}

/** A symbol's own pin orientation, turned by the placement (independent of the renderer's switch). */
function sheetPinRotation(place: Place, pinRotMdeg: number): number {
  const local = quadrantOf(pinRotMdeg) * 90_000;
  return ((quadrantOf(place.rot_mdeg) * 90_000 - local) % 360_000 + 360_000) % 360_000;
}

function normalizeRect(points: { x: number; y: number }[]): { x1: number; y1: number; x2: number; y2: number } {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
}

/** `unit = 0` is shared by every unit of a multi-unit symbol (spec/symbol.md §3). */
function inUnit(unit: number | undefined, drawn: number): boolean {
  const u = unit ?? 1;
  return u === 0 || u === drawn;
}

/** Port tag direction for a placement rotation: the body points along +x, turned clockwise by quadrants. */
function portDirection(rotMdeg: number | undefined): { x: number; y: number } {
  switch (quadrantOf(rotMdeg)) {
    case 1:
      return { x: 0, y: 1 };
    case 2:
      return { x: -1, y: 0 };
    case 3:
      return { x: 0, y: -1 };
    default:
      return { x: 1, y: 0 };
  }
}

/** Key-order-independent serialization: the two ends build the same facts in their own code, and a
 * reordered field must not read as a different fact. */
function stableKey(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableKey).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableKey(record[key])}`)
    .join(",")}}`;
}

/** Facts are compared as multisets: the order in which the drawing emits them is not semantic. */
function byFact<T>(facts: T[]): T[] {
  return facts
    .map((fact) => ({ fact, key: stableKey(fact) }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map((entry) => entry.fact);
}

/**
 * The projection of a print page, computed from the view and the caller's symbol facts.
 *
 * The symbol's own drawing comes from `renderSymbol` -- that renderer has its own round-trip
 * (`symbolProjection` / `extractSymbol`) -- and only the placement transform is redone here.
 */
export function schematicProjection(
  view: SchematicView,
  instances: ReadonlyMap<string, SchematicInstance>,
): SchematicProjection {
  const placed = new Map<string, { place: Place; instance: SchematicInstance }>();
  for (const place of view.place) placed.set(place.instance_id, { place, instance: instances.get(place.instance_id)! });

  const pins: SchematicPinProjection[] = [];
  const texts: SchematicTextProjection[] = [];
  const shapes: SchematicShapeProjection[] = [];

  for (const place of view.place) {
    const entry = placed.get(place.instance_id)!;
    if (!entry.instance) throw new Error(`schematic view: no symbol facts for placed instance ${place.instance_id}`);
    const unit = place.unit ?? 1;
    for (const primitive of renderSymbol(entry.instance.symbol, entry.instance.part).primitives) {
      if (!inUnit(primitive.kind === "pad" ? 1 : primitive.unit, unit)) continue;
      switch (primitive.kind) {
        case "pin": {
          const at = toSheet(place, primitive.x, primitive.y);
          pins.push({
            number: primitive.number,
            x_nm: Math.round(at.x),
            y_nm: Math.round(at.y),
            rotation_mdeg: sheetPinRotation(place, primitive.rotMdeg),
            length_nm: primitive.lengthNm,
            style: primitive.style,
            unit: primitive.unit,
          });
          break;
        }
        case "text": {
          const at = toSheet(place, primitive.x, primitive.y);
          // The symbol's Reference and Value fields are library placeholders; the placed instance names
          // itself (and its value, when the device has one). Computed here independently of the
          // renderer: the projection is the reader's view, not a copy of the drawing code.
          const text =
            primitive.role === "field" && primitive.name === "Reference"
              ? place.instance_id
              : primitive.role === "field" && primitive.name === "Value" && entry.instance.value !== undefined
                ? entry.instance.value
                : primitive.text;
          texts.push({
            layer: primitive.layer ?? "",
            role: primitive.role,
            ...(primitive.name === undefined ? {} : { name: primitive.name }),
            text,
            x_nm: Math.round(at.x),
            y_nm: Math.round(at.y),
            ...(primitive.rotateMdeg === undefined
              ? {}
              : { rotation_mdeg: ((quadrantOf(place.rot_mdeg) * 90_000 - primitive.rotateMdeg) % 360_000 + 360_000) % 360_000 }),
          });
          break;
        }
        case "line": {
          const a = toSheet(place, primitive.x1, primitive.y1);
          const b = toSheet(place, primitive.x2, primitive.y2);
          shapes.push({ kind: "line", layer: primitive.layer, x1_nm: Math.round(a.x), y1_nm: Math.round(a.y), x2_nm: Math.round(b.x), y2_nm: Math.round(b.y) });
          break;
        }
        case "rect": {
          // All four corners, so the check does not depend on the renderer's two-corner shortcut.
          const box = normalizeRect([
            toSheet(place, primitive.x1, primitive.y1),
            toSheet(place, primitive.x2, primitive.y1),
            toSheet(place, primitive.x1, primitive.y2),
            toSheet(place, primitive.x2, primitive.y2),
          ].map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })));
          shapes.push({ kind: "rect", layer: primitive.layer, x1_nm: box.x1, y1_nm: box.y1, x2_nm: box.x2, y2_nm: box.y2, fill: primitive.fill });
          break;
        }
        case "circle": {
          const c = toSheet(place, primitive.cx, primitive.cy);
          shapes.push({ kind: "circle", layer: primitive.layer, cx_nm: Math.round(c.x), cy_nm: Math.round(c.y), r_nm: primitive.rNm, fill: primitive.fill });
          break;
        }
        case "arc": {
          const a = toSheet(place, primitive.x1, primitive.y1);
          const m = toSheet(place, primitive.xm, primitive.ym);
          const b = toSheet(place, primitive.x2, primitive.y2);
          shapes.push({ kind: "arc", layer: primitive.layer, x1_nm: Math.round(a.x), y1_nm: Math.round(a.y), xm_nm: Math.round(m.x), ym_nm: Math.round(m.y), x2_nm: Math.round(b.x), y2_nm: Math.round(b.y), fill: primitive.fill });
          break;
        }
        case "poly":
        case "polyline": {
          const points = primitive.points.map((p) => {
            const q = toSheet(place, p.x, p.y);
            return { x_nm: Math.round(q.x), y_nm: Math.round(q.y) };
          });
          shapes.push(
            primitive.kind === "poly"
              ? { kind: "poly", layer: primitive.layer, points, fill: primitive.fill }
              : { kind: "polyline", layer: primitive.layer, points },
          );
          break;
        }
        default:
          break;
      }
    }
  }

  for (const wire of view.wire ?? []) {
    shapes.push({ kind: "polyline", layer: "wire", points: wirePoints(wire, placed).map((p) => ({ x_nm: p.x, y_nm: p.y })) });
  }
  for (const label of view.label ?? []) {
    texts.push({ layer: "label", role: "text", text: label.net, x_nm: label.x_nm, y_nm: label.y_nm });
  }
  for (const note of view.text ?? []) {
    texts.push({ layer: "text", role: "text", text: note.text, x_nm: note.x_nm, y_nm: note.y_nm });
  }

  return {
    sheet: { width_nm: view.sheet.width_nm, height_nm: view.sheet.height_nm },
    pins: byFact(pins),
    texts: byFact(texts),
    shapes: byFact(shapes),
    ports: byFact(
      (view.port ?? []).map((port) => {
        const dir = portDirection(port.rot_mdeg);
        return { id: port.id, x_nm: port.x_nm, y_nm: port.y_nm, dir_x: dir.x, dir_y: dir.y };
      }),
    ),
  };
}

function splitPinRef(ref: string): { instance: string; pin: string } {
  const dot = ref.lastIndexOf(".");
  if (dot <= 0 || dot === ref.length - 1) throw new Error(`schematic view: not a pin reference: ${ref}`);
  return { instance: ref.slice(0, dot), pin: ref.slice(dot + 1) };
}

function wirePoints(wire: Wire, placed: ReadonlyMap<string, { place: Place; instance: SchematicInstance }>): { x: number; y: number }[] {
  const endpoint = (ref: string): { x: number; y: number } => {
    const { instance: id, pin } = splitPinRef(ref);
    const entry = placed.get(id);
    if (!entry) throw new Error(`schematic view: wire endpoint ${ref} refers to an instance that is not placed`);
    const symbolPin = entry.instance.symbol.pins.find((p) => p.number === pin);
    if (!symbolPin) throw new Error(`schematic view: instance ${id} has no symbol pin ${pin}`);
    return toSheet(entry.place, symbolPin.at.x_nm, symbolPin.at.y_nm);
  };
  return [
    ...(wire.from_pin ? [endpoint(wire.from_pin)] : []),
    ...(wire.points ?? []).map((p) => ({ x: p.x_nm, y: p.y_nm })),
    ...(wire.to_pin ? [endpoint(wire.to_pin)] : []),
  ].map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }));
}

/** The drawing commands back into the projection (the drawing is already in sheet coordinates). */
export function extractSchematic(doc: SvgDoc): SchematicProjection {
  const pins: SchematicPinProjection[] = [];
  const texts: SchematicTextProjection[] = [];
  const shapes: SchematicShapeProjection[] = [];
  const ports: SchematicPortProjection[] = [];
  let sheet = { width_nm: 0, height_nm: 0 };
  // Port tags are emitted in view order, a tag polygon followed by its name text; both are kept in
  // order and zipped, because the text sits at the tag's centre and not at its tip.
  const portTags: { x_nm: number; y_nm: number; dir_x: number; dir_y: number }[] = [];
  const portNames: string[] = [];

  for (const primitive of doc.primitives) {
    switch (primitive.kind) {
      case "pin":
        pins.push({
          number: primitive.number,
          x_nm: primitive.x,
          y_nm: primitive.y,
          rotation_mdeg: primitive.rotMdeg,
          length_nm: primitive.lengthNm,
          style: primitive.style,
          unit: primitive.unit,
        });
        break;
      case "text": {
        if (primitive.layer === "port") {
          portNames.push(primitive.text);
          break;
        }
        texts.push({
          layer: primitive.layer ?? "",
          role: primitive.role,
          ...(primitive.name === undefined ? {} : { name: primitive.name }),
          text: primitive.text,
          x_nm: primitive.x,
          y_nm: primitive.y,
          ...(primitive.rotateMdeg === undefined ? {} : { rotation_mdeg: primitive.rotateMdeg }),
        });
        break;
      }
      case "line":
        if (primitive.layer === "sheet") {
          sheet = { width_nm: primitive.x2 - primitive.x1, height_nm: primitive.y2 - primitive.y1 };
          break;
        }
        if (!SHAPE_LAYERS.has(primitive.layer)) break;
        shapes.push({ kind: "line", layer: primitive.layer, x1_nm: primitive.x1, y1_nm: primitive.y1, x2_nm: primitive.x2, y2_nm: primitive.y2 });
        break;
      case "rect":
        if (primitive.layer === "sheet") {
          sheet = { width_nm: primitive.x2 - primitive.x1, height_nm: primitive.y2 - primitive.y1 };
          break;
        }
        if (!SHAPE_LAYERS.has(primitive.layer)) break;
        shapes.push({ kind: "rect", layer: primitive.layer, x1_nm: primitive.x1, y1_nm: primitive.y1, x2_nm: primitive.x2, y2_nm: primitive.y2, fill: primitive.fill });
        break;
      case "circle":
        if (!SHAPE_LAYERS.has(primitive.layer)) break;
        shapes.push({ kind: "circle", layer: primitive.layer, cx_nm: primitive.cx, cy_nm: primitive.cy, r_nm: primitive.rNm, fill: primitive.fill });
        break;
      case "arc":
        if (!SHAPE_LAYERS.has(primitive.layer)) break;
        shapes.push({ kind: "arc", layer: primitive.layer, x1_nm: primitive.x1, y1_nm: primitive.y1, xm_nm: primitive.xm, ym_nm: primitive.ym, x2_nm: primitive.x2, y2_nm: primitive.y2, fill: primitive.fill });
        break;
      case "poly": {
        if (primitive.layer !== "port") {
          if (!SHAPE_LAYERS.has(primitive.layer)) break;
          shapes.push({ kind: "poly", layer: primitive.layer, points: primitive.points.map((p) => ({ x_nm: p.x, y_nm: p.y })), fill: primitive.fill });
          break;
        }
        // Port tag: the tip is the first point; the body points from the tip to the far edge's midpoint.
        const tip = primitive.points[0]!;
        const far = primitive.points[2]!;
        const far2 = primitive.points[3]!;
        const mid = { x: (far.x + far2.x) / 2, y: (far.y + far2.y) / 2 };
        const dx = mid.x - tip.x;
        const dy = mid.y - tip.y;
        portTags.push({
          x_nm: tip.x,
          y_nm: tip.y,
          dir_x: Math.abs(dx) >= Math.abs(dy) ? Math.sign(dx) : 0,
          dir_y: Math.abs(dy) > Math.abs(dx) ? Math.sign(dy) : 0,
        });
        break;
      }
      case "polyline": {
        if (!SHAPE_LAYERS.has(primitive.layer)) break;
        shapes.push({ kind: "polyline", layer: primitive.layer, points: primitive.points.map((p) => ({ x_nm: p.x, y_nm: p.y })) });
        break;
      }
      default:
        break;
    }
  }

  for (let i = 0; i < portTags.length; i += 1) {
    const tag = portTags[i]!;
    const id = portNames[i];
    if (id === undefined) continue;
    ports.push({ id, x_nm: tag.x_nm, y_nm: tag.y_nm, dir_x: tag.dir_x, dir_y: tag.dir_y });
  }

  return { sheet, pins: byFact(pins), texts: byFact(texts), shapes: byFact(shapes), ports: byFact(ports) };
}
