# ADR-0035: The View Layer Is an Independent Description, and the View Is a Drawing, Not a Build Input

Status: Accepted
Date: 2026-10-22
Scope: Decides: that the view is an independent description type with its own file, schema and shard, and that it is a drawing that never becomes a build input. Does not decide: how the view is rendered — see ADR-0036.
Related: [ADR-0004](../01-language/0004-source-spans.md), [ADR-0012](../04-schematic/0012-one-flat-schematic-per-board.md), [ADR-0036](0036-our-own-reference-renderer.md), [ADR-0037](0037-review-records-and-attribution.md)
Impact: `spec/schematic-view.md`; `packages/parser` (the `view` description type); `packages/viewer/**`; `packages/cli` (the `review` command); `schemas/ir/**` (the view shard)

## Background

Two things came up together.

**A human reviewer needs a GUI.** The project's consumer is an agent, but a human still has to
review the result. A GUI was requested, and the natural first question was "which desktop
framework". The answer turned out to be a second-order question.

**The schematic IR has no geometry.** Dumping the actual compiled IR of the reference project
gives:

| | schematic IR | pcb IR |
|---|---|---|
| components | `{id, component, params}` — no position | `placement`: `x_nm`, `y_nm`, `rot_mdeg`, `side` |
| nets | `{id, members}` — no routing | `trace`: `points` |
| ports | `{id, net}` — no position | `outline` / `zone` / `keepout`: geometry |

So the PCB IR carries its physical facts and can be drawn today, while the schematic IR carries
logic only and **cannot be drawn at all**. The layer table puts "symbol position, routing,
labels" in a separate layer S1, described as freely replaceable and discardable — but no
description type stored S1. The renderer makes SVG the authoritative derivative, so the
renderer's input has to exist before the renderer and before any viewer that shows a schematic.

This makes the storage question for S1 a **contract-level** decision, not an implementation
detail: it decides whether the logical IR stays clean, whether the view can be thrown away and
regenerated, and whether a third-party implementation can produce a reviewable drawing without
re-implementing a layout engine.

A second question sat underneath the placement of the files. The project tree was reorganised by
ownership and its shape frozen, and the print pages were left open: a print page was a file under
`design/sch/<board_id>/`, inside the directory of the description type `schematic`. It is a
different description type — its own spec, its own schema, its own parser — living inside another
type's directory, and it collides with its own board: `design/sch/hub.teda` and `design/sch/hub/`
are two different things with the same name.

And under the placement question sat a hash question that had never been asked. The shard
classification rule says a shard is **normative** when the build depends on it and **advisory**
when nothing built depends on it, and it says that *board shards are always normative*. The
board's shards include its views. So today, moving a label in a print page changes the board hash
and the project hash.

That is wrong, and the reason is visible in the rules themselves: no artifact that is built from
the project depends on where a label sits. The renderer reads the view and draws it; the exporter
reads the logic; the netlist, the BOM and the manufacturing package never see a coordinate. A
reviewer nudges a label out of the way of another, and the signed manufacturing package for that
board stops matching the project. The classification criterion — *would changing this invalidate a
signed manufacturing package?* — answers the question on its own: a print page does not.

## Decision

### D1. The view is an independent description type with its own file, schema, and IR shard

The schematic view is a new description type, not a field inside the schematic IR.

- A separate file per page: `views/<board_id>/<page_id>.view.teda`.
- A separate IR shard: `dist/ir/boards/<board_id>/view/<page_id>.json`.
- Its own schema kind and its own spec file.

The view description carries only what a drawing needs: where each symbol sits, how the wires
run, where the labels and page ports are. It carries **no electrical facts**. Pin electrical
type, net membership, and component identity stay in the logical IR and are read from there; the
view references them by the same identity keys and never restates them. A view file that
disagreed with the logic would be a defect, reported like any other, not a second source of truth.

The minimal shape, as a fragment:

