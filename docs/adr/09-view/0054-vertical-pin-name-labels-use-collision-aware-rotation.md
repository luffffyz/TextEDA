# ADR-0054: Vertical Pin-Name Labels Always Rotate Toward Their Pins

Status: Accepted
Date: 2026-11-01
Scope: Decides: the reference renderer's orientation and placement of visible-body vertical pin-name labels. Does not decide: source-level text placement or rotation fields, pin-name body clearance, pin-number placement, or downstream export geometry.
Related: [ADR-0036](0036-our-own-reference-renderer.md), [ADR-0053](0053-pin-name-body-clearance-is-measured-from-symbol-body-bounds.md)
Impact: `packages/renderer/src/symbol.ts`; `packages/renderer/test/symbol-placement.test.ts`; `packages/renderer/test/font.test.ts`; `docs/skills/library-authoring.md`

## Context

Vertical pin names inside a visible symbol body should follow the pin's direction into the body. Keeping these names horizontal requires collision checks and leaves the same label inconsistently oriented depending on nearby pins. The `.teda` symbol format has no per-pin text-position or rotation field, so orientation remains a reference-renderer convention.

The frame-facing painted edge must still keep the exact `400_000 nm` clearance from the inner painted body edge defined in [ADR-0053](0053-pin-name-body-clearance-is-measured-from-symbol-body-bounds.md). Rotation changes the ink bounds, so placement must use the rotated Hershey paths, including half their rendered stroke width.

## Decision

1. Every visible-body vertical pin-name label is rotated exactly `90_000` millidegrees and uses `anchor: "start"`.
2. The text starts on the pin-facing side of the body and proceeds inward. The renderer places the rotated painted edge against the corresponding inner body edge, with the exact `400_000 nm` clearance from [ADR-0053](0053-pin-name-body-clearance-is-measured-from-symbol-body-bounds.md).
3. The rotated ink bounds are measured after the same integer-rounded model-space rotation used by SVG serialization, including half the rendered Hershey stroke width. The label remains aligned to the pin's inner x-coordinate.
4. Preserve horizontal pin-name placement, bodyless `pin_name_offset` placement, pin-number placement, source syntax, IR schemas, component facts, and exporter behavior.

## Consequences

All visible-body vertical pin names have consistent orientation without collision detection or overlap-dependent behavior. Text starts at the pin-facing side, its painted clearance remains exact, and bodyless symbols retain their existing source-controlled placement.

The renderer may place vertical names differently from downstream exports. Library authors should inspect the reference preview, but need not adjust source facts to imitate this renderer-only orientation.

## Verification

`packages/renderer/test/symbol-placement.test.ts` covers horizontal names, vertical pins in both directions, the fixed `90_000` millidegree rotation, pin-facing placement, and exact `400_000 nm` clearance after rotation. `packages/renderer/test/font.test.ts` measures serialized production paths against the inner body frame and checks vertical-label rotation. The `bq24610rger` production symbol preview is the visual check.
