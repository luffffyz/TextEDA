# ADR-0031: The Project Tree Has Owners — Own Assets, Referenced Material, and Derivations

Status: Accepted
Date: 2026-10-22
Related: [ADR-0027](0027-device-parts-families-and-library-dependencies.md), [ADR-0023](0023-ir-layer-on-disk.md), [ADR-0008](0008-ir-shard-identity-and-hash.md), [ADR-0010](0010-footprint-and-3d-model-ownership.md), [ADR-0013](0013-reference-project-self-built-libraries.md), [ADR-0015](0015-licensing-and-open-standard.md), [ADR-0021](0021-schematic-view-layer.md), [ADR-0028](0028-library-trust-and-derived-overrides.md), [ADR-0029](0029-package-code-footprint-and-3d-model-ownership.md), [ADR-0030](0030-procurement-layer.md)
Impact: `AGENTS.md` §4.5, §9, §10; `teda.md` §5 (the file layout); `spec/libref.md` (new); `schemas/ir/v0.3/libref.schema.json` (new); `packages/parser` (a `libref` parser); `packages/cli` (`init`, `ir`, the project layout helpers); `scripts/lib/project.ts`; `docs/skills/new-project.md`; `examples/reference-project/`; `docs/backlog.md`

## Background

Two questions were left open by [ADR-0027](0027-device-parts-families-and-library-dependencies.md),
and they turned out to be the same question asked twice.

The first was where a library reference lives. The answer that was being built — a directory per
library, in the tree, beside the project's own assets — ran into the fact that the projects in
this ecosystem do not publish libraries of their own. A library is a separate repository: the
official base library, a vendor's collection, a community package. Nobody downloads a whole
board project as a dependency, so "the library this project publishes" is not a category that
occurs.

The second was what "external" means at all. It is not a kind of asset. It is a kind of
**relationship**: something this project references but does not own. And the things that
relationship covers behave very differently from one another:

- a **device library** is bulk, structured, and needed to build — it has to be available offline,
  and the IR has to be sufficient on its own;
- a **datasheet** is a single document, may not be redistributed at all, and is needed by a
  reader, not by a build;
- a **simulation model** is a file from a third party, redistributable or not;
- a **simulation result** is not external material at all — it is evidence this project
  produced.

A tree that puts all four under one root, with one mechanism, would be wrong for three of them.

Underneath both questions there was a third: the tree was flat, one directory per asset kind,
and that reads badly. Twelve top-level entries — `assets/symbols/`, `assets/footprints/`, `families/`,
`assets/components/`, `design/sch/`, `design/pcb/`, `design/modules/`, `design/system/`, `procurement/`, `docs/`, `dist/` — is a
list of kinds, not a picture of a project.

## Decision

### 1. The tree is organised by ownership, not by asset kind

```text
my-board-project/
├── project.toml
│
├── assets/                 # what this project owns: device assets + procurement decisions
│   ├── symbols/  footprints/  families/  components/
│   └── procurement/
│       ├── primary/<board_id>.teda        # normative
│       └── alternatives/<board_id>.teda   # advisory

The procurement files are named after the **board** they belong to: a selection is scoped to a
board, because a BOM is a board's ([ADR-0030](0030-procurement-layer.md) decision 1).
│
├── external/               # what this project references but does not own
│   ├── libs/
│   │   ├── stm32l4.toml    # the reference: source / rev / content_hash / channel
│   │   └── stm32l4/        # the vendored library
│   │       └── symbols/ footprints/ families/ components/
│   ├── simulation/         # simulation models, vendored when the licence allows
│   └── cache/              # local cache of documents (datasheets); gitignored, not in the IR
│
├── design/                 # the circuit — the truth
│   ├── sch/                # sch/<board_id>.teda
│   ├── pcb/
│   ├── modules/
│   └── system/
│
├── views/                  # the drawings: hand-written, discardable, outside the build
│   └── <board_id>/<page_id>.view.teda
│
├── docs/                   # design intent, review records, analysis evidence
└── dist/                   # derived artifacts
```

