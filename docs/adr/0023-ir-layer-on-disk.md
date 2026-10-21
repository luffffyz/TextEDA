# ADR-0023: The IR Layer on Disk (Shard Tree, Manifest, Hashes)

Status: Accepted
Date: 2026-10-21
Impact: `packages/cli/src/ir-tree.ts`, `packages/cli/src/ir.ts`, `packages/cli/scripts/texteda.ts`, `package.json`, `AGENTS.md` §2 rule 18, §9, §10, §11; `docs/backlog.md` F24; [ADR-0008](0008-ir-shard-identity-and-hash.md) (status: Accepted)

## Background

[ADR-0008](0008-ir-shard-identity-and-hash.md) settled the shard rules — one source file becomes one shard, a manifest registers the shards and their hashes, the project hash is an aggregation over the shard hashes — but nothing wrote them:

- `texteda compile` writes **one** board's schematic shard to a file or to stdout. There is no directory a downstream tool can read, no manifest, and no project-level hash.
- The repository scripts (`compile:symbol`, `compile:footprint`) write a single JSON file each, again without a manifest.
- Derivative artifacts must state which source they came from (`AGENTS.md` §2 rule 11: `source_hash + tool_version`). That needs a hash over a **defined set** of shards, and a defined set needs a defined layout.

The project also has more than one description kind with a producer today — `schematic`, `pcb`, `schematic-view` ([ADR-0021](0021-schematic-view-layer.md)), plus the two library kinds `symbol` and `footprint` — so the IR layer is a directory with a per-kind convention, not a single file.

## Decision

### 1. The IR layer is a directory: `dist/ir/`

The compiled project lives in one directory, written as canonical JSON (one file per shard). The directory is the unit that downstream tools consume: they read the tree, not the build log.

### 2. Layout: the tree mirrors the project's own directories

```
dist/ir/
├── manifest.json                     # shard paths + sha256 per shard + the project hash
├── boards/<board_id>/schematic.json  # the flattened logic of one board
├── boards/<board_id>/pcb.json        # the physical description of one board
├── boards/<board_id>/view/<page_id>.json  # the drawing of one page
├── symbols/<lib>/<symbol_id>.json
└── footprints/<lib>/<footprint_id>.json
```

- `boards/<board_id>/view/<page_id>.json` extends [ADR-0008](0008-ir-shard-identity-and-hash.md) decision 1: a page's drawing is its own description ([ADR-0021](0021-schematic-view-layer.md)), so it is its own shard. It is **not** merged into the schematic shard — the schematic shard is the flattened logic, the view shard is a picture of one page, and the two have different readers.
- The library kinds keep one shard per library file; the library name is the directory the file lives in, as in the source tree.
- `project.json`, `components/<component_id>.json` and `systems/<system_id>.json` ([ADR-0008](0008-ir-shard-identity-and-hash.md) decision 1) are **not** written yet: no producer exists for `project.toml`, for the component IR, or for the `system` description. The layout for them is already decided; only the producer is missing (`docs/backlog.md` F24). A kind without a producer must not appear as an empty directory — an empty directory is not a shard.
- The tree mirrors the source directory names (`sch/`, `pcb/`, `symbols/`, `footprints/`) so that a reader can map a shard back to its source without a lookup table.

### 3. `texteda ir <project> [--out <dir>] [--json]` is the only writer

- The output directory defaults to `<project>/dist/ir`; `--out` points it elsewhere.
- It is a **project** command, not a board command: it compiles every description that has a producer, because the manifest and the project hash are project-level.
- **Nothing is written when the project has errors.** A half-written tree would carry a project hash that does not describe the project, and a hash that lies is worse than no hash. Warnings do not stop the write.
- Files under the output directory that the tree does not own are **pruned**: a deleted source file must not leave a stale shard behind, because a stale shard changes the project hash.
- `--json` prints one machine payload on stdout (diagnostics, manifest, project hash, board hashes, shard list); otherwise a human summary goes to stdout. Diagnostics always go to stderr.

### 4. The hashes follow [ADR-0008](0008-ir-shard-identity-and-hash.md) decision 5, byte for byte

- A shard's `sha256` is taken over the canonical JSON bytes **that are written to disk** — the file's content is the hashed content, there is no second serialization step.
- The project hash is `sha256` over the `<path>:<sha256>\n` lines of all shards, sorted by path; a board hash is the same aggregation over that board's shards. Both are recomputable from the manifest alone. The board hashes are printed but not stored, as [ADR-0008](0008-ir-shard-identity-and-hash.md) decision 5 requires.
- The manifest is itself checked against `schemas/ir/v0.2/manifest.schema.json` before anything is written.

### 5. Three version numbers stay separate

`ir_version` (the shape of the IR contract), the language `format` (the syntax version of the source file) and `tool_version` (the version of the tool that produced the bytes) answer three different questions and are never derived from one another. `tool_version` is the repository's `package.json` version; it is not a timestamp.

### 6. [ADR-0008](0008-ir-shard-identity-and-hash.md) is Accepted

Its decisions are settled and now have an implementation: the flattening of decision 2 is what `parseSchematic` produces, the unit table of decision 4 is what the parser converts to, the hash rules of decision 5 are what the tree writes. The parts that are not implemented are producers, not decisions (the missing shards of decision 1, tracked in `docs/backlog.md` F24). Accepting it also settles the open question about identity keys: renaming changes the identity, and "rename without changing identity" would need an explicit `id` column in the language.

## Consequences

- **The IR layer is now a thing on disk that tools can read.** Exporters, the netlist writer and later the Gerber writer can take a directory instead of re-deriving everything from the sources.
- **A project has one hash.** Anything derived from the project can carry that hash plus the board hash it belongs to, as `AGENTS.md` §2 rule 11 requires.
- **The writer is a project command, so a single board is still compiled by `texteda compile`.** Two entry points exist on purpose: `compile` is a board-level debugging aid with per-diagnostics output, `ir` is the project-level producer of the tree.
- **Rebuilding is not incremental yet.** The command recompiles every description; the shard layout is what makes incremental rebuilds possible, but the incremental logic is not written.
- **Accepting [ADR-0008](0008-ir-shard-identity-and-hash.md) closes the identity question** in `AGENTS.md` §11: renaming an instance or a net is a delete plus an add, and every hash changes with it.

## Follow-up

- The remaining shard kinds: `project.json`, `components/<component_id>.json`, `systems/<system_id>.json` — they need producers (`project.toml` parsing, the component IR, the `system` description), not a layout decision (`docs/backlog.md` F24).
- Incremental rebuild: change one source file, rewrite one shard, keep the rest of the tree byte-identical.
- Whether the manifest should also record the language `format` and the schema `$id` per shard, so that a tool can self-check a tree that mixes versions (the last follow-up of [ADR-0008](0008-ir-shard-identity-and-hash.md)).
- Whether downstream commands should read `dist/ir` instead of compiling in memory (`texteda netlist` currently compiles in memory).
- The `new-project` skill (`docs/skills/new-project.md`) should grow a step that materializes the IR tree, once its verification script exists (`docs/backlog.md` F23).
