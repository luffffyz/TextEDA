# Tooling comparison: TextEDA against three classes of EDA

Comparison date: **2026-10-26** for every statement about TextEDA (the repository as it stands today, including the parts that are not implemented yet). Third-party facts were checked on **2026-10-21** (KiCad, EasyEDA, tscircuit) and **2026-10-26** (atopile). Product versions, licenses and feature splits change; re-check the linked sources before quoting this document.

## Read this first: compare layers, not logos

Comparing a language-and-validator project with a GUI editor is a category error unless the layers are named first. This is the layer map from `AGENTS.md` §3, applied to four tools:

| Layer | What lives there | TextEDA | KiCad | EasyEDA | tscircuit |
|---|---|---|---|---|---|
| **Source of truth** | the artifact a human edits | `.teda` text files — `sch` and `pcb` are two independent sibling descriptions | `.kicad_sch` / `.kicad_pcb` s-expression files; the schematic drives the PCB | JSON project source (Std and Pro) | TypeScript / TSX code |
| **Typed IR** | a machine-checkable intermediate form | `schemas/ir/` (the contract version is the directory name) — JSON Schema 2020-12, canonical JSON, integer-only units, `source_hash` | no separate layer; the file *is* the model | JSON project format (partly published) | `circuit-json` — zod-defined element types |
| **Validation** | ERC / DRC / binding | connectivity ERC + sch↔pcb binding + device rules and ratings + procurement selection (`packages/core`), IR contract validation, frozen diagnostic codes; an agent-facing geometric DRC subset is roadmap ([ADR-0017](adr/05-pcb/0017-layout-and-routing-are-agent-driven.md)) | built-in ERC and DRC | DRC in both editions; netlist comparison in Pro | zod parse errors plus design-rule warnings carried inside the IR |
| **Rendering** | the picture of the design | own reference renderer (symbol / footprint / schematic print page → SVG, each with its reverse extraction, [ADR-0035](adr/09-view/0035-the-view-layer-is-a-drawing.md)) plus a browser review app over the rendered pages | schematic, PCB and 3D viewer in the GUI | schematic and PCB editor in the browser and the desktop client | web viewers for PCB, schematic and 3D |
| **Layout and routing** | placement and copper | **roadmap**: agent-driven, checker-gated; **no built-in solver** ([ADR-0017](adr/05-pcb/0017-layout-and-routing-are-agent-driven.md)) | built in — interactive routing, DRC | built in — routing and DRC | computed in code; `dsn-converter` bridges to freerouting |
| **Manufacturing output** | Gerbers, drill, pick-and-place | **partial**: self-built Gerber (copper / mask / paste / silk / edge) and Excellon writers, zero external tools (backlog F15); pick-and-place and the `fab` package are the target shape, manufacturing-neutral data ([ADR-0021](adr/06-manufacturing/0021-the-manufacturing-output-path.md)) | built in — Gerber, Excellon, STEP, BOM, position files | built in, plus one-click JLC ordering | `circuit-json-to-gerber`, `-bom-csv`, `-pnp-csv` |
| **Component library** | symbols and footprints | project-built libraries in `.teda`; a general-purpose library is deliberately out of scope | official symbol and footprint libraries | LCSC / JLCPCB parts library integrated with ordering | per-component npm packages plus `registry.tscircuit.com` |
| **Agent interface** | how a machine drives the tool | plain text + typed IR + diagnostic codes (`domain.slug`) + a `--json` payload + structured layout tools (roadmap) | Python (`pcbnew`) and `kicad-cli`; no official agent-facing API | published extension and API SDK, an AI skill with a WebSocket bridge, a CLI client | the code is the interface — the agent writes TSX |
| **License** | | Apache-2.0; the contract layer stays open forever ([ADR-0039](adr/10-process/0039-licensing-and-open-standard.md)) | program GPL-3.0+, libraries CC-BY-SA 4.0 | editor proprietary; SDK and extensions Apache-2.0 | MIT |

