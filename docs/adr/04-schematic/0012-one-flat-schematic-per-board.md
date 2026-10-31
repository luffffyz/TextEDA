# ADR-0012: One Flat Schematic per Board; the Partition Moves to the View Layer

Status: Accepted
Date: 2026-10-21
Scope: Decides: that a board has one schematic file and one namespace, that the `page` description type is gone, and that a review partition is a print page in the view layer. Does not decide: the module hierarchy — see ADR-0013; nor the view layer's own shape — see ADR-0035.
Related: [ADR-0006](../02-ir/0006-ir-shards-and-hashes.md), [ADR-0013](0013-modules-compose-boards.md), [ADR-0014](0014-connectivity-has-one-authority.md), [ADR-0015](0015-flattening-and-the-net-set.md), [ADR-0035](../09-view/0035-the-view-layer-is-a-drawing.md)
Impact: `spec/teda.md` §7, §13; `spec/schematic-view.md`; `schemas/ir/**`; `packages/parser`, `packages/core`, `packages/cli`, `packages/renderer`; `scripts/migrate-0.7.ts`; `examples/reference-project/`

## Background

The board-internal **page** mechanism was built for a real board: the reference project's
`charger-buck` board carries a BQ24610 charge path and a TPS5430 5 V buck, and the reviewer asked
for them as two chunks.

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
and reviewers want to look at it in chunks. That is exactly the job of the view layer, which is
discardable, carries no electrical facts, and already exists.

The rule that decides it is the layer rule: **S1 (the view) is free and discardable, S0 (the logic)
is not.** A partition that changes the *source* of the logic is a hierarchy level, and a hierarchy
level needs ports, a namespace, and a flattening algorithm. A partition of the *drawing* needs none
of that.

The level tag that went with the pages is settled here too. A design has levels, and after
flattening the level survives only in the *name*: board-root names are bare (`R1`, `GND`), a
qualified name is `<instance_id>.<local>` (`M1.R1`, `M1.VCC`). The tag that marks the level is a
reserved character, and it reaches the silkscreen, so it is one character: `M` for a module
instance. `P` went with the pages and is free again; `MOD` is not used.

## Decision

### D1. One schematic file per board

`design/sch/<board_id>.teda` is the board's only logical description. The `page` description type
and the `pages` section are **removed**. A board's `instances`, `nets`, `ports` and `constraints`
live in that one file.

### D2. One namespace per board

`refdes` and net names are unique inside the board's schematic file. Collisions are the author's to
resolve, by renaming — the tool no longer qualifies names and no longer renumbers them at export.

The reference project resolves them by **renumbering into the board sequence** (the buck's `C1`..
`C4` become `C19`..`C22`, its `U1` becomes `U2`, …) and by **prefixing the nets of the second
circuit** (`BOOT` → `BOOT`, `PH` → `BUCK_PH`, `VFB` → `BUCK_VFB`). Renumbering keeps the
silkscreen short; the net prefix keeps the sub-circuit readable in the flat list.

### D3. Ports are the board's external interface, and nothing else

The board's `ports` section stays as it is and still names board nets; a `system` description still
consumes it (see ADR-0009). **Page ports and port binding are removed**: a net that crosses what
used to be a page boundary is now simply a board net, declared once, in one place.

### D4. The partition moves to the view layer, as a print page

`views/<board_id>/<page_id>.view.teda` is a **print page** of the drawing: a print / format unit
that nothing but the renderer reads. It references **board-level** instance ids and net ids, so the
drawing and the logic are compared by string equality, with no name resolution in between.

The view's id **vocabulary** is the board's, not a subset of it: a board-level `instance_id` may be
module-qualified (`M1.U1`), and the view names it as it is — `M1.U1.5` for a pin, `M1.VCC` for a
module-internal net. The view names ids, it never defines them, so it has no reason to know less
than the board does.

The view layer's *shape* does not change (see ADR-0035): the same `place` / `wire` / `label` /
`port` / `text` sections, the same file layout, the same shard path. What changes is the meaning
of the ids it names: they were page-local, they are now board-level.

A print page never creates connectivity: it draws board nets and board ports that already exist.

### D5. The level tag is one character, and it is `M`

A qualified name is `<instance_id>.<local>`; the instance id carries the level as a reserved tag.
The tag reaches the silkscreen, so it is one character: `M` for a module instance, giving `M1.R1`
and not `MOD1.R1`.

| Level | Qualified name | Example | Tag |
|---|---|---|---|
| Board root | `<name>` (no `.`) | `R1`, `GND` | none |
| Module instance | `<module_instance_id>.<local>` | `M1.R1` | `M` |

`P` is free again — no page level exists to tag — and `MOD` is not used.

