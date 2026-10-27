# ADR-0013: The Reference Project Is Entirely Self-Built — Symbol and Footprint Libraries Live in the Project, and Library-Level Checks Close the Loop

Status: Accepted
Date: 2026-10-20
Impact: [ADR-0010](0010-footprint-and-3d-model-ownership.md) (self-built libraries), [ADR-0011](0011-library-format-and-footprint-ir.md) (library format), [ADR-0012](0012-symbol-description.md) (symbol library); `examples/reference-project/` (`project.toml`, `assets/components/`, `assets/symbols/project/`, `assets/footprints/project/`); `schemas/ir/v0.1/project.schema.json` (`lib.symbols` / `lib.footprints`); `scripts/libhash.ts`; `scripts/verify-libs.ts`; `packages/exporter/src/symbol.ts` (stroke fix); `docs/footprint-authoring.md`; `docs/symbol-authoring.md`; `AGENTS.md` §4.5, §9, §10

## Background

The reference project `examples/reference-project/` originally got the whole pipeline running on **borrowed libraries**: the `symbol` / `footprint` of 22 components pointed at KiCad's official libraries and at JLC (嘉立创)'s `wch_kicad_library`, and `project.toml` pinned versions with `[libs.kicad]` + `[libs.wch_mcu]`.

That is fine in the world of "a human draws boards in a GUI", but it conflicts with this project's premise:

- **agent-first** ([ADR-0003](0003-agent-first-pcb-ir.md)): an agent has to be able to build symbols and footprints by itself from a datasheet ([ADR-0010](0010-footprint-and-3d-model-ownership.md) decision 2). If the reference project itself relies on borrowed libraries, there is no complete "library from zero to board" sample.
- **Reproducibility**: borrowed libraries have to be fetched over the network to get a version; their bytes are not in the repository, so the content hash cannot pin a single `.teda`.
- **The value of a "reference project" is precisely that it can be reproduced byte for byte**: it is at once the conformance input, the subject of `bun run smoke:*`, and the target of library-level checks.

The preconditions for self-built libraries are now in place: the `.teda` library format ([ADR-0011](0011-library-format-and-footprint-ir.md)), the symbol library format ([ADR-0012](0012-symbol-description.md)), the exporter, the KiCad smoke run. What is missing is **moving the libraries into the project**, and **a gate that keeps "every reference resolves"** — because pin numbers, pad numbers and symbol views are aligned across files and drift naturally.

## Decision

1. **The reference project no longer references any external library**. The `symbol` / `footprint` of all 22 components are written as `project:<name>`; `project.toml` keeps only one self-built library entry, with no `kicad` / `wch_mcu` anymore.
2. **One self-built library provides both symbols and footprints**, sharing a single `<lib>:` namespace. Therefore `[libs.<name>]` allows two root keys:

   ```toml
   [libs.project]
   source = "project"
   symbols = "symbols/project"
   footprints = "footprints/project"
   content_hash = "…"
   ```

   `path` stays as the old spelling for "there is only one root". The IR contract (`schemas/ir/v0.1/project.schema.json`) gains `lib.symbols` / `lib.footprints` in step.
3. **The content hash covers all roots**: `SHA-256(concatenation of "<project-relative path>:<file_sha256>\n" over all files, in byte order)`. The tool is `bun run lib:hash <dir>...` (`scripts/libhash.ts`); the docs give the equivalent shell form.
4. **Library-level checking is a closed-loop gate**: `bun run lib:verify` (`scripts/verify-libs.ts`) has to be fully green to pass:
   - the `symbol` / `footprint` of every component points at a file that exists inside the project (no external prefix, no pointing at a file that does not exist);
   - there are **no orphan library files** (every library file is referenced by at least one component);
   - the pin number set of a symbol is **exactly** the pin number set of the component referencing it; the pad number set of a footprint **covers** the component's pin numbers (extra pads raise a warning);
   - every library file is in canonical form, compiles to IR and passes the contract;
   - every symbol exported to `.kicad_sym` can be **parsed by KiCad** (`kicad-cli sym upgrade`), and every footprint exported to `.kicad_mod` can be **rendered by KiCad** (`kicad-cli fp export svg`);
   - all footprints are placed on one merged board with **0 DRC violations**.

   **The last two items were moved to a separate optional tier by [ADR-0018](0018-zero-dependency-and-manufacturing-target.md) decision 1** (see the addendum below): a gate may not depend on an external tool. The checks themselves are unchanged.
