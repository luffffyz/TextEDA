# ADR-0125: A Part States Its Own Ratings, and They Are Checked Against Declared Windows

Status: Accepted
Date: 2026-10-26
Scope: Decides: where a part's ratings live, how they are compared against a design's declared windows, and how a multi-terminal rating names its stress. Does not decide: the current check — a net's current is not attributed to its members yet; nor the derating policy — see the open points below.
Related: [ADR-0123](0123-the-device-kind-is-part-or-generic.md), [ADR-0124](0124-device-vocabulary-and-parameter-roles.md), [ADR-0126](0126-the-package-gives-a-chip-resistor-its-floor.md)
Impact: `spec/teda.md` §6.2.1, §6.4, §7.4; `spec/procurement.md` §3.2, §3.3; `schemas/ir/**`; `packages/core` (the rating checks); `packages/parser` (the `component` description type); `packages/ir` (the diagnostic code registry)

## Background

The device vocabulary record settled what the numbers in an `instances` row mean: they are the
**design's requirements**, not a copy of a part's datasheet. `R1 10k ±1%` says "any 10k within
±1%". A part that is *better* than that — a 0.5% part — still qualifies, so stating a bound does
not block substitution; stating a value as a fact does.

That left one thing undecided, and the two specifications disagreed about it. The procurement
layer's selection row binds a generic line to a purchasable part. To know whether the part
satisfies the line, the comparison needs the part's own ratings: a ±5% part may fill a "within
±10%" line, a ±2% part may not. The procurement specification therefore required the part to
declare the generic's roles. But the device-kind record closed a part's identity: a part declares
no `params`, and the parser enforces it. The two rules could not both stand, and the check that
would tell a reader "this 0.5% part is a legitimate substitute for that 10% line" could not be
written at all.

The reason the part declares no `params` is sound and stays: `params` are the columns an
`instances` row fills, and a part has no instance row — a part is named directly, `U1
tps5430ddar`. A part's tolerance is a fact of that part, not a column the design fills. But "the
part has no column to fill" is not the same as "the part has nothing to say", and the second
reading is what the comparison needs.

