# ADR-0022: Language Versioning — MAJOR.MINOR.PATCH, and 1.0 as a Milestone

Status: Accepted
Date: 2026-10-21
Impact: `teda.md` §5, §13; `packages/parser` (a new `version` module, and every description parser now uses it); `schemas/ir/v0.1/common.schema.json` (`format_version`); `AGENTS.md` §2

## Background

The language version started at `0.1` and reached `0.6` in a few months, because every new
description type or section took a MINOR bump: `0.2` added `system`, `0.3` added `page`, `0.4`
added `pcb` and `footprint`, `0.5` added `symbol`, `0.6` added `view`.

Two things are wrong with that.

**The counter runs out too early.** `1.0` reads as "the language is stable and frozen", and it was
going to arrive as a side effect of counting rather than as a decision. A language that is still
gaining description types every few weeks cannot honestly claim `1.0`.

**Most of the churn was never a language change.** Adding a diagnostic code, rewording a message,
clarifying what a column means, or implementing a check that was already specified does not change
which files are legal. Under the old scheme those changes had nowhere to go but MINOR, so MINOR
stopped meaning "the accepted file set grew" and became "something happened".

There was also a concrete inconsistency to fix: the version grammar was re-implemented in five
parsers, with three different regular expressions and two different diagnostic codes for the same
mistake. `packages/parser/src/schematic.ts` used `/^(\d+)\.(\d+)$/`, `symbol.ts` and `view.ts` used
`/^0\.([1-9][0-9]*)$/`, and `pcb.ts` reported a malformed version as `format.unsupported-version`
while the others reported `format.invalid-version`.

## Decision

### 1. The Version Is `MAJOR.MINOR[.PATCH]`

The patch component is optional and means zero when it is left out, so `0.6` and `0.6.0` are the
same version. The IR stores the canonical spelling: the patch component is omitted when it is zero.

Each position has one meaning, and the meaning is about **which files are accepted**:

| Position | Moves when | Means |
|---|---|---|
| MAJOR | the meaning of an existing construct changes, or a field / section is removed | the old files stop being valid; a migration note is required |
| MINOR | a description type, a section, or a field is added | the old files stay valid; a file may use the new construct only from this version on |
| PATCH | **the set of accepted files does not change**: a new diagnostic code, a reworded message, a clarified rule, a stricter check on files that were already invalid | behaviour changes, compatibility does not |

### 2. A Patch Never Breaks Compatibility

Therefore a tool that implements `MAJOR.MINOR` accepts **every** patch of it: the patch number is
not part of the acceptance decision. A file written against `0.6.1` reads correctly in a tool that
only knows `0.6` — that tool simply does not produce the diagnostics that `0.6.1` added.

### 3. The Acceptance Rule

A file is accepted when its version is a valid `MAJOR.MINOR[.PATCH]`, its MAJOR is the MAJOR the
tool supports, its MINOR is **not below the version that introduced the description type**, and its
MINOR is **not above the language version the tool supports**. The patch is ignored.

The upper bound is the **language** version, not the version at which the type last changed. This
matters: before this record, the `symbol` parser refused anything above `0.5` and the `schematic`
parser refused anything above `0.3`, so a symbol file written today at the current language version
was rejected. The lower bound is the version that introduced the type: a `view` file cannot declare
`0.5`, and a `page` file cannot declare `0.2`.

### 4. `1.0` Is a Milestone, Not a Counter

Reaching `1.0` requires an explicit decision, recorded as an ADR, meaning: the language surface is
frozen. After that only PATCH releases follow (`1.0.1`, `1.0.2`, …): no new description types, no
new sections, no new fields. A version number that runs out is not a reason to ship.

### 5. One Version Module

`packages/parser/src/version.ts` owns the grammar, the comparison, the canonical spelling, and the
acceptance rule. Every description parser uses it, so the accepted grammar and the diagnostics are
the same everywhere. A malformed version is `format.invalid-version`; a version the tool cannot
handle is `format.unsupported-version`.

## Consequences

- Once `0.6` is out, a change that only adds diagnostics — a new readability check for the view layer, a
  warning about a column that was always ambiguous — is a PATCH (`0.6.1`), not a MINOR. MINOR stays
  reserved for actually adding language: a new description type, a new section, a new field.
- The parsers no longer refuse a file that declares the current language version: a `symbol` file at
  `0.6` and a `schematic` file at `0.6` are accepted. The upper bound is the language version the
  tool supports; the lower bound is the version that introduced the type.
- The version number in the IR (`format`) is canonical, so `0.6` and `0.6.0` compile to byte-identical
  IR — the "IR depends on semantics only" rule (AGENTS.md §2, invariant 18) keeps holding. The
  `symbol` and `footprint` shards carry no `format` field at all, so they are unaffected either way
  (see the backlog).
- `schemas/ir/v0.1/common.schema.json`'s `format_version` accepts the three-part form and the `1.x`
  line, so the IR contract does not have to change when the language freezes.
- The IR contract version (`ir_version`, currently `0.1`) stays independent from the language
  version: the IR's own shape is versioned separately, and this record does not change that.
- Existing files are unaffected: `0.1` … `0.5` keep their meaning, and no file in the repository
  needs a version bump.

## Alternatives Rejected

**Keep `MAJOR.MINOR` and slow down.** The only way to make `1.0` meaningful under the old scheme
is to stop shipping, which is not a versioning scheme. The old scheme also has no place for the
changes that dominate a young language: a diagnostic registry that grows by design
([ADR-0016](0016-diagnostic-error-codes.md)) means every new check is a MINOR bump by accident.

**Make PATCH part of the IR contract version too.** The IR version answers "is this shard's shape
still the one I understand"; the language version answers "which constructs may this file use". They
are different questions, and coupling them would force an IR migration for every clarification.

**Treat PATCH as always-incompatible (a tool must know the exact patch).** That contradicts the
definition: a patch does not change the accepted file set, so refusing it would be refusing a file
the tool can read correctly. It would also make the number useless for the audience that matters
most — third-party implementations that lag behind by a few patches.

**Make the patch component mandatory (`0.6.0`).** It would make the grammar uniform but would force
every existing file to change, for no gain: the patch number is only meaningful when it is not zero.
