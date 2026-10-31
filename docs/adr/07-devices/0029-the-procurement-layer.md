# ADR-0029: The Procurement Layer — Which Part to Buy Is a Project-Local Decision

Status: Accepted
Date: 2026-10-22
Scope: Decides: how a design's generic requirement becomes a purchasable part, how the BOM is keyed and counted, and how variants and second sources sit relative to that. Does not decide: the language's rating vocabulary — see ADR-0025; nor the device kinds — see ADR-0024.
Related: [ADR-0008](../03-project/0008-project-tree-has-owners.md), [ADR-0015](../04-schematic/0015-flattening-and-the-net-set.md), [ADR-0021](../06-manufacturing/0021-the-manufacturing-output-path.md), [ADR-0022](../06-manufacturing/0022-jlc-prototype-delivery.md), [ADR-0025](0025-device-vocabulary-and-parameter-roles.md)
Impact: `spec/procurement.md`; `spec/teda.md` §6, §11; `schemas/ir/**`; `packages/core` (the procurement checks); `packages/cli` (the `texteda bom` command); `packages/ir` (the diagnostic code registry)

## Background

A design says what it needs: a 10 µF capacitor, ±10 %, 16 V, in a 0402. It does not say which
part that is. The gap between the two is not a technical question — it is a purchasing decision,
and it is a decision **per project**: the same 0402 10 µF line is a Yageo part in one board and an
AVX part in another, for reasons of price, stock, or a distributor's catalogue.

Two earlier records made that split visible but left it open. The device-kind record closed a
part's identity: a part declares no `params`, and the parser enforces it. The BOM-counting rule
said a BOM row is keyed by (component, parameters, variant status) and that the quantity is the
physical count — so a BOM line is a *requirement*, not a purchase, and the purchase has to live
somewhere else. The procurement specification then required a part to declare the generic's
roles, which the device-kind record forbade. The two rules could not both stand.

The other half of the problem is standing. A second source for a line — the substitute a buyer
may order when the primary is unavailable — is a real fact, and it is checked like a real fact.
But it is not a change to the design: the Gerbers are byte-identical, and a build identity that
moved because purchasing opened a second vendor would make every re-sourcing exercise look like a
design change and invalidate a manufacturing package that nothing had changed.

## Decision

### D1. `procurement` is a new description type, scoped to a board

A procurement description carries a header like every other description:

```text
version 0.9.1
procurement mcu-board
role primary
```

The file id is the **board** the selection belongs to. A selection is board-scoped because a BOM
is a board's: the procurement layer is the part of the project that says what this board is built
from. The `procurement` type exists since language `0.9`, and a file below that floor is refused.

The `role` scalar says which of the two files this is, and it must agree with the directory the
file is in. The two files have the same grammar; only the role and the standing differ.

The files are project-local: they are not libraries, they are not published as a shared asset, and
what the contract layer covers is the **format**, not any project's selections. Their place in
the tree is `assets/`, beside the project's own device assets:

```text
assets/procurement/primary/<board_id>.teda        # the primary selections — normative
assets/procurement/alternatives/<board_id>.teda   # the second sources — advisory
```

A board's procurement state is **two files**, because its two halves have different standing. The
split is a file-level property, not a section inside one file, so that each file produces exactly
one shard with exactly one classification.

The split was questioned on the grounds that an alternative is "only an MPN" and does not deserve
a file of its own. It does, and the reason is not the amount of content: the two halves have
different **hash standing**. A different primary part is a different build; a different second
source is not.

**A selection may only name the project's own source.** A derived file *shadows* the library
item it overrides, so a row may not name a shadowed library item: that item is no longer this
project's description of the device. A selection naming the project's derived copy is correct, and
the BOM prints that copy's part number.

**One board, one set of selections, and no second one.** A board that is built two different ways
is two variants of that board, and a variant names parts directly. A second selection set would
have been a second way of saying the same thing, with a flag to choose between them.

### D2. One row per generic line: `<generic> <params…> -> <part>`

```text
selections
  cap-tantalum-7343 220uF 10V -> avx:avx-taj-220u-10v
  res-th-0402 10k 1% -> yageo-rc0402fr-0710kl
  ind-shielded-6045 10uH 20% -> bourns:l6045-103K-2200
```

