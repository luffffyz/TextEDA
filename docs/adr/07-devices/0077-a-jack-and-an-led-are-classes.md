# ADR-0077: A Jack and an LED Are Classes; a Class-Valued Primary Compares by Equality

Status: Accepted
Date: 2026-11-18
Scope: Decides: that the closed construction set gains `barrel` (a DC barrel jack) and `indicator` (an indicator LED); that the role vocabulary gains `wavelength`; that a class-valued primary is compared for equality when a part is selected; that a `length`-typed parameter is readable and a string-valued rating reaches the IR; and what a part file's `datasheet` field may point at. Does not decide: which spellings a colour may take (open point below); how a polarized class's requirement is read (`docs/backlog.md` F85); which part a project buys ([ADR-0029](0029-the-procurement-layer.md)).
Related: [ADR-0024](0024-the-device-kind-is-part-or-generic.md), [ADR-0025](0025-device-vocabulary-and-parameter-roles.md) (D4, D6, D8), [ADR-0026](0026-a-part-states-its-own-ratings.md) (D3, D6), [ADR-0029](0029-the-procurement-layer.md) (decision 3.2)
Impact: `spec/teda.md` §6.1, §6.1.1, §6.2.1, §6.2.2, §9.2, §12.1, §12.3; `spec/procurement.md` §3.3; `packages/core/src/devices/rules.ts`; `packages/core/src/procurement/rules.ts`; `packages/parser/src/quantities.ts`; `packages/parser/src/component.ts`; `examples/reference-project` (the jack and the indicators)

## Background

The reference project's DC jack was a part: `dc-005-20a`, a Korean Hroparts part, with a
`datasheet` field pointing at a **distributor's purchase page**. Reading the vendor's own
material showed three separate problems.

**The part number was not an identity.** The string `DC-005-20A` appears on two different
drawings — a 2013 one and a 2021 one — with different PCB layouts and different ratings
(0.5 A / 30 V against 3 A / 24 V). On the distributor's site the series name `DC-005` is used
by at least two manufacturers (Hroparts and XKB), each with its own drawing. A part number
that names two different drawings cannot be the identity of a device, and a number copied from
one of them may be the number of the other.

**The vendor's own documents disagree about the part that was chosen.** Xun Pu's product page
for the `DC-005` series states 2 A and 30 V DC; the drawing of the same part states 30 V DC
and 3 A. Both are the vendor's, and they do not agree.

**The design did not want a part.** What the design needs is "a jack that takes a 2.0 mm plug,
carries 2 A and survives 19 V" — a requirement, not a part number. The language already had
the shape for that: `kind: generic` ([ADR-0024](0024-the-device-kind-is-part-or-generic.md)),
and the choice of the part that fills it belongs to the procurement layer
([ADR-0029](0029-the-procurement-layer.md)).

The indicators had the same shape of problem one step smaller. The design wanted "a green
indicator"; the part it named (`led-green`) carried the colour in its **file name** and its
wavelength nowhere. A colour and a wavelength are what the design states; a part number is
what the buyer asks for.

Writing the two classes surfaced two gaps in the vocabulary itself.

- A class whose primary value is a **class** (a colour) has no envelope and no ordering: the
  procurement comparison had no direction for it, and `value` was compared as an envelope.
- The role vocabulary had no way to say **wavelength**, which is a length. The IR contract has
  always allowed a `length`-typed parameter (`length` → nm) — the parser refused it, so the
  contract permitted what the implementation did not.

## Decision

### D1. `barrel`: a DC barrel jack is a class

The closed construction set ([ADR-0025](0025-device-vocabulary-and-parameter-roles.md) D4) gains
`barrel`:

| `construction` | primary | required | optional |
|---|---|---|---|
| `barrel` | `length` | `value` `rated_current` `voltage` | — |

The plug size is the class: 2.0 mm and 2.5 mm are different jacks, because a plug either fits
or does not. The current it carries and the voltage it survives are the two limits a design
states about it, and both are requirements on the part that is bought, so both are required
columns.

### D2. `indicator`: an indicator LED is a class

The same set gains `indicator`:

| `construction` | primary | required | optional |
|---|---|---|---|
| `indicator` | `string` | `value` `wavelength` | — |

The colour is the class's primary value and it is a **code**, not a quantity: there is no
better green, and no tolerance to state. The wavelength says which bin the colour came from —
Lite-On's `LTST-C190GKT` emits at λP = 565 nm — so it is the second required column, measured
in `length`.

### D3. A class-valued primary compares for equality; a wavelength has no better direction

The primary role's comparison direction follows the kind of its value:

| The primary's value | Compared as | Why |
|---|---|---|
| a quantity (resistance, capacitance, length, …) | envelope | the part's worst case must lie inside the line's envelope |
| a class (a colour, a code) | **equality** | there is no better green and no envelope around one |

