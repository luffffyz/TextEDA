# ADR-0028: Libraries Are Unverified Facts; Provenance, Disclaimers, and Derived Overrides

Status: Accepted
Date: 2026-10-22
Related: [ADR-0027](0027-device-parts-families-and-library-dependencies.md), [ADR-0010](0010-footprint-and-3d-model-ownership.md), [ADR-0013](0013-reference-project-self-built-libraries.md), [ADR-0015](0015-licensing-and-open-standard.md), [ADR-0016](0016-diagnostic-error-codes.md)
Impact: `teda.md` §6 (the `component` description type); `AGENTS.md` §4.5, §10; `packages/ir` (the `provenance` field on the `component` shard); `packages/parser`; `packages/cli` (`lib:verify` on external libraries, a strict-mode flag); `packages/core`; `docs/backlog.md` F10

## Background

[ADR-0027](0027-device-parts-families-and-library-dependencies.md) makes external libraries a
normal dependency: a project references a library of parts instead of transcribing them. The
library is written by somebody else, and — for the libraries that matter most — by an agent.

That is the expected shape of this ecosystem. A datasheet is a PDF; an agent can read a hundred
datasheets in an evening and produce a hundred part definitions; a human reviews a handful. The
parts that get written this way are *not* more authoritative than the reference project's
hand-written ones. They are cheaper.

The temptation this creates is to treat a library as a trusted source: the project references a
part, the part is what the library says it is, and any discrepancy is the library's problem. That
temptation is wrong in a way that matters for hardware. A wrong pin table produces a board that
silently does not work, and the failure surfaces after fabrication, not at compile time.

So the trust model has to be stated rather than assumed:

- A library guarantees **structure**, not **fact**. It guarantees that its files parse, that its
  contracts validate, that its symbols, footprints and pin tables are mutually consistent. It
  does not guarantee that pin 47 of `stm32f407vgt6` is `PD13`.
- A project is responsible for the facts it builds on. If the library is wrong, the project must
  have a way to say so, and the correction must be visible.

Both halves have to be expressible in the language and the tooling, or the promise the ecosystem
makes to its users — "the machine read the datasheet for you" — is a promise nobody can keep.

## Decision

### 1. Every part states its provenance

A `component` may declare `provenance`, with two values:

| Value | Meaning |
|---|---|
| `generated` | Transcribed mechanically from a datasheet, not individually reviewed by a human |
| `reviewed` | Checked by a human against the datasheet, against a stated criterion |

A component that declares nothing is treated as `generated`: the absence of a claim is not a
claim of review. A `reviewed` component additionally states `verified_by` and `verified_on`, so
that the review is attributable and dated.

`datasheet` remains the source pointer, and is required for every `generated` component whose
kind is `part`: a transcription without a source document cannot be checked by anyone, including
the agent that produced it.

### 2. A library carries a manifest and a disclaimer

A library publishes a `lib.toml` next to its asset files:

```toml
name       = "stm32l4"
version    = "1.3.0"
generated  = true
reviewed   = false
disclaimer = "Facts are transcribed from manufacturer datasheets by an agent and have not been human-reviewed. Verify pin numbering, electrical types and ratings against the datasheet before manufacturing."
```

The disclaimer is part of the library's published content, not of its hosting page. The rule it
states is the one this record adopts: **a library is provided as-is, without warranty of
accuracy; the consuming project is responsible for verifying the facts it relies on before
manufacturing.** Structural validity is guaranteed; factual correctness is not.

The manifest is required for libraries and optional for a project's own assets. It also carries
the library version, which is what a project pins alongside the content hash.

### 3. Libraries are read-only; corrections are derived

A library is a shared dependency. It cannot be edited in place: two projects may depend on the
same content hash, and an in-place edit would silently change the meaning of that hash for
everybody.

A project that needs a different fact declares a **derived component** — a project-local file
that states the relation explicitly:

```text
version 0.9
component stm32f407vgt6
kind         part
mpn          STM32F407VGT6
overrides    stm32l4:stm32f407vgt6
provenance   reviewed
pins
  1  PE2  bidirectional
  ...
```

The `overrides` field names the library item this file replaces, and the derived file must
declare a complete set of facts — it is not a patch. A derived file may change the pin table
freely: correcting a wrong pin is exactly what it is for. The pin-table identity boundary of
[ADR-0027](0027-device-parts-families-and-library-dependencies.md) decision 3 governs what a
*design* may treat as one device, not what a *record* may say; a correction produces a derived
file, not a new kind of device. Three properties follow:

- The relation is explicit: a reader can ask "how does this project differ from the library?"
  and get an answer by diffing the two files. **Amended by the 2026-10-22 addendum**: the derived
  file also *shadows* the library item inside this project, so the project's IR never carries
  two descriptions of one device.