The left side is the **BOM line key**: a generic id followed by the values of the generic's
declared `params`, in the generic's declared order — the same shape as an `instances` row. The
right side is the chosen part: a project-owned asset by its bare id, a vendored library item by
its qualified id.

The `->` separator exists because both sides are open-ended: the parameter list has a length that
depends on the generic, so a parser cannot tell where the parameters stop without resolving the
generic first. `:` is already the nets-section token and `=` already binds a type to a value;
`->` is a third use that says "resolves to" and nothing else.

**The row is not the `instances` row.** It was asked whether the selection could simply be a
column of the instance row, and it cannot, for a reason that is about keys rather than taste: an
`instances` row is keyed by refdes and holds one *placement*, while a selection is keyed by
(generic, parameters) and holds one *BOM line*. Writing the selection into the instance row would
mean writing the same selection on every one of the twenty instances of a generic, and changing a
part number would mean changing twenty rows. A selection that applies to every instance of a
generic has to be written once, and a table keyed by the BOM line is where it is written once.

### D3. A part needs no row — it is its own answer

A selection always points **from a generic to a part**. A device the design names as a part is
already bought as itself; adding a row for it would be a second way of saying the same thing.

The rule is therefore: **the selection table contains one row per generic BOM line, and every
part BOM line stands alone.** If the design names `stm32f407vgt6`, that part is the purchase, and
the procurement layer says nothing about it.

### D4. A selection has three states

| State | How it is written | BOM | `texteda check` |
|---|---|---|---|
| bought | `generic <params…> -> part` | part-number cell holds the part number, no marker | — |
| not yet sourced | no selection row | part-number cell empty, marker `unsourced` | warning |
| requires no purchase | `generic <params…> -> not-required` | part-number cell empty, marker `not-required` | no warning |

A board may legitimately be designed but not yet sourced. The BOM then carries the line with no
part number and marks it **unsourced**, and `texteda check` reports every unsourced generic line
as a **warning**: the design is valid, the procurement is incomplete, and the two must not be
confused. This is deliberately not an error — a gate that rejects unfinished sourcing would make
the tool unusable during the phase where the circuit is still moving.

**How an unsourced line is rendered.** The part-number cell is **empty** and the marker
`unsourced` goes into the status column. It does not go into the part-number cell: the exported
BOM is consumed by a parts-ordering system, and a part number that reads `unsourced` would be
ordered as if it were a part. An empty cell plus an explicit marker is both honest and consumable.

**The third state exists because a board contains things that are never bought** — a bare test
pad, a fiducial pad, a printed mark. Calling those `unsourced` says the wrong thing: it tells the
reader that somebody forgot, when in fact nobody was ever going to. On a board with a dozen test
points that is a dozen warnings that mean nothing.

The state belongs in the **selection**, not in the generic: the same generic — a one-pin pad — is
bought as a real test-point component on one board and left as a bare pad on another. A generic
cannot know which one it is, and a project that wants it both ways must be able to say so.

`not-required` is a reserved target: it is not a part id, so a selection can never point at it by
accident, and the check that a selection resolves to a real part has one documented exception.

**Why the state is named `not-required`.** `not-purchased` was the first name, and it says the
wrong thing: it reads as "has not been purchased", which is the *unsourced* state wearing a
different hat. The state is not about the progress of buying; it is a fact about the line:
**nothing has to be bought here**. `unsourced` is a gap to close, `not-required` is a line with
no part in it.

**The marker sits in a status column of its own, not in a note.** The status is machine output and
the comment is a human's text; they do not share a cell. A tool reads the status without parsing
prose, and a human can write a note without disturbing it. The ordering-shaped export is a
different artifact and keeps the columns the ordering format specifies — no column is added to a
format we do not own. There the marker goes into the format's own comment cell, which is that
field's purpose.

### D5. What a selection must satisfy

A row is checked at compile time:

| Check | Why |
|---|---|
| The generic resolves, and it is a `kind: generic` | A part may not be re-selected |
| The part resolves, and it is a `kind: part` | A generic may not be selected as a part |
| The part has a part number | Required of every part; this is what makes the row purchasable |
| The part's ratings cover the generic's roles — same names, same types | Otherwise the specification in the row cannot be carried by the part, and the BOM line would silently lose a column |
| The part's `footprint` equals the generic's `footprint` | The land pattern is a **hard constraint** of the generic; a selection that changes it is not a selection, it is a design change |
| The part is not a library item the project has shadowed | A derived copy replaces the library item it overrides; selecting the shadowed item would put the same device in the BOM twice |

