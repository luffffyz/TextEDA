# ADR-0078: A Polarised Class Names Its Positive Pin, and Its Requirement Is Read in That Direction

Status: Accepted
Date: 2026-11-18
Scope: Decides: that a polarised generic names its positive pole (`positive_pin`); that the poles of a class are the pins typed `polarized`; that the class's voltage requirement is compared in the class's own direction, and the opposite direction is a reversal rather than a magnitude; that the language moves to 0.17.0 and the IR contract to v0.21. Does not decide: whether the procurement layer compares the polarity of a class with the polarity of the part bought for it ([ADR-0029](0029-the-procurement-layer.md), `docs/backlog.md` F89); the derating policy ([ADR-0026](0026-a-part-states-its-own-ratings.md) D14).
Related: [ADR-0024](0024-the-device-kind-is-part-or-generic.md) (D2), [ADR-0025](0025-device-vocabulary-and-parameter-roles.md) (D7), [ADR-0026](0026-a-part-states-its-own-ratings.md) (D8, D12, D13), [ADR-0075](0075-a-ratings-polarity-is-the-roles.md) (the same hole one level up), [ADR-0077](0077-a-jack-and-an-led-are-classes.md) (D2)
Impact: `spec/teda.md` §6.1, §6.1.1, §6.2.1, §6.3, §7.3, §12.1, §12.3, §12.4; `packages/parser/src/component.ts`, `packages/parser/src/version.ts`; `packages/core/src/design/ratings.ts`, `packages/core/src/devices/rules.ts`; `packages/cli/src/check.ts`, `packages/cli/src/project.ts`; `schemas/ir/v0.21/**`; `examples/reference-project` (the jack, the tantalum capacitor, the indicator)

## Background

[ADR-0075](0075-a-ratings-polarity-is-the-roles.md) closed the polarity hole one level up: a
**part's** rating says which polarity of a pair of terminals it bounds, and the direction lives in
the role table. It left the same hole one level down, and named it:

> A generic's requirement has no polarity either. The same hole exists one level down: an
> electrolytic capacitor's `voltage` requirement is read symmetrically, because the language does
> not say which of the generic's two pins is the positive one.

The file knows more than the check does. A generic declares `polarized yes | no`
([ADR-0024](0024-the-device-kind-is-part-or-generic.md) D2), and its poles are typed `polarized`
in the pin table: `1 P polarized` and `2 N polarized` in `cap-tantalum-7343`, `1 TIP polarized`
and `2 SLEEVE polarized` in `dc-jack-th`. The design says which of the two pins is the positive
one; nothing read it, and the stress check compared the requirement as a **magnitude** across the
two pins (`packages/core/src/design/ratings.ts`, the generic branch of `stressFactsOf`:
`direction: "symmetric"`).

That reading is wrong in a way that hides a real failure. A tantalum capacitor with 10 V on `P`
and 0 V on `N` is within its requirement; the same capacitor with 10 V on `N` is destroyed. The
magnitude is the same number in both cases, so the comparison says the same thing about a mounted
part and about a reversed one — and the report says "compared" either way. A wrong check is worse
than no check: the design reads as verified.

Three shapes were on the table.

1. **The class says which pin is positive.** The polarity of a class is a device-world fact, and
   it belongs where the class is described — the same reasoning as [ADR-0075](0075-a-ratings-polarity-is-the-roles.md)
   D1, where a rating's polarity belongs to the role.
2. **The instance row states the polarity.** `voltage` plus a polarity column. Cost: the same
   fact repeated in every row of every polarised instance, and a column the language would have
   to define, migrate and pin with a hard case.
3. **A role for the reversed polarity.** Vocabulary work rather than a comparison change
   ([ADR-0025](0025-device-vocabulary-and-parameter-roles.md)); and a requirement is not a rating,
   so the roles of `spec/teda.md` §6.2.1 may not be the right home for it.

## Decision

### D1. The class names its positive pole

A generic states which of its two poles is the positive one with a new scalar:

```text
kind         generic
construction tantalum
polarized    yes
positive_pin  1
```

The scalar is a **generic** fact, like `construction` and `polarized` before it: a part inherits
its polarity from the class it is bought for ([ADR-0024](0024-the-device-kind-is-part-or-generic.md)
D2), so a part that declares `positive_pin` is an error.