```teda
version 0.1
view mcu-board/main

place
  U1    40  30  0
  C1    20  30  90
  R1    60  30  0

wire
  VDD   U1.5  C1.1
  VDD   C1.1  U2.3

label
  VDD   U1.5  3.3
```

The concrete problem this solves: a 200-pin BGA sheet with 40 labels cannot be reviewed by
reading a netlist, and a human cannot review a drawing that the renderer places differently on
every run. The view file is the thing a human (or an agent, under instruction) moves a symbol to
make the sheet readable, and it is the thing the readability checks measure against.

### D2. Print pages live in their own root, beside the circuit and not inside it

```text
my-board-project/
├── design/                          # the circuit — the truth
│   ├── sch/<board_id>.teda
│   ├── pcb/<board_id>.teda
│   ├── modules/<module_id>.teda
│   └── system/<system_id>.teda
└── views/                           # the drawings — hand-written, discardable, not the build
    └── <board_id>/<page_id>.view.teda
```

- **`design/` holds the circuit and nothing else.** Every consumer that scans the circuit layer
  may assume that what it finds there is a circuit description. A print page is not one: it is
  discardable, rebuildable by hand or by an agent, and outside the build identity. Putting it in
  `design/` would force every one of those consumers to learn to skip it — the same mistake as
  putting a derived thing in a source directory.
- **The name collision disappears.** The board file and the board's pages live in different roots,
  and no directory holds two kinds of thing.
- **The board grouping survives.** `views/<board_id>/` holds the pages of one board, one file per
  page. Which pages a board has is still one directory listing, and the review UI can open a
  board's drawings from one place.
- The IR shard path does not change. Moving the source file changes no hash, because the shard
  layout is decoupled from the source tree.

### D3. A view is authored source, not a derived artifact

The view lives in the repository, in `views/`, and not under `dist/`.

The reason is D4: the renderer draws and never places. A view cannot be regenerated by the
toolchain, because nothing in it knows how to choose the positions. A file that cannot be
regenerated is a source file; a source file that the project owns belongs in the project tree.

What the layer table says about S1 — that it may be discarded — therefore means *discardable as
truth*, not *regenerable*: a board whose views are deleted is still a valid board, still
checkable, still exportable; it simply has no drawing.

### D4. A view is hand-written, tracked, and outside the build

The three properties hold together, and each one rules out a different arrangement:

- **Hand-written.** A human (or an agent under instruction) moves the symbols, wires and
  labels. Nothing else writes them.
- **Tracked in the repository.** The adjustments are work worth keeping: they are what makes a
  sheet readable, and they are what the reviewer signed. A view that is not tracked is redrawn
  from nothing on every clone, and the review is repeated from the beginning.
- **Outside the build identity.** No artifact that is built depends on where a label sits, so a
  view shard is advisory (D5). The build and the drawing are versioned separately.

The tempting combination — *discardable, therefore derived, therefore in `dist/`* — is what this
record rejects. A derived artifact is one the toolchain produces; a view is not. The other
tempting combination — *tracked, therefore part of the truth, therefore normative* — is rejected
by D5. "Tracked" and "normative" are different properties: a file can be tracked and still not be
part of the build.

The consequence worth stating plainly: **deleting `views/` does not invalidate anything that was
built.** The board remains valid, its hash is unchanged, and its manufacturing package stands.
Rebuilding the drawing is work, but it is not a rebuild of the design.

### D5. A view shard is advisory: it is not part of the build identity

- The **project hash** covers the build: the schematic, the pcb, the symbols, the footprints, the
  devices, and the primary procurement selections.
- The **advisory hash** covers everything else in the project: the procurement alternatives and
  **the print pages**.
- The **board hash** covers the board's normative shards only. A page's drawing is not part of
  the board's build identity.

The criterion is unchanged and is applied consistently: *would changing this invalidate a signed
manufacturing package?* Moving a label does not, so a label move changes neither the project
hash nor the board hash, and a manufacturing package stays valid. Changing a pin table does, so it
changes both.

