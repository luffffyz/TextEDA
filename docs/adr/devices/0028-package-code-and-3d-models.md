# ADR-0028: The Package Code Lives in the Footprint; 3D Models Belong to Parts

Status: Accepted
Date: 2026-10-22
Scope: Decides: that the package code lives in the footprint, that a 3D model belongs to a part, and that assembly constraints are out of scope. Does not decide: the footprint file format — see ADR-0030.
Related: [ADR-0027](0027-the-package-gives-a-chip-resistor-its-floor.md), [ADR-0030](../libraries/0030-footprint-format-and-geometry.md), [ADR-0031](../libraries/0031-symbol-format.md)
Impact: `spec/teda.md` §6; `spec/footprint.md`; `packages/ir/src/**`

## Background

Two loose ends from the device model in
[ADR-0024](0024-the-device-kind-is-part-or-generic.md) need settling, and they
concern the mechanical side of a device.

The first is the `package` field. A `component` currently names its package twice: `package
LQFP-100` and `footprint project:lqfp-100`. The package code names the land pattern — `0402`,
`SOT-23-5`, `LQFP-100` are names of land patterns — so the two fields state one fact, and
nothing checks that they agree.

The second is where the 3D model lives. [ADR-0030](../libraries/0030-footprint-format-and-geometry.md)
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
provides it).

A `footprint` file must not carry a `model`. The land pattern may still be shared by parts
whose bodies differ, and that is the point: the footprint describes what the copper sees, the
part describes what the solder sees.

### 3. A land pattern may carry a package envelope

A fabricator and a reviewer often want a body without a vendor part — the standard package
outline of the land pattern (the IPC-style chip body, the JEDEC body of an LQFP). Such an
envelope is a property of the **package**, not of the device, so it is unique per land pattern.

A `footprint` may declare an optional `envelope <path>`. The envelope is the package's standard
body; it is not a vendor model, and it never displaces the part's own body where a part context
exists.

Because the envelope is a property of the package, there is **one envelope per land pattern**
and therefore **no variants**: the exported `.kicad_mod` is the land pattern plus its envelope,
one file per land pattern, and the exporter stays a **pure function of the footprint IR**,
envelope included.

**The envelope may exist only where the package determines the body.**

| May have an envelope | May not |
|---|---|
| Chip-type packages — MLCC, chip resistors, chip inductors — and integrated circuits with a standard package outline. The generic body is not a placeholder here; it is the correct shape. | `tantalum`, `electrolytic` and `film` capacitors, `molded` and `shielded` inductors, connectors, discretes with a lead frame. The can or body changes with the capacitance, the voltage or the current rating, so one generic body would be a picture of nothing in particular. These parts carry their own `model`. |

A land pattern does not know what sits on it, so the check lives where both sides are known:
`lib:verify` compares the parts on a land pattern against the envelope's existence, and a part
whose construction is one of the body-varying kinds on an envelope-carrying land pattern is an
error.

**The envelope is labelled as an envelope.** The 3D preview and any assembly output label it as
the package envelope of that land pattern. The honesty rule of ADR-0033 applied to geometry.

A generic device carries no `model`: a generic has exactly one land pattern, so a "generic body
for this generic" is the package's body written in the wrong place — and it would be a second
source for the shape the envelope already states.

### 4. The KiCad output carries no vendor body

The KiCad output goes to a **fabricator**, and at most to someone **reviewing** it. It is not a
working environment: nobody edits it, and nobody starts their own design on top of our footprint
library. KiCad's own footprints are not bound to a part either — in KiCad a footprint is
geometry, and the part lives in the symbol and the netlist. We are not exporting a symbol
library; we are exporting land patterns, for a board that is already described.

A footprint that carries a vendor body would have to name one, and the land pattern does not know
which part will sit on it. So the exported footprint carries **no 3D model**: one land pattern,
one file, **and no variants**. The footprint exporter is a **pure function of the footprint IR**
again.

The body is used where the **part context exists**:

- our own 3D preview and assembly layer, which knows which part is where;
- the board export, where each placed instance may carry its own model path — so a board with
  two different devices on one land pattern still shows two different bodies, which is what a
  reviewer wants to see.

The bodies themselves stay outside the language, as pointers in the part file.

### 5. No mechanical dimension fields, and no assembly constraints

The language gains no `body_height`, no `body_size` and no other mechanical dimension. A height
limit can only be checked against an enclosure, the enclosure is not part of the project, and a
number with no evaluator is a fact nobody can act on.

The consequence is stated rather than hidden: **this project does not check whether a board
fits into anything.** The 3D preview remains a review surface, and the assembly level
(courtyards, body clearance, enclosure fit) stays a derivative concern outside the language, as
[ADR-0030](../libraries/0030-footprint-format-and-geometry.md) decision 4 already places it.

A project that wants an enclosure fit check performs it outside this language, with its own
enclosure model and its own tool.

### 6. ADR-0030 stands, unamended

[ADR-0030](../libraries/0030-footprint-format-and-geometry.md) forbids fields for pad dimensions,
courtyard, assembly outline and 3D dimensions in `.teda`, and it is not amended: this record
adds no such field. The `model` line is a reference to a CAD file, in the same way that
`footprint` is a reference to another description; the model itself remains outside the
language.

What changes under ADR-0030 is only *where* the model sits in the library tree: models are
attached to parts, so they are stored with the parts rather than with the footprints.

## Consequences

- **One statement of the package.** The land pattern file says what the package is; every device
  that sits on it says nothing about it, so the two can no longer disagree. A device file that
  still writes `package` is an error, not an unknown key — the parser reports
  `syntax.removed-construct` and points at the note in `spec/teda.md` §13.4 — and the `package`
  and `footprint` names stay reserved as parameter columns.
- **A library can serve several manufacturers.** The same `chip-0402` land pattern carries the
  bodies of every 0402 capacitor the project uses, each part pointing at its own model, each
  with its own height. The library no longer asserts one vendor's body for everybody.
- **The exporter stays a pure function.** The exported footprint is 2D plus at most one package
  envelope; a vendor body appears only where a part context exists.
- **No assembly verdict.** Nothing in this project will tell a user that the board does not fit
  into its case. That is a deliberate boundary, and it has to be said out loud, because "the
  tool did not complain" is easily mistaken for "the board fits".
- **The price**: the package code must be written into the footprint files, and the footprint
  ids, which today mix a prefix with a code (`chip-0402`, `tantalum-7343`), become the place
  where that naming convention is fixed. `bun run lib:verify` requires every land pattern to
  state its own code.

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
