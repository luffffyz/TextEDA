# ADR-0054: Vertical Pin-Name Labels Always Rotate Toward Their Pins

Status: Accepted
Date: 2026-11-01
Scope: Decides: the reference renderer's orientation and placement of vertical pin-name labels — the visible-body ones inside the body, and the bodyless ones beside the pin. Does not decide: source-level text placement or rotation fields, pin-name body clearance, pin-number placement, or downstream export geometry.
Related: [ADR-0036](0036-our-own-reference-renderer.md), [ADR-0053](0053-pin-name-body-clearance-is-measured-from-symbol-body-bounds.md)
Impact: `packages/renderer/src/symbol.ts`; `packages/renderer/test/symbol-placement.test.ts`; `packages/renderer/test/font.test.ts`; `docs/skills/library-authoring.md`

## Context

Vertical pin names inside a visible symbol body should sit on their pin's side of the body and read in one fixed direction. Keeping these names horizontal requires collision checks and leaves the same label inconsistently oriented depending on nearby pins. The `.teda` symbol format has no per-pin text-position or rotation field, so orientation remains a reference-renderer convention.

The frame-facing painted edge must still keep the exact `400_000 nm` clearance from the inner painted body edge defined in [ADR-0053](0053-pin-name-body-clearance-is-measured-from-symbol-body-bounds.md). Rotation changes the ink bounds, so placement must use the rotated Hershey paths, including half their rendered stroke width.

## Decision

1. Every vertical pin-name label is rotated exactly `90_000` millidegrees and uses `anchor: "start"` — the visible-body ones and the bodyless ones alike. A pin's name and its pin number must never disagree about which way the pin runs; the number has always followed the pin ([ADR-0050](0050-pin-number-placement-is-a-renderer-convention.md)), and the name follows it now.
2. The visible-body label is placed against the inner body edge **on the pin's side** — the bottom inner edge for a `90°` pin, the top inner edge for a `270°` pin. The renderer places the rotated painted edge against that edge, with the exact `400_000 nm` clearance from [ADR-0053](0053-pin-name-body-clearance-is-measured-from-symbol-body-bounds.md).
3. A bodyless symbol keeps the source's `pin_name_offset` placement ([ADR-0053](0053-pin-name-body-clearance-is-measured-from-symbol-body-bounds.md)) and gains the same rotation. The turned name's ink straddles its baseline, and the baseline would sit on the pin line the name runs along, so the baseline steps aside: the ink keeps a `100_000 nm` (`0.10 mm`) gap from the pin line. A bodyful symbol needs no such step — there the name runs inside the body and the pin line ends at the body's edge.
4. Because the rotation is fixed (decision 1), the reading direction is the same for every vertical pin: the name reads upward on the sheet. A name on a bottom pin therefore starts at its pin and reads inward; a name on a top pin ends at its pin and reads outward. The label is on the pin's side either way, but the two directions are not mirror images of each other.
5. The rotated ink bounds are measured after the same integer-rounded model-space rotation used by SVG serialization, including half the rendered Hershey stroke width. The label remains aligned to the pin's inner x-coordinate.
6. Preserve horizontal pin-name placement, pin-number placement, source syntax, IR schemas, component facts, and exporter behavior.

## Consequences

All vertical pin names have consistent orientation without collision detection or overlap-dependent behavior. Each visible-body label sits on its pin's side of the body with its painted clearance exact; each bodyless label runs along its pin, clear of the pin line, and keeps its source-controlled position.

The rule is one rule, not two: a pin's name and its number turn together. The alternative — a bodyless symbol's name staying horizontal while its number turns — left the same symbol reading two ways at once, and it is the only place where the two could disagree.

**A pin is one unit on the sheet.** Its line, its number and its name turn together with the symbol, and the number and the name always read along the line: a symbol placed at `90°` lies all three down, and a symbol placed at `180°` or `270°` turns all three upside down. The schematic layer has no rule against that, while the PCB layer already has one for its own text — "text is never printed upside down" (`spec/pcb.md` §4.11, [ADR-0018](../05-pcb/0018-copper-fill-uses-a-geometry-kernel.md) D10). The two layers do not agree on this yet, and the question is open (`docs/backlog.md` F73).

The one asymmetry is the reading direction (decision 3): a top pin's name reads toward its pin rather than away from it. Rotating a top pin's label the other way would mirror the bottom pin's behaviour, at the cost of a different rendered glyph orientation for every symbol that has a top pin; that trade-off is open, and it is tracked in `docs/backlog.md` (F72) rather than settled here.

The renderer may place vertical names differently from downstream exports. Library authors should inspect the reference preview, but need not adjust source facts to imitate this renderer-only orientation.

## Verification

`packages/renderer/test/symbol-placement.test.ts` covers horizontal names, vertical pins in both directions, the fixed `90_000` millidegree rotation, pin-facing placement, exact `400_000 nm` clearance after rotation, and the bodyless case: the name turns with the pin number and keeps its gap from the pin line. `packages/renderer/test/font.test.ts` measures serialized production paths against the inner body frame and checks vertical-label rotation. The `bq24610rger` production symbol preview is the visual check.