Seven roots. A reader sees what the project owns, what it borrows, what it describes, what it
draws, and what it produced.

**A module is not an asset, although it is reusable.** `assets/` holds the device-level things a
board instantiates — symbols, footprints, families, components — and the procurement decisions.
A module is a *fragment of the circuit*: it has instances, nets and ports, so it belongs to
`design/` beside the board it serves. Reuse does not decide the place. A project-wide module
used by four boards is still this project's own circuit; the same module vendored from elsewhere
goes under `external/`, like any other borrowed material.

The `views/` root is a special case and is decided by
[ADR-0032](0032-view-is-a-drawing-not-a-build-input.md): the print pages are hand-written and
tracked, but they are not part of the build identity, so they do not belong inside `design/`
— the directory that means "the circuit".

### 2. `assets/` holds the project's own device assets and its own procurement decisions

The four asset kinds — `assets/symbols/`, `assets/footprints/`, `families/`, `assets/components/` — are the project's
own descriptions of devices it uses. The procurement decisions move here as well
([ADR-0030](0030-procurement-layer.md)): a selection only ever talks about devices, and it is
project-scoped, so it belongs with the devices rather than beside the boards.

`assets/` therefore holds two natures: descriptions, which are facts, and selections, which are
decisions. Nothing depends on the distinction — normative versus advisory is a property of a
shard, not of a directory — and the two procurement subdirectories keep their standing visible.

### 3. `external/` has three kinds of material, with three different mechanisms

| Kind | Mechanism | In the IR | Why |
|---|---|---|---|
| `libs/` | **vendored** into the tree, pinned by a reference | yes, normative shards | the IR must be sufficient on its own, and a build must not reach the network |
| `simulation/` | vendored when the licence allows | yes, when vendored | a simulation model is an input a reader may need to reproduce a result |
| `cache/` | local only, gitignored | no | a datasheet may not be redistributed; the fact that points at it is already in the IR |

The split by kind is a split by **mechanism**, not by subject. Two libraries and two simulation
models are handled the same way; a library and a datasheet are not.

### 4. A declaration lives in the fact that references it

Only a **bulk, structured dependency** gets its own declaration file. A single document or a
single model is declared where it is referenced:

- a datasheet is declared by the `datasheet` field of the component it belongs to
  ([ADR-0028](0028-library-trust-and-derived-overrides.md) decision 1);
- a simulation model is declared by the analysis record that uses it (`AGENTS.md` §4.1);
- a library is declared by a `libref` file, because a library is referenced by the project as a
  whole rather than by any one fact.

This is the rule that keeps the tree from growing a machinery per external thing. It also
means there is exactly one place where the datasheet of a part is written down.

### 5. `libref` is a description type

`external/libs/<name>.toml` is a description, not a configuration file: the project depends on
it, and changing the dependency changes the build.

```toml
name         = "stm32l4"
source       = "https://example.org/libs/stm32l4"
rev          = "v1.3.0"
content_hash = "sha256:…"
channel      = "official"      # official | third-party
```

- It compiles to a **normative** shard, `dist/ir/librefs/<name>.json`. Changing the pinned
  revision changes the build, so it belongs in the project hash.
- The declared `content_hash` must equal the hash computed over the vendored subtree. A
  mismatch is an error: the vendored copy was modified without the anchor being moved.
- `channel` selects the trust policy ([ADR-0028](0028-library-trust-and-derived-overrides.md)):
  an official library and a third-party one are handled differently, and the difference is a
  field, not a directory.

`project.toml` no longer carries library declarations ([ADR-0008](0008-ir-shard-identity-and-hash.md)
decision 6 is amended accordingly): a dependency belongs with the dependency.

### 6. Libraries are vendored, not merely referenced

