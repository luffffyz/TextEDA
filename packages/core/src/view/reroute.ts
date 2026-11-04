// Re-anchoring a wire after a placement change (ADR-0042 D5).
//
// A wire row names its endpoints by pin and stores its corners as absolute points. When a symbol
// moves, the endpoints move with it — they are the symbol's own connection points — while the
// corners stay where they were, so the run can stop being orthogonal or can leave the pin.
//
// The re-anchor puts the run back on its pins **without changing its shape**: the same number of
// segments, the same sequence of directions, and the same free coordinates. A corner's coordinate
// that the shape pins down (the x of a vertical run, the y of a horizontal one) is re-derived from
// the new endpoints; a coordinate the shape leaves free keeps the value the person drew.
//
// This is deliberately not a router. It knows nothing about symbols, clearance or courtyards, and
// it never searches: the same placement always produces the same corners. A run that now crosses
// the body of the symbol it belongs to is reported as a finding (`view.wire-crosses-symbol`), not
// routed around.

import { distanceToSegment, pinStroke, segmentCrossing, segmentInBox, ON_LINE_NM } from "./geometry.ts";

export interface WireCorners {
  x_nm: number;
  y_nm: number;
}

/**
 * Bring a wire back onto its pins, from the file alone.
 *
 * The re-anchor above needs to know where the pins were: it is the app's job, after a drag. From
 * the command line there is no before and after — only the page as it stands. So this is the other
 * half of the same idea: the wire keeps its corners, and the ends are put back where the pins
 * now are.
 *
 * The shape is read off the wire as it is drawn. Two segments that meet at a corner cannot run the
 * same way — two horizontal segments would be one line — so a corner's two segments differ in
 * direction, and the direction of the end segment follows from the one next to it. That is what
 * makes the repair possible without the before-state: the wire's own corners say which way its
 * ends have to leave.
 *
 * It is still not a router. The interior corners keep their coordinates, nothing is searched, and a
 * wire whose interior is not orthogonal is reported rather than redrawn (ADR-0042 D6).
 */
export interface RerouteInput {
  readonly net: string;
  readonly from_pin: string;
  readonly to_pin: string;
  /** The wire's stored corners. */
  readonly points: readonly WireCorners[];
  /** Where the from-pin sits now. */
  readonly from: WireCorners;
  /** Where the to-pin sits now. */
  readonly to: WireCorners;
}

export interface Rerouted {
  /** The wire's new corners. */
  readonly points: WireCorners[];
  /** Set when the wire could not be brought back onto its pins. */
  readonly conflict?: "not-orthogonal";
  /** Whether the corners changed. */
  readonly changed: boolean;
}

/** Whether the two points are on a horizontal or a vertical line; neither when they are neither. */
function axisOf(a: WireCorners, b: WireCorners): "horizontal" | "vertical" | "diagonal" {
  if (a.x_nm === b.x_nm && a.y_nm === b.y_nm) return "vertical";
  if (a.x_nm === b.x_nm) return "vertical";
  if (a.y_nm === b.y_nm) return "horizontal";
  return "diagonal";
}

/**
 * The corners a wire should carry so that it reaches its pins along the axes.
 *
 * The end segments are re-derived from the pins' current positions; the interior corners keep their
 * coordinates. A wire that has no corner at all gets one, because two pins that share neither
 * coordinate cannot be joined by a single straight run.
 *
 * The direction of an end segment is read off the wire itself: an end that still runs along an axis
 * says which way it leaves, and an end that a moved pin has broken takes the direction of the
 * segment next to it — two segments that meet at a corner cannot run the same way, or they would be
 * one line.
 */
