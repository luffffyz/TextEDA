# ADR-0050: Renumbering Is a Code-Executed Global Rename, Not an Agent Edit

Status: Accepted
Date: 2026-10-25
Related: [ADR-0002](0002-board-pages-and-bom.md), [ADR-0008](0008-ir-shard-identity-and-hash.md),
[ADR-0021](0021-schematic-view-layer.md), [ADR-0023](0023-ir-layer-on-disk.md),
[ADR-0026](0026-modules-compose-boards.md), [ADR-0032](0032-view-is-a-drawing-not-a-build-input.md),
[ADR-0033](0033-review-records-and-attribution.md)
Impact: A new explicit CLI command (working name `texteda renumber`); no language or IR contract
change; renumbering changes instance identity and therefore the project hash; implementation is
tracked as F47.

## Context

Adding a component by editing `design/sch/<board>.teda` inserts the next free reference designator.
The canonical formatter sorts rows by natural order, but sorting is not renumbering: `R1, R2, R5`
stays a gap. A user may want a compact set (`R1..R3`) or an order that follows the drawing or the
functional blocks.

In the current implementation the flattened instance name (`R1`, `M1.R1`) is the identity
([ADR-0008](0008-ir-shard-identity-and-hash.md) decision 3; `AGENTS.md` §2 invariant 5). Renaming a
refdes is therefore a global rename: it changes the IR identity, the project hash, the view's
`place`/`wire` references, the PCB's placement references, BOM output, and any variant that names an
instance. It is not a display format and cannot be treated as one.

## Decision

1. **Code executes the renumbering.** The agent may choose a policy, propose an order, or supply an
   explicit mapping, but it does not hand-edit numbers in the source. The command computes and
   validates the mapping, applies it atomically, and reports what it changed.

2. **Renumbering is a separate command, never `fmt`.** `fmt` is pure layout: `fmt(fmt(x)) == fmt(x)`
   and it never changes identity. A renumbering pass changes names and hashes, so it needs its own
   command, a dry run, and an explicit apply.

3. **Policies are inputs; the mapping is derived.** The first form supports:
   - `preserve`: keep existing numbers and give a new instance the next free number; no renumbering
     of existing rows;
   - `compact`: renumber each prefix from 1 in the current natural order, closing gaps;
   - `position`: order by the placement in the print page (top-to-bottom, then left-to-right), then
     renumber per prefix;
   - `mapping`: take an explicit old -> new list from a file, validate it, and apply it.
   The command never changes the prefix (`R`, `C`, `U`, `J`, ...), never crosses prefixes, and never
   assigns the same name twice.

4. **Dry run first, then an atomic apply.** The default is a dry run that prints the old -> new
   mapping, collisions, the files it would touch, and the resulting hash change. `--apply` writes
   all files or none. A second run with the same policy and the same input is a no-op.

5. **Update every machine-readable reference.** The command updates the schematic instance rows,
   net members (`U1.2.OUT`), the pin subject of a `voltage`/`current`/`power` constraint
   (`power R1.1 2mW`), the view's `place` rows and `wire` pin references, the PCB's placement
   references, and variant entries that name an instance. `component_id` references are untouched.
   Net names and port names are untouched: a net called `R1_DIV` is a human decision, not a
   renumbering target, and a two-segment `M1.X` in a net/bus row is a port name, not an instance.
   Prose and review records are not parsed
   ([ADR-0033](0033-review-records-and-attribution.md)); the command reports old names found in
   Markdown so a person can update them.

6. **Modules are not flattened into a global sequence by force.** A module's refdes is local to its
   definition, and every instance shares that definition (`M1.R1`, `M2.R1`). Renumbering inside a
   module is a rename of the module source; a single board-wide contiguous sequence across module
   instances is not expressible without a per-instance refdes, which the module layer does not have.
   The command renumbers within the chosen namespace or requires an explicit mapping; it does not
   fake a global sequence by rewriting flattened view names.

