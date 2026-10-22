# ADR-0027: Device Semantics Split into Parts and Families; Project Layout by Asset Kind; Libraries Are Dependencies

Status: Accepted
Date: 2026-10-22
Related: [ADR-0010](0010-footprint-and-3d-model-ownership.md), [ADR-0011](0011-library-format-and-footprint-ir.md), [ADR-0012](0012-symbol-description.md), [ADR-0013](0013-reference-project-self-built-libraries.md), [ADR-0002](0002-board-pages-and-bom.md), [ADR-0008](0008-ir-shard-identity-and-hash.md), [ADR-0022](0022-language-versioning.md), [ADR-0031](0031-project-tree-ownership-model.md)
Impact: `teda.md` §5, §6, §7.1; `AGENTS.md` §4.5, §9; `schemas/ir/v0.2/component.schema.json`; `packages/parser` (the `component` description type, the `kind` / `construction` / `polarized` fields, the new top-level directories); `packages/cli` (the project layout, `project.toml` `[libs]`); `packages/core` (variant scoping by `component_id`); `examples/reference-project/`

## Background

The `component` description type currently carries two different things at once, and the
difference is only expressed by a convention rather than by the data.

For a **specific part** — `ch32v307vct6`, `tps5430ddar`, `xtal-8mhz-3225` — the file names a
manufacturer part number and holds the complete electrical facts: `mpn`, `symbol`, `footprint`
and the `pins` table. The `instances` row adds nothing but a refdes.

For a **generic device** — `c-0402`, `r-0402`, `c-220u` — the file names no part at all. It
declares a package, a symbol, a footprint, a two-entry `pins` table with invented names
(`A`/`B`), and a `params` declaration whose `value` column is required. The device is only fully
specified once the `instances` row supplies the value, the tolerance and the voltage rating.
The reference project's `c-220u.teda` makes the confusion visible: the file name carries a
value while the file declares `value` as a required parameter.

The distinction is load-bearing, and several things downstream are currently undefined because
of it:

- **BOM row shape.** A specific part yields a row keyed by `component_id`; a generic device yields
  a row keyed by `component_id` plus the parameter dictionary. Two key shapes for one BOM.
- **Variant scoping.** [ADR-0002](0002-board-pages-and-bom.md) scopes a variant by `component_id`,
  which "applies to every instance of that part". For a generic device that scope is wrong: DNP on
  `c-0402` would remove every capacitor of that package, not the one 10 µF part.
- **Part identity.** `AGENTS.md` §2 invariant 5 wants one stable identity per element. For a
  generic device the identity is split across the file and the instance row.
- **Acquisition.** A generic device row has no manufacturer part number and no vendor, so nothing
  in the design layer can be turned into a procurement line.
- **ERC.** `c-220u` is a polarised tantalum capacitor, but its pins are typed `passive` and its
  polarity is only implied by the choice of the symbol `project:c-pol`. Nothing in the facts can
  catch a reversed part.
- **Reuse of the file itself.** `symbols/project/` and `footprints/project/` are libraries; a
  symbol is reused by many devices, a footprint by more. But `components/passives/c-0402.teda`
  duplicates the library references it needs and adds an empty parameter shell on top.

The same devices are also expected to exist outside a project. A common MCU family or a set of
popular regulators is not something each project should re-type; it should be *referenced*. The
current model has no room for that, because `component_id` is unique across the whole
`components/` tree and carries no namespace.

## Decision

### 1. `component` has two kinds, declared explicitly

Every `component` file declares `kind`, with exactly two values:

| `kind` | Identity | `mpn` | `params` | Typical instance row |
|---|---|---|---|---|
| `part` | a manufacturer part number | **required** | usually empty | `U1 tps5430ddar` |
| `family` | a device family (category + construction + package) | **forbidden** | at least one identity-bearing column (`value`) | `C1 cap-tantalum-7343 220uF 10V` |

The kind is never inferred. The current convention — "a `resistor`, `capacitor` or `inductor`
whose `params` contain `value` may omit `mpn`" — is replaced by the explicit field.

### 2. A family describes construction and polarity as facts

A `family` adds two scalar facts that today exist only implicitly in file names and symbol choices:

- `construction` — the technology of the device (`tantalum`, `electrolytic`, `mlcc`, `film`,
  `shielded`, …). It is an open vocabulary, like `category`.
