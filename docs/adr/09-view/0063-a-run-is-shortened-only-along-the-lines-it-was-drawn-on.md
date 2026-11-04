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
**because** a pin used to sit somewhere else. In the reference project the `VOUT` run from `L1.2`
to `C3.1` went out to `x = 214.5` and came back at `x = 211`: two corners that moved the wire
around a pin sitting to the left of `C3`. Move the pin onto `C3`'s own column and those corners
have nothing left to do — but a re-anchor keeps them, because they are still on the axes. The
person sees a run with three bends where one would do, on the sheet they just moved a part on,
and has to redraw it by hand.

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

**D2. A corner goes when the drawing is still legal without it.** The segments around it become
one straight segment. This is the ordinary case: two collinear corners become one, or a bend that
was never needed goes away. A corner whose removal would leave a slanted segment is not a
candidate at all — no run on the sheet has one
([ADR-0059](0059-print-page-coordinates-anchor-on-the-half-millimetre-lattice.md) D1).

**D3. A whole run of corners may be replaced by one elbow, but only when the shorter line shares
a segment with the drawing.** This is the rule that keeps this from being a router. The elbow
leaves the first end on the axis the run was drawn on, and the candidate must reuse a segment
that is already there. A shortcut that shares no segment is refused **even when it is legal and
shorter**: the GND bus at `y = 121` stays at `y = 121` rather than drifting up to a pin at
`y = 112.5`, because the second line is a different line — one the person did not draw — and
moving it would carry its label and port along with it.

**D4. Legality is the reader's legality, not a second opinion about it.** `isLegalRun` decides
with the same primitives the readability check uses — `pinStroke`, `segmentInBox`,
`segmentCrossing`, `distanceToSegment`, `ON_LINE_NM` — so a corner this pass keeps is a corner the
check will accept, and a corner it removes is one the check would have complained about. A
checker that re-derived a pin stroke would drift from what the reader sees
([ADR-0042](0042-the-review-app-has-modes.md) D5, [ADR-0035](0035-the-view-layer-is-a-drawing.md)).
The run's own two ends are exempt, because a run always touches the pins it connects.

**D5. This is not a router and has no objective.** No search, no cost function, no candidate
generation beyond the run's own corners and their coordinates. A detour drawn on purpose survives
because removing its corner would run the wire through whatever it was drawn around. "The drawing
got shorter" is a consequence of removing corners that no longer have a reason; it is never a
target that licenses finding a new line.

## What follows

- A move that used to leave a redundant detour now leaves a straight run: `L1.2 → C3.1` goes from
  four corners to one.
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
- **Only remove collinear corners** (what `tidy` already did before this record). Safe, and
  insufficient: the `VOUT` detour's corners are not collinear, they are a there-and-back that
  only the pin's old position justified.
- **Let the caller decide** which corners are redundant. There is no caller-side fact the pass
  does not already have, and a drawing rule that lives in two callers drifts.
