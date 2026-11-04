# ADR-0063: A Run Is Shortened Only Along the Lines It Was Drawn On

Status: Accepted
Date: 2026-11-04
Scope: Decides: what a re-anchored run may do with the corners it no longer needs — which corners a move may remove, on which coordinates a shortened run may sit, and what "shortened" is forbidden to become. Does not decide: how a lost shape is rebuilt in the first place — see [ADR-0042](0042-the-review-app-has-modes.md) D5; what an end of a run may name — see [ADR-0062](0062-a-run-may-end-at-a-port.md); how a run is laid out by hand — see [ADR-0059](0059-print-page-coordinates-anchor-on-the-half-millimetre-lattice.md).
Related: [ADR-0035](0035-the-view-layer-is-a-drawing.md), [ADR-0042](0042-the-review-app-has-modes.md), [ADR-0059](0059-print-page-coordinates-anchor-on-the-half-millimetre-lattice.md), [ADR-0062](0062-a-run-may-end-at-a-port.md).
Impact: `packages/core/src/view/reroute.ts`; `packages/cli/src/layout.ts`; `packages/core/src/index.ts`; `spec/schematic-view.md`; `packages/core/test/reroute.test.ts`; `packages/cli/test/review-layout.test.ts`

## Context

When a symbol moves, every run that ended on one of its pins is re-anchored: the end follows the
pin, and the shape between the ends is rebuilt if the old one no longer fits
([ADR-0042](0042-the-review-app-has-modes.md) D5). Rebuilding only guarantees two things — the run
starts and ends where its ends are, and the segment leaving each end stays on the axis it was on.
It says nothing about the corners in between.

That is enough for the run, and not enough for the drawing. A run's corners frequently exist
**because** a pin used to sit somewhere else. When this record was written, the reference project's
`VOUT` run from `L1.2` to `C3.1` went out to `x = 214.5` and came back at `x = 211`: two corners
that moved the wire around a pin sitting to the left of `C3`. Move the pin onto `C3`'s own column
and those corners have nothing left to do — but a re-anchor keeps them, because they are still on
the axes. The person sees a run with three bends where one would do, on the sheet they just moved
a part on, and has to redraw it by hand.

So the gap is: a run that has lost its reason for a corner should lose the corner too. The hard
part is that "the corner is not needed" is not the same as "there is a shorter legal path". The
run is part of a **drawing**: its other segments are shared lines with other runs, its corners are
where a person put them, and a bus at `y = 121` is at `y = 121` because that is where the GND
line runs. A shortcut that is legal but sits somewhere else is not a shortening — it is a
different line on the sheet, and it drags the labels and ports anchored to the old one with it.

## Decision

**A re-anchored run keeps its drawn coordinates; it may be shortened only on lines it already
drew.** Concretely, `simplifyRun` in `packages/core/src/view/reroute.ts` applies two rules, in
this order, and accepts a candidate only when it passes `isLegalRun`:

**D1. The ends never move.** The first and last points are the connection points the row names
(a pin, or a port — [ADR-0062](0062-a-run-may-end-at-a-port.md)). Nothing here may change them;
it only removes points between them.

**D2. A corner goes only when the corners left still share one line.** Removing a corner joins
the segments around it; the drawing is accepted only when the corners that remain sit on one
line, or when none remain. Corners on one line *are* a bus, and a bus is a fact about the sheet,
not a redundancy: the `GND` line at `y = 121` is where four labels and a port are anchored, and
that is why it stays at `y = 121`. A removal that would leave corners scattered over the sheet
rebuilt the run instead of shortening it, and is refused. A corner whose removal would leave a
slanted segment is not a candidate at all — no run on the sheet has one
([ADR-0059](0059-print-page-coordinates-anchor-on-the-half-millimetre-lattice.md) D1).

**D3. A leg that reaches an end moves with that end, and one correction is the limit.** Removing
a corner can leave the first or last segment slanted, because the pin or port it reaches has
moved and the run still has to reach it. The corner next to that end is then put onto the end's
own line, on the one axis the corner's other side leaves free. Both ends are never corrected at
once: that is a rebuild, not a shortening, and it is refused.

