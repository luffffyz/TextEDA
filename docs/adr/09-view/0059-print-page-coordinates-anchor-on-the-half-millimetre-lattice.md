# ADR-0059: Print Page Coordinates Anchor on the 0.5 mm Lattice

Status: Accepted
Date: 2026-11-04
Scope: Decides: that every coordinate a print page stores — a symbol placement origin, a field anchor, a wire bend, a label position, a port position, and a note position — is anchored on the `0.5 mm` drawing lattice, and that no free placement is admitted today. Does not decide: the view file's own coordinate resolution (`0.01 mm`, [spec/schematic-view.md](../../../spec/schematic-view.md) §2.1), the symbol file's pin geometry ([ADR-0057](../08-libraries/0057-symbol-pins-sit-on-a-half-millimetre-lattice.md)), footprint pad geometry ([ADR-0030](../08-libraries/0030-footprint-format-and-geometry.md)), and when a genuinely free position would be admitted — see the closed question at the end of this record.
Related: [ADR-0057](../08-libraries/0057-symbol-pins-sit-on-a-half-millimetre-lattice.md), [ADR-0058](../08-libraries/0058-pin-rows-on-a-number-bearing-symbol-are-at-least-two-and-a-half-millimetres-apart.md), [ADR-0035](0035-the-view-layer-is-a-drawing.md), [ADR-0056](0056-the-review-app-has-one-interaction-surface.md), [ADR-0014](../04-schematic/0014-connectivity-has-one-authority.md), [ADR-0061](0061-a-move-carries-only-what-belonged-to-the-net.md), [ADR-0062](0062-a-run-may-end-at-a-port.md), [ADR-0063](0063-a-run-is-shortened-only-along-the-lines-it-was-drawn-on.md), [ADR-0064](0064-automatic-fields-are-placed-for-the-page.md).
Impact: `spec/schematic-view.md` §2.1, §4, §4.1, §5, §6, §7, §8; `docs/skills/draw-print-page.md`; `docs/guides/review-app.md`; `scripts/lib/view-style.ts` (new); `scripts/verify-views.ts` (new); `scripts/view-style.test.ts` (new)

## Context

[ADR-0057](../08-libraries/0057-symbol-pins-sit-on-a-half-millimetre-lattice.md) put a symbol's pin connection points and inner ends on a `0.5 mm` lattice, and made the review app's placement grid the same `0.5 mm`. That record decided the **symbol** side. It explicitly did not decide how a print page is laid out, and nothing after it did either.

The gap was real. A print page's wire bends, label positions, and port positions had no lattice at
all — only the file's `0.01 mm` resolution and the orthogonality rule (`view.wire-diagonal`). A bend
therefore had to be invented to reach a pin, and whether it *could* reach one was a matter of luck:
if a bend landed off the pin's lattice, the wire had to leave the pin diagonally, and
`view.wire-diagonal` reported it. The lattice existed on one side of the connection and not on the
other.

The prose then drifted. [spec/schematic-view.md](../../../spec/schematic-view.md) §2.1 said the
drawing grid is the `0.5 mm` lattice and listed only the pin points, while
[spec/schematic-view.md](../../../spec/schematic-view.md) §4.1 said a field's coordinates "use the
view's `0.01 mm` grid" — which reads as *the grid is `0.01 mm`*, the exact confusion
[ADR-0057](../08-libraries/0057-symbol-pins-sit-on-a-half-millimetre-lattice.md) D4 drew a line
against. Agent-facing copies of these rules (the repo's skills and the operator's own memory) then
disagreed with each other about whether the grid was `0.5 mm`, `0.05 mm`, or `0.01 mm`. A rule
nobody can state once is a rule that will be applied inconsistently.

## Decision

### D1. Every stored coordinate is a lattice point

A print page's coordinates are anchored on the `0.5 mm` lattice in both axes:

| Record | Anchor |
|---|---|
| `place` | the symbol's origin |
| `field` | the field's position, symbol-local |
| `wire` | each bend point (the endpoints are pin references, not free coordinates) |
| `label` | the label's anchor |
| `port` | the port's anchor |
| `text` | the note's anchor |

The rule holds because the two sides of a connection must agree: a wire leaves a **pin**, whose
connection point is a lattice point by [ADR-0057](../08-libraries/0057-symbol-pins-sit-on-a-half-millimetre-lattice.md)
D1, and it turns at a **bend**, which must be able to reach that pin with an axis-aligned segment.
A bend on the lattice can always reach a lattice point; a bend off it cannot, in general. Making
the bend side lattice-only turns "can this wire be drawn?" from a geometric accident into a
constructive property of the page.

### D2. The lattice is a drawing convention, not a new diagnostic

The rule is an authoring convention, checked by the repository's view-style gate and by review —
not by `texteda check`. No diagnostic code is added or retired. The reason is the same as in
[ADR-0057](../08-libraries/0057-symbol-pins-sit-on-a-half-millimetre-lattice.md): a page that
violates the lattice is still a readable page, and the failure it causes (a diagonal segment, a
wire that cannot reach its pin) is already reported by existing codes. A second code for the same
symptom would train an agent to silence codes instead of fixing geometry.

The file's `0.01 mm` **resolution** stays as it is ([spec/schematic-view.md](../../../spec/schematic-view.md) §2.1).
Resolution is what the format can express; the lattice is what the drawing convention uses. They
are different questions, and the format keeps the finer one so that a historical file, a migration,
and a hand-written value all remain expressible.

### D3. The review app already produces lattice coordinates

`snapPlacement()` snaps to `0.5 mm` ([ADR-0057](../08-libraries/0057-symbol-pins-sit-on-a-half-millimetre-lattice.md)
D4) and is used for symbol placements, field anchors, label and port moves alike. The app needs no
change for this record; it is the reference implementation of the rule.

### D4. A label or a port placed by hand is not reseated

Moving a label or a port writes the position the operator chose. If that position is not on the
net, `texteda check` reports `view.label-not-on-net` or `view.port-not-on-net` with the distance.
The write is not silently corrected: a hand position is a decision, and a repair that undoes it
makes the app lie about what it did. The lattice is a convention for *how to choose* a position,
not a filter that overrides one.

### D5. Free placement is not admitted today

There is no "off-lattice" escape hatch, no per-record flag, and no second grid. If a design
genuinely needs a coordinate that is not on the lattice — an optical alignment to a reference
figure, a label that must dodge a silkscreen boundary — the answer is not a rule change but a
decision: the closed question at the end of this record says what admitting it would take.

## Consequences

- Both reference pages already satisfy the rule (measured 2026-11-04: `buck-5v` and
  `charger-power`, every `place` origin, `field` anchor, wire bend, label, port, and note
  coordinate — zero off-lattice values). Nothing in the repository moved.
- `spec/schematic-view.md` §4.1 no longer says a field "uses the `0.01 mm` grid". It states the
  resolution and the lattice separately, and says which one a reader may rely on.
- The house style for a print page is now one sentence: **every coordinate is a multiple of
  `0.5 mm`, in both axes, and in the frame the record's section defines** — sheet coordinates for
  `place`, `wire`, `label`, `port`, and `text`; symbol-local for `field`.
- The rule is machine-checked by the repository's view-style gate, so a page that drifts off the
  lattice is caught before a human reads it — the same way a symbol that drifts off the lattice is
  caught by `lib:verify`.

## The closed question

**When would free placement be admitted, and how would it be expressed?** The answer is not decided
here. Admitting it would need at least: a way to mark the exception in the source (a flag, a
second grid, or a distinct section) so that the checker can tell an intentional free coordinate
from a mistake; a decision about which records may carry it (a `field` anchor that must dodge a
body, but a `wire` bend that cannot be free without breaking the connection rule); and a rendering
and review story for the exception. Until a real design needs it, the rule stays closed and simple.
