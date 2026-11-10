# ADR-0002: One Language Version Number

Status: Accepted
Date: 2026-10-27
Scope: Decides: that the language has one version number, that additive language changes may take an explicitly recorded MINOR step while compatible clarifications take PATCH, and that each description type has a reader floor which may advance when an explicit breaking surface migration requires it. Does not decide: when the surface is frozen — `1.0` is reserved for that, see `spec/teda.md` §13.2.
Related: [ADR-0001](0001-fact-layer-has-no-expressions.md), [ADR-0006](../02-ir/0006-ir-shards-and-hashes.md), [ADR-0011](../03-project/0011-renumbering-is-a-code-executed-rename.md), [ADR-0041](../10-process/0041-documentation-has-one-authority-per-fact.md), [ADR-0055](../09-view/0055-schematic-fields-are-view-overrides.md), [ADR-0065](0065-a-coordinate-tuple-is-one-cell.md), [ADR-0068](../09-view/0068-reusable-module-drawings-and-sheet-templates.md)
Impact: `spec/teda.md` §13; `packages/parser/src/version.ts`; `scripts/migrate-0.9.ts`; `scripts/migrate-0.11.ts`; `examples/**`

## Background

The language version started at `0.1` and reached `0.6` in a few months, because every new
description type or section took a MINOR bump: `0.2` added `system`, `0.3` added `page`, `0.4`
added `pcb` and `footprint`, `0.5` added `symbol`, `0.6` added `view`.

Two things were wrong with that.

**The counter ran out too early.** `1.0` reads as "the language is stable and frozen", and it was
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

The first fix gave every description type its own version line: a type that did not exist yet
cannot have a file from before it, and a file declaring a version the tool does not implement is
refused. That bought two things, and only one of them survived.

The first is the floor: a `view` file claiming `0.5` is nonsense, and it is refused. That floor is
a fact about the type, and it does not depend on there being one line per type.

The second is the ceiling: a file that declares a version the tool does not implement is refused.
With nine lines, that meant a `symbol` file at `0.9` was refused, because the symbol surface had
not moved since `0.5`. With one number the ceiling has nothing left to say: the tool implements the
whole language up to that number, so a `symbol` file at `0.9` is a file it understands — symbols
included.

Meanwhile the discipline that kept the lines honest — a type's version moves in PATCH steps only —
was broken twice within days, when `schematic` and `module` took `0.8` → `0.9`. Nine lines, each
with its own discipline, is a discipline that will be broken again. The reference project carried
eleven distinct numbers across its `.teda` files, and even one type's line was not one number in
the tree: `component` was at `0.1.2` in some files and `0.1.5` in others.

The owner asked for one number, a changelog, and an explicit decision whenever an additive MINOR step is needed.

## Decision

### D1. The Version Is `MAJOR.MINOR[.PATCH]`

The patch component is optional and means zero when it is left out, so `0.6` and `0.6.0` are the
same version. The IR stores the canonical spelling: the patch component is omitted when it is zero.

Each position has one meaning, and the meaning is about **which files are accepted**:

| Position | Moves when | Means |
|---|---|---|
| MAJOR | the meaning of an existing construct changes, or a field / section is removed | the old files stop being valid; a migration note is required |
| MINOR | a description type, a section, or a field is added | the old files stay valid; a file may use the new construct only from this version on |
| PATCH | **the set of accepted files does not change**: a new diagnostic code, a reworded message, a clarified rule, a stricter check on files that were already invalid | behaviour changes, compatibility does not |

### D2. The Language Has One Version Number

Every `.teda` file declares the version of the language it was written against, and that number is
the same for all description types. `project.toml`'s `format` is that number, and the IR's `format`
field records it.

### D3. A Patch Never Breaks Compatibility

A tool that implements `MAJOR.MINOR` accepts **every** patch of it: the patch number is not part
of the acceptance decision. A file written against `0.6.1` reads correctly in a tool that only
knows `0.6` — that tool simply does not produce the diagnostics that `0.6.1` added.

### D4. The Acceptance Rule

A file is accepted when its version is a valid `MAJOR.MINOR[.PATCH]`, its MAJOR is the MAJOR the
tool supports, its MINOR is **not below the reader floor for its description type**, and its
MINOR is **not above the language version the tool supports**. The patch is ignored.

The reader floor is the oldest surface form that the current parser accepts for that type. It is
usually the language version that introduced the type, but it may be raised by a later breaking
surface rewrite. The `pcb` floor first advanced from its introduction at `0.4` to `0.7` when the
flat-board change rewrote its shape. The `view`, `pcb`, `symbol`, and `footprint` floors are now
`0.11`, because the coordinate-tuple rewrite changes their lexical surface. Other types retain
their earlier floors. These reader floors are maintained in `spec/teda.md` §13.1 and
`packages/parser/src/version.ts`; historical introduction versions remain separate facts.

