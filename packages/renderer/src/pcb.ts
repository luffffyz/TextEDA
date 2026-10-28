// The board as a drawing: the placement canvas (ADR-0141 D1).
//
// What the canvas shows is what the board says: the outline, the placed parts with their pads and
// courtyards, the copper and the silkscreen. The renderer draws the IR and invents nothing. In
// particular a copper pour's *fill* is not in the IR -- only the intent to pour is (ADR-0117 D3) --
// so the canvas draws the zone's outline and stays silent about the copper inside it.
//
// Board coordinates: the board frame, in which +y points **down** (the IR's "board frame", the same
// frame the Gerber and the fill kernel work in). `toBoardPoint` transforms a footprint's own frame
// (also +y down) into it, so the document is "y-down" like the footprint preview and the schematic
// page: the SVG shows the board's coordinates as they are, with no flip.
import { isSilkLayer, mirrorLayer, silkRules, uprightTurn } from "@texteda/core";
import { padOutline, toBoard, toBoardPoint } from "@texteda/core/fill";
import type { Footprint, Graphic } from "@texteda/ir/footprint";
import type { Pcb } from "@texteda/ir/pcb";
import type { SvgDoc, SvgPrimitive } from "./svg.ts";

/** A part the board places. */
export interface PcbCanvasPart {
  /** Board-flat instance id: `U1`, `M2.U1` (ADR-0112 D2). */
  instance_id: string;
  footprint: Footprint;
  /**
   * The value the board prints for the instance (`10k`, `100nF`, an MPN).
   *
   * A value is not a fact of the land pattern, so the canvas cannot derive it: the caller that knows
   * the schematic supplies it, exactly like the manufacturing export does (ADR-0123).
   */
  value?: string;
}

export interface PcbCanvasOptions {
  pcb: Pcb;
  /**
   * The parts the board places. A part the board places but the schematic does not know contributes
   * no pads: the canvas draws what it can resolve and leaves the rest to the binding check
   * (ADR-0118).
   */
  parts: readonly PcbCanvasPart[];
  /** `<instance_id>.<pad_number>` -> net id: the schematic's net for a pad. */
  padNets?: ReadonlyMap<string, string>;
}

/** Copper line width used for the outlines the canvas draws itself (a zone, a courtyard). */
const OUTLINE_WIDTH_NM = 100_000;
/** Silkscreen text height when the footprint does not say how big its reference is. */
const DEFAULT_TEXT_NM = 1_000_000;
/** Segments per sampled curve: enough that a courtyard arc does not look like a polygon. */
const ARC_SEGMENTS = 32;

interface Placement {
  x_nm: number;
  y_nm: number;
  rot_mdeg: number;
  side: "top" | "bottom";
}

export function renderPcb(options: PcbCanvasOptions): SvgDoc {
  const { pcb } = options;
  const rules = silkRules(pcb);
  const padNets = options.padNets ?? new Map<string, string>();
  const parts = new Map(options.parts.map((part) => [part.instance_id, part]));
  const primitives: SvgPrimitive[] = [];

  // Zones first: a pour is the background its net's copper sits on.
  for (const zone of pcb.zone ?? []) {
    primitives.push({
      kind: "poly",
      points: zone.points.map((p) => ({ x: p.x_nm, y: p.y_nm })),
      widthNm: OUTLINE_WIDTH_NM,
      fill: "none",
      layer: zone.layer,
      ref: `net:${zone.net}`,
      net: zone.net,
    });
  }

  for (const keepout of pcb.keepout ?? []) {
    primitives.push({
      kind: "poly",
      points: keepout.points.map((p) => ({ x: p.x_nm, y: p.y_nm })),
      widthNm: OUTLINE_WIDTH_NM,
      fill: "none",
      layer: keepout.layer,
      ref: `keepout:${keepout.type}`,
    });
  }

  // Copper: the tracks.
  for (const trace of pcb.trace ?? []) {
    primitives.push({
      kind: "polyline",
      points: trace.points.map((p) => ({ x: p.x_nm, y: p.y_nm })),
      widthNm: trace.width_nm,
      fill: "none",
      layer: trace.layer,
      ref: `net:${trace.net}`,
      net: trace.net,
    });
  }

  // The placed parts: pads, courtyards, reference text.
  for (const placement of pcb.place) {
    const part = parts.get(placement.instance_id);
    if (!part) continue;
    const place: Placement = {
      x_nm: placement.x_nm,
      y_nm: placement.y_nm,
      rot_mdeg: placement.rot_mdeg,
      side: placement.side,
    };
    const copper = placement.side === "bottom" ? "B.Cu" : "F.Cu";
    for (const pad of part.footprint.footprint.pads) {
      const outline = toBoard(padOutline(pad), place);
      if (outline.length < 3) continue;
      const net = padNets.get(`${placement.instance_id}.${pad.number}`);
      primitives.push({
        kind: "poly",
        points: outline.map((p) => ({ x: p.x_nm, y: p.y_nm })),
        widthNm: 0,
        fill: "solid",
        layer: copper,
        ref: `pad:${placement.instance_id}.${pad.number}`,
        ...(net === undefined ? {} : { net }),
      });
    }
    // The footprint's own drawing: the courtyard says how much room the part needs, the silkscreen
    // says how it is printed. Both are the footprint's geometry, moved into the board's frame.
    for (const graphic of part.footprint.footprint.graphics ?? []) {
      const layer = placedLayer(graphic.layer, placement.side);
      if (!isSilkLayer(layer) && !isCourtyardLayer(layer)) continue;
      for (const primitive of graphicPrimitives(graphic, place, layer, placement.instance_id)) {
        primitives.push(primitive);
      }
    }
    for (const primitive of fieldPrimitives(part, placement, place, rules)) {
      primitives.push(primitive);
    }
  }

  // The vias, over the copper they join.
  for (const via of pcb.via ?? []) {
    primitives.push({
      kind: "circle",
      cx: via.x_nm,
      cy: via.y_nm,
      rNm: via.size_nm / 2,
      widthNm: 0,
      fill: "solid",
      layer: "F.Cu",
      ref: `net:${via.net}`,
      net: via.net,
    });
    primitives.push({
      kind: "circle",
      cx: via.x_nm,
      cy: via.y_nm,
      rNm: via.drill_nm / 2,
      widthNm: 0,
      fill: "background",
      layer: "F.Cu",
      ref: `net:${via.net}`,
      net: via.net,
    });
  }

  // The board outline last: it is the edge everything else is measured from.
  const outline = pcb.outline.map((p) => ({ x: p.x_nm, y: p.y_nm }));
  primitives.push({
    kind: "polyline",
    points: [...outline, outline[0]!],
    widthNm: OUTLINE_WIDTH_NM,
    fill: "none",
    layer: "Edge.Cuts",
    ref: "board:outline",
  });

  return {
    kind: "pcb",
    title: pcb.board,
    orientation: "y-down",
    primitives,
  };
}

