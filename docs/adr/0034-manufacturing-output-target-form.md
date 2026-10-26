# ADR-0034: The Target Form of the Manufacturing Output — Derived Manufacturing Data, a Self-Describing Package, and a Gate That Is a Process

Status: Accepted
Date: 2026-10-22
Related: [ADR-0018](0018-zero-dependency-and-manufacturing-target.md), [ADR-0005](0005-manufacturing-output.md), [ADR-0023](0023-ir-layer-on-disk.md), [ADR-0030](0030-procurement-layer.md), [ADR-0033](0033-review-records-and-attribution.md), [ADR-0002](0002-board-pages-and-bom.md), [ADR-0031](0031-project-tree-ownership-model.md)
Impact: `AGENTS.md` §1, §3 (the M0 layer), §4.1 (`fab`), §11 (question 17), §9; `docs/adr/0033-review-records-and-attribution.md` (one open point closed); `docs/backlog.md` F14, F15

## Background

[ADR-0018](0018-zero-dependency-and-manufacturing-target.md) decision 3 already fixed the target
form in one line: *the default output of `fab` is manufacturing-neutral data* — stackup and rule
intent, the BOM with variant status, placement coordinates and orientation, assembly and
manufacturing notes — and everything else is derived from it: the Gerber (self-built, P3), IPC-2581
(optional), the BOM plus coordinates for the JLC path
([ADR-0006](0006-jlc-prototype-delivery.md)), and a KiCad project as the compatibility path. What
that record did not do is say what the data *is*: which fields exist, where they come from, who
writes them, what it is not allowed to contain, and what happens when the review of a board is
still open.

The `fab` description has had no shape at all until now — no spec, no schema, no type, no example
— and `AGENTS.md` §11 question 17 records "does `fab` enter the language" as undecided. This
record answers the shape questions and narrows that question to the one part that cannot be
answered without something to write.

Two things make the shape less obvious than it looks.

The first is the layering. `AGENTS.md` §3 puts manufacturing in layer M0: it cannot be free, and
it is "frozen after validation, with a version and a hash". That is right for a *release*, and
wrong for a *build*. A hardware project builds boards long before the design is settled — the
first samples exist to answer questions, and the questions are answered by building. A reading of
M0 that froze every build behind a closed review would make the first sample impossible: the
sample cannot be made until the design is approved, and the design cannot be approved until the
sample is examined.

The second is that a manufacturing package is not a description. It is the description of a board
plus a record of one build. The first half belongs to the contract layer; the second half — who
ordered it, how many, whether this batch is a trial run or a production run, which order it is —
belongs to whoever builds it. TextEDA's job is to make the first half precise and to hand that
half over in a form that can be joined to the second.

## Decisions

### D1. The manufacturing data is derived first

**Everything that can be computed from the board is computed, not written.** The fab data is a
projection of the sources, and the rule that keeps it honest is the same one that keeps the
`pcb` description from becoming a copy of KiCad's project file (§7, "the pcb becomes a copy of
KiCad"):

| Content | Comes from | Written by |
|---|---|---|
| Reference, position, rotation, side | the `pcb` placement | computed |
| Stackup, rule intent | the `pcb` stackup and rules | computed |
| BOM lines, variant status | the flattened `sch` plus the **primary** procurement selection | computed |
| Panelization, assembly and process notes | the project | written |

A field that duplicates a fact the project already states is a second source for it, and a second
source is a divergence waiting to happen. The only content the fab data holds that the project
does not already hold is the manufacturing addition, and that is the slot D7 and D8 are about.

### D2. What the data contains

Per board and per variant, the manufacturing data holds:

- **identity** — the board id, the variant id, the `source_hash` of the design it was computed
  from, and the `tool_version` that produced it;
- **the BOM** — one line per fitted, DNP or not-fitted part: the `component_id`, the parameter
  dictionary, the variant status, and the selected part (manufacturer, MPN, package) from the
  primary procurement selection. The line key stays `(component_id, parameter dictionary)`
  ([ADR-0002](0002-board-pages-and-bom.md)), so a DNP line is still a line;
- **the placement** — per reference: coordinates, rotation, and the side of the board;
- **the stackup and the rule intent** — as the `pcb` description states them;
- **the manufacturing addition** — panelization, assembly and process notes (see D7).

### D3. What the data does not contain

