# ADR-0030: The Procurement Layer — Which Part to Buy Is a Project-Local Decision

Status: Accepted
Date: 2026-10-22
Related: [ADR-0027](0027-device-parts-families-and-library-dependencies.md), [ADR-0028](0028-library-trust-and-derived-overrides.md), [ADR-0029](0029-package-code-footprint-and-3d-model-ownership.md), [ADR-0031](0031-project-tree-ownership-model.md), [ADR-0002](0002-board-pages-and-bom.md), [ADR-0006](0006-jlc-prototype-delivery.md), [ADR-0018](0018-zero-dependency-and-manufacturing-target.md)
Impact: `teda.md` §2, §11, §12, §13.4; `spec/procurement.md` (new); `schemas/ir/v0.3/procurement.schema.json` (new); `packages/parser` (a `procurement` parser and formatter); `packages/core` (the selection checks); `packages/cli` (BOM output, `texteda check` reporting of unsourced lines); `packages/ir` (a new shard kind, contract v0.3); `docs/adr/0023-ir-layer-on-disk.md` (the shard paths); `docs/adr/0031-project-tree-ownership-model.md` (the tree's file id); `AGENTS.md` §4.1; `docs/backlog.md`

**The format is settled; the implementation is not.** The decisions below are closed — the open points at the end of the first draft were argued and answered on
2026-10-22, and the format is written up in `spec/procurement.md`. What does not exist yet is the parser, the IR contract entry and the BOM output; those
are tracked in `docs/backlog.md` F35.

*Amendment (2026-10-27).* The sentence above records the state of 2026-10-22. All three pieces it
names have since landed (2026-10-23, `docs/backlog.md` F35): the parser and canonical formatter are
`packages/parser/src/procurement.ts` and `fmt-procurement.ts`, the contract entry is the
`procurement` shard, and the BOM is `texteda bom <project> <board>` (`packages/cli/src/bom.ts`).
The selection checks are `packages/core/src/procurement/rules.ts`, run by `texteda check`. The
statement that stays true is about scope, not about code: a selected part is checked against the
line it fills, while the two gaps named in F35 remain open -- selection checks for shadowed
(overridden) devices, and the order-format BOM of [ADR-0006](0006-jlc-prototype-delivery.md).

## Background

The device model in [ADR-0027](0027-device-parts-families-and-library-dependencies.md) splits a
device into a **family** (what the design requires) and a **part** (what is bought), and
[ADR-0028](0028-library-trust-and-derived-overrides.md) makes libraries the place where parts
come from. That leaves one thing unplaced: the act of *choosing*, per project, which part
realises a family requirement.

Without such a layer, three things break at once:

- **The BOM cannot be produced.** A board that uses a 220 µF tantalum capacitor has a BOM line
  for the family and its specification; it has no manufacturer part number, because the
  selection was never written down anywhere.
- **The variant story is incomplete.** [ADR-0002](0002-board-pages-and-bom.md) makes variants
  affect the BOM and the manufacturing data. A variant that swaps one vendor's part for
  another's needs a place to say which part applies.
- **The acquisition binding leaks into the design layer.** The temptation is to write the
  manufacturer part number into the family, or to make every passive a part with a hard-coded
  vendor choice. Both were rejected in ADR-0027.

The selection is a **project decision**: it depends on what the project can buy, at what price,
in what packaging, from which channel. It is not a property of the device, so it does not belong
in a shared library — and it is not a property of the circuit, so it does not belong in the
schematic. It is a layer of its own, and it is project-local.

## Decision

### 1. `procurement` is a new description type, scoped to a board

A procurement description carries a header like every other description:

```text
version 0.9
procurement mcu-board
role primary
```

The file id is the **board** the selection belongs to. A selection is board-scoped because a BOM
is a board's ([ADR-0002](0002-board-pages-and-bom.md)): the procurement layer is the part of the
project that says what this board is built from. The type exists since language **0.9** and has
its own version line, as every description type does ([ADR-0022](0022-language-versioning.md)).

The `role` scalar says which of the two files this is, and it must agree with the directory
the file is in. The two files have the same grammar; only the role and the standing differ.

The files are project-local: they are not libraries, they are not published as a shared asset,
and what the contract layer covers is the **format**, not any project's selections
([ADR-0015](0015-licensing-and-open-standard.md)). Their place in the tree is `assets/`, beside
the project's own device assets ([ADR-0031](0031-project-tree-ownership-model.md) decision 2):

```text
assets/procurement/primary/<board_id>.teda        # the primary selections — normative
assets/procurement/alternatives/<board_id>.teda   # the second sources — advisory
```

A board's procurement state is **two files**, because its two halves have different standing.
The split is a file-level property, not a section inside one file, so that each file produces
exactly one shard with exactly one classification
([ADR-0023](0023-ir-layer-on-disk.md) decision 4).

**Re-affirmed (2026-10-22).** The split was questioned on the grounds that an alternative is
"only an MPN" and does not deserve a file of its own. It does, and the reason is not the amount
of content: the two halves have different **hash standing**. A different primary part is a
different build; a different second source is not - the Gerbers are byte-identical, and a hash
that moved for that reason would make every re-sourcing exercise look like a design change and
invalidate a manufacturing package that nothing had changed. The alternatives are also held to
the same hard constraints as the primary (decision 5), which is where their value is: the
substitute is checked against the land pattern before anybody orders it.

**A selection may only name the project's own source.** Since
[ADR-0028](0028-library-trust-and-derived-overrides.md) (2026-10-22) makes a derived file
*shadow* the library item it overrides, a row may not name a shadowed library item: that item is
no longer this project's description of the device. A selection naming the project's derived
copy is correct, and the BOM prints that copy's MPN.

**One board, one set of selections, and no second one.** A board that is built two different
ways is two variants of that board, and a variant names parts directly
([ADR-0002](0002-board-pages-and-bom.md), decision 7 below). A second selection set would have
been a second way of saying the same thing, with a flag to choose between them.

### 2. One row per family line: `<family> <params…> -> <part>`

```text
selections
  cap-tantalum-7343 220uF 10V -> avx:avx-taj-220u-10v
  res-th-0402 10k 1% -> yageo-rc0402fr-0710kl
  ind-shielded-6045 10uH 20% -> bourns:l6045-103K-2200
```

The left side is the **BOM line key**: a family id followed by the values of the family's
declared `params`, in the family's declared order — the same shape as an `instances` row. The
right side is the chosen part: a project-owned asset by its bare id, a vendored library item by
its qualified id ([ADR-0031](0031-project-tree-ownership-model.md) decision 7).

The `->` separator exists because both sides are open-ended: the parameter list has a length
that depends on the family, so a parser cannot tell where the parameters stop without
resolving the family first. `:` is already the nets-section token and `=` already binds a type
to a value; `->` is a third use that says "resolves to" and nothing else.

**The row is not the `instances` row.** It was asked whether the selection could simply be a
column of the instance row, and it cannot, for a reason that is about keys rather than taste: an
`instances` row is keyed by `refdes` and holds one *placement*, while a selection is keyed by
(family, parameters) and holds one *BOM line*. Writing the selection into the instance row would
mean writing the same selection on every one of the twenty instances of a family, and changing a
part number would mean changing twenty rows. A selection that applies to every instance of a
family has to be written once, and a table keyed by the BOM line is where it is written once.

### 3. A part needs no row — it is its own answer

A selection always points **from a family to a part**. A device the design names as a part is
already bought as itself; adding a row for it would be a second way of saying the same thing.

The rule is therefore: **the selection table contains one row per family BOM line, and every
part BOM line stands alone.** If the design names `stm32l4:stm32f407vgt6`, that part is the
purchase, and the procurement layer says nothing about it.

### 4. An unselected family line is legal, and is reported

A board may legitimately be designed but not yet sourced. The BOM then carries the line with no
manufacturer part number and marks it **unsourced**. `texteda check` reports every unsourced
family line, as a warning: the design is valid, the procurement is incomplete, and the two
must not be confused.

This is deliberately not an error. A gate that rejects unfinished sourcing would make the tool
unusable during the phase where the circuit is still moving.

**How an unsourced line is rendered.** The MPN cell is **empty** and the marker `unsourced`
goes into the comment/status column. It does not go into the MPN cell: the exported BOM is
consumed by a parts ordering system ([ADR-0006](0006-jlc-prototype-delivery.md)), and a part
number that reads `unsourced` would be ordered as if it were a part. An empty cell plus an
explicit marker is both honest and consumable.

### 5. What a selection must satisfy

A row is checked at compile time:

| Check | Why |
|---|---|
| The family resolves, and it is a `kind: family` | A part may not be re-selected |
| The part resolves, and it is a `kind: part` | A family may not be selected as a part |
| The part has an `mpn` | Required of every part; this is what makes the row purchasable |
| The part's `params` declaration covers the family's `params` — same names, same types | Otherwise the specification in the row cannot be carried by the part, and the BOM line would silently lose a column |
| The part's `footprint` equals the family's `footprint` | The land pattern is a **hard constraint** of the family; a selection that changes it is not a selection, it is a design change |
| The part is not a library item the project has shadowed | A derived copy replaces the library item it overrides; selecting the shadowed item would put the same device in the BOM twice ([ADR-0028](0028-library-trust-and-derived-overrides.md)) |

The last two are the checks that make the layer worth having: they catch the case where a
selection quietly alters the board.

### 5a. The land pattern is a hard constraint, and it is ours to define

The footprint constraint above is not a convenience; it follows from where this project's
boundary is.

A device family that is offered in several packages — one die, one function, several land
patterns — is a statement made in the **embedded** domain: that the variants are
functionally interchangeable, that the firmware can target them alike, that the peripherals
line up. This project draws boards. It decides nothing about firmware, peripheral equivalence
or pin multiplexing, and it has no business writing "these two packages are the same device"
into a family definition.

So the family is defined the way a board designer defines it: **one land pattern, one pin
count, one pin table.** The two STM32 variants with different packages are not one family with
two footprints — by
[ADR-0027](0027-device-parts-families-and-library-dependencies.md) decision 3 they do not even
have the same pin table, so they are different parts, and each part carries its own footprint.

The consequence is a rule that holds everywhere in this project:

> **The footprint is part of the family's identity, not a parameter of it, and never something a
> selection may change.**

If a project genuinely needs the same functional requirement to be realisable on two land
patterns, it declares two families — one per land pattern — and selects between them at the
design level, where the difference is visible, rather than inside the procurement layer, where
it would be invisible.

### 6. The BOM row key is uniform

ADR-0027 decision 10 distinguished two row shapes. This record unifies them:

> **A BOM row is keyed by `(component_id, parameters)`. A part has an empty parameter set.**

The distinction survives — a part row has no parameters to read — but the key is one shape, and
every consumer of the BOM (netlist, KiCad export, manufacturing package) can treat it as one
thing.

### 7. Variants do not fork the procurement layer

[ADR-0002](0002-board-pages-and-bom.md) makes a variant able to substitute a part. That
substitution is a **design-level** statement and names a part; therefore the variant's BOM line
already carries a different `component_id`, and it is a part, and it needs no selection.

The procurement layer is therefore variant-independent, and so is board-scoped in the strong
sense: a board built two different ways is two variants, not two selection sets. If two
variants of one board need different vendors for the same family requirement, that is expressed
as two parts — one per variant — not as two rows in the selection table.

### 8. Selecting an unreviewed library part

A library part may be selected. If its `provenance` is `generated` (not human-reviewed,
[ADR-0028](0028-library-trust-and-derived-overrides.md) decision 1), the selection is reported
as a warning, and it is an error in strict mode (ADR-0028 decision 5). A project that has
checked a library part against its datasheet derives a reviewed copy
([ADR-0028](0028-library-trust-and-derived-overrides.md) decision 3) and selects that.

### 9. Commercial facts are out of the language

Packing form, supplier, price, minimum order quantity and lead time are **not** in the
procurement description. They are commercial facts about a purchase, not facts about the
design, and a BOM that carries them becomes a document that changes weekly and belongs to
purchasing.

[ADR-0018](0018-zero-dependency-and-manufacturing-target.md) keeps the manufacturing output
neutral for the same reason: the technical description says *what is needed*; procurement says
*what is bought*. If a project wants those facts attached to the exported BOM, it keeps them
beside the project — a spreadsheet, a purchasing system — and the exported BOM stays
reproducible.

### 10. The IR and the two hashes

The procurement descriptions compile to two shards:

| Source | Shard | Classification |
|---|---|---|
| `assets/procurement/primary/<board_id>.teda` | `boards/<board_id>/procurement.json` | normative |
| `assets/procurement/alternatives/<board_id>.teda` | `boards/<board_id>/procurement-alternatives.json` | advisory |

The primary shard holds the mapping from a family key to a part id, and it enters the project
hash: a different primary part is a different build.
([ADR-0023](0023-ir-layer-on-disk.md) decision 4,
[ADR-0008](0008-ir-shard-identity-and-hash.md) decision 5.)

The primary is a **board** shard, so it also enters the board hash. That is the point of scoping
a selection to a board: the part a board is built from is part of that board's identity, so
changing it invalidates the board's review and the artifacts that carry the board hash.

The alternatives shard holds the second sources, and it does not enter the project hash. It
enters the **advisory hash** instead.

### 11. One primary selection, and any number of alternatives

A family line has **one primary selection** — the part the build uses — and **zero or more
alternatives**, the second sources that may be bought instead:

```text
# assets/procurement/primary/mcu-board.teda
selections
  cap-tantalum-7343 220uF 10V -> avx:avx-taj-220u-10v
```

```text
# assets/procurement/alternatives/mcu-board.teda
selections
  cap-tantalum-7343 220uF 10V -> kemet:tae-227k-010-v-w
  cap-tantalum-7343 220uF 10V -> vishay:593b-2272-103-t
```

An alternative is not a second selection. The primary is what the BOM, the netlist and the
manufacturing package are built from; the alternatives are what a buyer may substitute when the
primary is unavailable or rejected.

A family line with alternatives but no primary is **unsourced** (decision 4): alternatives do
not make a line sourced, because nothing has been decided.

### 12. The alternatives are in the IR, and out of the build identity

The alternatives are **facts**, and facts live in the IR: they are compiled into the
alternatives shard, they are checked on every compile, and they are traceable. They are
**not** part of the build identity: they do not enter the project hash, and no built artifact
depends on them.

The reason is the one that motivated this record: adding or changing a second source must not
require a rebuild, and must not invalidate a review or a manufacturing package. A board's
electrical content does not change when purchasing opens a second vendor, and a hash that moved
for that reason would make every re-sourcing exercise look like a design change.

The asymmetry is deliberate and is stated rather than left implicit:

| | Enters the IR | Enters the project hash | Affects built artifacts | Stamped with |
|---|---|---|---|---|
| Primary selection | yes | yes | yes | `project_hash` |
| Alternative | yes | no | no | `advisory_hash` |

Two consequences follow.

First, nothing is left outside the truth. An alternative that names a discontinued part, or one
whose footprint has drifted, is a fact in the IR and is checked on every compile; it does not
rot unnoticed because no tool consumes it.

Second, the purchasing state has its own chain. The procurement annex — the list of second
sources, produced from the alternatives shard — is stamped with `advisory_hash`, not with
`project_hash`. Re-sourcing moves the purchasing chain and leaves the build chain alone: the
Gerbers, the netlist, the reviewed schematic and the manufacturing package keep the hash they
were approved under.

### 13. The checks apply to both, with one deliberate asymmetry

An alternative is subject to the same checks as a primary selection (decision 5): it must name a
resolvable part with an `mpn`, its `params` declaration must cover the family's, and its
`footprint` must equal the family's.

The difference is what a violation means. A violation in a **primary** selection is an error: it
is part of the design's truth and the build is wrong. A violation in an **alternative** is a
**warning**: the alternative is advisory, and a broken alternative must not stop a board from
being built — but it must not pass silently either, because an alternative with the wrong
footprint is exactly the kind of mistake a buyer would not catch.

A **syntax** error in an alternatives file is an error like any other malformed source file, and
it stops the write ([ADR-0023](0023-ir-layer-on-disk.md) decision 3). The asymmetry is about the
content of a row, not about whether the file parses.

### 14. How a change to the alternatives is tracked

Three different questions, three different mechanisms; no new mechanism is invented for any of
them.

| Question | Answered by |
|---|---|
| Who changed what, and when | The version control history of `assets/procurement/alternatives/*.teda`. The project stores no timestamps and no author fields of its own (the same rule `project.toml` follows). |
| Did the purchasing state change at all? | The `advisory_hash`. It moves exactly when the alternatives shard changes. |
| Which part of it changed? | The shard's `sha256` in the manifest says *that* it changed; the canonical JSON and the source file say *what* changed. |
| Is a procurement annex I am holding still current? | `texteda check` compares the `advisory_hash` stamped on the annex with the current one and reports a stale annex. |

The last row is the one that turns the second hash into a working mechanism rather than a
number nobody reads.

A procurement file may also carry a `revision` counter — a human-readable label for the
purchasing state ("the BOM was issued against purchasing state 7"). It is a label, not a seal:
a counter can be edited by hand without leaving a trace, and the hash is what detects that.

### 15. A selection may name a part the design does not use

A selection is a statement about what to buy, and a project may buy ahead of the drawing: the
part for the next revision is selected before the next revision's schematic exists. That is
allowed, and it is reported as a **warning** ("this selected part is not used by any board of
this project"), because the common case is a mistake — a selection left over from a deleted
board, or a part number that does not exist in any library.

The alternative would be to make it an error, which would forbid buying ahead, or to say nothing,
which would let a stale selection rot in the file. A warning is the middle: it does not stop the
build and it does not stay silent.

## Consequences

- **The BOM has three kinds of line**, and they are distinguishable: a part line (bought as
  itself), a family line with a selection (bought as the named part), and a family line
  without one (not yet sourced).
- **The acquisition binding lives in one place.** The design says what it needs; the
  procurement layer says what is bought; the library says what a part is. No file says two of
  those at once.
- **A family means the same thing to a board designer and to the compiler.** It is one land
  pattern, one pin table, one specification — not "one function, several implementations". The
  question of whether two packages are functionally interchangeable belongs to the firmware,
  and this project does not answer it.
- **The layer is small.** One section, one row per family line, no commercial fields. It can be
  read in one sitting, which is what a purchasing handover needs.
- **Re-sourcing no longer invalidates the build.** Opening a second vendor, or dropping one,
  changes the alternatives shard and the `advisory_hash`; the project hash, the review and every
  artifact that carries it stay valid. Only the *primary* selection moves the build, and moving
  it is a deliberate act that says "the board is now built from a different part".
- **The BOM has a normative part and an annex, and both are reproducible.** The exported BOM is
  built from the IR and states what is bought; the annex — the second sources — is built from
  the alternatives shard and is stamped with `advisory_hash`. Neither is read out of the source
  by hand.
- **The price**: the selection table is another file per board to keep in step with the
  design, and a family requirement that changes specification needs its row changed too.
- **The price**: two boards that buy the same part write it down twice. That is the price of
  board-scoped selections, and it is the price of not having a selection to go stale: a shared
  default would be one more thing to keep in step.
- **The price**: a project that wants its BOM to be a purchase order has to join it with
  purchasing data outside this project. That is the boundary this record draws, not an
  omission.

## Open Points

All closed on 2026-10-22.

1. **The syntax of the row.** **Closed**: `<family> <params…> -> <part>`. The requirement was
   that a row can be read without resolving the family and that the parameters stay in the
   family's declared order; `->` satisfies both, and the alternatives (part id first, a fixed
   column shape, a synthetic requirement id) were rejected — see decision 2.
2. **Whether one selection set per project is enough.** **Closed**: a selection is scoped to a
   board, and a board built two ways is two variants
   ([ADR-0002](0002-board-pages-and-bom.md)), not two sets. No set id, no flag.
3. **Whether a selection may point at a part that the design does not use.** **Closed**: yes,
   with a warning — decision 15.
4. **How the BOM renders an unsourced line.** **Closed**: an empty MPN cell and an `unsourced`
   marker in the comment column — decision 4.
5. ~~**Whether an alternative may name a part whose `provenance` is `generated`.**~~ **Closed
   (2026-10-22)**: the same rule as the primary — a warning, and an error in strict mode. An
   alternative from an unreviewed library carries the same risk as the primary it substitutes
   for, and the warning tells the reader which library item to check.

## Alternatives Rejected

- **Put the manufacturer part number on the family** (`preferred_mpn`). Rejected in
  [ADR-0027](0027-device-parts-families-and-library-dependencies.md): it puts a vendor's
  commercial choice inside a shared fact asset and collapses the family/part distinction.
- **Put the selection in the `instances` row** — `C1 cap-tantalum-7343 220uF 10V avx-taj-220u-10v`.
  It puts a purchasing decision in the schematic, makes the row length depend on the family and
  the variant, and makes a selection that applies to every instance of a family impossible to
  write once. The decisive reason is the key: the instance row is keyed by `refdes` and holds a
  placement, the selection is keyed by (family, parameters) and holds a BOM line.
- **Put the selection in the `component` file of the family** — i.e. the family names its own
  preferred part. This is the same as `preferred_mpn`, with an extra indirection, and it makes a
  shared library carry one project's sourcing decision.
- **Make the procurement layer a library.** A library is a shared set of facts; a selection is a
  project's decision about a purchase. Publishing selections would make the library's content
  change every time someone re-sourced a capacitor.
- **Derive the selection from the part names in the design**, i.e. make every passive a part.
  Rejected in [ADR-0027](0027-device-parts-families-and-library-dependencies.md): selection is a
  late decision, and an agent working from a schematic cannot name a vendor part number.
- **Put the alternatives in the project hash as well.** Then opening a second vendor changes the
  project hash, and every review, every manufacturing package and every artifact carrying the
  hash has to be redone — for a purchasing decision that changed no electrical fact. Rejected
  in decision 12.
- **Keep the alternatives out of the IR entirely**, as source-only content. Then the project has
  two kinds of truth, and the alternatives — facts about parts, which are checked nowhere — rot
  in silence. Rejected in decision 12: facts belong in the IR, and the hash question is
  answered separately.
- **Put the primary and the alternatives in one file.** Then the file has one classification,
  and changing a second source moves the project hash and invalidates a manufacturing package
  whose bytes did not change. The two files are what the two hash standings require.
- **Put the primary selections in the board's schematic file.** The two would both be normative,
  so the hash is not the obstacle — the obstacle is that changing a part number then shows up in
  the diff of the circuit, where a reviewer looking for design changes will not find it, and
  the schematic type would carry a second concern. The selection is a decision, and it lives in
  its own file.
- **Express the second sources as additional selection sets** (`default`, `second-source`) instead
  of as alternatives. A set is a whole build; a second source is one line. Making every second
  source a whole set would multiply files and make the primary/secondary relation impossible to
  state. Rejected in decision 11.

## Addendum (2026-10-22b): a BOM line that requires no purchase

Amends decision 4.

### The question

A family line in the BOM is in one of two states today: it points at a part (bought), or it has
no part number and is marked **unsourced** (not chosen yet). But a board also contains things
that are **never bought** — a bare test pad, a fiducial pad, a printed mark. Calling those
`unsourced` says the wrong thing: it tells the reader that somebody forgot, when in fact nobody
was ever going to. On a board with a dozen test points that is a dozen warnings that mean
nothing.

The shortcut — writing `n/a` in the MPN cell — is closed by decision 4: the exported BOM is
consumed by a parts-ordering system, and a cell that reads `n/a` would be ordered as if it were
a part. The MPN cell stays empty; the marker goes in the comment column.

### D9. A selection has three states

| State | How it is written | BOM | `texteda check` |
|---|---|---|---|
| bought | `family <params…> -> part` | MPN cell holds the part number, no marker | — |
| not yet sourced | no selection row | MPN cell empty, marker `unsourced` | warning |
| requires no purchase | `family <params…> -> not-required` | MPN cell empty, marker `not-required` | no warning |

The state belongs in the **selection**, not in the family: the same family — a one-pin pad — is
bought as a real test-point component on one board and left as a bare pad on another. A family
cannot know which one it is, and a project that wants it both ways must be able to say so.

`not-required` is a reserved target: it is not a part id, so a selection can never point at it
by accident, and the check that a selection resolves to a real part has one documented
exception.

### Why the state is named `not-required`

`not-purchased` was the first name for this state, and it says the wrong thing: it reads as
"has not been purchased", which is the *unsourced* state wearing a different hat. The state is
not about the progress of buying; it is a fact about the line: **nothing has to be bought here**.
So the name states the fact — `not-required` — and the BOM marker uses the same word. The two
states then read apart at a glance: `unsourced` is a gap to close, `not-required` is a line with
no part in it.

### Where the marker sits: a status of its own, not a note

The status is machine output and the comment is a human's text; they do not share a cell. So the
BOM the project produces has **a `status` column of its own** — `bought`, `unsourced` or
`not-required` — beside a `note` column that holds free text. A tool reads the status without
parsing prose, and a human can write a note without disturbing it.

The part-number cell stays empty in both cases (decision 4: the BOM is consumed by a
parts-ordering system, and a cell that reads `unsourced` would be ordered as if it were a part).

The ordering-shaped export is a different artifact and keeps the columns the ordering format
specifies ([ADR-0006](0006-jlc-prototype-delivery.md) decision 4: `Comment` / `Designator` /
`Footprint` / the part number / `Quantity`) — no column is added to a format we do not own. There
the marker goes into the format's own `Comment` cell, which is that field's purpose, and the
empty part number already keeps the row from being ordered.

### What did not change

- The **component file** still does not carry `mpn n/a`. A family has no manufacturer part
  number; that is what a family is
  ([ADR-0027](0027-device-parts-families-and-library-dependencies.md)). A sentinel string in a
  typed field would flow into the procurement lookup as if it were a part number.
- The **IR** keeps the absence as an absence. The marker is a rendering of the state, not the
  state itself.

## Addendum (2026-10-23): the vocabulary of the two ends of a selection

Amends the vocabulary of decisions 1 to 6 and of the addendum of 2026-10-22b.

Where this record says **family**, read **generic**
([ADR-0037](0037-device-kind-vocabulary-and-one-device-directory.md)). A selection binds a
**generic device** — what the design requires — to a **part** — what is bought — and the
generic is now written `kind: generic` in its component file. The row shape does not change:
`<generic_id> <parameter_value…> -> <part_id>`, and the BOM line key is still the generic's id
plus its declared parameters, in the generic's declared order.

Nothing else moves. The selection is still a project-local decision, the land pattern is still
a hard constraint, a part is still its own answer, and the component file still carries no
`mpn` for a generic — that is what a generic is.

## Addendum (2026-10-28): the version line is the language's, not the type's

The sentence above — "The type exists since language **0.9** and has its own version line, as every
description type does" — described the world until 2026-10-27. [ADR-0056](0056-one-language-version-number.md)
merged the nine description-type version lines into one language version number: every `.teda` file
declares the language version (`0.9.1`), and the only per-type fact left is the floor — the
`procurement` type exists since language `0.9`, so a file below `0.9` is refused.

Nothing else in this record moves: the primary / alternatives split, the hash standing of the two
shards, and the selection syntax are unchanged.
