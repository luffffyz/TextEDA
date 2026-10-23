# ADR-0023: The IR Layer on Disk (Shard Tree, Manifest, Hashes)

Status: Accepted
Date: 2026-10-21
Impact: `packages/cli/src/ir-tree.ts`, `packages/cli/src/ir.ts`, `packages/cli/scripts/texteda.ts`, `package.json`, `AGENTS.md` §2 rule 18, §9, §10, §11; `docs/backlog.md` F24; [ADR-0008](0008-ir-shard-identity-and-hash.md) (status: Accepted)

**Amendment (2026-10-22)**: [ADR-0030](0030-procurement-layer.md) introduces content that belongs in
the IR but must not move the build identity — the procurement alternatives, which are advisory.
This record is amended accordingly: shards are classified as **normative** or **advisory**
(decision 4), the project hash aggregates the normative shards only, and a second hash,
`advisory_hash`, aggregates the advisory ones. The manifest records the classification per
shard. The rest of this record stands.

## Background

[ADR-0008](0008-ir-shard-identity-and-hash.md) settled the shard rules — one source file becomes one shard, a manifest registers the shards and their hashes, the project hash is an aggregation over the shard hashes — but nothing wrote them:

- `texteda compile` writes **one** board's schematic shard to a file or to stdout. There is no directory a downstream tool can read, no manifest, and no project-level hash.
- The repository scripts (`compile:symbol`, `compile:footprint`) write a single JSON file each, again without a manifest.
- Derivative artifacts must state which source they came from (`AGENTS.md` §2 rule 11: `source_hash + tool_version`). That needs a hash over a **defined set** of shards, and a defined set needs a defined layout.

The project also has more than one description kind with a producer today — `schematic`, `pcb`, `schematic-view` ([ADR-0021](0021-schematic-view-layer.md)), plus the two library kinds `symbol` and `footprint` — so the IR layer is a directory with a per-kind convention, not a single file.

## Decision

### 1. The IR layer is a directory: `dist/ir/`

The compiled project lives in one directory, written as canonical JSON (one file per shard). The directory is the unit that downstream tools consume: they read the tree, not the build log.

### 2. Layout: the tree is laid out by kind, and `source.file` maps it back

Amended by [ADR-0031](0031-project-tree-ownership-model.md) decision 9. The shard layout used to
mirror the project's own directories. It no longer does: the source tree is reorganised for
readers, the shard layout is an interface for tools, and the mapping between them is carried by
the `source.file` field every shard already has ([ADR-0008](0008-ir-shard-identity-and-hash.md)
decision 1).

```
dist/ir/
├── manifest.json                     # shard paths + sha256 per shard + the project hash
├── boards/<board_id>/schematic.json  # the flattened logic of one board
├── boards/<board_id>/pcb.json        # the physical description of one board
├── boards/<board_id>/view/<page_id>.json  # the drawing of one page
├── symbols/<lib>/<symbol_id>.json
├── footprints/<lib>/<footprint_id>.json
├── families/<family_id>.json
├── components/<component_id>.json
├── boards/<board_id>/procurement.json              # the primary selections of one board
├── boards/<board_id>/procurement-alternatives.json  # the second sources of one board
└── librefs/<name>.json
```

