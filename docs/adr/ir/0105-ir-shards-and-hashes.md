# ADR-0105: IR Sharding, Identity Keys, and Hashes

Status: Accepted
Date: 2026-10-21
Scope: Decides: how the IR is split into shards, how an identity is keyed, and how the hashes are computed and aggregated. Does not decide: the representation of the IR itself — see ADR-0104; nor the instance identity — see ADR-0109.
Related: [ADR-0101](../language/0101-one-language-version-number.md), [ADR-0103](../language/0103-source-spans.md), [ADR-0104](0104-ir-representation.md), [ADR-0107](../project/0107-project-tree-has-owners.md), [ADR-0111](../schematic/0111-one-flat-schematic-per-board.md), [ADR-0122](../manufacturing/0122-the-output-package-carries-its-provenance.md)
Impact: `schemas/ir/**`; `packages/cli/src/ir-tree.ts`; `packages/cli/src/ir.ts`; `AGENTS.md` §2 rule 18, §9

## Background

The IR representation record settled the form — canonical JSON plus a JSON Schema contract — and
left four things as follow-up: file partitioning, `source_hash` granularity, the boundary between
IR and `project.toml`, and the generation direction of the types. While writing the schema, three
more problems surfaced that the representation record does not cover but that directly determine
the shape of the schema:

1. **Where flattening lives.** The IR is one file per board, so does it store the "page structure",
   the "flattened result", or both?
2. **Whether the identity key is just a name.** The IR is the single source of truth and the
   representation record says IDs use semantic IDs (`U1`, `net:GND`, `M1.R1.2`), while in the source
   code the handles of instances and nets are exactly the refdes and the net name. This directly
   conflicts with the rule that "the display name may change, the ID does not".
3. **The unit table is not enough.** The representation record only gave a few integer fields
   (length nm, angle millidegree, ratio ppm, impedance Ω), but values like `4R7` = 4.7 Ω, `90Ω±10%`,
   and dielectric constant 4.3 are not representable under "integer Ω / integer ppm".

The shard rules were then settled, but nothing wrote them. The compiler wrote one board's
schematic shard to a file or to stdout: there was no directory a downstream tool could read, no
manifest, and no project-level hash. The repository scripts wrote a single JSON file each, again
without a manifest. Derivative artifacts must state which source they came from, and that needs a
hash over a **defined set** of shards, and a defined set needs a defined layout.

The project also has more than one description kind with a producer — `schematic`, `pcb`, the print
page, plus the two library kinds `symbol` and `footprint` — so the IR layer is a directory with a
per-kind convention, not a single file.

## Decision

### D1. The IR layer is a directory: `dist/ir/`

The compiled project lives in one directory, written as canonical JSON (one file per shard). The
directory is the unit that downstream tools consume: they read the tree, not the build log.

### D2. Shards are 1:1 with source files, and the manifest registers them

One `.teda` source file → one IR shard; a shard is never split across files, and multiple source
files are never merged into one shard. `manifest.json` does not follow the source file mapping; it
registers the shard paths and their hashes (D7).

Every shard carries `ir_version` and `source.file` (a path relative to the project root); `format`
records the language version of that source file. No absolute paths, no timestamps; the
`tool_version` in `manifest.json` is the tool's own version, not a time.

### D3. The tree is laid out by kind, and `source.file` maps it back

The shard layout does **not** mirror the project's own directories. The source tree is reorganised
for readers, the shard layout is an interface for tools, and the mapping between them is carried
by the `source.file` field every shard already has.

```
dist/ir/
├── manifest.json                     # shard paths + sha256 per shard + the project hash
├── boards/<board_id>/schematic.json  # the flattened logic of one board
├── boards/<board_id>/pcb.json        # the physical description of one board
├── boards/<board_id>/view/<page_id>.json  # the drawing of one page
├── symbols/<lib>/<symbol_id>.json
├── footprints/<lib>/<footprint_id>.json
├── components/<component_id>.json
├── boards/<board_id>/procurement.json              # the primary selections of one board
├── boards/<board_id>/procurement-alternatives.json  # the second sources of one board
├── project.json
└── systems/<system_id>.json
```