The last two are the checks that make the layer worth having: they catch the case where a
selection quietly alters the board.

### D6. The land pattern is a hard constraint, and it is ours to define

The footprint constraint above is not a convenience; it follows from where this project's boundary
is.

A device that is offered in several packages — one die, one function, several land patterns — is a
statement made in the **embedded** domain: that the variants are functionally interchangeable,
that the firmware can target them alike, that the peripherals line up. This project draws boards.
It decides nothing about firmware, peripheral equivalence or pin multiplexing, and it has no
business writing "these two packages are the same device" into a generic definition.

So the generic is defined the way a board designer defines it: **one land pattern, one pin count,
one pin table.** The consequence is a rule that holds everywhere in this project:

> **The footprint is part of the generic's identity, not a parameter of it, and never something a
> selection may change.**

If a project genuinely needs the same functional requirement to be realisable on two land
patterns, it declares two generics — one per land pattern — and selects between them at the design
level, where the difference is visible, rather than inside the procurement layer, where it would
be invisible.

### D7. The BOM row key is uniform

> **A BOM row is keyed by `(component_id, parameters)`. A part has an empty parameter set.**

The distinction survives — a part row has no parameters to read — but the key is one shape, and
every consumer of the BOM (netlist, KiCad export, manufacturing package) can treat it as one
thing.

The key contains neither refdes nor instance id: **the aggregation key is the device and its
specification, and the quantity is the physical count.** Two instances of the same 0402 10 kΩ 1 %
resistor are one row with quantity 2. The quantity is the count of the board's parts, so a part
that is not fitted in a variant does not enter that variant's BOM at all.

Rows for generic passives are parameter rows (e.g. `10k ±1% 0402`), not part-number rows, and
they merge with a part row only when the key says so.

### D8. Variants do not fork the procurement layer

A variant may substitute a part. That substitution is a **design-level** statement and names a
part; therefore the variant's BOM line already carries a different `component_id`, and it is a
part, and it needs no selection.

The procurement layer is therefore variant-independent, and so is board-scoped in the strong
sense: a board built two different ways is two variants, not two selection sets. If two variants
of one board need different vendors for the same generic requirement, that is expressed as two
parts — one per variant — not as two rows in the selection table.

### D9. Selecting an unreviewed library part

A library part may be selected. If its provenance is `generated` (not human-reviewed), the
selection is reported as a warning, and it is an error in strict mode. A project that has checked
a library part against its datasheet derives a reviewed copy and selects that.

### D10. Commercial facts are out of the language

Packing form, supplier, price, minimum order quantity and lead time are **not** in the
procurement description. They are commercial facts about a purchase, not facts about the design,
and a BOM that carries them becomes a document that changes weekly and belongs to purchasing.

The manufacturing output stays neutral for the same reason: the technical description says *what is
needed*; procurement says *what is bought*. If a project wants those facts attached to the
exported BOM, it keeps them beside the project — a spreadsheet, a purchasing system — and the
exported BOM stays reproducible.

### D11. The IR and the two hashes

The procurement descriptions compile to two shards:

| Source | Shard | Classification |
|---|---|---|
| `assets/procurement/primary/<board_id>.teda` | `boards/<board_id>/procurement.json` | normative |
| `assets/procurement/alternatives/<board_id>.teda` | `boards/<board_id>/procurement-alternatives.json` | advisory |

The primary shard holds the mapping from a generic key to a part id, and it enters the project
hash: a different primary part is a different build.

The primary is a **board** shard, so it also enters the board hash. That is the point of scoping
a selection to a board: the part a board is built from is part of that board's identity, so
changing it invalidates the board's review and the artifacts that carry the board hash.

The alternatives shard holds the second sources, and it does not enter the project hash. It
enters the **advisory hash** instead.

### D12. One primary selection, and any number of alternatives

A generic line has **one primary selection** — the part the build uses — and **zero or more
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

A generic line with alternatives but no primary is **unsourced** (D4): alternatives do not make a
line sourced, because nothing has been decided.

