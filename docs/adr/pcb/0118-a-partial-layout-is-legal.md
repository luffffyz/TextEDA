# ADR-0118: A Partial Layout Is Legal, and It Is Reported

Status: Accepted
Date: 2026-10-23
Scope: Decides: that a partially placed board is legal, and that the tool reports what is still missing. Does not decide: what a complete layout is — see ADR-0116.
Related: [ADR-0116](0116-layout-and-routing-are-agent-driven.md), [ADR-0119](0119-connect-pairs-need-copper.md)
Impact: `spec/pcb.md` §5.3; `packages/core/src/bind/**`

## Background

A `pcb` description may exist while the layout is unfinished. The reference project is in exactly that state: `design/pcb/charger-buck.teda` places 9 of the board's 61 instances (the two modules it composes declare 9 and 52). Nothing said so. `check` was silent, the file carries no marker, and a reader of `place` and `connect` cannot tell the board apart from the part of it somebody has got to so far.

The same review found a second, larger gap: the declaration (`connect` says which pads have copper between them) and the drawing (`trace` / `via` / `zone`) are not checked against each other, so a pair can be declared where no copper reaches. That gap is a separate decision and is **not** what this ADR settles (see D5).

The problem is not "the layout is unfinished" — an unfinished layout is a normal work state. The problem is that the description cannot say so, so the silence is indistinguishable from completeness.

## Decision

**D1. A `pcb` description may be partial.** Describing the placements that exist is legal, at any stage. Trial layouts, staged work and variant work all need it; requiring completeness would make the description unusable exactly when it is most useful (early).

**D2. No new syntax for it.** There is no `complete` / `partial` header field. Completeness is **derived** from the two descriptions: instances in the flattened `sch` minus instances in `place`. A flag would be a second fact that can drift from the two it summarizes, and it would say *that* something is missing while saying nothing about *what* — the count and the ids are the useful part, and they are computable. Adding a field for a derived value is the "duplicate description" pit (`AGENTS.md` §7).

**D3. The gap is reported, once per board.** `bind.instance-unplaced` (warning) states `placed / total` and names the unplaced instances. One diagnostic per `pcb` description, not one per instance: "this board is 9/61 placed" is one fact about the description, and a 500-part board with a trial layout would otherwise emit 450 warnings, which teaches people to ignore warnings.

**D4. Severity is `warning`.** An error would make a partial description un-checkable — every other check's result would be buried under a failure about something the author already knows. The check exists so that a reader (and an agent) cannot mistake a fragment for a board, not to forbid the fragment.

**D5. This is not a geometry check.** Nothing here reads pads, traces or zones. A pair being *declared* is still not evidence that copper *implements* it; that gap (F44 item 1) stays open, and when it is closed the definition of "implemented" is decided there, not here.

**D6. Exemptions.** An instance marked `logical_only` is not placed and does not count (a power flag has no physical entity, `AGENTS.md` §4.2). An instance marked `dnp` **does** count: the land pattern is in `place`, the part is simply not fitted, so the spot still exists on the board.

## Consequences

- The reference project's `pcb` now warns `bind.instance-unplaced` (9 of 61). That is the intended effect: the fragment announces itself.
- A finished layout produces no diagnostic, and `check`'s exit code is unaffected either way.
- `spec/pcb.md` §5.2 rule 1's "unplaced instances are handled per variant state" is now precise: variant state decides whether a DNP part is *fitted*, not whether its land pattern is *placed* (D6).
- The identity of what is missing is available to machines without a second source of truth (`data.unplaced`), which is what a future "layout progress" report needs.