export function rerouteWire(input: RerouteInput): Rerouted {
  const corners = input.points.map((point) => ({ x_nm: point.x_nm, y_nm: point.y_nm }));
  const path: WireCorners[] = [input.from, ...corners, input.to];
  const axes: ("horizontal" | "vertical" | "diagonal")[] = [];
  for (let i = 0; i + 1 < path.length; i += 1) axes.push(axisOf(path[i]!, path[i + 1]!));

  if (axes.every((axis) => axis !== "diagonal")) {
    return { points: corners, changed: false };
  }
  // An interior segment that is not on an axis has no shape to keep: the wire is reported.
  if (axes.slice(1, -1).some((axis) => axis === "diagonal")) {
    return { points: corners, conflict: "not-orthogonal", changed: false };
  }

  if (corners.length === 0) {
    // One straight run cannot reach two pins that share neither coordinate: it gets the bend the
    // spec asks for ("add a bend where the two ends meet", spec/schematic-view.md §5).
    if (axisOf(input.from, input.to) !== "diagonal") return { points: corners, changed: false };
    return { points: [{ x_nm: input.from.x_nm, y_nm: input.to.y_nm }], changed: true };
  }

  const next = corners.map((corner) => ({ ...corner }));
  const last = next.length - 1;
  // The direction an end segment leaves in: what the wire says, or — where a moved pin has broken
  // it — the opposite of the segment next to it.
  const firstAxis = axes[0] === "diagonal" ? opposite(axes[1]) : axes[0];
  const lastAxis = axes[axes.length - 1] === "diagonal" ? opposite(axes[axes.length - 2]) : axes[axes.length - 1];

  if (corners.length === 1) {
    // The single corner joins both ends: it has to reach the first pin along one axis and the
    // second along the other. When a moved pin has broken both, the spec's elbow is the answer.
    const axis = axes[0] !== "diagonal" ? axes[0] : axes[1] !== "diagonal" ? opposite(axes[1]) : "vertical";
    next[0] =
      axis === "vertical"
        ? { x_nm: input.from.x_nm, y_nm: input.to.y_nm }
        : { x_nm: input.to.x_nm, y_nm: input.from.y_nm };
    return { points: next, changed: true };
  }

  // The first end: the corner takes the pin's coordinate on the axis the end runs along.
  next[0] =
    firstAxis === "vertical"
      ? { x_nm: input.from.x_nm, y_nm: next[0]!.y_nm }
      : { x_nm: next[0]!.x_nm, y_nm: input.from.y_nm };
  // The last end: the same rule, read from the other side.
  next[last] =
    lastAxis === "vertical"
      ? { x_nm: input.to.x_nm, y_nm: next[last]!.y_nm }
      : { x_nm: next[last]!.x_nm, y_nm: input.to.y_nm };
  const changed = next.some((corner, index) => corner.x_nm !== corners[index]!.x_nm || corner.y_nm !== corners[index]!.y_nm);
  return { points: next, changed };
}

/** The axis a segment runs along when it cannot be the same as the one next to it. */
function opposite(axis: "horizontal" | "vertical" | "diagonal" | undefined): "horizontal" | "vertical" {
  return axis === "horizontal" ? "vertical" : "horizontal";
}


/** One wire, as the view stores it, plus where its pins were and are. */
export interface ReanchorInput {
  net: string;
  from_pin: string;
  to_pin: string;
  /** The wire's stored corners. */
  points: readonly WireCorners[];
  /** Where the from-pin sat before the change. */
  from: WireCorners;
  /** Where the to-pin sat before the change. */
  to: WireCorners;
  /** Where the from-pin sits now. */
  newFrom: WireCorners;
  /** Where the to-pin sits now. */
  newTo: WireCorners;
}

export interface Reanchored {
  /** The wire's new corners. */
  points: WireCorners[];
  /**
   * Set when the wire's shape could not be kept. The corners are then a fresh elbow, and the
   * person has to look at the wire (ADR-0042 D6: a conflict is reported, not papered over).
   */
  conflict?: "not-orthogonal" | "shape-lost";
}

/**
 * The corners a wire should carry after the pins it joins have moved.
 *
 * The shape is read off the wire as it was drawn: every segment is vertical, horizontal, or — for a
 * wire somebody drew by hand and got wrong — neither. A segment that is neither has no direction to
 * preserve, so the wire is rebuilt as an elbow and reported.
 */
