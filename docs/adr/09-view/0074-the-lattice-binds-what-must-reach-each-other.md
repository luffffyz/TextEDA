# ADR-0074: The Lattice Binds What Must Reach Each Other, and the Rest of the Drawing Is Free

Status: Accepted
Date: 2026-11-14
Scope: Decides: that the `0.5 mm` drawing lattice binds only the coordinates that have to reach each other — a symbol's pin connection point, and a print page's placement origin, wire bend, port position and junction position — and that every other coordinate of a symbol or a page is free at the file's `0.01 mm` resolution, with the lattice left as the convention for anchoring them. Does not decide: the view file's own coordinate resolution (`0.01 mm`, [spec/schematic-view.md](../../../spec/schematic-view.md) §2.1), the pin row pitch ([ADR-0058](../08-libraries/0058-pin-rows-on-a-number-bearing-symbol-are-at-least-two-and-a-half-millimetres-apart.md)), footprint pad geometry ([ADR-0030](../08-libraries/0030-footprint-format-and-geometry.md)), and what a renderer does with the freedom it is given.
Related: [ADR-0030](../08-libraries/0030-footprint-format-and-geometry.md), [ADR-0057](../08-libraries/0057-symbol-pins-sit-on-a-half-millimetre-lattice.md), [ADR-0058](../08-libraries/0058-pin-rows-on-a-number-bearing-symbol-are-at-least-two-and-a-half-millimetres-apart.md), [ADR-0059](0059-print-page-coordinates-anchor-on-the-half-millimetre-lattice.md).
Impact: `spec/symbol.md` §4.1; `spec/schematic-view.md` §2.1, §4, §4.1, §4.2, §5.1, §6, §7, §8; `scripts/lib/symbol-style.ts`; `scripts/lib/view-style.ts`; `scripts/view-style.test.ts`; `scripts/cases.ts`; `scripts/verify-views.ts`; `docs/skills/draw-print-page.md`; `docs/skills/repair-print-page.md`; `docs/skills/library-authoring.md`; `docs/skills/preview-symbols.md`; `AGENTS.md`; the lattice note in every symbol file under `examples/`.

## Context

Two records put a `0.5 mm` lattice on drawings, and both went further than the reason they had.

[ADR-0057](../08-libraries/0057-symbol-pins-sit-on-a-half-millimetre-lattice.md) put a symbol's pin
**connection point** and its **inner end** — the point where the pin's tail meets the body — on the
lattice, and with them the visible `rect` body's edges. Its reason for the inner end was that "a wire
must be able to leave a pin and reach a corner". But the wire leaves the *connection point*: the tail
is the drawn stroke between that point and the body, and nothing routes to it.

[ADR-0059](0059-print-page-coordinates-anchor-on-the-half-millimetre-lattice.md) put **every**
coordinate a page stores on the lattice — the placement origin, the field anchor, the wire bend, the
label, the port, the note. Its reason was the same reachability argument, and it was sound for the
bends: a bend that is a lattice point can always be reached from a pin that is one. It was not sound
for the rest. A label has to sit on the wire it names, and the wire is a polyline: the middle of a
segment is not a lattice point, so the rule and the semantics of the thing it constrained disagreed.
Its D4 went further and promised that a position a person placed by hand is written as chosen and not
reseated — while its own gate rejected that position. Its closed question asked what admitting free
placement would take, and answered "a flag, a second grid, or a distinct section": the format had
already been able to express every coordinate since its resolution became `0.01 mm`, so the question
was never about expressibility.

Meanwhile the tools and the records disagreed with each other in three places. The library gate
(`scripts/lib/symbol-style.ts`) checked the pin connection point and the row pitch, and nothing else —
the inner end, the body and the artwork were stated rules that no tool looked at. The view gate
(`scripts/lib/view-style.ts`) checked everything on a page, including the drawing nodes the reachability
argument never covered. And ADR-0057 D3 claimed that decorative glyphs' coordinates "moved onto the
lattice with everything else" — a claim that was false in the same commit that wrote it, in the same
commit's spec and in the same commit's symbols.

Measured over the repository's own drawings (36 symbol files, one print page and three module
drawings): every pin connection point and every pin inner end is on the lattice, every page coordinate
is on the lattice, and exactly one visible rectangle is not — the solid bar of `dc-005-20a`, whose
edges sit at `1.75 mm` and `3.25 mm`. Nothing reported it.

## Decision

### D1. The lattice binds what must reach each other

The lattice is `0.5 mm`, and it binds these coordinates, in both axes:

| Where | What |
|---|---|
| a symbol | the pin's **connection point** |
| a page | the **placement origin** of a placed symbol |
| a page | every **bend** of a wire |
| a page | the **port** position |
| a page | the **junction** position |

These are the coordinates two things have to agree on: a wire leaves a pin and turns at a bend, ends
at a port or a junction, and a placed symbol's pins have to stay reachable where they land. A bend on
the lattice can always be reached from a pin on the lattice; a bend off it cannot, in general. Making
the reachability set lattice-only turns "can this wire be drawn?" from a geometric accident into a
constructive property of the drawing.

