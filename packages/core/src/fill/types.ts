// The fill policy's vocabulary (ADR-0117 D3). The kernel knows shapes; this layer knows nets,
// clearance, thermal settings and layers, and nothing here reaches into the kernel's algorithms.
//
// Coordinates are board nanometres, already transformed by `place`. Every shape in this file is
// raw copper: a pad's own outline, a trace's centre line expanded by half its width, a via's outer
// ring. Clearance and thermal gaps are applied here, never baked into the input.
import type { Footprint } from "@texteda/ir/footprint";
import type { Pcb } from "@texteda/ir/pcb";
import type { Polygon, Region } from "@texteda/geom";

/**
 * A footprint in board coordinates, ready to be turned into pads.
 *
 * The footprint IR is taken whole rather than through a pre-digested pad circle: a pour has to
 * respect the pad's real outline, and only the footprint knows whether a pad is a rect, a
 * roundrect, an oval or a circle.
 */
export interface PlacedFootprint {
  /** Board-flat instance id: `U1`, `M2.U1` (ADR-0112 decision 2). */
  instance_id: string;
  footprint: Footprint;
}

/** How a copper obstacle meets a pour of its own net (ADR-0117's hard table, "Same-net copper"). */
export type ZoneConnect = "solid" | "thermal" | "none";

/**
 * One piece of copper on the board, in board coordinates.
 *
 * `net` is the schematic's net, not the drawing's: a pad belongs to the net of the pin it is on,
 * and a trace or via belongs to the net it declares. `null` means the schematic names no net for
 * this copper (an unconnected or `no_connect` pin, a mounting hole's ring, a fiducial): such copper
 * is never any pour's net, so every pour keeps clear of it. That is the conservative reading, and it
 * is the only one that cannot create a short.
 */
export interface FillObstacle {
  kind: "pad" | "trace" | "via" | "hole";
  net: string | null;
  /** Copper layers this obstacle occupies; `*.Cu` is expanded (and mirrored for a bottom-side part) before it arrives here. */
  layers: string[];
  /** Raw copper outline: no clearance, no thermal gap. One ring for a pad or a via, one capsule per trace segment. */
  shape: Region;
  /** Only pads declare this; traces and vias are always solid. */
  zone_connect: ZoneConnect;
  /** Pad-declared minimum clearance, else the board rule applies. */
  clearance_nm: number | null;
  /** Pad-declared thermal gap and spoke width, else the board rule applies. */
  thermal_gap_nm: number | null;
  thermal_bridge_nm: number | null;
  /** `U1.1`, `trace 3`, `H1`: what a diagnostic names. */
  ref: string;
}

/** A region where copper may not be poured (`keepout` type `no_pour`). */
export interface FillKeepout {
  layer: string;
  shape: Polygon;
}

/** A `zone`'s intent, in board coordinates (spec/pcb.md §4.7). */
export interface FillZoneInput {
  net: string;
  layer: string;
  shape: Polygon;
  /** Source line of the `zone` row, for diagnostics; the shard carries no per-record line (ADR-0103). */
  line?: number;
}

/**
 * The board rules a pour reads. Missing rules fall back to the documented defaults below, because a
 * board that declares no `rules` still has to be fillable (spec/pcb.md §4.9 makes `rules` required,
 * so in practice these only cover a partial table).
 */
export interface FillRules {
  clearance_nm: number;
  /**
   * Per-net clearance declarations (spec/pcb.md §4.9, rule `net`). A net rule replaces the default
   * for that net, so the gap between two nets is the larger of the two nets' values: a pour may
   * widen a gap on its own, never narrow somebody else's.
   */
  net_clearance_nm: ReadonlyMap<string, number>;
  thermal_gap_nm: number;
  thermal_bridge_nm: number;
  /** `null` disables the minimum-width pass. */
  min_width_nm: number | null;
}

/** Defaults for a rule the board does not declare (spec/pcb.md §4.9). */
export const FILL_RULE_DEFAULTS: Readonly<FillRules> = {
  clearance_nm: 200_000,
  net_clearance_nm: new Map<string, number>(),
  thermal_gap_nm: 250_000,
  thermal_bridge_nm: 400_000,
  min_width_nm: null,
};

/** A filled zone: one net's copper on one layer. */
export interface FillOutput {
  net: string;
  layer: string;
  /** A disjoint cover of convex pieces, never a holed contour (ADR-0117 2026-10-26b). */
  region: Region;
  area_nm2: number;
}

/** Everything a board fill needs, and nothing the kernel would have to re-derive. */
export interface FillFacts {
  /** Path of the pcb description, for locating diagnostics. */
  file: string;
  /** Board outline, closed; the pour is clipped to it. */
  outline: Polygon;
  /** Board cutouts (`physical_only` type `cutout`): holes in the board, so no copper crosses them. */
  cutouts: readonly Polygon[];
  zones: readonly FillZoneInput[];
  obstacles: readonly FillObstacle[];
  keepouts: readonly FillKeepout[];
  rules: FillRules;
  /** Copper layers of the stackup, top to bottom: the only layers a zone may live on. */
  copper_layers: readonly string[];
}

/** A pad's net comes from the schematic: `connect` declares geometry, not nets (spec/pcb.md §5.2). */
export type PinNet = ReadonlyMap<string, string>;

/** Everything needed to build obstacles: the drawing, its footprints, and the pin-to-net map. */
export interface ObstacleFacts {
  pcb: Pcb;
  placed: readonly PlacedFootprint[];
  /** `<instance_id>.<pad_number>` → net id. */
  pin_net: PinNet;
}
