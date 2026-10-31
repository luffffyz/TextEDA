# ADR-0008: The Project Tree Has Owners

Status: Accepted
Date: 2026-10-22
Scope: Decides: the ownership model of the project tree — own assets, referenced material, derivations — and what `texteda init` creates. Does not decide: the IR shard layout — see ADR-0006.
Related: [ADR-0006](../02-ir/0006-ir-shards-and-hashes.md), [ADR-0009](0009-board-linking.md), [ADR-0013](../04-schematic/0013-modules-compose-boards.md), [ADR-0029](../07-devices/0029-the-procurement-layer.md), [ADR-0034](../08-libraries/0034-trust-in-a-library-you-do-not-own.md), [ADR-0049](../08-libraries/0049-assets-are-filed-by-what-they-are.md).
Impact: `spec/project.md` §1, §2; `packages/cli/src/init.ts`; `AGENTS.md` §9

## Background

Two questions were left open by [ADR-0024](../07-devices/0024-the-device-kind-is-part-or-generic.md),
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
and that reads badly. A dozen top-level entries — `assets/symbols/`, `assets/footprints/`,
`families/`, `assets/components/`, `design/sch/`, `design/pcb/`, `design/modules/`,
`design/system/`, `procurement/`, `docs/`, `dist/` — is a list of kinds, not a picture of a
project.

## Decision

### 1. The tree is organised by ownership, not by asset kind

