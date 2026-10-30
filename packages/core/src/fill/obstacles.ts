// Copper obstacles for a pour (ADR-0018 D3): every piece of copper the fill must treat as already
// present, in board coordinates and with its real outline.
//
// Three rules decide the shape here, and all three are about not guessing:
//   - a pad's outline is the footprint's own shape (rect / roundrect / oval / circle), rotated by the
//     pad and then mirrored and rotated by `place` — never the pad's bounding circle;
//   - a trace is its centre line expanded by half its width (the same copper a round aperture lays
//     down), one capsule per segment;
//   - copper the schematic gives no net (an unconnected or `no_connect` pin, a mounting hole's ring,
//     a fiducial) keeps its place with `net: null`, so every pour stays clear of it. Dropping it
//     would let the pour flow over copper of unknown potential, which is the one thing a fill must
//     never do.
import { capsule, centeredRect, circle, normalize, oval, rect, rotate, roundRect, type Point, type Polygon, type Region } from "@texteda/geom";
import type { Footprint, Pad } from "@texteda/ir/footprint";
import type { Pcb } from "@texteda/ir/pcb";
import { mirrorLayer } from "../layers.ts";
import type { FillObstacle, ObstacleFacts, PlacedFootprint, ZoneConnect } from "./types.ts";

/**
 * Rim segments for every curved edge the fill builds (pad corners, oval caps, circles, trace caps).
 *
 * A polygon rim is inscribed in the circle it approximates, so a pad comes out up to
 * `r·(1 − cos(π/32))` — at most 0.5 % of its own radius, about 1 µm on a 0.5 mm pad — smaller than
 * the real copper. The clearance dilation that widens the resulting cut is circumscribed, so it errs
 * by the same fraction in the safe direction. Both errors are three orders of magnitude below any
 * board house's tolerance, and neither is the deciding one.
 */
export const ARC_SEGMENTS = 32;

/** Copper layers of the stackup, in stack order (top to bottom). */
export function copperLayers(pcb: Pcb): string[] {
  return pcb.stackup.filter((layer) => layer.type === "copper").map((layer) => layer.layer);
}

/** The layers spanned by a via: the declared span, or every copper layer when none is declared. */
export function viaLayers(pcb: Pcb, via: { from_layer?: string; to_layer?: string }): string[] {
  const copper = copperLayers(pcb);
  if (via.from_layer === undefined || via.to_layer === undefined) return copper;
  const from = copper.indexOf(via.from_layer);
  const to = copper.indexOf(via.to_layer);
  if (from === -1 || to === -1) return [via.from_layer, via.to_layer];
  const [lo, hi] = from <= to ? [from, to] : [to, from];
  return copper.slice(lo, hi + 1);
}

function round(value: number): number {
  const rounded = Math.round(value);
  return rounded === 0 ? 0 : rounded;
}

/** A pad's own outline in footprint coordinates, including the pad's own rotation. */
export function padOutline(pad: Pad): Polygon {
  const center: Point = { x_nm: pad.at.x_nm, y_nm: pad.at.y_nm };
  const width = pad.size.x_nm;
  const height = pad.size.y_nm;
  let ring: Polygon;
  switch (pad.shape) {
    case "rect":
      ring = centeredRect(center, width, height);
      break;
    case "roundrect": {
      const radius = ((pad.roundrect_ratio_ppm ?? 0) / 1_000_000) * (Math.min(width, height) / 2);
      ring = roundRect(center, width, height, radius, ARC_SEGMENTS);
      break;
    }
    case "oval":
      ring = oval(center, width, height, ARC_SEGMENTS);
      break;
    case "circle":
      // A circular pad is declared by one diameter. Axes that disagree describe an oval, and an oval
      // is the larger shape, so the clearance built on it is never too small.
      ring = width === height ? circle(center, width / 2, ARC_SEGMENTS) : oval(center, width, height, ARC_SEGMENTS);
      break;
  }
  const rotation = pad.at.rotation_mdeg ?? 0;
  if (rotation === 0) return ring;
  return normalize(ring.map((point) => rotate(point, center, rotation)));
}