### D13. The alternatives are in the IR, and out of the build identity

The alternatives are **facts**, and facts live in the IR: they are compiled into the alternatives
shard, they are checked on every compile, and they are traceable. They are **not** part of the
build identity: they do not enter the project hash, and no built artifact depends on them.

The asymmetry is deliberate and is stated rather than left implicit:

| | Enters the IR | Enters the project hash | Affects built artifacts | Stamped with |
|---|---|---|---|---|
| Primary selection | yes | yes | yes | `project_hash` |
| Alternative | yes | no | no | `advisory_hash` |

Two consequences follow.

First, nothing is left outside the truth. An alternative that names a discontinued part, or one
whose footprint has drifted, is a fact in the IR and is checked on every compile; it does not rot
unnoticed because no tool consumes it.

Second, the purchasing state has its own chain. The procurement annex — the list of second
sources, produced from the alternatives shard — is stamped with `advisory_hash`, not with
`project_hash`. Re-sourcing moves the purchasing chain and leaves the build chain alone: the
Gerbers, the netlist, the reviewed schematic and the manufacturing package keep the hash they
were approved under.

### D14. The checks apply to both, with one deliberate asymmetry

An alternative is subject to the same checks as a primary selection (D5): it must name a
resolvable part with a part number, its ratings must cover the generic's, and its `footprint` must
equal the generic's.

The difference is what a violation means. A violation in a **primary** selection is an error: it
is part of the design's truth and the build is wrong. A violation in an **alternative** is a
**warning**: the alternative is advisory, and a broken alternative must not stop a board from
being built — but it must not pass silently either, because an alternative with the wrong
footprint is exactly the kind of mistake a buyer would not catch.

A **syntax** error in an alternatives file is an error like any other malformed source file. The
asymmetry is about the content of a row, not about whether the file parses.

### D15. How a change to the alternatives is tracked

Three different questions, three different mechanisms; no new mechanism is invented for any of
them.

| Question | Answered by |
|---|---|
| Who changed what, and when | The version control history of `assets/procurement/alternatives/*.teda`. The project stores no timestamps and no author fields of its own. |
| Did the purchasing state change at all? | The `advisory_hash`. It moves exactly when the alternatives shard changes. |
| Which part of it changed? | The shard's `sha256` in the manifest says *that* it changed; the canonical JSON and the source file say *what* changed. |
| Is a procurement annex I am holding still current? | `texteda check` compares the `advisory_hash` stamped on the annex with the current one and reports a stale annex. |

The last row is the one that turns the second hash into a working mechanism rather than a number
nobody reads.

A procurement file may also carry a `revision` counter — a human-readable label for the purchasing
state ("the BOM was issued against purchasing state 7"). It is a label, not a seal: a counter can
be edited by hand without leaving a trace, and the hash is what detects that.

### D16. A selection may name a part the design does not use

A selection is a statement about what to buy, and a project may buy ahead of the drawing: the
part for the next revision is selected before the next revision's schematic exists. That is
allowed, and it is reported as a **warning** ("this selected part is not used by any board of
this project"), because the common case is a mistake — a selection left over from a deleted board,
or a part number that does not exist in any library.

The alternative would be to make it an error, which would forbid buying ahead, or to say nothing,
which would let a stale selection rot in the file. A warning is the middle: it does not stop the
build and it does not stay silent.

## Consequences

- **The BOM has three kinds of line**, and they are distinguishable: a part line (bought as
  itself), a generic line (bought through a selection), and a line that requires no purchase.
- **A purchase decision is a project fact, not a device fact.** The same requirement is satisfied
  by different parts in different projects, and the substitution is visible in the project.
- **The land pattern cannot drift through procurement.** A selection that changes the footprint is
  a design change, and the check says so.
- **Re-sourcing does not invalidate a build.** The second sources move the advisory chain and
  leave the build chain alone.
- **A BOM is reproducible.** It carries no price, no stock and no lead time, so it does not change
  weekly.
- **An unfinished purchase is visible but not fatal.** A design under construction produces
  warnings, not errors.
- **A variant is a design statement.** It names parts directly, and the procurement layer has
  nothing to say about it.
- **The IR holds both halves.** The alternatives are facts, so they are checked; they are simply
  not part of the build identity.