- A rendered page carries the **page shard's own `sha256`** as its `source_hash`, the same way a
  rendered symbol carries its shard's hash. The drawing is therefore traceable to the exact file
  it was drawn from, without the drawing being part of the build identity. No new hash is
  introduced for this.
- A review record that cites a drawing cites the page's `source_hash`; a manufacturing record
  cites the board hash. The two do not have to move together.

### D6. The renderer reads the view; it never places anything

`renderSchematic(logicalIr, viewIr)` draws. It does not lay out, and it has no fallback "if no
view exists, arrange it for me". Two reasons:

- **A generated layout is not reviewable.** If the renderer chooses the positions, every run
  produces a different drawing, the human cannot move an overlapping label out of the way, and the
  readability checks measure nothing (the overlap is decided at render time, not stored).
  "Re-render must not overwrite manual adjustment" presumes there is a stored adjustment.
- **Layout solving is out of scope.** Auto-routing and auto-placement are excluded; a renderer
  that places symbols is a layout engine with extra steps.

Consequence: a board with a logical description but no view file has **no drawing**. That is a
legitimate state — the logical design is still valid, still checkable, still exportable to a
netlist — and the reviewer is told "no view for this page", not handed a picture that silently
invents a layout.

### D7. The review UI is a browser app served by the CLI; the desktop shell is deferred

The review view is a web application. `texteda review <project dir>` starts a local server on
`127.0.0.1` and serves a page that consumes the IR and the renderer's SVG. The file system stays
in the CLI process; the browser receives JSON and SVG only.

This is not a new integration pattern — it is the implementation-stack record applied to a new
host. `packages/core` is already required to run in the browser, in the Node extension host, and
in Bun, and the renderer's input and output are plain data.

What this buys, concretely:

- **No new runtime dependency in the core path.** The server is `node:http` in the CLI layer,
  where the file system is already allowed. No bundler, no framework, no Rust toolchain, no
  second package manager.
- **One bundle, three hosts.** The same page can be served locally, embedded in the VS Code
  webview, and published as a **static review report** that CI can attach to a pull request. A
  desktop app cannot produce the third one.
- **The shell stays replaceable.** Tauri, Electrobun, and Electron are all "load a web bundle in
  a native window". Building the UI as a plain web app first means that choosing a shell later is
  a packaging decision that does not touch UI code.

The desktop shell is therefore **deferred, not decided**. When it is needed, the candidates are
Tauri (mature, broad community, system webview, but adds a Rust toolchain alongside the TS + Bun
stack) and Electrobun (MIT, TypeScript-first, small, but a single-maintainer project that
rewrote its entire stack — core, runtime, CLI, UI framework — within the six months between 1.x
and 2.0, and whose 1.x main process was Bun, the very runtime whose upstream is currently being
rewritten). Electrobun was considered and not chosen for now; the reason is recorded so the
question does not have to be reopened from scratch.

### D8. The GUI is not the critical path

The review UI is a consumer of artifacts. It cannot show a schematic before D1 has a spec, a
schema, and a parser; it cannot show anything for the schematic layer at all before D6. The
implementation order is therefore:

1. `spec/schematic-view.md` + the view schema (contract first).
2. `packages/parser`: parse the view description into its shard.
3. `packages/renderer`: `renderSchematic(logical, view)` + the round-trip check and the
   readability checks.
4. `packages/viewer`: the browser app. It is the first consumer of the view contract and
   therefore the first honest test of whether that contract is usable.

### D9. A new `view` diagnostic domain

The diagnostic-code registry is a closed vocabulary: codes look like `domain.short-slug`, and the
domain vocabulary is closed. This record is the one that authorizes adding a domain, so the
vocabulary grows by one: **`view`**.