The class is the right home because the polarity is a fact about the **device**, not about a use
of it. The same tantalum capacitor is mounted the same way round in every board; what differs
between two designs is which net sits on which pole, and that is what the **schematic** says.
Putting the polarity in the instance row would repeat a device fact in every row of every board,
and the rows are where the mistakes are made.

### D2. The poles are the pins typed `polarized`, and there are exactly two

The pin table already says which pins are poles: a pin typed `polarized` cannot be interchanged
with the other one, and a pin typed `passive` does not say which way round it is. So the class's
poles are the pins typed `polarized`, and `positive_pin` names which of the two is the positive
one. A class that types one pole, or three, has no pair to compare across and is an error
(`value.component-positive-pin-invalid`).

This is why the scalar is a **pin number** and not a "polarity pair": the pair is already in the
file, in the pin table, and a second copy of it would be a second source for a fact.

### D3. The requirement is read in the class's direction, and the opposite direction is a reversal

A polarised class's `voltage` requirement bounds the voltage **in the class's own direction**: the
positive pole above the negative one. The check therefore compares two things across the two
poles:

| | What is compared | When it is reported |
|---|---|---|
| the **forward** stress | the extreme of `V(+) − V(−)` against the class's requirement | `design.rating-exceeded` — the requirement does not cover the stress |
| the **reverse** stress | the extreme of `V(−) − V(+)`, against zero | `design.polarity-reversed` — the design may drive the part backwards |

The reverse stress is not a second magnitude to compare with the requirement: a requirement of
10 V on a tantalum capacitor does not say "10 V in either direction". It says the part survives
10 V **the way round it is meant to be**. A reverse stress above zero is a part mounted the wrong
way round, and it is an error of its own.

The magnitudes are the same number in both directions, so the two comparisons are not redundant:
the forward one asks "is the requirement enough", the reverse one asks "is it the right way round".
The unpolarised case is untouched: its requirement stays a magnitude across its two pins.

The rule for the *part* level is unchanged ([ADR-0075](0075-a-ratings-polarity-is-the-roles.md)):
a part states its own ratings, the role says which polarity those ratings bound, and a part that
bounds no polarity is still compared as a magnitude.

### D4. The language moves to 0.17.0 and the IR contract to v0.21

`positive_pin` is a new field, so the language takes a MINOR step
([ADR-0002](../01-language/0002-one-language-version-number.md) D5). A file's version line declares
the language surface it is written against, so a file below 0.17 may not name a positive pin, and
a polarised class written against an older language says only that it is polarised: its
requirement is then read as a magnitude, the way the language read it before. The gate is on the
**fact**, not on the file — an unrelated file does not have to move.

The IR contract moves because the shard has to carry the fact: `component.positive_pin` is a new
optional field in `schemas/ir/v0.21/component.schema.json`. `v0.20` is unchanged.

## Consequences

- **A reversed part is now an error.** The report names both nets, both windows and both poles,
  so the reader can see which way round the part is.
- **The reference project's jack is compared for the first time.** It has three contacts, so the
  old two-pin inference could not pair its `voltage` requirement with two nets and the instance
  was counted as unknown; the poles are `TIP` and `SLEEVE`, and the requirement is compared
  across them. The coverage of the reference project goes from 28 of 83 instances to 29.
- **The tantalum capacitor's requirement is read in its own direction**, so a part mounted the
  wrong way round in `M2.C3` would be reported rather than compared as a magnitude.
- **A polarised class states one more fact.** The cost is a scalar and a version step; the
  benefit is that the check stops guessing.
- **The corpus gains a case.** `examples/cases/polarized-class/` pins the scalar, the IR field and
  the forward comparison. The reversal itself is an error, and an error does not belong in the
  corpus — it is pinned by a unit test (`packages/core/test/ratings.test.ts`).

## Open Points

- **The procurement layer does not compare polarities.** A class says which way round its part
  goes, and a part bought for it says so in its own pin table, but nothing compares the two: a
  part with the same footprint and the opposite polarity can still be selected
  (`docs/backlog.md` F89).
- **A polarised part that states no directed rating is compared as a magnitude.** The part's own
  ratings are the part's business ([ADR-0026](0026-a-part-states-its-own-ratings.md)), and a part
  that bounds no polarity has said nothing about which way round it is. Whether a part may name
  its positive pole is not decided.
- **The two windows may overlap.** When both nets' windows overlap, the design may drive the part
  either way, and the reversal is reported. That is the honest reading of the declared windows,
  but a design that intends a symmetric drive has to say so in the windows.
