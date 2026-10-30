// The pour itself (ADR-0018 D3): one `zone` intent in, one region of copper out.
//
// The shape of the computation is a single sentence, in this order:
//   1. the pour is the zone outline clipped to the board, minus the board's cutouts and its `no_pour`
//      keepouts;
//   2. every piece of copper that is not this zone's net is grown by the pair clearance and removed —
//      copper the schematic gives no net (`net: null`) is removed too, because it is never *this*
//      pour's net and pouring over it would be a short of unknown potential;
//   3. same-net copper that declares `none` is removed with the same clearance, and same-net copper
//      that declares `thermal` has its gap ring removed and its four spokes put back;
//   4. if the board declares `min_width`, copper that cannot hold a disc of half that width is
//      removed, and what was lost is reported rather than silently dropped;
//   5. the result is measured, and an empty pour is reported: a zone that pours nothing is a design
//      fact, not a no-op.
//
// Every step is a kernel boolean, so the output is a disjoint cover of convex pieces in canonical
// order: two runs over the same input are byte-identical, and a pour is a cache entry that may be
// thrown away and recomputed (ADR-0018 D4 — the fill never enters the IR or a hash).
import {
  bounds,
  difference,
  dilate,
  erode,
  intersection,
  regionArea,
  regionBounds,
  union,
  type Bounds,
  type Region,
} from "@texteda/geom";
import type { Diagnostic } from "@texteda/ir/diagnostics";
import { ARC_SEGMENTS } from "./obstacles.ts";
import { pairClearance } from "./rules.ts";
import { thermalRelief } from "./thermal.ts";
import type { FillFacts, FillObstacle, FillOutput, FillZoneInput } from "./types.ts";

/** One zone's fill: the copper it produced, and what the pour had to say about itself. */
export interface ZoneFill {
  output: FillOutput;
  diagnostics: Diagnostic[];
}

/** The fill of a whole board: one output per zone, in the order the zones were declared. */
export interface FillResult {
  zones: FillOutput[];
  diagnostics: Diagnostic[];
}

/**
 * The clearance a cut around `obstacle` needs.
 *
 * A pad may ask for more than the board rule (`clearance_nm` in the footprint), so the cut takes the
 * larger of the pair clearance and the pad's own number. Never the smaller: a pad that declared a gap
 * of its own declared it because something next to it needs it.
 */
export function cutRadius(facts: FillFacts, net: string | null, obstacle: FillObstacle): number {
  const pair = pairClearance(facts.rules, net, obstacle.net);
  return obstacle.clearance_nm === null ? pair : Math.max(pair, obstacle.clearance_nm);
}

