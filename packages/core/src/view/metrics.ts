// What a drawing measures (spec/schematic-view.md §9.4).
//
// The warnings in `readability.ts` are binary: a label is on its net or it is not. An agent laying
// out a page needs the other half of the signal — *how crowded*, *how far*, *how long* — because
// that is what tells it whether the next move helps. A screenshot cannot answer that (pixels do not
// compare across renders, and a vision model cannot measure 0.2mm), while these numbers can.
//
// Everything is an integer in nanometres or a ppm ratio (ADR-0104), so two runs on two machines
// produce the same table.
import type { Schematic } from "@texteda/ir/schematic";
import type { SchematicView } from "@texteda/ir/schematic-view";
import {
  ON_LINE_NM,
  boxDistance,
  boxUnion,
  distanceToPolyline,
  polylineLength,
  segmentCrossing,
  segmentInBox,
  wirePath,
  type Point,
} from "./geometry.ts";
import type { ReadabilityGeometry } from "./facts.ts";

/** One label or port with how far it sits from the net it names (0 when it is on it). */
export interface NetTextMetric {
  readonly kind: "label" | "port";
  readonly text: string;
  readonly net: string;
  readonly x_nm: number;
  readonly y_nm: number;
  /** Distance to the net's nearest wire or pin; 0 when on it. */
  readonly distance_nm: number;
}

export interface ViewMetrics {
  readonly board: string;
  readonly page: string;
  readonly sheet: { readonly width_nm: number; readonly height_nm: number };
  /** Box containing every drawn element; null for a page that draws nothing. */
  readonly content: {
    readonly min_x_nm: number;
    readonly min_y_nm: number;
    readonly max_x_nm: number;
    readonly max_y_nm: number;
  } | null;
  /**
   * The content box as a share of the sheet, in ppm.
   *
   * Low is a small drawing on a large page; near a million means the drawing is about to run off
   * the sheet (the parser already errors on anything outside it).
   */
  readonly content_fill_ppm: number;
  readonly counts: {
    readonly instances: number;
    readonly labels: number;
    readonly ports: number;
    readonly notes: number;
    readonly wires: number;
    /** Nets the board has but this page does not draw wiring for. */
    readonly nets_undrawn: number;
  };
  /** Smallest gap between any two texts (0 = touching or overlapping); absent with fewer than two. */
  readonly text_min_gap_nm: number | null;
  /** Smallest gap between two labels; absent with fewer than two. */
  readonly label_min_gap_nm: number | null;
  /** Total drawn wire length. */
  readonly wire_total_nm: number;
  /** Segment crossings between wires of different nets: a line that jumps a line reads as a junction. */
  readonly wire_crossings: number;
  /** Wires passing through a body they do not connect. */
  readonly wires_through_bodies: number;
  /** Every label and port, with its distance to its net. */
  readonly net_texts: readonly NetTextMetric[];
}

