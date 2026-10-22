# ADR-0029: The Package Code Lives in the Footprint; 3D Models Belong to Parts; Assembly Constraints Are Out of Scope

Status: Accepted
Date: 2026-10-22
Related: [ADR-0010](0010-footprint-and-3d-model-ownership.md), [ADR-0011](0011-library-format-and-footprint-ir.md), [ADR-0027](0027-device-parts-families-and-library-dependencies.md), [ADR-0004](0004-ir-representation.md)
Impact: `teda.md` §6 (the `component` description type); `spec/footprint.md` (a `package_code` field); `schemas/ir/v0.2/component.schema.json`, `schemas/ir/v0.2/footprint.schema.json`; `packages/parser` (the `component` and `footprint` parsers); `packages/exporter` (the footprint export needs a part context); `AGENTS.md` §4.5, §9; `examples/reference-project/`

## Background

Two loose ends from the device model in
[ADR-0027](0027-device-parts-families-and-library-dependencies.md) need settling, and they
concern the mechanical side of a device.

The first is the `package` field. A `component` currently names its package twice: `package
LQFP-100` and `footprint project:lqfp-100`. The package code names the land pattern — `0402`,
`SOT-23-5`, `LQFP-100` are names of land patterns — so the two fields state one fact, and
nothing checks that they agree.

The second is where the 3D model lives. [ADR-0010](0010-footprint-and-3d-model-ownership.md)
keeps footprint geometry and 3D data out of the board description, and a library keeps its 3D
models next to its footprints. But a footprint is a land pattern, and a land pattern is
**vendor-independent**: the 7343 pad layout is the same for every manufacturer. The body on top
of it is not. An electrolytic capacitor on that land pattern can be 10 mm or 12.5 mm tall
depending on the manufacturer; the same holds for buttons, inductors and connectors. A 3D model
attached to the footprint therefore states one manufacturer's body as if it were the package's,
and every other manufacturer on the same land pattern is described incorrectly.

The consequence for assembly is the reason this matters: the height of that capacitor decides
whether the board fits into its enclosure. A height check is only meaningful together with the
enclosure, and the enclosure is not part of this project.

## Decision

### 1. The `package` field is removed from `component`

A `part` and a `family` reference exactly one `footprint` and say nothing else about their
package. The package code is declared by the footprint that carries it:

```text
footprint lqfp-100
package_code   LQFP-100
```

`package_code` is a property of the land pattern, and it is what a fabricator, a reviewer and a
BOM line need. The footprint id normally already carries it (`chip-0402`, `tantalum-7343`,
`lqfp-100`), so the field is a machine-readable restatement rather than new information — which
is exactly why it belongs to the file that defines the land pattern and not to every device
that happens to sit on it.

### 2. A 3D model belongs to a part

**Amended by the 2026-10-22 addendum**: a `family` may carry a *generic* body
(package envelope), where the body is the package's and does not vary with the part's rating.
The 3D model describes the body of a purchased device, and a body is vendor-specific. The
`model` pointer therefore lives in the `part` file:

```text
component stm32f407vgt6
kind         part
mpn          STM32F407VGT6
symbol       project:ch32v307vct6
footprint    project:lqfp-100
model        3dmodels/stm32f407vgt6.step
pins
  ...
```

The model file is CAD data and stays outside the language; the `model` line is a **pointer**,
of the same kind as the `footprint` reference — it does not describe the model, it names it.
The model files live in the tree that contains the part (the project, or the library that
provides it), and are covered by the library's `content_hash`
([ADR-0010](0010-footprint-and-3d-model-ownership.md) decision 3,
[ADR-0011](0011-library-format-and-footprint-ir.md)).

A `footprint` file must not carry a `model`. A `family` carries no `model`, because a family
has no vendor and therefore no body.

The land pattern may still be shared by parts whose bodies differ, and that is the point: the
footprint describes what the copper sees, the part describes what the solder sees.

### 3. The exporter needs a part context for the 3D model

**Amended by the 2026-10-22 addendum**: the KiCad output is a derived artifact for the
fabricator, so the exported library footprint carries no 3D model at all — and there are no
footprint variants. The text below is kept for the reasoning it contains; the addendum states
what was decided instead.


