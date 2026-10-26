# TextEDA

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/svg/texteda-logo-dark.svg">
    <img src="docs/assets/svg/texteda-logo.svg" width="420" alt="TextEDA — describe hardware as text">
  </picture>
</p>

[English](README.md) | [简体中文](README_cn.md)

Describe a piece of hardware as **human-written text**: the schematic (`sch`) and the PCB (`pcb`) are two independent, sibling descriptions; the IR is the single source of truth, and both the source syntax and any rendered output are derivatives.

**Agent first, human reviewable.** A machine reads, checks, and edits the design; a human reads it before it ships. Everything is plain text — including the errors, which point at a file and a line.

> Licensed under **Apache-2.0** (see `LICENSE` / `NOTICE`). The project is a work in progress.
>
> **The contract layer is open source forever**: `spec/` (including `spec/teda.md`) / `schemas/` / `examples/` / `tests/` stay public and implementable, never closed. The implementation layer (`packages/`) may be relicensed separately. The positioning is a **pure open technical specification** — no commercial plan, no revenue model, no paid services. Everything needed to implement the contract is free and unencumbered, and that will not change. The goal is adoption: the spec gets cited, implemented, and built on.
>
> The GitHub repo is **public** ([luffffyz/TextEDA](https://github.com/luffffyz/TextEDA)). The pre-publication sweep passed (`bun run check:public`: no vendor PDFs in the history, no credentials, no maintainer paths) and is now a machine gate on every push. See [ADR-0015](docs/adr/0015-licensing-and-open-standard.md) and `docs/backlog.md` F6.

## What works now

```bash
bun install
bun test                # unit + contract + round-trip tests
bun run typecheck       # all seven packages through tsc
bun run lib:verify      # library closure, **zero external dependencies**
bun run lib:verify:kicad  # optional: adds the KiCad interoperability section
bun run check:links      # every Markdown link and ADR cross-reference resolves
bun run check:public     # public sweep over the whole history: no vendor PDFs, no credentials, no maintainer paths
bun run cases:check      # the pinned ten-case corpus (3 of 10 landed so far)
bun run preview symbol bq24610rger     # draw a symbol (no KiCad needed)
bun run preview component bq24610rger  # draw a component's symbol + footprint
bun run preview view charger-buck/buck-5v  # draw a schematic print page from its view file (no KiCad needed)
bun run fmt:teda --check examples/reference-project   # canonical-form check
bun run check examples/reference-project          # parse, IR contract, ERC, binding, devices, ratings, procurement, review rounds
bun run texteda ir examples/reference-project      # write the IR shard tree (canonical JSON + manifest + hashes)
bun run texteda netlist examples/reference-project --board mcu-board  # netlist = connectivity projection of the IR
bun run texteda bom examples/reference-project charger-buck   # bill of materials, with its procurement status
bun run texteda view-metrics examples/reference-project charger-buck/buck-5v  # print-page readability numbers
bun run texteda review examples/reference-project   # serve the review app on 127.0.0.1 (--out writes one HTML file)
bun run texteda id examples/reference-project --count 3  # generate unused project-scoped instance UIDs
bun run texteda renumber examples/reference-project charger-buck --policy compact  # dry-run a validated refdes rename
bun run texteda init ./my-board        # generate an empty project skeleton
```

Current state, by layer:

**Describe.** A project can describe boards with `schematic` (instances, nets, ports, constraints, buses — one flat file per board, [ADR-0025](docs/adr/0025-flat-board-and-print-pages.md)); compose them from `module` files with ports, flattened into the board IR so the IR stays flat ([ADR-0026](docs/adr/0026-modules-compose-boards.md)); draw them with `view` print pages, which are a description of their own and never a build input ([ADR-0021](docs/adr/0021-schematic-view-layer.md), [ADR-0032](docs/adr/0032-view-is-a-drawing-not-a-build-input.md)); describe their physical implementation with `pcb` — it holds only physical facts and rule intent (twelve sections, [ADR-0003](docs/adr/0003-agent-first-pcb-ir.md)); the agent-driven layout and routing loop is [ADR-0053](docs/adr/0053-layout-and-routing-are-agent-driven.md); connect them across a `system` description over declared ports ([ADR-0001](docs/adr/0001-board-linking.md)); pick their parts with `procurement` (primary and alternatives, per board, [ADR-0030](docs/adr/0030-procurement-layer.md)); and stock their libraries from `component` — a `kind: part` carries an MPN, a `kind: generic` leaves the value to the instance row ([ADR-0027](docs/adr/0027-device-parts-families-and-library-dependencies.md), [ADR-0037](docs/adr/0037-device-kind-vocabulary-and-one-device-directory.md)) — plus `symbol` / `footprint` geometry, where the pin's electrical facts stay on the component ([ADR-0012](docs/adr/0012-symbol-description.md)). `project.toml` is the outer metadata. `fmt` writes the canonical form of every description type above except `component`. Libraries are **templates, not dependencies**: `texteda lib import` copies a component and the symbols / footprints it references into `assets/` as bare ids, writes a source-header comment, and stamps the revision each file came from ([ADR-0047](docs/adr/0047-an-external-library-is-a-template-not-a-dependency.md), [ADR-0049](docs/adr/0049-a-file-carries-its-own-revision.md)).

**Check.** `texteda check` runs the parse, the IR contract, connectivity ERC, sch↔pcb binding — including whether every declared `connect` pair is actually backed by copper, and reporting a partial layout instead of silently passing it ([ADR-0041](docs/adr/0041-connect-pairs-must-be-implemented-by-copper.md), [ADR-0040](docs/adr/0040-partial-layout-is-legal-and-reported.md)) — the device vocabulary and parameter roles ([ADR-0038](docs/adr/0038-device-vocabulary-and-parameter-roles.md)), ratings against the declared windows and dissipation against declared limits ([ADR-0043](docs/adr/0043-ratings-are-compared-against-declared-windows.md), [ADR-0044](docs/adr/0044-dissipation-is-checked-against-declared-limits.md)), procurement selection, review-round closure and attribution ([ADR-0033](docs/adr/0033-review-records-and-attribution.md)), and the board ↔ print-page cross-check with readability numbers. On the reference project it reports **0 errors**; the warnings are its honest state — `mcu-board` is a bring-up board with no `pcb` and an empty procurement table.

**Draw.** The reference renderer turns symbols, footprints and schematic print pages into SVG with its own stroke font, no KiCad install ([ADR-0014](docs/adr/0014-reference-renderer.md)); each of the three is closed by `extract(render(ir)) == ir`. `texteda review` serves the print pages with hover-to-highlight and click-to-select, or writes the same thing as one self-contained HTML file.

**Export and hash.** KiCad `.kicad_mod` / `.kicad_sym`, a netlist as the connectivity projection of the IR, and a BOM. `texteda export gerbers` writes the copper, mask, paste and silkscreen layers as RS-274X plus one Excellon file of all holes, computing the zone fill at export — no precomputed fill in the IR or any hash ([ADR-0054](docs/adr/0054-copper-fill-uses-a-constrained-geometry-kernel.md)). `texteda ir` writes `dist/ir/`: one canonical JSON shard per description, a manifest with a sha256 per shard, a project hash over the **normative** shards and a separate `advisory_hash` for the ones that are drawings or second sources ([ADR-0023](docs/adr/0023-ir-layer-on-disk.md)).

**Not there yet.** The agent-driven layout and routing loop (ADR-0053; no built-in solver), the `.kicad_pcb` board writer and the `fab` description (backlog F15 / F14, [ADR-0034](docs/adr/0034-manufacturing-output-target-form.md); the Gerber layer set and the drill file are landed), KiCad schematic export (F16), the importer for reverse-engineered or external netlists (F36), the review GUI's `layout` / `placement` / `edit` modes (F34; click-to-source is landed), module parameters and nesting (F13), and rekeying references to the instance UID (a refdes rename still changes source and hash; [ADR-0051](docs/adr/0051-instances-have-a-stable-project-local-uid.md)). KiCad is the current fallback until the self-built manufacturing exit lands ([ADR-0005](docs/adr/0005-manufacturing-output.md), [ADR-0034](docs/adr/0034-manufacturing-output-target-form.md)).

Two agent-facing artifacts (both generated by `bun run gen`, never hand-edited):

| File | Answers |
|---|---|
| `docs/error-codes.md` | diagnostic code → meaning, severity, spec section (162 codes in a closed domain vocabulary) |
| `docs/ir-reference.md` | IR field → type, required, **unit**, description (coverage list at the end) |

Hand-written, for agents that have to build a project from scratch: [docs/skills/new-project.md](docs/skills/new-project.md) — every step is a command, the expected output, and the diagnostic code to look at when it fails.

## Comparison

TextEDA is not a GUI EDA tool, and it does not try to become one. It sits one layer above the editor: a text description language whose typed IR is the single source of truth, plus validators, a reference renderer and exporters.

The full comparison is organised as three lenses — commercial full-flow GUI, open/low-cost GUI, and code/text-first — with AI-native hosted tools adjacent. This table is the short version. Representative tools: Altium, Cadence and Siemens (commercial); KiCad, EasyEDA, LibrePCB and Horizon (open/low-cost); atopile, tscircuit, SKiDL and JITX (code/text-first); heypcb and Flux (AI-native hosted).

| | TextEDA | KiCad | EasyEDA | tscircuit |
|---|---|---|---|---|
| **What you edit** | `.teda` text — `sch` and `pcb` are independent siblings | `.kicad_sch` / `.kicad_pcb` s-expressions | JSON project source | TypeScript / TSX code |
| **Typed IR** | JSON Schema 2020-12, canonical JSON, integer-only units | none — the file *is* the model | JSON project format | `circuit-json` (zod) |
| **Checks** | connectivity ERC · sch↔pcb binding · device rules and ratings · procurement selection · IR contract | built-in ERC and DRC | DRC | zod plus warnings carried in the IR |
| **Review** | rendered print pages in a browser: hover, select; the drawing is a source file, not a rebuild | schematic and PCB editors | schematic and PCB editors | web viewers |
| **Layout / routing** | agent-driven, checker-gated; no built-in solver ([ADR-0053](docs/adr/0053-layout-and-routing-are-agent-driven.md)) | built in | built in | computed in code |
| **Manufacturing** | Gerber layers (copper / mask / paste / silk / edge) + Excellon drill landed; the `fab` package not yet (F15 / F14) | built in | built in, plus one-click ordering | Gerber / BOM / PnP converters |
| **Agent path** | text + typed IR + frozen diagnostic codes + structured layout tools (roadmap) | Python and `kicad-cli` | API SDK and an AI skill over a WebSocket bridge | the agent writes the program |
| **License** | Apache-2.0, contract layer open forever | GPL-3.0+, libraries CC-BY-SA 4.0 | proprietary editor, Apache-2.0 SDK | MIT |

The full, sourced **three-lens** comparison — commercial full-flow GUI, open/low-cost GUI, code/text-first, with AI-native hosted tools adjacent — is [docs/comparison.md](docs/comparison.md).

## CI

`.github/workflows/ci.yml` runs on every push and pull request to `main`. The required gate is **zero-dependency** — it needs Bun and nothing else, no KiCad:

`bun test` · `bun run typecheck` · `bun run gen:check` · `bun run lib:verify` · `bun run check:links` · `bun run check:public` · `bun run fmt:teda --check .`

The KiCad interoperability section is a **separate, optional workflow** (`.github/workflows/ci-kicad.yml`, scheduled and manual) because a gate must never depend on external software ([ADR-0018](docs/adr/0018-zero-dependency-and-manufacturing-target.md)).

## Project layout

```text
my-board/
├── project.toml              # name / version / format
├── assets/                   # owned device assets
│   ├── components/           # parts + generics; kind in file
│   ├── symbols/
│   ├── footprints/
│   └── procurement/          # primary/ + alternatives/
├── design/                   # circuit source
│   ├── sch/<board>.teda
│   ├── pcb/<board>.teda
│   ├── modules/<module>.teda
│   └── system/<system>.teda
├── views/
│   └── <board>/<page>.view.teda  # S1 print page; not a build input
├── docs/                     # intent, reviews, evidence
├── external/                 # vendored; cache/ local, ignored
└── dist/                     # generated; gitignored
```

`assets/**` and `design/**` are inputs; `views/**` is hand-written and tracked but does not enter the build identity; `dist/**` is derived (`texteda ir` writes `dist/ir/`). Ownership of each directory is grouped in [ADR-0031](docs/adr/0031-project-tree-ownership-model.md).

## Repository layout

| Path | What it is |
|---|---|
| `AGENTS.md` | **Primary doc**: what the project is, the non-negotiable invariants, acceptance criteria |
| `LICENSE` / `NOTICE` | Apache-2.0 and attribution |
| `spec/` | The specs: `teda.md` (the language-wide spec) plus per-description ones — `symbol` / `footprint` / `pcb` / `schematic-view` / `module` / `procurement` |
| `schemas/ir/v0.14/` | IR contract (JSON Schema 2020-12, the only contract): 11 schemas |
| `packages/ir` | IR types, contract validation, and the diagnostic code registry |
| `packages/parser` | `.teda` → IR for every description type, plus `fmt` (canonical form); `module` files flatten into the board IR |
| `packages/core` | Pure rules, no fs: connectivity ERC, sch↔pcb binding, device vocabulary and ratings, procurement selection, review rounds, board ↔ view checks and readability |
| `packages/exporter` | footprint / symbol → KiCad (`.kicad_mod` / `.kicad_sym`); netlist |
| `packages/renderer` | Reference renderer: IR → drawing commands → SVG, plus the reverse extraction that closes the round trip ([ADR-0014](docs/adr/0014-reference-renderer.md)) |
| `packages/viewer` | The review app's browser side: page, hover highlight, identity selection; no framework, no canvas editing ([ADR-0021](docs/adr/0021-schematic-view-layer.md)) |
| `packages/cli` | `texteda init` / `id` / `compile` / `check` / `netlist` / `ir` / `renumber` / `bom` / `view-metrics` / `review` / `lib import` ([ADR-0019](docs/adr/0019-agent-contract-reference-and-check-entry.md), [ADR-0023](docs/adr/0023-ir-layer-on-disk.md)) |
| `examples/reference-project/` | Self-contained reference project: 2 boards (one with a `pcb`, two print pages), 23 devices (17 parts + 6 generics) / 15 symbols / 16 footprints, all libraries self-built, plus procurement files and three review rounds |
| `examples/cases/` | The ten difficult cases: a whole project each, pinned by expected IR and diagnostics (3 of 10 landed; `bun run cases:check`) |
| `docs/adr/` | Architecture decision records: 54 of them ([full index](docs/adr/README.md)) |
| `docs/guides/` | How-to guides: build a symbol, build a footprint, import a library, keep review records, run a multi-role review, open the review app, read a KiCad board file, renumber reference designators |
| `docs/skills/` | Agent manuals: every step is a command, an expected output, and the diagnostic code to read when it fails |
| `docs/trial-run/` | The historical KiCad end-to-end trial run: pcb description → `.kicad_pcb` → DRC + Gerbers (before the self-built libraries landed) |
| `docs/assets/` | Brand assets (logos, icons, generator script); font binaries are not vendored |
| `docs/backlog.md` | Open work items |
| `docs/comparison.md` | Sourced three-lens comparison against commercial, open/low-cost GUI and code/text-first tools |
| `docs/error-codes.md` / `docs/ir-reference.md` | Generated contract reference (never hand-edited) |
| `scripts/` | Repo tooling: link check, public sweep, library verification, case corpus, migration, previews |

## Design decisions

**Language and IR**
- [ADR-0004](docs/adr/0004-ir-representation.md) IR shape and unit conventions
- [ADR-0008](docs/adr/0008-ir-shard-identity-and-hash.md) IR sharding, identity keys, units and hash granularity
- [ADR-0016](docs/adr/0016-diagnostic-error-codes.md) diagnostic error-code registry: `domain.slug`, frozen on emission
- [ADR-0017](docs/adr/0017-fact-layer-no-expressions.md) the fact layer has no expressions; generators live outside the language
- [ADR-0020](docs/adr/0020-source-spans.md) source spans: diagnostics point at the file, the IR stays clean
- [ADR-0022](docs/adr/0022-language-versioning.md) language versioning: `MAJOR.MINOR[.PATCH]`, `1.0` is the freeze
- [ADR-0023](docs/adr/0023-ir-layer-on-disk.md) the IR layer on disk: shard tree, manifest, normative and advisory hashes

**Boards and connectivity**
- [ADR-0001](docs/adr/0001-board-linking.md) how boards are linked together
- [ADR-0002](docs/adr/0002-board-pages-and-bom.md) intra-board pages, flattening and BOM counting
- [ADR-0003](docs/adr/0003-agent-first-pcb-ir.md) agent-first PCB description: segment set and trade-offs
- [ADR-0007](docs/adr/0007-page-internal-net-naming.md) the net set and its names after flattening
- [ADR-0024](docs/adr/0024-level-tags-in-flattened-names.md) level tags in flattened names (`M1.R1`)
- [ADR-0025](docs/adr/0025-flat-board-and-print-pages.md) one flat schematic per board; pages become print pages in the view layer
- [ADR-0026](docs/adr/0026-modules-compose-boards.md) a board is composed of modules; the IR stays flat
- [ADR-0035](docs/adr/0035-connectivity-authority-and-reverse-engineering.md) connectivity has one authority; reverse engineering is an import, not a mode

**Layout and routing**
- [ADR-0053](docs/adr/0053-layout-and-routing-are-agent-driven.md) agent-driven, checker-gated; sandbox, structured tools, DRC feedback, frozen acceptance

**Drawing and review**
- [ADR-0021](docs/adr/0021-schematic-view-layer.md) the S1 view layer: the drawing lives in its own description type
- [ADR-0032](docs/adr/0032-view-is-a-drawing-not-a-build-input.md) the view is a drawing, not a build input
- [ADR-0033](docs/adr/0033-review-records-and-attribution.md) review is not a description type: notes, decisions, one accountable person

**Devices, libraries and procurement**
- [ADR-0010](docs/adr/0010-footprint-and-3d-model-ownership.md) ownership of self-built footprints and 3D models
- [ADR-0011](docs/adr/0011-library-format-and-footprint-ir.md) self-built footprint libraries use our own format
- [ADR-0012](docs/adr/0012-symbol-description.md) self-built symbol libraries; the electrical facts of pins belong to `component`
- [ADR-0013](docs/adr/0013-reference-project-self-built-libraries.md) the reference project is entirely self-built
- [ADR-0027](docs/adr/0027-device-parts-families-and-library-dependencies.md) device semantics split into parts and generics
- [ADR-0028](docs/adr/0028-library-trust-and-derived-overrides.md) libraries are unverified facts: provenance and disclaimers
- [ADR-0029](docs/adr/0029-package-code-footprint-and-3d-model-ownership.md) the package code lives in the footprint; 3D models belong to parts
- [ADR-0030](docs/adr/0030-procurement-layer.md) the procurement layer: which part to buy is a project-local decision
- [ADR-0031](docs/adr/0031-project-tree-ownership-model.md) the project tree has owners
- [ADR-0037](docs/adr/0037-device-kind-vocabulary-and-one-device-directory.md) the device kind is `part` or `generic`, and devices live in one directory
- [ADR-0038](docs/adr/0038-device-vocabulary-and-parameter-roles.md) the device vocabulary is closed and checked; a parameter is a role and a quantity
- [ADR-0039](docs/adr/0039-a-part-states-its-own-ratings.md) a part states its own ratings; the requirements stay in the instance row
- [ADR-0042](docs/adr/0042-a-device-description-enters-the-ir.md) a device's description is a fact, so it enters the IR
- [ADR-0045](docs/adr/0045-the-package-gives-a-resistor-its-floor.md) the package gives a chip resistor its floor
- [ADR-0046](docs/adr/0046-vendored-libraries-are-verified-by-their-hash.md) a vendored library is verified by its hash (superseded by [ADR-0047](docs/adr/0047-an-external-library-is-a-template-not-a-dependency.md))
- [ADR-0047](docs/adr/0047-an-external-library-is-a-template-not-a-dependency.md) an external library is a template, not a dependency
- [ADR-0048](docs/adr/0048-trust-in-a-library-you-do-not-own.md) trust in a library you do not own is a consumer record
- [ADR-0049](docs/adr/0049-a-file-carries-its-own-revision.md) a file carries its own revision, and trust matches that revision

**Checks**
- [ADR-0040](docs/adr/0040-partial-layout-is-legal-and-reported.md) a partial layout is legal, and it is reported
- [ADR-0041](docs/adr/0041-connect-pairs-must-be-implemented-by-copper.md) a declared `connect` pair must be implemented by copper
- [ADR-0043](docs/adr/0043-ratings-are-compared-against-declared-windows.md) ratings are compared against declared windows
- [ADR-0044](docs/adr/0044-dissipation-is-checked-against-declared-limits.md) dissipation is checked against declared limits

**Manufacturing and process**
- [ADR-0005](docs/adr/0005-manufacturing-output.md) the manufacturing output path
- [ADR-0006](docs/adr/0006-jlc-prototype-delivery.md) JLC prototype delivery: BOM, coordinates, part number
- [ADR-0018](docs/adr/0018-zero-dependency-and-manufacturing-target.md) zero-dependency principle, KiCad as an optional backend
- [ADR-0034](docs/adr/0034-manufacturing-output-target-form.md) the target form of the manufacturing output
- [ADR-0036](docs/adr/0036-process-entities-outside-the-language.md) requirements, blocks and analyses stay outside the language
- [ADR-0054](docs/adr/0054-copper-fill-uses-a-constrained-geometry-kernel.md) copper fill uses a self-built constrained geometry kernel; the IR stays intent-only

**Tooling and licensing**
- [ADR-0009](docs/adr/0009-implementation-stack.md) implementation stack: TypeScript, Bun, render layering, IDE surface
- [ADR-0014](docs/adr/0014-reference-renderer.md) own reference renderer, preview does not depend on KiCad
- [ADR-0015](docs/adr/0015-licensing-and-open-standard.md) licensing and openness: the contract layer is open forever
- [ADR-0019](docs/adr/0019-agent-contract-reference-and-check-entry.md) agent contract reference and the `check` entry point

The complete index, with titles, status and dates, is [docs/adr/README.md](docs/adr/README.md).

## Authoring

- [docs/guides/symbol-authoring.md](docs/guides/symbol-authoring.md) build a symbol
- [docs/guides/footprint-authoring.md](docs/guides/footprint-authoring.md) build a footprint
- [docs/guides/library-import.md](docs/guides/library-import.md) import an external library as a template
- [docs/guides/review-records.md](docs/guides/review-records.md) keep review records
- [docs/guides/role-reviews.md](docs/guides/role-reviews.md) run a review round from several roles
- [docs/guides/review-app.md](docs/guides/review-app.md) open the review app
- [docs/guides/kicad-pcb-format.md](docs/guides/kicad-pcb-format.md) read a KiCad board file

## Language policy

Source code (`.ts`, schemas, and `.teda` examples) is English-only. **Documentation is English by default** — `docs/`, `spec/` (including `spec/teda.md`), the ADRs and this file. Write a document in Chinese only when it is asked for; if Chinese seems like the better choice for a particular document, ask first. Documents written before this policy keep the language they were written in. `README_cn.md` is the Chinese mirror of this file and stays Chinese by definition.
