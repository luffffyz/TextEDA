// Layer vocabulary: which physical layer a pad lands on, and which layers a board has.
//
// Everything here is a projection of layer names the IR already carries — no geometry, no nets. The
// copper-only view (`copperLayers`, `padLayers`) lives with the fill because a pour reads copper; the
// non-copper families (mask, paste, silk) belong to the manufacturing image, and both read
// `mirrorLayer` from here so the bottom-side transform is written down once (spec/footprint.md §4).
import type { Pad } from "@texteda/ir/footprint";
import type { Pcb } from "@texteda/ir/pcb";

export type BoardSide = "top" | "bottom";

/** A per-side layer family: the three surfaces a board has on each side besides copper. */
export type SideLayerFamily = "Mask" | "Paste" | "SilkS";

/**
 * A part on the bottom has its layers mirrored: `F.Cu` ↔ `B.Cu`, and the same for `Mask`, `Paste` and
 * `SilkS` (spec/footprint.md §4).
 *
 * Only the outer copper and the per-side non-copper layers exist, so this is a name swap and not a
 * lookup in the stackup: an inner layer (`In1.Cu`) names a surface a part cannot reach.
 */
export function mirrorLayer(layer: string): string {
  if (layer.startsWith("F.")) return `B.${layer.slice(2)}`;
  if (layer.startsWith("B.")) return `F.${layer.slice(2)}`;
  return layer;
}

/** One outline side of the board, as the layer names spell it. */
export interface BoardSideLayers {
  side: BoardSide;
  prefix: "F" | "B";
}

/**
 * The board's outline sides, from the stackup: the top side when `F.Cu` exists, the bottom side when
 * `B.Cu` does (spec/pcb.md §4.1: the first entry is the top copper, the last is the bottom copper).
 *
 * A single-sided board therefore gets mask, paste and silk files on the top only.
 */
export function boardSides(pcb: Pcb): BoardSideLayers[] {
  const copper = pcb.stackup.filter((layer) => layer.type === "copper").map((layer) => layer.layer);
  const out: BoardSideLayers[] = [];
  if (copper.includes("F.Cu")) out.push({ side: "top", prefix: "F" });
  if (copper.includes("B.Cu")) out.push({ side: "bottom", prefix: "B" });
  return out;
}

/**
 * The layers of one non-copper family a pad covers, in the pad's own order.
 *
 * Two readings are in play, both from the layer semantics of `spec/footprint.md` §4:
 *   - the wildcard `*.Mask` means **every** mask layer — a through-hole barrel is open on both sides,
 *     so such a pad gets an `F.Mask` and a `B.Mask` opening whatever side it is placed on;
 *   - an explicit `F.Mask` / `F.Paste` on a part placed on the bottom lands on the mirrored layer, the
 *     same rule as its copper.
 *
 * `*.Cu` is deliberately absent: copper expansion has to know the stackup, and the fill owns that
 * (`padLayers` in `fill/obstacles.ts`).
 */
export function padSideLayers(pad: Pad, side: BoardSide, family: SideLayerFamily): string[] {
  const out: string[] = [];
  const add = (layer: string): void => {
    if (!out.includes(layer)) out.push(layer);
  };
  for (const layer of pad.layers) {
    if (layer === `*.${family}`) {
      add(`F.${family}`);
      add(`B.${family}`);
    } else if (layer.endsWith(`.${family}`)) {
      add(side === "bottom" ? mirrorLayer(layer) : layer);
    }
  }
  return out;
}

/** The mask openings a pad declares (`F.Mask` / `B.Mask`). */
export function padMaskLayers(pad: Pad, side: BoardSide): string[] {
  return padSideLayers(pad, side, "Mask");
}

/** The stencil openings a pad declares (`F.Paste` / `B.Paste`); a through-hole pad names none. */
export function padPasteLayers(pad: Pad, side: BoardSide): string[] {
  return padSideLayers(pad, side, "Paste");
}

/** True for a silk layer name: the two surfaces a silk drawing can reach. */
export function isSilkLayer(layer: string): boolean {
  return layer === "F.SilkS" || layer === "B.SilkS";
}
