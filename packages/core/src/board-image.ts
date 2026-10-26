// Assembly: the pcb IR, the footprints it places, and a board fill, turned into the board image that
// the Gerber and Excellon writers serialize (ADR-0054 D4).
//
// Every geometric decision is made here or below (the fill policy, the silk policy, the kernel); a
// writer only lays digits out. Three consequences worth stating:
//   - a pad is filed as its **real outline**, so a rectangle stays a rectangle; only a round pad and a
//     via become a flash, because a flash *is* a disc;
//   - a trace draws with its width, the board edge draws as a hairline, a pour is a region. The image
//     is a projection, not a re-derivation: what the pour computed is what the file contains;
//   - the mask and paste layers are **openings**, not copper: a mask image says where the covering is
//     absent, so each item is the pad's outline grown (or shrunk) by the declared expansion, and a
//     stencil aperture is the pad's outline scaled by the declared area ratio.
//
// Determinism: layers follow the stackup, then the per-side non-copper layers (mask, paste, silk for
// the top side, then the same for the bottom), and `Edge.Cuts` last; within a layer items keep the
// order this module produced. The writers sort, so no map iteration order leaks into a file.
import type { Pcb } from "@texteda/ir/pcb";
import type { BoardImage, DrillHit, ImageItem, ImageLayer } from "./image.ts";
import { copperLayers, outlineRing, padLayers, padOutline, toBoard, toBoardPoint, viaLayers } from "./fill/obstacles.ts";
import type { FillOutput, PlacedFootprint } from "./fill/types.ts";
import { boardSides, padMaskLayers, padPasteLayers } from "./layers.ts";
import {
  maskExpansionOf,
  maskOpeningDiameter,
  maskRule,
  openingOf,
  pasteApertureOf,
  pasteGeometryOf,
  pasteOpeningDiameter,
  pasteRule,
} from "./mask-paste.ts";
import { silkItemsOf, silkRules, silkTexts } from "./silk.ts";

/**
 * The hairline a board outline draws with, in nanometres.
 *
 * `Edge.Cuts` in Gerber is a line layer, and the router follows the *centre* of the line, so its
 * width is a drawing convention rather than copper: 0.1 mm is the width every board house expects.
 */
export const EDGE_WIDTH_NM = 100_000;

export interface BoardImageFacts {
  pcb: Pcb;
  /** Placed footprints by instance id; an instance without one contributes no pads. */
  placed: readonly PlacedFootprint[];
  /** The pour the fill policy produced. Empty is legal: a board may have no zones. */
  fill: readonly FillOutput[];
  /**
   * The printed value of each instance, by instance id (`10k`, `100nF`, an MPN).
   *
   * A value is not a fact of the land pattern, so the assembly cannot derive it: a generic device
   * cannot hold one and a part's value is its MPN (ADR-0027). The caller that knows the schematic
   * supplies it; an instance without one prints no value.
   */
  values?: ReadonlyMap<string, string>;
}

/**
 * The board image: one layer per copper layer, the per-side mask / paste / silk layers, and
 * `Edge.Cuts`, plus the drilled holes.
 *
 * Nets are already resolved: a pour arrives from the fill policy, a trace names its own layer, and a
 * pad's layers come from the footprint plus the placement's side. Nothing here reads a net.
 */