A KiCad footprint carries its 3D model, and the model now belongs to the part. The exporter
therefore takes the part as an optional context: `export footprint --part <component_id>` writes
the part's model path into the exported `.kicad_mod`, and a footprint that no part decorates
exports unchanged. When several parts share one land pattern, the exported variants are
distinguished by file name, and the KiCad library name follows the variant.

This is the one place where the change reaches beyond the language, and it is a real coupling
cost: the footprint exporter is no longer a pure function of the footprint IR. It is accepted
because the alternative — attaching one manufacturer's body to a shared land pattern — is
factually wrong, and because the exporter is a derived-artifact layer that may legitimately
depend on more than one shard ([ADR-0004](0004-ir-representation.md)).

### 4. No mechanical dimension fields, and no assembly constraints

The language gains no `body_height`, no `body_size` and no other mechanical dimension. A height
limit can only be checked against an enclosure, the enclosure is not part of the project, and a
number with no evaluator is a fact nobody can act on.

The consequence is stated rather than hidden: **this project does not check whether a board
fits into anything.** The 3D preview remains a review surface, and the assembly level
(courtyards, body clearance, enclosure fit) stays a derivative concern outside the language, as
[ADR-0010](0010-footprint-and-3d-model-ownership.md) decision 4 already places it.

A project that wants an enclosure fit check performs it outside this language, with its own
enclosure model and its own tool.

### 5. ADR-0010 stands, unamended

[ADR-0010](0010-footprint-and-3d-model-ownership.md) forbids fields for pad dimensions,
courtyard, assembly outline and 3D dimensions in `.teda`, and it is not amended: this record
adds no such field. The `model` line is a reference to a CAD file, in the same way that
`footprint` is a reference to another description; the model itself remains outside the
language.

What changes under ADR-0010 is only *where* the model sits in the library tree: models are
attached to parts, so they are stored with the parts rather than with the footprints.

## Consequences

- **One statement of the package.** The land pattern file says what the package is; every device
  that sits on it says nothing about it, so the two can no longer disagree.
- **A library can serve several manufacturers.** The same `chip-0402` land pattern carries the
  bodies of every 0402 capacitor the project uses, each part pointing at its own model, each
  with its own height. The library no longer asserts one vendor's body for everybody.
- **The exporter's input widens.** Exporting a footprint with a 3D model now needs the part.
  Exporting geometry alone is unchanged.
- **No assembly verdict.** Nothing in this project will tell a user that the board does not fit
  into its case. That is a deliberate boundary, and it has to be said out loud, because "the
  tool did not complain" is easily mistaken for "the board fits".
- **The price**: the package code must be written into the footprint files, and the footprint
  ids, which today mix a prefix with a code (`chip-0402`, `tantalum-7343`), become the place
  where that naming convention is fixed.

## Alternatives Rejected

- **Keep the `package` field and check it against the footprint.** It would keep a field that
  restates a fact, and the check would only catch the case where somebody wrote the wrong
  string. Removing the field removes the class of error.
- **Promote `package` to a first-class description type.** A package entity would hold the
  code, the land pattern and the body — but the body is vendor-specific, so a package entity
  would either have no body (and then it is the footprint) or one vendor's body (and then it is
  a part). The entity adds a level without adding a fact.
- **Keep the 3D model on the footprint.** It states one manufacturer's body as the package's,
  which is wrong for every other manufacturer on the same land pattern — the electrolytic
  capacitor case is the sharpest, but buttons and inductors behave the same way.
- **Add `body_height` and let the user write the limit as a constraint.** Rejected in decision 4:
  the limit is only meaningful against an enclosure that this project does not have, so the
  constraint would have no evaluator.
- **Put the enclosure in the project.** That is a mechanical design effort, not an electrical
  description, and it is outside the scope of this project.

## Open Points

- ~~How the exported footprint variants are named~~ — decided in the 2026-10-22 addendum
  below: there are no variants. The exported footprint is a pure 2D land pattern.

## Addendum (2026-10-22): the KiCad output is for the fabricator, so the library footprint stays 2D

Amends decision 3 and closes the last open point of this record.

### 1. What the KiCad output is for

