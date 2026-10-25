# ADR-0044: Dissipation Is Checked Against Declared Limits

Status: Accepted
Date: 2026-10-23
Related: [ADR-0043](0043-ratings-are-compared-against-declared-windows.md), [ADR-0039](0039-a-part-states-its-own-ratings.md), [ADR-0038](0038-device-vocabulary-and-parameter-roles.md), [ADR-0016](0016-diagnostic-error-codes.md), `docs/backlog.md` F42
Impact: `design.power-unknown` (new diagnostic code); `spec/teda.md` §6.2.2 and §7.4; `packages/core/src/design/ratings.ts`

## Context

`power` has been a constraint type since v0.6 (`power <pin or net> <max>`, IR
`max_uw`) and a parameter role since ADR-0038, and nothing consumed either. The
backlog called this out (F42, item 0): a language that can say "this resistor must not
dissipate more than 63mW" and never looks at it is a comment with syntax.

The gap matters most exactly where the language is thinnest. Of the 24 resistors on
the reference `charger-buck` board, 10 are low-value parts in the power path
(2Ω damping, 10mΩ sense, 10Ω gate supply) where **power is the first limit reached,
not voltage**. Voltage alone checks nothing there: a 2Ω part across a 19V rail is
fine at 19V and would burn 180W.

Three facts are already in the repository and only need to be put next to each other:

| Fact | Where it is written | What it says |
|---|---|---|
| The design's dissipation ceiling at a spot | `power R1.1 63mW` constraint | this position may dissipate at most this |
| The lowest capability a bought part must have | `instances` row `power` column | buy something that can take at least this |
| What this part can actually take | the part's `ratings` `power` row | datasheet fact |

The computation itself needs no new model: the voltage check (ADR-0043) already
computes the worst-case potential difference across a two-terminal part from the
declared windows, and `ΔV² / R` is arithmetic from there.

## Decision

### D1. The bound is `ΔV² / R` over the declared windows; no current model

A resistive device is a device whose primary quantity is `resistance` — its own
`value` column (a generic) or its `value` rating (a part) — and which has exactly two
pins. Its worst-case dissipation is

`P = stress² / R`, with `stress = max(|max(a) − min(b)|, |max(b) − min(a)|)`

the same expression and the same windows ADR-0043 D1/D2 uses for voltage.

No current is computed. The language cannot say who carries the current of a net
(`current VOUT 3A` names a net, not its members), so an ohmic bound is the only one
that needs no invention.

### D2. It is a bound, so it can report a violation, never prove a pass

The bound assumes both nets reach their window extremes at the same time. Two nets
with the same window yield `0`, while a real part between them may dissipate: the
number is a ceiling, not a measurement. Consequences a reader must not be surprised by:

- A pass is "no error reported", not "verified safe". Only the absence of a *declared*
  limit is reported as unknown (D4), not the absence of a violation.
- An element between two declared windows whose dissipation is **not** a DC quantity —
  the series resistor of an RC snubber, a damping element — gets a meaningless bound.
  This is the design's problem, not the checker's: such a position must not be given a
  dissipation ceiling in the first place (§7.4 says so).
- A resistor to `GND 0V..0V` from a rail is the meaningful case: `ΔV` is the rail.

### D3. Every declared bound binds; the tightest wins

The three sources of D0 are upper bounds on the same quantity, so the comparison takes
the minimum and reports which one bound:

1. **the design's ceiling** (`power <pin> <max>`). Its subject must be a **pin**
   reference (`R1.1`, `M1.R1.1`): dissipation belongs to an instance, not to a net. A
   `power` constraint on a net is grammatically legal and semantically unconsumed — a
   net's power budget has no meaning yet — so it is neither compared nor an error.
   Several constraints on the same instance are allowed; the smallest applies.
2. **the line's requirement** (`instances` row `power`, a `power` quantity). A
   requirement is a floor on the bought part's capability, i.e. also a ceiling on what
   the design may put there.
3. **the part's rating** (`ratings` row `power`) — visible here only when the board places
   the part itself (`kind: part`). When the board places a **generic**, the part is chosen in
   the procurement layer, which is where its rating belongs: the design check compares the
   stress with the row's requirement, and the procurement check compares that requirement with
   the selected part's rating (ADR-0030 rule 4). One layer each, no hole.

A violation is `design.rating-exceeded` — the same code as the voltage case, because it
is the same finding: the design's stated stress is above a stated limit. The payload
carries `stress_uw`, `limit_uw`, `resistance_uohm`, and the two nets, so an agent can
re-derive the number without re-parsing.

### D4. What could not be compared is counted, in its own note