- `polarized` — `yes` / `no`. A polarised family must declare it, and its pins may carry a
  polarised electrical type so that ERC can detect a reversed part.

A family's id names the family, not a value: `cap-tantalum-7343`, `res-th-0402`,
`ind-shielded-6045`. A family id never carries a value, a tolerance or a rating.

### 3. The pin table is the identity boundary

The rule that decides whether two devices are the same device is the pin table:

> **If the pin table changes, it is a different device. Only attributes that do not change the
> electrical behaviour of a pin may become `params`.**

This settles the cases that the part/family split alone leaves open:

| Difference | Example | Result |
|---|---|---|
| Different pin table | LQFP-100 and LQFP-144 variants of one die | **Two different parts.** A parameter cannot add or remove a pin. |
| Same pin table, different order code | `STM32F407VGT6` vs `STM32F407VGT6/TR` (tape-and-reel) | Two parts, or one part with the ordering code as a `params` value |
| Same pin table, different rating | Same resistor body, 1 % vs 5 % | One **family**, rating as a `params` value |
| Same pin table, different package body | Same die, same pins, different lead frame | Impossible in practice: a different package means a different pin count |

Two consequences follow.

First, the land pattern is a fixed attribute of a part or a family, never a `params` value: a
part references exactly one `footprint`. The separate `package` field is removed, and the
package code is declared by the footprint itself — see
[ADR-0029](0029-package-code-footprint-and-3d-model-ownership.md) decision 1.

Second, `params` may only carry attributes that leave the pin table untouched: a value, a
tolerance, a voltage rating, an ESR, a temperature grade. Anything that changes which pins
exist, or what a pin does, belongs to a different part.

This rule is about **the identity of the device the design intends**, not about the accuracy of
a record. A datasheet transcribed wrongly also "has a different pin table" from the device it
describes; correcting that record is not a new device. Corrections to a library's records are
made by deriving a project-local copy, which is decided in
[ADR-0028](0028-library-trust-and-derived-overrides.md) decision 3.

The land pattern is part of that identity, and it is a board-domain fact: whether two packages
of one die are functionally interchangeable is a question for the firmware, and this project
does not answer it. See
[ADR-0030](0030-procurement-layer.md) decision 5a.

### 4. One part per package, with its complete pin table

Decision 3 means that a die offered in several packages produces **one part file per package**,
each carrying its **complete** pin table:

```text
components/mcu/stm32f407vgt6.teda   # kind: part, package LQFP-100, 100 pins
components/mcu/stm32f407zgt6.teda   # kind: part, package LQFP-144, 144 pins
```

The pin table of the LQFP-144 part is not expressed as "the LQFP-100 pins plus 44 more". It is
written out. Two alternatives were considered and rejected:

- **Composing pin tables** — a part that references a base pin table and declares only its
  differences. It removes the mechanical duplication, but it makes `pins` a computed value
  rather than a written one: a reader (or an ERC, or the exporter) has to evaluate the merge to
  know the truth, and the merged result is what nobody wrote down. The duplication this avoids
  is mechanical — the same table copied into N files — and mechanical duplication is a job for a
  generator and a checker, not for the language.
- **One part with several packages** — a part that declares a package-dependent footprint and a
  package-dependent pin table. It keeps the file count down, but it breaks the "one part, one
  package, one footprint" shape, and it forces the BOM row, the footprint binding and the
  variant scope to carry a package dimension.

The accepted cost is that a library holds one file per package variant, and that the pin table
of a die is repeated across those files. The repetition is deliberate and bounded: the tables
are generated from the same source, and a library check can confirm that parts declaring the
same die agree on the pins they share.

### 5. A `part` is the only thing a variant may scope to

Variant DNP and alternation are scoped by `component_id`, which means "this part". That scope is
defined only for `kind: part`. For a `family`, the scope is the instance: a variant may name the
instance, not the family. The `packages/core` checker enforces the distinction instead of
letting a family-wide DNP pass unnoticed.

### 6. The project tree is organised by ownership

Superseded by [ADR-0031](0031-project-tree-ownership-model.md) decision 1. The tree is no longer
flat by asset kind. The project's own assets are grouped under `assets/`, the material it
references but does not own under `external/`, the circuit under `design/`:

```text
my-board-project/
├── project.toml
├── assets/              # what this project owns
│   ├── symbols/ footprints/ families/ components/
│   └── procurement/     # family + specification -> part
├── external/            # what this project references but does not own
│   ├── libs/ simulation/ cache/
├── design/              # sch/ pcb/ modules/ system/
├── docs/ dist/
```

The reasoning that survives from the flat layout: `components/` and `families/` are siblings at
the same level as `symbols/` and `footprints/`, and the `project/` level inside today's
`symbols/project/` and `footprints/project/` disappears — the project's own assets are its own
directories, and they are addressed by bare id.

### 7. A library is a dependency, not a directory

Amended by [ADR-0031](0031-project-tree-ownership-model.md) decisions 5 and 6. The dependency is
still a dependency and not a directory — but the declaration moves out of `project.toml` into its
own description type, and the library is **vendored** rather than cached:

```toml
# external/libs/stm32l4.toml  — a `libref` description
name         = "stm32l4"
source       = "https://example.org/libs/stm32l4"
rev          = "v1.3.0"
content_hash = "sha256:…"
channel      = "official"
```

The library's files live in `external/libs/stm32l4/`, verified against `content_hash`; a mismatch
is an error. The compiler never reaches the network: vendoring is an explicit step, separate
from the build. The library's assets become normative shards of the project, because the IR must
be sufficient on its own.

The self-built assets of the project and the assets of a library are the same kind of thing: a
set of `symbol`, `footprint`, `family` and `component` files. The only difference is where they
come from and how they are pinned.

### 8. Library items are namespace-qualified; project items are not

A reference to a device asset is `lib:id` when it comes from a library, and a bare id when it
comes from the project:

```text
instances
  U1  tps5430ddar                 # project part
  C1  cap-tantalum-7343  220uF  10V   # project family
  U2  stm32l4:stm32f407vgt6      # library part
```

Library-provided ids **must** be qualified, so that a project with several libraries never has
to resolve an ambiguity. Project-owned ids may be written bare; `project:` is accepted as an
explicit qualifier for them. The `lib:name` form is the one already used by `symbol` and
`footprint` references, so this extends an existing convention rather than inventing one.

Resolution order for a bare id ([ADR-0031](0031-project-tree-ownership-model.md) decision 7): the
project's own assets first, then the vendored libraries in the order they are declared. A bare
id that resolves to more than one library is an error.

The colon inside an `instances` cell does not collide with the colon of the `nets` section:
that colon is a section-leading token, this one is inside a space-separated cell.

### 9. A library must carry electrical facts; a geometry-only bundle is not a library

A library that contains only footprints and symbols saves the consumer nothing that matters:
the electrical facts (pin numbers, pin names, electrical types) would still have to be written
per part. Such a bundle is a CAD attachment, not a device library, and it is not admitted.

A library must therefore provide, for everything it publishes:

- a `component` (`kind: part` or `kind: family`) with its `pins` table;
- the `symbol` and the `footprint` it references, with pin numbers and pad numbers aligned.

`pins_source = symbol` remains available for *importing* a KiCad symbol library, but it is not a
normal way to publish a TextEDA library.

Library self-consistency is checked by the same tool that checks a project: the three-way
alignment of symbol pin numbers, footprint pad numbers and component pin numbers must hold for
every asset in the library. Library quality is verified, not trusted.

### 10. Procurement is a separate, project-local layer

The mapping from "this family with these specifications" to "the part we actually buy" is a
project decision, and it is where vendor bindings live. It lives in `assets/procurement/`, is
project-local, and may point at a project-owned part or at a qualified library part.

Consequences that follow from decision 1:

- A BOM row for a `part` is keyed by `component_id`.
- A BOM row for a `family` is keyed by `component_id` plus the parameter dictionary, and carries
  no manufacturer part number until the procurement layer resolves it.
- Neither shape replaces the other; both are correct for what they describe.

### 11. Language 0.9; the IR contract gains the same fields

The `kind`, `construction` and `polarized` fields and the new top-level directories are additive:
the language moves to `0.9` ([ADR-0022](0022-language-versioning.md)). The `component` IR shard
gains the same fields; the change is additive and moves the IR contract to `v0.3`.

