# ADR-0046: A Vendored Library Is Verified by Its Hash

Status: Accepted (superseded by ADR-0047)
Date: 2026-10-24
Related: [ADR-0031](0031-project-tree-ownership-model.md), [ADR-0028](0028-library-trust-and-derived-overrides.md), [ADR-0023](0023-ir-layer-on-disk.md), [ADR-0008](0008-ir-shard-identity-and-hash.md), [ADR-0018](0018-zero-dependency-and-manufacturing-target.md), [ADR-0027](0027-device-parts-families-and-library-dependencies.md), [ADR-0037](0037-device-kind-vocabulary-and-one-device-directory.md)
Impact: `spec/libref.md` (new); `spec/teda.md` §2, §4.2, §7.1; `schemas/ir/v0.11/` (the `libref` shard, `device_ref`); `packages/parser` (the `libref` parser, the device-reference grammar, the resolver's ambiguity hook); `packages/cli` (library discovery, resolution, the `lib add` writer, the shard tree); `scripts/verify-libs.ts`; `docs/backlog.md` F29; `AGENTS.md` §4.5, §9, §10

> **Superseded by [ADR-0047](0047-an-external-library-is-a-template-not-a-dependency.md)** (2026-10-24). An external library is a template that is copied into `assets/` once; the project does not consume a vendored tree, so there is no content hash to verify. The copy/rewrite half of this record survives as `texteda lib import`; the hash half is withdrawn.

## Background

[ADR-0031](0031-project-tree-ownership-model.md) decided the shape of a dependency: a `libref`
description (`external/libs/<name>.toml`), a **vendored** library beside it
(`external/libs/<name>/`), and library assets that become normative shards. It did not decide what
happens when the vendored copy and the anchor disagree — and it is the disagreement that decides
whether the anchor is worth anything.

Two failure modes made the question concrete.

**The silent fork.** A vendored tree is a directory of ordinary files. Anyone with a text editor can
"just fix" a pin name, a pad size, or an electrical type in it. Nothing about the directory says
whether it is still the revision the anchor names; the build reads whatever is there and the
manifest happily records a hash of the modified result. The reviewer sees a green build and a
library nobody upstream would recognise.

**The moving pin.** `rev = "main"` is not a revision. A vendored copy taken from a branch describes
a moment, not a state, and the next person cannot tell which moment. The same text can describe two
different libraries a month apart.

There is a third, quieter one: **the unverified copy that is not a dependency at all** — a directory
someone dropped into `external/libs/` without an anchor. It is in the tree, it is read by the
build, and nothing records where it came from.

## Decision

### 1. The anchor carries the hash of the tree it pins

A `libref` states `content_hash`: SHA-256 over the vendored subtree, computed by a public rule so a
third party with another implementation can recompute it:

1. every **regular file** under `external/libs/<name>/`, keyed by its **library-relative** path
   (`/` separators);
2. the SHA-256 of each file's bytes;
3. the lines `path:sha256\n`, sorted by path in ASCII byte order, joined;
4. the SHA-256 of that text, written as `sha256:<hex>`.

Library-relative paths are the point: moving the project does not change the hash, editing one byte
does. Symlinks are not followed and empty directories do not enter it — a library that depends on
files outside itself cannot be vendored.

### 2. The anchor is normative

`dist/ir/librefs/<name>.json` is a normative shard and enters the project hash. Which revision the
project builds against is part of the design, not a local preference: two trees that differ only in
the pinned revision must not share a build identity, or a manufacturing package could be traced to
the wrong library.

The rule is the one [ADR-0023](0023-ir-layer-on-disk.md) decision 4 already applies to every
normative shard, so nothing new enters the hash computation — what changes is that the library's
identity stops being invisible.

### 3. Verification happens at every build entry, and it is an error

Every command that reads the project verifies the tree against its anchor. A mismatch is an
**error** (`ref.library-unverified`), not a warning, and the copy is not silently used as if it were
fine. Three states are errors, because each means the build cannot say what it was made of:

| State | Code |
|---|---|
| The tree does not match the anchor | `ref.library-unverified` |
| The anchor pins a directory that does not exist | `ref.library-unverified` |
| A directory under `external/libs/` has no anchor | `ref.library-unpinned` |

The files of an unverified library are still **read**. This is deliberate: if an unverified library
contributed nothing, every board placing its devices would report "component not found", and the
real cause — one line in one anchor file — would be buried under a hundred consequences. One error
per library says where to look.

`texteda ir` already writes no shard while any error stands, so a tampered tree produces no
manifest; the gate needs no new mechanism.

### 4. A revision is immutable

`rev` must be a tag or a commit hash. A missing `rev`, or a branch name (`main`, `master`, `head`,
`develop`, `trunk`, `latest`, case-insensitive) is `value.libref-unpinned`. A branch moves, and a
vendored copy of a branch is a copy of an unnamed state.

Vendoring is the step that reads the revision, and it takes it from the person
(`texteda lib add <name> --from <dir> --rev <tag>`), not from a guess: a `.git` directory in the
source is not a source of truth for what the copy is.

### 5. The vendored tree is read-only in practice

A needed fix goes upstream, or becomes a **project-owned override**: a device written under
`assets/components/` with the same id, which shadows the library's ([ADR-0028](0028-library-trust-and-derived-overrides.md)).
The library's copy then has no referrer and the anchor keeps pinning what the library actually
says. Editing the vendored file is not a third option: it is the silent fork, and the hash exists
to make it visible.

There is no separate read-only enforcement (no permissions, no CI job diffing the tree against
upstream). The hash is the enforcement: a modified tree fails the build, and the message names both
the anchor and the tree.

### 6. One writer for the hash

`texteda lib add` is the only thing that writes `content_hash`, and it computes it from what it just
copied. A hash a person types is a hash that says whatever the person wanted; a hash a tool measures
from the bytes on disk is a fact.

The same command is the only vendoring path, and it **does not reach the network**: it copies a
directory that already exists. Cloning at the pinned tag is the caller's step, so no gate in this
repository needs a network ([ADR-0018](0018-zero-dependency-and-manufacturing-target.md),
invariant 20).

### 7. Qualified device references, and resolution order

A vendored device is named `<lib>:<id>` — the same `<lib>:` form symbols and footprints already use.
The form is accepted **wherever a device is named** (schematic and module `instances` rows,
procurement rows), because a reference one description accepts and another rejects would make a
device reachable from one place and not from another.

Resolution, in order:

1. a qualified id resolves strictly inside that library;
2. a bare id resolves to the project's own asset first;
3. otherwise exactly one vendoring library providing it is enough;
4. two libraries providing it → `ref.id-ambiguous` **at the reference site**, with the qualified
   spellings as the hint;
5. nothing provides it → `ref.unknown-component`.

Rule 4 is where the specification earns its keep: a bare id is a name, and a name that could mean
two devices is not a name. The fix is a qualifier, not a rename — which is why the qualifier had to
be expressible at the reference in the first place.

Consequence for the contract: the schematic's `instance.component` was `$defs.slug`, which cannot
express a colon. It is now `$defs.device_ref`, and the IR contract moved to **v0.11**. This is a
shape change of one field, so it is a MINOR move ([ADR-0008](0008-ir-shard-identity-and-hash.md)
decision 5), and old shards stay readable for tools that only know the bare form.

## Consequences

- A build can be **reproduced from the tree alone**, and a reviewer can recompute the library's
  hash with `sha256sum` and a sort — no tool of ours required.
- A dependency's revision is now part of the project hash. Re-vendoring at a new tag is a design
  change with a visible identity, not a background refresh.
- The anchor is a new **description** the parser owns (a `libref` shard, a `libref` parser), and it
  is TOML: it has no version header and no per-type language line, exactly like `project.toml`.
- Library assets become shards of the effective library — devices at
  `components/<lib>/<id>.json`, geometry at `symbols/<lib>/<id>.json` /
  `footprints/<lib>/<id>.json` — while the source tree keeps them under `external/libs/`
  ([ADR-0031](0031-project-tree-ownership-model.md) decision 9: the shard layout is by kind).
- `library.device-unused` stays scoped to the project's own devices: a vendored library is curated
  upstream and pinned as a whole, and listing its unused devices would drown the one warning that is
  about this project.
- The library gate (`bun run lib:verify`) accepts a reference into a vendored library only when the
  tree verifies; the reference-project gate is unchanged, because that project has no
  `external/libs/` at all.

## What this does not decide

- **Transitive dependencies.** One anchor per library, one revision, one tree. A library that needs
  another library is vendored as two libraries.
- **Fetching.** No command in this repository downloads a library; `source` is provenance, not a
  location the build reads from. A `lib add --from <url>` form is a later decision, and it will be
  the caller's network, never a gate's.
- **Signatures.** Attribution and verification here are content-based, not identity-based
  ([ADR-0033](0033-review-records-and-attribution.md): no signatures, version control gives
  attribution).
