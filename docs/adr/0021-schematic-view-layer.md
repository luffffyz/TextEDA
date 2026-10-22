# ADR-0021: The Schematic View Layer (S1) Is an Independent Description; the Review UI Is Browser-First

Status: Accepted
Date: 2026-10-21
Impact: `AGENTS.md` §3, §4.2, §9; `docs/backlog.md` F3; `packages/ir` (a new schema kind); `packages/parser`; `packages/renderer`; `packages/cli`; a future `packages/viewer`

**Amendment (2026-10-21, [ADR-0025](0025-flat-board-and-print-pages.md))**: the view layer's *shape* is
unchanged, but the board-internal source partition is gone. A view file is now a **print page** of
one flat board schematic, not the twin of a source page: `views/<board_id>/<page_id>.view.teda` draws
**board-level** instance ids and net ids, and its `port` entries name the board's ports. The
sentence "living next to `schematic` / `page`" in decision 1 no longer holds — there is no `page`
description type.

## Background

Two things came up together.

**First: a human reviewer needs a GUI.** The project's consumer is an agent, but a human still has to review the result ([ADR-0019](0019-agent-contract-reference-and-check-entry.md) frames the machine contract; review is the other half). A GUI was requested, and the natural first question was "which desktop framework". The answer turned out to be a second-order question.

**Second: the schematic IR has no geometry.** Dumping the actual compiled IR of the reference project gives:

| | schematic IR | pcb IR |
|---|---|---|
| components | `{id, component, params, line}` — no position | `placement`: `x_nm`, `y_nm`, `rot_mdeg`, `side` |
| nets | `{id, members}` — no routing | `trace`: `points` |
| ports | `{id, net}` — no position | `outline` / `zone` / `keepout`: geometry |

So the PCB IR carries its physical facts (B0) and can be drawn today, while the schematic IR carries logic only (S0) and **cannot be drawn at all**. AGENTS.md §3 puts "symbol position, routing, labels" in a separate layer S1, described as freely replaceable and discardable — but no description type stores S1 today. [ADR-0009](0009-implementation-stack.md) decision 3 makes SVG the authoritative derivative and decision 5 fixes the integration shape ("graphics go through a webview consuming `dist/ir/`"), so the renderer's input has to exist before the renderer and before any viewer that shows a schematic.

This makes the storage question for S1 a **contract-level** decision, not an implementation detail: it decides whether the logical IR stays clean, whether the view can be thrown away and regenerated, and whether a third-party implementation can produce a reviewable drawing without re-implementing a layout engine.

## Decision

### 1. S1 Is an Independent Description Type With Its Own File, Schema, and IR Shard

The schematic view is a new description type, living next to `schematic` / `page`, not a field inside the schematic IR.

- A separate file per page, next to the page it draws: `views/<board_id>/<page_id>.view.teda`.
- A separate IR shard: `dist/ir/boards/<board_id>/view/<page_id>.json`, keyed the same way the page shard is ([ADR-0008](0008-ir-shard-identity-and-hash.md)).
- Its own schema kind in `schemas/ir/v0.2/` and its own spec file in `spec/`.

The view description carries only what a drawing needs: where each symbol sits, how the wires run, where the labels and page ports are. It carries **no electrical facts**. Pin electrical type, net membership, and component identity stay in the logical IR and are read from there; the view references them by the same identity keys (`instance_id`, `pin_number`, `net_id`) and never restates them. A view file that disagreed with the logic would be a defect, reported like any other, not a second source of truth.

The minimal shape, as a fragment (this is the "which concrete hardware problem does this solve" evidence that AGENTS.md §5.2 requires in place of the not-yet-existing ten cases):

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

The concrete problem this solves: a 200-pin BGA sheet with 40 labels cannot be reviewed by reading a netlist, and a human cannot review a drawing that the renderer places differently on every run. The view file is the thing a human (or an agent, under instruction) moves a symbol to make the sheet readable, and it is the thing the "readability checks" of AGENTS.md §6 (text overlap, wire over pin, label collision, out-of-bounds) measure against.

### 2. The Renderer Reads the View; It Never Places Anything

`renderSchematic(logicalIr, viewIr)` draws. It does not lay out, and it has no fallback "if no view exists, arrange it for me". Two reasons:

- **A generated layout is not reviewable.** If the renderer chooses the positions, every run produces a different drawing, the human cannot move an overlapping label out of the way, and the readability checks of AGENTS.md §6 measure nothing (the overlap is decided at render time, not stored). "Re-render must not overwrite manual adjustment" (AGENTS.md §6) presumes there is a stored adjustment.
- **AGENTS.md §1 already excludes layout solving.** Auto-routing and auto-placement are out of scope; a renderer that places symbols is a layout engine with extra steps.