export function reanchorWire(input: ReanchorInput): Reanchored {
  const path: WireCorners[] = [input.from, ...input.points, input.to];
  const segments = path.length - 1;

  // The direction of every segment: a vertical run shares its x, a horizontal one its y.
  const vertical: boolean[] = [];
  for (let i = 0; i < segments; i += 1) {
    const a = path[i]!;
    const b = path[i + 1]!;
    if (a.x_nm === b.x_nm) vertical.push(true);
    else if (a.y_nm === b.y_nm) vertical.push(false);
    else {
      // The wire is not orthogonal to begin with: there is no shape to keep.
      return { points: [elbow(input.newFrom, input.newTo, true)], conflict: "not-orthogonal" };
    }
  }

  const x = sharedCoordinate(path, vertical, true, input.newFrom, input.newTo);
  const y = sharedCoordinate(path, vertical, false, input.newFrom, input.newTo);
  if (x === undefined || y === undefined) {
    // The whole run is one direction and the pins no longer line up: it becomes one elbow, and
    // the first segment keeps the direction the run had.
    const straight = vertical[0] === true;
    return { points: [elbow(input.newFrom, input.newTo, straight)], conflict: "shape-lost" };
  }

  const corners: WireCorners[] = [];
  for (let i = 1; i < path.length - 1; i += 1) {
    corners.push({ x_nm: x[i]!, y_nm: y[i]! });
  }
  // The shape was kept; what it now contains is not part of the shape. A corner that ended up on
  // top of its neighbour, or that doubles back along the run it came from, is an artefact of
  // moving the pins, not something the person drew.
  // `points` holds the wire's corners, not its ends: the ends are the pins. `tidy` works on the
  // whole run, so its first and last points — which are the new pin positions — are dropped again.
  const tidyPath = tidy([input.newFrom, ...corners, input.newTo]);
  // A move can leave a path that crosses itself: the corner count was kept, but the run now passes
  // over the leg it starts from. That is not the shape anybody drew — the drawn shape was simple —
  // so it is a lost shape, not a detour to preserve. The run is rebuilt as one elbow, and the
  // person is told to look at it (ADR-0042 D6).
  if (crossesItself(tidyPath)) {
    // A run whose two ends share an axis is a straight line, and needs no corner at all.
    const straightLine = input.newFrom.x_nm === input.newTo.x_nm || input.newFrom.y_nm === input.newTo.y_nm;
    return {
      points: straightLine ? [] : [elbow(input.newFrom, input.newTo, vertical[0] === true)],
      conflict: "shape-lost",
    };
  }
  return { points: tidyPath.length === 0 ? [] : tidyPath.slice(1, -1) };
}

/**
 * Whether a path crosses itself.
 *
 * Only the interior of two segments counts: two segments that meet at a shared end are the path
 * turning, not the path crossing. A zero-length segment is skipped.
 */
function crossesItself(path: readonly WireCorners[]): boolean {
  const n = path.length - 1;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 2; j < n; j += 1) {
      if (segmentsCross(path[i]!, path[i + 1]!, path[j]!, path[j + 1]!)) return true;
    }
  }
  return false;
}

function segmentsCross(a: WireCorners, b: WireCorners, c: WireCorners, d: WireCorners): boolean {
  const side = (p: WireCorners, q: WireCorners, r: WireCorners): number =>
    Math.sign((q.x_nm - p.x_nm) * (r.y_nm - p.y_nm) - (q.y_nm - p.y_nm) * (r.x_nm - p.x_nm));
  if (a.x_nm === b.x_nm && a.y_nm === b.y_nm) return false;
  if (c.x_nm === d.x_nm && c.y_nm === d.y_nm) return false;
  return side(a, b, c) !== side(a, b, d) && side(c, d, a) !== side(c, d, b);
}

