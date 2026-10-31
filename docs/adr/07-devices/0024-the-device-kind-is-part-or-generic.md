# ADR-0024: The Device Kind Is `part` or `generic`, and the Devices Live in One Directory

Status: Accepted
Date: 2026-10-23
Scope: Decides: the two kinds of device description, where the devices live, and what makes two devices the same device. Does not decide: which part to buy for a generic — see ADR-0029; nor the parameter roles — see ADR-0025.
Related: [ADR-0005](../02-ir/0005-ir-representation.md), [ADR-0007](../02-ir/0007-device-description-enters-the-ir.md), [ADR-0025](0025-device-vocabulary-and-parameter-roles.md), [ADR-0026](0026-a-part-states-its-own-ratings.md), [ADR-0034](../08-libraries/0034-trust-in-a-library-you-do-not-own.md), [ADR-0049](../08-libraries/0049-assets-are-filed-by-what-they-are.md).
Impact: `spec/teda.md` §2, §6, §7.1, §13; `spec/procurement.md`; `schemas/ir/**`; `packages/parser` (the `component` description type); `packages/cli` (the project layout, `texteda init`); `packages/ir` (the diagnostic code registry)

## Background

The `component` description originally had one kind: a device file. Splitting it into a
purchasable part and a device class, and putting the two in two directories, showed two problems
about that split — independently of each other.