Consequence: a board with a logical description but no view file has **no drawing**. That is a legitimate state — the logical design is still valid, still checkable, still exportable to a netlist — and the reviewer is told "no view for this page", not handed a picture that silently invents a layout.

### 3. The Review UI Is a Browser App Served by the CLI; the Desktop Shell Is Deferred

The review view is a web application. `texteda review <project dir>` starts a local server on `127.0.0.1` and serves a page that consumes the IR and the renderer's SVG. The file system stays in the CLI process; the browser receives JSON and SVG only.

This is not a new integration pattern — it is [ADR-0009](0009-implementation-stack.md) decision 5 applied to a new host. `packages/core` is already required to run in the browser, in the Node extension host, and in Bun (decision 1), and the renderer's input and output are plain data.

What this buys, concretely:

- **No new runtime dependency in the core path.** The server is `node:http` in the CLI layer, where ADR-0009 decision 1 already allows the file system. No bundler, no framework, no Rust toolchain, no second package manager. AGENTS.md §12 requires an ADR for a new dependency; this decision avoids needing one.
- **One bundle, three hosts.** The same page can be served locally, embedded in the VS Code webview (ADR-0009 decision 5), and published as a **static review report** that CI can attach to a pull request. A desktop app cannot produce the third one.
- **The shell stays replaceable.** Tauri, Electrobun, and Electron are all "load a web bundle in a native window". Building the UI as a plain web app first means that choosing a shell later is a packaging decision that does not touch UI code.

The desktop shell is therefore **deferred, not decided**. When it is needed, the candidates are Tauri (mature, broad community, system webview, but adds a Rust toolchain alongside the TS + Bun stack) and Electrobun (MIT, TypeScript-first, small, but a single-maintainer project that rewrote its entire stack — core, runtime, CLI, UI framework — within the six months between 1.x and 2.0, and whose 1.x main process was Bun, the very runtime whose upstream is currently being rewritten). Electrobun was considered and not chosen for now; the reason is recorded so the question does not have to be reopened from scratch.

### 4. The GUI Is Not the Critical Path

The review UI is a consumer of artifacts. It cannot show a schematic before decision 1 has a spec, a schema, and a parser; it cannot show anything for the schematic layer at all before decision 2. The implementation order is therefore:

1. `spec/schematic-view.md` + `schemas/ir/v0.2/schematic-view.schema.json` (contract first, per AGENTS.md §12).
2. `packages/parser`: parse the view description into its shard.
3. `packages/renderer`: `renderSchematic(logical, view)` + the round-trip of ADR-0014 decision 5, and the readability checks of AGENTS.md §6.
4. `packages/viewer` (new): the browser app. It is the first consumer of the S1 contract and therefore the first honest test of whether that contract is usable.

### 5. A New `view` Diagnostic Domain

The diagnostic-code registry is a closed vocabulary: codes look like `domain.short-slug`, and the domain vocabulary is closed ([ADR-0016](0016-diagnostic-error-codes.md)). This record is the ADR that authorizes adding a domain, so the vocabulary grows by one: **`view`**.

The split follows the registry's own rule — domains divide by *kind of error*, not by stage of discovery. A view error that is also a plain "reference points at nothing" error therefore **reuses the existing codes** rather than growing a parallel set: `ref.unknown-instance`, `ref.unknown-net`, `ref.unknown-port`, `value.angle-invalid`. Only the failures that exist because a view layer exists get a `view.*` code: `view.pin-not-placed`, `view.pin-net-mismatch`, `view.out-of-sheet`, `view.label-not-on-net`, `view.port-not-on-net`, `view.net-not-drawn`, `view.wire-crosses-symbol`, `view.text-overlap`, `view.label-collision`.

All nine are `semantic` stage: the view file is readable, and what is wrong is the drawing's relation to the logic. The domain maps to one stage, so this decision is forced — there is no per-code stage.

The registry only holds the codes that are actually emitted ([ADR-0016](0016-diagnostic-error-codes.md)): a code is registered when the code that raises it lands, and not before. So the table above is the **planned** vocabulary of the view layer, not the current registry — `docs/error-codes.md` is the registry, `spec/schematic-view.md` §9 says which checks are implemented.

## Alternatives Rejected

