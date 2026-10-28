# ADR-0120: The Manufacturing Output Path and Its Target Form

Status: Accepted
Date: 2026-10-22
Scope: Decides: what the manufacturing output is, what it is derived from, what it must not contain, and which part of the chain is borrowed. Does not decide: the format of the delivered package — see ADR-0122; nor the BOM and coordinate format for a prototype order — see ADR-0121.
Related: [ADR-0117](../pcb/0117-copper-fill-uses-a-geometry-kernel.md), [ADR-0121](0121-jlc-prototype-delivery.md), [ADR-0122](0122-the-output-package-carries-its-provenance.md), [ADR-0128](../devices/0128-the-procurement-layer.md)
Impact: `spec/pcb.md`; `packages/exporter`; `packages/core`; `packages/cli`; `AGENTS.md` §1, `AGENTS.md` §3 (the M0 layer), `AGENTS.md` §11 (question 17)

## Background

Three facts stack up before this record can exist.

**First, the manufacturing-output decision was built on a wrong estimate.** What it said back then
was "do not build our own Gerber / Excellon writer, borrow `kicad-cli`". The real reason was that
**we did not know how much work it would be**, not that self-building was wrong in principle. Later,
when the self-built symbol and footprint libraries landed, the facts corrected that estimate:
writing a library yourself was not as hard as imagined, and "borrowing" was a temporary choice made
out of missing information, not a conclusion. Since the estimate changed, the decision had to be
reopened.

**Second, the real objection was never workload — it is dependencies.** A textual hardware
description language that requires a whole EDA suite to run is just a precondition script for that
EDA, not an independent thing. TextEDA should reach the point where: **install TextEDA and you can
walk the whole "describe → check → render → manufacturing package" path**; KiCad is an optional
integration, not a premise.

**Third, the repository already contained a hard dependency, hidden inside the "gate".** The
library verification called `kicad-cli` directly for three things: verifying KiCad could read our
symbol libraries, verifying it could read footprints, and verifying the merged board had no DRC
violations. That was described as the threshold of a "library closed loop", that is, **a check that
must pass before a commit**. The result: without KiCad installed locally you could not pass the
full check — **TextEDA did already depend on KiCad**, and the dependency sat in the least
noticeable place.

Two things that were already done right, confirmed along the way: the core packages had no
**external tool** dependency of their own — the only third-party runtime dependency in the whole
tree was the schema validator in `packages/ir` — and the reference renderer was **our own**
implementation, producing images without borrowing KiCad and without depending on system fonts. In
other words, **in terms of capability we had been zero-dependency all along; the gate definition
simply missed it**.

The target form was fixed in one line: *the default output of the manufacturing step is
manufacturing-neutral data* — stackup and rule intent, the BOM with variant status, placement
coordinates and orientation, assembly and manufacturing notes — and everything else is derived from
it. What that line did not say is what the data *is*: which fields exist, where they come from, who
writes them, what it is not allowed to contain, and what happens when the review of a board is
still open.

Two things make the shape less obvious than it looks.

The first is the layering. Manufacturing is in layer M0: it cannot be free, and it is "frozen
after validation, with a version and a hash". That is right for a *release*, and wrong for a
*build*. A hardware project builds boards long before the design is settled — the first samples
exist to answer questions, and the questions are answered by building. A reading of M0 that froze
every build behind a closed review would make the first sample impossible: the sample cannot be
made until the design is approved, and the design cannot be approved until the sample is examined.

The second is that a manufacturing package is not a description. It is the description of a board
plus a record of one build. The first half belongs to the contract layer; the second half — who
ordered it, how many, whether this batch is a trial run or a production run, which order it is —
belongs to whoever builds it. TextEDA's job is to make the first half precise and to hand that half
over in a form that can be joined to the second.

## Decision

### D1. The Core Path Has Zero External Dependencies; KiCad Is Demoted to an Optional Backend

- The **mandatory path** = source → IR → check → render / own export, all done by code in this
  repository, with zero external tools. The core packages must not take on third-party runtime
  dependencies, **with one authorized exception** — `packages/ir` depends on the schema validator
  `ajv`. Everything else in the tree depends only on workspace-internal packages.
- **KiCad is an optional backend** with three jobs: interoperability export (`.kicad_sch` /
  `.kicad_pcb`), cross-validation of third-party implementations (its read-in and DRC), and a
  fallback path for the manufacturing output. **Without installing KiCad, TextEDA remains fully
  usable.**