/**
 * Drop the corners that add nothing to a path's shape: zero-length segments, a corner in the
 * middle of a straight run, and a corner that reverses along the segment before it.
 *
 * The last one matters most. Keeping a run's corner count is how the shape is preserved, but when
 * a pin moves past the corner the run stops there, the corner stays behind, and the path doubles
 * back on itself. That drawing reads as a join where there is none: the renderer counts arms by
 * direction, so a leg that doubles back over the one below it makes three arms out of two. The
 * path is reduced until no two consecutive segments run along one line.
 *
 * The path always keeps both of its ends; only interior points can go.
 */
function tidy(path: readonly WireCorners[]): WireCorners[] {
  const along = (a: WireCorners, b: WireCorners): "horizontal" | "vertical" | "point" | "diagonal" =>
    a.x_nm === b.x_nm && a.y_nm === b.y_nm
      ? "point"
      : a.x_nm === b.x_nm
        ? "vertical"
        : a.y_nm === b.y_nm
          ? "horizontal"
          : "diagonal";
  const points: WireCorners[] = [];
  for (const point of path) {
    points.push({ x_nm: point.x_nm, y_nm: point.y_nm });
    // Fold the tail until its last two interior segments no longer share a line. Two iterations
    // are enough: each one removes a point, and a removed point cannot split a run again.
    for (;;) {
      const count = points.length;
      if (count < 3) break;
      const a = points[count - 3]!;
      const b = points[count - 2]!;
      const c = points[count - 1]!;
      if (along(b, c) === "point") {
        points.pop(); // the point just pushed landed on the one before it
        continue;
      }
      const ab = along(a, b);
      if (ab !== "diagonal" && ab === along(b, c)) {
        points.splice(count - 2, 1); // straight through, or doubling back: b is not a corner
        continue;
      }
      break;
    }
  }
  return points;
}

/**
 * The coordinate a run of segments shares: the x of a vertical run, the y of a horizontal one.
 *
 * A run that reaches the first pin takes that pin's coordinate, a run that reaches the last pin
 * takes that pin's, and a run that reaches neither keeps the value it was drawn with. A run that
 * reaches both pins cannot have two different values, so it is the one case the shape cannot keep.
 */
function sharedCoordinate(
  path: readonly WireCorners[],
  vertical: readonly boolean[],
  wantX: boolean,
  newFrom: WireCorners,
  newTo: WireCorners,
): number[] | undefined {
  const segments = vertical.length;
  const values: number[] = new Array(path.length).fill(0);
  for (let i = 0; i < segments; i += 1) {
    if (vertical[i] !== wantX) continue;
    // The run of segments that share this coordinate.
    let end = i;
    while (end + 1 < segments && vertical[end + 1] === wantX) end += 1;
    let value: number;
    if (i === 0 && end === segments - 1) {
      // The whole run is one direction: both pins have to agree on the shared coordinate.
      const a = wantX ? newFrom.x_nm : newFrom.y_nm;
      const b = wantX ? newTo.x_nm : newTo.y_nm;
      if (a !== b) return undefined;
      value = a;
    } else if (i === 0) {
      value = wantX ? newFrom.x_nm : newFrom.y_nm;
    } else if (end === segments - 1) {
      value = wantX ? newTo.x_nm : newTo.y_nm;
    } else {
      value = wantX ? path[i]!.x_nm : path[i]!.y_nm;
    }
    for (let k = i; k <= end + 1; k += 1) values[k] = value;
    i = end;
  }
  // A vertex that no run reaches keeps the coordinate the shape leaves free.
  for (let k = 0; k < path.length; k += 1) {
    if (k === 0) {
      values[k] = wantX ? newFrom.x_nm : newFrom.y_nm;
      continue;
    }
    if (k === path.length - 1) {
      values[k] = wantX ? newTo.x_nm : newTo.y_nm;
      continue;
    }
    const reached = (k - 1 >= 0 && vertical[k - 1] === wantX) || (k < segments && vertical[k] === wantX);
    if (!reached) values[k] = wantX ? path[k]!.x_nm : path[k]!.y_nm;
  }
  return values;
}