- The library keeps its meaning; the content hash stays valid for every other project.
- The derived file carries its own `provenance`: a project that reviewed the datasheet can say
  `reviewed`, and that claim is attributable to the project rather than to the library.

### 4. Overriding a family is allowed on the same terms

A project may derive a family as well as a part, with the same `overrides` mechanism. A derived
family is a project asset that happens to replace a library family; it does not modify the
library. **Amended by the 2026-10-22 addendum**: geometry (`symbol` / `footprint`) is never
derived, and a derived file shadows the item it replaces.

### 5. Strict mode

A project may declare that it accepts only library items whose `provenance` is `reviewed`. In
strict mode, a reference to a `generated` library item is an error, reported with the library
name, the item id and the datasheet pointer, so that the failure is actionable rather than
mysterious.

Strict mode is opt-in and off by default: most projects would rather have a generated part and
check it themselves than have no part at all.

### 6. The structural gate applies to libraries too

Library content is validated with the same tooling as a project: the files must parse, the
contracts must validate, and the three-way alignment of symbol pin numbers, footprint pad
numbers and component pin numbers must hold for every asset in the library. `lib:verify` runs
against a library directory as well as against a project.

This is what makes the disclaimer defensible. The library guarantees the things that can be
guaranteed mechanically, and says so precisely, instead of saying nothing at all.

### 7. Libraries are not part of the contract layer

The contract layer — `spec/`, `schemas/`, `examples/`, `tests/`, `teda.md` — stays open forever
([ADR-0015](0015-licensing-and-open-standard.md)). A library is data, not contract: it is
versioned, licensed separately, and may carry a disclaimer. Adding a library to the repository
therefore adds its licence and attribution to the project's obligations, and vendoring a
third-party library into the repository is an explicit act with a licence consequence, not a
default.

### 8. Addendum (2026-10-22): trust is a field, and the datasheet has exactly one declaration

Amended by [ADR-0031](0031-project-tree-ownership-model.md) decisions 4, 5 and 7.

- **The trust channel is a field of the reference, not a directory.** A `libref` carries
  `channel = official | third-party`. An official library and a third-party library are
  consumed by the same mechanism and differ only in the policy applied to them; a directory per
  trust level would put the difference in the layout instead of in the data, and would have to
  be duplicated across every kind of material.
- **The content hash pins a vendored library.** A library is vendored under `external/libs/<name>/`
  and the `content_hash` declared in its `libref` must equal the hash computed over that
  subtree. A mismatch is an error: the vendored copy was edited without the anchor being moved.
  The self-built library of [ADR-0010](0010-footprint-and-3d-model-ownership.md) decision 2 no
  longer needs a hash of its own — the project's own assets are covered by the project hash, and
  a hash over them would be a second number for the same bytes.
- **The datasheet is declared once.** The `datasheet` field of the component is the only
  declaration of where a part's facts came from. The document itself may live in
  `external/cache/` and is never in the repository; there is no separate declaration file, no
  separate tree, and no second place to update when the source pointer changes.

## Consequences

- **The ecosystem can be honest.** "Generated from the datasheet, not reviewed" is a statement a
  machine can make and a reader can act on. "Trust the library" is not.
- **Corrections are possible without forking.** A project that finds a wrong pin table derives a
  reviewed copy and says where it came from. The library stays correct for everybody else.
- **The review effort becomes visible.** `provenance` makes it possible to see how much of a
  library has actually been checked, and a strict-mode project can refuse to build on the rest.
- **A library author is not exposed.** The disclaimer states the actual position: facts were
  transcribed, and the consumer verifies them. This is what allows agents to produce libraries at
  scale without a human reading every line first.
- **The price**: every published part carries provenance metadata, and a reviewed library is
  maintained rather than generated once. That maintenance is real work, and it is the work that
  the disclaimer says the consumer is doing instead.
- **The price**: a derived component duplicates facts. Duplication is normally what this project
  fights, but here the duplication is the record of a correction, and it is explicit and
  attributable.

## Alternatives Rejected

- **Guarantee library accuracy and forbid overrides.** This requires a human to have read every
  datasheet, which is the cost the ecosystem is trying to avoid, and it makes a wrong library
  unfixable except by a new release that every project must wait for. Rejected.
- **Let libraries be edited in place, locally.** The content hash would stop meaning what it
  means, and two projects depending on the same library would disagree about what it says.
  Rejected in favour of derived copies.
- **Allow patch-style overrides** (a list of changed fields merged into the library item). It
  saves duplication, but the merged result is not what any file says, so the reader has to
  evaluate the merge to know the truth. A complete derived file is longer and says exactly what
  it is. Rejected.
- **Keep provenance in the library manifest only, per library.** Too coarse: a library may hold
  a thousand parts of which twelve have been reviewed, and the manifest cannot say which twelve.
  Rejected in favour of per-component provenance with a library-level summary.
- **Make strict mode the default.** It would make the common case — generate, then check the
  parts that matter — impossible. Rejected; the flag stays opt-in.