Then a second gap: the language could state two things and never compare them. A design states a
**window** on a net: `voltage SYS 9V..19.8V`. A device states a **limit**: a generic's `params`
carry the specification the design needs, and a part carries its own ratings. The checker enforced
that the columns are present but never asked whether `16V` covers the rail it sits on. So "the
design declares a maximum" and "the part can take it" were two sentences in the same repository
that no tool put next to each other. The power review of the reference board had to compute the
derating of a 3 A regulator by hand, and the note it left ("`current VOUT 3A` equals TPS5430's own
`rated_current 3A`") is exactly a fact a machine can check.

Comparing facts with requirements needs decisions that a checker cannot make on its own: at which
point of the window, which parts count as related, and what "no margin" means. And the two-terminal
model is deliberately narrow: a diode's reverse voltage and an LED's forward drop are not "the
voltage across any two pins", and a rating that silently picked one of two pins is an ambiguity
the language refuses elsewhere.

## Decision

### D1. A part states its own ratings in a `ratings` section

A `component` file of kind `part` may carry a `ratings` section: one row per rating, with the
role, its quantity, and the value.

```
version 0.1.5
component tps5430ddar
kind part
mpn TPS5430DDAR
symbol project:ind-3
footprint project:sot-23-5

ratings
  tolerance  percent  2%
  voltage    voltage  36V

pins
  1  GND  power_in
  2  SW   output
  3  VIN  power_in
```

The section is a **fact section**, like `pins`: it states what this part is, it is not a column
list, and it does not change the part's identity. A part with a `ratings` section and the same
pin table is the same device as one without it.

### D2. `params` stays forbidden for a part

The two sections do different jobs and stay apart:

| | `params` | `ratings` |
|---|---|---|
| Whose | the design's | the part's |
| What it is | the columns an `instances` row fills | the values this part has |
| Filled by | the board (one value per instance) | the part file (one value per rating) |
| Kind | `generic` only | `part` only |

A part that declares `params` is still an error, and a generic that declares `ratings` is an error
too: a generic is a class, and a class has no ratings of its own — its requirements live in the
instance rows.

### D3. The role vocabulary is the one the instance row uses

A rating is a role from the closed vocabulary, and its quantity is the one the vocabulary gives
that role. `value` is the exception: a part declares no `construction`, so the construction's
primary quantity is not there to be read — a part states the quantity of its `value` row itself (a
resistor's resistance, a crystal's nominal frequency). A role that the vocabulary does not know, or
a row whose quantity is not the role's, is an error. The closed value sets apply unchanged: a
`dielectric` row must spell a member of the set.

A rating is one number: the highest voltage the part withstands, the current it carries
continuously, the tolerance around its nominal value. A range is not a rating — it is a
requirement the design states on a net or a pair of bounds the evaluator compares against. Roles
that need a range (an integrated circuit's operating voltage window) are not in the vocabulary
yet, and the vocabulary does not grow for them here.

### D4. A rating row may name its two terminals after the value

The `ratings` table keeps its existing three columns and gains an **optional** ordered pair:

```
ratings
  voltage          voltage  36V    1 2
  reverse_voltage  voltage  40V    A K
```

| Column | Meaning |
|---|---|
| `role` | A role from the closed vocabulary, exactly as before |
| `type` | The role's quantity, exactly as before |
| `value` | The rating, exactly as before |
| `from` | Optional; a **pin number** of this device |
| `to` | Optional; a **pin number** of this device, different from `from` |

The table has either three columns or five. Four columns is an error, and so is a terminal
reference that is not in the component's pin table. Pin **names** are not accepted: a name may be
reused (`GND`, `OUT` on a multi-unit part), and a rating that silently picked one of two pins is
the ambiguity `ref.ambiguous-pin` already refuses elsewhere.

The pair is ordered. `from` then `to` is the direction the role's definition reads; it is not
alphabetical and not inferred from the net order.

### D5. Direction belongs to the role, not to the row

A row does not repeat `symmetric` / `forward` / `reverse`. The role table gains a **direction**
column with four values:

| Direction | Stress read from a declared window pair | Meaning |
|---|---|---|
| `symmetric` | `\|V_from − V_to\|` | Either polarity stresses the part (a capacitor, a resistor) |
| `from` | `V_from − V_to`, only when non-negative | The part is stressed when `from` is above `to` |
| `to` | `V_to − V_from`, only when non-negative | The part is stressed when `to` is above `from` |
| `none` | not a voltage stress | The role is a limit of another quantity, or not a boundary at all |

The sign convention is the role's definition, not a second fact in the file. `reverse_voltage`
names `from = anode`, `to = cathode` and uses `to`: the stress is the cathode above the anode.
`drain_source_voltage` names `from = drain`, `to = source` and uses `from`.

### D6. The role table also carries `kind`

The same role table gains a **kind** column:

| Kind | Meaning | May a stress check consume it? |
|---|---|---|
| `limit` | A boundary the design must stay inside (`voltage`, `power`, `rated_current`, `tolerance`, …) | Yes, when it has a direction and terminals |
| `characteristic` | A property used to choose or describe a part (`value`, `esr`, `dcr`, a future `rds_on`) | No; it is not "must not exceed" |
| `code` | A closed code (`dielectric`) | No |

`kind` is metadata in the role table (`packages/core` is the source of truth; `spec/teda.md` §6.2.1
is the published table). It is **not** a new `ratings` column and not a new IR field: the role
already names the row, and a second copy of its kind in every file would drift.

This does not add every future role. It fixes the two pieces of metadata a role needs before it
can enter a stress check; adding a role remains vocabulary work, with the role's name, quantity,
kind and direction decided together.

### D7. No terminals means a device-level rating

A three-column rating remains legal and keeps its meaning: the number applies to the device as a
whole. It is usable by the two-terminal voltage check exactly as before, because a two-pin device
has only one pair of terminals. It is **not** a multi-terminal stress fact.

- A two-pin part may omit `from` / `to`, and existing files stay valid.
- A two-pin part may state the pair explicitly; it must then be its two pins, in either order for
  a `symmetric` role.
- A part with three or more pins that states a `limit` without terminals is **not compared** and is
  counted as unknown (D13), not treated as a pass.
- A `characteristic` or `code` rating may still state terminals as documentation, but no stress
  check consumes it.

This is the compatibility rule, and it is also the honest one: a number whose terminals are not
stated cannot be checked against a pair of nets.

### D8. Worst case over the declared window, never nominal

A window is the design's promise about the range it will be operated in. A part that survives
only the nominal point is a part with an unexamined failure. The comparison therefore takes the
**endpoint of the window that stresses the fact** — the maximum for a voltage capability, the
maximum for a current rating — and never the mid-point.

There is no separate "nominal" mode to select: the window is already the design's stated
envelope, and its endpoints are what the design claims to tolerate.

### D9. Parts are independent

The language cannot state that two parts drift together (a matched pair, a common reference).
Until it can, an evaluation is **per part**, and no tolerance is applied to either side:

- a **fact** (a rating) is a limit, not a distribution — derating it by the part's tolerance would
  invent a second, unstated limit;
- a **requirement** (a declared window) is used as written; widening it by the tolerances of the
  parts that produce it would require the correlation the language cannot express.

Two resistors at `±1%` are therefore each compared at their stated value, not at opposite ends.

### D10. A two-terminal device sees the difference of the declared potentials

The stress of a capacitor is the voltage **across** it, not the potential of either net. So for a
two-terminal device with a `voltage` capability, the stress is the difference between the two
nets' declared windows, at its extreme:

`stress = max(|max(a) − min(b)|, |max(b) − min(a)|)`

A net's window is its declared `voltage` constraint. A net with no declared window has an
**unknown** potential, and the device is not compared (D10).

**The frame has one origin, and the design declares it.** The tool does not assume that a net
called `GND` is 0 V: a board with a split ground or an isolated converter has more than one
reference, and a checker that guesses would be confidently wrong. The origin is stated like any
other potential, `voltage GND 0V..0V`, and until it is stated the devices around it are simply
unknown. Two independent frames are not representable yet, and that is honest — a design with an
isolated domain will see its devices reported as not compared, rather than silently compared
against the wrong reference.

### D11. Dissipation is bounded by `ΔV² / R`

`power` has been a constraint type and a parameter role since the vocabulary record, and nothing
consumed either: a language that can say "this resistor must not dissipate more than 63mW" and
never looks at it is a comment with syntax. The gap matters most where the language is thinnest:
in a power path (2Ω damping, 10mΩ sense, 10Ω gate supply) **power is the first limit reached, not
voltage**. Voltage alone checks nothing there: a 2Ω part across a 19V rail is fine at 19V and
would burn 180W.

A resistive device is a device whose primary quantity is `resistance` — its own `value` column (a
generic) or its `value` rating (a part) — and which has exactly two pins. Its worst-case
dissipation is

`P = stress² / R`, with `stress = max(|max(a) − min(b)|, |max(b) − min(a)|)`

the same expression and the same windows D8 and D9 use for voltage.

No current is computed. The language cannot say who carries the current of a net, so an ohmic
bound is the only one that needs no invention.

**It is a bound, so it can report a violation, never prove a pass.** The bound assumes both nets
reach their window extremes at the same time. Two nets with the same window yield `0`, while a
real part between them may dissipate: the number is a ceiling, not a measurement. A pass is "no
error reported", not "verified safe". And an element between two declared windows whose
dissipation is **not** a DC quantity — the series resistor of an RC snubber, a damping element —
gets a meaningless bound; such a position must not be given a dissipation ceiling in the first
place.

**Every declared bound binds; the tightest wins.** The three sources are upper bounds on the same
quantity, so the comparison takes the minimum and reports which one bound:

1. **the design's ceiling** (`power <pin> <max>`). Its subject must be a **pin** reference
   (`R1.1`, `M1.R1.1`): dissipation belongs to an instance, not to a net. A `power` constraint on
   a net is grammatically legal and semantically unconsumed, so it is neither compared nor an
   error. Several constraints on the same instance are allowed; the smallest applies.
2. **the line's requirement** (the `power` column of the instance row). A requirement is a floor
   on the bought part's capability, i.e. also a ceiling on what the design may put there.
3. **the part's own rating** (its `ratings` `power` row) — a datasheet fact.

### D12. The Checker Reads Explicit Terminal Pairs, and Counts the Unknowns

The voltage check:

1. reads the role's `direction` and `kind` from the role table;
2. for each `limit` rating with a direction other than `none`:
   - with terminals, looks up the two pins' nets and computes the stress in the role's direction;
   - without terminals, keeps the two-pin inference (D7);
3. compares the extreme of the declared windows, not the nominal point (D8);
4. counts an unknown (missing window, pin not on a net, no terminals on a multi-pin part) as
   unknown (D13), never as a pass;
5. never compares a `characteristic` or a `code` as a boundary.

For a directed role, the opposite polarity is not a violation and is not counted as "not
compared": it is outside the stress the role describes. A diode reverse rating does not fire on a
forward-biased junction.

### D13. Unknown is counted, not passed

A device that is not compared is not a device that passed. Every board gets one `note` naming how
many instances were not compared and why (more than two pins and no named terminals, no declared
window on one of its nets, no declared capability). One note per board, not one per instance: a
board with thirty undecided rails would otherwise bury its real findings.

This is the same policy the binding layer already applies to a missing description.

### D14. Derating is project policy, not a checker constant

The checker reports **violations** — a capability below the stated window — and nothing else. It
does not apply an 80 % factor, because the right factor depends on the part class, the
environment and the house standard, and a tool that picks one silently makes every design that
did not ask for it non-compliant.

A design that wants a margin states it (a lower window on the net, or a procurement rule); the
checker's job is the boundary it can prove.

### D15. The rating rules get their own diagnostic domain

The rating rules go in their own `design` domain rather than into an existing one, because
adding a domain needs a record of its own:

- not `syntax` / `value` — nothing is misspelled or mistyped;
- not `net` — connectivity is correct and the design is still unsound;
- not `drc` — that is the physical layer's geometry (clearance, annulus), decided from
  footprints, not from ratings;
- not `bind` — binding is agreement *between descriptions*; this is agreement between a
  description and the parts it is built from.

### D16. The comparison the procurement layer needs

A part may fill a generic line when, for every role the line names, the part's rating satisfies
it in that role's direction: an upper bound for `tolerance`, `esr` and `dcr`; a lower bound for
`voltage`, `rated_current` and `sat_current`; equality for `dielectric`; and for `value` the
part's own worst case (its nominal ± its own tolerance) must fall inside the line's envelope.

### D17. The IR carries the ratings

The component shard gains `ratings`, so the IR stays a faithful projection of the file. This is an
additive change to the IR contract.

## Consequences

- **A part can now be checked against a design.** The gap that made the check unwritable — the
  part had no column to fill and therefore nothing to say — is closed by a separate section that
  says what the part is.
- **The `params` / `ratings` split is mechanical to check.** The two sections have disjoint
  owners and disjoint kinds, so a file that mixes them is an error with a clear message.
- **The device vocabulary in `packages/core` gains the global role → quantity map.** The
  per-construction table stays: it is the generic's rule table, and a part is not a construction.
- **A rating is a limit, and a window is a requirement.** The two are compared in the role's
  direction, so the check is a comparison and not a guess.
- **The multi-terminal model is explicit.** A rating names its terminals; the role names the
  direction; a two-terminal device is the special case where the terminals are the two pins.
- **The reference project's power path becomes checkable.** The dissipation bound is what the
  manual derating note was doing by hand.
- **A stated rating is not a verified rating**, exactly as a stated requirement is not a verified
  one. The hole stays visible.
- **The library check does not check the ratings against anything yet**: there is nothing to check
  them against until a part is selected for a line, or the evaluator compares them.

## Open Points

- **Current.** A net's current is shared by its members; a part sees the current through its own
  pins, which the language does not state yet. The current check stays undefined.
- **Derating as a project policy.** Whether the project should be able to state a derating policy
  once, in `project.toml`, is open; the checker deliberately does not pick a factor.
- **Matched pairs.** Stating that two parts drift together needs its own construct.