```text
my-board-project/
├── project.toml
│
├── assets/                 # what this project owns: device assets + procurement decisions
│   ├── symbols/  footprints/  components/
│   └── procurement/
│       ├── primary/<board_id>.teda        # normative
│       └── alternatives/<board_id>.teda   # advisory

The procurement files are named after the **board** they belong to: a selection is scoped to a
board, because a BOM is a board's ([ADR-0029](../07-devices/0029-the-procurement-layer.md) decision 1).
│
├── external/               # what this project references but does not own
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

**There is one directory for devices, not two.** The `families/` directory is gone, because the
kind of a device is a fact of the device file and not a fact of the path
([ADR-0024](../07-devices/0024-the-device-kind-is-part-or-generic.md) decision 6). `assets/components/`
holds the parts and the generics alike, and a device shard is a `components/<component_id>.json`
for a part and for a generic alike. The shard layout is an interface for tools and is not tied to
the source tree; `source.file` remains the authoritative mapping.

**A module is not an asset, although it is reusable.** `assets/` holds the device-level things a
board instantiates — symbols, footprints, devices — and the procurement decisions.
A module is a *fragment of the circuit*: it has instances, nets and ports, so it belongs to
`design/` beside the board it serves. Reuse does not decide the place. A project-wide module
used by four boards is still this project's own circuit; the same module vendored from elsewhere
goes under `external/`, like any other borrowed material.

The `views/` root is a special case and is decided by
[ADR-0035](../09-view/0035-the-view-layer-is-a-drawing.md): the print pages are hand-written and
tracked, but they are not part of the build identity, so they do not belong inside `design/`
— the directory that means "the circuit".

### 2. `assets/` holds the project's own device assets and its own procurement decisions

The asset kinds — `assets/symbols/`, `assets/footprints/`, `assets/components/` — are the project's
own descriptions of devices it uses. The procurement decisions move here as well
([ADR-0029](../07-devices/0029-the-procurement-layer.md)): a selection only ever talks about devices, and it is
project-scoped, so it belongs with the devices rather than beside the boards.

`assets/` therefore holds two natures: descriptions, which are facts, and selections, which are
decisions. Nothing depends on the distinction — normative versus advisory is a property of a
shard, not of a directory — and the two procurement subdirectories keep their standing visible.

### 3. `external/` has two kinds of material, with two different mechanisms

| Kind | Mechanism | In the IR | Why |
|---|---|---|---|
| `simulation/` | vendored when the licence allows | yes, when vendored | a simulation model is an input a reader may need to reproduce a result |
| `cache/` | local only, gitignored | no | a datasheet may not be redistributed; the fact that points at it is already in the IR |

The split by kind is a split by **mechanism**, not by subject. Two simulation models are handled
the same way; a model and a datasheet are not.

### 4. A declaration lives in the fact that references it

A single document or a single model is declared where it is referenced:

- a datasheet is declared by the `datasheet` field of the device it belongs to
  ([ADR-0033](../08-libraries/0033-libraries-are-unverified-facts.md) decision 1);
- a simulation model is declared by the analysis record that uses it (`AGENTS.md` §4.1).

This is the rule that keeps the tree from growing a machinery per external thing. It also
means there is exactly one place where the datasheet of a part is written down.

### 5. The library anchor is withdrawn: an external library is a template

The anchor — a `libref` description type pinned to a revision and a content hash — is **not**
part of the tree. It was written for an ecosystem of libraries that other people publish and that
many projects consume at different revisions, and this project has no such ecosystem.

An external library is a **template**: `texteda lib import <name> --from <dir> --rev <tag>`
copies the assets it needs into `assets/` under bare ids, and the copies are the project's own
content from that moment on (see [ADR-0034](../08-libraries/0034-trust-in-a-library-you-do-not-own.md)).

Three consequences:

- There is no `libref` description type, no `librefs/**` shard, and no dependency whose change
  moves the build.
- A tree under `external/libs/` holding asset groups is an **error**: resolution never looks
  there.
- `project.toml` carries no library declarations at all. A project whose devices are all its own
  has nothing to pin.

### 6. `external/` holds material that is not an asset

What remains of `external/` is the material that cannot be an asset:

- `external/cache/` — the datasheets and other documents, referenced but never in the
  repository;
- `external/simulation/` — a reserved place for simulation models, whose declaration format is
  not decided.

An imported library's assets are **not** here: they were copied into `assets/` and are the
project's own.

### 7. Namespaces: every asset is bare

- An asset this project owns is referenced by its bare id: `cap-tantalum-7343`, `tps5430ddar`.
- The legacy `project:` qualifier continues to mean the project's own assets, and is accepted as
  an explicit synonym for the bare form. It was never a library reference.
- A **qualified** `<lib>:<id>` reference is an **error**, not a resolution: there is no library to
  qualify against.

### 8. `design/` groups the circuit descriptions

`design/sch/`, `design/pcb/`, `design/modules/` and `design/system/` move under `design/`. They are all descriptions of
this project's circuit, and grouping them keeps the root short.

The print pages keep their own root and their per-board grouping:
`views/<board_id>/<page_id>.view.teda` ([ADR-0035](../09-view/0035-the-view-layer-is-a-drawing.md),
[ADR-0012](../04-schematic/0012-one-flat-schematic-per-board.md), [ADR-0035](../09-view/0035-the-view-layer-is-a-drawing.md)).

### 9. The IR shard layout is decoupled from the source tree

Amends [ADR-0006](../02-ir/0006-ir-shards-and-hashes.md) decision 2. Shards are laid out **by kind**, and the
mapping back to the source file is carried by the `source.file` field that every shard already
has ([ADR-0006](../02-ir/0006-ir-shards-and-hashes.md) decision 1):

```text
dist/ir/
├── manifest.json
├── boards/<board_id>/schematic.json
├── boards/<board_id>/pcb.json
├── boards/<board_id>/view/<page_id>.json
├── symbols/<lib>/<symbol_id>.json
├── footprints/<lib>/<footprint_id>.json
├── components/<component_id>.json
├── boards/<board_id>/procurement.json
└── boards/<board_id>/procurement-alternatives.json
```

The source tree is reorganised for readers; the shard layout is an interface for tools, and
tools should not have to be rewritten when a directory is renamed. `source.file` is the
authoritative mapping, so nothing is lost by not mirroring.

### 10. `texteda init` creates the skeleton

`texteda init <dir>` creates `project.toml` and the directories: `assets/{symbols,footprints,
components}`, `assets/procurement/{primary,alternatives}`, `external/simulation`,
`design/{sch,pcb,modules,system}`, `views/`, `docs/`. `external/cache/` is not created — it is a
local cache and gitignored.

### 11. The tree shape is now frozen

The directory layout is a public interface: it appears in CLI arguments, in the skills, in the
examples and in the decision records. It is not reorganised again as a side effect of another
decision. A change needs its own record.

**No migration script is written.** The project has no external users yet, so no file exists that
would need migrating. A tree or language change therefore changes the files directly, and the
record says what changed and how (in `spec/teda.md` §13.4). The scripts written before this point
(`bun run migrate:0.7`) stay as they are; no new ones are written.

The rule about not renaming on the author's behalf still stands — and it is now the whole rule: a
tool never invents a name, an id or a fact.

## Consequences

- **The tree says what the project is.** Seven roots, and the reader can tell ownership from
  borrowing at a glance — which was the confusion that started this record: a directory called
  `project/` holding the library, while the private assets sat in `assets/components/`.
- **The IR is self-sufficient.** Every asset the build uses is in the tree, and therefore in
  `dist/ir/`. A consumer needs nothing else.
- **A datasheet is declared once.** The `datasheet` field on the device is the only place it
  is written; the PDF may live in `external/cache/`, and it is never in the repository.
- **The shard paths stop moving.** Reorganising the source tree no longer reorganises
  `dist/ir/`. The project hash of a project that only moved a directory still changes today,
  because a shard carries its `source.file` and the per-shard `sha256` is taken over the bytes on
  disk ([ADR-0006](../02-ir/0006-ir-shards-and-hashes.md) decision 4); making the hash follow the design rather
  than the file layout needs a per-shard content hash (backlog F29).
- **The price**: the paths change once. `sch/<board>.teda` becomes `design/sch/<board>.teda`,
  the symbols and footprints move under `assets/`, and the CLI, the skills, the examples and
  the decision records that mention them have to be updated.
- **The price**: `assets/` holds facts and decisions side by side. A reader looking for "what
  does this board use" reads `assets/components/` and `assets/procurement/primary/`; a reader
  looking for "what was bought" reads the latter.

## Alternatives Rejected

- **Keep the tree flat, one directory per asset kind.** It reads as a list of kinds rather than
  a picture of a project, and it cannot express ownership at all: with `assets/symbols/` at the top
  level, nothing says whether those symbols are this project's or borrowed.
- **One `external/` root with a single mechanism for everything.** A datasheet cannot be
  vendored (copyright) and a cache must not be in the IR. One mechanism would force the weakest
  rule on all of them.
- **Keep library declarations in `project.toml`.** A dependency is not project metadata.
  [ADR-0006](../02-ir/0006-ir-shards-and-hashes.md) decision 6 says the same.
- **Give the project its own published library directory.** Nobody does this: a library is a
  separate repository, and a consumer copies it. A project that wants to publish its assets
  publishes them as a library repository; it does not keep two copies.
- **Put the third-party documents in `docs/`.** That mixes material this project produced with
  material it fetched, and the fetched kind is the one that must never be committed.
- **Put the print pages under `design/`.** They are not part of the circuit, and a directory
  that means "the circuit" should hold nothing else. Decided in
  [ADR-0035](../09-view/0035-the-view-layer-is-a-drawing.md).
