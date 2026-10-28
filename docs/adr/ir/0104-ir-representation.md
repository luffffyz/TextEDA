# ADR-0104: IR Representation (Semantic Model / Contract / Serialization)

Status: Accepted
Date: 2026-10-20
Scope: Decides: the three-layer separation of the IR, canonical JSON as the on-disk form, and JSON Schema as the sole contract. Does not decide: how the IR is sharded and hashed — see ADR-0105.
Related: [ADR-0100](../language/0100-fact-layer-has-no-expressions.md), [ADR-0103](../language/0103-source-spans.md), [ADR-0105](0105-ir-shards-and-hashes.md), [ADR-0106](0106-device-description-enters-the-ir.md), [ADR-0123](../devices/0123-the-device-kind-is-part-or-generic.md)
Impact: `schemas/ir/**`; `packages/ir/src/**`; `spec/teda.md` §12

## Background

`AGENTS.md` §2 item 1 says only "the IR is the single source of truth"; it does not specify what the IR looks like, how it is exchanged, or how it is hashed. Three hard requirements around it already point at the same question:

1. **Renderers and exporters are separate programs**. The renderer only reads the IR (§2 item 3), and must be independently implementable by third parties (§10 conformance). This requires a stable, cross-language, cross-process representation, otherwise "let others implement your renderer" is just a slogan.
2. **Artifacts must be traceable** (§2 item 11): exported Gerber/images/netlists carry `source_hash + tool_version`. `source_hash` must be computable **byte-reproducibly** for the same design, otherwise traceability is meaningless.
3. **Conformance golden files** (§10): the golden files for `source → IR → netlist` must be human-readable, diffable, and generatable and comparable by implementations in different languages.

At the same time, three constraints narrow the options:

- **A parser with zero runtime dependencies by default is the goal** (§12) — a self-made binary format is immediately out.
- **Invariant 5: every element has a stable ID**, which diffing and incremental updates depend on — serialization must carry stable IDs.
- **Scale** (§7 known pitfall): the IR grows with the component count, and the agent cannot work from the whole IR. So the IR's representation is meant **for the toolchain**, not for the agent to read directly.

`AGENTS.md` §9 already writes `schemas/  # IR's JSON Schema / zod definitions (machine-readable)` into the target structure, which settles the direction as the JSON family; but "who owns the contract", "whether serialization must be canonical" and "which units numbers use" are still undecided.

## Decision

### 1. Three-layer separation

| Layer | Content | Ownership |
|---|---|---|
| Semantic model | Typed in-memory objects | Implemented separately in each language, **not a file format** |
| Contract | The definition and constraints of the IR | **JSON Schema 2020-12** (`schemas/`) |
| Serialization | On-disk, hashing, exchange | **JSON**, and it must be canonical |

"The IR is the single source of truth" speaks of **semantics**, not of a file format. The semantic model may never be written to disk at all; as soon as it must be cross-process, cross-language and hashable, there must be a canonical textual projection.

### 2. JSON Schema is the sole contract

- `schemas/ir/<version>/<name>.schema.json` is the only published contract, with `$id` of the form `urn:texteda:ir:<version>:<name>`.
- Schemas must be **closed**: `additionalProperties: false`, exhaustive enums, every field annotated with dimension and unit, optionality explicit. A schema that is not closed equals no contract.
- **zod is only an implementation detail on the TypeScript side**, not the contract. Reason: zod cannot be consumed directly by Python, Rust or C++, and the goal of conformance is precisely to let implementations in different languages validate each other.
- When both exist (`schemas/` holding both JSON Schema and zod), **they must be driven by the same set of conformance cases, with consistency tests**: for the same inputs, the verdicts of zod and JSON Schema must be identical. Otherwise the two definitions drift, and drift does not raise errors.

### 3. Serialization uses canonical JSON

Rules (to be written into `AGENTS.md` and the `schemas/` documentation):