/** Footprint space to board space: mirror a bottom-side part in X, then rotate by the placement. */
export function toBoard(ring: Polygon, place: { x_nm: number; y_nm: number; rot_mdeg: number; side: "top" | "bottom" }): Polygon {
  return normalize(ring.map((point) => toBoardPoint(point, place)));
}

/**
 * One point from footprint space to board space: the same transform `toBoard` applies to a ring.
 *
 * A single point cannot go through `toBoard`: that normalizes a ring, and a ring needs three
 * vertices. Anything that wants only the transform (a drill position, a pad centre) uses this.
 */
export function toBoardPoint(
  point: Point,
  place: { x_nm: number; y_nm: number; rot_mdeg: number; side: "top" | "bottom" },
): Point {
  const radians = (place.rot_mdeg / 1000) * (Math.PI / 180);
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const x = place.side === "bottom" ? -point.x_nm : point.x_nm;
  const y = point.y_nm;
  return { x_nm: round(place.x_nm + x * cos - y * sin), y_nm: round(place.y_nm + x * sin + y * cos) };
}

/** The copper layers a pad covers, mirrored for a bottom-side part and with `*.Cu` expanded. */
export function padLayers(pad: Pad, pcb: Pcb, side: "top" | "bottom"): string[] {
  const copper = copperLayers(pcb);
  const out: string[] = [];
  const add = (layer: string): void => {
    const name = side === "bottom" ? mirrorLayer(layer) : layer;
    if (!out.includes(name)) out.push(name);
  };
  for (const layer of pad.layers) {
    if (layer === "*.Cu") for (const name of copper) add(name);
    else if (layer.endsWith(".Cu")) add(layer);
  }
  return out;
}

function zoneConnectOf(pad: Pad): ZoneConnect {
  // A through-hole pad is soldered by hand or wave-soldered, so it gets a thermal relief by default;
  // an SMD pad is reflowed, so a solid connection is what a designer expects (KiCad's defaults).
  return pad.zone_connect ?? (pad.type === "th" ? "thermal" : "solid");
}

function padObstacles(placed: PlacedFootprint, pcb: Pcb, place: Pcb["place"][number], pin_net: ObstacleFacts["pin_net"]): FillObstacle[] {
  const out: FillObstacle[] = [];
  for (const pad of placed.footprint.footprint.pads) {
    // Zero-area copper is not copper: nothing to clear around, and a ring would be degenerate.
    if (pad.size.x_nm <= 0 || pad.size.y_nm <= 0) continue;
    const layers = padLayers(pad, pcb, place.side);
    if (layers.length === 0) continue;
    out.push({
      kind: "pad",
      net: pin_net.get(`${placed.instance_id}.${pad.number}`) ?? null,
      layers,
      shape: [toBoard(padOutline(pad), place)],
      zone_connect: zoneConnectOf(pad),
      clearance_nm: pad.clearance_nm ?? null,
      thermal_gap_nm: pad.thermal_gap_nm ?? null,
      thermal_bridge_nm: pad.thermal_width_nm ?? null,
      ref: `${placed.instance_id}.${pad.number}`,
    });
  }
  return out;
}

/** A trace as one capsule per segment: the copper a round aperture of `width_nm` lays down. */
function traceObstacles(pcb: Pcb): FillObstacle[] {
  const out: FillObstacle[] = [];
  for (const [index, trace] of (pcb.trace ?? []).entries()) {
    const pieces: Polygon[] = [];
    for (let i = 1; i < trace.points.length; i += 1) {
      const a = trace.points[i - 1]!;
      const b = trace.points[i]!;
      pieces.push(capsule({ x_nm: a.x_nm, y_nm: a.y_nm }, { x_nm: b.x_nm, y_nm: b.y_nm }, trace.width_nm / 2, ARC_SEGMENTS));
    }
    if (pieces.length === 0) continue;
    out.push({
      kind: "trace",
      net: trace.net,
      layers: [trace.layer],
      shape: pieces,
      zone_connect: "solid",
      clearance_nm: null,
      thermal_gap_nm: null,
      thermal_bridge_nm: null,
      ref: `trace #${index + 1}`,
    });
  }
  return out;
}

