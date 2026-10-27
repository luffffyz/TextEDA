# ADR-0046: A Vendored Library Is Verified by Its Hash

Status: Accepted (superseded by ADR-0047)
Date: 2026-10-24
Related: [ADR-0031](0031-project-tree-ownership-model.md), [ADR-0028](0028-library-trust-and-derived-overrides.md), [ADR-0023](0023-ir-layer-on-disk.md), [ADR-0008](0008-ir-shard-identity-and-hash.md), [ADR-0018](0018-zero-dependency-and-manufacturing-target.md), [ADR-0027](0027-device-parts-families-and-library-dependencies.md), [ADR-0037](0037-device-kind-vocabulary-and-one-device-directory.md)
Impact: `spec/libref.md` (new); `spec/teda.md` §2, §4.2, §7.1; `schemas/ir/v0.11/` (the `libref` shard, `device_ref`); `packages/parser` (the `libref` parser, the device-reference grammar, the resolver's ambiguity hook); `packages/cli` (library discovery, resolution, the `lib add` writer, the shard tree); `scripts/verify-libs.ts`; `docs/backlog.md` F29; `AGENTS.md` §4.5, §9, §10

> **Retired 2026-10-27 by [ADR-0047](0047-an-external-library-is-a-template-not-a-dependency.md).**
> This record pinned a vendored library to a content hash and re-verified it at every build entry.
> Nothing in it applies: there is no vendored tree under `external/libs/`, no `libref` description
> type, and no hash of copied bytes — an external library is a template copied into `assets/` once
> ([ADR-0047](0047-an-external-library-is-a-template-not-a-dependency.md)). The decision text is in
> this file's history.