/**
 * The corner of an elbow between two points: the first leg keeps `vertical`'s direction.
 *
 * `vertical` gives the first segment's direction, so the elbow sits at the first point's x (for a
 * vertical first leg) and at the last point's y.
 */
function elbow(from: WireCorners, to: WireCorners, vertical: boolean): WireCorners {
  return vertical
    ? { x_nm: from.x_nm, y_nm: to.y_nm }
    : { x_nm: to.x_nm, y_nm: from.y_nm };
}

/**
 * The point of a drawn path that is nearest to `point`.
 *
 * A label or a port has to sit on the net it names; when a move leaves it in the air, the nearest
 * point of the net's wiring is where it belongs. The nearest point of a segment is its
 * perpendicular foot, clamped to the segment's ends.
 *
 * A path of one point is a point, not a line: that is how a net's member pin enters the search
 * (a label may sit on a pin, spec/schematic-view.md §6).
 */
export function nearestOnPath(
  path: readonly WireCorners[],
  point: WireCorners,
): WireCorners | undefined {
  let best: WireCorners | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  if (path.length === 1) return path[0]!;
  for (let i = 0; i + 1 < path.length; i += 1) {
    const a = path[i]!;
    const b = path[i + 1]!;
    const foot = closestOnSegment(a, b, point);
    const distance = Math.hypot(foot.x_nm - point.x_nm, foot.y_nm - point.y_nm);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = foot;
    }
  }
  return best;
}

/**
 * Put a label or a port back on the net it names.
 *
 * A label that sits in the air tells the reader nothing, and the checker's finding for it
 * (`view.label-not-on-net`) is a warning the person did not ask for. The nearest point of the
 * net's drawn wiring is where the label belongs.
 *
 * Returns `undefined` when the label is already on the net — there is nothing to repair — and when
 * the net is not drawn on this page at all: a page that does not draw a net is a sketch, and the
 * checker says so in its own words.
 */
export function reseatOnNet(
  paths: readonly (readonly WireCorners[])[],
  point: WireCorners,
): WireCorners | undefined {
  let best: WireCorners | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const path of paths) {
    const foot = nearestOnPath(path, point);
    if (foot === undefined) continue;
    const distance = Math.hypot(foot.x_nm - point.x_nm, foot.y_nm - point.y_nm);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = foot;
    }
  }
  if (best === undefined) return undefined;
  if (bestDistance <= ON_NET_NM) return undefined;
  return best;
}

/** How far a label may be from a net's wiring and still count as sitting on it. */
export const ON_NET_NM = 1_000;


function closestOnSegment(a: WireCorners, b: WireCorners, point: WireCorners): WireCorners {
  const dx = b.x_nm - a.x_nm;
  const dy = b.y_nm - a.y_nm;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return { x_nm: a.x_nm, y_nm: a.y_nm };
  let t = ((point.x_nm - a.x_nm) * dx + (point.y_nm - a.y_nm) * dy) / lengthSquared;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  return { x_nm: Math.round(a.x_nm + dx * t), y_nm: Math.round(a.y_nm + dy * t) };
}

/** A box on the sheet, as the drawing reports it (no dependency on the renderer). */
export interface ObstacleBox {
  readonly min_x_nm: number;
  readonly max_x_nm: number;
  readonly min_y_nm: number;
  readonly max_y_nm: number;
}

/** One placed symbol, as far as a repair cares: where its body is, and where its pins connect. */
export interface ObstacleSymbol {
  readonly instance_id: string;
  readonly box: ObstacleBox;
  readonly pins: ReadonlyMap<string, WireCorners>;
}

/** What a simplified run must not run through. */
export interface RunObstacles {
  readonly symbols: readonly ObstacleSymbol[];
  /** The ends of the run: a pin of this run is the connection it declares, not an obstacle. */
  readonly ends: readonly string[];
  /**
   * The labels and ports the drawing anchors to this run.
   *
   * A label names a net and sits on that net's wiring; a port is where a run leaves the page. Both
   * are placed where they are because the line they sit on is there, so a shortening that takes
   * that line away leaves them in the air — and the page then reports them, or carries them to
   * whatever line is left. They are therefore part of what a legal shortening has to keep, and the
   * reason a bus at one `y` stays at that `y`: the labels on it have nowhere else to go.
   */
  readonly anchors?: readonly { readonly point: WireCorners; readonly slack_nm: number }[];
}

