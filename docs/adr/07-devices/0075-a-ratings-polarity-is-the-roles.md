# ADR-0075: A Rating's Polarity Is the Role's, and a MOSFET's Rating Covers Both Polarities

Status: Accepted
Date: 2026-11-18
Scope: Decides: which polarity of a pair of terminals a rating bounds, and where that fact lives. Does not decide: the vocabulary of roles (a new role is still vocabulary work, [ADR-0025](0025-device-vocabulary-and-parameter-roles.md)); the polarity of a **generic's requirement** (an electrolytic capacitor's `voltage` is still read symmetrically — open point); the derating policy ([ADR-0026](0026-a-part-states-its-own-ratings.md) D14).
Related: [ADR-0025](0025-device-vocabulary-and-parameter-roles.md), [ADR-0026](0026-a-part-states-its-own-ratings.md) (D4, D5, D12, and the open point this record closes), [ADR-0027](0027-the-package-gives-a-chip-resistor-its-floor.md), [ADR-0076](0076-a-parts-dissipation-is-bounded-by-its-stated-current.md)
Impact: `spec/teda.md` §6.2.1, §6.4, §7.3; `packages/core/src/devices/rules.ts` (the role table), `packages/core/src/design/ratings.ts` (the stress comparison); `examples/reference-project` (the input stage's FETs and diodes)

## Background

[ADR-0026](0026-a-part-states-its-own-ratings.md) D5 gave every role a **direction** — `symmetric`,
`from`, `to`, `none` — and the three voltage roles that name a pair got a directed one:
`drain_source_voltage` reads the drain above the source, `gate_source_voltage` the gate above the
source, `reverse_voltage` the cathode above the anode. That was a reasonable reading of a
datasheet, and it left a hole the same record named as an open point:

> A P-channel MOSFET's stress is the opposite polarity: as a high-side switch its drain sits below
> its source, so `drain_source_voltage` never occurs, the checker compares nothing, and the part
> reads as "compared" — while the polarity it really sees has no role at all.

The hole is not cosmetic. A part that was never compared read the same as a part that was
compared and passed, and ADR-0026 D13 ("unknown is counted, not passed") does not apply: the
stress did not merely go unquantified, it was **outside the role** and therefore not counted at
all.

F84 asked the general question behind that hole: **when a rating spans a pair of terminals, does
the number bound one polarity or both?** Three answers were on the table.

1. **The vocabulary grows a role for the other polarity** — a `source_drain_voltage`, a
   `source_gate_voltage`. Every directed pair would need its mirror, and a part would then have
   to state which of the two it is rated for.
2. **A part says which polarity its rating covers** — a new column in the `ratings` row. The
   polarity becomes a fact of the file, repeated in every row of every part that has one.
3. **The role table's direction is the datasheet's convention, and for the MOSFET roles it was
   wrong.**

The third is what the datasheets actually say, and it needs no new syntax, no new role and no
new IR field.

## Decision

### D1. A rating's polarity is the role's, not the row's

Which polarities a rating covers is a property of **what the rating measures**, and it lives in
the role table (`packages/core/src/devices/rules.ts`) — the same place the role's quantity and its
kind live. A `ratings` row does not repeat it, and the language gains no column for it.

This keeps ADR-0026 D5 as it was written ("direction belongs to the role, not to the row") and
keeps the file free of a second copy of a fact that the tool already holds. It also keeps the
decision out of the language: a polarity column would have needed the ADR-0001 rules, a migration
note and a hard case, for a fact the tool can read off the role.

### D2. The two MOSFET roles cover both polarities

`drain_source_voltage` and `gate_source_voltage` are **symmetric**. The datasheets state one
number that bounds the difference in either direction:

| Part | Source | The rating as written | What it bounds |
|---|---|---|---|
| Si7617DN | Vishay 65164 (S15-1032-Rev. B) | `Drain-Source Voltage V_DS -30`, `Gate-Source Voltage V_GS ± 25` | \|V_DS\| ≤ 30 V, \|V_GS\| ≤ 25 V |
| SiS412DN | Vishay 69006 (S09-0135-Rev. C) | `Drain-source voltage V_DS 30 V`, `Gate-source voltage V_GS ± 20 V` | \|V_DS\| ≤ 30 V, \|V_GS\| ≤ 20 V |

`V_GS` is written with an explicit `±`, and `V_DS` is written as a magnitude the way every
MOSFET datasheet writes it. Neither is a statement about one polarity of the channel.

### D3. The diode's reverse rating keeps its one polarity

`reverse_voltage` stays directed (`to`: the cathode above the anode). A diode's reverse voltage
is a **reverse-only** rating: the Diodes Inc sheet for the reference project's B340A gives
`Peak Repetitive Reverse Voltage V_RRM 40 V` for the B340A, and the forward direction is bounded
by a forward voltage, which is a **characteristic** and not a limit (ADR-0026 D6). A symmetric
reading of that role would compare a forward drop with a reverse rating.

### D4. A symmetric role compares both polarities; the polarity that does not occur is still not counted

The mechanics of ADR-0026 D12 stay: the checker reads the role's direction, takes the extreme of
the declared windows (D8) and compares it with the rating. For a symmetric role that means the
larger of the two polarities — `max(|max(a) − min(b)|, |max(b) − min(a)|)` — so the polarity a
part really sees is compared even when the other one does not occur.

What does **not** change: the opposite polarity of a directed role is still neither a violation nor
an unknown (ADR-0026 D12), and a role that is not a voltage stress is still not compared.

### D5. Nothing else moves

The language, the IR contract and both version numbers stay where they are. A rating row already
carried its terminal pair (ADR-0026 D4); what that pair *means* was decided by the role, and this
record corrects what the role said. No file changes shape, no migration is needed, and no case in
the corpus depends on the old reading.

## Consequences

- **The P-channel case is now checked.** The reference project's input stage holds its source at
  the adapter rail and pulls its gate to ground, so the stress across the gate-source pair is the
  polarity the old role could not see; with a symmetric role it is compared with the part's own
  `± 25 V`, and the part is compared rather than merely counted.
- **A symmetric reading of a drain-source rating cannot invent a violation.** In the polarity
  where a MOSFET's body diode conducts, the difference across the pair is clamped to a diode
  drop, so a design that declares that polarity is describing a state the device prevents. Where
  the channel takes the voltage, the datasheet's own number applies. Either way the comparison is
  against the manufacturer's figure.
- **The role table is where a device-world fact lives.** It was already the home of the quantity
  and the kind; the polarity joins them there, and a part file says only *which pair* a rating is
  about.
- **The vocabulary did not grow.** No `source_drain_voltage`, no new column, no new IR field, no
  version bump, no migration.

## Open Points

- **A generic's requirement has no polarity either.** The same hole exists one level down: an
  electrolytic capacitor's `voltage` requirement is read symmetrically, because the language does
  not say which of the generic's two pins is the positive one. A polarized class needs a
  polarity of its own, in the generic's rule table or in the instance row
  (`docs/backlog.md` F85).
- **The body diode is not modelled.** A symmetric drain-source comparison bounds the channel; the
  fact that the other polarity is clamped by a diode is engineering knowledge the tool does not
  carry. The comparison stays conservative because the clamp only makes the real stress smaller
  than the declared one.
