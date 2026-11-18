# ADR-0079: A Colour Has a Closed Vocabulary, and the Set Is Keyed by Role and Quantity

Status: Accepted
Date: 2026-11-18
Scope: Decides: that the colour of an indicator is a closed value set; that the set lives in the tool's device table next to the other closed sets; that the closed sets are keyed by role **and** quantity; and which colours the set holds. Does not decide: whether a project may extend the table locally (`docs/backlog.md` F42's vocabulary question, [ADR-0025](0025-device-vocabulary-and-parameter-roles.md) open points); the colours of a display or a lamp outside the indicator class.
Related: [ADR-0025](0025-device-vocabulary-and-parameter-roles.md) (D5, D7), [ADR-0077](0077-a-jack-and-an-led-are-classes.md) (D2, D3)
Impact: `packages/core/src/devices/rules.ts` (the closed value sets); `packages/parser/src/params.ts`, `packages/parser/src/component.ts` (the value-set checks); `spec/teda.md` §6.2.1, §12.4

## Background

[ADR-0077](0077-a-jack-and-an-led-are-classes.md) made an indicator LED a **class**, and the class's
primary value is a **colour**. A colour is a class, not a quantity: there is no better green, and
570 nm is a different bin rather than a better 565 nm. The class therefore compares for
**equality**.

That decision left the spelling of the colour open, and named the hole:

> **The spelling of a colour is still open.** The `value` of an `indicator` is a plain string, so
> "green" and "GREEN" would be two BOM lines — the failure mode `dielectric`'s closed value set
> exists to prevent.

The failure mode is the one [ADR-0025](0025-device-vocabulary-and-parameter-roles.md) D5 already
describes: the BOM line key is the device id plus the parameter values, so two spellings of one
code are two lines. And it is worse than a second line: the procurement comparison is an equality
([ADR-0077](0077-a-jack-and-an-led-are-classes.md) D3), so a misspelled colour does not merely
split the BOM — it makes the chosen part **unsuitable**, and the report says the value class is not
the one the line asks for.

The hole is not silent in every case: a design that spells the colour one way and the part file
another way is caught by that equality. The silent case is the one that hurts: a design that spells
the colour two ways in two instance rows, with the procurement file copying the spelling, puts one
part in two BOM lines and reports nothing.

## Decision

### D1. The colour set is closed, and it lives in the tool's device table

The set joins `dielectric`'s in `packages/core/src/devices/rules.ts`
([ADR-0025](0025-device-vocabulary-and-parameter-roles.md) D7): a table of device engineering
knowledge, next to the language, not inside it. A member is the only legal spelling — no
normalisation, no aliases — and a value outside the set is an error at the file, with the legal
spellings listed.

The cost is the same cost the construction set already pays and states: the set is global, so a
project that needs a colour the table does not hold waits for a tool upgrade. That is the price of
a vocabulary that is **closed and fails closed**; an open colour vocabulary would produce a wrong
BOM line rather than an error, and a silent miss is worse than an error.

### D2. The closed sets are keyed by role **and** quantity

The sets used to be keyed by role alone, which was right while every set belonged to a role whose
quantity was fixed. The colour set breaks that: `value` is a **capacitance** for a capacitor and a
**colour** for an indicator. One table keyed by the role would have to hold both, and the
capacitor's capacitance would be read as a colour.

So the key is the pair: `dielectric` + `string`, and `value` + `string`. A set applies only to the
values it was written for, and a role without a set for its quantity accepts any text — which is
what a capacitance does.

### D3. The set holds seven colours

`red`, `amber`, `yellow`, `green`, `cyan`, `blue`, `white`.

The set is drawn by one rule: **a member is one colour, and a colour that has two everyday names
is one member, not two.** That is why `orange` is not a member — amber and orange are the same
colour in two spellings, and a set that held both would be the very failure mode a closed set
exists to prevent. The same rule excludes `violet` (purple is the same colour in another word) and
`bicolor` (a two-colour LED is two dies, not a colour).

`white` is a member, but "warm white" and "cool white" are not: those are **bins**, the way 565 nm
is a bin of green, and the bin is what the class's `wavelength` column says
([ADR-0077](0077-a-jack-and-an-led-are-classes.md) D2). The colour says which colour, the
wavelength says which bin.

### D4. Nothing else moves

No language version of its own (the set is a tool-side table), no IR change (a colour is a plain
string in the IR), and no migration script: choosing the member is the author's judgement — the
diagnostic lists the legal spellings, and `GREEN` becomes `green` because that is what the part
says.

The language takes a MINOR step in the same release for an unrelated reason
([ADR-0078](0078-a-polarised-class-names-its-positive-pin.md)), and the changelog says that the
accepted file set shrinks here: a file that spells a colour outside the set is an error from now
on.

## Consequences

- **`green` and `GREEN` are one BOM line, or the second one is an error.** Never two.
- **The set does not normalise.** The file says what it means: the colour is spelled the way the
  class's member list spells it.
- **The value-set check reaches all three places a colour is written** — the instance row, the
  procurement selection and the part's own `value` rating — because all three are read by the same
  column reader.
- **The reference project and the corpus are already inside the set** (`green`), so nothing in the
  tree changes.

## Open Points

- **The table is global.** A project that needs a colour the table does not hold waits for a tool
  upgrade — the same trade the construction set makes, and the same open point
  [ADR-0025](0025-device-vocabulary-and-parameter-roles.md) records for the whole vocabulary.
- **The set is about indicators.** A display, a lamp or a filter has its own colour vocabulary,
  and the table holds none of them yet.
