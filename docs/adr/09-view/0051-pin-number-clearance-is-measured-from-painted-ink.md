# ADR-0051: Pin-Number Clearance Is Measured from Painted Ink

Status: Accepted
Date: 2026-11-01
Scope: Decides: how the reference renderer measures pin-number clearance perpendicular to the pin line. Does not decide: placement direction or body-side clearance, which are covered by [ADR-0050](0050-pin-number-placement-is-a-renderer-convention.md) and [ADR-0052](0052-pin-number-body-clearance-is-measured-from-symbol-body-bounds.md), or symbol source and export contracts, which remain covered by [ADR-0031](../08-libraries/0031-symbol-format.md) and [ADR-0021](../06-manufacturing/0021-the-manufacturing-output-path.md).
Related: [ADR-0036](0036-our-own-reference-renderer.md), [ADR-0050](0050-pin-number-placement-is-a-renderer-convention.md), [ADR-0052](0052-pin-number-body-clearance-is-measured-from-symbol-body-bounds.md), [ADR-0058](../08-libraries/0058-pin-rows-on-a-number-bearing-symbol-are-at-least-two-and-a-half-millimetres-apart.md)
Impact: `packages/renderer/src/symbol.ts`; `packages/renderer/test/symbol-placement.test.ts`; `docs/skills/library-authoring.md`

## Context

A fixed distance from a text anchor does not produce a fixed visible gap: the anchor is centered, while each number's Hershey strokes have their own bounds. Measuring the old perpendicular offset from the anchor therefore made vertical and horizontal pin-number labels appear unevenly spaced from their pin lines.

## Decision

Set the clearance from the pin line to the nearest painted edge of every visible pin-number label to exactly `500_000` nm (`0.50 mm`):

- For horizontal pins, measure from the label's bottommost painted edge to the pin line; place the label above the line.
- For vertical pins, measure from the label's leftmost painted edge to the pin line; place the label to the right.
- Measure painted bounds from the actual Hershey stroke paths, expanded by half the rendered stroke width. Calculate the label anchor from that bound for each number string.
- Keep the `middle` anchor. A horizontal pin's number is not rotated; a vertical pin's number is rotated `90_000` millidegrees, so it reads along the pin line. Body-side placement follows [ADR-0050](0050-pin-number-placement-is-a-renderer-convention.md) and [ADR-0052](0052-pin-number-body-clearance-is-measured-from-symbol-body-bounds.md).
- Apply the same rule to pin directions `0°`, `180°`, `90°`, and `270°`; do not add source fields or change component facts, the IR schema, or exporter behavior.

## Consequences

The visible ink-to-line gap is consistent across pin orientations and number strings, while body-side placement follows [ADR-0050](0050-pin-number-placement-is-a-renderer-convention.md) and [ADR-0052](0052-pin-number-body-clearance-is-measured-from-symbol-body-bounds.md). Pin-number coordinates remain a reference-renderer convention, not a source fact or an exporter requirement.

## Verification

`packages/renderer/test/symbol-placement.test.ts` asserts exact label anchors for all four cardinal rotations and measures the painted-edge clearance from rendered Hershey strokes, including a multi-character number. The `bq24610rger` symbol preview is the visual check for the production library asset.