export function boardImage(facts: BoardImageFacts): BoardImage {
  const { pcb } = facts;
  const byLayer = new Map<string, ImageItem[]>();
  const add = (layer: string, item: ImageItem): void => {
    const list = byLayer.get(layer);
    if (list === undefined) byLayer.set(layer, [item]);
    else list.push(item);
  };
  const drills: DrillHit[] = [];
  const mask = maskRule(pcb);
  const paste = pasteRule(pcb);
  const rules = silkRules(pcb);
  const texts = silkTexts(facts.placed, pcb, rules, facts.values);

  for (const placed of facts.placed) {
    const place = pcb.place.find((entry) => entry.instance_id === placed.instance_id);
    if (place === undefined) continue;
    for (const pad of placed.footprint.footprint.pads) {
      if (pad.size.x_nm <= 0 || pad.size.y_nm <= 0) continue;
      const ring = toBoard(padOutline(pad), place);
      const center = toBoardPoint({ x_nm: pad.at.x_nm, y_nm: pad.at.y_nm }, place);
      // A round pad is the one shape whose opening a flash states exactly; everything else is a ring.
      const round = pad.shape === "circle" && pad.size.x_nm === pad.size.y_nm;
      for (const layer of padLayers(pad, pcb, place.side)) {
        add(layer, round ? { kind: "flash", diameter_nm: pad.size.x_nm, at: center } : { kind: "region", shape: ring });
      }

      // Solder mask: an opening per masked layer, grown (or shrunk) by the declared expansion.
      const expansion = maskExpansionOf(pad, mask);
      for (const layer of padMaskLayers(pad, place.side)) {
        if (round) {
          const diameter = maskOpeningDiameter(pad.size.x_nm, expansion);
          if (diameter !== null) add(layer, { kind: "flash", diameter_nm: diameter, at: center });
          continue;
        }
        for (const piece of openingOf(ring, expansion)) add(layer, { kind: "region", shape: piece });
      }

      // Solder paste: a stencil aperture per paste layer — SMD pads only, because a through-hole pad's
      // layers name no paste (`th` is `*.Cu` + `*.Mask`, spec/footprint.md §4).
      const geometry = pasteGeometryOf(pad, paste);
      for (const layer of padPasteLayers(pad, place.side)) {
        if (round) {
          const diameter = pasteOpeningDiameter(pad.size.x_nm, geometry);
          if (diameter !== null) add(layer, { kind: "flash", diameter_nm: diameter, at: center });
          continue;
        }
        for (const piece of pasteApertureOf(ring, center, geometry)) add(layer, { kind: "region", shape: piece });
      }

      // A through-hole pad's drill is a plated hole; its annular ring is the copper above.
      if (pad.type === "th" && pad.drill !== undefined) {
        const diameter = Math.min(pad.drill.x_nm, pad.drill.y_nm);
        if (diameter > 0) {
          const at = toBoardPoint({ x_nm: pad.at.x_nm, y_nm: pad.at.y_nm }, place);
          drills.push({ x_nm: at.x_nm, y_nm: at.y_nm, diameter_nm: diameter, plated: true });
        }
      }
    }

    // The footprint's own silk drawing plus the texts the board prints.
    for (const { layer, item } of silkItemsOf(placed, place, texts)) add(layer, item);
  }

  for (const trace of pcb.trace ?? []) {
    if (trace.width_nm <= 0) continue;
    add(trace.layer, {
      kind: "draw",
      width_nm: trace.width_nm,
      points: trace.points.map((point) => ({ x_nm: point.x_nm, y_nm: point.y_nm })),
    });
  }

  for (const via of pcb.via ?? []) {
    if (via.size_nm > 0) {
      for (const layer of viaLayers(pcb, via)) {
        add(layer, { kind: "flash", diameter_nm: via.size_nm, at: { x_nm: via.x_nm, y_nm: via.y_nm } });
      }
    }
    if (via.drill_nm > 0) drills.push({ x_nm: via.x_nm, y_nm: via.y_nm, diameter_nm: via.drill_nm, plated: true });
  }

  for (const zone of facts.fill) {
    for (const ring of zone.region) add(zone.layer, { kind: "region", shape: ring });
  }

  // `physical_only` copper that is not a pad: a fiducial dot and a stitching via.
  //
  // A `mounting` hole emits no copper at all: it is a non-plated hole, so `size_nm` is the room the
  // fastener needs, not an annulus to plate (spec/pcb.md §4.11 calls it a hole, and the pour keeps
  // every net clear of that much room). A `cutout` is board, not copper.
  for (const item of pcb.physical_only ?? []) {
    if (item.type === "mounting") {
      if (item.drill_nm > 0) drills.push({ x_nm: item.x_nm, y_nm: item.y_nm, diameter_nm: item.drill_nm, plated: false });
    } else if (item.type === "stitching") {
      if (item.size_nm > 0) {
        for (const layer of copperLayers(pcb)) {
          add(layer, { kind: "flash", diameter_nm: item.size_nm, at: { x_nm: item.x_nm, y_nm: item.y_nm } });
        }
      }
      if (item.drill_nm > 0) drills.push({ x_nm: item.x_nm, y_nm: item.y_nm, diameter_nm: item.drill_nm, plated: true });
    } else if (item.type === "fiducial" && item.size_nm > 0 && item.layer.endsWith(".Cu")) {
      add(item.layer, { kind: "flash", diameter_nm: item.size_nm, at: { x_nm: item.x_nm, y_nm: item.y_nm } });
    }
  }

  const outline = outlineRing(pcb);
  if (outline.length > 2) add("Edge.Cuts", { kind: "draw", width_nm: EDGE_WIDTH_NM, points: outline });

  return { board: pcb.board, layers: layerOrder(pcb, byLayer), drills };
}

/**
 * The output layers in a fixed order: copper from the stackup, then each side's mask, paste and silk
 * (top side first), then `Edge.Cuts`.
 *
 * The non-copper layers exist even when they are empty — a board house reads a missing file as "this
 * layer is not defined", while an empty one reads as "nothing on this layer"
 * (`spec/pcb.md` §8.2).
 */
function layerOrder(pcb: Pcb, byLayer: Map<string, ImageItem[]>): ImageLayer[] {
  const layers: ImageLayer[] = copperLayers(pcb).map((layer) => ({ layer, items: byLayer.get(layer) ?? [] }));
  for (const { prefix } of boardSides(pcb)) {
    for (const family of ["Mask", "Paste", "SilkS"]) {
      const name = `${prefix}.${family}`;
      layers.push({ layer: name, items: byLayer.get(name) ?? [] });
    }
  }
  layers.push({ layer: "Edge.Cuts", items: byLayer.get("Edge.Cuts") ?? [] });
  return layers;
}
