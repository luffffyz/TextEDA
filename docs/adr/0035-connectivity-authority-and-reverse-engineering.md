# ADR-0035: Connectivity Has One Authority; Reverse Engineering Is an Import, Not a Mode

Status: Accepted
Date: 2026-10-22
Related: [ADR-0003](0003-agent-first-pcb-ir.md), [ADR-0008](0008-ir-shard-identity-and-hash.md), [ADR-0010](0010-footprint-and-3d-model-ownership.md), [ADR-0027](0027-device-parts-families-and-library-dependencies.md)
Impact: `AGENTS.md` §4.1 (the board combinations), §4.3, §4.4 (the binding rules), §11 (questions 5 and 6); `spec/pcb.md` §4.11, §4.12, §5.2; `spec/footprint.md` §4 (a non-electrical pad); `docs/backlog.md` F21, F36 (new)

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
([ADR-0003](0003-agent-first-pcb-ir.md)), and `AGENTS.md` §4.1 still lists "pcb only" as an
allowed combination for reverse engineering, RF- or structure-driven layout, and netlist import.
`AGENTS.md` §11 question 6 asks whether that mode is supported.

## Decisions

### D1. The schematic decides the connectivity; the board implements it

A board's connectivity is the connectivity of its schematic. The pcb description may only
implement it, plus the physical features and split/tie mechanics listed in D2. A short between two
schematic nets that is not covered by a declared deviation is an **error**, not a warning: the
schematic is missing a fact, and the fact belongs there.

### D2. The deviation whitelist is closed

Exactly five kinds exist, and their shapes are:

| Kind | Shape | What it changes | What it must reference |
|---|---|---|---|
| `net_tie` | two schematic nets are shorted on the board | the two nets become one electrically | both nets exist in the schematic |
| `split_ground` | one schematic net is realized as two galvanically separate regions | nothing logically; the copper is split | the net exists in the schematic |
| `test_point` | a single-layer pad for probing | adds a pad to a net | the net exists in the schematic |
| `stitching` | a via tying one net across layers | nothing logically; a via is not a pad | the net exists in the schematic |
| `fiducial` | a copper mark with no net | nothing | it must have no net |

The boundaries that were fuzzy are now written down:

- **`net_tie` versus `split_ground`**: a tie *merges* two nets, a split *divides* one.
- **`test_point` versus `stitching`**: a test point is single-layer, a stitching via reaches
  across layers. A via that connects two different nets is a `net_tie`.
- **`fiducial`** carries no net; a fiducial on a net is an error.

**The list is closed.** No sixth kind is added without its own decision record. In particular, a
missing schematic fact is never parked here: the whitelist exists for physical features and for
split/tie mechanics, not for "the schematic did not say so". Every difference between the board
and the schematic that is not one of the five is an error.

The checker does not try to know whether a declared tie is a design decision or a mistake; it
reports it, and a human judges it. That is the same division of labour as everywhere else in this
project: the machine states the difference, the reviewer decides.

### D3. A pad without a pin is closed on the device side

Real devices have pads that are not pins: a thermal pad, a shield tab, a mounting pad tied to
chassis ground. Today the footprint's pad numbers must match the symbol's pins
([ADR-0010](0010-footprint-and-3d-model-ownership.md) decision 3), and the library check accepts
a pad set that is a superset of the pin set — so the case can be written down but has no meaning
yet. It gets one, and it gets it in the device and the footprint, not in the pcb:

- **An electrical pad** — one that carries a net — is **a pin of the device**. The device
  declares it, the symbol shows it, and the schematic carries it. A device with a thermal pad
  electrically tied is a different device from one without, and it says so by having a different
  pin table ([ADR-0027](0027-device-parts-families-and-library-dependencies.md) decision 3: the
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
| Reverse engineering: a board exists, its schematic does not | infer the connectivity from the geometry or read a foreign netlist, and write `sch/` plus `pcb/` sources; the board is then an ordinary board |
| An external netlist arrives (a customer's, a supplier's) | a board with a schematic and no pcb — a combination that already exists — plus the `components/` the netlist needs |

The importer is a generator in the sense of
[ADR-0017](0017-fact-layer-no-expressions.md) decision 3: it lives outside the language and its
product is a table. That is the point of the arrangement — the review object is the generated
schematic, which a human can read and check against the original, rather than a black box that
somewhere holds the truth. An imported schematic that nobody reads is worthless, and this
arrangement makes that visible rather than hiding it behind a mode.

**The implementation is deferred.** The decision is recorded here so that the direction is not
reopened; the importer itself is later work (`docs/backlog.md` F36).

### D7. Deviations are reported, never hidden

Every deviation — the declared ones, the physical entities that have no counterpart in the
schematic, and anything the target format cannot carry — appears in the report
(`AGENTS.md` §4.4 rule 5). A deviation is a fact about the board that a reader must see.

## Consequences

- **The schematic stays the truth, and the exceptions are enumerated.** "The pcb may not invent
  connections" becomes checkable: five shapes, written down, and everything else is an error.
- **The board always has a schematic.** A board that arrives as geometry becomes a normal project
  through an import, and the project does not carry a second connectivity model.
- **The device model absorbs the pad/pin gap.** A thermal pad tied to ground is a pin, because it
  is a connection; a mechanical pad is a footprint fact, because it is not.
- **The report is where judgement happens.** The checker states the difference between the board
  and the schematic; the reviewer decides whether it is intended.
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
  currents and ranges. Not decided here.
- **The importer's scope and output conventions**: which foreign formats it reads, what it does
  when the input is ambiguous, and how it presents its inferences for review. Belongs with the
  implementation (`docs/backlog.md` F36).