**The word.** "Family" is a vendor's word, and it points at the opposite of what we mean. A
family is a set of *specific purchasable parts* that one manufacturer offers: the STM32F4
family, the LM35 family, the TPS7A02 family. Every member of a vendor's family has a manufacturer
part number. Our second kind has none — it names a device *class* ("a 0402 MLCC capacitor, 10 µF,
16 V, ±5 %"), and the part that fills it is chosen later, per project, in the procurement layer.
Calling that a family points the reader at the vendor's catalogue instead of at the design's
requirement.

"Generic" is the word for the thing we actually mean, and the repository already uses it that way:
the package-agnostic land pattern is a *generic* land pattern and its outline a *generic* body;
KiCad ships *generic* symbols (`Device:R`); distributors sell *generic* parts. In every case the
word says the same thing: the description is not bound to one manufacturer's part.

**The directory.** The kind was written twice — once in the file, once in the path — while the
tree is organised by ownership, not by asset kind. A directory that repeats a fact the file
already states is a second source of truth, and it needs a checker to stay honest: the
kind-mismatch diagnostic existed only because the path could disagree with the file. The path also
broke a rule the language had already written down: the top-level directory must match the
description type, and a second directory held `component` files under a name that is not a
description type.

The two problems have one fix each, and both are cheap while the project has no users.

## Decision

### D1. The two kinds are `part` and `generic`

Every `component` file declares `kind`, with exactly two values:

| `kind` | Identity | `mpn` | `params` | Typical instance row |
|---|---|---|---|---|
| `part` | one purchasable device, named by its part number | **required** | absent | `U1 tps5430ddar` |
| `generic` | one device class, named by its construction and its land pattern | **forbidden** | at least one required `value` | `C1 cap-mlcc-0402 10uF 16V` |

The kind is never inferred. The old convention — "a `resistor`, `capacitor` or `inductor` whose
`params` contain `value` may omit `mpn`" — is replaced by the explicit field, and a file that does
not state it is rejected.

`generic` is a statement about the *description*, not about the quality of the device. It says:
this file names a class, and the part that fills it is chosen elsewhere.

### D2. A generic declares its construction and its polarity as facts

A `generic` adds two scalar facts that otherwise exist only implicitly in file names and symbol
choices:

- `construction` — the technology of the device (`tantalum`, `electrolytic`, `mlcc`, `thick`,
  `shielded`, …). It is an open vocabulary, like `category`.
- `polarized` — `yes` / `no`. A polarised generic must declare it, and its pins may carry a
  polarised electrical type so that ERC can detect a reversed part.

A generic's id names the class, not a value: `cap-tantalum-7343`, `res-thick-0402`,
`ind-shielded-6045`. A generic id never carries a value, a tolerance or a rating. The id's middle
token is the construction, so the id and the field never disagree.

### D3. The pin table is the identity boundary

The rule that decides whether two devices are the same device is the pin table:

> **If the pin table changes, it is a different device. Only attributes that do not change the
> electrical behaviour of a pin may become `params`.**

This settles the cases that the part/generic split alone leaves open:

| Difference | Example | Result |
|---|---|---|
| Different pin table | LQFP-100 and LQFP-144 variants of one die | **Two different parts.** A parameter cannot add or remove a pin. |
| Same pin table, different order code | `STM32F407VGT6` vs `STM32F407VGT6/TR` (tape-and-reel) | Two parts, or one part with the ordering code as a `params` value |
| Same pin table, different rating | Same resistor body, 1 % vs 5 % | One **generic**, rating as a `params` value |
| Same pin table, different package body | Same die, same pins, different lead frame | Impossible in practice: a different package means a different pin count |

Two consequences follow.

First, the land pattern is a fixed attribute of a device, never a `params` value: a device
references exactly one `footprint`. The separate `package` field is removed, and the package code
is declared by the footprint itself (see ADR-0028).

Second, `params` may only carry attributes that leave the pin table untouched: a value, a
tolerance, a voltage rating, an ESR, a temperature grade. Anything that changes which pins exist,
or what a pin does, belongs to a different device.

This rule is about **the identity of the device the design intends**, not about the accuracy of a
record. A datasheet transcribed wrongly also "has a different pin table" from the device it
describes; correcting that record is not a new device. Corrections to a library's records are made
by deriving a project-local copy, which is decided in ADR-0034.

The land pattern is part of that identity, and it is a board-domain fact: whether two packages of
one die are functionally interchangeable is a question for the firmware, and this project does not
answer it (see ADR-0029).

### D4. One part per package, with its complete pin table

D3 means that a die offered in several packages produces **one part file per package**, each
carrying its **complete** pin table:

```text
assets/components/mcu/stm32f407vgt6.teda   # kind: part, package LQFP-100, 100 pins
assets/components/mcu/stm32f407zgt6.teda   # kind: part, package LQFP-144, 144 pins
```

The pin table of the LQFP-144 part is not expressed as "the LQFP-100 pins plus 44 more". It is
written out. Two alternatives were considered and rejected:

- **Composing pin tables** — a part that references a base pin table and declares only its
  differences. It removes the mechanical duplication, but it makes `pins` a computed value rather
  than a written one: a reader (or an ERC, or the exporter) has to evaluate the merge to know the
  truth, and the merged result is what nobody wrote down. The duplication this avoids is mechanical
  — the same table copied into N files — and mechanical duplication is a job for a generator and a
  checker, not for the language.
- **One part with several packages** — a part that declares a package-dependent footprint and a
  package-dependent pin table. It keeps the file count down, but it breaks the "one part, one
  package, one footprint" shape, and it forces the BOM row, the footprint binding and the variant
  scope to carry a package dimension.

The accepted cost is that a library holds one file per package variant, and that the pin table of
a die is repeated across those files. The repetition is deliberate and bounded: the tables are
generated from the same source, and a library check can confirm that parts declaring the same die
agree on the pins they share.

### D5. A `part` is the only thing a variant may scope to

Variant DNP and alternation are scoped by `component_id`, which means "this part". That scope is
defined only for `kind: part`. For a `generic`, the scope is the instance: a variant may name the
instance, not the generic. The checker enforces the distinction instead of letting a
generic-wide DNP pass unnoticed.

### D6. The devices live in one directory

`assets/components/**/<component_id>.teda` holds both kinds. The subdirectories under it are
classification, not kinds. There is no second directory for generics.

The id namespace does not change: one namespace, the id is the file name, and a board writes
`cap-mlcc-0402` without saying where the file lives.

### D7. The kind is a fact of the file, never of the path

No tool may derive the kind from a directory, and no directory may imply one. The file states
`kind`; the parser rejects a file that does not state it. The check that compared the kind with
the directory disappears together with the directory.

### D8. A shared library holds both kinds, and its generics are why it is shared

A vendored library carries `component` files of both kinds in one `components/` directory. A
generic is a vendor-neutral fact — "a 0402 thick-film resistor" is the same fact in every project
— so it is exactly what a library is for. The part that realises it is a project-local decision
and lives in the project's procurement layer (see ADR-0029). A library of parts only would be a
parts catalogue, not a device library.

### D9. A library must carry electrical facts; a geometry-only bundle is not a library

A library that contains only footprints and symbols saves the consumer nothing that matters: the
electrical facts (pin numbers, pin names, electrical types) would still have to be written per
part. Such a bundle is a CAD attachment, not a device library, and it is not admitted.

A library must therefore provide, for everything it publishes:

- a `component` (`kind: part` or `kind: generic`) with its `pins` table;
- the `symbol` and the `footprint` it references, with pin numbers and pad numbers aligned.

`pins_source = symbol` remains available for *importing* a third-party symbol library, but it is
not a normal way to publish a TextEDA library.

Library self-consistency is checked by the same tool that checks a project: the three-way alignment
of symbol pin numbers, footprint pad numbers and component pin numbers must hold for every asset
in the library. Library quality is verified, not trusted.

### D10. A part does not declare its die

A part's die is not a fact the language carries. A die is a vendor's internal object: it has no
part number of its own, no datasheet a buyer can order from, and no pin table of its own — the
part's pin table is the die's, plus the package's leads. Carrying it would add a second identity
axis to every part file and a class of facts nobody can check.

Where the die still earns its keep is **outside** the language: a manufacturer's own catalogue,
and the knowledge that two parts share silicon. That knowledge belongs to a project, not to a
device description, and it is recorded as an assembly note — "U1 and U2 are the same silicon" is a
note in the project, not a field in a part file.

### D11. The changes are made directly, and two diagnostic codes change

The project has no external users, so no file exists that would need migrating and no migration
script is written. The change is made directly:

1. `kind family` becomes `kind generic`; the ids, the `construction` values and the `params`
   declarations are untouched.
2. The former generics directory moves into `assets/components/**`, into the subdirectory that
   matches the category.
3. The `component` version moves with the rename, which is breaking, so it rides the PATCH digit.

`value.component-family-fact-invalid` becomes `value.component-generic-fact-invalid`, and the
kind-mismatch code is retired with the check it belongs to. Neither code has been published, so
neither is deprecated: the registry is the source of truth and it changes with the code.

## Consequences

- **A reader of a library no longer sees from the path which files are generics.** The `kind` line
  says it, and it says it in one place.
- **The vocabulary matches the industry.** "Generic" is what the symbol libraries, the CAD
  attachments and the distributors already call these things.
- **The id namespace is one namespace.** A bare id resolves the same way whichever kind it names.
- **The pin table is the identity boundary**, and the checks that follow from it are mechanical:
  the compiler rejects a `params` column that would change a pin.
- **A generic's requirements live in the instance rows**, and the part that satisfies them is
  chosen per project — so a design can be re-sourced without touching the device description.
- **The project tree loses a directory**, and with it the diagnostic that existed only to keep the
  path and the file in agreement.
- **A library of parts only is not a device library**, and the library check says so.
- **A die is not a fact we carry.** The project that cares about shared silicon writes an
  assembly note.
