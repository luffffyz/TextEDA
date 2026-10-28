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