The split follows the registry's own rule — domains divide by *kind of error*, not by stage of
discovery. A view error that is also a plain "reference points at nothing" error therefore
**reuses the existing codes** rather than growing a parallel set: `ref.unknown-instance`,
`ref.unknown-net`, `ref.unknown-port`, `value.angle-invalid`. Only the failures that exist
because a view layer exists get a `view.*` code: `view.pin-not-placed`, `view.pin-net-mismatch`,
`view.out-of-sheet`, `view.label-not-on-net`, `view.port-not-on-net`, `view.net-not-drawn`,
`view.wire-crosses-symbol`, `view.text-overlap`, `view.label-collision`, and the later additions
`view.text-on-wire`, `view.wire-diagonal` and `view.wire-crosses-pin`.

All of them are `semantic` stage: the view file is readable, and what is wrong is the drawing's
relation to the logic. The domain maps to one stage, so this decision is forced — there is no
per-code stage.

The registry holds only the codes that are actually emitted: a code is registered when the code
that raises it lands, and not before. The list above is the **planned** vocabulary of the view
layer, not the current registry — the generated error-code document is the registry, and
`spec/schematic-view.md` §9 says which checks are implemented.

### D10. A view file written by the review UI must be in canonical form

The UI edits views — that is the whole point of the layer. A UI that writes a file whose
formatting differs from the canonical form produces a diff on every save, and the review record
fills with formatting noise instead of design changes.

So:

- The file the UI writes must be byte-identical to what `fmt` produces for that content — the
  canonical form is a property of the file, not of whoever wrote it.
- The UI must round-trip through the canonical form without loss: reading a canonical file,
  editing it, and writing it back must not reorder, re-space or re-canonicalize anything else.
- The check is the same one the CLI has: `fmt --check` on the written file must pass, and
  `fmt(fmt(x)) == fmt(x)` must hold for the file the UI produces.

The requirement is on the writer, not on the user. A human editing a view file by hand runs `fmt`
as part of their edit; the UI has no such step available, so it must produce canonical bytes
itself.

### D11. A view that disagrees with the board is still an error

Classifying a page as advisory says nothing about whether it is *correct*. The cross-check that D1
requires — every instance, pin and net a view references must exist in the board, and the view
must not restate electrical facts — remains mandatory, and a violation is an error.

The distinction is between *what the project asserts* and *what the project contains*. A page that
references a nonexistent instance asserts something false, and that is an error. A page that is
merely laid out differently asserts nothing about the build, and that is a difference in content,
not a defect.

### D12. The view still speaks the board's identity language

A view references the board's ids verbatim, in whatever shape they have — `R1`, `M1.R1`, `M1.VCC`,
`U1.5`. A view does not define identity; it borrows it. Moving the file to `views/` changes
nothing about what it may reference.

## Consequences

- **The logical IR stays clean.** S0 and S1 remain separable, and a project that only needs a
  netlist never has to describe a drawing.
- **A board can be logically complete but not drawable.** This is a legitimate state that the
  CLI, the LSP, and the reviewer must report honestly rather than paper over.
- **The view layer is part of the contract layer.** `spec/`, `schemas/`, and `examples/` for the
  view type are permanently open, and a third-party implementation may produce its own view
  shard. The reference project carries view files so that the contract is exercised by something
  real, not by an example written for the spec.
- **A human reviewer can move a symbol.** The view file is the adjustment surface, and the
  renderer's output stays a deterministic function of (logical IR, view IR) — so a reviewed
  drawing is a frozen artifact with a hash.
- **A label move does not invalidate a manufacturing package.** The drawing and the build are
  versioned separately, and both are traceable.
- **Deleting `views/` is not a rebuild.** The board is still valid and its artifacts still stand.
- **The review UI is disposable.** Being a web bundle means it can be rewritten without touching
  the contract, which is the same property the view layer itself has.
- **The desktop shell question stays open on purpose.** Deferring it keeps the only irreversible
  choice (a build toolchain) out of the critical path.