## Open Points

- The registry and distribution format, including how `content_hash` and library versions are
  published and consumed, is not decided here (`docs/backlog.md` F10).
- ~~Whether a project may override a library's `symbol` or `footprint`~~ — decided in the
  2026-10-22 addendum below: no. A geometry override creates a second source for geometry that
  every other device draws from.
- ~~How a reviewed part is signed, if at all~~ — decided in the 2026-10-22 addendum below
  and in [ADR-0033](0033-review-records-and-attribution.md): reviews are not signed; at most a
  library-level signature over the library's `content_hash` would ever make sense, and it is
  not done.

## Addendum (2026-10-22): one device, one source

Amends decision 3 and decision 4, and closes the open point about overriding geometry.

### 1. An override is a last resort, and the preferred path is upstream

A project that finds a wrong fact in a library has two ways to fix it: correct it upstream and
bump the library's pin, or derive a project-local copy. **The first is the expected path.** The
second exists so that a project is not blocked by someone else's release cycle — not because two
sources are a good arrangement.

The reason is not taste. A derived copy means the same device has two descriptions in the world:
the library's and the project's. Everything downstream that asks "what is this device?" — the
BOM, the ERC, the exporter, the renderer — then has two answers, and the project has to remember
which one it meant. A BOM with both the library's part and its corrected copy is a BOM with the
same device twice.

So the derived file is now an **advisory** in the check report: the project says out loud where
it disagrees with the library it depends on.

### 2. A derived file shadows the library item

The relation is not "two files that happen to describe the same device". It is **one source in
this project**:

- A derived file **replaces** the library item it overrides, inside this project. The library
  item stays in the vendored library, where it is still correct for every other project.
- A shadowed library item may **not be referenced** anywhere in the project. A reference to it is
  an error: the project has already said which description of that device it uses.
- The relation stays explicit. The derived file records what it overrides, and the difference
  against the library is still computable by any tool that has the library. What changes is that
  the project's own IR never carries both.

### 3. Geometry is never overridden

A project may not derive a library's `symbol` or `footprint`.

The reason is the blast radius, and it is worse than for a component. A symbol is shared by every
device that uses it, and a footprint by every device on that land pattern — a project-local copy
of a footprint changes the geometry of every part that mounts on it, including parts the project
never touched. A corrected geometry goes upstream; the project bumps the pin.

### 4. The same rule inside one project

Two files describing the same device in one project is an error, wherever they come from. The
project's own assets and a library's assets are checked by the same rule, and the shadowing
relation above is the only way for a project to disagree with a library it depends on.

## Addendum (2026-10-22): a review is attributed, not signed

Closes the open point about signing.

### 1. A part is not signed

There is no signature on a part, and no signature scheme is planned. A signature would bind the
claim "somebody reviewed this" to an identity; it says nothing about whether the pin table was
compared with the datasheet. What makes review quality visible is a **published criterion** and
a **visible attribution** — `verified_by`, `verified_on`, and the criterion the library
publishes — which is what decisions 1 and 2 already provide.

### 2. The only signature that could ever matter is library-level

If a library is distributed, "who published this" is a distribution question, not a review
question. The most that could be signed is the **library** — one signature over the library's
`content_hash` — and never a part, because "how many parts of this library are reviewed" is a
question the library-level summary already answers.

It is not done now: this project has no operator, no key distribution and no service to keep
running ([ADR-0015](0015-licensing-and-open-standard.md)), and the library's `content_hash`
already pins what a project actually consumes.

### 3. Review is broader than the library

The question was asked as a library question, and it is a review question. A team reviews
**designs**, not only library parts, and the record of that review — who, when, verdict,
notes — is a project artifact with its own rules. Those rules are in
[ADR-0033](0033-review-records-and-attribution.md).

## Addendum (2026-10-24): derived files are withdrawn; review is an in-place edit

[ADR-0047](0047-an-external-library-is-a-template-not-a-dependency.md) removes the read-only
library from the project's tree: an external library is a template, copied into `assets/` under
bare ids, and the copy is the project's own content.

That makes decisions 3 and 4 (derived components, derived families) unnecessary rather than
wrong: their whole purpose was to let a project disagree with a library it could not edit. A
project that finds a wrong pin now edits the file it owns — one source, one diff, no second
description to compare. **Decisions 3 and 4 are withdrawn in the consuming direction.**

Decision 1 (per-part provenance) survives and is now implemented, cheaply: `provenance` is a
scalar of the component itself (`generated` | `reviewed`), and a human review flips it in place
with `verified_by` / `verified_on`. Decision 2 (a library carries a manifest and a disclaimer)
stays valid for the **publishing** side — a library that somebody distributes still says what it
is — but the consumer no longer carries a disclaimer for content it does not consume. Decision 5
(strict mode) remains unimplemented and unneeded until a project consumes a library at all.
