// Drawing readability (spec/schematic-view.md §9.2, AGENTS.md §6 "可读性检查").
//
// A drawing is checked structurally by the cross-check (does every id it names exist?); this module
// asks the other question: can a reader actually follow it? Two texts printed on top of each other,
// a label floating away from its net, a wire running through a symbol's body — the board is correct
// and the drawing is not, and ERC can never see any of it.
//
// The geometry comes from the renderer (`schematicGeometry`), because a checker that re-derived a
// text's width or a symbol's extent would drift from what the reader sees. The shapes here are
// declared in `core` and satisfied structurally by the renderer's output: no dependency either way.
//
// Pure: geometry in, diagnostics out.
import type { Diagnostic } from "@texteda/ir/diagnostics";
import type { Schematic } from "@texteda/ir/schematic";
import type { SchematicView } from "@texteda/ir/schematic-view";
import {
  ON_LINE_NM,
  boxesOverlap,
  distanceToPolyline,
  overlapArea,
  segmentInBox,
  wirePath,
  type Point,
} from "./geometry.ts";
import type {
  ReadabilityBox,
  ReadabilityGeometry,
  ReadabilitySymbol,
  ReadabilityText,
} from "./facts.ts";

export type { ReadabilityBox, ReadabilityGeometry, ReadabilitySymbol, ReadabilityText } from "./facts.ts";

/** mm with one decimal: the human form of a nanometre distance, small enough to read in a message. */
function mm(nm: number): string {
  return (nm / 1_000_000).toFixed(1);
}

/** mm² with two decimals, from nm². */
function mm2(nm2: number): string {
  return (nm2 / 1_000_000_000_000).toFixed(2);
}

export interface ReadabilityFacts {
  /** Path of the view file. */
  readonly file: string;
  /** The page's own IR: the wires are drawn where the view says. */
  readonly view: SchematicView;
  readonly schematic: Schematic;
  readonly geometry: ReadabilityGeometry;
}

/**
 * Readability findings for one print page.
 *
 * Each finding is a warning: the board is right and the drawing is hard to read, so it must not
 * block an export (`AGENTS.md` §6: "好看" is not testable, these four things are).
 */
export function checkReadability(facts: ReadabilityFacts): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const { file, schematic, geometry } = facts;
  const page = facts.view.page;
  const wires = facts.view.wire ?? [];
  const nets = new Map(schematic.nets.map((net) => [net.id, net]));
  const symbols = new Map(geometry.symbols.map((symbol) => [symbol.instance_id, symbol]));
  const portNet = new Map((schematic.ports ?? []).map((port) => [port.id, port.net]));

  /** How far a point is from the net's drawing: its nearest wire, or a pin of one of its members. */
  const distanceToNet = (netId: string, point: Point): number => {
    let best = Number.POSITIVE_INFINITY;
    for (const wire of wires) {
      if (wire.net !== netId) continue;
      const path = wirePath(wire, symbols);
      if (path && path.length >= 2) best = Math.min(best, distanceToPolyline(point, path));
    }
    for (const member of nets.get(netId)?.members ?? []) {
      const dot = member.lastIndexOf(".");
      const at = symbols.get(member.slice(0, dot))?.pins.get(member.slice(dot + 1));
      if (at) best = Math.min(best, Math.hypot(point.x_nm - at.x_nm, point.y_nm - at.y_nm));
    }
    return best;
  };

  /**
   * Whether the page draws the net's wiring at all.
   *
   * A page that leaves a net's wiring out is a sketch, and `view.nets-not-drawn` already says so
   * once for that net; repeating it for each of the net's labels would report the same gap in a
   * louder voice. What this module owns is a *drawn* net whose label points somewhere else.
   */
  const drawnHere = (netId: string): boolean => wires.some((wire) => wire.net === netId);

  for (const text of geometry.texts) {
    if (text.kind === "text") continue;
    const netId = text.kind === "label" ? text.subject : portNet.get(text.subject ?? "");
    if (netId === undefined || !nets.has(netId)) continue; // an unknown net is the cross-check's finding
    if (!drawnHere(netId)) continue;
    const offBy = distanceToNet(netId, { x_nm: text.x_nm, y_nm: text.y_nm });
    if (offBy <= ON_LINE_NM) continue;
    diagnostics.push({
      code: text.kind === "label" ? "view.label-not-on-net" : "view.port-not-on-net",
      severity: "warning",
      message: `print page ${page}: ${text.kind} ${text.text} does not sit on net ${netId}: the nearest point of the net is ${mm(offBy)} mm away`,
      hint: "place it on the wire or the pin it names: a label away from its net tells the reader nothing",
      location: { file, line: text.line ?? 1, col: 1 },
      // The distance is what makes this actionable: a label 0.1mm off a bus and one 20mm off it are
      // the same finding and very different repairs.
      data: { page, net: netId, kind: text.kind, distance_nm: Math.round(offBy) },
    });
  }

  for (let i = 0; i < geometry.texts.length; i += 1) {
    for (let j = i + 1; j < geometry.texts.length; j += 1) {
      const a = geometry.texts[i]!;
      const b = geometry.texts[j]!;
      if (!boxesOverlap(a.box, b.box)) continue;
      const bothLabels = a.kind === "label" && b.kind === "label";
      diagnostics.push({
        code: bothLabels ? "view.label-collision" : "view.text-overlap",
        severity: "warning",
        message: `print page ${page}: ${bothLabels ? "labels" : "text"} ${a.text} and ${b.text} overlap by ${mm2(overlapArea(a.box, b.box))} mm²`,
        hint: "move one of them: overlapping text cannot be read",
        location: { file, line: a.line ?? 1, col: 1 },
        data: { page, first: a.text, second: b.text, overlap_area_nm2: overlapArea(a.box, b.box) },
      });
    }
  }

  for (const wire of wires) {
    const path = wirePath(wire, symbols);
    if (!path || path.length < 2) continue;
    const fromInstance = wire.from_pin.slice(0, wire.from_pin.lastIndexOf("."));
    const toInstance = wire.to_pin.slice(0, wire.to_pin.lastIndexOf("."));
    for (const symbol of geometry.symbols) {
      if (symbol.instance_id === fromInstance || symbol.instance_id === toInstance) continue;
      let through = 0;
      for (let i = 0; i + 1 < path.length; i += 1) {
        const clipped = segmentInBox(path[i]!, path[i + 1]!, symbol.box, ON_LINE_NM);
        if (!clipped) continue;
        through += (clipped[1] - clipped[0]) * Math.hypot(path[i + 1]!.x_nm - path[i]!.x_nm, path[i + 1]!.y_nm - path[i]!.y_nm);
      }
      if (through > 0) {
        diagnostics.push({
          code: "view.wire-crosses-symbol",
          severity: "warning",
          message: `print page ${page}: the wire on net ${wire.net} runs ${mm(through)} mm through the body of ${symbol.instance_id}`,
          hint: "route around the symbol: a wire through a body hides both the wire and the pin it might be mistaken for",
          location: { file, line: wire.line ?? 1, col: 1 },
          data: { page, net: wire.net, instance: symbol.instance_id, through_nm: Math.round(through) },
        });
      }
    }
  }

  return diagnostics;
}
