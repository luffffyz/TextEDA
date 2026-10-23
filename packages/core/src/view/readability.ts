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

/** An axis-aligned box in sheet coordinates (nanometres). */
export interface ReadabilityBox {
  readonly min_x_nm: number;
  readonly min_y_nm: number;
  readonly max_x_nm: number;
  readonly max_y_nm: number;
}

export interface ReadabilityText {
  readonly kind: "label" | "port" | "text";
  readonly text: string;
  readonly x_nm: number;
  readonly y_nm: number;
  readonly box: ReadabilityBox;
  readonly line?: number;
  readonly subject?: string;
}

export interface ReadabilitySymbol {
  readonly instance_id: string;
  readonly box: ReadabilityBox;
  readonly pins: ReadonlyMap<string, { readonly x_nm: number; readonly y_nm: number }>;
}

export interface ReadabilityGeometry {
  readonly texts: readonly ReadabilityText[];
  readonly symbols: readonly ReadabilitySymbol[];
}

export interface ReadabilityFacts {
  /** Path of the view file. */
  readonly file: string;
  /** The page's own IR: the wires are drawn where the view says. */
  readonly view: SchematicView;
  readonly schematic: Schematic;
  readonly geometry: ReadabilityGeometry;
}

/** A point counts as "on" a line when it is this close; drawings are exact, so the tolerance is tiny. */
const ON_LINE_NM = 1_000;

/** Distance from a point to a segment's polyline (the wire's drawn path). */
function distanceToPolyline(point: { x_nm: number; y_nm: number }, path: readonly { x_nm: number; y_nm: number }[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i + 1 < path.length; i += 1) {
    const a = path[i]!;
    const b = path[i + 1]!;
    const dx = b.x_nm - a.x_nm;
    const dy = b.y_nm - a.y_nm;
    const lengthSquared = dx * dx + dy * dy;
    const t =
      lengthSquared === 0
        ? 0
        : Math.max(0, Math.min(1, ((point.x_nm - a.x_nm) * dx + (point.y_nm - a.y_nm) * dy) / lengthSquared));
    const x = a.x_nm + t * dx;
    const y = a.y_nm + t * dy;
    best = Math.min(best, Math.hypot(point.x_nm - x, point.y_nm - y));
  }
  return best;
}

/** The wire path in sheet coordinates: endpoints are pins, which the geometry knows. */
function wirePath(
  wire: NonNullable<SchematicView["wire"]>[number],
  symbols: ReadonlyMap<string, ReadabilitySymbol>,
): { x_nm: number; y_nm: number }[] | null {
  const pointOf = (ref: string): { x_nm: number; y_nm: number } | null => {
    const dot = ref.lastIndexOf(".");
    if (dot <= 0) return null;
    return symbols.get(ref.slice(0, dot))?.pins.get(ref.slice(dot + 1)) ?? null;
  };
  const from = pointOf(wire.from_pin);
  const to = pointOf(wire.to_pin);
  if (!from || !to) return null;
  return [from, ...(wire.points ?? []).map((p) => ({ x_nm: p.x_nm, y_nm: p.y_nm })), to];
}

/** Open boxes overlap only when they share area, not when they touch. */
function boxesOverlap(a: ReadabilityBox, b: ReadabilityBox): boolean {
  return (
    a.min_x_nm < b.max_x_nm &&
    b.min_x_nm < a.max_x_nm &&
    a.min_y_nm < b.max_y_nm &&
    b.min_y_nm < a.max_y_nm
  );
}

/** Whether a segment enters the box's interior (touching an edge does not count). */
function segmentEntersBox(
  a: { x_nm: number; y_nm: number },
  b: { x_nm: number; y_nm: number },
  box: ReadabilityBox,
): boolean {
  // Liang–Barsky clip of the segment against the box, opened by the tolerance on each side.
  const left = box.min_x_nm + ON_LINE_NM;
  const right = box.max_x_nm - ON_LINE_NM;
  const top = box.min_y_nm + ON_LINE_NM;
  const bottom = box.max_y_nm - ON_LINE_NM;
  if (left >= right || top >= bottom) return false;
  let t0 = 0;
  let t1 = 1;
  const dx = b.x_nm - a.x_nm;
  const dy = b.y_nm - a.y_nm;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  return (
    clip(-dx, a.x_nm - left) &&
    clip(dx, right - a.x_nm) &&
    clip(-dy, a.y_nm - top) &&
    clip(dy, bottom - a.y_nm)
  );
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

  /** Whether a point sits on the net's drawing: one of its wires, or a pin of one of its members. */
  const onNet = (netId: string, point: { x_nm: number; y_nm: number }): boolean => {
    for (const wire of wires) {
      if (wire.net !== netId) continue;
      const path = wirePath(wire, symbols);
      if (path && path.length >= 2 && distanceToPolyline(point, path) <= ON_LINE_NM) return true;
    }
    const net = nets.get(netId);
    if (!net) return false;
    for (const member of net.members) {
      const dot = member.lastIndexOf(".");
      const at = symbols.get(member.slice(0, dot))?.pins.get(member.slice(dot + 1));
      if (at && Math.hypot(point.x_nm - at.x_nm, point.y_nm - at.y_nm) <= ON_LINE_NM) return true;
    }
    return false;
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
    if (onNet(netId, { x_nm: text.x_nm, y_nm: text.y_nm })) continue;
    diagnostics.push({
      code: text.kind === "label" ? "view.label-not-on-net" : "view.port-not-on-net",
      severity: "warning",
      message: `print page ${page}: ${text.kind} ${text.text} does not sit on net ${netId}: it is not on one of its wires or pins`,
      hint: "place it on the wire or the pin it names: a label away from its net tells the reader nothing",
      location: { file, line: text.line ?? 1, col: 1 },
      data: { page, net: netId, kind: text.kind },
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
        message: bothLabels
          ? `print page ${page}: labels ${a.text} and ${b.text} overlap`
          : `print page ${page}: text ${a.text} and ${b.text} overlap`,
        hint: "move one of them: overlapping text cannot be read",
        location: { file, line: a.line ?? 1, col: 1 },
        data: { page, first: a.text, second: b.text },
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
      for (let i = 0; i + 1 < path.length; i += 1) {
        if (!segmentEntersBox(path[i]!, path[i + 1]!, symbol.box)) continue;
        diagnostics.push({
          code: "view.wire-crosses-symbol",
          severity: "warning",
          message: `print page ${page}: the wire on net ${wire.net} runs through the body of ${symbol.instance_id}`,
          hint: "route around the symbol: a wire through a body hides both the wire and the pin it might be mistaken for",
          location: { file, line: wire.line ?? 1, col: 1 },
          data: { page, net: wire.net, instance: symbol.instance_id },
        });
        break;
      }
    }
  }

  return diagnostics;
}