5. **The library geometry is a "generic land pattern", not the exact dimensions of each part number**. The goal of the reference project is to make the pipeline and the check loop hold, not to replace vendor libraries (`AGENTS.md` §1: "no generic library"). Every footprint's `description` states `generic land pattern`, so that whoever comes later does not mistake it for exact dimensions. **Making the geometry exact is a separate follow-up item**, see F1 in `docs/backlog.md`.

## Consequences

- **Benefit**: the reference project is now a **self-contained, reproducible sample that an agent can rebuild from zero**; every byte of the library is in the repository, so the content hash really does pin the version; library-level checks turn the drift between "pin numbers / pad numbers / views" from "watched by a human" into "reported by a tool".
- **Cost**: library files go from 2 to 31 (15 symbols + 16 footprints); the geometric accuracy is below vendor libraries (see decision 5); `lib:verify` depends on `kicad-cli`, so it is a gate that can only be all green when KiCad is installed.
- **A real bug fixed along the way**: the symbol exporter wrote `(stroke (width 0) (type none))` for "line width 0 (no outline)", while KiCad's stroke type enumeration has no `none` — **KiCad rejects the entire symbol library**. It has been changed to `(type default)`, with a regression test added (`packages/exporter/test/symbol.test.ts`).
- **Verified in practice** (`bun run lib:verify`): all 22 components / 15 symbols / 16 footprints parse, compile, export, and are read and rendered by KiCad; the merged board has `violations=0`.

## Addendum (2026-10-21): the gate was split into two tiers

Decision 4 was written when `bun run lib:verify` was one gate that required `kicad-cli`. **[ADR-0018](0018-zero-dependency-and-manufacturing-target.md) decision 1** then split it, and this ADR's decision 4 is superseded on that point:

|Command|Content|Needs KiCad|
|---|---|---|
|`bun run lib:verify`|Everything in decision 4 **except** the two KiCad items: references resolve inside the project, no orphan library files, symbol pin set == component pin set, footprint pad set ⊇ component pin set, canonical form, compiles to IR and passes the contract, export succeeds, and **our own renderer** draws the symbols and footprints and self-checks them|**No**|
|`bun run lib:verify:kicad`|Additionally: KiCad can read the exported `.kicad_sym` / `.kicad_mod`, and the merged board has 0 `pcb drc` violations|**Yes** (optional)|

The rule behind the split is [ADR-0018](0018-zero-dependency-and-manufacturing-target.md)'s: **a gate may not depend on an external tool** — KiCad's read-in and DRC are cross-validation, not the definition of our correctness. The checks listed in decision 4 are unchanged; only their tier changed. The merged-board `.kicad_pcb` is still generated, as an interoperability artifact rather than a gate.

## Addendum (2026-10-22): the reference project has no external library, and its own assets are assets

Amended by [ADR-0031](0031-project-tree-ownership-model.md) decisions 1, 2 and 6.

The wording of the title and of decision 1 changes with the tree. The reference project still
references no external library — that is unchanged and still the point — but the reason is now
sharper: a library is a separate repository, and the reference project borrows nothing because
it builds everything itself.

- The project's symbols and footprints are **assets**, under `assets/symbols/` and
  `assets/footprints/`, not a library called `project`. The `project:` prefix survives as a
  legacy spelling of the bare form.
- The `project.toml` `[libs.project]` entry disappears with the other `[libs]` entries
  ([ADR-0008](0008-ir-shard-identity-and-hash.md) decision 6): the project has no dependency to
  declare.
- The reference project has **no `external/` directory at all**, which makes it the worked
  example of the case ADR-0031 leaves open: a project that borrows nothing.
- **The library-level checks still apply, to a wider scope.** The three-way alignment of symbol
  pin numbers, footprint pad numbers and component pin numbers must hold for every asset the
  project owns *and* for every asset of a vendored library, and `lib:verify` checks both. A
  vendored library is verified against the `content_hash` its `libref` declares, so "the library
  was edited without moving the anchor" is an error, not a silent drift.

## Addendum (2026-10-27): 23 devices, not 22

Lines 9, 21 and 50 say "22 components". The reference project holds **23** device files today — 17
`kind: part` and 6 `kind: generic` — because [ADR-0037](0037-device-kind-vocabulary-and-one-device-directory.md)
split the tree afterwards. Symbols 15 and footprints 16 still match, and the decision is unaffected:
no external library is referenced, and `bun run lib:verify` is still the gate.