7. **Display-only renumbering is not the default.** If a renderer shows a different number without
   changing the source, the source, the exported netlist/BOM and the review artifact disagree. That
   needs its own explicit, view-only decision; it is not this feature. Renumbering changes the
   source, and the resulting hashes are reported.

8. **This does not add stable identity.** "Renumber without changing identity" is the explicit `id`
   column discussed in `AGENTS.md` §11 Q15 and [ADR-0008](0008-ir-shard-identity-and-hash.md)
   decision 3, not this command. Here, a new refdes is a new identity.

## Why not let the agent number

- Exact assignment is arithmetic over a global namespace; an LLM can skip a number, duplicate one,
  or miss a module prefix, a multi-unit reference (`U1.2.OUT`) or a view pin reference.
- The operation is identity-changing and must be reproducible and auditable. Two agent runs can
  produce different mappings for the same input.
- A hand-edited diff over dozens of references is hard to review; a mapping table and a generated
  change set are not.
- The agent is still useful: it can choose `position` vs `compact`, propose a functional order, or
  produce the `mapping` file. Code validates and applies it.

## Consequences

Positive:

- One deterministic mapping, validated for duplicates, collisions and prefix changes.
- Atomic and idempotent: a dry run, an apply, and a second no-op run.
- A reviewable old -> new table, plus a report of prose that still uses the old names.
- Supports compact numbers and a drawing/functional order without making `fmt` impure.

Negative:

- Renumbering changes the project hash and the advisory view hash; every consumer that pinned a
  hash must be told.
- Module-local refdes cannot become a board-wide contiguous sequence without changing the module
  model. The command must say so rather than invent a naming scheme.
- Review records and documentation that mention old refdes need a human edit; the command can only
  report them.
- A new command, tests and a dry-run/apply workflow have to be built and maintained.

Mitigations:

- The dry run is the default; `--apply` is explicit.
- The command prints the old -> new map and the affected files, and `check`/`fmt` run after apply.
- The review or release artifact that cares about the drawing names the view shard's hash, so a
  renumbering is visible even though the build hash is the normative key.

## Amendment (2026-10-25)

[ADR-0051](0051-instances-have-a-stable-project-local-uid.md) adds an immutable project-local
`uid` to component and module instances. The premise of decision 8 and of this record changes:
renumbering a refdes is no longer an identity change for an instance that has a `uid`; the UID
survives the rename. However, this record's implementation is still a **display-name rename**:
net members, view/pcb placements and pin references still use the refdes, so a renumber still
edits those files and still changes `source_hash`. A future rekey of references to UIDs (and an
identity hash) is a separate decision. The command's mapping, atomic apply and "fmt never
renumbers" rules stand.

## Implementation (2026-10-26)

F47 landed as `texteda renumber` (`packages/cli/src/renumber.ts`, tests in
`packages/cli/test/renumber.test.ts`, user guide `docs/guides/renumbering.md`). The implementation
keeps the decisions above and adds these operational details:

- `preserve` is identity for existing rows; the command does not create instances, so "give a new
  instance the next free number" remains the authoring step.
- A module-local refdes is mapped in the module definition and therefore updates every board that
  uses that module, including the other boards' schematic, view and pcb references.
- When `--apply` is given, the command formats the touched sources and then runs `check`; it exits
  non-zero if `check` reports an error. The dry run compiles the renumbered sources in a temporary
  copy and reports the project and advisory hashes it would produce.
- `preserve`/`compact`/`position` are the only policies; a mapping file is the escape hatch for a
  hand-chosen order. A mapping that is already applied is accepted as a no-op.

## What this does not do

- It does not change `fmt`, the canonical row order, or the IR contract.
- It does not renumber nets, ports, `component_id`, symbol/footprint ids or module instance tags.
- It does not rewrite prose or review records.
- It does not make renaming identity-preserving. **Amended:** the UID is preserved, but the
  surrounding references and source hash are not.
- It does not run automatically when a component is added; the user invokes it explicitly.