**Put optional placement fields inside the schematic IR.** Cheapest to implement (one parser, one shard) and it keeps everything in one file. Rejected because it mixes a discardable view layer into the logical contract: the logical IR would then carry a part that may be absent, stale, or contradictory, and every consumer of the logical IR would have to know to ignore it. AGENTS.md §3 separates S0 from S1 precisely so that the logic can be consumed by tools that never draw anything (netlist export, ERC, binding checks). It would also be a breaking change to a published contract for no functional gain, which means an IR version bump and a migration — all to avoid one extra file type.

**Let the renderer lay out the page.** Rejected in decision 2: a generated layout is unreviewable and unrepeatable, and it contradicts AGENTS.md §1.

**Ship a desktop app first (Electrobun or Tauri).** Rejected for now: it adds a build toolchain and a second package manager before there is anything to show, and it would bake a web bundle's assumptions into a specific shell API. The web bundle is the durable artifact; the shell is packaging.

**Wait for the schematic renderer before deciding anything about the UI.** Not an option: the renderer's input is exactly what is missing (decision 1), so the storage decision has to come first regardless.

## Consequences

- **The logical IR stays clean.** S0 and S1 remain separable, and a project that only needs a netlist never has to describe a drawing.
- **A board can be logically complete but not drawable.** This is a new state that the CLI, the LSP, and the reviewer must report honestly rather than paper over.
- **The view layer becomes part of the contract layer.** `spec/`, `schemas/`, and `examples/` for the view type are permanently open, and a third-party implementation may produce its own view shard. The reference project gains view files so that the contract is exercised by something real, not by an example written for the spec.
- **A human reviewer can move a symbol.** The view file is the adjustment surface, and the renderer's output stays a deterministic function of (logical IR, view IR) — so a reviewed drawing is a frozen artifact with a hash, per AGENTS.md §6.
- **The review UI is disposable.** Being a web bundle means it can be rewritten without touching the contract, which is the same property AGENTS.md §3 gives the view layer itself.
- **The desktop shell question stays open on purpose.** Deferring it keeps the only irreversible choice (a build toolchain) out of the critical path.
- **Implementation status (2026-10-21).** Decisions 1, 2 and 5 are landed: the `view` spec, schema, parser and canonical formatter, plus `renderSchematic(view, instances)` in `packages/renderer` and `bun run preview view <board>/<page>`. The reference project draws `charger-buck/buck-5v` fully wired and `charger-buck/charger-power` as a placement study. Decision 4's step 3 is partial: the page cross-check, readability checks, sch round-trip extraction and the one-off KiCad `.kicad_sch` comparison are open (`docs/backlog.md` F3).

## Addendum (2026-10-22): the review UI writes canonical view files

Decision 3 gains one requirement.

**A view file written by the review UI must be in canonical form.** The UI edits views — that
is the whole point of the layer ([ADR-0021](0021-schematic-view-layer.md) decision 1: the view
file is the adjustment surface). A UI that writes a file whose formatting differs from the
canonical form produces a diff on every save, and the review record fills with formatting noise
instead of design changes.

So:

- The file the UI writes must be byte-identical to what `fmt` produces for that content — the
  canonical form is a property of the file, not of whoever wrote it.
- The UI must round-trip through the canonical form without loss: reading a canonical file,
  editing it, and writing it back must not reorder, re-space or re-canonicalize anything else.
- The check is the same one the CLI has: `fmt --check` on the written file must pass, and
  `fmt(fmt(x)) == fmt(x)` must hold for the file the UI produces.

The requirement is on the writer, not on the user. A human editing a view file by hand runs
`fmt` as part of their edit; the UI has no such step available, so it must produce canonical
bytes itself.

## Addendum (2026-10-22): the view is a drawing, not a build input

Amended by [ADR-0032](0032-view-is-a-drawing-not-a-build-input.md).

- **Placement.** The page file moves from `views/<board_id>/<page_id>.view.teda` to
  `views/<board_id>/<page_id>.view.teda`: the print pages get a root of their own, beside the
  circuit and not inside it, and no directory name is both a file and a directory. The board
  grouping is unchanged — one directory per board, one file per page. Decision 1's shard path
  `dist/ir/boards/<board_id>/view/<page_id>.json` does not change, so no hash moves.
- **Status.** The view is **hand-written, tracked, and outside the build**: it lives in the
  repository under `views/`, not as a derived artifact under `dist/`, because the renderer draws
  and never places (decision 2) — nothing regenerates a view. What `AGENTS.md` §3 calls
  discardable means *discardable as truth*, not *regenerable*: deleting `views/` does not
  invalidate the board, its hashes, or its manufacturing package.
