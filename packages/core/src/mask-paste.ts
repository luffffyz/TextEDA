// Solder mask and solder paste: the two layers that say where the copper is exposed and where the
// stencil puts paste (backlog F15).
//
// They are **not** pour rules: a pour reads `clearance` / `thermal` / `min_width` and nothing else
// (`fill/rules.ts`), while these two describe openings in a covering layer. Keeping them apart is what
// keeps `FillRules` from growing fields no pour reads.
//
// Both are openings, and both are expressed the same way: take the pad's own outline, then
//   - mask: grow it by the expansion (the pad's `mask=` if it has one, else `rules.mask`); a pad-level
//     value may be negative and close the opening, while the board rule is a grow-only default;
//   - paste: scale it about the pad's centre by `sqrt(ratio)`, then grow (or shrink) every edge by the
//     offset (the pad's `paste=` if it has one, else `rules.paste`).
//
// The defaults are written down here and in `spec/pcb.md` §4.9, because they decide what a delivered
// file looks like when the description says nothing: an undeclared mask expansion is 0 (the opening
// *is* the pad — there is no smaller opening that still exposes it), and an undeclared paste rule is
// ratio 1 with offset 0 (the aperture *is* the pad). Neither is a guess about a board house's
// preference; both are the identity, and the identity is the only thing a description can mean when
// it declares nothing.
import { dilate, erode, normalize, type Polygon, type Region } from "@texteda/geom";
import type { Pad } from "@texteda/ir/footprint";
import type { Pcb } from "@texteda/ir/pcb";

/** What an absent `mask` rule means: no expansion, the opening is the pad itself. */
export const MASK_RULE_DEFAULTS = { expansion_nm: 0 } as const;

/** What an absent `paste` rule means: no scale, no offset, the aperture is the pad itself. */
export const PASTE_RULE_DEFAULTS = { ratio_ppm: 1_000_000, offset_nm: 0 } as const;

export interface MaskRule {
  readonly expansion_nm: number;
}

export interface PasteRule {
  /** The aperture area as a share of the pad's area, in parts per million. */
  readonly ratio_ppm: number;
  /** Edge offset applied after the ratio: positive grows the aperture, negative shrinks it. */
  readonly offset_nm: number;
}

/** The board's `mask` rule, or the documented default. */
export function maskRule(pcb: Pcb): MaskRule {
  for (const rule of pcb.rules) if (rule.type === "mask") return { expansion_nm: rule.expansion_nm };
  return MASK_RULE_DEFAULTS;
}

/** The board's `paste` rule, or the documented default. */
export function pasteRule(pcb: Pcb): PasteRule {
  for (const rule of pcb.rules) if (rule.type === "paste") return { ratio_ppm: rule.ratio_ppm, offset_nm: rule.offset_nm };
  return PASTE_RULE_DEFAULTS;
}

/** The mask expansion of one pad: its own `mask=` when declared, else the board's rule. */
export function maskExpansionOf(pad: Pad, rule: MaskRule): number {
  return pad.solder_mask_margin_nm ?? rule.expansion_nm;
}

/** The paste geometry of one pad: its own `paste=` replaces the board rule's offset, the ratio is the board's. */
export function pasteGeometryOf(pad: Pad, rule: PasteRule): { ratio_ppm: number; offset_nm: number } {
  return {
    ratio_ppm: rule.ratio_ppm,
    offset_nm: pad.solder_paste_margin_nm ?? rule.offset_nm,
  };
}

/**
 * A pad's opening on a covering layer: the pad's board-space ring grown by `expansion`.
 *
 * A negative expansion shrinks the opening, which is legal for both layers (a mask opening slightly
 * smaller than the pad is how a designer closes a solder-bridging gap, and a paste aperture is
 * normally smaller than the pad). Shrinking past nothing yields an empty region, and the caller emits
 * no item for it: an opening with no area cannot be drawn.
 */
export function openingOf(ring: Polygon, expansion_nm: number): Region {
  if (expansion_nm === 0) return [ring];
  return expansion_nm > 0 ? dilate([ring], expansion_nm) : erode([ring], -expansion_nm);
}

/**
 * The paste aperture of a pad: the ring scaled about its centre by `sqrt(ratio_ppm/1e6)`, then grown
 * by `offset_nm`.
 *
 * The scale factor is the square root because `ratio` is an **area** ratio: a 90 % stencil aperture is
 * 90 % of the pad's area, which is 94.87 % of its linear size. Scaling the polygon rather than the
 * declared size keeps a rotated or rounded pad's shape: straight edges stay straight and a corner
 * radius scales with the rest.
 */
export function pasteApertureOf(ring: Polygon, center: { x_nm: number; y_nm: number }, geometry: PasteRule): Region {
  const linear = Math.sqrt(geometry.ratio_ppm / 1_000_000);
  let aperture: Polygon;
  if (linear === 1) {
    aperture = ring;
  } else {
    try {
      aperture = normalize(
        ring.map((point) => ({
          x_nm: round(center.x_nm + (point.x_nm - center.x_nm) * linear),
          y_nm: round(center.y_nm + (point.y_nm - center.y_nm) * linear),
        })),
      );
    } catch {
      // The aperture has no area left (a zero ratio, or a pad too small to survive the nanometre grid):
      // nothing to draw. A stencil opening that vanished is not a shape the file can carry.
      return [];
    }
  }
  if (geometry.offset_nm === 0) return [aperture];
  return geometry.offset_nm > 0 ? dilate([aperture], geometry.offset_nm) : erode([aperture], -geometry.offset_nm);
}

/** A round pad's mask opening diameter, or `null` when the opening collapsed. */
export function maskOpeningDiameter(diameter_nm: number, expansion_nm: number): number | null {
  const value = diameter_nm + 2 * expansion_nm;
  return value > 0 ? value : null;
}

/** A round pad's paste opening diameter, or `null` when the aperture collapsed. */
export function pasteOpeningDiameter(diameter_nm: number, geometry: PasteRule): number | null {
  const linear = Math.sqrt(geometry.ratio_ppm / 1_000_000);
  const value = Math.round(diameter_nm * linear) + 2 * geometry.offset_nm;
  return value > 0 ? value : null;
}

function round(value: number): number {
  const rounded = Math.round(value);
  return rounded === 0 ? 0 : rounded;
}