/**
 * Whether a path is a legal drawing of one run.
 *
 * The rules are exactly the ones the readability check applies to a drawn run
 * (`view.wire-diagonal`, `view.wire-crosses-symbol`, `view.wire-crosses-pin`, spec/schematic-view.md
 * §5), asked here about a path that does not exist yet: every segment is axis-parallel, no segment
 * runs through a symbol's body, through a foreign pin's stroke, or over a foreign pin's connection
 * point. The run's own ends are exempt — a wire that ends at a pin necessarily touches it.
 *
 * This is a **filter**, not a search: a candidate is accepted or rejected, and nothing is scored.
 */
export function isLegalRun(path: readonly WireCorners[], obstacles: RunObstacles): boolean {
  if (path.length < 2) return false;
  // An anchored label or port has to stay with the run: shortening may not slide out from under
  // it. The slack is how far the run's own ends moved — a label follows a run that moved, and
  // straightening a detour next to it is the same move. What is refused is the case where the
  // shortening would strand the label somewhere the move never went.
  for (const anchor of obstacles.anchors ?? []) {
    let near = false;
    for (let i = 0; i + 1 < path.length && !near; i += 1) {
      near = distanceToSegment(anchor.point, path[i]!, path[i + 1]!) <= ON_LINE_NM + anchor.slack_nm;
    }
    if (!near) return false;
  }
  for (let i = 0; i + 1 < path.length; i += 1) {
    const a = path[i]!;
    const b = path[i + 1]!;
    // A slanted segment reads as a leader, not a wire (spec/schematic-view.md §5).
    if (a.x_nm !== b.x_nm && a.y_nm !== b.y_nm) return false;
    for (const symbol of obstacles.symbols) {
      if (segmentInBox(a, b, symbol.box, ON_LINE_NM) !== null) return false;
    }
    for (const symbol of obstacles.symbols) {
      for (const [pinNumber, at] of symbol.pins) {
        if (obstacles.ends.includes(`${symbol.instance_id}.${pinNumber}`)) continue;
        if (distanceToSegment(at, a, b) <= ON_LINE_NM) return false;
        const stroke = pinStroke(symbol, at);
        if (stroke !== null && segmentCrossing(a, b, stroke[0], stroke[1]) !== null) return false;
      }
    }
  }
  return true;
}

/**
 * The same run with the corners it does not need.
 *
 * The run's ends are fixed — they are the pins (or the port) the row names. What may change is the
 * corners between them, and only two ways, both of which keep the drawing on coordinates it already
 * uses:
 *
 * 1. **Drop a corner the ends no longer need.** The remaining corners must still share one line
 *    (or be none at all). Sharing a line is what a bus is, and a bus keeps its line: the labels and
 *    ports sitting on it have nowhere else to go ({@link RunObstacles.anchors} makes that a rule,
 *    not a convention). A removal that would leave the corners scattered over the sheet rebuilt the
 *    run instead of shortening it.
 * 2. **Keep the one corner that joins the two ends.** When a corner sits where the ends' own lines
 *    meet — `(from.x, to.y)` or `(to.x, from.y)` — and the drawing already has it, the run between
 *    them needs nothing else. This pass does not invent the corner; it keeps one that is there.
 *
 * A leg that reaches an end moves with that end: when a removal leaves the first or last segment
 * slanted, the corner next to it is put onto the end's line — **one** correction, never two,
 * because moving both legs is a rebuild.
 *
 * Every candidate must pass {@link isLegalRun}, the same rules the readability check applies to a
 * drawn run. This is not a router: no search, no cost function, and a detour drawn around
 * something on purpose survives, because removing its corner runs the wire through what it went
 * around.
 */
