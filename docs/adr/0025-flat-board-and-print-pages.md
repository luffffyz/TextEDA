# ADR-0025: One Flat Schematic per Board, Pages Become Print Pages in the View Layer

Status: Accepted
Date: 2026-10-21
Related: amends [ADR-0002](0002-board-pages-and-bom.md), [ADR-0007](0007-page-internal-net-naming.md), [ADR-0021](0021-schematic-view-layer.md), [ADR-0022](0022-language-versioning.md), [ADR-0024](0024-level-tags-in-flattened-names.md)
Impact: `teda.md` §7, §7.5, §7.6, §7.7, §13; `spec/schematic-view.md`; `schemas/ir/v0.2/*`; `packages/parser`, `packages/core`, `packages/cli`, `packages/renderer`, `scripts/preview.ts`; `examples/reference-project/`; `AGENTS.md` §4.2, §11

## Background

The board-internal **page** mechanism ([ADR-0002](0002-board-pages-and-bom.md)) was built for a real
board: the reference project's `charger-buck` board carries a BQ24610 charge path and a TPS5430 5 V
buck, and the reviewer asked for them as two chunks.

Applying it to that board showed what it costs:

- **Collisions everywhere.** The two circuits use `C1`..`C4`, `D1`, `L1`, `R1`, `R2`, `U1` and the
  net names `GND`, `SYS`, `PH`, `VFB`. The mechanism to keep them apart (page ports, qualified
  names, flattening) made the source *harder* to read than the flat alternative it replaced.
- **Every crossing net is declared twice.** A net that leaves a page is a `ports` row in the page
  file *and* a row in the board root (`SYS: P1.SYS_OUT P2.SYS_IN`). The flat file says it once.
- **The qualified names are worse than the names they replace.** `P2.BOOT` reads worse than `BOOT`,
  and `BOOT` was unambiguous inside the file that declared it.
- **Three places to look for one net.** Page file, port table, board root — for a net that is
  declared in exactly one of them.
- **The flattening had nothing to flatten.** A page instance is instantiated once, so the algorithm
  merged nothing; it only renamed. The refdes collisions were still resolved by hand at export.

What the pages were actually for is a *drawing* concern: the schematic does not fit on one canvas,
and reviewers want to look at it in chunks. That is exactly the job of the view layer
([ADR-0021](0021-schematic-view-layer.md)), which is discardable, carries no electrical facts, and
already exists.

The rule that decides it is in `AGENTS.md` §3: **S1 (the view) is free and discardable, S0 (the
logic) is not.** A partition that changes the *source* of the logic is a hierarchy level, and a
hierarchy level needs ports, a namespace, and a flattening algorithm. A partition of the *drawing*
needs none of that.

## Decision

### 1. One schematic file per board

`sch/<board_id>.teda` is the board's only logical description. The `page` description type and the
`pages` section are **removed** (language version 0.7). A board's `instances`, `nets`, `ports` and
`constraints` live in that one file.

### 2. One namespace per board

`refdes` and net names are unique inside the board's schematic file. Collisions are the author's to
resolve, by renaming — the tool no longer qualifies names and no longer renumbers them at export.

The reference project resolves them by **renumbering into the board sequence** (the buck's `C1`..
`C4` become `C19`..`C22`, its `U1` becomes `U2`, …) and by **prefixing the nets of the second
circuit** (`BOOT` → `BOOT`, `PH` → `BUCK_PH`, `VFB` → `BUCK_VFB`). Renumbering keeps the silkscreen
short; the net prefix keeps the sub-circuit readable in the flat list.

### 3. Ports are the board's external interface, and nothing else

The board's `ports` section stays as it is (`teda.md` §7.5) and still names board nets; a `system`
description still consumes it ([ADR-0001](0001-board-linking.md)). **Page ports and port binding are
removed**: a net that crosses what used to be a page boundary is now simply a board net, declared
once, in one place.

### 4. The partition moves to the view layer, as a print page

`sch/<board_id>/<page_id>.view.teda` is a **print page** of the drawing: a print / format unit that
nothing but the renderer reads. It references **board-level** instance ids and net ids, so the
drawing and the logic are compared by string equality, with no name resolution in between.