- **Not the copper artwork.** The pads, traces, vias and artwork live in the `pcb` IR, and the
  Gerber writer reads them from there. Copying them into the manufacturing data would duplicate
  the board's geometry in a second file that could disagree with it.
- **Not the order.** Quantity, customer, order number, price, and whether this batch is a trial
  run or a production run are facts about a *build*, not about a board. They are the business's
  records, keyed by the `source_hash` this data carries.
- **Not the review state.** A round closes, a note is accepted, and the design's review state
  changes — while the design does not. Data that changes with the review cannot live in a
  normative artifact whose bytes must be reproducible (invariant 18,
  [ADR-0023](0023-ir-layer-on-disk.md)), so the review state is reported, not embedded (D6).

### D4. It is per board and per variant, and it is normative

The manufacturing data is the description of **the board as it will be built**, so it is
normative: it belongs in the project hash, and a change in it is a change in what is being
manufactured. The variant is part of that identity, because the BOM differs per variant
([ADR-0002](0002-board-pages-and-bom.md)): the data is computed for one `(board, variant)` pair.

The alternatives stay advisory, as they are in the procurement layer
([ADR-0030](0030-procurement-layer.md) decision 5b): a second source does not change the board,
so it does not change the project hash, and switching to it does not invalidate a manufacturing
package that has already been reviewed.

### D5. The package is self-describing

A manufacturing package travels: it is zipped, mailed, dropped on a share, and later found on a
machine nobody recognizes. It must still say what it is.

- The **IR tree** keeps its stable names and the manifest carries the hashes
  ([ADR-0023](0023-ir-layer-on-disk.md)).
- The **handed-over package** is named after its identity: board, variant, and a hash prefix —
  `mcu-board--variant-a--1a2b3c4d.fab.json` — and its payload carries the full `source_hash` and
  the `tool_version` (invariant 11: an exported artifact carries `source_hash + tool_version`).
  The short prefix is for the file name, where the full hash does not fit; the full hash is in
  the payload, where it is used.

### D6. The gate is a process, not a format

**A trial build is never blocked.** The first samples of a board exist to answer questions, and
the review round is open precisely because the design is still moving; making the build wait for
the review would be circular — the sample cannot exist until the design is approved, and the
design cannot be approved until the sample is examined.

**A production release needs the review to be accounted for, not clean.** Each round must
either be closed or have its risk explicitly accepted and recorded by the accountable person
([ADR-0033](0033-review-records-and-attribution.md)). The gate is therefore "every round has a
disposition", not "no note is open". A note that is knowingly accepted is a decision, and a
decision is a fact this project records; an open note that nobody has looked at is not.

The gate lives in the review records, and the tooling **reports** the review state when it
produces a package; it does not block, and it does not write the state into the package (D3).

A build is traced by its hash, not by a gate: every package names the design it was built from,
so "which revision is this sample" always has an answer, and a later build of a changed design
has a different hash and is visibly a different thing.

### D7. Panelization is not done, and its slot exists

Panelization is not in scope for the first form: one board, one build. The slot in the data is
nevertheless there, and it is **omitted when empty** (invariant 18: absent fields are omitted,
not written as null). Adding panelization later is then an additive change to the data shape and
not a change of meaning — which matters, because this data is contract layer and lives forever
(invariant 19).

### D8. The source of the written additions is decided with the implementation

The manufacturing addition is written by a human, so it needs a home in the project. That home is
a question about the language — the `fab` description type of `AGENTS.md` §11 question 17 — and
it cannot be answered before there is anything to write. What this record decides is that the
slot exists, what it means, and that it is filled from the project rather than from the tool.

The question is therefore narrowed, not closed: *does a `fab` description type exist, and where
does it live?* — to be decided with the implementation, when the first panelization or assembly
note has to be written down.

### D9. The writer reads the board, not the manufacturing data

The Gerber and Excellon writer (P3, `docs/backlog.md` F15) reads the `pcb` IR: the layers, the
pads, the traces, the vias, the zone intent, and the board outline. It does not read the
manufacturing data, because the manufacturing data does not contain the copper artwork (D3), and
it does not do geometry of its own: the filled zones are computed at export by the constrained
geometry kernel in [ADR-0054](0054-copper-fill-uses-a-constrained-geometry-kernel.md), not stored
in the IR ([ADR-0003](0003-agent-first-pcb-ir.md)).