export function simplifyRun(
  path: readonly WireCorners[],
  obstacles: RunObstacles,
): { path: WireCorners[]; changed: boolean } {
  if (path.length <= 2) return { path: [...path], changed: false };
  const points = path.map((point) => ({ x_nm: point.x_nm, y_nm: point.y_nm }));
  const from = points[0]!;
  const to = points[points.length - 1]!;
  let changed = false;

  // Rule 2 first: the one corner that joins both ends, when the drawing already has it.
  if (points.length > 3) {
    const joins = [
      { x_nm: from.x_nm, y_nm: to.y_nm },
      { x_nm: to.x_nm, y_nm: from.y_nm },
    ];
    for (const join of joins) {
      if (join.x_nm === from.x_nm && join.y_nm === from.y_nm) continue;
      if (join.x_nm === to.x_nm && join.y_nm === to.y_nm) continue;
      const at = points.findIndex(
        (point, index) =>
          index > 0 && index + 1 < points.length && point.x_nm === join.x_nm && point.y_nm === join.y_nm,
      );
      if (at < 0) continue;
      const candidate = [from, join, to];
      if (!sharesLine(candidate, points)) continue;
      if (!isLegalRun(candidate, obstacles)) continue;
      return { path: candidate, changed: true };
    }
  }

  // Rule 1: drop corners, one at a time, while the rest still share one line. Several removals
  // can be legal at once — both ends are fixed, so a corner may be dropped on either side of what
  // is left — and the one that keeps the most corners where the person drew them is the shorter
  // drawing of the same run that changes the least.
  while (points.length > 2) {
    let best: WireCorners[] | undefined;
    let bestKept = -1;
    for (let index = 1; index + 1 < points.length; index += 1) {
      const kept = [...points.slice(0, index), ...points.slice(index + 1)];
      const candidate = bendOneEnd(kept, points);
      if (candidate === undefined) continue;
      if (hasZeroLengthSegment(candidate)) continue;
      if (!interiorShareOneLine(candidate)) continue;
      if (!isLegalRun(candidate, obstacles)) continue;
      const score = keptCorners(candidate, path);
      if (score < bestKept) continue;
      bestKept = score;
      best = candidate;
    }
    if (best === undefined) break;
    points.length = 0;
    points.push(...best);
    changed = true;
  }

  return { path: points, changed };
}

/**
 * Whether the corners between the ends still sit on one line.
 *
 * Corners on one line are a bus, and a bus keeps its line. A run whose corners are scattered over
 * the sheet is a shape somebody drew for a reason — a detour around a body, a staircase — and
 * shortening it would have to invent lines. One corner is the join rule's business, not this one: a
 * run left with a single corner after a removal has had its whole shape replaced.
 */
function interiorShareOneLine(path: readonly WireCorners[]): boolean {
  const corners = path.slice(1, -1);
  if (corners.length < 2) return false;
  const sameY = corners.every((corner) => corner.y_nm === corners[0]!.y_nm);
  const sameX = corners.every((corner) => corner.x_nm === corners[0]!.x_nm);
  return sameY || sameX;
}

/**
 * The corners left after a removal, with the one slanted end joined up.
 *
 * Removing a corner can leave the first or the last segment slanted: the leg that reaches a pin
 * still has to reach it, and the pin is where it is. The corner next to that end is put onto the
 * end's line — one axis, on the axis the drawn end segment used — which is the same correction the
 * re-anchor makes for a shape it could not keep.
 *
 * Returns `undefined` when the slant cannot be fixed, or when **both** ends slant: a removal that
 * would move both legs is a rebuild, not a shortening.
 */
