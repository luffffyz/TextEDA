# ADR-0053: Pin-Name Body Clearance Is Measured from Symbol-Body Bounds

Status: Accepted
Date: 2026-11-01
Scope: Decides: how the reference symbol renderer places visible pin-name labels inside a visible symbol-body frame. Does not decide: pin-name ownership and source-format capabilities, which remain covered by [ADR-0031](../08-libraries/0031-symbol-format.md), pin-number placement, which is covered by [ADR-0050](0050-pin-number-placement-is-a-renderer-convention.md), or downstream export geometry, which remains covered by [ADR-0021](../06-manufacturing/0021-the-manufacturing-output-path.md).
Related: [ADR-0036](0036-our-own-reference-renderer.md), [ADR-0050](0050-pin-number-placement-is-a-renderer-convention.md), [ADR-0052](0052-pin-number-body-clearance-is-measured-from-symbol-body-bounds.md), [ADR-0054](0054-vertical-pin-name-labels-always-rotate-toward-their-pins.md)
Impact: `packages/renderer/src/symbol.ts`; `packages/renderer/test/symbol-placement.test.ts`; `docs/skills/library-authoring.md`

## Context

The symbol source stores `pin_name_offset` relative to the pin's body-side endpoint, and the KiCad exporter retains that meaning. The reference renderer previously used the same endpoint offset. That does not produce a stable visible gap to the body: pin lengths and body dimensions vary independently, so the same source offset can put a pin name too close to or inside the body outline.

Pin names are component facts joined into the symbol at render time, but their placement in the reference SVG is a renderer convention. The renderer already measures pin-number clearance from painted Hershey ink and the visible body's outer painted frame. Pin names need the same geometric treatment, with a larger requested clearance because they are drawn inside the body.

## Decision

For every visible pin-name label:

- When the symbol has visible body geometry, use the visible body frame defined by [ADR-0052](0052-pin-number-body-clearance-is-measured-from-symbol-body-bounds.md): derive its axis-aligned outer and inner painted bounds from the body geometry, including filled extents, outline half-width, the actual circular arc sweep, and integer rounding. The outer bounds remain the frame for labels outside the body; pin names use the corresponding inner edge because they are drawn inside the body. The frame is renderer-derived and is not serialized.
- Set the distance from the frame-facing painted edge of the label to the corresponding inner painted body edge to exactly `400_000` nm (`0.40 mm`). Compute the label bounds from the Hershey stroke paths and expand them by half the rendered text stroke width.
- Keep the label inside the body on the pin-facing side: the nearest edge is the left body edge for `0°`, the right body edge for `180°`, the bottom body edge for `90°`, and the top body edge for `270°`.
- Preserve the existing readable text convention: horizontal names use `start` on the left side and `end` on the right side; visible-body vertical names use `anchor: "start"` and `rotateMdeg: 90_000`, and sit against the inner body edge on the pin's side. The fixed rotation and rotated-bound placement are defined by [ADR-0054](0054-vertical-pin-name-labels-always-rotate-toward-their-pins.md).
- If the symbol has no visible body geometry, retain the existing `pin_name_offset` placement from the pin's body-side endpoint. The default remains `0.508 mm`; without a body frame, no body-edge clearance is claimed. The fallback keeps the **position**; the orientation of a vertical name is [ADR-0054](0054-vertical-pin-name-labels-always-rotate-toward-their-pins.md)'s, and it is the same rotation a visible-body name gets.
- Do not add source fields or change component facts, the IR schema, or exporter behavior. `pin_name_offset` remains the source/export field; the body-frame rule is specific to the reference renderer when a visible frame exists.

## Consequences

Pin-name ink has a fixed visible `0.40 mm` gap from the relevant inner painted edge of a visible symbol-body frame, independent of pin length and body dimensions. Visible-body vertical names use the fixed renderer orientation from [ADR-0054](0054-vertical-pin-name-labels-always-rotate-toward-their-pins.md) and retain exact inner-frame clearance after their rotated bounds are measured. Bodyless symbols retain their existing source-controlled placement. The rule does not solve collisions between names and unrelated text; symbol geometry and spacing remain responsible for those cases.

The reference SVG may place pin names differently from KiCad's exported symbol because the renderer and exporter are separate output paths. The source format and downstream export remain unchanged.

## Verification

`packages/renderer/test/symbol-placement.test.ts` asserts exact painted body-frame clearances for pin directions `0°`, `180°`, `90°`, and `270°`, including single- and multi-character names, varied pin lengths, integer-compatible coordinates, the bodyless `pin_name_offset` fallback, and the fixed vertical `90_000` millidegree rotation policy. The `bq24610rger` production symbol preview is the visual check.