**D3a. The corner that joins the two ends may be the only corner left — but only if the drawing
already has it.** When `(from.x, to.y)` or `(to.x, from.y)` is a corner in the run as drawn, the
run between the ends needs nothing else, and every other corner goes. The corner is kept because
the person put it there; this rule never invents one.

**D3b. A label or port anchored to the run stays with it.** A label names a net and sits on that
net's wiring; a port is where a run leaves the page. Both are placed where they are because the
line under them is there, so a shortening that takes that line away leaves them in the air — and
the reseat then carries them to whatever line is left, which is a different drawing. The anchors
are therefore passed into `isLegalRun` and must remain on the shortened run. They are read with
the slack the move itself created: a label follows a run whose ends moved, and straightening a
detour beside it is the same move; what is refused is stranding one where the move never went.

**D4. Legality is the reader's legality, not a second opinion about it.** `isLegalRun` decides
with the same primitives the readability check uses — `pinStroke`, `segmentInBox`,
`segmentCrossing`, `distanceToSegment`, `ON_LINE_NM` — so a corner this pass keeps is a corner the
check will accept, and a corner it removes is one the check would have complained about. A
checker that re-derived a pin stroke would drift from what the reader sees
([ADR-0042](0042-the-review-app-has-modes.md) D5, [ADR-0035](0035-the-view-layer-is-a-drawing.md)).
The run's own two ends are exempt, because a run always touches the pins it connects. The
anchors of D3b are the one entry here that is not a readability finding: a stranded label is
reported only once it is stranded, so the shortening has to refuse it itself.

**D5. This is not a router and has no objective.** No search, no cost function, no candidate
generation beyond the run's own corners and their coordinates. A detour drawn on purpose survives
because removing its corner would run the wire through whatever it was drawn around. "The drawing
got shorter" is a consequence of removing corners that no longer have a reason; it is never a
target that licenses finding a new line.

## What follows

- A move that used to leave a redundant detour now leaves a straight run: `L1.2 → C3.1` lost its
  there-and-back and kept the corner that joins its ends — the shape the reference project carries
  today.
- A run that ends beside its other end on the same row keeps its bus and loses only the leg that
  no longer reaches anything: `C3.2 → C4.2` goes from two corners to one when `C4` moves along
  `y = 121`, and keeps both when it moves off the row.
- A move that leaves a bus where it was leaves the bus where it was — its coordinates, its label,
  and its port all stay put.
- `texteda view rewire` and the review app's `Apply` share the pass, because it is a property of a
  re-anchored run rather than of one caller.
- The pass can decline: a run whose corners are all load-bearing is written back unchanged, and a
  move can still introduce a finding when the person drags a part somewhere the run cannot go
  around. Shortening is not a repair for a bad placement.

## Rejected alternatives

- **Find the shortest legal path between the ends.** Legal, and wrong: it produces a line the
  person did not draw (measured: the GND bus moved from `y = 121` to `y = 112.5`, carrying a
  label and a port, with no finding raised to say so).
- **Require a segment the drawing contains, byte for byte.** The first version of D3 did this,
  and it is the defect this record was written to fix: shortening moves one end of a segment
  (`230 → 226.5`), so the shortened segment lies on the drawn line but never matches it.
- **Accept any collinear overlap and nothing else.** The other extreme: it kept one leg on the
  drawn bus and put the rest on a new line, and the bus drifted from `y = 121` to `y = 112.5`
  with a label and a port riding along. Withdrawn in favour of D2 plus D3b.
- **Only remove collinear corners** (what `tidy` already did before this record). Safe, and
  insufficient: the `VOUT` detour's corners are not collinear, they are a there-and-back that
  only the pin's old position justified.
- **Let the caller decide** which corners are redundant. There is no caller-side fact the pass
  does not already have, and a drawing rule that lives in two callers drifts.