The upper bound is the **language** version for every type, not the version at which the type last
changed. This matters: before this rule, the `symbol` parser refused anything above `0.5` and the
`schematic` parser refused anything above `0.3`, so a symbol file written today at the current
language version was rejected.

### D5. MINOR Requires an Explicit Decision; PATCH Covers Compatible Changes

Inside the `0.x` line, a change that does not alter the accepted file set is a PATCH. An additive
description type, section, or field is a MINOR when an explicit decision records the release; the
absence of such a decision is not permission to use a MINOR number. Therefore `0.10.0` is valid
when the decision that introduces its new construct says so, while an ordinary clarification or
diagnostic improvement remains a PATCH.

A removal needs a mechanism too. Before `1.0`, a removal requires an explicit decision, a migration
note, and a migration script; the old files may stop being valid only under that recorded decision.
After `1.0`, only PATCH releases follow and no new description types, sections, or fields may be
added.

### D6. `1.0` Is a Milestone, Not a Counter

Reaching `1.0` requires an explicit decision, recorded as a record of its own, meaning: the
language surface is frozen. After that only PATCH releases follow (`1.0.1`, `1.0.2`, …): no new
description types, no new sections, no new fields. A version number that runs out is not a reason
to ship.

`1.0` stays reserved. It means the surface is frozen (`spec/teda.md` §13.2), which needs the
ten-case corpus; the corpus is at four of ten (`docs/backlog.md` F12). The single-number merge is
not the freeze, and it does not spend the one number that means something.

### D7. One Version Module

`packages/parser/src/version.ts` owns the grammar, the comparison, the canonical spelling, and
the acceptance rule. Every description parser uses it, so the accepted grammar and the diagnostics
are the same everywhere. A malformed version is `format.invalid-version`; a version the tool cannot
handle is `format.unsupported-version`.

### D8. The IR Contract Version Is a Different Line

`ir_version` (the IR schema contract, the version under `schemas/ir/`) versions a different
artifact for a different audience: the people who implement the IR contract. It moves when the IR
moves, which is not the same event as a change to the source language. The changelog says when it
moved and why, so the two lines can be read together.

### D9. The Changelog Lives With the Language

`spec/teda.md` §13.4 is the changelog: newest first, one entry per version, saying what changed and
pointing at the record that decided it. A PATCH that changes nothing but diagnostics, wording, or a
stricter check of an already illegal file still gets an entry, because that is exactly the kind of
change a reader of the language wants to know about.

### D10. A Merge Only Widens What Is Accepted

Before the merge, `symbol` accepted `0.5` and nothing else; after, it accepts `0.5` through
`0.9.1`. Every type's accepted range is a superset of what it was, so no file that a current tool
accepts becomes refused. A merge is a widening, and that is what makes it safe to do while the
corpus is still incomplete.

### D11. Repository Files May Keep Older Compatible Versions

The repository's `.teda` files and `project.toml` files do not move in lockstep merely because the
language has a newer version. A file may keep an older accepted version when it uses only constructs
available at that version. For an additive construct, the parser gates its introduction version;
unrelated files need not move. A breaking surface rewrite may instead raise the reader floor for the
affected description types, in which case files of those types must migrate while other types keep
their prior floors. The IR shard records the source file's declared language version, so only shards
produced from changed source files acquire that format value and any resulting hash changes.

Any required migration is scoped to the affected construct and documented in `spec/teda.md` §13.4.
A migration script may rewrite the affected files and update `project.toml` when explicitly run, but
a release does not silently rewrite every `.teda` file or every project's `format` key.

## Consequences

- Once a version is out, a change that only adds diagnostics — a new readability check for the view
  layer, a warning about a column that was always ambiguous — is a PATCH, not a MINOR. MINOR stays
  reserved for actually adding language: a new description type, a new section, a new field.
- The parsers accept a file at the current language version. The upper bound is shared; each type
  keeps its reader floor, which can advance beyond its historical introduction after a breaking
  surface migration.
- The parser gets simpler: one number and nine floors. `packages/parser/src/version.ts` loses the
  per-type ceiling, and the type table keeps only the floor of each type.
- The one construct-level gate in the parser keeps its meaning. The instance UID column is allowed
  from `0.9` (`packages/parser/src/schematic.ts`), and it reads the same way after the merge — a
  file that says `0.9` or later may carry UIDs, a file that says `0.8` may not. Everywhere else the
  number bounds nothing, because the parser never checked constructs against the declared version:
  the safety net is that an unknown construct is an error (`AGENTS.md` §2, invariant 7), so a tool
  that does not know a construct stops instead of misreading the file.
- The cost: a file's number no longer says "which part of the language my type was at" — it says
  which generation of the language the file was written against. For a file written today the two
  are the same thing.
