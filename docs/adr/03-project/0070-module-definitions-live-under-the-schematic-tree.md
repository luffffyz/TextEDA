# ADR-0070: Module Definitions Live Under the Schematic Source Tree

Status: Accepted
Date: 2026-11-11
Scope: Decides: that reusable module definitions live at `design/sch/modules/<module_id>.teda`, that `design/sch/` holds the complete project logical source, and that project loading, initialization and migration use only that path. Does not decide: module semantics, module parameters, or a cross-project module library — see [ADR-0013](../04-schematic/0013-modules-compose-boards.md) D8 and `spec/module.md` §10.
Related: [ADR-0008](0008-project-tree-has-owners.md), [ADR-0013](../04-schematic/0013-modules-compose-boards.md), [ADR-0069](0069-project-level-logical-root-and-physical-board-mapping.md), [ADR-0071](../09-view/0071-a-module-drawing-is-an-editable-view.md)
Impact: `spec/project.md`; `spec/teda.md`; `spec/module.md`; `spec/pcb.md`; `spec/schematic-view.md`; `packages/cli/src/paths.ts`; `packages/cli/src/project.ts`; `packages/cli/src/init.ts`; `packages/parser/src/`; `scripts/lib/project.ts`; `scripts/migrate-0.14.ts`; `examples/**`; generated references

## Background

[ADR-0069](0069-project-level-logical-root-and-physical-board-mapping.md) D1 made
`design/sch/main.teda` the project's only logical root and left reusable module definitions beside it
at `design/modules/<module_id>.teda`. The split is a leftover of the board-scoped model: `sch/` names
the schematic source, but the module definitions — which own every component instance, local net and
port of the project — sit in a sibling directory.

The tree already answers "who owns what" ([ADR-0008](0008-project-tree-has-owners.md)): `design/` is
the circuit, `views/` is the drawing, `assets/` is what the project owns as a library, `dist/` is
derived. Under that rule, a reader who opens `design/sch/` expects the complete logical source. Today
they find one file and must learn that the other half of the logic is one directory up.

`design/pcb/` is the physical implementation tree. `sch/` and `pcb/` are the two halves of
`design/`; a module definition is schematic source, not a sibling of both.

## Decision

### D1. Module definitions live at `design/sch/modules/<module_id>.teda`

- `design/sch/main.teda` remains the only logical root.
- A module definition is `design/sch/modules/<module_id>.teda`. The module id is the file name, as
  before (`spec/module.md` §1).
- A module definition is a definition composed by the root, not a second root: it has no project
  nets, project ports or interconnects.
- The loader reads only the new path. There is no active reader and no alias for
  `design/modules/`; a file left there is not project logic.

### D2. `design/sch/` is the complete logical source

| Path | What it holds |
|---|---|
| `design/sch/main.teda` | the project's one logical root |
| `design/sch/modules/<module_id>.teda` | reusable module definitions |
| `design/pcb/<pcb_id>.teda` | physical PCB implementations |

`design/sch/` no longer means "the directory that happens to contain the root"; it means the
complete logical source of the project. `design/pcb/` remains the physical tree.

### D3. Initialization and migration use the new layout

- `texteda init` creates `design/sch/modules/` and writes its README next-step text against that
  path.
- `texteda migrate:0.14` keeps reading a legacy `design/modules/` tree as its input (that is what it
  migrates), and moves that tree to `design/sch/modules/` in its output. After migration no
  `design/modules/` directory remains.
- The migration is deterministic: a plain directory move, no file rewrite beyond the source
  references already handled by the migration.

### D4. Path only

The change moves files. It does not change module semantics, composition, flattening, PCB ownership,
the IR shape, or any hash rule. Because each shard records `source.file`, the path appears in
generated shards and in diagnostics; those artifacts are regenerated, not hand-edited.

## Consequences

- A reader of `design/sch/` sees all of the project's logic: the root and the modules it composes.
- `design/pcb/` is unambiguously the physical half of `design/`.
- Existing projects keep working through `migrate:0.14`; there is no compatibility reader, so a
  project that is not migrated resolves no modules and reports them as missing.
- Documentation, examples, fixtures, skills and generated references move with the path; the
  repository gates are the evidence that nothing still points at the old location.