Commercial full-flow suites (Altium, Cadence, Siemens) occupy every row of this map. They are not a
single column because their differences matter less than the layer they own: an integrated
library, constraint manager, SI/PI/thermal analysis, DFM, and support organization.

Two structural differences matter more than any feature row:

- **In KiCad the schematic is upstream of the PCB** (the netlist flows one way). TextEDA makes
  `sch` and `pcb` two siblings that share an identity space, and a separate checker proves they
  agree ([ADR-0016](adr/05-pcb/0016-agent-first-pcb-description.md)).
- **TextEDA and tscircuit are both agent-native, in opposite directions.** tscircuit asks an agent
  to *write a program* that describes hardware. TextEDA asks an agent to *edit facts* that a human
  reviews, under a checker that can reject the edit.

## Three comparison lenses

The tools do not form one category. They form three lenses, plus an adjacent AI-native one. TextEDA
appears in the code/text lens, but it aims at the full flow; the lenses are ways to ask a fair
question, not a partition of the market.

| Lens | Examples | What it decides | What a fair comparison asks |
|---|---|---|---|
| **Commercial full-flow GUI** | Altium Designer, Cadence Allegro/OrCAD, Siemens Xpedition | Enterprise sign-off: library/PLM, constraints, SI/PI/thermal/EMC, rigid-flex/HDI, DFM, support | Can a text/IR layer feed or replace the review loop? What lock-in does the source model create? |
| **Open / low-cost GUI** | KiCad, EasyEDA / LCEDA, LibrePCB, Horizon EDA | How a person draws and ships a board with a GUI | Usability, library, manufacturing integration, extensibility, license |
| **Code/text-first** | atopile, tscircuit, TextEDA, SKiDL, JITX | How the design is expressed and checked | Source model, IR, validation, layout/routing, agent interface, openness |
| **Adjacent: AI-native hosted** | heypcb, Flux | How an agent drives an existing editor | Natural language fidelity, DRC/ERC, review/apply, data ownership, subscription lock-in |

EasyEDA / LCEDA is **not** an open-source GUI: the editor is proprietary, and the open GitHub
organization covers SDKs, extensions, viewers, file-format notes and an agent bridge. Calling it
"open GUI" would misstate both its license and its business model.

## Lens 1: commercial full-flow GUI

**Examples:** Altium Designer, Cadence Allegro/OrCAD, Siemens Xpedition.

These tools own the whole physical flow and the organization around it: a managed component
library, constraint-driven layout, high-speed and differential-pair rules, impedance and stackup
control, thermal and SI/PI analysis, rigid-flex and HDI, 3D/DFM checks, fabrication outputs,
support contracts, and certification workflows. Their source formats are closed or only partly
documented, and their automation surfaces are scripts and APIs around a GUI, not a text contract.

TextEDA does not compete with them on feature count today. The honest comparison is architectural:

- **They encode intent in constraints and a GUI.** TextEDA encodes intent in facts and a typed IR,
  and proves the two descriptions agree.
- **They are the benchmark for what "finished" means.** A layout is not finished because it
  compiles; it is finished when the library, rules, analysis, DFM and sign-off are done. TextEDA's
  scope deliberately stops before CAM-level judgement ([ADR-0021](adr/06-manufacturing/0021-the-manufacturing-output-path.md)).
- **The interesting question is interop, not replacement.** A text/IR layer that can produce a
  clean handoff to a commercial flow is useful even if it never replaces the GUI.

Do not compare prices or feature counts here. Compare the source model, the automation surface, and
who is accountable for the physical sign-off.

## Lens 2: open / low-cost GUI

### KiCad

- **What it is**: the reference open-source GUI EDA suite — schematic, PCB, 3D viewer, ERC, DRC,
  and a full manufacturing exit. It is the backend this project exports to ([ADR-0021](adr/06-manufacturing/0021-the-manufacturing-output-path.md) D1).