/**
 * The layer a footprint's own drawing lands on: a bottom-side part is seen from the other side, so
 * its front layers become the board's back layers.
 */
function placedLayer(layer: string, side: "top" | "bottom"): string {
  return side === "bottom" ? mirrorLayer(layer) : layer;
}

/** A courtyard layer: the room the part needs, which the canvas shows next to the copper. */
function isCourtyardLayer(layer: string): boolean {
  return layer === "F.CrtYd" || layer === "B.CrtYd";
}

/** One footprint graphic, in board coordinates. */
function graphicPrimitives(
  graphic: Graphic,
  place: Placement,
  layer: string,
  instanceId: string,
): SvgPrimitive[] {
  const ref = `instance:${instanceId}`;
  const width = graphic.width_nm ?? OUTLINE_WIDTH_NM;
  const at = (point: { x_nm: number; y_nm: number }): { x: number; y: number } => {
    const moved = toBoardPoint(point, place);
    return { x: moved.x_nm, y: moved.y_nm };
  };
  switch (graphic.kind) {
    case "line": {
      if (!graphic.start || !graphic.end) return [];
      return [
        {
          kind: "line",
          x1: at(graphic.start).x,
          y1: at(graphic.start).y,
          x2: at(graphic.end).x,
          y2: at(graphic.end).y,
          widthNm: width,
          layer,
          ref,
        },
      ];
    }
    case "rect": {
      if (!graphic.start || !graphic.end) return [];
      const a = at(graphic.start);
      const b = at(graphic.end);
      return [
        {
          kind: "poly",
          points: [
            { x: a.x, y: a.y },
            { x: b.x, y: a.y },
            { x: b.x, y: b.y },
            { x: a.x, y: b.y },
          ],
          widthNm: width,
          fill: "none",
          layer,
          ref,
        },
      ];
    }
    case "circle": {
      if (!graphic.center) return [];
      const c = at(graphic.center);
      return [
        {
          kind: "circle",
          cx: c.x,
          cy: c.y,
          rNm: graphic.radius_nm ?? 0,
          widthNm: width,
          fill: "none",
          layer,
          ref,
        },
      ];
    }
    case "arc": {
      if (!graphic.start || !graphic.mid || !graphic.end) return [];
      const points = sampleArc(graphic.start, graphic.mid, graphic.end).map(at);
      return [
        {
          kind: "polyline",
          points,
          widthNm: width,
          fill: "none",
          layer,
          ref,
        },
      ];
    }
    case "poly": {
      if (!graphic.points) return [];
      return [
        {
          kind: "poly",
          points: graphic.points.map(at),
          widthNm: width,
          fill: "none",
          layer,
          ref,
        },
      ];
    }
  }
}

