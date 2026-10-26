# ADR-0041: A Declared `connect` Pair Must Be Implemented by Copper (What "Implemented" Means)

Status: Accepted
Date: 2026-10-23
Related: [ADR-0003](0003-agent-first-pcb-ir.md), [ADR-0010](0010-footprint-and-3d-model-ownership.md), [ADR-0035](0035-connectivity-authority-and-reverse-engineering.md), [ADR-0040](0040-partial-layout-is-legal-and-reported.md)
Impact: `spec/pcb.md` §5.2 gains a geometry rule; `packages/core` gains a copper-coverage check; the reference project is expected to report one contradiction.

**Amendment (2026-10-26, [ADR-0053](0053-layout-and-routing-are-agent-driven.md))**: D7's "out of scope" is the scope of *this* check, not a permanent boundary. The agent-facing geometric DRC subset (clearance, width, via, keepout, edge, unrouted) is now in scope for `packages/core`; KiCad DRC remains an optional oracle. The sentence below saying "DRC is borrowed" is superseded.

## Background

`connect` states which pads have continuous copper between them. `trace` / `via` / `zone` state where copper was drawn. Nothing compares the two, so the reference project can declare `M2.R1.1`—`M2.C3.1` (the divider tapping the output at the capacitor) while the only VOUT copper starts at R1 and runs 28 mm to reach the capacitors, and no tool notices (`docs/backlog.md` F44 item 1).

This is the last place where a `pcb` description can contradict itself without a diagnostic. ADR-0040 made "how much of the board is here" visible; this decides "whether the copper that is here is what the description says it is".

The definition is the whole difficulty: without one, the check either misses (auditing nothing) or floods (calling every pair unbacked). This record proposes the definition and the tolerance; it is **Proposed** because the tolerance is a contract-level judgement that the project owner signs, not something an implementation may pick.

## Decision

**D1. The rule.** Every `connect` pair must be implemented by copper of that pair's net: there must be a connected chain of copper that touches both pads. A pair that no chain reaches is reported (`bind.connect-unbacked`).

**D2. What counts as copper.** Exactly the three primitives the language has, and nothing else:

- a **segment**: one row of `trace` (a polyline on its layer);
- a **barrel**: one row of `via`, joined to copper on every copper layer of the stackup the via passes through;
- a **polygon**: one row of `zone` (a filled region on its layer).

A chain may change layers only through a barrel. Two primitives are connected when their geometry shares at least one point (D3). A zone that covers an entire board is therefore one connected region for every pad of its net on that layer — which is what a ground plane means, and the reason a check that ignored polygons would report every `GND` pair.

**D3. Touching, and the tolerance.** "Shares a point" is evaluated with a **1 nm** tolerance (coordinates are nm integers; 1 nm is three orders of magnitude below any manufacturing resolution). The tolerance exists because rotations other than multiples of 90° are evaluated in floating point, not because a gap of 1 nm is meant to be acceptable. A check that needs a larger tolerance is telling us the drawn geometry does not touch, and saying so is the point.

**D4. Pad geometry comes from the library.** A pad's shape is the footprint's (ADR-0010) transformed by `place`: translation, rotation, and mirroring for a part on the bottom side. The description never carries pad geometry, and this check must not invent one.

**D5. Severity is `warning`.** The same reasoning as rule 4 (unrouted) in `spec/pcb.md` §5.2: a layout is a work in progress, a declaration is often written before the copper is drawn, and a checker that fails mid-layout is a checker people turn off. The contradiction is still reported with enough detail to act on (`net`, both pads, whether the net has any copper at all).

**D6. This does not make geometry authoritative.** The check reads the drawing to test the declaration; it never produces connectivity, never repairs it, and never writes back (invariants 2 and 4). If the drawing and the declaration disagree, the declaration stays the truth and the report names the drawing as the thing that is wrong.

**D7. Out of scope, deliberately.** Clearance, annulus, thermal relief, necking, impedance, current capacity: those are DRC and physics, not "is the declaration implemented". Zones with thermal spokes are a polygon for this check even though copper does not reach the pad continuously in the physical part — a distinction this record declines to model.

**D8. Cost is bounded by the description, not by the board.** The check is a small connectivity search over the primitives of one net; it runs per pair, on the IR, with no filesystem and no external tool (invariant 20). If a real board makes it slow, the fix is a spatial index, not a weakened rule.

## Consequences

- On the reference project the check reports **seven** pairs when it first runs (2026-10-23), not the one this
  record guessed: `M2.C1.1`–`M2.U1.7`, `M2.C1.2`–`M2.U1.6`, `M2.C2.1`–`M2.U1.1`, `M2.C2.2`–`M2.U1.8`,
  `M2.C4.1`–`M2.L1.2`, `M2.D1.1`–`M2.L1.1`, `M2.L1.1`–`M2.U1.8`. The VOUT divider pair is **not** among them:
  `M2.C3` is a 7343 tantalum whose pad reaches the track at (32.9, 20), so that pair is implemented — the sketch is
  less broken there than a first reading suggested. Two of the seven are worse than a gap: `M2.C1` sits so that its
  SYS pad is on the end of the GND track and its GND pad on the end of the SYS track, i.e. another net's copper
  reaches the pad. The check reports the pair as unbacked, which is what it can prove (`bind.connect-unbacked` does
  not cross nets); the short itself is the clearance question of D7, still borrowed. The observation is filed as a
  note of `charger-buck-pcb-r1`, whose verdict is `deferred`.
- The reference project stays a passing gate: a `warning` does not change `check`'s exit code. Fixing the file (drawing the run the declaration implies, or moving the tap) is the author's call, because which side is wrong is an electrical decision, not a geometric one.
- A `pcb` for which no copper is drawn at all now produces a report per declared pair rather than silence — the same complaint rule 4 already makes once per net, from the other direction.
- `spec/pcb.md` §5.2's closing paragraph ("geometry-level checks are done by a geometry checker or KiCad DRC") becomes precise: coverage is ours; the agent-facing DRC subset is now ours too ([ADR-0053](0053-layout-and-routing-are-agent-driven.md)), with KiCad DRC as an optional oracle.
