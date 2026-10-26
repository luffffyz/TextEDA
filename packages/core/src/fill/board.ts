// Board-level assembly of what a pour needs, so every caller (export, checks, tests) builds the same
// facts from the same IR. Nothing here reads a file: the drawing and the footprints arrive as IR.
import type { DiagnosticLocation } from "@texteda/ir/diagnostics";
import type { Pcb } from "@texteda/ir/pcb";
import { buildObstacles, copperLayers, cutoutRings, outlineRing } from "./obstacles.ts";
import { rulesFromPcb } from "./rules.ts";
import type { FillFacts, PinNet, PlacedFootprint } from "./types.ts";

/** The zones and keepouts a pour reacts to, in drawing order. */
export function fillBoardFacts(options: {
  file: string;
  pcb: Pcb;
  placed: readonly PlacedFootprint[];
  pin_net: PinNet;
  /** Where a `zone` or `keepout` row was written, so a pour's diagnostics point at it (ADR-0020). */
  locate?: (irPath: string) => DiagnosticLocation | undefined;
}): FillFacts {
  const { pcb } = options;
  return {
    file: options.file,
    outline: outlineRing(pcb),
    cutouts: cutoutRings(pcb),
    zones: (pcb.zone ?? []).map((zone, index) => ({
      net: zone.net,
      layer: zone.layer,
      shape: zone.points.map((point) => ({ x_nm: point.x_nm, y_nm: point.y_nm })),
      line: options.locate?.(`/zone/${index}`)?.line ?? 1,
    })),
    // Only `no_pour` forbids copper; `no_track` / `no_place` / `no_via` are about other things.
    keepouts: (pcb.keepout ?? [])
      .filter((keepout) => keepout.type === "no_pour")
      .map((keepout) => ({
        layer: keepout.layer,
        shape: keepout.points.map((point) => ({ x_nm: point.x_nm, y_nm: point.y_nm })),
      })),
    obstacles: buildObstacles({ pcb, placed: options.placed, pin_net: options.pin_net }),
    rules: rulesFromPcb(pcb),
    copper_layers: copperLayers(pcb),
  };
}