The view layer's *shape* does not change ([ADR-0021](0021-schematic-view-layer.md)): the same
`place` / `wire` / `label` / `port` / `text` sections, the same file layout, the same shard path.
What changes is the meaning of the ids it names: they were page-local, they are now board-level.

A print page never creates connectivity: it draws board nets and board ports that already exist.

### 5. Modules are the only hierarchy left in the source

The module instance id carries the `M` tag (`M1.R1`) — one character, because the tag reaches the
silkscreen ([ADR-0024](0024-level-tags-in-flattened-names.md) amended). `P` is withdrawn together
with the pages; `MOD` is not used, and `M` is not reused for anything else.

### 6. Versions

- **Language 0.7**: a MINOR that *removes* constructs. See the [ADR-0022](0022-language-versioning.md)
  amendment: before `1.0` the `0.x` line may remove, with a migration note. `1.0` remains the
  freeze milestone, and this change is not a step towards it.
- **IR contract 0.2**: the schematic shard loses `pages`, `instance.page` and `port.page`. The view
  shard keeps its shape (only the meaning of its ids changes), but it moves with the contract
  version like every other shard.

### 7. Migration 0.6 → 0.7

1. Merge the page files into the board file: the `instances`, `nets` and `constraints` of every page
   become board rows; the page's `ports` rows disappear, and the board root's net rows that
   referenced them (`SYS: P1.SYS_OUT P2.SYS_IN`) become the single board net (`SYS:`).
2. Resolve the refdes collisions by renaming, and the net collisions by renaming.
3. Rewrite the view files: the page-local ids become board-level ids, the page ports become board
   ports, and the file name keeps the print page's name.
4. Rewrite the `pcb` description: the instance ids and net names lose their page prefix.

`bun run migrate:0.7 <project dir>` performs step 1 and the mechanical part of steps 3 and 4; it
**refuses to write** a board whose refdes or net names collide and reports the collisions, because
choosing a name is an authoring decision, not a mechanical one.

## Consequences

- **The source is one file per board.** One namespace, one place to look for a net, no port
  duplication, no qualified names to read.
- **The price is a long file and no source partition.** A board with sixty parts and thirty nets is
  a long `schematic` file. The partition that remains is the *view*, and it is discardable: the
  logical description stays valid whether or not anyone draws it. The gap — a source that cannot be
  chunked for review — is tracked in `docs/backlog.md`; the eventual answer is **modules**
  (`docs/backlog.md` F13), which are a hierarchy level with ports, not a drawing partition, and
  therefore not discardable.
- **The BOM is unchanged in meaning**: one board = one BOM, aggregated over the flat instance list;
  the aggregation key is (`component_id`, parameters, variant status), not the refdes
  ([ADR-0002](0002-board-pages-and-bom.md) decision 7).
- **The `pcb` description gets simpler**: it references board-level instance ids and net names; no
  `P2.` prefixes, no port indirection.
- **The IR shrinks**: `pages`, `instance.page` and `port.page` are gone, so a consumer of a
  schematic shard no longer has to understand a second namespace to read it.

## Rejected Alternatives

| Option | Why it was rejected |
|---|---|
| Keep the pages, make the ergonomics nicer (shorter qualification, fewer port rows) | The core cost is not the spelling: it is the second namespace, the duplicated declarations and the third place to look for a net |
| Keep the pages only as a *source* partition, and make the view reference page-local ids | That keeps the flat model broken: the drawing would still have to resolve a second namespace, and the view could not be compared to the logic by string equality |
| Use modules as the partition | A module carries connectivity, so it is not discardable; a drawing partition must be, or a reviewer can never re-cut the drawing without touching the logic |
| Keep the qualified names for the view layer only | The view names board-level ids, so nothing is qualified; there is no second namespace left to qualify |
| Renumber the refdes automatically at export (as the flattening did) | The author sees `C1` in the source and `C19` on the board; the mapping was already a manual step, and now the names are simply the names |

## Follow-up

- The source-partition gap: tracked in `docs/backlog.md`.
- The view ↔ board cross-check moves to `packages/core` and becomes a board-level string comparison
  (`docs/backlog.md` F3).
- The `M` level tag is documented in `teda.md` §7 and in `AGENTS.md` §4.2, and is used by the
  hierarchy when it lands.
