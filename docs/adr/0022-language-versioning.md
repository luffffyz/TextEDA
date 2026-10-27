# ADR-0022: Language Versioning — MAJOR.MINOR.PATCH, and 1.0 as a Milestone

Status: Accepted
Date: 2026-10-21
Impact: `teda.md` §5, §13; `packages/parser` (a new `version` module, and every description parser now uses it); `schemas/ir/v0.2/common.schema.json` (`format_version`); `AGENTS.md` §2

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

Before `1.0`, a MINOR may also **remove** a construct: the `0.x` line is unstable by definition, and
the removal is announced with a migration note and a script (decision 6). MAJOR is then reserved for
the `1.0` semantic freeze, where the language surface stops moving.

### 2. A Patch Never Breaks Compatibility

Therefore a tool that implements `MAJOR.MINOR` accepts **every** patch of it: the patch number is
not part of the acceptance decision. A file written against `0.6.1` reads correctly in a tool that
only knows `0.6` — that tool simply does not produce the diagnostics that `0.6.1` added.

### 3. The Acceptance Rule

Amended by the 2026-10-22 addendum below: the upper bound is **per description type**, not one language version.

A file is accepted when its version is a valid `MAJOR.MINOR[.PATCH]`, its MAJOR is the MAJOR the
tool supports, its MINOR is **not below the version that introduced the description type**, and its
MINOR is **not above the language version the tool supports**. The patch is ignored.

The upper bound is the **language** version, not the version at which the type last changed. This
matters: before this record, the `symbol` parser refused anything above `0.5` and the `schematic`
parser refused anything above `0.3`, so a symbol file written today at the current language version
was rejected. The lower bound is the version that introduced the type: a `view` file cannot declare
`0.5`, and a `page` file cannot declare `0.2`.

### 4. `1.0` Is a Milestone, Not a Counter

Extended by the 2026-10-22 addendum below: the types converge to `1.0` in one step, and there is one version number from then on.

Reaching `1.0` requires an explicit decision, recorded as an ADR, meaning: the language surface is
frozen. After that only PATCH releases follow (`1.0.1`, `1.0.2`, …): no new description types, no
new sections, no new fields. A version number that runs out is not a reason to ship.

### 5. One Version Module

`packages/parser/src/version.ts` owns the grammar, the comparison, the canonical spelling, and the
acceptance rule. Every description parser uses it, so the accepted grammar and the diagnostics are
the same everywhere. A malformed version is `format.invalid-version`; a version the tool cannot
handle is `format.unsupported-version`.

### 6. Before `1.0`, a MINOR May Remove

The `0.x` line is unstable by definition: nothing promises that a `0.x` file stays valid, and
`1.0` is the release that freezes the surface. Waiting for `1.0` before removing anything would
mean carrying dead constructs — and their diagnostics, their schemas and their tests — for the sake
of a stability promise the project has not made yet.

So, before `1.0`:

- a MINOR may **remove** a construct (a description type, a section, a field) as well as add one;
- the removal must come with a **migration note** (what changed, how to migrate, with an example)
  and a **migration script** where the change is mechanical;
- the affected files must be raised to the new MINOR when they use the new surface; a file that
  still uses the removed construct must fail with a diagnostic that names the removal and points at
  the migration note — not with a generic "unknown construct";
- the IR contract version moves independently, when the IR's own shape changes
  ([ADR-0008](0008-ir-shard-identity-and-hash.md)).

The first use of this decision is [ADR-0025](0025-flat-board-and-print-pages.md): language `0.7`
removes the `page` description type and the `pages` section, and moves the IR contract to `0.2`.
MAJOR remains the language version of the `1.0` freeze; after `1.0` only PATCH releases follow.

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
- `schemas/ir/v0.2/common.schema.json`'s `format_version` accepts the three-part form and the `1.x`
  line, so the IR contract does not have to change when the language freezes.
- The IR contract version (`ir_version`, currently `0.2`) stays independent from the language
  version: the IR's own shape is versioned separately, and this record does not change that.
- Existing files keep their meaning up to `0.6`. The first break is `0.7`, where the page mechanism
  is removed ([ADR-0025](0025-flat-board-and-print-pages.md)); it comes with a migration note and a
  migration script, as decision 6 requires.

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

## Addendum (2026-10-22): one version line per description type, converging to a single number at 1.0

Amends decision 3 and decision 4.

### A1. Each description type carries its own version line

The `version` a file declares is the version of **its own description type**, not the minimum
version of one shared language. The numbers in flight today are four:

| Type | Version | Type | Version |
|---|---|---|---|
| `schematic` | 0.8 | `pcb` | 0.4 |
| `view` | 0.7 | `footprint` | 0.4 |
| `symbol` | 0.5 | `system` | 0.2 |
| `component` | 0.1 | `module` | 0.8 |

