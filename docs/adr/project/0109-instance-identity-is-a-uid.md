# ADR-0109: Instance Identity Is a Stable Project-Local UID, Not the Refdes

Status: Accepted
Date: 2026-10-25
Scope: Decides: that an instance's identity is a stable project-local `uid`, and that a rename does not change it. Does not decide: what a net or a port is identified by — that is still its name.
Related: [ADR-0110](0110-renumbering-is-a-code-executed-rename.md), [ADR-0112](../schematic/0112-modules-compose-boards.md)
Impact: `spec/teda.md` §7.1; `packages/parser/src/schematic.ts`; `packages/cli/src/id.ts`

## Context

Today the flattened instance name is the identity key: `R1`, `M1.R1`
([ADR-0105](../ir/0105-ir-shards-and-hashes.md) decision 3). It is printed in net members
(`R1.2`), view placements, pcb placements, BOM output and review records. Renaming a refdes is
therefore a global identity change, and the only way to keep the old thing recognizable is to
match names outside the IR.

That is wrong for an instance. A refdes is a human label that a designer may renumber; the physical
part does not become another part because its label changed. KiCad already separates the two: a
symbol has an immutable UUID, a `Reference` property, and the PCB footprint links through the
symbol path, not through the reference designator. Renumbering runs annotation, which changes the
reference and leaves the UUID alone.

The first question is not "UUID or short code?" but "which objects have an identity independent
of their display name?". This record answers that for the current language.

## Decision

### 1. A component or module instance carries a UID

A UID is:

```
^ID[0-9a-hjkmnp-tv-z]{6}$
```

`ID` plus six lowercase Crockford Base32 characters, eight characters in total, e.g. `ID7k3m9q`. The `ID`
prefix is reserved; the suffix is fixed-width, lower-case, and uses the Crockford alphabet
(its letters exclude `i`, `l`, `o` and `u`; digits `0` and `1` are ordinary characters). A UID is generated once when the instance is created, is
immutable, is project-scoped, and is not reused after deletion in normal operation. If a random
generator hits an existing UID it retries; a UID supplied by a human, an importer or a copy is
checked and a collision is an error, never a silent rewrite.

The source row carries it as a column, not as an `id=` assignment:

```
instances
  R1  ID7k3m9q  res-thick-0402  10k  ±1%
  C1  IDk2m8q4  cap-mlcc-0402   100n 10% 16V X7R

modules
  M1  IDp8x2n4  charger-power
  M2  IDq4m7sc  buck-5v
```

The refdes stays the first column because it is what a person reads and sorts by. The UID is a
distinct, obviously machine-shaped token; it must not be a second short name such as `r4`.

### 2. Module-local UIDs are path-qualified

A module definition may be instantiated more than once. Its local instances therefore carry a
local UID in the module file, but their stable identity in the board is:

```
<module instance uid>/<local instance uid>
```

e.g. `IDp8x2n4/IDk2m8q4` for `M1.C1` and `IDq4m7sc/IDk2m8q4` for `M2.C1`. The display name
remains `M1.C1` / `M2.C1`. The same local UID appearing in two module instances is not a duplicate;
the path is what makes it unique. A module instance UID is what makes that path possible; when
it is absent, the local UID stays bare and the project-wide check still treats it as one
identity.

Module definitions themselves keep `module_id` as their identity: they are types, not instances.
The same rule applies to `component_id`, `board_id`, `page_id`, `system_id` and variant ids.

### 3. What does not get a UID

- **Board**: `board_id` is already the key, not a display name. Renaming the board file is a
  project-wide identity change. A separate board UID is not added.
- **PCB**: a board has at most one pcb description; it is a projection of that board, addressed by
  `(board_id, pcb)`. It has no identity of its own.
- **Schematic**: one per board; addressed by `(board_id, sch)`.
- **Net and port**: their names remain their identity for now. Renaming a net or port is still an
  identity change. If that must change later, it is a separate decision and must cover every
  description that references them at once.