Decision 3 adds no field: it constrains what a `params` column may mean. A parameter that would
change the pin table is rejected by the compiler, not by a convention.

### 12. Migration

| Today | Becomes |
|---|---|
| `symbols/project/*.teda` | `assets/symbols/*.teda` |
| `footprints/project/*.teda` | `assets/footprints/*.teda` |
| `components/passives/c-0402.teda` | `assets/families/cap-0402.teda`, with `kind: family` |
| `components/passives/c-220u.teda` | `assets/families/cap-tantalum-7343.teda`, with `construction` and `polarized` |
| `components/passives/r-0402.teda` | `assets/families/res-th-0402.teda` |
| `components/passives/xtal-8mhz-3225.teda` | `assets/components/xtal-8mhz-3225.teda`, with `kind: part` |
| `components/mcu/**`, `components/regulators/**`, `components/power/**`, `components/sensors/**`, `components/indicators/**`, `components/mechanical/**` | `assets/components/**`, with `kind: part` |
| `project.toml` `[libs.project]` with `symbols` / `footprints` | removed; the project's own assets are its own directories |
| — | `external/libs/<name>.toml` (new, for each vendored library) |
| — | `assets/procurement/primary/<board_id>.teda` (new, may be empty) |
| `sch/<board>.teda`, `pcb/<board>.teda`, `modules/*.teda`, `system/*.teda` | `design/sch/<board>.teda`, `design/pcb/<board>.teda`, `design/modules/*.teda`, `design/system/*.teda` |
| `sch/<board>/<page>.view.teda` | `design/sch/<board>/<page>.view.teda` |
| `package <code>` in every `component` file | removed — the package code is declared by the footprint ([ADR-0029](0029-package-code-footprint-and-3d-model-ownership.md) decision 1) |
| `model` line in a `footprint` file | moved to the `part` that owns the body ([ADR-0029](0029-package-code-footprint-and-3d-model-ownership.md) decision 2) |

A migration script is required for the mechanical part of this move, in the spirit of
`bun run migrate:0.7`. Naming a family is a human decision and the script does not make it:
a family whose id carries a value (`c-220u`) has to be renamed by its author.

## Consequences

- **The BOM has one honest answer per device.** A part is a line with a part number; a family is
  a line that says what the design requires and what has not been purchased yet.
- **Variants stop having an undefined scope.** "DNP this part" and "use an alternative for this
  part" mean the same thing for every device in the design, because the device a variant
  references is always a `part`.
- **The construction of a device becomes checkable.** Polarity, and the ratings that depend on
  construction, stop being implied by a file name.
- **The identity of a device has one test.** "Same pins, different order code" is a `params`
  question; "different pins" is a different device. This is the rule that keeps a family from
  growing a parameter that quietly changes the hardware.
- **A die offered in several packages becomes several files.** The library is larger, and the
  duplication is mechanical rather than semantic — which is where a generator and a checker
  belong, not a language mechanism (the generator lives outside the language, per
  `docs/backlog.md` F9).
- **The library becomes the place where repetition is removed.** A project that needs an STM32
  family writes one qualified reference per instance instead of transcribing pin tables. The
  repetition that the reference project currently pays for its own two boards is the small case
  of the same problem.
- **The tree states what it holds.** `assets/symbols/`, `assets/footprints/`, `assets/families/`,
  `assets/components/` are four kinds of asset the project owns; a reader no longer has to infer
  scope from a directory name, and the borrowed material is visibly separate
  ([ADR-0031](0031-project-tree-ownership-model.md) decision 1).
- **The price**: every existing `component` file gains a `kind` line, every generic device is
  renamed, and the `mpn`-optional convention disappears. The reference project is the first
  migration target.
- **The price**: a project with several libraries must qualify ids. This is deliberate — an
  unqualified id that silently resolves to the wrong library is worse than a longer name.

## Alternatives Rejected

- **Keep one kind and make every passive a real part with a manufacturer part number.** This
  removes the `params` machinery for the largest device category and makes BOM rows uniform. It
  was rejected for two reasons. First, selection is a late design decision: an agent working
  from a datasheet-free schematic cannot name a vendor part number, and inventing one is worse
  than leaving it open. Second, a manufacturer part number is an acquisition binding, and the
  design layer should not carry acquisition bindings — that is what the procurement layer is
  for ([ADR-0018](0018-zero-dependency-and-manufacturing-target.md) keeps the manufacturing
  output neutral). Note that this alternative remains open for *individual* parts: a project may
  declare a specific passive as a `part` when it has deliberately chosen one, and the reference
  project's `xtal-8mhz-3225` is already such a part.
