# ADR-0054: Vertical Pin-Name Labels Always Rotate Toward Their Pins

Status: Accepted
Date: 2026-11-01
Scope: Decides: the reference renderer's orientation and placement of visible-body vertical pin-name labels. Does not decide: source-level text placement or rotation fields, pin-name body clearance, pin-number placement, or downstream export geometry.
Related: [ADR-0036](0036-our-own-reference-renderer.md), [ADR-0053](0053-pin-name-body-clearance-is-measured-from-symbol-body-bounds.md)
Impact: `packages/renderer/src/symbol.ts`; `packages/renderer/test/symbol-placement.test.ts`; `packages/renderer/test/font.test.ts`; `docs/skills/library-authoring.md`

## Context

Vertical pin names inside a visible symbol body should sit on their pin's side of the body and read in one fixed direction. Keeping these names horizontal requires collision checks and leaves the same label inconsistently oriented depending on nearby pins. The `.teda` symbol format has no per-pin text-position or rotation field, so orientation remains a reference-renderer convention.

The frame-facing painted edge must still keep the exact `400_000 nm` clearance from the inner painted body edge defined in [ADR-0053](0053-pin-name-body-clearance-is-measured-from-symbol-body-bounds.md). Rotation changes the ink bounds, so placement must use the rotated Hershey paths, including half their rendered stroke width.

## Decision

1. Every visible-body vertical pin-name label is rotated exactly `90_000` millidegrees and uses `anchor: "start"`.
2. The label is placed against the inner body edge **on the pin's side** — the bottom inner edge for a `90°` pin, the top inner edge for a `270°` pin. The renderer places the rotated painted edge against that edge, with the exact `400_000 nm` clearance from [ADR-0053](0053-pin-name-body-clearance-is-measured-from-symbol-body-bounds.md).
3. Because the rotation is fixed (decision 1), the reading direction is the same for every vertical pin: the name reads upward on the sheet. A name on a bottom pin therefore starts at its pin and reads inward; a name on a top pin ends at its pin and reads outward. The label is on the pin's side either way, but the two directions are not mirror images of each other.
4. The rotated ink bounds are measured after the same integer-rounded model-space rotation used by SVG serialization, including half the rendered Hershey stroke width. The label remains aligned to the pin's inner x-coordinate.
5. Preserve horizontal pin-name placement, bodyless `pin_name_offset` placement, pin-number placement, source syntax, IR schemas, component facts, and exporter behavior.

## Consequences

All visible-body vertical pin names have consistent orientation without collision detection or overlap-dependent behavior. Each label sits on its pin's side of the body, its painted clearance remains exact, and bodyless symbols retain their existing source-controlled placement.

The one asymmetry is the reading direction (decision 3): a top pin's name reads toward its pin rather than away from it. Rotating a top pin's label the other way would mirror the bottom pin's behaviour, at the cost of a different rendered glyph orientation for every symbol that has a top pin; that trade-off is open, and it is tracked in `docs/backlog.md` rather than settled here.

The renderer may place vertical names differently from downstream exports. Library authors should inspect the reference preview, but need not adjust source facts to imitate this renderer-only orientation.

## Verification

`packages/renderer/test/symbol-placement.test.ts` covers horizontal names, vertical pins in both directions, the fixed `90_000` millidegree rotation, pin-facing placement, and exact `400_000 nm` clearance after rotation. `packages/renderer/test/font.test.ts` measures serialized production paths against the inner body frame and checks vertical-label rotation. The `bq24610rger` production symbol preview is the visual check.
