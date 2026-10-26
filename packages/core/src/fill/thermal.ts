// Thermal reliefs (ADR-0054 D3): a same-net pad that is joined to the pour by four spokes instead of
// by every bit of its outline, so a soldering iron can heat the pad without heating the whole board.
//
// The geometry is one ring and four bridges:
//   - the ring is the gap: everything within `gap_nm` of the pad's own outline, minus the outline;
//   - a bridge is a rectangle `bridge_nm` wide running from the pad out across the ring, clipped to
//     the ring (grown by 1 nm so it overlaps the pour instead of merely touching it).
// The pour is the pour minus the ring, plus the bridges. Between the bridges the ring stays empty,
// which is the whole point: a spoke that leaked around the corner would be no relief at all.
import { bounds, difference, dilate, intersection, rect, union, type Polygon, type Region } from "@texteda/geom";
import { ARC_SEGMENTS } from "./obstacles.ts";

/** The copper a thermal relief puts back: the gap it cuts, and the bridges it keeps across it. */
export interface ThermalGeometry {
  /** The gap annulus around the pad, to be removed from the pour. */
  ring: Region;
  /** The four spokes, clipped to the annulus (they overlap the pour by 1 nm). */
  spokes: Region;
}

/**
 * The relief of one pad.
 *
 * `pad` is the pad's own outline (one convex-ish ring). `gap_nm` is how far the pour stays away from
 * the pad; `bridge_nm` is how wide each of the four spokes is.
 */
export function thermalRelief(pad: Polygon, gap_nm: number, bridge_nm: number): ThermalGeometry {
  const grown = dilate([pad], gap_nm, ARC_SEGMENTS);
  const ring = difference(grown, [pad]);

  const box = bounds(pad);
  const cx = Math.floor((box.min_x_nm + box.max_x_nm) / 2);
  const cy = Math.floor((box.min_y_nm + box.max_y_nm) / 2);
  const halfBridge = Math.max(1, Math.floor(bridge_nm / 2));
  // One nanometre past the outer edge of the ring, so the spoke overlaps the pour (a shared edge
  // would be a 0-area touch, and two pieces that only touch at a corner are not a connection).
  const outer = difference(dilate([pad], gap_nm + 1, ARC_SEGMENTS), [pad]);
  const reachX = box.max_x_nm + gap_nm + 2;
  const reachY = box.max_y_nm + gap_nm + 2;

  const bridges: Polygon[] = [
    rect(cx, cy - halfBridge, reachX, cy + halfBridge),
    rect(box.min_x_nm - gap_nm - 2, cy - halfBridge, cx, cy + halfBridge),
    rect(cx - halfBridge, cy, cx + halfBridge, reachY),
    rect(cx - halfBridge, box.min_y_nm - gap_nm - 2, cx + halfBridge, cy),
  ];

  // Each bridge keeps only the part that crosses the gap ring; the pour is grown by 1 nm past the
  // ring, so a spoke overlaps copper instead of sharing an edge with it.
  const spokeRegions: Region[] = [];
  for (const bridge of bridges) spokeRegions.push(intersection([bridge], outer));
  return { ring, spokes: union(...spokeRegions) };
}
