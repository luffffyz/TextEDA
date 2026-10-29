// Re-anchoring a wire after a placement change (ADR-0141 D5).
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
 * wire whose interior is not orthogonal is reported rather than redrawn (ADR-0141 D6).
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
   * person has to look at the wire (ADR-0141 D6: a conflict is reported, not papered over).
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
  return { points: corners };
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
 */
export function nearestOnPath(
  path: readonly WireCorners[],
  point: WireCorners,
): WireCorners | undefined {
  let best: WireCorners | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
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
