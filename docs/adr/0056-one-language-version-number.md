# ADR-0056: One Language Version Number

Status: Accepted
Date: 2026-10-27
Related: [ADR-0022](0022-language-versioning.md), [ADR-0055](0055-documentation-has-one-authority-per-fact.md), [ADR-0025](0025-flat-board-and-print-pages.md), [ADR-0051](0051-instances-have-a-stable-project-local-uid.md)
Impact: `spec/teda.md` §13; `packages/parser/src/version.ts` and every parser that calls `typeRange`; `packages/cli/src/lib-import.ts`; `examples/**`; `scripts/migrate-0.9.ts`; `AGENTS.md` §2

## Background

Since [ADR-0022](0022-language-versioning.md)'s 2026-10-22 addendum, every description type carried its
own version line. A file was accepted when its number was between the version its type was born at and
the version its type was at now, and the nine lines were not comparable with each other: `symbol 0.5`
was not older than `procurement 0.9` (spec/teda.md §13.1).

The system bought two things, and only one of them survived.

The first is the floor: a type that did not exist yet cannot have a file from before it. A `view` file
claiming `0.5` is nonsense, and it is refused. That floor is a fact about the type, and it does not
depend on there being one line per type.

The second is the ceiling: a file that declares a version the tool does not implement is refused. With
nine lines, that meant a `symbol` file at `0.9` was refused, because the symbol surface had not moved
since `0.5`. With one number the ceiling has nothing left to say: the tool implements the whole
language up to that number, so a `symbol` file at `0.9` is a file it understands — symbols included.

