// Silkscreen: the footprint's own drawing plus the reference/value text, as board geometry
// (backlog F15).
//
// Two facts decide what appears, and the split is in `spec/pcb.md` §4.10:
//   - **the footprint draws** — its `graphics` on a silk layer are strokes and filled shapes; its
//     `fields` give the anchor of the reference and value text;
//   - **the board decides** — the `silk` section says which of the two is printed, on which layer and
//     at what height. A library cannot know what a review needs; a board cannot know where its parts
//     put their text. Neither side repeats the other.
//
// The text is laid out with the stroke font (`font/index.ts`) in footprint space and then moved point
// by point into board space, so a silk string is exactly the polylines the file contains. The font
// covers printable ASCII; whatever cannot be drawn is dropped before it gets here (the schematic does
// the same), so a printed `10k` is what a board house expects of a 10kΩ resistor anyway.
import { circle, normalize, rect, rotate, type Point, type Polygon } from "@texteda/geom";
import type { Footprint } from "@texteda/ir/footprint";
import type { Pcb } from "@texteda/ir/pcb";
import { strokeWidthFor, textStrokes } from "./font/index.ts";
import type { ImageItem } from "./image.ts";
import { isSilkLayer, mirrorLayer } from "./layers.ts";
import { toBoardPoint } from "./fill/obstacles.ts";
import type { PlacedFootprint } from "./fill/types.ts";

/** Rim segments of a silk circle: the same tessellation the fill uses for a pad rim. */
const ARC_SEGMENTS = 32;

/**
 * The width a silk stroke draws with when the footprint declares none (`width=` absent or 0).
 *
 * 0.12 mm is the silk line width board houses accept as printable and that libraries use by default.
 * It is a drawing convention, not a design rule, so it does not belong in `pcb.rules`
 * (`spec/footprint.md` §5).
 */
export const SILK_WIDTH_NM = 120_000;

type Placement = Pcb["place"][number];

/** One `silk` row: which item, on which layer, at what height, printed or not. */
export interface SilkItemRule {
  readonly layer: "F.SilkS" | "B.SilkS";
  readonly size_nm: number;
  readonly show: boolean;
}

export interface SilkRules {
  readonly refdes: SilkItemRule;
  readonly value: SilkItemRule;
}

/**
 * What an absent `silk` section means (`spec/pcb.md` §4.10): the reference printed on the top silk at
 * 1 mm, the value hidden.
 *
 * Written down rather than derived: "which side is safe to print on" has no derivation, and a hidden
 * value is the only default that cannot clutter a board nobody arranged.
 */
export const SILK_RULE_DEFAULTS: SilkRules = {
  refdes: { layer: "F.SilkS", size_nm: 1_000_000, show: true },
  value: { layer: "F.SilkS", size_nm: 1_000_000, show: false },
};

/** The board's silk rules, with any unspecified item filled in from the defaults. */
export function silkRules(pcb: Pcb): SilkRules {
  const rows = pcb.silk ?? [];
  const find = (item: "refdes" | "value"): SilkItemRule | undefined => {
    const row = rows.find((entry) => entry.item === item);
    return row === undefined ? undefined : { layer: row.layer, size_nm: row.size_nm, show: row.mode === "show" };
  };
  return {
    refdes: find("refdes") ?? SILK_RULE_DEFAULTS.refdes,
    value: find("value") ?? SILK_RULE_DEFAULTS.value,
  };
}

/** A point from footprint space to board space; the same transform the pads use. */
function movePoint(point: Point, place: Placement): Point {
  return toBoardPoint(point, place);
}

/** A ring from footprint space to board space. */
function moveRing(ring: Polygon, place: Placement): Polygon {
  return normalize(ring.map((point) => movePoint(point, place)));
}

/** The layer a footprint's layer lands on: a bottom-side part mirrors it (spec/footprint.md §4). */
function placedLayer(layer: string, place: Placement): string {
  return place.side === "bottom" ? mirrorLayer(layer) : layer;
}

/**
 * A silk stroke, or nothing when the polyline has no length.
 *
 * A stroke is an open polyline, so it goes through `movePoint` and **not** through `moveRing`: a ring
 * normalizer rejects anything that is not a simple closed contour, and a glyph's stroke is neither.
 * Consecutive duplicates are dropped because two coincident points draw nothing and only pad a file.
 */