*Amendment (2026-10-26).* The earlier wording said the filled zones "are stored in the IR, already
computed". That contradicted `AGENTS.md` invariant 17 and `spec/pcb.md` §4.7, and it did not remove
the geometry computation: it only moved it into a producer. [ADR-0054](0054-copper-fill-uses-a-constrained-geometry-kernel.md)
settles the split: the IR stays intent-only, the writer calls the kernel, and no fill result enters
the canonical IR or the project hash.

*Amendment (2026-10-26b).* The first writer landed: `texteda export gerbers` writes the copper
layers as RS-274X and the holes as one Excellon file. The projection chain is pcb IR → fill
(`packages/core/src/fill/`) → board image (`packages/core/src/board-image.ts`) → text
(`packages/exporter/src/gerber.ts`, `excellon.ts`). The writers serialize only; the assembly that
needs the kernels and the nets sits one layer above, so "the writer does geometry" stays false even
as the amount of geometry grew. The wire contract is frozen in
[ADR-0054](0054-copper-fill-uses-a-constrained-geometry-kernel.md)'s 2026-10-26c appendix.

CAM-grade DFM judgement is not ours to build ([ADR-0018](0018-zero-dependency-and-manufacturing-target.md)
decision 2): solder-mask openings, paste expansion, silkscreen clearance and impedance rules
are rule engineering. The formats are ours; the judgement belongs to a professional CAM tool.

### D10. The manufacturing path runs without KiCad

The whole path — describe, check, render, manufacture package — must run on a machine with
nothing else installed (invariant 20, [ADR-0018](0018-zero-dependency-and-manufacturing-target.md)
decision 1). KiCad remains an optional backend: an interoperability export, a cross-validation
of third-party implementations, and a fallback. The manufacturing data is produced by this
repository's code.

## Consequences

- **The manufacturing data is a projection, so it cannot drift.** It is computed from the same
  sources the rest of the IR comes from, in the same compilation, and it is covered by the same
  hash discipline.
- **The contract layer gains a description.** The manufacturing data is public and implementable
  (invariant 19): a third party can produce it from the same sources, and a third party can check
  ours against theirs.
- **The trial-build problem disappears.** Nothing has to be approved before a board can be made,
  and nothing about the format has to encode a workflow.
- **The package is joinable.** A shop, an ERP and a reviewer all key on the same `source_hash`:
  the package says what was built, the ERP says what it was for.
- **Panelization and hand-written additions are honest placeholders.** They are named, they are
  omitted when empty, and the decision about their source waits until there is content.
- **F15 can start.** The writer's inputs are the `pcb` IR and the layer mapping, and the layer
  mapping is now unambiguous: the manufacturing data does not carry artwork, so there is exactly
  one source for it.

## Alternatives

- **No manufacturing data of our own; KiCad produces everything** (the path
  [ADR-0005](0005-manufacturing-output.md) records). Rejected: it makes an external EDA suite
  the premise of the manufacturing step, which is what invariant 20 forbids, and it leaves the
  contract layer with no description of what is being built. ADR-0005 is not repealed — it
  records the current implementation path (ADR-0018 decision 4) — but it is not the end state.
- **The manufacturing data duplicates the board, including the copper.** Rejected: it is the
  "the pcb becomes a copy of KiCad" trap in a new place, and it would give the project two
  descriptions of the same geometry.
- **The manufacturing data carries the build purpose (trial / production).** Rejected: a build
  is an event, not a description; the data describes a board, and the same data serves a trial
  and a production run. It would also break the reproducibility of the artifact, because the
  purpose of one order is not a property of the design.
- **The manufacturing data carries the review state.** Rejected for the same reason, and with a
  sharper one: the review state moves while the design does not, so embedding it would make two
  compilations of the same project differ.
- **A `fab` description type now.** Deferred, not rejected: there is nothing to write yet, and
  the shape of the data is what had to be settled first. The question is narrowed by D8.

## Open Points

- **The source of the written manufacturing additions** (D8): does a `fab` description type
  exist, and where does it live? Decided with the implementation, when the first panelization or
  assembly note has to be written down.
- **The schema and the spec**: `spec/fab.md` and the shard's schema, with the exact field names
  and the units, follow this record and precede the implementation.
- **The packaging format**: whether a handed-over package is a directory, an archive, or a set
  of files is the exporter's business and is not decided here; D5 fixes only the naming and the
  identity it carries.
