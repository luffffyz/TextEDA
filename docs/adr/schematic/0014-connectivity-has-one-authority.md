# ADR-0014: Connectivity Has One Authority; Reverse Engineering Is an Import, Not a Mode

Status: Accepted
Date: 2026-10-22
Scope: Decides: that the schematic is the single authority on connectivity, that the deviation whitelist is closed, and that there is no pcb-only mode. Does not decide: how copper implements a connection — see ADR-0020.
Related: [ADR-0009](../project/0009-board-linking.md), [ADR-0012](0012-one-flat-schematic-per-board.md), [ADR-0016](../pcb/0016-agent-first-pcb-description.md), [ADR-0020](../pcb/0020-connect-pairs-need-copper.md)
Impact: `spec/pcb.md` §5.1, §5.2; `packages/core/src/bind/**`; `docs/backlog.md` F21, F36

## Background

The binding rules between a schematic and a board exist (`AGENTS.md` §4.4), the pcb description
states them (`spec/pcb.md` §5), and the checker implements the first five. Two questions were left
open.

The first is the authority boundary. The schematic decides the connectivity, and the board
implements it — that much is settled (invariant 2: connectivity is decided by the logical model
and never inferred from geometry; invariant 13: the pcb may not add or remove logical connections
silently). What was not settled is the case that comes up in practice: a board where a
connection exists physically and the schematic does not state it. The answer must not be "the
schematic is allowed to be incomplete", and the deviation whitelist is the mechanism that keeps
that from happening — but the whitelist had no written boundaries, so it could drift into a place
where a missing schematic fact gets parked.

The second is whether a board may exist without a schematic. The `pcb` description assumes one
([ADR-0016](../pcb/0016-agent-first-pcb-description.md)), and `AGENTS.md` §4.1 still lists "pcb only" as an
allowed combination for reverse engineering, RF- or structure-driven layout, and netlist import.
`AGENTS.md` §11 question 6 asks whether that mode is supported.

## Decisions

### D1. The schematic decides the connectivity; the board implements it

A board's connectivity is the connectivity of its schematic. The pcb description may only
implement it, plus the physical features and split/tie mechanics listed in D2. A short between two
schematic nets that is not covered by a declared deviation is an **error**, not a warning: the
schematic is missing a fact, and the fact belongs there.

### D2. The deviation whitelist is closed

Exactly four kinds exist, and their shapes are:

| Kind | Shape | What it changes | What it must reference |
|---|---|---|---|
| `net_tie` | two schematic nets are shorted on the board | the two nets become one electrically | both nets exist in the schematic |
| `split_ground` | one schematic net is realized as two galvanically separate regions | nothing logically; the copper is split | the net exists in the schematic |
| `stitching` | a via tying one net across layers | nothing logically; a via is not a pad | the net exists in the schematic |
| `fiducial` | a copper mark with no net | nothing | it must have no net |

The boundaries that were fuzzy are now written down:

- **`net_tie` versus `split_ground`**: a tie *merges* two nets, a split *divides* one.
- **`stitching`** is a via reaching across layers. A via that connects two different nets is a
  `net_tie`.
- **`fiducial`** carries no net; a fiducial on a net is an error.

**The list is closed.** No fifth kind is added without its own decision record. In particular, a
missing schematic fact is never parked here: the whitelist exists for physical features and for
split/tie mechanics, not for "the schematic did not say so". Every difference between the board
and the schematic that is not one of the four is an error.

The checker does not try to know whether a declared tie is a design decision or a mistake; it
reports it, and a human judges it. That is the same division of labour as everywhere else in this
project: the machine states the difference, the reviewer decides.

The `physical_only` section is where a physical entity with no schematic counterpart is declared:
`mounting`, `fiducial`, `stitching` and `cutout`. Each row carries a position, and the
fabrication writer carries those positions into the manufacturing layers — a mounting hole is a
non-plated drill, a stitching via is a plated drill plus a copper flash on every copper layer, a
fiducial is a copper flash. A declared `physical_only` item is therefore visible in the fabricated
output, not only in the IR.

### D3. A pad without a pin is closed on the device side

Real devices have pads that are not pins: a thermal pad, a shield tab, a mounting pad tied to
chassis ground. Today the footprint's pad numbers must match the symbol's pins
([ADR-0030](../libraries/0030-footprint-format-and-geometry.md) decision 3), and the library check accepts
a pad set that is a superset of the pin set — so the case can be written down but has no meaning
yet. It gets one, and it gets it in the device and the footprint, not in the pcb:

- **An electrical pad** — one that carries a net — is **a pin of the device**. The device
  declares it, the symbol shows it, and the schematic carries it. A device with a thermal pad
  electrically tied is a different device from one without, and it says so by having a different
  pin table ([ADR-0024](../devices/0024-the-device-kind-is-part-or-generic.md) decision 3: the
  pin table is the identity boundary).
- **A non-electrical pad** — one that carries no net — is declared as such **in the footprint**,
  and it must not carry a net in the pcb. A non-electrical pad on a net is an error.

So the pcb's authority does not grow: a connection always has a pin behind it.

### D4. The boundaries live in the specification

D2's table and the rules derived from it are written into `spec/pcb.md` §4.11, §4.12 and §5.2, so
that a third-party implementation computes the same verdicts.

The footprint's non-electrical pad (D3) is a small addition to the footprint type, and it is
**specified and implemented together** — a specification that promises a marker the parser does
not accept is worse than no specification at all. It waits for the binding work
(`docs/backlog.md` F37).

### D5. There is no pcb-only mode: a board always has a schematic

A board without a schematic is not a supported shape. The reason is not that the case is rare; it
is that a second source of connectivity forks everything downstream — the checkers, the renderer,
the BOM, the exporters, the netlist — and the IR would have two shapes for the same thing. A
board's identity would then depend on which description happened to be present, and
`AGENTS.md` §2 invariant 16 ("one board = one schematic description, one BOM, one pcb") would
be false.

The schematic is cheap to produce from things that are not schematics, and the tools that do it
are described in D6. What is not acceptable is a *mode* in which the schematic is optional.

A board that has a pcb and no schematic is an **error**, not a "not checked" case. A board with a
schematic and no pcb is a legal state, and the pcb checks are skipped with "not checked" in the
report.

### D6. Reverse engineering and external netlists are an import, not a mode

Both scenarios the "pcb only" row was meant for are served by an **importer**: a generator
outside the language that reads a foreign description and writes this project's source files.

| Scenario | What the importer produces |
|---|---|
| Reverse engineering: a board exists, its schematic does not | infer the connectivity from the geometry or read a foreign netlist, and write `design/sch/` plus `design/pcb/` sources; the board is then an ordinary board |
| An external netlist arrives (a customer's, a supplier's) | a board with a schematic and no pcb — a combination that already exists — plus the `assets/components/` the netlist needs |

The importer is a generator in the sense of
[ADR-0001](../language/0001-fact-layer-has-no-expressions.md) decision 3: it lives outside the language and its
product is a table. That is the point of the arrangement — the review object is the generated
schematic, which a human can read and check against the original, rather than a black box that
somewhere holds the truth. An imported schematic that nobody reads is worthless, and this
arrangement makes that visible rather than hiding it behind a mode.

**The implementation is deferred, and so is everything else importer-shaped** (2026-10-22). The
direction above is recorded so that the "pcb only" question is not reopened, but the scope, the
output conventions and the way inferences are presented are **not** decided now: they wait with
the work (`docs/backlog.md` F36). Until then no importer entry point is added, not even a partial
one — a half-imported board is a board nobody can trust.

### D7. Deviations are reported, never hidden

Every deviation — the declared ones, the physical entities that have no counterpart in the
schematic, and anything the target format cannot carry — appears in the report
(`AGENTS.md` §4.4 rule 5). A deviation is a fact about the board that a reader must see.

### D8. A test point is a device

A test point can be written two ways: as a physical-only entity in the board description, or as a
device in the schematic. It is a device, and three things say so.

- **Shapes live in the footprint library.** The board description stores coordinates, not geometry
  ([ADR-0030](../libraries/0030-footprint-format-and-geometry.md)). A test point that may have a
  custom shape needs a land pattern, and a land pattern lives in a footprint — which belongs to a
  device. The physical-only form writes a size in the board description, which is the one thing
  the board description may not do.
- **It has an identity.** A reference, a position, a side, an orientation. The assembly drawing,
  the placement data and the test fixture all refer to it. A feature of a net has none of these.
- **It has one electrical fact.** One pad on one net — which is exactly one pin.

So a test point in the schematic is a **one-pin device**: a generic when it is not purchased (a
bare pad) or a part when it is (a real test-point component). The board places it like any other
device, its net membership is ordinary, and no deviation is involved. The `test_point` form of the
whitelist is retired for the same reason: a pad on a net is a device and no longer a physical
entity.

### D9. The line is: is it a pad on a net?

- **Yes** → it is a device in the schematic: visible in the netlist, in the BOM when it is
  purchased, in the placement data, and in the review.
- **No** → it is a physical entity in the board description: a via, a hole, a mark, a cutout.