So `value` for an `indicator` is compared for equality, and the role `wavelength` is compared
for equality too: 570 nm is a different bin, not a better 565 nm. The role itself is a
**characteristic** — nothing stresses an LED at 565 nm — so it never takes part in the voltage
or dissipation comparisons ([ADR-0026](0026-a-part-states-its-own-ratings.md) D6).

The price of this is stated rather than hidden: a second source for an indicator has to be in
the same bin. A 570 nm green LED does not qualify for a 565 nm line.

### D4. A `length`-typed parameter is readable, and a string rating reaches the IR

The IR contract's `param_type` has always listed `length` (→ nm). The parser now reads one: a
length in a parameter column is the metre with its SI prefixes (`nm`, `mm`, `m`). The drawing
units (`mm`, `mil`, `in`) stay with the geometry surface, which parses them itself.

A rating measured in a class reaches the IR in the contract's second shape: `text`, not
`value`. A part can therefore state a colour. Such a rating has no polarity, so it may **not**
name a terminal pair: there is no pair of pins a colour is about, and the IR has nowhere to put
one. The row is refused (`syntax.column-count`) rather than quietly losing two columns.

### D5. The language moves to 0.16.0, and the gate is on the vocabulary member

A new construction and a new role change **which files are legal**: a file that names
`construction barrel` or the role `wavelength` is legal from 0.16 on. That is a MINOR step
([ADR-0002](../01-language/0002-one-language-version-number.md) D5).

The gate is on the **member**, not on the file. A file's version line declares the language
surface it is written against, so a file below 0.16 has no `barrel` and no `wavelength` in its
vocabulary, and naming one is an error (`value.component-construction-invalid`,
`value.component-rating-invalid` — both name the version the member arrived in). The members
that were always in the vocabulary stay valid at every version.

The **quantities** behind the new members are not gated, because they were never illegal: the
IR contract's `param_type` has always listed `length` (D4), and the contract's `rating` union
has always had its `text` shape. A file that names `length` was refused before only because the
parser did not read it. A file that wants a `length` parameter column or a `wavelength`
parameter column wants the `barrel` or the `indicator` construction, and those are gated.

The IR contract does not move: `construction` and the role names are plain strings in the IR,
and `param_type` already had `length`.

### D6. A part file's numbers come from the vendor's own document, and the lower one wins

The `datasheet` field names **the vendor's own document that carries the part's numbers**: the
vendor's product page when that is where the ratings are written, the vendor's PDF when it is. A
distributor's purchase page is not a datasheet — it is a second-hand summary, and its numbers are
the distributor's.

A vendor may publish several documents, and the ones it publishes are not all the same kind. A
mechanical drawing carries the pin table and the land pattern, not the ratings; a product page
carries the ratings. The field names the document the part file's **numbers** were read from, and
the other documents are named in the file's comment and in the project's datasheet index.

When the vendor's own documents disagree about the same part, the part file takes **the lower
number** and says which document each number came from. A design must not sit on the higher of
two numbers a vendor publishes for one part: the lower one is the one both documents agree
survives, and the contradiction is recorded where a reader will meet it
(`examples/reference-project/docs/datasheets.md`).

## Consequences

- **The reference project's jack and indicators are classes.** `dc-jack-th` states a 2.0 mm
  plug, 2 A and 19 V; `led-indicator-0603` states a green LED at 565 nm. The parts that fill
  them are `dc-005-a200` (Xun Pu) and `ltst-c190gkt` (Lite-On), chosen in the procurement
  layer.
- **The adapter's limit is 2 A and the jack's rating is 2 A**, so the requirement and the part
  agree — the check that used to report the jack as under-rated now has nothing to report,
  because the design asks for what the part can carry.
- **A class fixes its land pattern.** A `barrel` class names one land pattern, so a jack with
  another layout cannot be selected for it: that is the procurement rule that a selection may
  not change the land pattern, doing its job.
- **The parser honours the contract.** A `length` parameter works, and a part can state a
  colour.

## Open Points

- **The spelling of a colour is still open.** The `value` of an `indicator` is a plain string,
  so "green" and "GREEN" would be two BOM lines — the failure mode `dielectric`'s closed value
  set exists to prevent ([ADR-0025](0025-device-vocabulary-and-parameter-roles.md) D5). A closed
  colour vocabulary is not decided; the set of colours a class may take is a device-world
  question, and the table that would hold it is global.
- **A polarized class's requirement is still read as a magnitude.** The jack and the LED both
  declare `polarized yes`, and their `voltage` requirement is compared symmetrically across
  their two pins ([ADR-0075](0075-a-ratings-polarity-is-the-roles.md) closed the same hole for
  a part's rating, one level up; `docs/backlog.md` F85 is the same hole one level down).
- **A class states what the design needs, not what is on the shelf.** The wavelength decides
  which bin is bought, and the bin is narrower than "a green LED".