- **Pin and pad**: identity is `(instance uid, pin number)` / `(instance uid, pad number)`.
  The number is stable inside the symbol or footprint; no second UUID is added.
- **Print page and view records**: S1 is a drawing; `page_id` is the page key, and the elements of
  a drawing do not enter build identity ([ADR-0134](../view/0134-the-view-layer-is-a-drawing.md)).
- **Variant, requirement, block, analysis, review**: process or selection records; their names or
  file ids are their keys, and they are outside the instance identity model.
- **BOM / fab rows**: derived data; no identity.

### 4. Source references still use names

This record adds the UID to the instance record; it does **not** rewrite the syntax of every
reference. Net members (`R1.2`), view placements (`R1`), pcb placements (`R1`) and pin references
(`U1.2.OUT`) keep using the display name and are resolved against the instance table. That keeps
the source readable and keeps this change reviewable.

The consequence is explicit: changing a refdes still changes the source text, the resolved pin
references and `source_hash`; it does not change the instance's UID. A later decision may rekey
those references to the UID (and add an identity hash), but this record does not pretend that a
refdes edit is hash-neutral.

### 5. Duplicate checking is mandatory

Uniqueness is not probabilistic policy. Every entry point checks:

1. **Generation** (`texteda id`): the command scans the project's board and module sources,
   draws a candidate, and retries when it is already taken. It only prints UIDs; assigning a UID
   to a row is still an authoring action.
2. **Parsing**: a duplicate source UID in one namespace is an error.
3. **Project check**: the full flattened UID set across all boards is checked; a duplicate is an
   error with both locations.
4. **Import/copy/paste**: the incoming UID is checked; a collision is rejected rather than
   rewritten.
5. **Formatting**: `fmt` never generates, changes or removes a UID; it only aligns the column.

A UID is never rewritten silently. Changing an existing UID is an explicit destructive operation
(new instance), not a repair.

### 6. IR contract

The schematic `instance` record gains an optional `uid`:

```json
{
  "uid": "ID7k3m9q",
  "id": "R1",
  "component": "res-thick-0402"
}
```

For a module instance the `uid` is the path form. `id` remains the flattened display name and the
key used by existing references. The instance shape changed, so the IR contract moved with it —
the current contract version lives in `schemas/ir/`.

The language moved too: a file written before the UID existed may omit it (legacy identity), and a
file at or above the current language version should carry it. `check` reports a missing UID as a
warning, so an old file is not silently mistaken for a stable-identity design. The versions
themselves are stated in `spec/teda.md` §13.1.

**One version number, one ceiling.** This record was written when the language had a version line
per description type, and it moved two of them. That model is gone: the language has one version
number and every type shares its ceiling
([ADR-0101](../language/0101-one-language-version-number.md)). The decision here is unaffected by
that merge — the UID column is additive, old files stay valid — but the version arithmetic that
accompanied it no longer describes how the language moves.

## Consequences

Positive:

- An instance has an identity that a renumbering or a display-name edit does not erase.
- The shape matches the KiCad precedent (immutable UUID + editable reference), without forcing
  36-character strings into a text table.
- Board and PCB remain singular documents; no second identity is introduced for a projection.
- Duplicate checking is a stated requirement, not a collision-probability argument.

Negative:

- A refdes rename still changes the source and its hash; stable UID alone does not make it
  hash-neutral.
- Existing source files need a UID column to get the new guarantee.
- A component instance now has two visible tokens in its row; the UID shape and column position
  must stay visibly distinct from the refdes.

## What this does not do

- It does not make net or port names stable.
- It does not make `source_hash` ignore a refdes edit.
- It does not rekey net member, view, pcb or pin-reference syntax to UIDs.
- It does not add a UID to boards, PCB descriptions, print pages, variants, component definitions,
  module definitions, symbol/footprint definitions, pins or pads.
- It did not implement `texteda renumber`; that landed separately as F47 (2026-10-26), under
  [ADR-0110](0110-renumbering-is-a-code-executed-rename.md), with the identity premise
  amended by this record.