- `boards/<board_id>/view/<page_id>.json` extends [ADR-0008](0008-ir-shard-identity-and-hash.md) decision 1: a page's drawing is its own description ([ADR-0021](0021-schematic-view-layer.md)), so it is its own shard. It is **not** merged into the schematic shard — the schematic shard is the flattened logic, the view shard is a picture of one page, and the two have different readers. It is **advisory** ([ADR-0032](0032-view-is-a-drawing-not-a-build-input.md) decision 3).
- The library kinds keep one shard per library file; the library name is the directory the file lives in. A library vendored under `external/libs/<name>/` and the project's own assets under `assets/` are distinguished by the library name in the shard path and by `source.file`, not by the shard path alone.
- `components/<component_id>.json`, `project.json` and `systems/<system_id>.json` ([ADR-0008](0008-ir-shard-identity-and-hash.md) decision 1) had no producer when this record was written; **all three have one now** (2026-10-23, `docs/backlog.md` F24): the device shard was the last to land, and it needed the IR to rise to `0.8` so that a device's `description` could be carried instead of dropped ([ADR-0042](0042-a-device-description-enters-the-ir.md)). A kind without a producer must not appear as an empty directory — an empty directory is not a shard.
- The procurement shards follow the same rule and are likewise not written yet: `boards/<board_id>/procurement.json` (normative — the primary selections) and `boards/<board_id>/procurement-alternatives.json` (advisory — the second sources), matching the source directories `assets/procurement/primary/<board_id>.teda` and `assets/procurement/alternatives/<board_id>.teda` ([ADR-0030](0030-procurement-layer.md) decisions 1 and 10). A selection is scoped to a board, so its shard is a **board** shard: the primary takes part in the board hash, and changing the part a board is built from invalidates that board's review.
- `librefs/<name>.json` is the reference to a vendored library ([ADR-0031](0031-project-tree-ownership-model.md) decision 5). It is **normative**: the pinned revision is part of the build.
- **The shard set is the project's content, not a reachability closure.** Every description file with a producer gets a shard, whether or not the build uses it: a device file no board and no procurement file references is still a shard, exactly as a symbol no component references would be. Because such a file is content, it must not be silent: `library.device-unused` (a warning) names every device nothing places and nothing selects, which is how a library stays curated once more than one author writes into it. The project hash therefore answers "which project is this", including its own library — not "which parts did this build use". A tree restricted to what is reachable is a different artifact (a build tree) and must not be mixed into this one, because then the same source file would be present or absent depending on a check that can fail, and a shard that disappears changes a hash for a reason that is not an edit.
- Because the layout is by kind, moving a source file between directories does not move a shard and does not change the project hash.

### 3. `texteda ir <project> [--out <dir>] [--json]` is the only writer

- The output directory defaults to `<project>/dist/ir`; `--out` points it elsewhere.
- It is a **project** command, not a board command: it compiles every description that has a producer, because the manifest and the project hash are project-level.
- **Nothing is written when the project has errors.** A half-written tree would carry a project hash that does not describe the project, and a hash that lies is worse than no hash. Warnings do not stop the write.
- Files under the output directory that the tree does not own are **pruned**: a deleted source file must not leave a stale shard behind, because a stale shard changes a hash.
- `--json` prints one machine payload on stdout (diagnostics, manifest, project hash, advisory hash, board hashes, shard list); otherwise a human summary goes to stdout. Diagnostics always go to stderr.

### 4. The hashes follow [ADR-0008](0008-ir-shard-identity-and-hash.md) decision 5, byte for byte

- A shard's `sha256` is taken over the canonical JSON bytes **that are written to disk** — the file's content is the hashed content, there is no second serialization step.
- The manifest is itself checked against `schemas/ir/v0.2/manifest.schema.json` before anything is written.

**Amended (2026-10-22): shards are normative or advisory.**

- Every shard is classified. A shard is **normative** when it carries content that the build depends on — the design, the geometry, the primary selections. A shard is **advisory** when it carries content that no built artifact depends on — the procurement alternatives and **the print pages** ([ADR-0032](0032-view-is-a-drawing-not-a-build-input.md) decision 3: a drawing is authored content, but nothing that is built depends on where a label sits).
- The classification is a property of the shard, and therefore of the source file it comes from: one source file produces one shard ([ADR-0008](0008-ir-shard-identity-and-hash.md) decision 1), and a shard has exactly one classification. The manifest records it per shard, as `normative: true | false`, so a tool never has to infer it from a path.
- The **project hash** is `sha256` over the `<path>:<sha256>\n` lines of the **normative** shards, sorted by path.
- The **advisory hash** is the same aggregation over the **advisory** shards. It is a second hash, with the same algorithm and the same shape, and it exists because a project has states that change without changing the build.
- A board hash is the same aggregation over that board's **normative** shards; the board's print pages are advisory ([ADR-0032](0032-view-is-a-drawing-not-a-build-input.md) decision 3), so the board hash is unaffected by this amendment and by a reviewer moving a label. A rendered page carries the page shard's own `sha256` as its `source_hash`.
- Both hashes are recomputable from the manifest alone. The board hashes are printed but not stored, as [ADR-0008](0008-ir-shard-identity-and-hash.md) decision 5 requires.