A library is either present in `external/libs/<name>/`, or it is not usable. There is no
cache-only mode, and the reason is the IR:

> The IR layer must be sufficient on its own. A consumer that reads `dist/ir/` must not have to
> find an asset anywhere else.

A library's assets therefore become normative shards of the project, and a library's revision
becomes part of the project hash — which is correct, because the symbols, footprints and parts
the build uses did change.

The vendoring step is explicit (`texteda lib add <name>@<rev>` writes the reference, fetches
the content, and computes the hash). It is the only step that reaches the network, and it never
happens during a build.

### 7. Namespaces: own assets are bare, library assets are qualified

- An asset this project owns is referenced by its bare id: `cap-tantalum-7343`, `tps5430ddar`.
- An asset from a vendored library is qualified by the library name: `stm32l4:stm32f407vgt6`.
  A library-provided id **must** be qualified, so that a project with several libraries never
  has to resolve an ambiguity.
- The legacy `project:` qualifier continues to mean the project's own assets, and is accepted as
  an explicit synonym for the bare form.
- Resolution order for a bare id: the project's own assets first, then the vendored libraries
  in the order they are declared. A bare id that resolves to more than one library is an error.

### 8. `design/` groups the circuit descriptions

`design/sch/`, `design/pcb/`, `design/modules/` and `design/system/` move under `design/`. They are all descriptions of
this project's circuit, and grouping them keeps the root short.

The print pages keep their own root and their per-board grouping:
`views/<board_id>/<page_id>.view.teda` ([ADR-0021](0021-schematic-view-layer.md),
[ADR-0025](0025-flat-board-and-print-pages.md), [ADR-0032](0032-view-is-a-drawing-not-a-build-input.md)).

### 9. The IR shard layout is decoupled from the source tree

Amends [ADR-0023](0023-ir-layer-on-disk.md) decision 2. Shards are laid out **by kind**, and the
mapping back to the source file is carried by the `source.file` field that every shard already
has ([ADR-0008](0008-ir-shard-identity-and-hash.md) decision 1):

```text
dist/ir/
├── manifest.json
├── boards/<board_id>/schematic.json
├── boards/<board_id>/pcb.json
├── boards/<board_id>/view/<page_id>.json
├── symbols/<lib>/<symbol_id>.json
├── footprints/<lib>/<footprint_id>.json
├── families/<family_id>.json
├── components/<component_id>.json
├── boards/<board_id>/procurement.json
├── boards/<board_id>/procurement-alternatives.json
└── librefs/<name>.json
```

The source tree is reorganised for readers; the shard layout is an interface for tools, and
tools should not have to be rewritten when a directory is renamed. `source.file` is the
authoritative mapping, so nothing is lost by not mirroring.

### 10. `texteda init` creates the skeleton

`texteda init <dir>` creates `project.toml` and the directories: `assets/{symbols,footprints,
families,components}`, `assets/procurement/{primary,alternatives}`, `external/{libs,simulation}`,
`design/{sch,pcb,modules,system}`, `views/`, `docs/`. `external/cache/` is not created — it is a
local cache and gitignored.

### 11. The tree shape is now frozen

The directory layout is a public interface: it appears in CLI arguments, in the skills, in the
examples and in the decision records. It is not reorganised again as a side effect of another
decision. A change needs its own record, and a migration script, like
`bun run migrate:0.7` and `bun run migrate:0.9` before it.

## Consequences

- **The tree says what the project is.** Seven roots, and the reader can tell ownership from
  borrowing at a glance — which was the confusion that started this record: a directory called
  `project/` holding the library, while the private assets sat in `assets/components/`.
- **The IR is self-sufficient.** Every asset the build uses is in the tree, vendored or owned,
  and therefore in `dist/ir/`. A consumer needs nothing else.
- **A datasheet is declared once.** The `datasheet` field on the component is the only place it
  is written; the PDF may live in `external/cache/`, and it is never in the repository.