/** A stable order for the cuts: the same input set must cut in the same sequence, run to run. */
function cutOrder(a: FillObstacle, b: FillObstacle): number {
  const key = (obstacle: FillObstacle): string => `${obstacle.net ?? "~"}\u0000${obstacle.kind}\u0000${obstacle.ref}`;
  const left = key(a);
  const right = key(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Cheap rejection: an obstacle whose grown box cannot meet the pour box is skipped before any boolean. */
function mayTouch(pour: Bounds, shape: Region, radius: number): boolean {
  for (const ring of shape) {
    const box = bounds(ring);
    if (
      box.max_x_nm + radius >= pour.min_x_nm &&
      box.min_x_nm - radius <= pour.max_x_nm &&
      box.max_y_nm + radius >= pour.min_y_nm &&
      box.min_y_nm - radius <= pour.max_y_nm
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Fill one zone.
 *
 * A zone on a layer the board's stackup does not have pours nothing, and says so
 * (`drc.zone-layer-not-copper`).
 */
export function fillZone(facts: FillFacts, zone: FillZoneInput): ZoneFill {
  const location = { file: facts.file, line: zone.line ?? 1, col: 1 };
  const diagnostics: Diagnostic[] = [];
  const empty: ZoneFill = {
    output: { net: zone.net, layer: zone.layer, region: [], area_nm2: 0 },
    diagnostics,
  };
  // 0. Two zones of different nets that overlap would pour copper into each other: the copper would
  //    be a short that the file then carries to a board house. The IR has no pour priority, so
  //    "which one wins" is not a question this layer may answer (ADR-0018 open question 2), and the
  //    pour refuses before computing anything.
  for (const other of facts.zones) {
    if (other === zone || other.layer !== zone.layer || other.net === zone.net) continue;
    if (intersection([zone.shape], [other.shape]).length === 0) continue;
    diagnostics.push({
      code: "drc.zone-overlap",
      severity: "error",
      message: `zone of net ${zone.net} overlaps a zone of net ${other.net} on ${zone.layer}; their pours would short`,
      location,
      ...(other.line === undefined
        ? {}
        : { related: [{ file: facts.file, line: other.line, col: 1 }] }),
      hint: "separate the two zone outlines, put one on another layer, or state the pour priority the design intends",
      data: { net: zone.net, other_net: other.net, layer: zone.layer },
    });
    return empty;
  }

  if (!facts.copper_layers.includes(zone.layer)) {
    diagnostics.push({
      code: "drc.zone-layer-not-copper",
      severity: "error",
      message: `zone of net ${zone.net} is on ${zone.layer}, which is not a copper layer of the stackup`,
      location,
      expected: facts.copper_layers.join(" / "),
      actual: zone.layer,
      hint: "name a copper layer of the `stackup` section, or add that layer to the stackup",
      data: { net: zone.net, layer: zone.layer },
    });
    return empty;
  }

  // 1. The pour's footprint: the zone's own outline, clipped to the board, minus holes in the board
  //    and minus every keepout on this layer that forbids a pour.
  let base = intersection([facts.outline], [zone.shape]);
  const holes: Region[] = facts.cutouts.map((ring) => [ring]);
  for (const keepout of facts.keepouts) if (keepout.layer === zone.layer) holes.push([keepout.shape]);
  if (holes.length > 0) base = difference(base, ...holes);
  if (base.length === 0) {
    diagnostics.push({
      code: "drc.zone-empty",
      severity: "warning",
      message: `zone of net ${zone.net} on ${zone.layer} pours no copper: nothing of it lies on the board`,
      location,
      hint: "check the zone outline against the board outline, and the keepouts on that layer",
      data: { net: zone.net, layer: zone.layer },
    });
    return empty;
  }
  const pourBox = regionBounds(base)!;

  // 2. Every foreign piece of copper, and the same-net pieces that ask for no connection. The cuts
  //    are applied against `base`, never against the pour: a thermal pad's spoke must also stay out
  //    of another net's clearance.
  const cuts: Region[] = [];
  const thermals: FillObstacle[] = [];
  for (const obstacle of facts.obstacles.filter((entry) => entry.layers.includes(zone.layer)).sort(cutOrder)) {
    const same = obstacle.net === zone.net;
    if (same && obstacle.zone_connect === "solid") continue;
    const radius = cutRadius(facts, zone.net, obstacle);
    if (!mayTouch(pourBox, obstacle.shape, radius)) continue;
    if (same && obstacle.zone_connect === "thermal") thermals.push(obstacle);
    else cuts.push(radius === 0 ? union(obstacle.shape) : dilate(obstacle.shape, radius, ARC_SEGMENTS));
  }
  let allowed = cuts.length === 0 ? base : difference(base, ...cuts);

  // 3. Thermal reliefs: the gap ring is cut, the four spokes are put back — but only where the pour
  //    is allowed at all, so a spoke never reaches into another net's clearance.
  if (thermals.length > 0 && allowed.length > 0) {
    const rings: Region[] = [];
    const spokes: Region[] = [];
    for (const pad of thermals) {
      const relief = thermalRelief(
        pad.shape[0]!,
        pad.thermal_gap_nm ?? facts.rules.thermal_gap_nm,
        pad.thermal_bridge_nm ?? facts.rules.thermal_bridge_nm,
      );
      rings.push(relief.ring);
      if (relief.spokes.length > 0) {
        const clipped = intersection(relief.spokes, allowed);
        if (clipped.length > 0) spokes.push(clipped);
      }
    }
    if (rings.length > 0) allowed = difference(allowed, ...rings);
    if (spokes.length > 0) allowed = union(allowed, ...spokes);
  }

  // 4. Minimum width: copper that cannot carry a disc of half the declared width is not copper a
  //    board house can etch, so it is removed. The loss is reported, never silently taken.
  const minWidth = facts.rules.min_width_nm;
  if (minWidth !== null && minWidth >= 2 && allowed.length > 0) {
    const radius = Math.floor(minWidth / 2);
    const before = regionArea(allowed);
    // An opening (erode then dilate) removes what is thinner than the tool and puts the rest back;
    // the intersection with the input keeps it a subset, because the circumscribed tool can add.
    const opened = intersection(dilate(erode(allowed, radius, ARC_SEGMENTS), radius, ARC_SEGMENTS), allowed);
    const after = regionArea(opened);
    if (after < before) {
      diagnostics.push({
        code: "drc.zone-min-width",
        severity: "warning",
        message: `the min_width rule removed ${((before - after) / 1_000_000_000_000).toFixed(4)} mm² of the ${zone.net} pour on ${zone.layer}`,
        location,
        expected: `copper at least ${minWidth / 1_000_000} mm wide`,
        actual: `${((before - after) / 1_000_000_000_000).toFixed(4)} mm² was thinner than that`,
        hint: "widen the zone, move the copper that splits it, or lower `min_width` if the board house can etch thinner",
        data: { net: zone.net, layer: zone.layer, removed_nm2: Math.round(before - after), before_nm2: Math.round(before) },
      });
    }
    allowed = opened;
  }

  // 5. Measure, and report a pour that vanished.
  const area_nm2 = regionArea(allowed);
  if (allowed.length === 0) {
    diagnostics.push({
      code: "drc.zone-empty",
      severity: "warning",
      message: `zone of net ${zone.net} on ${zone.layer} pours no copper`,
      location,
      hint: "check the zone outline, the keepouts on that layer, and the clearance around nearby copper",
      data: { net: zone.net, layer: zone.layer },
    });
  }
  return { output: { net: zone.net, layer: zone.layer, region: allowed, area_nm2 }, diagnostics };
}

/** Fill every zone of a board. */
export function fillBoard(facts: FillFacts): FillResult {
  const zones: FillOutput[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const zone of facts.zones) {
    const fill = fillZone(facts, zone);
    zones.push(fill.output);
    diagnostics.push(...fill.diagnostics);
  }
  return { zones, diagnostics };
}