function bendOneEnd(kept: readonly WireCorners[], drawn: readonly WireCorners[]): WireCorners[] | undefined {
  void drawn;
  const candidate = kept.map((point) => ({ x_nm: point.x_nm, y_nm: point.y_nm }));
  if (candidate.length < 2) return undefined;
  const slants = (list: readonly WireCorners[], index: number): boolean =>
    list[index]!.x_nm !== list[index + 1]!.x_nm && list[index]!.y_nm !== list[index + 1]!.y_nm;

  if (slants(candidate, 0)) {
    if (candidate.length < 3) return undefined;
    const start = candidate[0]!;
    const corner = candidate[1]!;
    // The corner's other side is unchanged, so it already pins one of the corner's axes: a
    // horizontal next segment pins the y, a vertical one pins the x. Only the free axis moves, and
    // it moves onto the end's own coordinate.
    const next = candidate[2]!;
    if (next.y_nm === corner.y_nm) candidate[1] = { x_nm: start.x_nm, y_nm: corner.y_nm };
    else candidate[1] = { x_nm: corner.x_nm, y_nm: start.y_nm };
    // The head fix may have slanted the other end; that is a second correction, so refuse.
    if (slants(candidate, candidate.length - 2)) return undefined;
  }
  if (slants(candidate, candidate.length - 2)) {
    if (candidate.length < 3) return undefined;
    const last = candidate.length - 1;
    const end = candidate[last]!;
    const corner = candidate[last - 1]!;
    // The same rule from the other end: the segment the corner still has pins one axis.
    const previous = candidate[last - 2]!;
    if (previous.y_nm === corner.y_nm) candidate[last - 1] = { x_nm: end.x_nm, y_nm: corner.y_nm };
    else candidate[last - 1] = { x_nm: corner.x_nm, y_nm: end.y_nm };
  }
  return candidate;
}

/**
 * Whether a candidate run still runs on a line the drawing used.
 *
 * Collinear and overlapping, not "the same pair of ends": shortening a segment moves one of its
 * ends, and the shortened segment is still on the line the person drew.
 */
function sharesLine(candidate: readonly WireCorners[], drawn: readonly WireCorners[]): boolean {
  for (let i = 0; i + 1 < candidate.length; i += 1) {
    const [p, q] = [candidate[i]!, candidate[i + 1]!];
    for (let j = 0; j + 1 < drawn.length; j += 1) {
      if (overlapsOnLine(p, q, drawn[j]!, drawn[j + 1]!)) return true;
    }
  }
  return false;
}

/** Whether two axis-parallel segments lie on the same line and share more than a point. */
function overlapsOnLine(p: WireCorners, q: WireCorners, r: WireCorners, s: WireCorners): boolean {
  const horizontal = p.y_nm === q.y_nm;
  if (horizontal !== (r.y_nm === s.y_nm)) return false;
  if (horizontal) {
    if (p.y_nm !== r.y_nm) return false;
    const [a1, a2] = p.x_nm < q.x_nm ? [p.x_nm, q.x_nm] : [q.x_nm, p.x_nm];
    const [b1, b2] = r.x_nm < s.x_nm ? [r.x_nm, s.x_nm] : [s.x_nm, r.x_nm];
    return Math.min(a2, b2) > Math.max(a1, b1);
  }
  if (p.x_nm !== r.x_nm) return false;
  const [a1, a2] = p.y_nm < q.y_nm ? [p.y_nm, q.y_nm] : [q.y_nm, p.y_nm];
  const [b1, b2] = r.y_nm < s.y_nm ? [r.y_nm, s.y_nm] : [s.y_nm, r.y_nm];
  return Math.min(a2, b2) > Math.max(a1, b1);
}

/** How many of a candidate's corners sit where the drawing already had a corner. */
function keptCorners(candidate: readonly WireCorners[], drawn: readonly WireCorners[]): number {
  let kept = 0;
  for (const point of candidate.slice(1, -1)) {
    if (drawn.some((other) => other.x_nm === point.x_nm && other.y_nm === point.y_nm)) kept += 1;
  }
  return kept;
}

/** Whether a path has a segment of zero length, which is no drawing of anything. */
function hasZeroLengthSegment(path: readonly WireCorners[]): boolean {
  for (let i = 0; i + 1 < path.length; i += 1) {
    if (path[i]!.x_nm === path[i + 1]!.x_nm && path[i]!.y_nm === path[i + 1]!.y_nm) return true;
  }
  return false;
}