The acceptance rule becomes per type. A file is accepted when its version is well formed, its
MAJOR equals the MAJOR the tool supports **for that type**, its MINOR is not below the version
that introduced the type, and its MINOR is not above **that type's current version**. The patch
is ignored, as before.

The reason is the drawing surface. A drawing grows on its own schedule — arcs, text boxes,
dimensions, bus rendering — and under one shared number every one of those bumps the circuit's
language number, so the story of "what changed in 0.9" starts carrying drawing churn, and a
circuit file's version moves for a reason that has nothing to do with the circuit.

### A2. During the `0.x` phase, a type's version moves in PATCH steps only

`schematic 0.8` becomes `schematic 0.8.1`. Adding a section or a field does **not** bump MINOR
during this phase; the four numbers are maintained as they are.

This is safe because the number was never the compatibility mechanism. The mechanism is the rule
that an **unknown construct is an error** (`AGENTS.md` §2 invariant 7): a tool that does not know
a construct says so and stops, rather than misreading the file. The version is a marker for
readers and for the convergence, not the thing that keeps files interpretable.

The cost, stated plainly: while the line is `0.x`, a reader cannot tell from the version alone
whether a file uses a construct introduced later — they find out from the diagnostic. That is
acceptable on a line that is unstable by definition (decision 6), and it is exactly what the
convergence in A3 repairs.

### A3. The convergence: one number, once, at `1.0`

When the project is close to done, every description type moves to a single version `1.0` in one
step, recorded by an ADR. From that moment there is **one version number for the whole
language**, the surface is frozen (decision 4), and only PATCH releases follow.

The proposed trigger for the convergence: no pending breaking or additive surface change for any
description type, and the conformance corpus exists (`docs/backlog.md` F12). The ten hard cases
are the evidence that the surface has stopped moving — a language whose cases still move is not
ready to be frozen.

Before the convergence, the four numbers are maintained as they are, and each moves only in
PATCH steps.

## Addendum (2026-10-22b): `1.0` is reserved, and the `0.x` numbers may be renumbered

Amends decisions 1 and 4, and addendum A2. The question this answers is: *the counter is at 0.9
and every new description type used to push it up — what stops the language from reaching 1.0 by
counting, and what happens to the numbers if they get ugly?*

### A4. The `0.x` counter stops at `0.9`, and `1.0` is reserved

The counter is frozen at the value it has when this addendum is adopted (`0.9`, the generation in
which the `procurement` type was added). From then on:

- a **new description type is born at the current generation**, i.e. `0.9` — the counter does not
  move for it;
- each description type's own version line moves in **PATCH steps only** (addendum A2), so the
  lines in flight (`schematic 0.8`, `view 0.7`, `symbol 0.5`, `component 0.1`, `pcb 0.4`,
  `footprint 0.4`, `system 0.2`, `module 0.8`, `procurement 0.9`) are frozen at those values;
- **`1.0` is never produced by counting.** It is reserved for the convergence of A3, which needs
  an explicit ADR and its trigger: no pending surface change for any type, and the conformance
  corpus exists (`docs/backlog.md` F12).

The numbers therefore stop being a countdown. `0.9` is not "almost 1.0"; it is the last
pre-freeze generation, and the language is as far from `1.0` as the corpus is.

The numbers are **per type and are not comparable across types**: `symbol 0.5` and
`procurement 0.9` do not say that one type is older than the other, and `view 0.7` does not mean
"three features behind `symbol 0.5`". What a number says is *which generation this type's surface
belongs to*, and the acceptance rule uses it as the type's lower and upper bound.

### A5. After `1.0`, a surface change is a new MAJOR, so `1.1`–`1.9` never appear

Decision 4 says that after `1.0` only PATCH releases follow. It did not say what happens if the
surface really has to change then, and the version grammar has no room for it: a MINOR would
contradict the freeze, and a PATCH cannot change the accepted file set.

So the path is stated here: **a change to the surface after `1.0` is a new MAJOR (`2.0`)**, with
the migration note and the migration script that decision 6 requires. The `1.x` line is therefore
`1.0`, `1.0.1`, `1.0.2`, … and nothing else. `1.4` is not a version this language will have.

### A6. During `0.x`, the version numbers may be renumbered

The `0.x` line promises nothing: decision 6 says a MINOR may even remove a construct, with a
migration note and a script. A **renumbering** is the same kind of change — the numbers are
markers, and the mechanism that keeps files interpretable is the rule that an unknown construct is
an error (`AGENTS.md` §2 invariant 7), not the number (addendum A2).

So a renumbering is allowed before `1.0`, and its blast radius is bounded and mechanical:

| Where the number appears | What a renumbering touches |
|---|---|
| The `version` line of every `.teda` file | the source files, and a migration script for the mechanical part (like `bun run migrate:0.7`) |
| The `format` field of a shard | the IR bytes, and therefore every hash and artifact derived from them |
| The type → version table in `packages/parser/src/version.ts` | the acceptance function's bounds |
| The documentation | `teda.md` §13, the spec files, the decision records |

After `1.0` there is no renumbering: the whole meaning of `1.0` is the freeze, and renumbering
would withdraw the promise that the version makes. Only PATCH follows.

### Consequence for the language today

Nothing has to be renumbered: the `0.9` generation is the current one, and `procurement` was born
in it. What changes is the rule that would have carried the counter past `0.9`, and the two holes
this addendum closes — how the language is supposed to change its surface after `1.0`, and what
happens to the numbers before `1.0` if they stop being convenient.

## Addendum (2026-10-27): A2 and A4 were not followed — two lines took a MINOR step

A2 says that during `0.x` a type's own version "moves in PATCH steps only", and A4 freezes the
numbers then in flight at those values. Both statements were overtaken within days by records that
did not cite this one, and neither statement has a pointer to what replaced it. Recording it here so
that the rule and the practice are not read as consistent when they are not.

- **A1's table (lines 155-159) and A4's list (lines 213-215) are stale.** They name `schematic 0.8`,
  `module 0.8`, `pcb 0.4`, `component 0.1`, `symbol 0.5`, `footprint 0.4`, `view 0.7`,
  `system 0.2`. Today: **`schematic 0.9`, `module 0.9`, `pcb 0.7` (and `0.7.1`), `component 0.1.7`,
  `symbol 0.5.1`, `footprint 0.4.2`, `view 0.7`, `system 0.2`, plus `procurement 0.9`**. The live
  table is `spec/teda.md` §13.1; the chronology of each move is `teda.md` §13.4.
- **The MINOR step.** `schematic` and `module` moved `0.8` → `0.9` when the `uid` column landed
  ([ADR-0051](0051-instances-have-a-stable-project-local-uid.md)). Under A2 that should have been a
  PATCH (`0.8.1`); the move was recorded in `spec/teda.md` §13.4 and in ADR-0051, and neither record
  nor this one carried a pointer between the two. The `pcb` line also moved `0.7` → `0.7.1`
  ([ADR-0035](0035-connectivity-authority-and-reverse-engineering.md) amendment of 2026-10-23),
  which is a PATCH and consistent with A2.
- **What is actually true today.** Each type still has its own line, the global counter still stops
  at `0.9`, `1.0` is still reserved, and a tool accepts a file whose MINOR is between the type's
  birth version and the type's current version (`packages/parser/src/version.ts`). The PATCH-only
  rule of A2 held for `footprint`, `symbol` and `component`; it did not hold for `schematic` and
  `module`.
- **Why this is recorded rather than reverted.** A2 is a convention about discipline, not a
  compatibility guarantee — no reader of a file can tell whether its type got there by PATCH or by
  MINOR, because the acceptance rule (decision 3, as amended) reads the file's own declared number.
  Reverting `schematic`/`module` to `0.8.1` would invalidate every source file written since. The
  next surface change on those two types should therefore either take a PATCH or carry an explicit
  pointer here; silently repeating the MINOR step is what this addendum is meant to prevent.

## Addendum (2026-10-27b): the per-type lines are retired — one number for the whole language

[ADR-0056](0056-one-language-version-number.md) supersedes A1, A2, A3 and A4. The language has one
version number, every description type declares it, and it moves in PATCH steps only.

- **What survives.** Decision 1 (the form `MAJOR.MINOR[.PATCH]`, PATCH omittable), decision 2 (a PATCH
  never breaks compatibility, and the acceptance rule ignores the PATCH bit), decision 4 (`1.0` is a
  milestone, not a counter), decision 5 (one version module) and decision 6 (before `1.0` a MINOR may
  remove a construct, with a migration note and a script) all stand as written.
- **What is superseded.** A1 (one line per description type), A2 (a type's version moves in PATCH
  steps — now it is the language's version), A3 (the convergence happens once, at `1.0` — it happened
  now) and A4 (the `0.x` counter stops at `0.9` and the per-type numbers in flight are frozen — the
  per-type numbers are gone).
- **The renumbering A6 allowed happened.** The language is at `0.9.1`; every `.teda` file says
  `0.9.1`; the accepted range of a type is from the version it was born at to the language's current
  version. The mechanical part is `bun run migrate:0.9 <project dir>`.
- **The addendum of 2026-10-27 is now history.** Its subject was a MINOR step on two of nine lines.
  There is one line now, and it moves in PATCH steps.
