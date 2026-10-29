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
> The GitHub repo is **public** ([luffffyz/TextEDA](https://github.com/luffffyz/TextEDA)). The pre-publication sweep passed (`bun run check:public`: no vendor PDFs in the history, no credentials, no maintainer paths) and is now a machine gate on every push. See [ADR-0138](docs/adr/process/0138-licensing-and-open-standard.md) and `docs/backlog.md` F6.

## What works now

```bash
bun install
bun test                # unit + contract + round-trip tests
bun run typecheck       # all seven packages through tsc
bun run lib:verify      # library closure, **zero external dependencies**
bun run lib:verify:kicad  # optional: adds the KiCad interoperability section
bun run check:links      # every Markdown link and ADR cross-reference resolves
bun run check:public     # public sweep over the whole history: no vendor PDFs, no credentials, no maintainer paths
bun run cases:check      # the pinned ten-case corpus (see examples/cases/)
bun run preview symbol bq24610rger     # draw a symbol (no KiCad needed)
bun run preview component bq24610rger  # draw a component's symbol + footprint
bun run preview view charger-buck/buck-5v  # draw a schematic print page from its view file (no KiCad needed)
bun run fmt:teda --check examples/reference-project   # canonical-form check
bun run check examples/reference-project          # parse, IR contract, ERC, binding, devices, ratings, procurement, review rounds
bun run texteda ir examples/reference-project      # write the IR shard tree (canonical JSON + manifest + hashes)
bun run texteda netlist examples/reference-project --board mcu-board  # netlist = connectivity projection of the IR
bun run texteda bom examples/reference-project charger-buck   # bill of materials, with its procurement status
bun run texteda view metrics examples/reference-project charger-buck/buck-5v  # print-page readability numbers
bun run texteda tools --json           # the verbs a host can register as tools, with their JSON Schema
bun run texteda review examples/reference-project   # serve the review app on 127.0.0.1 (--out writes one HTML file)
bun run texteda id examples/reference-project --count 3  # generate unused project-scoped instance UIDs
bun run texteda renumber examples/reference-project charger-buck --policy compact  # dry-run a validated refdes rename
bun run texteda init ./my-board        # generate an empty project skeleton
```

Current state, by layer:

**Describe.** A project can describe boards with `schematic` (instances, nets, ports, constraints, buses — one flat file per board, [ADR-0111](docs/adr/schematic/0111-one-flat-schematic-per-board.md)); compose them from `module` files with ports, flattened into the board IR so the IR stays flat ([ADR-0112](docs/adr/schematic/0112-modules-compose-boards.md)); draw them with `view` print pages, which are a description of their own and never a build input ([ADR-0134](docs/adr/view/0134-the-view-layer-is-a-drawing.md) D1、D5); describe their physical implementation with `pcb` — it holds only physical facts and rule intent (twelve sections, [ADR-0115](docs/adr/pcb/0115-agent-first-pcb-description.md)); the agent-driven layout and routing loop is [ADR-0116](docs/adr/pcb/0116-layout-and-routing-are-agent-driven.md); connect them across a `system` description over declared ports ([ADR-0108](docs/adr/project/0108-board-linking.md)); pick their parts with `procurement` (primary and alternatives, per board, [ADR-0128](docs/adr/devices/0128-the-procurement-layer.md)); and stock their libraries from `component` — a `kind: part` carries an MPN, a `kind: generic` leaves the value to the instance row ([ADR-0123](docs/adr/devices/0123-the-device-kind-is-part-or-generic.md) D1、D2) — plus `symbol` / `footprint` geometry, where the pin's electrical facts stay on the component ([ADR-0130](docs/adr/libraries/0130-symbol-format.md)). `project.toml` is the outer metadata. `fmt` writes the canonical form of every description type above except `component`. Libraries are **templates, not dependencies**: `texteda lib import` copies a component and the symbols / footprints it references into `assets/` as bare ids, writes a source-header comment, and stamps the revision each file came from ([ADR-0133](docs/adr/libraries/0133-trust-in-a-library-you-do-not-own.md) D2、D6).

**Check.** `texteda check` runs the parse, the IR contract, connectivity ERC, sch↔pcb binding — including whether every declared `connect` pair is actually backed by copper, and reporting a partial layout instead of silently passing it ([ADR-0119](docs/adr/pcb/0119-connect-pairs-need-copper.md), [ADR-0118](docs/adr/pcb/0118-a-partial-layout-is-legal.md)) — the device vocabulary and parameter roles ([ADR-0124](docs/adr/devices/0124-device-vocabulary-and-parameter-roles.md)), ratings against the declared windows and dissipation against declared limits ([ADR-0125](docs/adr/devices/0125-a-part-states-its-own-ratings.md) D8、D11), procurement selection, review-round closure and attribution ([ADR-0136](docs/adr/view/0136-review-records-and-attribution.md)), and the board ↔ print-page cross-check with readability numbers. On the reference project it reports **0 errors**; the warnings are its honest state — `mcu-board` is a bring-up board with no `pcb` and an empty procurement table.

**Draw.** The reference renderer turns symbols, footprints and schematic print pages into SVG with its own stroke font, no KiCad install ([ADR-0135](docs/adr/view/0135-our-own-reference-renderer.md)); each of the three is closed by `extract(render(ir)) == ir`. `texteda review` serves the print pages and the board canvas in four modes — read, place symbols on the print page, inspect the physical board, edit the page source — with hover-to-highlight, click-to-select and click-to-source, or writes the read mode as one self-contained HTML file ([ADR-0141](docs/adr/view/0141-the-review-app-has-four-modes.md)).

**Export and hash.** KiCad `.kicad_mod` / `.kicad_sym`, a netlist as the connectivity projection of the IR, and a BOM. `texteda export gerbers` writes the copper, mask, paste and silkscreen layers as RS-274X plus one Excellon file of all holes, computing the zone fill at export — no precomputed fill in the IR or any hash ([ADR-0117](docs/adr/pcb/0117-copper-fill-uses-a-geometry-kernel.md)). `texteda ir` writes `dist/ir/`: one canonical JSON shard per description, a manifest with a sha256 per shard, a project hash over the **normative** shards and a separate `advisory_hash` for the ones that are drawings or second sources ([ADR-0105](docs/adr/ir/0105-ir-shards-and-hashes.md)).

**Not there yet.** The agent-driven layout and routing loop (ADR-0116; no built-in solver), the `.kicad_pcb` board writer and the `fab` description (backlog F15 / F14, [ADR-0120](docs/adr/manufacturing/0120-the-manufacturing-output-path.md); the Gerber layer set and the drill file are landed), KiCad schematic export (F16), the importer for reverse-engineered or external netlists (F36), live routing inside the review GUI's `layout` mode (F34; a move re-anchors the wires, it does not re-route), module parameters and nesting (F13), and rekeying references to the instance UID (a refdes rename still changes source and hash; [ADR-0109](docs/adr/project/0109-instance-identity-is-a-uid.md)). KiCad is the current fallback until the self-built manufacturing exit lands ([ADR-0120](docs/adr/manufacturing/0120-the-manufacturing-output-path.md) D1、D3).

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
| **Layout / routing** | agent-driven, checker-gated; no built-in solver ([ADR-0116](docs/adr/pcb/0116-layout-and-routing-are-agent-driven.md)) | built in | built in | computed in code |
| **Manufacturing** | Gerber layers (copper / mask / paste / silk / edge) + Excellon drill landed; the `fab` package not yet (F15 / F14) | built in | built in, plus one-click ordering | Gerber / BOM / PnP converters |
| **Agent path** | text + typed IR + frozen diagnostic codes + structured layout tools (roadmap) | Python and `kicad-cli` | API SDK and an AI skill over a WebSocket bridge | the agent writes the program |
| **License** | Apache-2.0, contract layer open forever | GPL-3.0+, libraries CC-BY-SA 4.0 | proprietary editor, Apache-2.0 SDK | MIT |

The full, sourced **three-lens** comparison — commercial full-flow GUI, open/low-cost GUI, code/text-first, with AI-native hosted tools adjacent — is [docs/comparison.md](docs/comparison.md).

## CI

`.github/workflows/ci.yml` runs on every push and pull request to `main`. The required gate is **zero-dependency** — it needs Bun and nothing else, no KiCad:

`bun test` · `bun run typecheck` · `bun run gen:check` · `bun run lib:verify` · `bun run check:links` · `bun run check:public` · `bun run fmt:teda --check .`

The KiCad interoperability section is a **separate, optional workflow** (`.github/workflows/ci-kicad.yml`, scheduled and manual) because a gate must never depend on external software ([ADR-0120](docs/adr/manufacturing/0120-the-manufacturing-output-path.md)).

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

`assets/**` and `design/**` are inputs; `views/**` is hand-written and tracked but does not enter the build identity; `dist/**` is derived (`texteda ir` writes `dist/ir/`). Ownership of each directory is grouped in [ADR-0107](docs/adr/project/0107-project-tree-has-owners.md).

## Repository layout

| Path | What it is |
|---|---|
| `AGENTS.md` | **Primary doc**: what the project is, the non-negotiable invariants, acceptance criteria |
| `LICENSE` / `NOTICE` | Apache-2.0 and attribution |
| `spec/` | The specs: `teda.md` (the language-wide spec) plus per-description ones — `symbol` / `footprint` / `pcb` / `schematic-view` / `module` / `procurement` |
| `schemas/ir/` | IR contract (JSON Schema 2020-12, the only contract); the contract version is the directory name |
| `packages/ir` | IR types, contract validation, and the diagnostic code registry |
| `packages/parser` | `.teda` → IR for every description type, plus `fmt` (canonical form); `module` files flatten into the board IR |
| `packages/core` | Pure rules, no fs: connectivity ERC, sch↔pcb binding, device vocabulary and ratings, procurement selection, review rounds, board ↔ view checks and readability |
| `packages/exporter` | footprint / symbol → KiCad (`.kicad_mod` / `.kicad_sym`); netlist |
| `packages/renderer` | Reference renderer: IR → drawing commands → SVG, plus the reverse extraction that closes the round trip ([ADR-0135](docs/adr/view/0135-our-own-reference-renderer.md)) |
| `packages/viewer` | The review app's browser side: page, hover highlight, identity selection; no framework, no canvas editing ([ADR-0134](docs/adr/view/0134-the-view-layer-is-a-drawing.md)) |
| `packages/cli` | `texteda init` / `id` / `compile` / `check` / `netlist` / `ir` / `renumber` / `bom` / `view metrics` / `view rewire` / `view render` / `review` / `lib import` ([ADR-0137](docs/adr/process/0137-implementation-stack-and-agent-entry.md), [ADR-0105](docs/adr/ir/0105-ir-shards-and-hashes.md)) |
| `examples/reference-project/` | Self-contained reference project: two boards (one with a `pcb`, two print pages), every device / symbol / footprint self-built, plus procurement files and review rounds |
| `examples/cases/` | The ten difficult cases: a whole project each, pinned by expected IR and diagnostics (which are written so far: the directory listing; `bun run cases:check`) |
| `docs/adr/` | Architecture decision records ([full index](docs/adr/README.md)) |
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
- [ADR-0100](docs/adr/language/0100-fact-layer-has-no-expressions.md) The Fact Layer Has No Expressions; Generators Live Outside the Language
- [ADR-0101](docs/adr/language/0101-one-language-version-number.md) One Language Version Number
- [ADR-0102](docs/adr/language/0102-diagnostic-error-codes.md) Diagnostic Error Code Registry (`domain.slug`)
- [ADR-0103](docs/adr/language/0103-source-spans.md) Source Spans — Diagnostics Point at the File, the IR Stays Clean
- [ADR-0104](docs/adr/ir/0104-ir-representation.md) IR Representation (Semantic Model / Contract / Serialization)
- [ADR-0105](docs/adr/ir/0105-ir-shards-and-hashes.md) IR Sharding, Identity Keys, and Hashes
- [ADR-0106](docs/adr/ir/0106-device-description-enters-the-ir.md) A Device's Description Is a Fact, So It Enters the IR

**Boards and connectivity**
- [ADR-0107](docs/adr/project/0107-project-tree-has-owners.md) The Project Tree Has Owners
- [ADR-0108](docs/adr/project/0108-board-linking.md) How Boards Are Linked Together
- [ADR-0109](docs/adr/project/0109-instance-identity-is-a-uid.md) Instance Identity Is a Stable Project-Local UID, Not the Refdes
- [ADR-0110](docs/adr/project/0110-renumbering-is-a-code-executed-rename.md) Renumbering Is a Code-Executed Global Rename, Not an Agent Edit
- [ADR-0111](docs/adr/schematic/0111-one-flat-schematic-per-board.md) One Flat Schematic per Board; the Partition Moves to the View Layer
- [ADR-0112](docs/adr/schematic/0112-modules-compose-boards.md) A Board Is Composed of Modules; the IR Stays Flat
- [ADR-0113](docs/adr/schematic/0113-connectivity-has-one-authority.md) Connectivity Has One Authority; Reverse Engineering Is an Import, Not a Mode
- [ADR-0114](docs/adr/schematic/0114-flattening-and-the-net-set.md) Flattening and the Net Set

**Layout, drawing and review**
- [ADR-0115](docs/adr/pcb/0115-agent-first-pcb-description.md) Agent-First PCB Description (Segment Set and Trade-offs)
- [ADR-0116](docs/adr/pcb/0116-layout-and-routing-are-agent-driven.md) Layout and Routing Are Agent-Driven, Checker-Gated, and Frozen on Acceptance
- [ADR-0117](docs/adr/pcb/0117-copper-fill-uses-a-geometry-kernel.md) Copper Fill Uses a Self-Built Constrained Geometry Kernel
- [ADR-0118](docs/adr/pcb/0118-a-partial-layout-is-legal.md) A Partial Layout Is Legal, and It Is Reported
- [ADR-0119](docs/adr/pcb/0119-connect-pairs-need-copper.md) A Declared `connect` Pair Must Be Implemented by Copper
- [ADR-0134](docs/adr/view/0134-the-view-layer-is-a-drawing.md) The View Layer Is an Independent Description, and the View Is a Drawing, Not a Build Input
- [ADR-0135](docs/adr/view/0135-our-own-reference-renderer.md) Our Own Reference Renderer — IR → Drawing Commands → SVG
- [ADR-0136](docs/adr/view/0136-review-records-and-attribution.md) Review Is Not a Description Type — Notes, Decisions, and the One Accountable Person

**Devices, libraries and procurement**
- [ADR-0123](docs/adr/devices/0123-the-device-kind-is-part-or-generic.md) The Device Kind Is `part` or `generic`, and the Devices Live in One Directory
- [ADR-0124](docs/adr/devices/0124-device-vocabulary-and-parameter-roles.md) The Device Vocabulary Is Closed and Checked; a Parameter Is a Role and a Quantity
- [ADR-0125](docs/adr/devices/0125-a-part-states-its-own-ratings.md) A Part States Its Own Ratings, and They Are Checked Against Declared Windows
- [ADR-0126](docs/adr/devices/0126-the-package-gives-a-chip-resistor-its-floor.md) The Package Gives a Chip Resistor Its Floor
- [ADR-0127](docs/adr/devices/0127-package-code-and-3d-models.md) The Package Code Lives in the Footprint; 3D Models Belong to Parts
- [ADR-0128](docs/adr/devices/0128-the-procurement-layer.md) The Procurement Layer — Which Part to Buy Is a Project-Local Decision
- [ADR-0129](docs/adr/libraries/0129-footprint-format-and-geometry.md) Footprint Geometry and 3D Models Do Not Enter the Language; Our Own Footprint Format Is the Source
- [ADR-0130](docs/adr/libraries/0130-symbol-format.md) Self-Built Symbol Libraries Use Our Own Format
- [ADR-0131](docs/adr/libraries/0131-the-reference-project-is-self-built.md) The Reference Project Is Entirely Self-Built
- [ADR-0132](docs/adr/libraries/0132-libraries-are-unverified-facts.md) Libraries Are Unverified Facts; Provenance, Disclaimers, and Corrections
- [ADR-0133](docs/adr/libraries/0133-trust-in-a-library-you-do-not-own.md) Trust in a Library You Do Not Own

**Manufacturing and process**
- [ADR-0120](docs/adr/manufacturing/0120-the-manufacturing-output-path.md) The Manufacturing Output Path and Its Target Form
- [ADR-0121](docs/adr/manufacturing/0121-jlc-prototype-delivery.md) JLC Prototype Delivery (BOM / Coordinates / Part Number)
- [ADR-0122](docs/adr/manufacturing/0122-the-output-package-carries-its-provenance.md) The Output Package Carries Its Own Provenance
- [ADR-0137](docs/adr/process/0137-implementation-stack-and-agent-entry.md) Implementation Stack and the Agent's Entry Point
- [ADR-0138](docs/adr/process/0138-licensing-and-open-standard.md) Licensing and Openness Policy
- [ADR-0139](docs/adr/process/0139-process-entities-outside-the-language.md) Process Entities Stay Outside the Language
- [ADR-0140](docs/adr/process/0140-documentation-has-one-authority-per-fact.md) Documentation Has One Authority per Fact, and the Rest Is a Pointer

The complete index, with titles, status and dates, is [docs/adr/README.md](docs/adr/README.md).

## Authoring

- [docs/guides/symbol-authoring.md](docs/guides/symbol-authoring.md) build a symbol
- [docs/guides/footprint-authoring.md](docs/guides/footprint-authoring.md) build a footprint
- [docs/guides/library-import.md](docs/guides/library-import.md) import an external library as a template
- [docs/guides/review-records.md](docs/guides/review-records.md) keep review records
- [docs/guides/role-reviews.md](docs/guides/role-reviews.md) run a review round from several roles
- [docs/guides/review-app.md](docs/guides/review-app.md) open the review app
- [docs/guides/kicad-pcb-format.md](docs/guides/kicad-pcb-format.md) read a KiCad board file