- **The shard paths stop moving.** Reorganising the source tree no longer reorganises
  `dist/ir/`. The project hash of a project that only moved a directory still changes today,
  because a shard carries its `source.file` and the per-shard `sha256` is taken over the bytes on
  disk ([ADR-0023](0023-ir-layer-on-disk.md) decision 4); making the hash follow the design rather
  than the file layout needs a per-shard content hash, which lands with the contract v0.3 batch
  (backlog F29).
- **The price**: the paths change once. `sch/<board>.teda` becomes `design/sch/<board>.teda`,
  the symbols and footprints move under `assets/`, and the CLI, the skills, the examples and
  the decision records that mention them have to be updated. This is a one-time migration, and
  it needs a script.
- **The price**: `assets/` holds facts and decisions side by side. A reader looking for "what
  does this board use" reads `assets/components/` and `assets/procurement/primary/`; a reader
  looking for "what was bought" reads the latter.

## Alternatives Rejected

- **Keep the tree flat, one directory per asset kind.** It reads as a list of kinds rather than
  a picture of a project, and it cannot express ownership at all: with `assets/symbols/` at the top
  level, nothing says whether those symbols are this project's or borrowed.
- **One `external/` root with a single mechanism for everything.** A datasheet cannot be
  vendored (copyright), a library must be, and a cache must not be in the IR. One mechanism
  would force the weakest rule on all of them.
- **Keep library declarations in `project.toml`.** A dependency is not project metadata, and the
  tree would still not show what the project depends on. Amended
  [ADR-0008](0008-ir-shard-identity-and-hash.md) decision 6.
- **Cache-only libraries, referenced by URL and hash, never vendored.** The IR would not be
  sufficient on its own, and every consumer of `dist/ir/` would need the cache. Rejected in
  decision 6.
- **Give the project its own published library directory.** Nobody does this: a library is a
  separate repository, and consumers vendor it. A project that wants to publish its assets
  publishes them as a library repository; it does not keep two copies.
- **Separate directories for official and third-party libraries.** They are handled the same
  way; only the trust policy differs, and that is a field (`channel`) rather than a place.
- **Put the third-party documents in `docs/`.** That mixes material this project produced with
  material it fetched, and the fetched kind is the one that must never be committed.
- **Put the print pages under `design/`.** They are not part of the circuit, and a directory
  that means "the circuit" should hold nothing else. Decided in
  [ADR-0032](0032-view-is-a-drawing-not-a-build-input.md).

## Addendum (2026-10-23): no migration scripts while the project has no users

Amends decision 11.

The tree shape is still frozen, and a change still needs its own record. The **migration script**
is not part of that: the project has no external users yet, so no file exists that would need
migrating. A tree or language change therefore changes the files directly, and the record says what
changed and how (in `spec/teda.md` §13.4). The scripts written before this point (`bun run
migrate:0.7`) stay as they are; no new ones are written.

The rule about not renaming on the author's behalf still stands — and it is now the whole rule: a
tool never invents a name, an id or a fact.

## Open Points

- **The print pages.** Where the `view` files live in the new tree, and whether the view stays a
  separate description type and a separate shard, were not settled by this record; they are
  settled by [ADR-0032](0032-view-is-a-drawing-not-a-build-input.md): the pages get their own
  root, `views/<board_id>/<page_id>.view.teda`, and a view shard is advisory — a drawing is
  authored content, but nothing that is built depends on where a label sits.
- **The simulation mechanism.** `external/simulation/` reserves a place; the declaration format,
  the licence handling and whether simulation models are vendored or referenced are not decided
  here. The evidence side (what a result must carry to be trusted) is
  `AGENTS.md` §11 question 12 and is untouched by this record.
- **The library registry and distribution format** is not decided here
  (`docs/backlog.md` F10).
- **How a vendored library is updated** — whether a newer revision of the same library may be
  vendored beside the old one — is not decided here. The draft answer is that it may not: a
  library name has one pin.
