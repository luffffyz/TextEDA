# ADR-0050: Pin-Number Placement Is a Renderer Convention

Status: Accepted
Date: 2026-11-01
Scope: Decides: how the reference symbol renderer places visible pin-number labels. Does not decide: pin-name placement, which is covered by [ADR-0053](0053-pin-name-body-clearance-is-measured-from-symbol-body-bounds.md), or symbol-file capabilities, which remain covered by [ADR-0031](../08-libraries/0031-symbol-format.md), body-frame clearance, which is covered by [ADR-0052](0052-pin-number-body-clearance-is-measured-from-symbol-body-bounds.md), or downstream export geometry, which remains covered by [ADR-0021](../06-manufacturing/0021-the-manufacturing-output-path.md).
Related: [ADR-0036](0036-our-own-reference-renderer.md), [ADR-0051](0051-pin-number-clearance-is-measured-from-painted-ink.md), [ADR-0052](0052-pin-number-body-clearance-is-measured-from-symbol-body-bounds.md), [ADR-0053](0053-pin-name-body-clearance-is-measured-from-symbol-body-bounds.md), [ADR-0058](../08-libraries/0058-pin-rows-on-a-number-bearing-symbol-are-at-least-two-and-a-half-millimetres-apart.md)
Impact: `packages/renderer/src/symbol.ts`; `packages/renderer/test/symbol-placement.test.ts`; `docs/skills/library-authoring.md`

## Context

The `.teda` symbol contract stores a pin connection point, direction, length, and style, but it has no independent pin-number position or rotation field. The reference renderer therefore needs one deterministic placement rule. The rule uses two independent clearances: one from the pin line and one from the visible symbol-body frame when one exists. A bodyless symbol uses an inner-end fallback. This is a renderer rule, not a change to symbol facts or the IR.

The pin's body-side end is the connection point plus its direction vector multiplied by `length`; bodyless symbols use that endpoint for the fallback. With visible body geometry, the body-frame edge on the connection-point side determines the axis-directed clearance. The KiCad exporter is a separate output path; its placement must not be inferred from this SVG renderer rule.

The pin-line center offset in the original decision is superseded by [ADR-0051](0051-pin-number-clearance-is-measured-from-painted-ink.md); the body-side direction rules remain in force, while body-frame clearance is defined by [ADR-0052](0052-pin-number-body-clearance-is-measured-from-symbol-body-bounds.md).

## Decision

For every visible pin number, use the following independent placement rules:

- **Pin-line clearance:** follow [ADR-0051](0051-pin-number-clearance-is-measured-from-painted-ink.md); its painted-edge clearance supersedes the original center-based offset.
- **Body-side clearance:** follow [ADR-0052](0052-pin-number-body-clearance-is-measured-from-symbol-body-bounds.md). When no visible body frame exists, place the label center `1_200_000` nm (`1.20 mm`) outside the pin's body-side end, along the pin axis.
- A horizontal pin (`0°` or `180°`) gets the label above the pin line, with its perpendicular clearance set by [ADR-0051](0051-pin-number-clearance-is-measured-from-painted-ink.md).
- A vertical pin (`90°` or `270°`) gets the label to the right of the pin line, with its perpendicular clearance set by [ADR-0051](0051-pin-number-clearance-is-measured-from-painted-ink.md).
- The label uses the `middle` anchor. A horizontal pin's number is not rotated; a vertical pin's
  number is rotated `90_000` millidegrees, so it reads along the pin line.
- The placement is independent of whether the pin points toward or away from the symbol body.

Keep both clearances in the renderer. Do not add unsupported source fields, move pin connection points to compensate, or alter the component facts, IR schema, or exporter for this view-only convention.

## Consequences

The reference preview has stable, direction-independent pin-number placement: horizontal numbers are readable above their lines, vertical numbers are readable to their right, and both painted clearances are explicit. The exact coordinates are covered by a renderer regression test for all four cardinal rotations, including a multi-character label.

The SVG preview and KiCad export are not required to use identical pin-number coordinates. Consumers that need export-specific geometry must inspect the exporter output rather than treating this renderer convention as a source-level fact.

## Verification

`packages/renderer/test/symbol-placement.test.ts` asserts visibility, `middle` anchoring, exact coordinates and painted clearances for rotations `0°`, `180°`, `90°`, and `270°`, plus the bodyless fallback.