The library gate and the view gate check exactly this set.

### D2. Everything else is free, and the lattice stays its convention

The rest of a drawing is free at the file's `0.01 mm` resolution:

- a symbol's pin **inner end** and `length`;
- a symbol's **body frame**, and its decorative artwork;
- a symbol's **field anchors**;
- a page's **field anchors**, **labels**, **notes**;
- a page's **module box** geometry and its module ports.

These are drawing. Nothing on them has to line up with anything else, and the semantics that do bind
them are already checked by other rules: a label has to sit on the net it names
(`view.label-not-on-net`), a port on its net (`view.port-not-on-net`), and a field has to fit
where the page can put it (the readability diagnostics).

The lattice remains their **convention**: anchor them on it where that is convenient. A round
coordinate is easier to write, easier to compare between two drafts of the same drawing, and easier
to reuse — that is worth keeping. It is not worth a gate: a value that misses the lattice is almost
always a hand-placed choice, and the tools have no business refusing it.

The artwork of a symbol is where this bites hardest, and deliberately so. A symbol's shape is drawn
to be read: a capacitor's plates, an inductor's humps, a diode's triangle. Those are round numbers
chosen for the eye, and the eye is what they answer to.

### D3. The lattice is a convention, not a diagnostic

Unchanged from [ADR-0059](0059-print-page-coordinates-anchor-on-the-half-millimetre-lattice.md) D2:
the lattice is an authoring convention, checked by the repository's gates, not by `texteda check`. No
diagnostic code is added or retired. The failure it used to cause — a diagonal segment, a wire that
cannot reach its pin — is already reported by `view.wire-diagonal` and `view.wire-crosses-pin`, and a
second code for the same symptom would train an agent to silence codes instead of fixing geometry.

### D4. A hand-placed position is kept, and nothing judges it

[ADR-0059](0059-print-page-coordinates-anchor-on-the-half-millimetre-lattice.md) D4 promised that a
position a person placed by hand is written as chosen and not reseated. With D2 that promise is
simply true: a label, a note or a field anchor that misses the lattice is kept, and no gate reports
it. The app still snaps what it moves to the lattice, because that is easier to work with, but the
file it writes is the file the person asked for.

### D5. Free placement needs no flag, no second grid and no section

This answers the closed question at the end of
[ADR-0059](0059-print-page-coordinates-anchor-on-the-half-millimetre-lattice.md). The format has
expressed every coordinate since its resolution became `0.01 mm`, so there is nothing to add to it:
a free coordinate is a coordinate the file already accepts. What was missing was never an
expressibility mechanism but a decision about which coordinates have to agree — and that is D1.

### D6. What does not change

- The view file's `0.01 mm` resolution. The lattice is what the drawing convention uses; the
  resolution is what the format can express.
- The pin row pitch ([ADR-0058](../08-libraries/0058-pin-rows-on-a-number-bearing-symbol-are-at-least-two-and-a-half-millimetres-apart.md)):
  it is about legibility, not about the lattice, and it is still checked.
- Footprint pad geometry ([ADR-0030](../08-libraries/0030-footprint-format-and-geometry.md)): pad
  centres and sizes keep the datasheet's values, on the lattice or not.
- A connector's drawn pitch is still not its pad pitch
  ([ADR-0057](../08-libraries/0057-symbol-pins-sit-on-a-half-millimetre-lattice.md) D5).
- The language, the IR and the contracts. Nothing here is a language change: no section, no column,
  no diagnostic code, no shard.

## Consequences

- **The gates narrow to the reachability set.** The library gate keeps the pin connection point and
  the row pitch; the view gate keeps the placement origins, the wire bends, the ports and the
  junctions. A page's labels, notes, fields and module boxes are no longer reported, and a symbol's
  artwork and inner ends are never reported.
- **The corpus is gated too.** The library verifier walks one project's library, so the case corpus
  carried twenty symbols that no gate had ever looked at; the case runner now applies the same
  house style to them.
- **Nothing in the drawings moves.** Every symbol and every page already satisfies the narrower rule,
  so the change is a change of *rule*, not of drawing. The one visible rectangle that misses the
  lattice — the solid bar of `dc-005-20a` — is now allowed rather than corrected, which is the point
  of D2: it is a drawn shape, not a wiring point.
- **The symbols say where they stand.** The lattice note in each symbol file named the rule that has
  just narrowed, so the note now names this record and says which part of the drawing is free.
- **No hash moves.** The notes are in the source files, but a note is not a fact: the compiled
  shards and the project hashes read the drawing, not the prose beside it. The case expectations
  are unchanged, and no artifact had to be re-derived.

## The question this leaves open

A renderer's freedom is not the format's. The renderer still places a symbol's `Reference` and
`Value` fields, and it places them in `0.5 mm` steps along the body's sides, which is a coarse
ladder for a crowded sheet. D2 frees the *author* from the lattice; it does not yet give the
*renderer* a finer one. That is a question about the renderer, and it belongs in a record about the
renderer.
