# ADR-0043: Ratings Are Compared Against Declared Windows

Status: Accepted
Date: 2026-10-23
Related: [ADR-0038](0038-device-vocabulary-and-parameter-roles.md), [ADR-0039](0039-a-part-states-its-own-ratings.md), [ADR-0016](0016-diagnostic-error-codes.md), `docs/backlog.md` F42
Impact: new diagnostic domain `design`; `spec/teda.md` §7.4; `packages/core` gets its first rating check

## Context

The language can state two things and never compares them.

A design states a **window** on a net: `voltage SYS 9V..19.8V`, `current VOUT 3A`
(`spec/teda.md` §7.4). A device states a **limit**: a generic's `params` carry the
specification the design needs (`100n 10% 25V X7R`), and a part carries its own
`ratings` ([ADR-0039](0039-a-part-states-its-own-ratings.md)). The checker enforces
that the columns are present (ADR-0038) but never asks whether `16V` covers the rail
it sits on. So "the design declares a maximum" and "the part can take it" are two
sentences in the same repository that no tool puts next to each other.

This is the latest review's loudest gap in kind: the power review of `charger-buck`
had to compute the derating of a 3 A regulator by hand, and the note it left
("`current VOUT 3A` equals TPS5430's own `rated_current 3A`") is exactly a fact a
machine can check.

Comparing facts with requirements needs decisions that a checker cannot make on its
own: at which point of the window, which parts count as related, and what "no margin"
means. This record decides them, so that the first check is not one more rule with an
unstated philosophy.

## Decision

### D1. Worst case over the declared window, never nominal

A window is the design's promise about the range it will be operated in. A part that
survives only the nominal point is a part with an unexamined failure. The comparison
therefore takes the **endpoint of the window that stresses the fact** — the maximum
for a voltage capability, the maximum for a current rating — and never the mid-point.

There is no separate "nominal" mode to select: the window is already the design's
stated envelope, and its endpoints are what the design claims to tolerate.

### D2. Parts are independent

The language cannot state that two parts drift together (a matched pair, a common
reference). Until it can, an evaluation is **per part**, and no tolerance is applied to
either side:

- a **fact** (a rating) is a limit, not a distribution — derating it by the part's
  tolerance would invent a second, unstated limit;
- a **requirement** (a declared window) is used as written; widening it by the
  tolerances of the parts that produce it would require the correlation the language
  cannot express.

Two resistors at `±1%` are therefore each compared at their stated value, not at
opposite ends. Stating a matched pair needs its own construct, and that is an open
point (`docs/backlog.md` F42 item 0).

### D3. A two-terminal device sees the difference of the declared potentials

The stress of a capacitor is the voltage **across** it, not the potential of either
net. So for a two-terminal device with a `voltage` capability, the stress is the
difference between the two nets' declared windows, at its extreme:

`stress = max(|max(a) − min(b)|, |max(b) − min(a)|)`

A net's window is its declared `voltage` constraint. A net with no declared window has
an **unknown** potential, and the device is not compared (D4).

**The frame has one origin, and the design declares it.** The tool does not assume
that a net called `GND` is 0 V: a board with a split ground or an isolated converter has
more than one reference, and a checker that guesses would be confidently wrong. The
origin is stated like any other potential, `voltage GND 0V..0V`, and until it is stated
the devices around it are simply unknown. Two independent frames are not representable
yet, and that is honest — a design with an isolated domain will see its devices reported
as not compared, rather than silently compared against the wrong reference.

### D4. Unknown is counted, not passed

A device that is not compared is not a device that passed. Every board gets one `note`
naming how many instances were not compared and why (more than two pins, no declared
window on one of its nets, no declared capability). One note per board, not one per
instance: a board with thirty undecided rails would otherwise bury its real findings.

This is the same policy the binding layer already applies to a missing description
(`bind.not-checked`, [ADR-0040](0040-partial-layout-is-legal-and-reported.md)).

### D5. Derating is project policy, not a checker constant

The checker reports **violations** — a capability below the stated window — and nothing
else. It does not apply an 80 % factor, because the right factor depends on the part
class, the environment and the house standard, and a tool that picks one silently makes
every design that did not ask for it non-compliant.

A design that wants a margin states it (a lower window on the net, or a procurement
rule); the checker's job is the boundary it can prove. Whether the project should be
able to state a derating policy once, in `project.toml`, is an open question and not
part of this record.

### D6. The first slice is voltage across two terminals

Implemented now: `voltage` capability of a **two-pin** device against the declared
window difference of its two nets. Nothing else.

Deliberately not in this slice, each needing a stress model that names pins:

- **multi-terminal devices** — `Vds`, `Vgs`, `Vin` are not "the voltage across any two
  pins", so a rating of a 8-pin regulator cannot be checked without per-construction
  pin semantics (`VIN` against `GND`, `BOOT` against `PH`). Claiming otherwise would
  produce noise, and noise is how a checker gets switched off.
- **current** — a net's current is shared by its members; a part sees the current
  through its own pins, which the language does not state yet (`current VOUT 3A` does
  not say which member carries it).
- **power, saturation, temperature** — same shape, later.

The terminal-pair syntax and the role-level direction that the next slice needs are decided in
[ADR-0052](0052-a-rating-names-its-terminals.md); the checker still implements the two-terminal
inference above until that slice lands.

### D7. A new domain: `design`

Rating rules go in their own domain rather than into an existing one
([ADR-0016](0016-diagnostic-error-codes.md) fixes the vocabulary, and adding a domain
needs a record):

- not `syntax` / `value` — nothing is misspelled or mistyped;
- not `net` — connectivity is correct and the design is still unsound;
- not `drc` — that is the physical layer's geometry (clearance, annulus), decided from
  footprints, not from ratings;
- not `bind` — binding is agreement *between descriptions*; this is agreement between a
  description and the parts it is built from.

`design.rating-exceeded` is the violation; `design.stress-unknown` is the per-board note
of D4.

## Consequences

- A design can now be wrong in a way the tool sees: a capability below its net's
  declared window is an error, with both numbers in the message.
- Boards have to state their reference (`voltage GND 0V..0V`) to get the common case
  checked; a board that omits it reports "not compared" instead of a false pass. Both
  reference boards state it.
- The note of D4 shows up on every board that has any multi-pin device, which is most
  boards. That is intended: the number is the honest coverage figure, and it shrinks as
  D6 is filled in.
- Derating stays a design decision. When the project can state a policy, D5 is the
  hook to revisit — and the review note about `current VOUT 3A` against a 3 A regulator
  stays open until the current slice exists.
