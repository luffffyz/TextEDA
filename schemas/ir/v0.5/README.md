# IR v0.5 — contract notes

This is the **only** contract for the TextEDA IR: JSON Schema 2020-12. The semantic model and on-disk layout are in `docs/adr/0004-ir-representation.md`; sharding, identity keys, units and hash granularity are in `docs/adr/0008-ir-shard-identity-and-hash.md`; TS types are generated from this directory with no zod, see `docs/adr/0009-implementation-stack.md`.

## Files and `$id`

| File | `$id` | Corresponding source |
|---|---|---|
| `common.schema.json` | `urn:texteda:ir:0.5:common` | none (shared `$defs`) |
| `project.schema.json` | `urn:texteda:ir:0.5:project` | `project.toml` |
| `component.schema.json` | `urn:texteda:ir:0.5:component` | `assets/components/**/<id>.teda` |
| `schematic.schema.json` | `urn:texteda:ir:0.5:schematic` | `design/sch/<board_id>.teda` |
| `pcb.schema.json` | `urn:texteda:ir:0.5:pcb` | `design/pcb/<board_id>.teda` |
| `system.schema.json` | `urn:texteda:ir:0.5:system` | `system/<system_id>.teda` |
| `symbol.schema.json` | `urn:texteda:ir:0.5:symbol` | `assets/symbols/<lib>/<id>.teda` |
| `footprint.schema.json` | `urn:texteda:ir:0.5:footprint` | `assets/footprints/<lib>/<id>.teda` |
| `schematic-view.schema.json` | `urn:texteda:ir:0.5:schematic-view` | `views/<board_id>/<page_id>.view.teda` |
| `manifest.schema.json` | `urn:texteda:ir:0.5:manifest` | none (`dist/ir/manifest.json`) |

Every schema is **closed** (`additionalProperties: false`) with exhaustive enums. Unknown fields are rejected outright, never downgraded to warnings.

## Serialization

Canonical JSON, per [ADR-0004](../../../docs/adr/0004-ir-representation.md) decision 3: UTF-8 without BOM, LF, exactly one trailing newline; keys sorted by code point; `snake_case`; **integers only**; no `null`, no empty collections, no timestamps or absolute paths; `source_hash = SHA-256(canonical bytes)`.

## Units

The field-name suffix is the unit (`_nm`, `_mdeg`, `_mohm`, `_uv`, `_na`, `_uw`, `_mhz`, `_mdegc`, `_ppm`). For device parameter values (`params[].value` and `ratings[].value`) the integer unit comes from the declared parameter type (`resistance`→µΩ, `capacitance`→fF, `inductance`→pH …). The full conversion table is [ADR-0008](../../../docs/adr/0008-ir-shard-identity-and-hash.md) decision 4.

## Testing

```sh
bun install
bun run gen        # generate packages/ir/src/generated from this directory (schema + TS types)
bun run gen:check  # compare only: fail if generated artifacts drift from the schemas (used in CI)
bun test           # contract positive/negative fixtures + type-level assertions
bun run typecheck
```

- Every fixture in `tests/schemas/valid/<schema name>/` must pass and every fixture in `tests/schemas/invalid/<schema name>/` must fail (run by `packages/ir/test/contract.test.ts`).
- Runtime validation consumes these schema files with Ajv — **there is no second validation implementation**. TS types are generated from the schemas (`packages/ir/scripts/generate.ts`); the generated output is never hand-edited.
- Fixtures prove the schema is self-consistent, not that the parser is correct; `source → IR` golden files land together with the parser.