- **Current release**: 10.0.7, October 2026 ([release notes](https://www.kicad.org/blog/2026/10/10-release-kicad-10-0-7/)).
- **Licensing** ([licenses page](https://www.kicad.org/about/licenses/)): the program is
  GPL-3.0-or-later (plus third-party licenses inside the tree); the official libraries are
  CC-BY-SA 4.0; the documentation is GPL-3.0+ or CC-BY-3.0+.
- **Formats and automation**: s-expression text files (`.kicad_sch`, `.kicad_pcb`) — diffable and
  scriptable, but they also carry the finished drawing: positions, plot parameters, UUIDs, net
  numbering, fill caches. `pcbnew` Python scripting and `kicad-cli` are the automation path; there
  is no official agent-facing API.
- **Why it stays in the picture**: the core TextEDA path never requires KiCad to be installed
  ([ADR-0021](adr/06-manufacturing/0021-the-manufacturing-output-path.md) D1), but a gate never depends on
  external tools either — so KiCad interoperability is an *optional* CI workflow, and the
  correctness definition is our own checker. KiCad DRC is an optional oracle, not the gate
  ([ADR-0017](adr/05-pcb/0017-layout-and-routing-are-agent-driven.md)).

### EasyEDA / LCEDA

- **What it is**: a browser- and desktop-based schematic/PCB editor with an integrated parts
  library and one-click manufacturing ordering. Two editions: **Standard** (free, web plus a
  desktop client) and **Professional** (paid, offline-first) — the split is documented in the
  [Std vs Pro comparison](https://prodocs.easyeda.com/en/introduction/Std-vs-Pro/). Both editions
  keep the project source as JSON and support DRC, BOM, extensions and scripting; Standard adds
  simulation, Pro adds netlist comparison and a history feature.
- **What is actually open**: the [GitHub organization](https://github.com/easyeda) publishes the
  *ecosystem* around the editor, not the editor's own source — the extension and API SDK, the
  [Pro V3 project file format description](https://github.com/easyeda/easyeda-file-format), the
  viewers, and notably [`easyeda/easyeda-api-skill`](https://github.com/easyeda/easyeda-api-skill),
  an AI skill that exposes the Pro API to coding agents over a WebSocket bridge, plus
  [`easyeda/easyeda-client-cli`](https://github.com/easyeda/easyeda-client-cli), which drives the
  desktop client through a full design-to-manufacturing-file flow.
- **Why it matters for this comparison**: EasyEDA has effectively chosen the *opposite* agent
  strategy from TextEDA — instead of giving the agent a typed source of truth, it gives the agent a
  **remote control for the existing GUI**. That is a much cheaper path to "an agent can do EDA",
  and it works precisely because the GUI already exists and encodes the rules. It also means the
  agent inherits the GUI's file format as its model, with all the drift that implies.
- **Business**: proprietary editor, paid Pro edition, and a direct commercial tie to parts ordering
  — the opposite of TextEDA's "pure open technical specification, no revenue model" position
  ([ADR-0039](adr/10-process/0039-licensing-and-open-standard.md)).

### LibrePCB and Horizon EDA

Smaller open-source GUI projects with their own native formats and libraries. They matter because
they show the same split as KiCad: the GUI owns the design, the format is a by-product, and agent
automation is an add-on rather than the contract. They are not detailed row-by-row here; the point
is that "open source" does not imply "text-first" or "agent-first".

## Lens 3: code/text-first

### atopile

- **What it is**: a declarative `.ato` language plus compiler and toolchain for electronics;
  modules, interfaces, units, tolerances, assertions, constraint solving, and automatic parametric
  picking of discrete components. Layout happens in KiCad. MIT licensed.
- **Where it fits**: requirements and component selection are expressed as constraints; the
  compiler solves them and updates a KiCad layout. That is a genuine software-like abstraction of
  the *front half* of hardware design.
- **What it is not**: an agent-driven router. The layout is still a KiCad activity, and the
  automatic part picker solves electrical constraints, not lifecycle, mechanical or DFM
  constraints. "Reusable module" in atopile means a source-level module, not a physically
  revalidated board.

### tscircuit

- **What it is**: a code-first EDA path — TypeScript/TSX describes the board, `@tscircuit/core`
  evaluates it into [Circuit JSON](https://github.com/tscircuit/circuit-json), and a family of
  converters turns that into Gerbers, 3D, BOM, pick-and-place, SPICE netlists, SVG and Specctra
  DSN.
- **License**: MIT ([LICENSE](https://github.com/tscircuit/tscircuit/blob/main/LICENSE)).
- **The IR**: `circuit-json` is a flat JSON array of typed elements — `source_component`,
  `pcb_component`, `pcb_port`, `pcb_trace` and so on — defined with zod, and it carries the
  *warnings and errors* of the design inside the IR itself (for example `PcbTraceError`,
  `SourceMissingGroundPinWarning`). That is a real and good idea; TextEDA's diagnostic registry
  ([ADR-0003](adr/01-language/0003-diagnostic-error-codes.md)) solves the same problem on a different axis: a
  frozen `domain.slug` code table with severity and spec reference, emitted separately from the
  data.
- **Units**: strings with units are allowed (`{ max_trace_length: "100mm" }`), and bare numbers
  mean base units (mm, ms). TextEDA takes the stricter route: units live in the literals of the
  source language, and the IR stores integers only ([ADR-0006](adr/02-ir/0006-ir-shards-and-hashes.md)).
- **Ecosystem**: `circuit-json-to-gerber`, `circuit-json-to-bom-csv`, `circuit-json-to-pnp-csv`,
  `circuit-json-to-spice`, `circuit-to-svg`, `dsn-converter`, `pcb-viewer`, `schematic-viewer`,
  `3d-viewer`, `circuit-json-to-gltf`, plus a component registry at `registry.tscircuit.com` and an
  online playground.
- **The difference that matters**: the source *is* a program. That makes generation trivial and
  review hard — nobody reads a thousand-line TSX diff to check a resistor value. TextEDA's bet is
  the opposite: one fact per line, tables for facts, canonical formatting, so a diff is a one-line
  change a human can approve. The trade is expressiveness: tscircuit can compute, TextEDA's fact
  layer cannot ([ADR-0001](adr/01-language/0001-fact-layer-has-no-expressions.md)).

### TextEDA

- **What it is**: a text description language for a whole hardware project, a typed IR as the
  single source of truth, validators, a reference renderer and exporters. It is not a library
  product and does not ship a placement or routing solver.
- **What exists today**: parsing and canonical formatting for `schematic`, `module`, `view`,
  `pcb`, `system`, `procurement`, `symbol` and `footprint` (plus read-only `component` facts and
  `project.toml`); connectivity ERC, sch↔pcb binding (including copper backing of every declared
  `connect` pair and reporting of partial layouts), device vocabulary and parameter roles, ratings
  and dissipation against declared limits, procurement selection, review-round closure, and board ↔
  print-page cross-checks with readability numbers; KiCad `.kicad_mod` / `.kicad_sym` export; a
  netlist as the connectivity projection of the IR; a symbol / footprint / schematic-print-page SVG
  renderer with a built-in stroke font, each closed by `extract(render(ir)) == ir`; a browser review
  app with hover, selection, source jump, and a frozen diagnostic-code registry.
- **What it is not, yet**: no implemented layout or routing (agent-driven loop is roadmap,
  [ADR-0017](adr/05-pcb/0017-layout-and-routing-are-agent-driven.md)); the Gerber layer set and the drill
  file are landed, but no pick-and-place, no `fab` description and no `.kicad_pcb` writer, no KiCad
  schematic export, no importer for
  reverse-engineered or external netlists, no module parameters or nesting, and no rekeying of
  references to the instance UID (instances have a stable `uid`, but a refdes rename still changes
  source and hash — [ADR-0010](adr/03-project/0010-instance-identity-is-a-uid.md)). The review
  app has one mode (`review`); `layout` and `placement` are pending (backlog F34). The honest
  summary: the description layer, the checks, the rendering path and the raw fabrication files are
  landed; the physical loop and the package around the files are designed.
- **Its bet**: the *contract* is the product. A third party can implement the language without
  using this implementation, and the corpus — not the code — is the thing that spreads.

### How the code/text tools differ

| | atopile | tscircuit | TextEDA |
|---|---|---|---|
| Source | `.ato` declarations | TSX program | one fact per line in `.teda` tables |
| Intermediate form | compiler graph + constraints | Circuit JSON | JSON Schema IR, canonical JSON, integer units |
| Validation | constraints, checks, part picking | zod parse + warnings in the IR | ERC, binding, device/ratings, procurement, contracts, frozen codes |
| Layout / routing | KiCad GUI | code + `dsn-converter` / freerouting | roadmap: agent as search policy, checker-gated (no solver) |
| Agent interface | writes `.ato`, reads diagnostics | writes TSX | edits facts, calls structured tools, reads diagnostics |
| License | MIT | MIT | Apache-2.0 implementation; contract layer open forever |

Adjacent code-based projects exist on both sides of this table: **SKiDL** (Python netlist
generation, no layout) and **JITX** (commercial, code-based board design). They are useful
references for "what a source-level abstraction buys", not direct feature competitors.

## Adjacent: AI-native hosted tools

**heypcb** and **Flux** put an agent in front of an existing editor rather than defining a new
text contract. They are closer to EasyEDA's remote-control strategy than to TextEDA's typed-IR
strategy. They are not compared row-by-row here because their product surface is the hosted UX and
the model loop, not a public language or checker. The question they raise is the right one: how
much of the design loop can an agent drive before a human must sign off?

## What TextEDA is not good at yet

The comparison is only honest if the gaps are on the same page as the features:

| Gap | Consequence | Status |
|---|---|---|
| No layout or routing implementation | you cannot finish a board inside TextEDA today | roadmap: agent-driven, checker-gated; no built-in solver ([ADR-0017](adr/05-pcb/0017-layout-and-routing-are-agent-driven.md)) |
| No manufacturing output | the pipeline ends at KiCad import for now | backlog F15, target shape decided in [ADR-0021](adr/06-manufacturing/0021-the-manufacturing-output-path.md) |
| Agent-facing DRC is not implemented | the agent loop has no geometric feedback yet | ADR-0017; DRC subset is planned in `packages/core` |
| Identity is the flattened name for references | an instance has a stable `uid`, but net/view/pcb references and hashes still follow display names, so renames are not diff-stable | [ADR-0010](adr/03-project/0010-instance-identity-is-a-uid.md) |
| No third-party conformance proof | "standard" is currently a claim backed by one reference project and 4 landed cases, not by independent implementations | backlog F12 (4 of 10 cases), deliberately deferred |
| No physical sign-off | the design is checked, but no DRC-grade rule set and no manufacturing files | by design — CAM judgement is borrowed ([ADR-0021](adr/06-manufacturing/0021-the-manufacturing-output-path.md) D2) |
| Small, project-built library | real parts must be authored per project | by design — see [ADR-0030](adr/08-libraries/0030-footprint-format-and-geometry.md) |

## Which one to use

- **You want enterprise-grade sign-off, SI/PI/thermal and a supported flow**: Altium, Cadence or
  Siemens. TextEDA is not a replacement today.
- **You want to design a board today, with a GUI, and ship it**: KiCad. Nothing here competes with
  it as a GUI.
- **You want the shortest path from an agent to a manufacturable board, and you accept the GUI's
  file model**: EasyEDA — the API skill already exists.
- **You want to capture requirements, constraints and parametric part selection**: atopile.
- **You want hardware as code, and you are comfortable reviewing program diffs**: tscircuit.
- **You want a design whose *meaning* is checkable — units, electrical types, constraints, and two
  independent descriptions that must agree — and you want an agent to edit facts a human approves**:
  TextEDA, with KiCad as the backend and agent-driven layout/routing on the roadmap.
- **You want an agent to drive an existing editor with natural language**: heypcb or Flux.

## Why KiCad files are not the IR (measured)

The reason TextEDA does not adopt `.kicad_sch` as its source of truth is measurable rather than
aesthetic. Measured on one small KiCad schematic (KiCad 10.0.7): a single resistor plus two labels
serializes to 3746 B, of which the semantic content is roughly 25 B (0.7%).

| Content | Share |
|---|---|
| Whitespace and indentation | 35.4% |
| Structural keywords | 25.1% |
| Coordinates | 10.1% |
| UUIDs | 8.1% |
| Style keywords | 1.3% |

`lib_symbols` alone is 47.5% of the file (pin definitions 528 B, graphics 186 B, property boilerplate
852 B) — the full symbol drawing is inlined into every schematic that uses it.

**Conclusion**: the KiCad format stores a *finished drawing*, not a design. It is an export target,
not a reference model for the IR.

## What would change this comparison

TextEDA's claim is that the contract layer becomes the standard. That claim is ahead of the
evidence: it needs a working agent layout/routing loop with a real DRC subset
([ADR-0017](adr/05-pcb/0017-layout-and-routing-are-agent-driven.md)), the full ten-case conformance corpus
(F12 — 4 of 10 landed), rekeying references to stable instance UIDs
([ADR-0010](adr/03-project/0010-instance-identity-is-a-uid.md)), a third-party implementation
(F4), and a language version that reaches 1.0 ([ADR-0002](adr/01-language/0002-one-language-version-number.md)). Until
then the honest position is: **a well-specified, machine-checkable description language with a
working toolchain, an agent-editable IR, and a standard that is not yet demonstrated.**

## Sources

- KiCad 10.0.7 release: <https://www.kicad.org/blog/2026/10/10-release-kicad-10-0-7/>
- KiCad licenses (program / libraries / documentation): <https://www.kicad.org/about/licenses/>
- EasyEDA Standard vs Professional feature split: <https://prodocs.easyeda.com/en/introduction/Std-vs-Pro/>
- EasyEDA GitHub organization (SDK, extensions, viewers, AI skill, CLI client, file format): <https://github.com/easyeda>
- EasyEDA API skill for coding agents: <https://github.com/easyeda/easyeda-api-skill>
- EasyEDA client CLI (design to manufacturing files): <https://github.com/easyeda/easyeda-client-cli>
- atopile: <https://github.com/atopile/atopile> · <https://docs.atopile.io/>
- tscircuit core: <https://github.com/tscircuit/core>
- Circuit JSON specification: <https://github.com/tscircuit/circuit-json>
- tscircuit LICENSE (MIT): <https://github.com/tscircuit/tscircuit/blob/main/LICENSE>
- tscircuit docs and registry: <https://docs.tscircuit.com/> · <https://registry.tscircuit.com/>
- Altium Designer: <https://www.altium.com/altium-designer>
- Cadence Allegro: <https://www.cadence.com/en_US/home/tools/pcb-design-and-analysis/allegro.html>
- Siemens Xpedition: <https://eda.sw.siemens.com/en-US/pcb/xpedition/>
- LibrePCB: <https://librepcb.org/>
- Horizon EDA: <https://horizon-eda.org/>
- SKiDL: <https://github.com/devbisme/skidl>
- JITX: <https://www.jitx.com/>
- heypcb: <https://heypcb.com/>
- Flux: <https://www.flux.ai/>
