# Renumbering reference designators

`texteda renumber` performs a **global rename** of reference designators under one validated
mapping ([ADR-0050](../adr/0050-renumbering-is-a-code-executed-global-rename.md)). It is not `fmt`:
the formatter only changes layout, while renumbering changes names, references and the project hash.
Never hand-edit numbers and never ask an agent to edit them one by one.

`fmt` — and therefore `bun run fmt:teda` — **never renumbers**. A gap such as `R1, R2, R5` stays a gap
until this command is invoked explicitly.

## Quick start

```bash
# Dry run (the default): prints the mapping, files and before/after hashes, writes nothing.
bun run texteda renumber examples/reference-project charger-buck --policy compact

# Write the changes.
bun run texteda renumber examples/reference-project charger-buck --policy compact --apply
```

The command targets one board. Component refdes on that board are renamed; a module definition's
local refdes are shared by every instance of that module, so renaming one updates the module source
**and every board that uses it**.

## Policies

| Policy | What it does |
|---|---|
| `preserve` | Keeps every existing number. This is a no-op for existing rows; it does not create a new instance. |
| `compact` | Renumbers each prefix from 1 in the current natural order, closing gaps. `R1, R2, R5` becomes `R1..R3`. Default. |
| `position` | Orders each prefix by the board's print-page `place` rows: top to bottom, then left to right, then renumbers from 1. |
| `--mapping <file>` | Applies an explicit old-to-new mapping instead of a policy. |

`position` needs a view (`views/<board_id>/*.view.teda`) with `place` rows. If the board has no
placement, the command refuses to guess and exits non-zero. Instances without a `place` row are put
after the placed ones in natural order. An instance placed at two different coordinates, or a
module local refdes placed by two module instances at different coordinates, is ambiguous; use
`--mapping` for that case.

The command never crosses prefixes, never changes a prefix (`R` -> `C` is rejected), and never
assigns one name twice. It never renumbers module instance tags (`M1`, `M2`), net names, port names,
`component_id`, or symbol/footprint ids.

## Explicit mapping

One mapping per line:

```text
# board-level component refdes
R1 R10
C7 C3

# module-local refdes: <module_id>/<old> <new>
buck-5v/C1 C9
```

- `#` starts a comment; blank lines are ignored.
- A board-level name is written bare. A module-local name is prefixed with the **module definition
  id** (the file name under `design/modules/`), not the module instance tag.
- The new name must keep the old prefix.
- A mapping whose old name is gone and whose new name is present is treated as already applied, so
  running the same mapping twice is a no-op.
- An old name that is absent, a new name that collides, a duplicate mapping, or a prefix change is a
  refusal. Nothing is written.

## What gets updated

The command parses the project and rewrites only machine-readable positions:

- schematic `instances` rows;
- net members and bus members, including multi-unit pin references (`U1.2.OUT`) and
  module-qualified pins (`M1.U1.6`);
- view `place` rows and the two pin references of each `wire` row;
- pcb `place` rows and `connect` pad references;
- variant values in `project.toml` when an entry names an instance (the current contract only
  admits component ids, so this is forward-looking).

A view wire's first column is a **net name**, not an instance. `M2.BOOT` stays untouched even when
the module's local refdes change. Comments and prose are not parsed; Markdown files under the project
root that still mention an old name are reported with file and line (build output and caches are
skipped), and left for a person to edit
([ADR-0033](../adr/0033-review-records-and-attribution.md)).

The instance `uid` is preserved. References are still names, so a renumber still changes the source
and the project hash ([ADR-0051](../adr/0051-instances-have-a-stable-project-local-uid.md)).

## Dry run, apply and hashes

The default is a dry run. It compiles the renumbered sources in a temporary copy, prints the
resulting `project_hash` and `advisory_hash`, and writes nothing. `--apply` writes all files or none;
a second run with the same input reports `No changes.` After an apply the command runs `check` and
reports its error/warning counts. It also formats every file it touched, so the sources remain in
canonical form.

`--json` prints the mapping, affected files, Markdown hits, both hashes and the check counts as one
machine-readable object. The command exits non-zero on a refusal or when `check` finds an error.

## Reviewing the result

1. Read the old -> new table. A number that moved usually means a row is in a different functional
   block; that is a review question, not a formatting question.
2. Inspect the affected files: the same moved instance must appear in the schematic row, net
   members, view `place`/`wire` and pcb `place`/`connect`.
3. Update the reported Markdown and review records by hand if their prose should follow the rename.
4. Commit the generated diff; it is auditable and reproducible.