The KiCad output goes to a **fabricator**, and at most to someone **reviewing** it. It is not a
working environment: nobody edits it, and nobody starts their own design on top of our footprint
library. KiCad's own footprints are not bound to a part either — in KiCad a footprint is
geometry, and the part lives in the symbol and the netlist. We are not exporting a symbol
library; we are exporting land patterns, for a board that is already described.

### 2. The exported footprint is a pure 2D land pattern

A footprint that carries a vendor body would have to name one, and the land pattern does not
know which part will sit on it. So the exported footprint carries **no 3D model**: one land
pattern, one file, **and no variants**. The open question of this record — how the exported
variants are named — disappears with the variants.

The consequence is that the footprint exporter is a **pure function of the footprint IR** again.
Decision 3 accepted a coupling cost ("the exporter is no longer a pure function") to write a
part's model into a shared footprint; that cost is gone, and `export footprint --part` is not
needed.

### 3. Where the body is used instead

The body is a property of the part (decision 2) and, where the body is the package's, of the
family (the addendum above). It is used where the **part context exists**:

- our own 3D preview and assembly layer, which knows which part is where;
- the board export, where each placed instance may carry its own model path — so a board with
  two different devices on one land pattern still shows two different bodies, which is what a
  reviewer wants to see.

The bodies themselves stay outside the language, as pointers in the part and family files.

### 4. A library footprint may still carry a package envelope

A fabricator and a reviewer often want a body without a vendor part — the standard package
outline of the land pattern (the IPC-style chip body, the JEDEC body of an LQFP). Such an
envelope is a property of the **package**, not of the device, so it is unique per land pattern
and it creates no variants either.

It is optional, it is labelled as an envelope rather than as a vendor model, and it never
displaces the part's own body where a part context exists.

## Addendum (2026-10-22b): the generic body is the land pattern's package envelope

Follows the addendum above, and closes the open point about the exported variants. It also
moves the generic body from the `family` to the `footprint`, so that one fact is written in
one place.

### 1. A land pattern may carry a package envelope

A `footprint` may declare an optional `envelope <path>`: the **package's standard body** — the
IPC-style or JEDEC-style generic body of that package. It is not a vendor body; it is what the
package looks like when nobody has picked a manufacturer's part yet.

The envelope is a property of the **package**, so it belongs to the land pattern:

- **one envelope per land pattern** — the package has one body;
- therefore **no variants**: the exported `.kicad_mod` is the land pattern plus its envelope,
  one file per land pattern;
- and the exporter stays a **pure function of the footprint IR**, envelope included.

### 2. The envelope may exist only where the package determines the body

The same rule as for the generic body, moved onto the land pattern: a package whose body is
determined by the package may have an envelope; a package whose body varies with the part's
rating may not.

- **May have an envelope**: chip-type packages — MLCC, chip resistors, chip inductors — and
  integrated circuits with a standard package outline. The generic body is not a placeholder
  here; it is the correct shape.
- **May not**: `tantalum`, `electrolytic` and `film` capacitors, `molded` and `shielded`
  inductors, connectors, discretes with a lead frame. The can or body changes with the
  capacitance, the voltage or the current rating, so one generic body would be a picture of
  nothing in particular. These parts carry their own `model`.

A land pattern does not know what sits on it, so the check lives where both sides are known:
`lib:verify` compares the parts and families on a land pattern against the envelope's
existence, and a part whose construction is one of the body-varying kinds on an envelope
carrying land pattern is an error.

### 3. A `family` no longer carries a generic body

A family has exactly one land pattern
([ADR-0030](0030-procurement-layer.md) decision 5a: the footprint is part of the family's
identity). So a "generic body for this family" is the package's body, written in the wrong
place — and it would be a second source for the shape the envelope already states.

So the `family` loses the `model` field it was given earlier the same day, and the generic body
is written once, in the land pattern's `envelope`. A `part` may still carry its own `model` —
a vendor body — and it wins wherever a part context exists (the 3D preview, the assembly layer,
the board export).

### 4. The envelope is labelled as an envelope

The envelope is not a vendor model, and nothing may present it as one. The 3D preview and any
assembly output label it as the package envelope of that land pattern. The honesty rule of
[ADR-0028](0028-library-trust-and-derived-overrides.md) applied to geometry.