- A print page's drawing is its own description, so it is its own shard. It is **not** merged into
  the schematic shard — the schematic shard is the flattened logic, the view shard is a picture of
  one page, and the two have different readers. It is **advisory** (D7).
- The library kinds keep one shard per library file; the library name is the directory the file
  lives in. A library vendored under `external/libs/<name>/` and the project's own assets under
  `assets/` are distinguished by the library name in the shard path and by `source.file`.
- A selection is scoped to a board, so its shard is a **board** shard: the primary takes part in
  the board hash, and changing the part a board is built from invalidates that board's review. The
  primary is normative, the alternatives advisory.
- **The shard set is the project's content, not a reachability closure.** Every description file
  with a producer gets a shard, whether or not the build uses it: a device file no board and no
  procurement file references is still a shard, exactly as a symbol no component references would
  be. Because such a file is content, it must not be silent: `library.device-unused` (a warning)
  names every device nothing places and nothing selects, which is how a library stays curated once
  more than one author writes into it. The project hash therefore answers "which project is this",
  including its own library — not "which parts did this build use". A tree restricted to what is
  reachable is a different artifact (a build tree) and must not be mixed into this one, because
  then the same source file would be present or absent depending on a check that can fail, and a
  shard that disappears changes a hash for a reason that is not an edit.
- Because the layout is by kind, moving a source file between directories does not move a shard and
  does not change the project hash.

### D4. `texteda ir <project> [--out <dir>] [--json]` is the only writer

- The output directory defaults to `<project>/dist/ir`; `--out` points it elsewhere.
- It is a **project** command, not a board command: it compiles every description that has a
  producer, because the manifest and the project hash are project-level.
- **Nothing is written when the project has errors.** A half-written tree would carry a project
  hash that does not describe the project, and a hash that lies is worse than no hash. Warnings do
  not stop the write.
- Files under the output directory that the tree does not own are **pruned**: a deleted source file
  must not leave a stale shard behind, because a stale shard changes a hash.
- `--json` prints one machine payload on stdout (diagnostics, manifest, project hash, advisory
  hash, board hashes, shard list); otherwise a human summary goes to stdout. Diagnostics always go
  to stderr.

### D5. The IR holds one flattened representation

`schematic.json` contains **exactly one** `instances` and one `nets`, and their content is the
flattening result: an instance of a module is `M2.U1`, a net of a module is `M2.BOOT`, and a port
that a module binds to a board-level net is merged into that net **under the board-level name**.

The page structure is not a second netlist and is not stored: there are no pages in the IR, because
there are no pages in the language (see ADR-0111). A print page is a drawing, and it lives in its
own advisory shard (D3), not inside the schematic shard.

The corollary: **the namespaces of module-local nets and board-level nets are already merged in
the IR**, and IR consumers do not have to reimplement flattening.

### D6. Identity key = semantic name; renaming = delete + add

In the IR the identity of every instance, net, and port is its flattened name: instance `M2.U1`,
net `M2.BOOT`. No separate uuid is invented, and no separate "stable id" table is invented either.

Therefore **renaming changes the identity**. This conflicts with the rule that "the display name
may change, the ID does not", and is settled as follows: that rule asks for "the same design refers
to the same thing in every derivative", not for "you can still recognise it after the name
changed"; at the design level a rename is "the old component disappears, a new component appears",
and a diff tool that wants to show it as a rename has to do extra matching (outside the IR
contract).

The cost is explicit: rename → `source_hash` changes → all downstream artifacts are invalidated.
This is acceptable: a rename already forces a re-export and a re-review.

An instance may carry an explicit, immutable, project-local `uid` as well (see ADR-0109). It is a
column on the instance row, not a mapping layer, so the flattened name remains the display name and
the syntax used by existing references. This does not make a refdes rename hash-neutral:
`source_hash` still changes when the refdes changes.