function stroke(points: Point[], width_nm: number, place: Placement): ImageItem[] {
  const moved: Point[] = [];
  for (const point of points) {
    const next = movePoint(point, place);
    const previous = moved[moved.length - 1];
    if (previous !== undefined && previous.x_nm === next.x_nm && previous.y_nm === next.y_nm) continue;
    moved.push(next);
  }
  if (moved.length < 2) return [];
  return [{ kind: "draw", width_nm, points: moved }];
}

/**
 * One graphic as file-ready geometry.
 *
 * A filled shape is a region; an unfilled one is a stroke along its closing outline. The kernel
 * refuses arcs, so an arc is tessellated here: a drawing is a curve either way, and 32 segments over a
 * full turn is finer than any board house resolves.
 */
function graphicItems(graphic: NonNullable<Footprint["footprint"]["graphics"]>[number], place: Placement): ImageItem[] {
  const width = graphic.width_nm === undefined || graphic.width_nm <= 0 ? SILK_WIDTH_NM : graphic.width_nm;
  switch (graphic.kind) {
    case "line":
      return stroke([graphic.start!, graphic.end!], width, place);
    case "rect": {
      const a = graphic.start!;
      const b = graphic.end!;
      if (graphic.filled) {
        // Two opposite corners span the rectangle; a degenerate one has no area to fill.
        if (a.x_nm === b.x_nm || a.y_nm === b.y_nm) return [];
        return [{ kind: "region", shape: moveRing(rect(a.x_nm, a.y_nm, b.x_nm, b.y_nm), place) }];
      }
      const corners = [a, { x_nm: b.x_nm, y_nm: a.y_nm }, b, { x_nm: a.x_nm, y_nm: b.y_nm }];
      return stroke([...corners, corners[0]!], width, place);
    }
    case "circle": {
      const rim = circle(graphic.center!, graphic.radius_nm!, ARC_SEGMENTS);
      if (graphic.filled) return [{ kind: "region", shape: moveRing(rim, place) }];
      return stroke([...rim, rim[0]!], width, place);
    }
    case "arc":
      return stroke(arcPoints(graphic.start!, graphic.mid!, graphic.end!), width, place);
    case "poly": {
      const points = graphic.points!;
      if (graphic.filled) return [{ kind: "region", shape: moveRing(points, place) }];
      return stroke([...points, points[0]!], width, place);
    }
  }
}

/**
 * An arc (start, mid, end) as a polyline.
 *
 * Three points on a circle define the circle; the arc runs from `start` to `end` the way that passes
 * `mid`, so `mid` alone decides the sweep direction and swapping the two ends picks the other arc.
 * Collinear input has no circle to follow and degenerates to the straight chord, which is the same
 * drawing to a stencil.
 */