/**
 * The texts the board prints for a placed part.
 *
 * The footprint says where a field sits and how it is turned; the *board* says whether it is printed
 * at all, on which layer and how big (`silk` section, spec/pcb.md section 4.10). The canvas prints
 * what the board prints: the reference is the instance's name (the library's placeholder names no
 * part), the value is the value the board knows.
 */
function fieldPrimitives(
  part: PcbCanvasPart,
  placement: Pcb["place"][number],
  place: Placement,
  rules: ReturnType<typeof silkRules>,
): SvgPrimitive[] {
  const out: SvgPrimitive[] = [];
  for (const field of part.footprint.footprint.fields ?? []) {
    if (field.hide === true) continue;
    const item = field.name === "Reference" ? "refdes" : field.name === "Value" ? "value" : undefined;
    if (item === undefined) continue;
    const rule = rules[item];
    if (!rule.show) continue;
    const content = item === "refdes" ? part.instance_id : part.value;
    if (content === undefined || content.length === 0) continue;
    const layer = placedLayer(rule.layer, placement.side);
    if (!isSilkLayer(layer)) continue;
    const at = field.at;
    const moved = at
      ? toBoardPoint({ x_nm: at.x_nm, y_nm: at.y_nm }, place)
      : { x_nm: place.x_nm, y_nm: place.y_nm + 2_000_000 };
    // The board's rotation is clockwise-positive (spec/pcb.md section 4.3); the renderer's rotation is
    // counterclockwise-positive in the model's frame, so the angle is negated. The extra turn is the
    // one the printed silkscreen gets (`uprightTurn`): the canvas shows what the board prints, so the
    // text is never upside down.
    const fieldRotation = at?.rotation_mdeg ?? 0;
    const total =
      (((fieldRotation + place.rot_mdeg + uprightTurn(placement, fieldRotation)) % 360_000) + 360_000) % 360_000;
    const rotation = (360_000 - total) % 360_000;
    out.push({
      kind: "text",
      x: moved.x_nm,
      y: moved.y_nm,
      text: content,
      sizeNm: rule.size_nm,
      anchor: "middle",
      role: item === "refdes" ? "field" : "text",
      layer,
      ref: `instance:${part.instance_id}`,
      ...(rotation === 0 ? {} : { rotateMdeg: rotation }),
    });
  }
  return out;
}

/**
 * A circular arc through three points, sampled.
 *
 * The geometry kernel has no arc (it works in polygons), and a courtyard arc is a curve the canvas
 * has to show. The three points fix the circle; the arc is the part of it from the start to the end
 * that passes through the middle point.
 */
function sampleArc(
  start: { x_nm: number; y_nm: number },
  mid: { x_nm: number; y_nm: number },
  end: { x_nm: number; y_nm: number },
): { x_nm: number; y_nm: number }[] {
  const d = 2 * (start.x_nm * (mid.y_nm - end.y_nm) + mid.x_nm * (end.y_nm - start.y_nm) + end.x_nm * (start.y_nm - mid.y_nm));
  if (d === 0) return [start, end];
  const s1 = start.x_nm ** 2 + start.y_nm ** 2;
  const s2 = mid.x_nm ** 2 + mid.y_nm ** 2;
  const s3 = end.x_nm ** 2 + end.y_nm ** 2;
  const cx = (s1 * (mid.y_nm - end.y_nm) + s2 * (end.y_nm - start.y_nm) + s3 * (start.y_nm - mid.y_nm)) / d;
  const cy = (s1 * (end.x_nm - mid.x_nm) + s2 * (start.x_nm - end.x_nm) + s3 * (mid.x_nm - start.x_nm)) / d;
  const radius = Math.hypot(start.x_nm - cx, start.y_nm - cy);
  const angleOf = (p: { x_nm: number; y_nm: number }): number =>
    Math.atan2(p.y_nm - cy, p.x_nm - cx);
  const a0 = angleOf(start);
  const am = angleOf(mid);
  const a1 = angleOf(end);
  // The arc runs from the start to the end through the middle: the sweep that contains the middle.
  let sweep = a1 - a0;
  while (sweep <= -Math.PI) sweep += 2 * Math.PI;
  while (sweep > Math.PI) sweep -= 2 * Math.PI;
  let midSweep = am - a0;
  while (midSweep <= -Math.PI) midSweep += 2 * Math.PI;
  while (midSweep > Math.PI) midSweep -= 2 * Math.PI;
  if (Math.sign(midSweep) !== Math.sign(sweep) || Math.abs(midSweep) > Math.abs(sweep)) {
    sweep = midSweep;
  }
  const points: { x_nm: number; y_nm: number }[] = [];
  for (let i = 0; i <= ARC_SEGMENTS; i += 1) {
    const angle = a0 + (sweep * i) / ARC_SEGMENTS;
    points.push({ x_nm: Math.round(cx + radius * Math.cos(angle)), y_nm: Math.round(cy + radius * Math.sin(angle)) });
  }
  return points;
}
