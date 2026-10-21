# Tooling comparison: TextEDA vs KiCad vs EasyEDA vs tscircuit

Comparison date: **2026-10-21**. Product versions, licenses and feature splits change; re-check the linked sources before quoting this document. Every statement about TextEDA is made against this repository at that date, including the parts that are not implemented yet.

## Read this first: the four tools do not occupy the same layers

Comparing a language-and-validator project with a GUI editor is a category error unless the layers are named first. This is the layer map from `AGENTS.md` §3, applied to four tools:

| Layer | What lives there | TextEDA | KiCad | EasyEDA | tscircuit |
|---|---|---|---|---|---|
| **Source of truth** | the artifact a human edits | `.teda` text files — `sch` and `pcb` are two independent sibling descriptions | `.kicad_sch` / `.kicad_pcb` s-expression files; the schematic drives the PCB | JSON project source (Std and Pro) | TypeScript / TSX code |
| **Typed IR** | a machine-checkable intermediate form | `schemas/ir/v0.1/` — JSON Schema 2020-12, canonical JSON, integer-only units, `source_hash` | no separate layer; the file *is* the model | JSON project format (partly published) | `circuit-json` — zod-defined element types |
| **Validation** | ERC / DRC / binding | connectivity ERC + sch↔pcb binding (`packages/core`), IR contract validation, frozen diagnostic codes | built-in ERC and DRC | DRC in both editions; netlist comparison in Pro | zod parse errors plus design-rule warnings carried inside the IR |
| **Rendering** | the picture of the design | own reference renderer (symbol/footprint → SVG); schematic view layer designed, not built ([ADR-0021](adr/0021-schematic-view-layer.md)) | schematic, PCB and 3D viewer in the GUI | schematic and PCB editor in the browser and the desktop client | web viewers for PCB, schematic and 3D |
| **Layout and routing** | placement and copper | **not implemented**; borrowed (KiCad, freerouting) | built in — interactive routing, DRC | built in — routing and DRC | computed in code; `dsn-converter` bridges to freerouting |
| **Manufacturing output** | Gerbers, drill, pick-and-place | **not implemented yet** (backlog F15); the target shape is manufacturing-neutral data ([ADR-0018](adr/0018-zero-dependency-and-manufacturing-target.md)) | built in — Gerber, Excellon, STEP, BOM, position files | built in, plus one-click JLC ordering | `circuit-json-to-gerber`, `-bom-csv`, `-pnp-csv` |
| **Component library** | symbols and footprints | project-built libraries in `.teda`; a general-purpose library is deliberately out of scope | official symbol and footprint libraries | LCSC / JLCPCB parts library integrated with ordering | per-component npm packages plus `registry.tscircuit.com` |
| **Agent interface** | how a machine drives the tool | plain text + typed IR + diagnostic codes (`domain.slug`) + a `--json` payload | Python (`pcbnew`) and `kicad-cli`; no official agent-facing API | published extension and API SDK, an AI skill with a WebSocket bridge, a CLI client | the code is the interface — the agent writes TSX |
| **License** | | Apache-2.0; the contract layer stays open forever ([ADR-0015](adr/0015-licensing-and-open-standard.md)) | program GPL-3.0+, libraries CC-BY-SA 4.0 | editor proprietary; SDK and extensions Apache-2.0 | MIT |

One structural difference is worth pulling out of the table, because it is the one that changes how a design is written: **in KiCad the schematic is upstream of the PCB** (the netlist flows one way), while TextEDA makes `sch` and `pcb` two siblings that share an identity space, and a separate checker proves they agree ([ADR-0003](adr/0003-agent-first-pcb-ir.md)). The second one: **TextEDA and tscircuit are both agent-native, but in opposite directions** — tscircuit asks an agent to *write a program* that happens to describe hardware, TextEDA asks an agent to *edit facts* that a human wrote and reviews.

## TextEDA (this repository)

