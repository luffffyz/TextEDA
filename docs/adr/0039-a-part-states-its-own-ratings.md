# ADR-0039: A Part States Its Own Ratings, and the Requirements Stay in the Instance Row

Status: Accepted
Date: 2026-10-23
Related: [ADR-0027](0027-device-parts-families-and-library-dependencies.md), [ADR-0030](0030-procurement-layer.md), [ADR-0037](0037-device-kind-vocabulary-and-one-device-directory.md), [ADR-0038](0038-device-vocabulary-and-parameter-roles.md)
Impact: `spec/teda.md` §6, §13.4; `spec/procurement.md` §3.2, §3.3; `schemas/ir/v0.4/component.schema.json`; `packages/core` (the device vocabulary); `packages/parser` (the `component` description type); `packages/ir` (the diagnostic code registry); `docs/backlog.md` F42

## Background

[ADR-0038](0038-device-vocabulary-and-parameter-roles.md) settled what the numbers in an
`instances` row mean: they are the **design's requirements**, not a copy of a part's datasheet.
`R1 10k ±1%` says "any 10k within ±1%". A part that is *better* than that — a 0.5% part — still
qualifies, so stating a bound does not block substitution; stating a value as a fact does. The
same record settled that a role is a rating and a quantity, and that the vocabulary is closed.

That left one thing undecided, and the two specifications disagreed about it.

[ADR-0030](0030-procurement-layer.md)'s selection row binds a generic line to a purchasable
part. To know whether the part satisfies the line, the comparison needs the part's own ratings:
a ±5% part may fill a "within ±10%" line, a ±2% part may not. The procurement specification
therefore required the part to declare the generic's roles
(`spec/procurement.md` §3.2). But [ADR-0027](0027-device-parts-families-and-library-dependencies.md)
decision 3 closed a part's identity: a part declares no `params`, and the parser enforces it
(`value.component-identity-invalid`). The two rules could not both stand, and the check that
would tell a reader "this 0.5% part is a legitimate substitute for that 10% line" could not be
written at all.

The reason the part declares no `params` is sound and stays: `params` are the columns an
`instances` row fills, and a part has no instance row — a part is named directly, `U1
tps5430ddar`. A part's tolerance is a fact of that part, not a column the design fills. But
"the part has no column to fill" is not the same as "the part has nothing to say", and the second
reading is what the procurement comparison needs.

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

A part that declares `params` is still an error (`value.component-identity-invalid`), and a
generic that declares `ratings` is an error too: a generic is a class, and a class has no
ratings of its own — its requirements live in the instance rows.

### D3. The role vocabulary is the one the instance row uses

A rating is a role from the closed vocabulary of
[ADR-0038](0038-device-vocabulary-and-parameter-roles.md) D1–D2, and its quantity is the one
the vocabulary gives that role. `value` is the exception: a part declares no `construction`, so
the construction's primary quantity is not there to be read — a part states the quantity of its
`value` row itself (a resistor's resistance, a crystal's nominal frequency). A role that the
vocabulary does not know, or a row whose quantity is not the role's, is an error.

The closed value sets apply unchanged: a `dielectric` row must spell a member of the set.

### D4. A rating is a single value

A rating is one number: the highest voltage the part withstands, the current it carries
continuously, the tolerance around its nominal value. A range is not a rating — it is a
requirement the design states on a net (`voltage SYS 9V..19.8V`) or a pair of bounds the
evaluator compares against. Roles that need a range (an integrated circuit's operating voltage
window) are not in the vocabulary yet, and the vocabulary does not grow for them here.

### D5. The comparison the procurement layer needs

A part may fill a generic line when, for every role the line names, the part's rating satisfies
it in that role's direction: an upper bound for `tolerance`, `esr` and `dcr`; a lower bound for
`voltage`, `rated_current` and `sat_current`; equality for `dielectric`; and for `value` the
part's own worst case (its nominal ± its own tolerance) must fall inside the line's envelope.
The directions are in `spec/teda.md` §6.2.1 and `spec/procurement.md` §3.3; the check lands with
the procurement layer ([ADR-0030](0030-procurement-layer.md), `docs/backlog.md` F35).

### D6. The IR carries the ratings

The component shard gains `ratings`, so the IR stays a faithful projection of the file. This is
an additive change to the IR contract: **the IR moves to 0.4**.

## Consequences

- The `component` type's version line moves `0.1.4` → `0.1.5` (PATCH: in the 0.x phase a type
  only moves along PATCH, and adding a section does not make old files invalid).
  `spec/teda.md` §13.4 carries the note.
- The IR contract moves to 0.4: the component shard gained `ratings` (D6). Every other shard is
  unchanged in content; the version string moves with the contract.
- The device vocabulary in `packages/core` gains the global role → quantity map (D3). The
  per-construction table stays: it is the generic's rule table, and a part is not a
  construction.
- `lib:verify` does not check the ratings against anything yet: there is nothing to check them
  against until a part is selected for a line (F35) or the evaluator compares them (F42).
- The reference project gains ratings on the two parts whose datasheet facts are single values:
  the buck converter's maximum input voltage and rated output current, and the crystal's nominal
  frequency. Its integrated circuits keep no ratings: their operating windows are ranges (D4),
  and the repository does not hold vendor datasheets to transcribe from.
- The hole stays visible: a stated rating is not a verified rating, exactly as a stated
  requirement is not a verified one (`docs/backlog.md` F42).

## Open Points

- **The roles an integrated circuit needs.** `voltage` means "the highest voltage it can
  withstand", which is not the same as an operating voltage window, and `rated_current` is a
  thermal limit rather than an output capability. A vocabulary for parts that are not passive
  components is not written here; the passive roles are enough for the substitution check this
  record is about. The closed role table is too thin for real parts in general — the load
  capacitance of a crystal, the threshold voltage of a MOSFET — and it has to grow as a
  versioned vocabulary (`docs/backlog.md` F43).
- **Where a library part's ratings come from.** A vendored part's ratings are transcribed from
  its datasheet; who transcribes them, and how a wrong transcription is corrected, is
  [ADR-0028](0028-library-trust-and-derived-overrides.md)'s territory.