- **Hash class.** A view shard is **advisory** — it is not part of the project hash or the
  board hash. Moving a label changes neither, so a reviewer's adjustment does not invalidate a
  signed manufacturing package. A rendered page carries the page shard's own `sha256` as its
  `source_hash`.
- **Still an error to disagree.** A page that references an instance, pin or net the board does
  not have is a defect, not a difference in content. The cross-check of this record is
  unchanged and still unimplemented (`docs/backlog.md` F3).

## Addendum (2026-10-22): the canvas navigates, it does not edit

Extends decision 3 with the interaction model of the review UI.

### 1. The canvas is a navigator and an annotator

The GUI never changes geometry. Everything a person changes is changed in the **source text**;
the canvas shows where things are and gets the person to the text.

- The **renderer stays pure** ([ADR-0021](0021-schematic-view-layer.md) decision 2,
  AGENTS.md §2 invariant 3): the viewer adds behaviour to the SVG it is given; the renderer does
  not know that hover or clicks exist.
- There is no layout engine, no dragging and no snapping in the viewer. The view file is the
  adjustment surface; a canvas that could move a symbol would be a second way to write the same
  fact, and the second one would be the one with no diff.
- This is what AGENTS.md §1 already says: not an EDA GUI, no canvas, no drag, no interactive
  routing. The GUI here is a **navigator** (find the thing, go to its source) and an
  **annotator** (write down what you saw).

### 2. Hover is a highlight pointer, and nothing more

Every drawn object carries a **stable element id** in the SVG, derived from the identity key it
references: `instance:U1`, `net:VCC`, `label:...`.

Hovering highlights that object and shows a short readout - the identity, and for a symbol the
part and the footprint. The effect is applied at the CSS/SVG level to the element that is
already there (outline, opacity, a tooltip), so **nothing is re-rendered and no layout is
computed**. Rendering performance therefore carries no cost, and the interaction does not
depend on how large the page is.

The highlight follows the mouse because the element ids are already in the document; there is no
hit-testing geometry and no spatial index.

### 3. Clicking jumps into the source

A click identifies the object. The viewer then offers **the places where that object is
defined**:

| Identity | Places |
|---|---|
| An instance | Its row in the board's `sch` file; its placement in the `view` file; the part or family file in `assets/components/`; the footprint file |
| A net | Its row in the `nets` section; the ports that name it; the view's labels and wires |
| A pin | The instance's row; the pin's row in the part file; the view's wire endpoint |

Choosing one opens that file at that line - in the viewer's own text pane, or in an external
editor. The list is short and stable, so it reads as a small menu; when only one place is
obvious, the click goes straight there.

### 4. That needs a source index, and spans are the missing piece

To jump, the toolchain must know, for every identity, the file and line of every place that
mentions it. That is the **span** mechanism (`docs/backlog.md` F11, reserved ADR-0020), and the
GUI needs the identity-shaped form of it: `identity -> locations`, not only
`IR path -> location`.

**Spans cannot live in the IR.** AGENTS.md §10 requires that reordering the lines of a
description leaves the compiled IR byte-identical; a span inside the IR would change the hash
with every edit. They are therefore **sidecar tables** (`dist/ir/<shard>.spans.json`, F11 option
B), and the viewer merges the sidecars of the shards it shows by identity.

Consequence: **F11 is on the critical path of the review UI**, and its deliverable must include
the identity index the viewer consumes, not only the diagnostic positions.

### 5. Three modes, one renderer

| Mode | What it is |
|---|---|
| `review` | Read the drawing. Hover to identify, click to jump, write notes. The canvas changes nothing. |
| `placement` | The PCB canvas: placement, board outline, courtyards, net highlighting. The same interaction model. |
| `edit` | Split view: source text on one side, canvas on the other. Clicking in the canvas moves the cursor in the text; editing the text updates the canvas. **The edit happens in the text.** |

Switching modes swaps the SVG and the overlay. The modes differ in *what is drawn* and *what is
reachable*, not in how the canvas behaves - the highlight pointer and the jump are the same code
in all three.

### 6. Anchoring a note to what was looked at

A reviewer pointing at a symbol and writing "this part is wrong" wants the note attached to
that symbol. The canvas knows which object the pointer is over, so the note could carry that
identity.

This is not free: an anchor is a machine-readable prefix in the note line, which sits in
tension with the rule that the tools do not parse the notes
([ADR-0033](0033-review-records-and-attribution.md) decision 3). The cheapest resolution is an
optional bracket in the note line - `- alice (2026-10-22) [instance:U3]: ...` - that only the
viewer reads, leaving the notes prose in every other respect. This is an open point of
ADR-0033, not a decision here.