### D7. Units: two kinds of fields, two notations

| Field kind | Notation | Source of the unit |
|---|---|---|
| Dimensioned geometry/physics/rule fields | The field name carries the unit suffix: `x_nm`, `rot_mdeg`, `thickness_nm`, `width_nm`, `impedance_mohm`, `er_ppm` | The suffix is the unit; reading the field tells you the unit |
| Component parameter values (`params`) | `{"name": "<param name>", "value": <integer>}` | Decided by the type declared in the `params` section of the component file |

Parameter type → IR unit:

| Parameter type | IR unit | Conversion |
|---|---|---|
| `resistance` | µΩ | 4R7 = 4.7 Ω = 4700000 |
| `capacitance` | fF | 100n = 100 nF = 100000000 |
| `inductance` | pH | 15u = 15 µH = 15000000 |
| `voltage` | µV | 3.3V = 3300000 |
| `current` | nA | 500mA = 500000000 |
| `power` | µW | 0.25W = 250000 |
| `frequency` | mHz | 8MHz = 8000000000 |
| `length` | nm | 0.5mm = 500000 |
| `temperature` | m°C | 85C = 85000 |
| `percent` | ppm | ±1% = 10000 |
| `integer` | 1 | — |
| `string` | — | goes through `{"name","text"}` |

- String parameters use the `text` field, mutually exclusive with the `value` field of numeric
  parameters; a parameter uses exactly one of the two.
- The impedance of geometry fields uses `_mohm` (90Ω = 90000), because `Ω` is not the smallest unit
  in which Ω is representable as an integer.
- Conversion happens at exactly two boundaries: when parsing `.teda`, and when exporting to the
  target format.

### D8. `source_hash`: computed per shard, aggregated per board and per project

- For each shard: `sha256` is computed over **the canonical JSON bytes that are written to disk** —
  the file's content is the hashed content, there is no second serialization step — and is recorded
  in the `shards` array of `manifest.json`.
- A board hash = `sha256` (of the board's shards' `<path>:<sha256>\n` sorted by path and
  concatenated); the project hash is computed the same way over all shards. Board and project
  hashes are **not written to disk**; they can be recomputed by this rule — which avoids two
  sources of truth where "the hash is stored but the content does not match".
- Derivative artifacts (Gerber, images, netlists) write `source_hash` (the project hash) + the
  board hash they belong to + `tool_version`.
- Incremental: change one source file and only that shard is recomputed; unchanged shards keep the
  same bytes and the same hash — this is the reason shards exist.

### D9. Shards are normative or advisory

Every shard is classified, and the manifest records the classification per shard as
`normative: true | false`, so a tool never has to infer it from a path.

- A shard is **normative** when it carries content that the build depends on — the design, the
  geometry, the primary selections.
- A shard is **advisory** when it carries content that no built artifact depends on — the
  procurement alternatives and **the print pages**.
- The classification is a property of the shard, and therefore of the source file it comes from:
  one source file produces one shard, and a shard has exactly one classification.
- The **project hash** is `sha256` over the `<path>:<sha256>\n` lines of the **normative** shards,
  sorted by path. The **advisory hash** is the same aggregation over the **advisory** shards. It
  is a second hash, with the same algorithm and the same shape, and it exists because a project has
  states that change without changing the build.
- A board hash is the same aggregation over that board's **normative** shards; the board's print
  pages are advisory, so the board hash is unaffected by a reviewer moving a label. A rendered page
  carries the page shard's own `sha256` as its `source_hash`.
- Both hashes are recomputable from the manifest alone. The board hashes are printed but not
  stored.

The claim the two hashes make is narrower than "this is the project", and the distinction is the
point:

> **A hash identifies a build, not the project's file set.** Two projects that differ only in
> advisory content are the same build and have the same project hash; their advisory hashes differ,
> and the difference is exactly what changed.