`design.power-unknown` (note, one per board) reports `k of n resistive instances were
not compared`, split by reason: `not_two_terminal`, `pin_without_net`, `no_window`,
`no_limit`. The denominator is the resistive instances only, so the numbers are about
the population the check could in principle judge — unlike `design.stress-unknown`,
whose denominator is every instance.

**The package convention is not in the language.** A 0402 thick film is 1/16 W, but
nothing tells the checker that, so a design that does not state a `power` requirement
leaves its resistors in `no_limit`. That is deliberate: the convention is device-world
knowledge, so if it should bind, it belongs in the device rule table next to the
construction vocabulary (ADR-0038 D7) — not in 24 instance rows, and not as a hidden
constant in the checker. See the open point and `docs/backlog.md` F42.

### D5. No derating, no tolerance, no temperature

Same as ADR-0043 D3/D5: the check asks "can it take it", never "with how much margin".
Derating is a project policy, and a policy that changes the verdict of a gate belongs in
`project.toml` as a declared factor, which is not decided. The resistance is taken as
the row's nominal value; the tolerance interval is not swept (a ±1% resistor cannot move
a dissipation by more than 2%). Temperature coefficients and ambient ratings are not
modelled — a part's `power` is its datasheet number at its own reference conditions.

## Alternatives considered

**Compute the current from the design** (`current VOUT 3A` ÷ members). Rejected: the
language does not say which member carries it, so any split is an invention, and an
invented current produces invented violations.

**Leave the power constraint unconsumed and delete it from the language.** Rejected:
the constraint is the only place a design can say "this spot may not exceed X" — the
information is real, and the computation is cheap. Deleting a fact because nothing
reads it yet is how languages lose expressiveness.

**Put the 0402 = 1/16 W convention in the checker now.** Rejected for this record: it
is a closed table of package codes (a land-pattern fact) feeding a rating check — a
device-table decision with its own failure mode (unknown package codes, thin vs thick
film, 2010 parts where the design states 1W). It is the right next step, not a detail
of this one.

**Treat a `power` net constraint as a budget over the net's members.** Rejected:
"the net may dissipate 1W" has no defined owner; `current` already waits for the same
missing concept (who carries a net's current).

## Open points

1. ~~**Package → power rating.**~~ **Decided** by
   [ADR-0045](0045-the-package-gives-a-resistor-its-floor.md): the standard (thick-film)
   rating of the JEDEC size is a **floor** under every part the socket could receive, used
   when neither the design nor the part names a limit; the same floor also binds
   procurement (rule 4a), so the two checks cannot disagree.
2. **Series elements and AC paths.** Nothing lets a design mark a position as exempt
   from the DC bound, and the note does not distinguish "no limit declared" from
   "declared inapplicable". If a real design hits this, the fix is a vocabulary word
   (`power ... dc-applicable` or a rule), not a special case in the checker.
3. **Multi-terminal resistive devices** (potentiometers, resistor networks) are counted
   as `not_two_terminal` and skipped; [ADR-0052](0052-a-rating-names-its-terminals.md)
   decides the terminal-pair syntax they will use, but the checker change is still F42 work.

## Consequences

- **The reference project compared nothing when this landed** — the floor of
  [ADR-0045](0045-the-package-gives-a-resistor-its-floor.md) is what made it compare its
  four windowed resistors. The state before the floor, for the record: charger-buck
  `24 of 24` (20 on a net without a window, 4 with no declared limit), mcu-board
  `3 of 3` (3 without a window). That is the honest state of that design, not a
  limitation introduced here — the four instances whose both nets declare windows are
  100k/500k/10k/3.24k divider parts, and the design states no limit for them because
  the package already decides it (D4). The check is exercised by `packages/core`
  tests and by a `power` statement in a scratch copy — that smoke run, on the real
  tree, gave `23 of 24` skipped and compared `M2.R1` at 1.558 mW (VOUT against
  `M2.VFB`) with no violation, and a line stating `1mW` produced the error at the
  instance row with both numbers. The reference gains its first permanent comparison
  when either the design states a limit or the package table of open point 1 lands.
- The two purchased 0402 resistor parts now state their package rating
  (`rc0402fr-0710kl` 62.5 mW, `crc0402fr-0710kl` 63 mW) — a datasheet fact ADR-0039
  puts on the part. Procurement already compares a line's stated roles against the
  part's ratings, so the moment the design requires `power` on a 10k line, the rating
  is what accepts or rejects the candidate.
- A future design that says `power R20.1 63mW` on the 2Ω damping resistor of the
  reference board gets a violation immediately (a bound of ~180W), and is told to
  remove the statement — the D2 caveat is not theoretical, it is one line away in the
  reference project.
