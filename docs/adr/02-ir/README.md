# IR — decisions

## Scope

The typed intermediate representation: the three layers it is made of, how it is sharded and hashed, and what a device's description contributes to it.

## Not here

- The language the IR is compiled from — [ADR-0001](../01-language/0001-fact-layer-has-no-expressions.md).
- What a device may state — [ADR-0025](../07-devices/0025-device-vocabulary-and-parameter-roles.md).

## Reading order

1. [0005](0005-ir-representation.md) — the IR is one model, one contract, one serialization.
2. [0006](0006-ir-shards-and-hashes.md) — the IR is a tree of shards, and a hash is a tree of hashes.
3. [0007](0007-device-description-enters-the-ir.md) — a device's description is a fact, so it is a shard.

## Records

| Record | Title | Status | Date |
|---|---|---|---|
| [ADR-0005](0005-ir-representation.md) | IR Representation (Semantic Model / Contract / Serialization) | Accepted | 2026-10-20 |
| [ADR-0006](0006-ir-shards-and-hashes.md) | IR Sharding, Identity Keys, and Hashes | Accepted | 2026-10-21 |
| [ADR-0007](0007-device-description-enters-the-ir.md) | A Device's Description Is a Fact, So It Enters the IR | Accepted | 2026-10-23 |