This is what lets a procurement decision — adding a second source for a part — be recorded, checked
and traced **without** invalidating an electrical review, a manufacturing package, or any artifact
carrying the project hash.

### D10. The boundary between IR and `project.toml`

- `project.toml` is the **human-written** entry point for project metadata; `project.json` is its
  IR projection, field for field (`name`/`version`/`format`/`description`/`license`/`status`/
  `default_variant`/`authors`/`links`/`boards`/`variants`/`compliance`/`ext`).
- **A library reference is not among them.** A library is a **template**: `texteda lib import`
  copies it into `assets/`, and from then on it is the project's own asset (see ADR-0133). The
  project describes itself; the libraries it borrowed live beside it as ordinary assets.
- IR does not copy source text, does not copy comments, does not copy canonical layout; IR stores
  semantics, and `source.file` exists only for traceability.

### D11. Three version numbers stay separate

`ir_version` (the shape of the IR contract), the language `format` (the syntax version of the
source file) and `tool_version` (the version of the tool that produced the bytes) answer three
different questions and are never derived from one another. `tool_version` is the repository's
`package.json` version; it is not a timestamp.

The language `format` is the single language version number, not a per-type line (see ADR-0101);
`ir_version` rises only when the IR shape changes, `format` only when the source syntax changes.
The two are not one-to-one.

### D12. The contract is JSON Schema only; the types are generated from it

The implementation is TypeScript, and the types are **generated from the JSON Schema** (direction:
Schema → TS). There is no hand-written schema type and no second validator: the schema is the
contract, and the generated types are the TypeScript view of it. A consistency test keeps the two
in step (see ADR-0104, D2).

## Consequences

- **The IR layer is a thing on disk that tools can read.** Exporters, the netlist writer and the
  Gerber writer can take a directory instead of re-deriving everything from the sources.
- **A project has two hashes.** The project hash covers the normative shards and identifies the
  build; the advisory hash covers the advisory shards and identifies the state of the content the
  build does not depend on. Artifacts carry the hash that matches what they were derived from, so
  a purchasing decision moves the purchasing chain and leaves the build chain alone.
- **The writer is a project command, so a single board is still compiled by `texteda compile`.**
  Two entry points exist on purpose: `compile` is a board-level debugging aid with per-diagnostics
  output, `ir` is the project-level producer of the tree.
- **Only one flattening**: the schema never carries two datasets, "in-page netlist + board-level
  netlist", and consumers cannot read two contradicting accounts; the cost is that the IR cannot
  show "which net name this page originally used" (only `source.file` can take you back there).
- **Identity is bound to the name**: renaming is expensive (all hashes change), but the IR stays
  simple, with no mapping layer.
- **Field names get longer** (`x_nm`, `rot_mdeg`): in exchange, reading the IR it is impossible to
  mistake mm for nm; it also avoids writing a "the unit is nm" comment for every numeric field in
  the JSON Schema.
- **Hashes come in three layers**: shards can be cached, a board can be traced individually, the
  project can be traced as a whole; the cost is that every consumer has to implement the three-line
  aggregation rule.
- **Constraint subjects get renamed during flattening**: the person writing `.teda` will not notice,
  but a reader of the IR has to know that `M2.VFB` originates from the module-local net `VFB`.
- **Rebuilding is not incremental yet.** The command recompiles every description; the shard layout
  is what makes incremental rebuilds possible, but the incremental logic is not written.
- **Accepting the shard rules closes the identity question** in `AGENTS.md` §11: renaming an
  instance or a net is a delete plus an add, and every hash changes with it.

## Follow-up

- Incremental rebuild: change one source file, rewrite one shard, keep the rest of the tree
  byte-identical.
- Whether the manifest should also record the language `format` and the schema `$id` per shard, so
  that a tool can self-check a tree that mixes versions.
- Whether downstream commands should read `dist/ir` instead of compiling in memory.
- Whether the geometry of `place`/`connect`/`trace` in the `pcb` shard should be **quantized to a
  fixed grid** — whether quantization is an exporter strategy or an IR invariant.