- **No gate may depend on KiCad.** The correctness of a gate comes from this repository's contracts
  and rules; KiCad's read-in and DRC are **cross-validation** (a third-party implementation accepts
  us), not "the premise of our existence". Treating the latter as the former writes third-party
  tool acceptance into our definition of correctness.

The library verification is split into two tiers:

| Command | Content | Needs KiCad |
|---|---|---|
| `bun run lib:verify` | Component references resolve, no external library prefixes, symbol pin-number set == component pin-number set, footprint pad-number set ⊇ component pin-number set, canonical form, compiles to IR and passes the contract, export succeeds, and **our own renderer** produces images and self-checks them | **No** |
| `bun run lib:verify:kicad` | Additionally: KiCad can read `.kicad_sym` / `.kicad_mod`, and the merged board has 0 `pcb drc` violations | **Yes** (optional) |

The mandatory tier also pulls **footprints** into our own rendering and self-check, so the symbols
and the footprints are held to the same definition.

### D2. We Build the Gerber Writer Ourselves; CAM Judgement We Do Not

The layering does not change: **Gerber is a physical image and belongs to the derived layer**. But
"derived" does not mean "must be produced by an external tool".

- **A self-built Gerber / Excellon writer**: RS-274X is a line-oriented text format (aperture
  definitions + draw/flash + coordinates) and needs no geometry kernel; this repository already has
  the facts of the PCB IR — layers, pads, traces, vias, silkscreen — and what is missing was canvas
  unfolding and coordinate transforms.
