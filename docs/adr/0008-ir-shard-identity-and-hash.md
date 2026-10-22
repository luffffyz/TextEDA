# ADR-0008: IR Sharding, Identity Keys, Units, and Hash Granularity

Status: Accepted
Date: 2026-10-20
Impact: `schemas/ir/v0.1/`; `AGENTS.md` §2 rule 18, §9; the four "follow-up" items in `docs/adr/0004-ir-representation.md`

Extended by [ADR-0023](0023-ir-layer-on-disk.md): the shard layout below is implemented on disk, and the writer (`texteda ir`) and the hash aggregation are specified there.

## Background

[ADR-0004](0004-ir-representation.md) settled the representation form (canonical JSON + JSON Schema contract) and left four things as "follow-up": file partitioning, `source_hash` granularity, the boundary between IR and `project.toml`, and the generation direction of zod. While writing the schema, three more problems surfaced that [ADR-0004](0004-ir-representation.md) does not cover but that directly determine the shape of the schema:

1. **Where flattening lives**. [ADR-0007](0007-page-internal-net-naming.md) says that after in-page net flattening a net is called `<page_instance_id>.<net>`. The IR is one file per board ([ADR-0004](0004-ir-representation.md) decision 4), so does it store the "page structure", the "flattened result", or both?
2. **Whether the identity key is just a name**. [ADR-0004](0004-ir-representation.md) decision 3 rule 6 says IDs use semantic IDs (`U1`, `net:GND`, `M1.R1.2`), while in the source code the handles of instances and nets are exactly the refdes and the net name — `net_id = the flattened net name` (`spec/pcb.md` §5.1) is already equal to "the ID is the name". This directly conflicts with `AGENTS.md` §2 rule 5, "the display name may change, the ID does not".
3. **The unit table is not enough**. [ADR-0004](0004-ir-representation.md) only gave a few integer fields (length nm, angle millidegree, ratio ppm, impedance Ω), but values like `4R7` = 4.7 Ω, `90Ω±10%`, and dielectric constant 4.3 are not representable under "integer Ω / integer ppm".

## Decision

### 1. Shards are 1:1 with source files, plus `manifest.json`

```
dist/ir/
├── manifest.json                  # shard manifest + hashes
├── project.json
├── components/<component_id>.json
├── boards/<board_id>/schematic.json
├── boards/<board_id>/pcb.json
└── systems/<system_id>.json
```

- One `.teda` source file → one IR shard; a shard is never split across files, and multiple source files are never merged into one shard.
- `boards/<board_id>/schematic.json` holds a whole board (board root + all pages) in one file, because the flattening result of [ADR-0007](0007-page-internal-net-naming.md) only holds at board level.
- `manifest.json` does not follow the source file mapping; it only registers shard paths and hashes (see decision 5).
- Every shard carries `ir_version` and `source.file` (a path relative to the project root); `format` records the language version of that source file (`0.1`–`0.4` coexisting is allowed, `teda.md` §13).
- No absolute paths, no timestamps ([ADR-0004](0004-ir-representation.md) rule 7); the `tool_version` in `manifest.json` is the tool's own version, not a time.

### 2. Flattening is the only representation; page structure is kept only as attributes

`schematic.json` contains **exactly one** `instances` and one `nets`, and their content is the flattening result of `teda.md` §7.7:

- Instance id: in-page `M2.U1`, board root `U1`; the `page` field appears only for in-page instances.
- net id: board-level nets use the board root name (`GND`, `SYS`); an in-page net not referenced by a port uses `M2.BOOT`; an in-page net referenced by a port is merged into the board-level net, **using the board-level name**.
- The `pages` section stores only the page instantiation relations (`id`/`page`/`file`), for paginated rendering and review navigation; it is not a second netlist.
- Ports land in IR as `ports`: a page `port` carries `page`, a board-level `port` does not.
- The subject of `constraints` follows the flattening rename (in the page it is `VFB`, after flattening it is `M2.VFB`; if it is `SYS`, after flattening it is still the board-level `SYS`).
- Corollary: **the namespaces of in-page nets and board-level nets are already merged in IR**, and IR consumers do not have to reimplement flattening.

### 3. Identity key = semantic name; renaming = delete + add

- In IR the identity of every instance, net, and port is its flattened name: instance `M2.U1`, net `M2.BOOT`. No separate uuid is invented, and no separate "stable id" table is invented either ([ADR-0004](0004-ir-representation.md) rule 6).
- Therefore **renaming changes the identity**. This literally conflicts with `AGENTS.md` §2 rule 5, and is settled as follows: rule 5 asks for "the same design refers to the same thing in every derivative", not for "you can still recognize it after the name changed"; at the design level a rename is "the old component disappears, a new component appears", and a diff tool that wants to show it as a rename has to do extra matching (outside the IR contract).
- The cost is explicit: rename → `source_hash` changes → all downstream artifacts are invalidated. This is acceptable: a rename already forces a re-export and a re-review.
- If in the future we want "rename without changing identity", the only clean way is to add an **explicit id column** to the `instances`/`nets` rows (a language change, v0.5 candidate), rather than adding a mapping layer inside IR. Open question.

### 4. Units: two kinds of fields, two notations