/** Vias are copper on every layer of their span; their drill is a hole, not a shape here. */
function viaObstacles(pcb: Pcb): FillObstacle[] {
  const out: FillObstacle[] = [];
  for (const [index, via] of (pcb.via ?? []).entries()) {
    out.push({
      kind: "via",
      net: via.net,
      layers: viaLayers(pcb, via),
      shape: [circle({ x_nm: via.x_nm, y_nm: via.y_nm }, via.size_nm / 2, ARC_SEGMENTS)],
      zone_connect: "solid",
      clearance_nm: null,
      thermal_gap_nm: null,
      thermal_bridge_nm: null,
      ref: `via #${index + 1}`,
    });
  }
  return out;
}

/**
 * `physical_only` copper that a pour must keep clear of.
 *
 * `mounting` and `stitching` are drilled through the board, so their ring is on every copper layer;
 * `fiducial` is a dot on the one layer it declares. A mounting hole's ring has no net (it is held at
 * no potential), and a fiducial may not carry one (spec/pcb.md §4.11); `stitching` joins layers of a
 * net it declares, so it is an ordinary same-net obstacle.
 */
function physicalObstacles(pcb: Pcb): FillObstacle[] {
  const out: FillObstacle[] = [];
  const copper = copperLayers(pcb);
  for (const item of pcb.physical_only ?? []) {
    if (item.type === "cutout") continue; // a hole in the board, not copper: `fillFacts` clips to it
    if (item.size_nm <= 0) continue;
    const shape: Region = [circle({ x_nm: item.x_nm, y_nm: item.y_nm }, item.size_nm / 2, ARC_SEGMENTS)];
    if (item.type === "fiducial") {
      if (!item.layer.endsWith(".Cu")) continue;
      out.push({
        kind: "hole",
        net: null,
        layers: [item.layer],
        shape,
        zone_connect: "solid",
        clearance_nm: null,
        thermal_gap_nm: null,
        thermal_bridge_nm: null,
        ref: item.id,
      });
      continue;
    }
    out.push({
      kind: "hole",
      net: item.type === "stitching" ? item.net : null,
      layers: copper,
      shape,
      zone_connect: "solid",
      clearance_nm: null,
      thermal_gap_nm: null,
      thermal_bridge_nm: null,
      ref: item.id,
    });
  }
  return out;
}

/**
 * Every piece of copper on the board, in board coordinates.
 *
 * Order is stable (pads in placement order, then traces, vias and physical items in drawing order) so
 * two runs over the same input produce the same list; the fill sorts what it needs itself.
 */
export function buildObstacles(facts: ObstacleFacts): FillObstacle[] {
  const out: FillObstacle[] = [];
  for (const placed of facts.placed) {
    const place = facts.pcb.place.find((entry) => entry.instance_id === placed.instance_id);
    if (place === undefined) continue;
    out.push(...padObstacles(placed, facts.pcb, place, facts.pin_net));
  }
  out.push(...traceObstacles(facts.pcb));
  out.push(...viaObstacles(facts.pcb));
  out.push(...physicalObstacles(facts.pcb));
  return out;
}

/** `physical_only` cutouts as board-space rectangles: no copper may cross them (spec/pcb.md §4.11). */
export function cutoutRings(pcb: Pcb): Polygon[] {
  const out: Polygon[] = [];
  for (const item of pcb.physical_only ?? []) {
    if (item.type !== "cutout" || item.w_nm <= 0 || item.h_nm <= 0) continue;
    out.push(rect(item.x_nm, item.y_nm, item.x_nm + item.w_nm, item.y_nm + item.h_nm));
  }
  return out;
}

/** The board outline as a ring; the IR closes it implicitly, the kernel wants it explicit. */
export function outlineRing(pcb: Pcb): Polygon {
  return normalize(pcb.outline.map((point) => ({ x_nm: point.x_nm, y_nm: point.y_nm })));
}
