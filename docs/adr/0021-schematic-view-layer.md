# ADR-0021: The Schematic View Layer (S1) Is an Independent Description; the Review UI Is Browser-First

Status: Accepted
Date: 2026-10-21
Impact: `AGENTS.md` §3, §4.2, §9; `docs/backlog.md` F3; `packages/ir` (a new schema kind); `packages/parser`; `packages/renderer`; `packages/cli`; a future `packages/viewer`

**Amendment (2026-10-21, [ADR-0025](0025-flat-board-and-print-pages.md))**: the view layer's *shape* is
unchanged, but the board-internal source partition is gone. A view file is now a **print page** of
one flat board schematic, not the twin of a source page: `sch/<board_id>/<page_id>.view.teda` draws
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

- A separate file per page, next to the page it draws: `sch/<board_id>/<page_id>.view.teda`.
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
