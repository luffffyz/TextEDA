# ADR-0052: Pin-Number Body Clearance Is Measured from the Symbol Body Bounds

Status: Accepted
Date: 2026-11-01
Scope: Decides: how the reference symbol renderer clears pin-number ink from the symbol body frame. Does not decide: pin-line clearance, which is covered by [ADR-0051](0051-pin-number-clearance-is-measured-from-painted-ink.md), or pin-number direction, anchor, source, and export contracts, which remain covered by [ADR-0050](0050-pin-number-placement-is-a-renderer-convention.md), [ADR-0031](../08-libraries/0031-symbol-format.md), and [ADR-0021](../06-manufacturing/0021-the-manufacturing-output-path.md).
Related: [ADR-0036](0036-our-own-reference-renderer.md), [ADR-0050](0050-pin-number-placement-is-a-renderer-convention.md), [ADR-0051](0051-pin-number-clearance-is-measured-from-painted-ink.md), [ADR-0053](0053-pin-name-body-clearance-is-measured-from-symbol-body-bounds.md)
Impact: `packages/renderer/src/symbol.ts`; `packages/renderer/test/symbol-placement.test.ts`; `docs/skills/library-authoring.md`

## Context

The existing `1.20 mm` anchor offset from a pin's inner end does not guarantee a fixed visible gap to the symbol body: pin length and body dimensions vary independently. Pin-number placement already measures its pin-line clearance from the painted glyph edge; body-side clearance needs the same edge-based treatment against a stable body frame.

## Decision

For each visible pin-number label:

- When the symbol has visible body geometry, define its body frame as the axis-aligned outer painted bounds of the union of `sym.body` geometry. Include filled geometry and expand stroked geometry by half its declared width; use the actual circular sweep for arcs. Round the frame bounds outward to integer nanometers to preserve the renderer's coordinate contract. This frame is renderer-derived and is not serialized into the symbol source.
- Set the clear distance from the outer body-frame edge to the nearest painted edge of the label to exactly `500_000` nm (`0.50 mm`). Expand the Hershey path bounds by half the rendered text stroke width before positioning the label.
- Place the label outside the body-frame edge on the side of the pin connection point: left for `0°`, right for `180°`, below for `90°`, and above for `270°`. The independent pin-line clearance and its perpendicular placement remain as defined by [ADR-0051](0051-pin-number-clearance-is-measured-from-painted-ink.md).
- If the symbol has no visible body geometry, retain the existing `1_200_000` nm (`1.20 mm`) anchor offset from the pin's body-side end; without a body frame, no body-edge clearance is claimed.
- Keep the `middle` anchor. A horizontal pin's number is not rotated; a vertical pin's number is rotated `90_000` millidegrees. Do not add source fields or change component facts, IR schemas, or exporter behavior.

## Consequences

Pin-number ink now has a fixed visible `0.50 mm` gap to both the pin line and the symbol body's axis-aligned frame when that frame exists. Symbols without visible body geometry retain their previous placement. The policy remains a reference-renderer convention, not a source fact or KiCad export requirement.

## Verification

`packages/renderer/test/symbol-placement.test.ts` asserts exact pin-line and body-frame clearances for all four cardinal rotations and a multi-character label, and covers the no-body fallback. The `bq24610rger` symbol preview is the production visual check.
