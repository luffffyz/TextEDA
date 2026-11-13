# ADR-0066: Symbol and Footprint Shards Record the Source Language Version

Status: Accepted
Date: 2026-11-08
Scope: Decides: that `symbol` and `footprint` IR shards carry a required normalized language `format`, and that this additive contract change is published as IR contract `v0.16` while `v0.15` remains unchanged. Does not decide: any new language syntax or a migration that reconstructs a missing source-language version from an old compiled shard.
Related: [ADR-0067](../09-view/0067-hierarchical-module-views-and-custom-page-size.md)
Impact: `schemas/ir/v0.16/`; `packages/parser/src/symbol.ts`; `packages/parser/src/footprint.ts`; generated IR types and reference; `spec/symbol.md`; `spec/footprint.md`

## Background

The IR shard convention requires a language `format` alongside the independent `ir_version`. Most current shard kinds already record it, but `symbol` and `footprint` do not. A consumer reading either shard therefore cannot tell which language version produced the source description.

The language version is already checked and normalized by the parser. `0.11` and `0.11.0` are equivalent source spellings, and the canonical IR spelling omits a zero patch component. The missing field is an IR shape defect, not a language change.

## Decision

1. The field is named `format`, matching the other shard kinds. It references the common `format_version` definition and is required at the root of both shard types.
2. The symbol and footprint parsers emit the normalized value returned by version checking. They do not derive it from `ir_version`.
3. Adding a required field changes the closed IR contract, so the complete current schema set is published under `schemas/ir/v0.16/`. The existing `schemas/ir/v0.15/` directory is retained unchanged for consumers of the old contract.
4. `ir_version` and language `format` remain independent: `ir_version` identifies the JSON shape, while `format` identifies the source language version.
5. No automatic migration is provided for an old symbol or footprint JSON shard that lacks `format`. That value is not recoverable from the old shard alone; regeneration from the original `.teda` source is the truthful migration. Source `.teda` files do not need a syntax migration.

## Consequences

New symbol and footprint shards are self-describing and validate against the `v0.16` contract. Third-party readers can inspect language compatibility without guessing from the IR contract version. Consumers that intentionally support `v0.15` continue to receive the unchanged old contract; current generation and parser output use `v0.16`.

The generated TypeScript types and reference documentation must be regenerated from `v0.16`. Contract fixtures must cover the required and canonical `format` field for both shard types.

## Alternatives rejected

- **Make `format` optional:** preserves the inconsistency and leaves newly produced shards ambiguous.
- **Reuse `ir_version` as the language version:** conflates two independent compatibility questions and makes the shard contract misleading.
- **Guess a language version for old JSON:** invents provenance that the old shard does not contain.