The tag is a **convention, not a grammar rule**. The instance id stays a free identifier
(`[A-Z]+[0-9]+`, the same rule as `refdes`); the tool does not reject an instance named `Q1`. The
reason is the language version rule (see ADR-0002): restricting a free identifier makes existing
files invalid, which is a MAJOR change, and MAJOR is reserved for the `1.0` semantic freeze. A
naming style is not worth the freeze. The tag is carried by the spec, the examples and the
reference project — and it can be enforced at `1.0` without a migration.

The level is **structural wherever the IR has a field for it**: a name is not the only carrier. A
module instance carries its module in the IR, so a consumer never has to parse the instance id to
learn the level. Adding a field to nets in the IR would make the level machine-readable for nets as
well, but that changes the IR shape and therefore the IR contract version. It is not needed to make
the names unambiguous, so it is not done.

### D6. Modules are the only hierarchy left in the source

A module carries connectivity, so it is not discardable; a drawing partition must be, or a reviewer
can never re-cut the drawing without touching the logic. The module layer is described in
ADR-0013.

### D7. Versions and migration

- **Language 0.7**: a MINOR that *removes* constructs. Before `1.0` the `0.x` line may remove,
  with a migration note (see ADR-0002). `1.0` remains the freeze milestone, and this change is not
  a step towards it.
- **IR contract 0.2**: the schematic shard loses `pages`, `instance.page` and `port.page`. The view
  shard keeps its shape (only the meaning of its ids changes), but it moves with the contract
  version like every other shard.
- **Migration 0.6 → 0.7**: merge the page files into the board file — the `instances`, `nets` and
  `constraints` of every page become board rows, the page's `ports` rows disappear, and the board
  root's net rows that referenced them become the single board net; resolve the refdes and net
  collisions by renaming; rewrite the view files so the page-local ids become board-level ids and
  the page ports become board ports; and rewrite the `pcb` description so the instance ids and net
  names lose their page prefix.

  `bun run migrate:0.7 <project dir>` performs the merge and the mechanical part of the view and
  `pcb` rewrites; it **refuses to write** a board whose refdes or net names collide and reports
  the collisions, because choosing a name is an authoring decision, not a mechanical one.

## Consequences

- **The source is one file per board.** One namespace, one place to look for a net, no port
  duplication, no qualified names to read.
- **The price is a long file and no source partition.** A board with sixty parts and thirty nets is
  a long `schematic` file. The partition that remains is the *view*, and it is discardable: the
  logical description stays valid whether or not anyone draws it. The gap — a source that cannot
  be chunked for review — is tracked in `docs/backlog.md`; the eventual answer is **modules**, which
  are a hierarchy level with ports, not a drawing partition, and therefore not discardable.
- **The BOM is unchanged in meaning**: one board = one BOM, aggregated over the flat instance list;
  the aggregation key is (`component_id`, parameters, variant status), not the refdes (see ADR-0029).
- **The `pcb` description gets simpler**: it references board-level instance ids and net names; no
  `P2.` prefixes, no port indirection.
- **The IR shrinks**: `pages`, `instance.page` and `port.page` are gone, so a consumer of a
  schematic shard no longer has to understand a second namespace to read it.
- **The names say what they are.** `M1.VCC` in a `pcb` file is a module net; the level cannot be
  confused with another level, because there is no other level.
- **The convention is not enforced.** A project that names its module instances `Q1` keeps working
  and keeps producing `Q1.*` names; the level is still unambiguous to the tools, only the human
  reading the file has to look it up. Enforcement is deferred to the `1.0` milestone.
- **Existing artifacts change.** The reference project's instance ids, net names and PCB references
  change, so the IR shards and the project hash change. Nothing in the contract changes: the id
  patterns in the schemas accept both forms.

## Rejected Alternatives

| Option | Why it was rejected |
|---|---|
| Keep the pages, make the ergonomics nicer (shorter qualification, fewer port rows) | The core cost is not the spelling: it is the second namespace, the duplicated declarations and the third place to look for a net |
| Keep the pages only as a *source* partition, and make the view reference page-local ids | That keeps the flat model broken: the drawing would still have to resolve a second namespace, and the view could not be compared to the logic by string equality |
| Use modules as the partition | A module carries connectivity, so it is not discardable; a drawing partition must be, or a reviewer can never re-cut the drawing without touching the logic |
| Keep the qualified names for the view layer only | The view names board-level ids, so nothing is qualified; there is no second namespace left to qualify |
| Renumber the refdes automatically at export (as the flattening did) | The author sees `C1` in the source and `C19` on the board; the mapping was already a manual step, and now the names are simply the names |
| Use a two-character tag (`MOD`) | The tag reaches the silkscreen; one character keeps the qualified name short |