The claim the two hashes make is narrower than "this is the project", and the distinction is the point:

> **A hash identifies a build, not the project's file set.** Two projects that differ only in advisory content are the same build and have the same project hash; their advisory hashes differ, and the difference is exactly what changed.

This is what lets a procurement decision — adding a second source for a part — be recorded, checked and traced **without** invalidating an electrical review, a manufacturing package, or any artifact carrying the project hash ([ADR-0030](0030-procurement-layer.md) decision 12).

### 5. Three version numbers stay separate

`ir_version` (the shape of the IR contract), the language `format` (the syntax version of the source file) and `tool_version` (the version of the tool that produced the bytes) answer three different questions and are never derived from one another. `tool_version` is the repository's `package.json` version; it is not a timestamp.

### 6. [ADR-0008](0008-ir-shard-identity-and-hash.md) is Accepted

Its decisions are settled and now have an implementation: the flattening of decision 2 is what `parseSchematic` produces, the unit table of decision 4 is what the parser converts to, the hash rules of decision 5 are what the tree writes. The parts that are not implemented are producers, not decisions (the missing shards of decision 1, tracked in `docs/backlog.md` F24). Accepting it also settles the open question about identity keys: renaming changes the identity, and "rename without changing identity" would need an explicit `id` column in the language.

## Consequences

- **The IR layer is now a thing on disk that tools can read.** Exporters, the netlist writer and later the Gerber writer can take a directory instead of re-deriving everything from the sources.
- **A project has one hash.** Anything derived from the project can carry that hash plus the board hash it belongs to, as `AGENTS.md` §2 rule 11 requires.
- **A project has two hashes, after the 2026-10-22 amendment.** The project hash covers the normative shards and identifies the build; the advisory hash covers the advisory shards and identifies the state of the content the build does not depend on. Artifacts carry the hash that matches what they were derived from, so a purchasing decision moves the purchasing chain and leaves the build chain alone.
- **The writer is a project command, so a single board is still compiled by `texteda compile`.** Two entry points exist on purpose: `compile` is a board-level debugging aid with per-diagnostics output, `ir` is the project-level producer of the tree.
- **Rebuilding is not incremental yet.** The command recompiles every description; the shard layout is what makes incremental rebuilds possible, but the incremental logic is not written.
- **Accepting [ADR-0008](0008-ir-shard-identity-and-hash.md) closes the identity question** in `AGENTS.md` §11: renaming an instance or a net is a delete plus an add, and every hash changes with it.

## Follow-up

- The remaining shard kinds: `project.json`, `assets/components/<component_id>.json`, `systems/<system_id>.json` — they need producers (`project.toml` parsing, the component IR, the `system` description), not a layout decision (`docs/backlog.md` F24).
- Incremental rebuild: change one source file, rewrite one shard, keep the rest of the tree byte-identical.
- Whether the manifest should also record the language `format` and the schema `$id` per shard, so that a tool can self-check a tree that mixes versions (the last follow-up of [ADR-0008](0008-ir-shard-identity-and-hash.md)).
- Whether downstream commands should read `dist/ir` instead of compiling in memory (`texteda netlist` currently compiles in memory).
- The `new-project` skill (`docs/skills/new-project.md`) should grow a step that materializes the IR tree, once its verification script exists (`docs/backlog.md` F23).
