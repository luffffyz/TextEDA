# ADR-0033: Libraries Are Unverified Facts; Provenance, Disclaimers, and Corrections

Status: Accepted
Date: 2026-10-22
Scope: Decides: that a library is an unverified fact that carries its provenance, and how a correction reaches it. Does not decide: how a library is imported — see ADR-0034.
Related: [ADR-0032](0032-the-reference-project-is-self-built.md), [ADR-0034](0034-trust-in-a-library-you-do-not-own.md), [ADR-0037](../09-view/0037-review-records-and-attribution.md), [ADR-0039](../10-process/0039-licensing-and-open-standard.md)
Impact: `spec/procurement.md`; `packages/parser/src/component.ts`; `docs/guides/library-import.md`

## Background

[ADR-0024](../07-devices/0024-the-device-kind-is-part-or-generic.md) makes external libraries a
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
the library version, which is what a project pins when it copies the library in.

### 3. A correction is an in-place edit of the file the project owns

An external library is a **template**: it is copied into the project's tree once and is then the
project's own content (see ADR-0034). So a project that finds a wrong fact edits the file it
owns — one source, one diff, no second description to compare.

The earlier shape — a read-only library plus a **derived component** that stated the relation
explicitly — is withdrawn in the consuming direction. Its whole purpose was to let a project
disagree with a library it could not edit; that situation no longer exists.

What survives is the reasoning, and it is the reason the copy is safe to edit: a correction must
be **visible**, and a reviewer must be able to see that the project's facts differ from the
source's. The mechanism is now the file's own history and the origin header that says where the
file came from.

**A correction is never a partial patch.** A corrected file states a complete set of facts; it
is not a list of changed fields merged into the original. The merged result would not be what any
file says, so the reader would have to evaluate the merge to know the truth.

The pin-table identity boundary of ADR-0024 decision 3 governs what a *design* may treat as one
device, not what a *record* may say; a correction changes the record.

### 4. Geometry is never corrected locally

A project does not correct a library's `symbol` or `footprint`.

The reason is the blast radius, and it is worse than for a device. A symbol is shared by every
device that uses it, and a footprint by every device on that land pattern — a project-local copy
of a footprint changes the geometry of every part that mounts on it, including parts the project
never touched. A corrected geometry goes upstream; the project copies the new revision.

### 5. The same rule inside one project

Two files describing the same device in one project is an error, wherever they come from. The
project's own assets and an imported library's assets are checked by the same rule.

### 6. Strict mode

A project may declare that it accepts only library items whose `provenance` is `reviewed`. In
strict mode, a reference to a `generated` library item is an error, reported with the item id and
the datasheet pointer, so that the failure is actionable rather than mysterious.

Strict mode is opt-in and off by default: most projects would rather have a generated part and
check it themselves than have no part at all.

### 7. The structural gate applies to libraries too

Library content is validated with the same tooling as a project: the files must parse, the
contracts must validate, and the three-way alignment of symbol pin numbers, footprint pad
numbers and device pin numbers must hold for every asset in the library. `lib:verify` runs
against a library directory as well as against a project.

This is what makes the disclaimer defensible. The library guarantees the things that can be
guaranteed mechanically, and says so precisely, instead of saying nothing at all.

### 8. Libraries are not part of the contract layer

The contract layer — `spec/`, `schemas/`, `examples/`, `tests/` — stays open forever
([ADR-0039](../10-process/0039-licensing-and-open-standard.md)). A library is data, not contract: it is
versioned, licensed separately, and may carry a disclaimer. Adding a library to the repository
therefore adds its licence and attribution to the project's obligations, and copying a
third-party library into the repository is an explicit act with a licence consequence, not a
default.

### 9. The datasheet is declared once

The `datasheet` field of the device is the only declaration of where a part's facts came from.
The document itself may live in `external/cache/` and is never in the repository; there is no
separate declaration file, no separate tree, and no second place to update when the source
pointer changes.

### 10. A review is attributed, not signed

There is no signature on a part, and no signature scheme is planned. A signature would bind the
claim "somebody reviewed this" to an identity; it says nothing about whether the pin table was
compared with the datasheet. What makes review quality visible is a **published criterion** and a
**visible attribution** — `verified_by`, `verified_on`, and the criterion the library publishes —
which is what decisions 1 and 2 already provide.

The only signature that could ever matter is **library-level**: "who published this" is a
distribution question, not a review question. It is not done now — this project has no operator,
no key distribution and no service to keep running (see ADR-0039).

**Review is broader than the library.** A team reviews **designs**, not only library parts, and
the record of that review — who, when, verdict, notes — is a project artifact with its own rules.
Those rules are in ADR-0037.

## Consequences

- **The ecosystem can be honest.** "Generated from the datasheet, not reviewed" is a statement a
  machine can make and a reader can act on. "Trust the library" is not.
- **Corrections are possible without forking.** A project that finds a wrong pin table edits the
  copy it owns and says where it came from. The library stays correct for everybody else.
- **The review effort becomes visible.** `provenance` makes it possible to see how much of a
  library has actually been checked, and a strict-mode project can refuse to build on the rest.
- **A library author is not exposed.** The disclaimer states the actual position: facts were
  transcribed, and the consumer verifies them. This is what allows agents to produce libraries at
  scale without a human reading every line first.
- **The price**: every published part carries provenance metadata, and a reviewed library is
  maintained rather than generated once. That maintenance is real work, and it is the work that
  the disclaimer says the consumer is doing instead.

## Alternatives Rejected

- **Guarantee library accuracy and forbid corrections.** This requires a human to have read
  every datasheet, which is the cost the ecosystem is trying to avoid, and it makes a wrong
  library unfixable except by a new release that every project must wait for. Rejected.
- **Allow patch-style corrections** (a list of changed fields merged into the library item). It
  saves duplication, but the merged result is not what any file says, so the reader has to
  evaluate the merge to know the truth. A complete corrected file is longer and says exactly what
  it is. Rejected.
- **Keep provenance in the library manifest only, per library.** Too coarse: a library may hold
  a thousand parts of which twelve have been reviewed, and the manifest cannot say which twelve.
  Rejected in favour of per-device provenance with a library-level summary.
- **Make strict mode the default.** It would make the common case — generate, then check the
  parts that matter — impossible. Rejected; the flag stays opt-in.

## Open Points

- The registry and distribution format, including how library versions are published and
  consumed, is not decided here (`docs/backlog.md` F10).
- Whether a project may correct a library's `symbol` or `footprint` is **not** open: no. A
  geometry correction creates a second source for geometry that every other device draws from
  (decision 4).
- How a reviewed part is signed, if at all, is **not** open: reviews are not signed, and at most
  a library-level signature would ever make sense (decision 10).