- **Put a `preferred_mpn` on the family.** It would place one vendor's commercial choice inside
  a shared fact asset, and it collapses the distinction between family and part — a family with
  a part number *is* a part. The acquisition binding belongs in the procurement layer.
- **Keep the family and part distinction implicit, in the `mpn` field alone.** The current
  convention is exactly this, and it leaves the BOM key shape, the variant scope and the ERC
  polarity undefined. An explicit `kind` costs one line per file and settles all three.
- **Move the family definitions into the `schematic` file.** This would break reuse across
  boards and modules, inflate the board file, and undo the library-level checks that
  [ADR-0013](0013-reference-project-self-built-libraries.md) established.
- **Merge the symbol and the footprint into one "pinout" asset.** It would make the three-way
  alignment structural rather than checked, but it breaks the 1:1 assumption (one generic symbol
  serves many footprints), makes existing KiCad symbol and footprint libraries unusable as
  imports, and contradicts [ADR-0011](0011-library-format-and-footprint-ir.md) and
  [ADR-0012](0012-symbol-description.md). The alignment is a checkable property, and the
  checker already exists.
- **Compose pin tables** — a part that references a base pin table and declares only the pins
  it adds or renames. It removes the mechanical duplication between the package variants of one
  die, but it turns `pins` into a computed value: the truth is what the merge produces, and no
  file says it. Rejected in decision 4.
- **One part with several packages** — a part that declares a package-dependent footprint and a
  package-dependent pin table. It keeps the file count down but breaks the one-part-one-package
  shape, and pushes a package dimension into the BOM row, the footprint binding and the variant
  scope. Rejected in decision 4.

## Open Points

- The registry and distribution format for libraries is not decided here
  (`docs/backlog.md` F10).
- The procurement layer's own file format, and how a BOM resolves across libraries, are decided
  in [ADR-0030](0030-procurement-layer.md) (Accepted) and written up in `spec/procurement.md`.
- Whether a library may be *partially* overridden by a project — for example a corrected pin
  table for one part — is decided in
  [ADR-0028](0028-library-trust-and-derived-overrides.md).
- ~~Whether a part declares the **die** it belongs to~~ — decided in the 2026-10-22
  addendum below: no. A die is a fact about the silicon, not about the purchasable device.

## Addendum (2026-10-22): a die is not in the language

Closes the open point about `die`.

### 1. A part does not declare its die

The die is the silicon. The device record is the purchasable device. They differ, and the
difference matters for what a board actually needs: the board cares about the **footprint**
(where it lands and how big it is) and the **pin table** (what connects to what). Neither knows
anything about the die.

Ask what a `die` field would change:

- **ERC** reads the pin table. Unaffected.
- **The BOM** reads the part, its rating and its MPN. Unaffected.
- **Placement and routing** read the footprint. Unaffected.
- **The netlist** reads the pins. Unaffected.

Nothing downstream of the device record changes. A field that no checker, no exporter and no
consumer reads is a field an agent can fill in with a guess and nobody will ever contradict —
the same failure mode as the `package` field this family of records removed.

### 2. Where the die still earns its keep — outside the language

- **The generator.** The N part files of one die are produced by a generator that reads the
  datasheet, not the project. The generator is outside the language by the standing decision
  that facts are literal values and generators live outside it (`docs/backlog.md` F9).
- **The library's own consistency check.** Two packages of one die must agree on the pins they
  share. That is the library's business, checked by the library's tooling, and the project
  consumes parts that are already consistent.

Neither needs a field in the language.

### 3. "U1 and U2 are the same silicon" is an assembly note

A project sometimes wants to say that two parts are the same die — one firmware image fits both,
which is a real convenience at bring-up. That is an **assembly note in `docs/`**, not a fact in
the IR.

Making it an IR assertion would add a field that an agent can assert without checking, and
that goes stale silently when a part is swapped. The note in `docs/` is read by the people
flashing the board, which is exactly who needs it, and nobody else has to keep it true.
