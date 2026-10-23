# ADR-0037: The Device Kind Is `part` or `generic`, and the Devices Live in One Directory

Status: Accepted
Date: 2026-10-23
Related: [ADR-0027](0027-device-parts-families-and-library-dependencies.md), [ADR-0029](0029-package-code-footprint-and-3d-model-ownership.md), [ADR-0030](0030-procurement-layer.md), [ADR-0031](0031-project-tree-ownership-model.md), [ADR-0022](0022-language-versioning.md)
Impact: `spec/teda.md` §2, §6, §7.1, §13.1, §13.4; `spec/procurement.md`; `schemas/ir/v0.3/component.schema.json`; `packages/parser` (the `component` description type); `packages/cli` (the project layout, `texteda init`); `packages/ir` (the diagnostic code registry); `scripts/lib/project.ts`; `scripts/verify-libs.ts`; `examples/reference-project/`; `docs/skills/new-project.md`; `AGENTS.md` §4.5, §9, §12; `docs/backlog.md` F25

## Background

[ADR-0027](0027-device-parts-families-and-library-dependencies.md) split the `component`
description into two kinds and put them in two directories: `assets/components/` held the parts,
`assets/families/` held the families. Two things about that split were wrong, independently of
each other.

**The word.** "Family" is a vendor's word, and it points at the opposite of what we mean. A
family is a set of *specific purchasable parts* that one manufacturer offers: the STM32F4
family, the LM35 family, the TPS7A02 family. Every member of a vendor's family has a
manufacturer part number. Our second kind has none — it names a device *class* ("a 0402 MLCC
capacitor, 10 µF, 16 V, ±5 %"), and the part that fills it is chosen later, per project, in the
procurement layer ([ADR-0030](0030-procurement-layer.md)). Calling that a family points the
reader at the vendor's catalogue instead of at the design's requirement.

"Generic" is the word for the thing we actually mean, and this repository already uses it that
way: [ADR-0029](0029-package-code-footprint-and-3d-model-ownership.md) calls the
package-agnostic land pattern a *generic* land pattern and its outline a *generic* body; KiCad
ships *generic* symbols (`Device:R`); distributors sell *generic* parts. In every case the word
says the same thing: the description is not bound to one manufacturer's part.

**The directory.** The kind was written twice — once in the file, once in the path — while the
tree is organised by ownership, not by asset kind
([ADR-0031](0031-project-tree-ownership-model.md)). A directory that repeats a fact the file
already states is a second source of truth, and it needs a checker to stay honest:
`ref.component-kind-mismatch` existed only because the path could disagree with the file. The
path also broke a rule the language had already written down: the top-level directory must match
the description type (`spec/teda.md` §2), and `assets/families/` held `component` files under a
name that is not a description type.

The two problems have one fix each, and both are cheap while the project has no users.

## Decision

### D1. The two kinds are `part` and `generic`

`kind` takes exactly two values:

| `kind` | Identity | `mpn` | `params` | Typical instance row |
|---|---|---|---|---|
| `part` | one purchasable device, named by its part number | **required** | absent | `U1 tps5430ddar` |
| `generic` | one device class, named by its construction and its land pattern | **forbidden** | at least one required `value` | `C1 cap-mlcc-0402 10uF 16V` |

Everything else about the split stays as [ADR-0027](0027-device-parts-families-and-library-dependencies.md)
decided it: a generic declares its `construction` and whether it is `polarized`; a generic's id
never carries a value, a tolerance or a rating; the pin table is the identity boundary; a part
is the only thing a variant may scope to.

`generic` is a statement about the *description*, not about the quality of the device. It says:
this file names a class, and the part that fills it is chosen elsewhere.

### D2. The devices live in one directory

`assets/components/**/<component_id>.teda` holds both kinds. The subdirectories under it are
classification, not kinds. There is no `assets/families/`.

The id namespace does not change: one namespace, the id is the file name, and a board writes
`cap-mlcc-0402` without saying where the file lives.

### D3. The kind is a fact of the file, never of the path

No tool may derive the kind from a directory, and no directory may imply one. The file states
`kind`; the parser rejects a file that does not state it. The check that compared the kind with
the directory disappears together with the directory.

### D4. A shared library holds both kinds, and its generics are why it is shared

A vendored library ([ADR-0027](0027-device-parts-families-and-library-dependencies.md)
decision 7, [ADR-0028](0028-library-trust-and-derived-overrides.md)) carries `component` files of
both kinds in one `components/` directory. A generic is a vendor-neutral fact — "a 0402
thick-film resistor" is the same fact in every project — so it is exactly what a library is for.
The part that realises it is a project-local decision and lives in the project's procurement
layer ([ADR-0030](0030-procurement-layer.md)). A library of parts only would be a parts
catalogue, not a device library.

### D5. The files change directly, and the note lives in the spec

The project has no external users, so no file exists that would need migrating and no migration
script is written ([ADR-0031](0031-project-tree-ownership-model.md)'s addendum of 2026-10-23).
The change is made directly:

1. `kind family` becomes `kind generic`; the ids, the `construction` values and the `params`
   declarations are untouched.
2. `assets/families/**` moves into `assets/components/**`, into the subdirectory that matches
   the category.
3. The `component` version line moves from `0.1.2` to `0.1.3` — the rename is breaking, so it
   rides the PATCH digit of the `component` line
   ([ADR-0022](0022-language-versioning.md)).
4. The note lives in `spec/teda.md` §13.4.

The IR contract is v0.3, which is not published; it is amended in place. The `kind` enum becomes
`["part", "generic"]` and the descriptions follow. No v0.4 is needed.

### D6. Two diagnostic codes change

`value.component-family-fact-invalid` becomes `value.component-generic-fact-invalid`, and
`ref.component-kind-mismatch` is retired with the check it belongs to. Neither code has been
published, so neither is deprecated: the registry is the source of truth and it changes with the
code.

## Consequences

- A reader of a library no longer sees from the path which files are generics. The `kind` line
  is two lines below the header, and `rg 'kind generic'` finds them.
- The reference project's device tree is one tree: 22 devices, 16 parts and 6 generics.
- Nothing else in the model moves. The procurement layer still binds a generic to a part; the
  variant layer still scopes to parts only; the BOM still keys a generic line by its id and its
  parameters.

## Open Points

- **The `construction` vocabulary is open.** `mlcc`, `tantalum`, `thick`, `film`, `shielded`, …
  are free text today. A closed list would let a checker require the right envelope and the
  right body ([ADR-0029](0029-package-code-footprint-and-3d-model-ownership.md)); an open list
  lets a project name a construction the vocabulary does not know. Not decided.
- **Is `category` still needed next to `construction`?** A generic always has a category; a part
  often has one. The field only classifies today, and after the split it may carry nothing that
  `kind` plus `construction` does not already say. Not decided.