/** Measure one print page against its board. Pure: geometry in, numbers out. */
export function viewMetrics(facts: {
  readonly view: SchematicView;
  readonly schematic: Schematic;
  readonly geometry: ReadabilityGeometry;
}): ViewMetrics {
  const { view, schematic, geometry } = facts;
  const symbols = new Map(geometry.symbols.map((symbol) => [symbol.instance_id, symbol]));
  const wires = view.wire ?? [];
  const portNet = new Map((schematic.ports ?? []).map((port) => [port.id, port.net]));
  const nets = new Map(schematic.nets.map((net) => [net.id, net]));

  const paths = wires
    .map((wire) => ({ net: wire.net, path: wirePath(wire, symbols) }))
    .filter((entry): entry is { net: string; path: Point[] } => entry.path !== null && entry.path.length >= 2);

  const distanceToNet = (netId: string, point: Point): number => {
    let best = Number.POSITIVE_INFINITY;
    for (const entry of paths) {
      if (entry.net === netId) best = Math.min(best, distanceToPolyline(point, entry.path));
    }
    for (const member of nets.get(netId)?.members ?? []) {
      const dot = member.lastIndexOf(".");
      const at = symbols.get(member.slice(0, dot))?.pins.get(member.slice(dot + 1));
      if (at) best = Math.min(best, Math.hypot(point.x_nm - at.x_nm, point.y_nm - at.y_nm));
    }
    return Number.isFinite(best) ? best : Number.POSITIVE_INFINITY;
  };

  const netTexts: NetTextMetric[] = [];
  for (const text of geometry.texts) {
    if (text.kind === "text") continue;
    const netId = text.kind === "label" ? text.subject : portNet.get(text.subject ?? "");
    if (netId === undefined) continue;
    const distance = distanceToNet(netId, { x_nm: text.x_nm, y_nm: text.y_nm });
    netTexts.push({
      kind: text.kind,
      text: text.text,
      net: netId,
      x_nm: text.x_nm,
      y_nm: text.y_nm,
      // -1 means the net is drawn nowhere on this page (no wire, no pin placed here), so there is no
      // distance to report; 0 would read as "on the net".
      distance_nm: !Number.isFinite(distance) ? -1 : distance <= ON_LINE_NM ? 0 : Math.round(distance),
    });
  }

  const minGap = (boxes: readonly { box: ReadabilityGeometry["texts"][number]["box"] }[]): number | null => {
    let best: number | null = null;
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const gap = boxDistance(boxes[i]!.box, boxes[j]!.box);
        if (best === null || gap < best) best = gap;
      }
    }
    return best === null ? null : Math.round(best);
  };

  let crossings = 0;
  for (let i = 0; i < paths.length; i += 1) {
    for (let j = i + 1; j < paths.length; j += 1) {
      if (paths[i]!.net === paths[j]!.net) continue; // same net: a join, not a crossing
      const a = paths[i]!.path;
      const b = paths[j]!.path;
      for (let x = 0; x + 1 < a.length; x += 1) {
        for (let y = 0; y + 1 < b.length; y += 1) {
          if (segmentCrossing(a[x]!, a[x + 1]!, b[y]!, b[y + 1]!)) crossings += 1;
        }
      }
    }
  }

  let throughBodies = 0;
  for (const entry of paths) {
    const hit = geometry.symbols.some((symbol) =>
      entry.path.some((point, index) => {
        if (index + 1 >= entry.path.length) return false;
        return segmentInBox(entry.path[index]!, entry.path[index + 1]!, symbol.box, ON_LINE_NM) !== null;
      }),
    );
    if (hit) throughBodies += 1;
  }

  const content = boxUnion([
    ...geometry.symbols.map((symbol) => symbol.box),
    ...geometry.texts.map((text) => text.box),
    ...paths.flatMap((entry) => entry.path.map((point) => ({ min_x_nm: point.x_nm, min_y_nm: point.y_nm, max_x_nm: point.x_nm, max_y_nm: point.y_nm }))),
  ]);
  const sheetArea = view.sheet.width_nm * view.sheet.height_nm;
  const contentArea = content
    ? (content.max_x_nm - content.min_x_nm) * (content.max_y_nm - content.min_y_nm)
    : 0;
  const drawnNets = new Set(wires.map((wire) => wire.net));

  return {
    board: view.board,
    page: view.page,
    sheet: { width_nm: view.sheet.width_nm, height_nm: view.sheet.height_nm },
    content,
    content_fill_ppm: sheetArea === 0 ? 0 : Math.round((contentArea / sheetArea) * 1_000_000),
    counts: {
      instances: geometry.symbols.length,
      labels: geometry.texts.filter((text) => text.kind === "label").length,
      ports: geometry.texts.filter((text) => text.kind === "port").length,
      notes: geometry.texts.filter((text) => text.kind === "text").length,
      wires: wires.length,
      nets_undrawn: schematic.nets.filter((net) => !drawnNets.has(net.id)).length,
    },
    text_min_gap_nm: minGap(geometry.texts),
    label_min_gap_nm: minGap(geometry.texts.filter((text) => text.kind === "label")),
    wire_total_nm: Math.round(paths.reduce((total, entry) => total + polylineLength(entry.path), 0)),
    wire_crossings: crossings,
    wires_through_bodies: throughBodies,
    net_texts: netTexts,
  };
}
