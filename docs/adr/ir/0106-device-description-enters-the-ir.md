# ADR-0106: A Device's Description Is a Fact, So It Enters the IR

Status: Accepted
Date: 2026-10-23
Scope: Decides: that a device description is a fact and therefore enters the IR as a shard. Does not decide: what a device may state — see ADR-0124.
Related: [ADR-0104](0104-ir-representation.md), [ADR-0123](../devices/0123-the-device-kind-is-part-or-generic.md), [ADR-0124](../devices/0124-device-vocabulary-and-parameter-roles.md)
Impact: `schemas/ir/**`; `packages/ir/src/**`; `spec/teda.md` §6

## Context

The `component` parser has accepted a `description` scalar since [ADR-0123](../devices/0123-the-device-kind-is-part-or-generic.md) landed, and footprints carry the same field. Two things were missing around it:

1. **The spec did not list it.** `spec/teda.md` §6.1 enumerates the scalars a device file may write, and `description` was not among them — a field the parser accepted and the spec did not describe.
2. **The IR could not hold it.** The `component` shard had no `description` property, so the value would have been dropped the moment a shard was produced.

Those two facts only became load-bearing when the `component` shard got a producer ([backlog](../../backlog.md) F24). Until then the field lived in the parser's result and nowhere else, so nothing noticed. With a producer, the choice is explicit: either the field enters the contract, or the parser stops accepting it.

## Decision

**A device's description is a fact of the device and enters the IR, and the IR contract version rises.**

1. `component.description` is an optional string on the shard body: one line of human prose ("RISC-V microcontroller, 144 MHz, 256 KB flash").
2. **It never participates in a check and never changes identity.** The id is still the file name ([ADR-0105](0105-ir-shards-and-hashes.md) decision 3); changing a description changes the shard bytes and therefore the project hash, exactly as changing a comment does not — the description *is* content, not a comment.
3. **The IR contract version rises** because the shard's shape changed. [ADR-0105](0105-ir-shards-and-hashes.md) decision 3 rule 7 is explicit that `ir_version` rises when the IR shape changes, and the contract directory follows the version. This is the same move as [ADR-0125](../devices/0125-a-part-states-its-own-ratings.md) made when `ratings` arrived. The version number itself is recorded in `schemas/ir/` and is not pinned here.
4. The spec lists the field (`spec/teda.md` §6.1) with the same boundary: prose only, no check, no identity.

## Alternatives

- **Stop accepting `description` in `component` files.** It keeps the IR at `0.7`, but removes syntax that files may already use, which is a MAJOR language change ([ADR-0101](../language/0101-one-language-version-number.md)) — more disruptive than a MINOR IR bump, and it makes the component type poorer than the footprint type, which has carried a description all along.
- **Keep accepting it and drop it on the way to the IR.** The cheapest change and the worst outcome: the IR would silently lose a fact the source states, which is precisely what "the IR is the only source of truth" (`AGENTS.md` §2 rule 1) forbids. A reader of the tree could not tell whether a device has no description or whether the producer lost it.
- **Map it onto the shard's `note`.** `note` is the substitute for a comment ("free text about this run of the tool"), not a fact of the device. Overloading it would make two different things share one key.

## Consequences

- The IR contract moves by a version, and every shard carries the new `ir_version`; schemas, generated types, the contract reference and the fixtures move with it. The contract version is a single fact, recorded in `schemas/ir/`. There are no third-party implementations to migrate.
- The component shard now carries everything the language lets a device file say. The producer is in `packages/cli`, and every device file of the reference project compiles into `components/<id>.json`.
- A device shard is **normative**: a board is made of these parts, so a changed device changes the build identity. The same rule that classifies a print page as advisory ([ADR-0134](../view/0134-the-view-layer-is-a-drawing.md)) puts the device on the other side.
- **Hashes computed before this change are not comparable with those computed after it.** The component shard is
  normative, so the shard set the project hash aggregates grew by one entry per device (24 in the reference project),
  and the component bodies themselves changed shape. This is a discontinuity, not a bug: a hash is only meaningful
  against the shard set it was computed from, and the manifest lists that set. Nothing in the wild depends on the old
  values yet.
- `pins_source` becomes visible in the shard (`inline` today). When the third-party symbol path lands, this is where the second source will show up, and no version bump will be needed to say so.
- Descriptions are prose in the contract, so they are written in English like every other source string (`AGENTS.md` §12).