- **What it is**: a text description language for a whole hardware project, a typed IR as the single source of truth, validators, a reference renderer and exporters. It is not an editor, not a layout engine, not a library product.
- **What exists today**: `footprint`, `symbol`, `schematic` and `page` parsing plus canonical formatting; `component` facts (read-only); `pcb` parsing (12 sections); connectivity ERC and sch↔pcb binding checks; KiCad `.kicad_mod` / `.kicad_sym` export; a netlist as the connectivity projection of the IR; a symbol/footprint SVG renderer with a built-in stroke font; `texteda init` / `compile` / `check` / `netlist`. A self-contained reference project with 22 components, 15 symbols and 16 footprints, all libraries self-built.
- **What it is not, yet**: no schematic renderer, no stable component IDs (identity is still the flattened name — [ADR-0008](adr/0008-ir-shard-identity-and-hash.md) decision 3 is unfulfilled), no manufacturing output, no hierarchy or `fab` description, no ten-case conformance corpus, and no general component library. The honest summary: the front half of the toolchain is landed, the back half is designed.
- **Its bet**: the *contract* is the product. A third party can implement the language without using this implementation, and the corpus — not the code — is the thing that spreads.

## KiCad

- **What it is**: the reference open-source GUI EDA suite — schematic, PCB, 3D viewer, ERC, DRC, and a full manufacturing exit. It is the backend this project exports to ([ADR-0005](adr/0005-manufacturing-output.md)).
- **Current release**: 10.0.7, October 2026 ([release notes](https://www.kicad.org/blog/2026/10/10/release-kicad-10-0-7/)).
- **Licensing** ([licenses page](https://www.kicad.org/about/licenses/)): the program is GPL-3.0-or-later (plus third-party licenses inside the tree); the official libraries are CC-BY-SA 4.0; the documentation is GPL-3.0+ or CC-BY-3.0+.
- **Formats and automation**: s-expression text files (`.kicad_sch`, `.kicad_pcb`) — the same property TextEDA wants (diffable, scriptable), but they also carry the finished drawing: positions, plot parameters, UUIDs, net numbering, fill caches. `pcbnew` Python scripting and `kicad-cli` are the automation path; there is no official agent-facing API.
- **Why it stays in the picture**: the core TextEDA path never requires KiCad to be installed ([ADR-0018](adr/0018-zero-dependency-and-manufacturing-target.md)), but a gate never depends on external tools either — so KiCad interoperability is an *optional* CI workflow, and the correctness definition is our own checker.

## EasyEDA

- **What it is**: a browser- and desktop-based schematic/PCB editor with an integrated parts library and one-click manufacturing ordering. Two editions: **Standard** (free, web plus a desktop client) and **Professional** (paid, offline-first) — the split is documented in the [Std vs Pro comparison](https://prodocs.easyeda.com/en/introduction/Std-vs-Pro/). Both editions keep the project source as JSON and support DRC, BOM, extensions and scripting; Standard adds simulation, Pro adds netlist comparison and a history feature.
- **What is actually open**: the [GitHub organization](https://github.com/easyeda) publishes the *ecosystem* around the editor, not the editor's own source — the extension and API SDK, the [Pro V3 project file format description](https://github.com/easyeda/easyeda-file-format), the viewers, and notably [`easyeda/easyeda-api-skill`](https://github.com/easyeda/easyeda-api-skill), an AI skill that exposes the Pro API to coding agents over a WebSocket bridge, plus [`easyeda/easyeda-client-cli`](https://github.com/easyeda/easyeda-client-cli), which drives the desktop client through a full design-to-manufacturing-file flow.
- **Why it matters for this comparison**: EasyEDA has effectively chosen the *opposite* agent strategy from TextEDA — instead of giving the agent a typed source of truth, it gives the agent a **remote control for the existing GUI**. That is a much cheaper path to "an agent can do EDA", and it works precisely because the GUI already exists and encodes the rules. It also means the agent inherits the GUI's file format as its model, with all the drift that implies.
- **Business**: proprietary editor, paid Pro edition, and a direct commercial tie to parts ordering — the opposite of TextEDA's "pure open technical specification, no revenue model" position ([ADR-0015](adr/0015-licensing-and-open-standard.md)).

## tscircuit

- **What it is**: a code-first EDA path — TypeScript/TSX describes the board, `@tscircuit/core` evaluates it into [Circuit JSON](https://github.com/tscircuit/circuit-json), and a family of converters turns that into Gerbers, 3D, BOM, pick-and-place, SPICE netlists, SVG and Specctra DSN.
- **License**: MIT ([LICENSE](https://github.com/tscircuit/tscircuit/blob/main/LICENSE)).
- **The IR**: `circuit-json` is a flat JSON array of typed elements — `source_component`, `pcb_component`, `pcb_port`, `pcb_trace` and so on — defined with zod, and it carries the *warnings and errors* of the design inside the IR itself (for example `PcbTraceError`, `SourceMissingGroundPinWarning`). That is a real and good idea, and TextEDA's diagnostic registry ([ADR-0016](adr/0016-diagnostic-error-codes.md)) solves the same problem on a different axis: a frozen `domain.slug` code table with severity and spec reference, emitted separately from the data.
- **Units**: strings with units are allowed (`{ max_trace_length: "100mm" }`), and bare numbers mean base units (mm, ms). TextEDA takes the stricter route: units live in the literals of the source language, and the IR stores integers only ([ADR-0008](adr/0008-ir-shard-identity-and-hash.md)).
- **Ecosystem**: `circuit-json-to-gerber`, `circuit-json-to-bom-csv`, `circuit-json-to-pnp-csv`, `circuit-json-to-spice`, `circuit-to-svg`, `dsn-converter`, `pcb-viewer`, `schematic-viewer`, `3d-viewer`, `circuit-json-to-gltf`, plus a component registry at `registry.tscircuit.com` and an online playground.
- **The difference that matters**: the source *is* a program. That makes generation trivial and review hard — nobody reads a thousand-line TSX diff to check a resistor value. TextEDA's bet is the opposite: one fact per line, tables for facts, canonical formatting, so a diff is a one-line change a human can approve. The trade is expressiveness: tscircuit can compute, TextEDA's fact layer cannot (the decision is reserved as ADR-0017, backlog F9).

## What TextEDA is not good at yet

The comparison is only honest if the gaps are on the same page as the features:

| Gap | Consequence | Status |
|---|---|---|
| No GUI, no layout, no routing | you cannot finish a board inside TextEDA | by design — KiCad is the backend |
| No manufacturing output | the pipeline ends at KiCad import for now | backlog F15, target shape decided in [ADR-0018](adr/0018-zero-dependency-and-manufacturing-target.md) |
| Identity is the flattened name | renaming a reference changes its identity; diffs across renames are not stable | [ADR-0008](adr/0008-ir-shard-identity-and-hash.md) (Proposed) decision 3, unfulfilled |
| No conformance corpus | "standard" is currently a claim backed by one reference project, not by third-party implementations | backlog F12, deliberately deferred |
| No schematic rendering | a reviewer cannot yet read the design as a picture | backlog F3, view layer decided in [ADR-0021](adr/0021-schematic-view-layer.md) |
| Small, project-built library | real parts must be authored per project | by design — see [ADR-0010](adr/0010-footprint-and-3d-model-ownership.md) |

## Which one to use

- **You want to design a board today, with a GUI, and ship it**: KiCad. Nothing here competes with it.
- **You want the shortest path from an agent to a manufacturable board, and you accept the GUI's file model**: EasyEDA — the API skill already exists.
- **You want hardware as code, and you are comfortable reviewing program diffs**: tscircuit.
- **You want a design whose *meaning* is checkable — units, electrical types, constraints, and two independent descriptions that must agree — and you want an agent to edit facts a human approves**: TextEDA, with KiCad as the backend.

## What would change this comparison

TextEDA's claim is that the contract layer becomes the standard. That claim is currently ahead of the evidence: it needs the conformance corpus (F12), stable identity (ADR-0008), a schematic view layer (ADR-0021) and a language version that reaches 1.0 ([ADR-0022](adr/0022-language-versioning.md)). Until then the honest position is: **a well-specified, machine-checkable description language with a working toolchain, and a standard that is not yet demonstrated.**

## Sources

- KiCad 10.0.7 release: <https://www.kicad.org/blog/2026/10/10/release-kicad-10-0-7/>
- KiCad licenses (program / libraries / documentation): <https://www.kicad.org/about/licenses/>
- EasyEDA Standard vs Professional feature split: <https://prodocs.easyeda.com/en/introduction/Std-vs-Pro/>
- EasyEDA GitHub organization (SDK, extensions, viewers, AI skill, CLI client, file format): <https://github.com/easyeda>
- EasyEDA API skill for coding agents: <https://github.com/easyeda/easyeda-api-skill>
- EasyEDA client CLI (design to manufacturing files): <https://github.com/easyeda/easyeda-client-cli>
- tscircuit core: <https://github.com/tscircuit/core>
- Circuit JSON specification: <https://github.com/tscircuit/circuit-json>
- tscircuit LICENSE (MIT): <https://github.com/tscircuit/tscircuit/blob/main/LICENSE>
- tscircuit docs and registry: <https://docs.tscircuit.com/> · <https://registry.tscircuit.com/>