- **What we still do not build ourselves is CAM-grade DFM judgement**: manufacturability judgements
  such as solder-mask openings, paste expansion, silkscreen clearance and impedance rules — that is
  rule engineering, not format engineering. The derived-layer policy ("under which rules do we open
  things") can be self-built, but **"can this batch of boards actually be made" is left to a
  professional CAM tool**.

The writer landed on exactly the line drawn above: copper, mask openings, paste apertures,
silkscreen and the edge are all emitted by this repository's code with no external tool, while
nothing on that path judges whether the result is manufacturable — silk is not retracted around
pads, mask slivers are not flagged, and paste volume is not computed. The distinction that did the
work: an *opening* is a derived shape with a declared rule behind it, while an *avoidance* or a
*sliver judgement* is CAM (see ADR-0117).

### D3. Manufacturing-Neutral Data Is the Default Output

- The default output of the manufacturing step = **manufacturing-neutral data**: stackup and rule
  intent, BOM (with variant status), placement coordinates and orientation, assembly and
  manufacturing notes. This is **description**, and it is the layer this project is supposed to own.
- Derived from that data: **Gerber** (self-built), IPC-2581 (optional export), BOM + coordinates
  (the JLC path, see ADR-0121), KiCad project (compatibility path).
- Manufacturing-neutral data belongs to the **contract layer** and is publicly implementable.
- The cost of obtaining the specs needs separate verification: ODB++'s specification is held by
  Valor / PTC and requires membership; IPC-2581 is an IPC publication, also available to members
  (though it is already an industry de facto standard). **Neither is suitable as a "self-built
  format"**, so the contract layer uses its own JSON, and exporting to them is the exporter's job.

### D4. The Manufacturing Data Is Derived First

**Everything that can be computed from the board is computed, not written.** The manufacturing data
is a projection of the sources, and the rule that keeps it honest is the same one that keeps the
`pcb` description from becoming a copy of KiCad's project file:

| Content | Comes from | Written by |
|---|---|---|
| Reference, position, rotation, side | the `pcb` placement | computed |
| Stackup, rule intent | the `pcb` stackup and rules | computed |
| BOM lines, variant status | the flattened `sch` plus the **primary** procurement selection | computed |
| Panelization, assembly and process notes | the project | written |

A field that duplicates a fact the project already states is a second source for it, and a second
source is a divergence waiting to happen. The only content the manufacturing data holds that the
project does not already hold is the manufacturing addition, and that is the slot D8 is about.

### D5. What the Data Contains

Per board and per variant, the manufacturing data holds:

- **identity** — the board id, the variant id, the `source_hash` of the design it was computed
  from, and the `tool_version` that produced it;
- **the BOM** — one line per fitted, DNP or not-fitted part: the `component_id`, the parameter
  dictionary, the variant status, and the selected part (manufacturer, MPN, package) from the
  primary procurement selection. The line key stays (`component_id`, parameter dictionary), so a
  DNP line is still a line;
- **the placement** — per reference: coordinates, rotation, and the side of the board;
- **the stackup and the rule intent** — as the `pcb` description states them;
- **the manufacturing addition** — panelization, assembly and process notes (see D8).

### D6. What the Data Does Not Contain

- **Not the copper artwork.** The pads, traces, vias and artwork live in the `pcb` IR, and the
  Gerber writer reads them from there. Copying them into the manufacturing data would duplicate the
  board's geometry in a second file that could disagree with it.
- **Not the order.** Quantity, customer, order number, price, and whether this batch is a trial
  run or a production run are facts about a *build*, not about a board. They are the business's
  records, keyed by the `source_hash` this data carries.
- **Not the review state.** A round closes, a note is accepted, and the design's review state
  changes — while the design does not. Data that changes with the review cannot live in a normative
  artifact whose bytes must be reproducible (see ADR-0105), so the review state is reported, not
  embedded (D7).

### D7. It Is per Board and per Variant, and It Is Normative

The manufacturing data is the description of **the board as it will be built**, so it is normative:
it belongs in the project hash, and a change in it is a change in what is being manufactured. The
variant is part of that identity, because the BOM differs per variant: the data is computed for
one `(board, variant)` pair.

The alternatives stay advisory, as they are in the procurement layer (see ADR-0128): a second
source does not change the board, so it does not change the project hash, and switching to it does
not invalidate a manufacturing package that has already been reviewed.

### D8. The Gate Is a Process, Not a Format

**A trial build is never blocked.** The first samples of a board exist to answer questions, and
the review round is open precisely because the design is still moving; making the build wait for
the review would be circular — the sample cannot exist until the design is approved, and the design
cannot be approved until the sample is examined.

**A production release needs the review to be accounted for, not clean.** Each round must either be
closed or have its risk explicitly accepted and recorded by the accountable person (see ADR-0136).
The gate is therefore "every round has a disposition", not "no note is open". A note that is
knowingly accepted is a decision, and a decision is a fact this project records; an open note that
nobody has looked at is not.

The gate lives in the review records, and the tooling **reports** the review state when it
produces a package; it does not block, and it does not write the state into the package (D6).

A build is traced by its hash, not by a gate: every package names the design it was built from, so
"which revision is this sample" always has an answer, and a later build of a changed design has a
different hash and is visibly a different thing.

### D9. Panelization Is Not Done, and Its Slot Exists

Panelization is not in scope for the first form: one board, one build. The slot in the data is
nevertheless there, and it is **omitted when empty**. Adding panelization later is then an
additive change to the data shape and not a change of meaning — which matters, because this data is
contract layer and lives forever.

The slot is filled from the project, not from the tool: the manufacturing addition is written by a
human, so it needs a home in the project, and that home is a question about the language — the `fab`
description type of `AGENTS.md` §11 question 17. The question is narrowed, not closed: *does a
`fab` description type exist, and where does it live?*

### D10. The Writer Reads the Board, Not the Manufacturing Data

The Gerber and Excellon writer reads the `pcb` IR: the layers, the pads, the traces, the vias, the
zone intent, and the board outline. It does not read the manufacturing data, because the
manufacturing data does not contain the copper artwork (D6), and it does not do geometry of its
own: the filled zones are computed at export by the constrained geometry kernel (see ADR-0117), not
stored in the IR.

The projection chain is pcb IR → fill → board image → text. The writers serialize only; the
assembly that needs the kernels and the nets sits one layer above, so "the writer does geometry"
stays false even as the amount of geometry grew. The layer set is complete: mask, paste and
silkscreen joined the copper and the drills, so the export emits the files a board house reads.

### D11. The Manufacturing Path Runs Without KiCad

The whole path — describe, check, render, manufacture package — must run on a machine with nothing
else installed. KiCad remains an optional backend: an interoperability export, a cross-validation
of third-party implementations, and a fallback. The manufacturing data is produced by this
repository's code.

### D12. What Goes into the IR, and What Stays Out

Three kinds of information must be kept apart, and this is the criterion for what the IR adds:

1. **Design intent (parameters)** → into the IR. Solder mask expansion, solder paste ratio, thermal
   pad spacing, minimum trace width, whether silkscreen is printed and at what text height, drill
   forms: these are "how this board is made", they are design facts on the same level as
   netclasses.
2. **Derived geometry (results)** → not into the IR. The polygon after copper pour filling,
   silkscreen text positions, solder mask opening polygons: they are a function of (intent +
   geometry + fixed algorithm). Storing them in the IR means storing two truths, and they will
   inevitably drift; moreover, with tens of thousands of vertices per board, the agent cannot read
   them.
3. **Derived policy (the algorithm itself)** → into `spec/`, not into the IR. Meshing, sweep
   order, thermal pad shapes, silkscreen typography rules: they are part of the specification,
   versioned and reviewable, and must not be hidden in code.

Already landed in `spec/pcb.md`: the `mask` / `paste` / `thermal` / `min_width` of the `rules`
segment, and the `silk` segment. The silk positions come from the footprint library; the IR does
not describe positions.

### D13. Losses Must Be Reported

Both levels of the projection — the IR to the export format, and the export format to the physical
artefact — must report the semantics that got dropped (constraints, `deviation`, assembly and 3D,
unmapped `rules`), reusing the controlled-deviation mechanism from `AGENTS.md` §4.4.

Gerber is the terminal end of the lossy projection: it carries no constraints, no net names (unless
X2 attributes are written), no assembly or 3D semantics.

## Consequences

- **Installing only TextEDA is enough to walk the whole "describe → check → render → manufacturing
  package" path**; KiCad users can still join seamlessly, because the interoperability export is
  retained.
- **Third-party implementers verifying themselves do not need to install KiCad** — this is one of
  the conditions for delivering on the openness invariant: the contract layer is open source
  forever, anyone can implement independently.
- **The gate definition becomes honest**: our definition of correctness lives in our own code, and
  third-party acceptance is an **observation**, not a **premise**.
- **The manufacturing data is a projection, so it cannot drift.** It is computed from the same
  sources the rest of the IR comes from, in the same compilation, and it is covered by the same
  hash discipline.
- **The contract layer gains a description.** The manufacturing data is public and implementable: a
  third party can produce it from the same sources, and a third party can check ours against
  theirs.
- **The trial-build problem disappears.** Nothing has to be approved before a board can be made, and
  nothing about the format has to encode a workflow.
- **The package is joinable.** A shop, an ERP and a reviewer all key on the same `source_hash`: the
  package says what was built, the ERP says what it was for.
- **Panelization and hand-written additions are honest placeholders.** They are named, they are
  omitted when empty, and the decision about their source waits until there is content.
- **The IR stays neutral**: the downside of not controlling the derived geometry is that the
  derivation is not ours, so the results move when the algorithm moves; the mitigation is that the
  algorithms live in `spec/` and are versioned with the language, not hidden in a tool.

## Alternatives

- **No manufacturing data of our own; an external EDA suite produces everything.** Rejected: it
  makes an external EDA suite the premise of the manufacturing step, and it leaves the contract
  layer with no description of what is being built. The export path is not the end state, but it is
  the current implementation path, and the two do not conflict as long as the distinction is kept.
- **The manufacturing data duplicates the board, including the copper.** Rejected: it is the "the
  pcb becomes a copy of KiCad" trap in a new place, and it would give the project two descriptions
  of the same geometry.
- **The manufacturing data carries the build purpose (trial / production).** Rejected: a build is
  an event, not a description; the data describes a board, and the same data serves a trial and a
  production run. It would also break the reproducibility of the artifact, because the purpose of
  one order is not a property of the design.
- **The manufacturing data carries the review state.** Rejected for the same reason, and with a
  sharper one: the review state moves while the design does not, so embedding it would make two
  compilations of the same project differ.
- **A `fab` description type now.** Deferred, not rejected: there is nothing to write yet, and the
  slot exists.
- **Binding the IR to a foreign schema** (Circuit JSON and the like). Rejected: binding to a
  foreign schema, low tool maturity, no DRC, and its only selling point — "no KiCad needed" — is
  not worth it when the zero-dependency path is ours to build.

## Follow-up

- The `fab` description type and where it lives (`AGENTS.md` §11 question 17), to be decided with
  the implementation, when the first panelization or assembly note has to be written down.
- The `.kicad_pcb` board writer, as an interoperability export rather than a gate.
- The trial-run record of the first board through the chain is in `docs/trial-run/charger-buck/`,
  and the field-level mapping in `docs/kicad-pcb-format.md`.
