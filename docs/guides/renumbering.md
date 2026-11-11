# Renumbering reference designators

`texteda renumber` performs a **global rename** of reference designators under one validated
mapping ([ADR-0011](../adr/03-project/0011-renumbering-is-a-code-executed-rename.md)). It is not `fmt`:
the formatter only changes layout, while renumbering changes names, references and the project hash.
Never hand-edit numbers and never ask an agent to edit them one by one.

`fmt` — and therefore `bun run fmt:teda` — **never renumbers**. A gap such as `R1, R2, R5` stays a gap
until this command is invoked explicitly.

## Quick start

```bash
# Dry run (the default): the second argument is a physical PCB id. The command prints the mapping,
# affected project files and before/after hashes, and writes nothing.
bun run texteda renumber examples/reference-project charger-buck --policy compact

# Write the changes.
bun run texteda renumber examples/reference-project charger-buck --policy compact --apply
```

The command selects one physical PCB (`design/pcb/<pcb_id>.teda`) to determine which project module
instances and module-local refdes are in scope. The logical source is the single project root
`design/sch/main.teda`; it has no board-local schematic or board-level component namespace. A module
definition's local refdes are shared by every project instance of that module, so renaming one
updates the module source **and every project view and physical PCB that references those instances**.

## Policies

| Policy | What it does |
|---|---|
| `preserve` | Keeps every existing number. This is a no-op for existing rows; it does not create a new instance. |
| `compact` | Renumbers each prefix from 1 in the current natural order, closing gaps. `R1, R2, R5` becomes `R1..R3`. Default. |
| `position` | Orders each prefix by project-view `place` rows: top to bottom, then left to right, then renumbers from 1. |
| `--mapping <file>` | Applies an explicit old-to-new mapping instead of a policy. |

`position` needs a project view (`views/<page_id>.view.teda`) with `place` rows for the selected
PCB's owned project module instances. If none of those instances has a placement, the command
refuses to guess and exits non-zero. Instances without a `place` row are put after the placed ones
in natural order. An instance placed at two different coordinates on project pages, or a module
local refdes placed by two module instances at different coordinates, is ambiguous; use
`--mapping` for that case.

The command never crosses prefixes, never changes a prefix (`R` -> `C` is rejected), and never
assigns one name twice. It never renumbers module instance tags (`M1`, `M2`), net names, port names,
`component_id`, or symbol/footprint ids.

## Explicit mapping

One mapping per line:

```text
# module-local refdes: <module_id>/<old> <new>
buck-5v/C1 C9
```

- `#` starts a comment; blank lines are ignored.
- All component refdes are module-local; there is no board-level or root-level refdes namespace.
  Write a module-local name as `<module_id>/<old>`, prefixed with the **module definition id** (the
  file name under `design/sch/modules/`), not the globally unique project module instance tag.
- The new name must keep the old prefix.
- A mapping whose old name is gone and whose new name is present is treated as already applied, so
  running the same mapping twice is a no-op.
- An old name that is absent, a new name that collides, a duplicate mapping, or a prefix change is a
  refusal. Nothing is written.

## What gets updated

The command parses the project and rewrites only machine-readable positions:

- module `instances` rows and the corresponding references in the project schematic root
  `design/sch/main.teda`;
- net members and bus members, including multi-unit pin references (`U1.2.OUT`) and
  module-qualified pins (`M1.U1.6`);
- the pin subject of a `voltage`, `current` or `power` constraint (`power R1.1 2mW`); a constraint
  subject that names a net is left alone even when the net name looks like a pin;
- project-view `place` rows and the two pin references of each `wire` row in
  `views/<page_id>.view.teda`;
- reusable module-view `place`/`wire` references in `views/modules/<module_id>.module-view.teda`;
- physical PCB `place` rows and `connect` pad references in every
  `design/pcb/<pcb_id>.teda`;
- variant values in `project.toml` when an entry names a flattened project instance.

A view wire's first column is a **net name**, not an instance. `M2.BOOT` stays untouched even when
the module's local refdes change. For the same reason, a two-segment `M1.X` in a `nets`/`bus` row is
a module **port** name, not an instance reference; only `M1.U1.6` and longer forms carry a refdes.
Comments and prose are not parsed; Markdown files under the project
root that still mention an old name are reported with file and line (build output and caches are
skipped), and left for a person to edit
([ADR-0037](../adr/09-view/0037-review-records-and-attribution.md)).

The instance `uid` is preserved. References are still project-level names, so a renumber still
changes the source and the project hash ([ADR-0010](../adr/03-project/0010-instance-identity-is-a-uid.md)).

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
2. Inspect the affected files: the same moved project instance must appear in its module source,
   the root schematic's net members, project-view `place`/`wire` rows, and the owning PCB's
   `place`/`connect` rows.
3. Update the reported Markdown and review records by hand if their prose should follow the rename.
4. Commit the generated diff; it is auditable and reproducible.