| Field kind | Notation | Source of the unit |
|---|---|---|
| Dimensioned geometry/physics/rule fields | The field name carries the unit suffix: `x_nm`, `rot_mdeg`, `thickness_nm`, `width_nm`, `impedance_mohm`, `er_ppm` | The suffix is the unit; reading the field tells you the unit |
| Component parameter values (`params`) | `{"name": "<param name>", "value": <integer>}` | Decided by the type declared in the `params` section of the component file |

Parameter type → IR unit (this covers the "impedance Ω" from [ADR-0004](0004-ir-representation.md)'s examples, which does not hold up):

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

- String parameters use the `text` field, mutually exclusive with the `value` field of numeric parameters; a parameter uses exactly one of the two.
- The impedance of geometry fields uses `_mohm` (90Ω = 90000), because `Ω` is not the smallest unit in which Ω is representable as an integer.
- Conversion happens at exactly two boundaries: when parsing `.teda`, and when exporting to the target format ([ADR-0004](0004-ir-representation.md) decision 3 unchanged).

### 5. `source_hash`: computed per shard, aggregated per board and per project

- For each shard: `sha256` is computed over **the canonical JSON bytes of that shard**, and is recorded in the `shards` array of `manifest.json`.
- Board hash = `sha256` (of the board's shards' `<path>:<sha256>\n` sorted by path and concatenated); the project hash is computed the same way over all shards. Board/project hashes are **not written to disk**; they can be recomputed by this rule — which avoids two sources of truth where "the hash is stored but the content does not match".
- **Amended (2026-10-22)**: the project hash aggregates the **normative** shards only, and a second hash, `advisory_hash`, aggregates the advisory shards with the same algorithm. The manifest records the classification per shard. See [ADR-0023](0023-ir-layer-on-disk.md) decision 4 and [ADR-0030](0030-procurement-layer.md) decision 12 for why the distinction exists.
- Derivative artifacts (Gerber, images, netlists) write `source_hash` (the project hash) + the board hash they belong to + `tool_version` (`AGENTS.md` §2 rule 11).
- Incremental: change one source file and only that shard is recomputed; unchanged shards keep the same bytes and the same hash — this is the reason shards exist.

### 6. The boundary between IR and `project.toml`

- `project.toml` is the **human-written** entry point for project metadata; `project.json` is its IR projection, field for field (`name`/`version`/`format`/`description`/`license`/`status`/`default_variant`/`authors`/`links`/`boards`/`variants`/`compliance`/`ext`).
- **`libs` is no longer among them.** A library reference is a dependency, and a dependency is a description in its own right: it is written as a `libref` file under `external/libs/` and compiles to its own shard ([ADR-0031](0031-project-tree-ownership-model.md) decision 5). `project.toml` describes the project; the libraries it borrows live beside it.
- IR does not copy source text, does not copy comments, does not copy canonical layout; IR stores semantics, and `source.file` exists only for traceability.
- `ir_version` and the language `format` are versioned independently: `ir_version` only rises when the IR shape changes, `format` only rises when the `.teda` syntax changes. The two are not one-to-one (a `0.4` language can produce `0.1` IR).

### 7. No zod for now

The implementation language is undecided (`AGENTS.md` §11 rule 13). Until it is chosen, the contract is **only** JSON Schema (`schemas/ir/v0.1/`, with `$id` being `urn:texteda:ir:<ir_version>:<name>`). If it lands on TS later, the types are generated from the JSON Schema (direction: Schema → TS), and the consistency test follows [ADR-0004](0004-ir-representation.md) decision 2.

## Consequences

- **Only one flattening**: the schema never carries two datasets, "in-page netlist + board-level netlist", and consumers cannot read two contradicting accounts; the cost is that the IR cannot show "which net name this page originally used" (only `source.file` can take you back there).
- **Identity is bound to the name**: renaming is expensive (all hashes change), but the IR stays simple, with no mapping layer. Wanting "rename without changing identity" means changing the language to add an explicit id column.
- **Field names get longer** (`x_nm`, `rot_mdeg`): in exchange, reading the IR it is impossible to mistake mm for nm; it also avoids writing a "the unit is nm" comment for every numeric field in the JSON Schema.
- **Hashes come in three layers**: shards can be cached, a board can be traced individually, the project can be traced as a whole; the cost is that every consumer has to implement the three-line aggregation rule. Since 2026-10-22 the project hash covers the normative shards and an `advisory_hash` covers the advisory ones, so a consumer that must distinguish "the build changed" from "the purchasing state changed" has two hashes to read.
- **Constraint subjects get renamed during flattening**: the person writing `.teda` will not notice, but a reader of the IR has to know that `M2.VFB` originates from the page net `VFB` being flattened.

## Follow-up

- Whether the geometry of `place`/`connect`/`trace` in the `pcb` shard should be **quantized to a fixed grid** (the "export boundary" pitfall in `AGENTS.md` §7) — whether quantization is an exporter strategy or an IR invariant is decided in the next round.
- Whether the language layer gets an explicit `id` column (rename without changing identity); once it does, `ir_version` rises by MINOR and old shards remain readable.
- Whether `manifest.json` should also record the `format` and the schema `$id` of each shard, so that tools can self-check in projects with mixed versions.