| # | Rule |
|---|---|
| 1 | UTF-8 without BOM; LF; exactly one newline at end of file |
| 2 | Object keys sorted by ascending Unicode code point; key names in ASCII `snake_case` |
| 3 | **Integers only**: lengths in nm, angles in millidegrees (1/1000°), ratios in ppm, impedance in Ω |
| 4 | **Floats are forbidden** — floats are the number one source of JSON diff jitter and hash instability |
| 5 | Absent fields are **omitted** (no `null`); empty collections are omitted; adding a new field leaves the hash of old IR unchanged |
| 6 | Enums use strings; IDs use semantic IDs (`U1`, `net:GND`, `M1.R1.2`), **never uuid** |
| 7 | No timestamps, absolute paths or random IDs (same rule as `project.toml`, for reproducibility) |
| 8 | Free text uses an optional `note` field (JSON has no comments; this is the substitute) |
| 9 | `source_hash` = SHA-256(canonical JSON bytes) |

**Inside the IR everything uses SI sub-unit integers** (nm / millidegree / ppm). Unit conversion happens only at two boundaries: when parsing a `.teda` file in, and when exporting to a target format. Having "mm or nm?" inside the IR is a design error.

### 4. On-disk layout

Sharded by description, mirroring the split-file structure of `.teda`, and avoiding a single file of hundreds of MB:

```
dist/ir/
├── project.json
├── components/<component_id>.json
├── boards/<board_id>/schematic.json
├── boards/<board_id>/pcb.json
└── systems/<system_id>.json
```

- Renderers and exporters read files from `dist/ir/` by default (convenient for incremental debugging and diffing); they may also read a single JSON document from stdin.
- Writing to disk must be **byte-reproducible**: the same source + the same tool version → byte-identical IR.

### 5. The agent does not read the IR directly

The agent's working surface is the `.teda` source + check reports + on-demand queries. The full IR JSON only appears in the toolchain and in golden files. The "scale" pitfall of `AGENTS.md` §7 is thereby contained: IR growth hits disk, not context.

### 6. When to re-evaluate the representation

Only if one of the following holds do we reconsider the representation:

- a single IR file > 100 MB → switch to CBOR + streaming processing;
- sub-millisecond deserialization is needed → switch to a binary format;
- C++ must read it with zero dependencies → then let the C++ side read canonical JSON, or go through an IPC protocol.

Even then we **do not use Protobuf / Cap'n Proto**: fixed field numbers freeze schema evolution, and the cost exceeds the benefit.

## Consequences

- **One more mapping layer of code**: every implementation must write a "model ↔ JSON" layer. In exchange: cross-language, cross-process, readable, diffable, zero dependency.
- **Larger than binary**: canonical JSON is noticeably redundant. The IR does not go into version control (`dist/` is a derivative), so size is not a problem.
- **Units converge**: the IR only has nm/millidegree/ppm, so implementations cannot get "mm or nm" wrong; the cost is that each implementation must convert at the boundaries.
- **Schema evolution has a cost**: a closed schema means adding a field also means bumping the version (consistent with the language version rules: adding a field = MINOR, changing semantics = MAJOR). Forward compatibility relies on an explicit switch (`--allow-unknown`), not on a lax schema.
- **The risk of dual zod / JSON Schema definitions is made explicit**: it is backstopped by consistency tests rather than by "careful maintenance".

## Follow-up

> The four items below are closed out by `docs/adr/0008-ir-shard-identity-and-hash.md` (2026-10-20): file partitioning, `source_hash` granularity, the boundary with `project.toml`, the zod direction. The original text is kept here as decision background.

- The file partitioning of `schemas/ir/v0.1/` and its correspondence to `project` / `components` / `schematic` / `pcb` / `system`.
- The concrete generation direction between zod and JSON Schema (JSON Schema → TS types, or zod → JSON Schema), derived from the requirement of consistency tests.
- The granularity of `source_hash`: one hash for the whole IR, or per description / per board (incremental builds and caches need the latter).
- The boundary between the IR and `project.toml` metadata (`format` version, library locking): what goes into the IR and what stays in the project file.