And with it, the rule that the question was really about: **anything that exists logically must be
visible in the schematic.** A board fact that exists only in the board description is a physical
fact; if it is a logical fact, the schematic has to show it. Otherwise it is invisible to the
netlist, to the BOM, to the fabrication data and to the reviewer — and a thing nobody can see is a
thing that is forgotten.

### D10. Every declared deviation enters the report, and the severity says how dangerous it is

D7 says a deviation "must be declared and enters the report" — but nothing said what that report
entry is, and an implementation that consumed the declarations silently made the rule a lie: a
`net_tie` was used as an exemption and vanished, and a `split_ground` was accepted and vanished
with it. A dangerous operation that produces no output is not reported, it is hidden.

| Declaration | Severity | Why |
|---|---|---|
| `net_tie` | note | A deliberate and common statement: two schematic nets are physically one (a 0 Ω link, a solder jumper). It changes the connectivity of both nets, so the reader has to see it — but nothing is wrong. |
| `split_ground` | warning | One net — usually ground — is physically split into regions that do not touch. The return path is broken by definition: every signal that crosses the gap returns on its own. It is legitimate (isolation, a separated analog ground), but it is never a default, and each instance deserves a look. |

The line is not "how much the checker likes it" but "what happens if it was a mistake". A net tie
that should not have been there still behaves like one net; a ground split that should not have
been there breaks every return path that crossed it.

### D11. Undeclared stays an error

A short between two nets with no `net_tie` is an error, and a difference that is not on the
whitelist is an error rather than a warning (D2). The severities above apply to the **declared**
case only — declaring a deviation is how you say "this is intended", not how you make an error go
away.

## Consequences

- **The schematic stays the truth, and the exceptions are enumerated.** "The pcb may not invent
  connections" becomes checkable: four shapes, written down, and everything else is an error.
- **The board always has a schematic.** A board that arrives as geometry becomes a normal project
  through an import, and the project does not carry a second connectivity model.
- **The device model absorbs the pad/pin gap.** A thermal pad tied to ground is a pin, because it
  is a connection; a mechanical pad is a footprint fact, because it is not. A test point is a
  device, because it is a pad on a net.
- **The report is where judgement happens.** The checker states the difference between the board
  and the schematic; the reviewer decides whether it is intended. The severity says how much a
  look it deserves.
- **The importer is not built yet.** F36 records it, and the direction is fixed so that the first
  implementation does not have to reopen it.

## Alternatives

- **A pcb-only mode**, where the pcb declares the complete net set and takes over the schematic's
  role. Rejected: it forks the checkers, the renderer, the BOM and the exporters, and it makes
  the board's identity depend on which descriptions happen to exist. The cases it would serve
  are served by an import, which ends in the same place — a board with a schematic.
- **Widening the whitelist** so that "a connection the schematic does not state" becomes a
  deviation kind. Rejected: that turns the whitelist into a parking space for missing schematic
  facts, and the schematic stops being the truth. The gap that showed up in practice — a pad
  without a pin — belongs in the device model (D3), where it also becomes a fact the schematic can
  carry.
- **A "the pcb is newer than the schematic" tolerance**, where the checker downgrades a mismatch
  to a warning for a while. Rejected: it is the same as widening the whitelist, with a timer.
- **Requiring the schematic to model every tie as a device** (a zero-ohm link, for instance),
  and rejecting a bare `net_tie`. Rejected: a tie is often a deliberate assembly option rather
  than a part, and the report already makes it visible.

## Open Points

- **Constraint vocabulary for pins**: "this pin must sit on a power net" — the rule a thermal pad
  tied to ground wants — is not expressible in the constraint section today, which knows voltages,
  currents and ranges. Not decided here. (This is a *net membership* constraint, not a thermal
  one: the thermal relief itself is already covered by the footprint's pad zone. No common EDA is
  known to offer this either, so it stays a low-priority open point until a real board needs it.)
- **The importer's scope and output conventions**: which foreign formats it reads, what it does
  when the input is ambiguous, and how it presents its inferences for review. **Deferred** with
  the importer itself (2026-10-22): every importer-related decision waits with the work
  (`docs/backlog.md` F36). Nothing importer-shaped is decided in the meantime.
- **Unsourced lines in the fabrication data.** A one-pin device that is not purchased — a bare
  test pad — has no manufacturer part number, so its BOM line is unsourced
  ([ADR-0029](../devices/0029-the-procurement-layer.md) decision 9). That is a warning today, and
  for a board full of test pads it is noise. Whether the fabrication data should carry such lines
  at all is not decided here; the state itself now exists — a selection may name `not-required`,
  which is a line with nothing to buy rather than a line whose buying is unfinished.