Meanwhile the discipline that kept the lines honest — a type's version moves in PATCH steps only — was
broken twice within days, when `schematic` and `module` took `0.8` → `0.9` (recorded in
[ADR-0022](0022-language-versioning.md)'s 2026-10-27 addendum). Nine lines, each with its own
discipline, is a discipline that will be broken again. The reference project carries eleven distinct
numbers across its 100 `.teda` files, and even one type's line is not one number in the tree:
`component` is at `0.1.2` in some files and `0.1.5` in others.

The owner asked for one number, PATCH-only changes from here, and a changelog.

## Decision

**D1. The language has one version number.**

Every `.teda` file declares the version of the language it was written against, and that number is the
same for all description types. `project.toml`'s `format` is that number, and the IR's `format` field
records it.

**D2. The floor stays per type; the ceiling is the single number.**

A type that did not exist before a version has no files from before it: `procurement` is born at `0.9`,
so a `procurement` file claiming `0.3` is refused, and so is a `symbol` file claiming `0.4`. The floor
is the oldest version of that type the tool still reads, which for every type is the version it was
introduced in, with one exception: `pcb` was introduced at `0.4` and the flat-board change rewrote
its shape at `0.7`, so its floor is `0.7`. The floor is a fact about the type, not about the file's
age.

**D3. The merge only widens what is accepted.**

Before, `symbol` accepted `0.5` and nothing else; after, it accepts `0.5` through `0.9`. Every type's
accepted range is a superset of what it was, so no file that a current tool accepts becomes refused.
The merge is a widening, and that is what makes it safe to do while the corpus is still incomplete.

**D4. The merge takes the language to `0.9.1`, and from here the version moves in PATCH steps only.**

The merge is a change to the contract — it changes what a tool accepts — so it gets a version of its
own, and it gets a PATCH because it widens the accepted set instead of narrowing it. The next change
is `0.9.2`. This is [ADR-0022](0022-language-versioning.md)'s A2 rule, now applied to one line
instead of nine, and it is cheap to keep when there is one number to discipline. A MINOR step inside
the `0.x` line is a decision that needs a record.

A removal needs a mechanism too, and the PATCH bit is it: inside the `0.x` phase a removal rides the
PATCH bit with a migration note and a script, which is what the `0.x` entries already do. What
[ADR-0022](0022-language-versioning.md) decision 6 allowed — a removal before `1.0`, announced — stays
allowed; only the bit that carries it changes. The rule that a PATCH never breaks compatibility
belongs to the line after `1.0`, where PATCH is the only bit that moves.

**D5. `1.0` stays reserved.**

`1.0` means the surface is frozen (spec/teda.md §13.2), which needs the ten-case corpus; the corpus is
at four of ten (docs/backlog.md F12). The merge is not the freeze, and it does not spend the one
number that means something.

**D6. The changelog lives with the language, and every version gets an entry.**

spec/teda.md §13.4 is the changelog: newest first, one entry per version, saying what changed and
pointing at the record that decided it. A PATCH that changes nothing but diagnostics, wording, or a
stricter check of an already illegal file still gets an entry, because that is exactly the kind of
change a reader of the language wants to know about.

**D7. The IR contract version is a different line, and is not merged.**

`ir_version` (the IR schema contract, the version under `schemas/ir/`) versions a different artifact
for a different audience: the people who implement the IR contract. It moves when the IR moves, which
is not the same event as a change to the source language. The changelog says when it moved and why, so
the two lines can be read together.

**D8. The repository's own files move to the single number.**

The 100 `.teda` files under `examples/` and the `format` key of the five `project.toml` files become
`0.9.1`. The shards change with them (the `format` field), so the hashes change and the case goldens
are regenerated. Because the contract layer is public, the mechanical part also gets a script:
`bun run migrate:0.9 <project dir>` rewrites the version line of every `.teda` file and the `format`
key of `project.toml`; it renames nothing else, because a renumbering is a renumbering.

## Consequences

The parser gets simpler: one number and nine floors. `packages/parser/src/version.ts` loses the
per-type ceiling, and the type table keeps only the floor of each type.

The accepted set grows, and only grows. Every file that parses today still parses, and a file that
declares a version the tool does not implement is still refused: `0.10` is refused for every type, as
`1.0` is.

The one construct-level gate in the parser keeps its meaning. The instance UID column is allowed from
`0.9` (`packages/parser/src/schematic.ts`), and after the merge it reads the same way — a file that
says `0.9` or later may carry UIDs, a file that says `0.8` may not. Everywhere else the number bounds
nothing, because the parser never checked constructs against the declared version: the safety net is
that an unknown construct is an error (AGENTS.md §2 invariant 7), so a tool that does not know a
construct stops instead of misreading the file.

The reference project stops being a museum of eleven numbers, and the `component` line stops being
three numbers in one tree.

The cost: a file's number no longer says "which part of the language my type was at" — it says which
generation of the language the file was written against. For a file written today the two are the same
statement. For an old file the number is old and the content is old, and the tool reads it as before.

The changelog grows inside the spec. When it outgrows the chapter it becomes a file of its own; until
then, keeping it here means the contract and its history are read together.

## Alternatives considered

**Keep the per-type lines and add a changelog.** Rejected: the lines are what the owner asked to
remove, and the discipline behind them has already slipped twice
([ADR-0022](0022-language-versioning.md)'s 2026-10-27 addendum). A changelog on top of nine lines is a
changelog of nine lines.

**Merge to `1.0`.** Rejected: `1.0` is the frozen surface (spec/teda.md §13.2), the surface is not
frozen, and the corpus is at four of ten. Spending the one number that means something on a claim the
project cannot make is how `1.0` stops meaning anything.

**Merge to `0.10`.** Rejected: `0.10` would claim ten releases of the language; there was one.
[ADR-0022](0022-language-versioning.md)'s 2026-10-22b appendix froze the `0.x` counter at `0.9`
exactly so that the number would not pretend to count.

**Merge the IR contract version as well.** Rejected: different artifact, different audience, different
trigger. The language version moves when the source surface moves; the IR contract version moves when
the IR moves. The two lines have moved together so far, but they are not the same fact.

**Drop the per-type floor too.** Rejected: a `procurement` file claiming `0.3` would be accepted, and
procurement did not exist then. The floor is a fact about the type, and it survives the merge.

**Remove the version line.** Rejected: the version line is how a future tool refuses a file it cannot
read, and the contract layer is public — a third-party implementation needs a way to say "this is
newer than I understand".