function arcPoints(start: Point, mid: Point, end: Point): Point[] {
  const ax = start.x_nm;
  const ay = start.y_nm;
  const bx = mid.x_nm;
  const by = mid.y_nm;
  const cx = end.x_nm;
  const cy = end.y_nm;
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (d === 0) return [start, end];
  const a2 = ax * ax + ay * ay;
  const b2 = bx * bx + by * by;
  const c2 = cx * cx + cy * cy;
  const center: Point = {
    x_nm: Math.round((a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d),
    y_nm: Math.round((a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d),
  };
  const radius = Math.hypot(ax - center.x_nm, ay - center.y_nm);
  const angleOf = (point: Point): number => Math.atan2(point.y_nm - center.y_nm, point.x_nm - center.x_nm);
  const tau = Math.PI * 2;
  const forward = (target: number, origin: number): number => (((target - origin) % tau) + tau) % tau;
  const from = angleOf(start);
  // A positive sweep goes one way, a negative one the other; `mid` says which side of the short way
  // round it lies on, so the sweep is the short way round exactly when `mid` is on it.
  const short = forward(angleOf(end), from);
  const sweep = forward(angleOf(mid), from) <= short ? short : short - tau;
  const steps = Math.max(2, Math.ceil((Math.abs(sweep) / tau) * ARC_SEGMENTS));
  const points: Point[] = [start];
  for (let i = 1; i < steps; i += 1) {
    const angle = from + (sweep * i) / steps;
    points.push({
      x_nm: Math.round(center.x_nm + radius * Math.cos(angle)),
      y_nm: Math.round(center.y_nm + radius * Math.sin(angle)),
    });
  }
  points.push(end);
  return points;
}

/** A text the board's silk rules print, before it is stroked. */
export interface SilkText {
  instance_id: string;
  item: "refdes" | "value";
  text: string;
  layer: string;
  size_nm: number;
  /** Anchor in footprint coordinates (the field's `at`), +y down. */
  at: Point;
  rotation_mdeg: number;
}

/**
 * The silk texts this board prints, in the order the footprints declare them.
 *
 * A text is printed when its rule says `show`, the footprint carries the field and does not hide it,
 * and a value exists. The **field's own layer does not gate** the text: a library puts `Reference` on
 * a silk layer and often `Value` on `F.Fab`, while the board's row names the layer it wants. What the
 * field does give is the anchor, which is the one thing the board cannot know.
 *
 * The two texts differ in origin: the reference is the instance id (a board fact), the value is the
 * caller's (`values`), because a generic device's file cannot hold a value and a part's value is its
 * MPN (ADR-0123). A footprint whose value was never supplied prints none.
 */
export function silkTexts(
  placed: readonly PlacedFootprint[],
  pcb: Pcb,
  rules: SilkRules,
  values: ReadonlyMap<string, string> | undefined,
): SilkText[] {
  const out: SilkText[] = [];
  for (const { instance_id, footprint } of placed) {
    const place = pcb.place.find((entry) => entry.instance_id === instance_id);
    if (place === undefined) continue;
    for (const field of footprint.footprint.fields ?? []) {
      if (field.hide === true) continue;
      const item = field.name === "Reference" ? "refdes" : field.name === "Value" ? "value" : undefined;
      if (item === undefined) continue;
      const rule = rules[item];
      if (!rule.show) continue;
      const text = item === "refdes" ? instance_id : values?.get(instance_id);
      if (text === undefined || text.length === 0) continue;
      const layer = placedLayer(rule.layer, place);
      if (!isSilkLayer(layer)) continue;
      out.push({
        instance_id,
        item,
        text,
        layer,
        size_nm: rule.size_nm,
        at: field.at ?? { x_nm: 0, y_nm: 0 },
        rotation_mdeg: field.at?.rotation_mdeg ?? 0,
      });
    }
  }
  return out;
}

/**
 * The extra turn a text needs so it is never printed upside down.
 *
 * The baseline direction on the board is the placement's rotation plus the field's own. Text is
 * readable when that direction points rightwards (`cos < 0` means it points left: the string would be
 * `M2.R1` reversed). Half a turn about its own anchor fixes that and keeps the anchor: the text box is
 * centred on it, so it maps onto itself.
 *
 * The rule is the same on both sides. A bottom-side string is drawn mirrored, which is what makes it
 * read correctly from the bottom — the mirror does not also turn it upside down.
 */
export function uprightTurn(place: Placement, rotation_mdeg: number): number {
  const total = (((place.rot_mdeg + rotation_mdeg) % 360_000) + 360_000) % 360_000;
  return total > 90_000 && total <= 270_000 ? 180_000 : 0;
}

/** One silk text as strokes: laid out in footprint space, then moved to the board. */
function textItems(text: SilkText, place: Placement): ImageItem[] {
  const width = strokeWidthFor(text.size_nm);
  const strokes = textStrokes(text.text, {
    x: text.at.x_nm,
    y: text.at.y_nm,
    sizeNm: text.size_nm,
    anchor: "middle",
    // Footprint coordinates grow downward (`spec/footprint.md` §4), so the glyphs use the font's own
    // down direction; the placement transform flips what needs flipping.
    yDown: true,
  });
  const turn = text.rotation_mdeg + uprightTurn(place, text.rotation_mdeg);
  const out: ImageItem[] = [];
  for (const line of strokes) {
    if (line.points.length < 2) continue;
    const points = line.points.map((point) => {
      const anchor: Point = { x_nm: Math.round(point.x), y_nm: Math.round(point.y) };
      return turn === 0 ? anchor : rotate(anchor, text.at, turn);
    });
    out.push(...stroke(points, width, place));
  }
  return out;
}

/**
 * Everything one placed footprint puts on the silk: its own graphics whose (placed) layer is a silk
 * layer, then the texts the board prints for it.
 *
 * Each entry names its layer, so the caller files it without knowing which side the part is on.
 */
export function silkItemsOf(
  placed: PlacedFootprint,
  place: Placement,
  texts: readonly SilkText[],
): { layer: string; item: ImageItem }[] {
  const out: { layer: string; item: ImageItem }[] = [];
  for (const graphic of placed.footprint.footprint.graphics ?? []) {
    const layer = placedLayer(graphic.layer, place);
    if (!isSilkLayer(layer)) continue;
    for (const item of graphicItems(graphic, place)) out.push({ layer, item });
  }
  for (const text of texts) {
    if (text.instance_id !== placed.instance_id) continue;
    for (const item of textItems(text, place)) out.push({ layer: text.layer, item });
  }
  return out;
}
