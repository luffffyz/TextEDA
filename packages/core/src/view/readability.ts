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
import type { Diagnostic, DiagnosticLocation } from "@texteda/ir/diagnostics";
import type { Schematic } from "@texteda/ir/schematic";
import type { SchematicView } from "@texteda/ir/schematic-view";
import {
  ON_LINE_NM,
  boxesOverlap,
  distanceToPolyline,
  distanceToSegment,
  overlapArea,
  pinStroke,
  segmentCrossing,
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

export type { ReadabilityBox, ReadabilityField, ReadabilityGeometry, ReadabilitySymbol, ReadabilityText } from "./facts.ts";

/** mm with one decimal: the human form of a nanometre distance, small enough to read in a message. */
function mm(nm: number): string {
  return (nm / 1_000_000).toFixed(1);
}

/** mm with two decimals: a coordinate, which the page draws on a 0.01 mm grid. */
function mmAt(nm: number): string {
  return (nm / 1_000_000).toFixed(2);
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
  /** A record's IR path (`/wire/2`) → where it was written (ADR-0103 D1: the IR has no lines). */
  readonly locate?: (irPath: string) => DiagnosticLocation | undefined;
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
  /** Where a page record was written: the IR names the record, the parse's map gives the line. */
  const at = (irPath: string | undefined): DiagnosticLocation =>
    (irPath === undefined ? undefined : facts.locate?.(irPath)) ?? { file, line: 1, col: 1 };

  /** How far a point is from the net's drawing: its nearest wire, or a pin of one of its members. */
  const distanceToNet = (netId: string, point: Point): number => {
    let best = Number.POSITIVE_INFINITY;
    for (const [index, wire] of wires.entries()) {
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
      location: at(text.ir_path),
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
        location: at(a.ir_path),
        data: { page, first: a.text, second: b.text, overlap_area_nm2: overlapArea(a.box, b.box) },
      });
    }
  }

  /**
   * How much of a wire path runs inside a box, in nanometres: the part of the stroke the reader
   * cannot tell apart from the letters.
   *
   * Summed over the segments, so a wire that enters, leaves and re-enters — a pad drop on each side
   * of a value field — counts both runs.
   */
  const lengthInBox = (path: readonly Point[], box: ReadabilityBox): number => {
    let total = 0;
    for (let i = 0; i + 1 < path.length; i += 1) {
      const clipped = segmentInBox(path[i]!, path[i + 1]!, box);
      if (!clipped) continue;
      total += (clipped[1] - clipped[0]) * Math.hypot(path[i + 1]!.x_nm - path[i]!.x_nm, path[i + 1]!.y_nm - path[i]!.y_nm);
    }
    return total;
  };

  // Everything printed on the sheet, view records and symbol fields alike: a reader cannot tell
  // which file a line of text came from, so neither can this loop.
  const printed: {
    readonly kind: string;
    readonly label: string;
    readonly text: string;
    readonly box: ReadabilityBox;
    readonly ownNet?: string | undefined;
    readonly instance?: string | undefined;
    readonly irPath?: string | undefined;
  }[] = [
    ...geometry.texts.map((text) => ({
      kind: text.kind,
      label: text.kind === "text" ? `the note "${text.text}"` : `the ${text.kind} ${text.text}`,
      text: text.text,
      box: text.box,
      ...(text.kind === "label" ? { ownNet: text.subject } : {}),
      ...(text.kind === "port" ? { ownNet: portNet.get(text.subject ?? "") } : {}),
      ...(text.ir_path === undefined ? {} : { irPath: text.ir_path }),
    })),
    ...geometry.fields.map((field) => ({
      kind: "field",
      label:
        field.text === field.instance_id
          ? `the ${field.name} field of ${field.instance_id}`
          : `the ${field.name} field of ${field.instance_id} (${field.text})`,
      text: field.text,
      box: field.box,
      instance: field.instance_id,
      ...(field.ir_path === undefined ? {} : { irPath: field.ir_path }),
    })),
  ];

  for (const text of printed) {
    for (const wire of wires) {
      // A label or a port sits on the wire it names by construction; a field is exempt from nothing
      // — the symbol put it there, and no run has a reason to cross it.
      if (text.ownNet !== undefined && text.ownNet === wire.net) continue;
      const path = wirePath(wire, symbols);
      if (!path || path.length < 2) continue;
      const through = lengthInBox(path, text.box);
      if (through <= ON_LINE_NM) continue;
      diagnostics.push({
        code: "view.text-on-wire",
        severity: "warning",
        message: `print page ${page}: the wire on net ${wire.net} runs ${mm(through)} mm through ${text.label}`,
        hint: "move the text or reroute the wire: a line through a word makes it unreadable",
        location: at(text.irPath),
        data: {
          page,
          net: wire.net,
          kind: text.kind,
          text: text.text,
          ...(text.instance === undefined ? {} : { instance: text.instance }),
          through_nm: Math.round(through),
        },
      });
    }
  }

  for (const [index, wire] of wires.entries()) {
    const path = wirePath(wire, symbols);
    if (!path || path.length < 2) continue;
    for (const symbol of geometry.symbols) {
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
          location: facts.locate?.(`/wire/${index}`) ?? { file, line: 1, col: 1 },
          data: { page, net: wire.net, instance: symbol.instance_id, through_nm: Math.round(through) },
        });
      }
    }
  }

  // A wire must not run through a pin's connection point or through the pin's drawn line unless it
  // ends at that pin. A pin is a connection; a wire passing through it without a junction dot reads
  // as a connection the drawing does not declare. The repair is local: split the run at the pin (a
  // second `wire` row) or route around it. The wire's own endpoint is excluded from the point test —
  // that is the connection it declares — but not from the line test: a run that approaches the pin
  // from the wrong side still crosses the line the reader sees.
  for (const [index, wire] of wires.entries()) {
    const path = wirePath(wire, symbols);
    if (!path || path.length < 2) continue;
    for (const symbol of geometry.symbols) {
      for (const [pinNumber, pin] of symbol.pins) {
        const pinRef = `${symbol.instance_id}.${pinNumber}`;
        const stroke = pinStroke(symbol, pin);
        let atConnection = false;
        let crossingPoint: Point | null = null;
        for (let i = 0; i + 1 < path.length; i += 1) {
          const a = path[i]!;
          const b = path[i + 1]!;
          if (pinRef !== wire.from_pin && pinRef !== wire.to_pin && distanceToSegment(pin, a, b) <= ON_LINE_NM) {
            atConnection = true;
            break;
          }
          if (stroke !== null) {
            const hit = segmentCrossing(a, b, stroke[0], stroke[1]);
            if (hit !== null) {
              crossingPoint = {
                x_nm: Math.round(a.x_nm + (b.x_nm - a.x_nm) * hit[0]),
                y_nm: Math.round(a.y_nm + (b.y_nm - a.y_nm) * hit[0]),
              };
              break;
            }
          }
        }
        if (!atConnection && crossingPoint === null) continue;
        diagnostics.push({
          code: "view.wire-crosses-pin",
          severity: "warning",
          message:
            crossingPoint === null
              ? `print page ${page}: the wire on net ${wire.net} passes through pin ${pinRef}`
              : `print page ${page}: the wire on net ${wire.net} passes through the line of pin ${pinRef} at (${mmAt(crossingPoint.x_nm)}, ${mmAt(crossingPoint.y_nm)}) mm`,
          hint: "split the run at the pin (a second wire row) or route around it: a wire through a pin reads as a connection",
          location: at(`/wire/${index}`),
          data: {
            page,
            net: wire.net,
            instance: symbol.instance_id,
            pin: pinNumber,
            x_nm: pin.x_nm,
            y_nm: pin.y_nm,
            ...(crossingPoint === null
              ? {}
              : { cross_x_nm: crossingPoint.x_nm, cross_y_nm: crossingPoint.y_nm }),
          },
        });
      }
    }
  }

  // Wiring runs along the sheet's axes (spec/schematic-view.md §5). A slanted segment is not a
  // matter of taste: every other run on the page is horizontal or vertical, so the one line at an
  // angle reads as a leader or a note, and its two ends are two connections whose relationship the
  // reader has to work out. The repair is always local — put a corner where the two ends meet.
  for (const [index, wire] of wires.entries()) {
    const path = wirePath(wire, symbols);
    if (!path || path.length < 2) continue;
    let slanted = 0;
    let firstX = 0;
    let firstY = 0;
    let worst = 0;
    for (let i = 0; i + 1 < path.length; i += 1) {
      const dx = Math.abs(path[i + 1]!.x_nm - path[i]!.x_nm);
      const dy = Math.abs(path[i + 1]!.y_nm - path[i]!.y_nm);
      if (dx === 0 || dy === 0) continue;
      if (slanted === 0) {
        firstX = path[i]!.x_nm;
        firstY = path[i]!.y_nm;
      }
      slanted += 1;
      worst = Math.max(worst, Math.min(dx, dy));
    }
    if (slanted === 0) continue;
    diagnostics.push({
      code: "view.wire-diagonal",
      severity: "warning",
      message: `print page ${page}: ${slanted === 1 ? "a segment of the wire" : `${slanted} segments of the wire`} on net ${wire.net} leaves the axes, the first from (${mmAt(firstX)}, ${mmAt(firstY)}) mm`,
      hint: "put a corner where the run turns: wiring is drawn at right angles only",
      location: at(`/wire/${index}`),
      data: { page, net: wire.net, segments: slanted, x_nm: firstX, y_nm: firstY, off_axis_nm: worst },
    });
  }

  return diagnostics;
}
