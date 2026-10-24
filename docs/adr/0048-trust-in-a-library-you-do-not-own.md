# ADR-0048: Trust in a Library You Do Not Own Is a Consumer Record

Status: Accepted
Date: 2026-10-24
Related: [ADR-0047](0047-an-external-library-is-a-template-not-a-dependency.md), [ADR-0046](0046-vendored-libraries-are-verified-by-their-hash.md), [ADR-0028](0028-library-trust-and-derived-overrides.md), [ADR-0027](0027-device-parts-families-and-library-dependencies.md), [ADR-0016](0016-diagnostic-error-codes.md)
Impact: `docs/guides/library-import.md` §3; `packages/cli` (`lib import --trust`, a trust-table reader); `AGENTS.md` §4.5.1

## Background

[ADR-0047](0047-an-external-library-is-a-template-not-a-dependency.md) moved review out of files and
into a record beside the library: a library root carries `library.toml`, one `[[trust]]` entry per
revision, listing the ids a human compared with their sources. `lib import --rev` reads that entry
and stamps the copies. One review act, many consuming projects, no per-file woodgrain.

That shape assumes the reviewer and the library have the same owner. The common case in an
organisation is the opposite: the library belongs to somebody else — an upstream or "official"
library that will never carry a manifest in our TOML subset — and the **consumer** is the party that
looked. Today that act has nowhere to be written. A project either edits each copy's `provenance`
line by hand (per project, per file, and it contradicts nothing it can point at), or it re-reviews
in every new project. The first is bookkeeping that goes stale; the second is the multiplication
ADR-0047 was written to avoid.

Two facts bound the problem:

- **A copy is still required.** The build reads `assets/` and nothing else (ADR-0047 decision 1), so
  a project that uses a device owns a copy of it. What a consumer-side record removes is not the
  copy but the *re-review*: the copy arrives already vouched for, attributed to whoever vouched.
- **A vouching act is about a revision, not about bytes we can watch.** [ADR-0046](0046-vendored-libraries-are-verified-by-their-hash.md)
  hashed vendored trees; that machinery is withdrawn and this record does not bring it back. "We
  looked at X@rev and it was right" is a statement, and the sentence names its revision, its date and
  its author — which is what makes it checkable by a reader, not by a hash.

## Decision

### 1. The record lives on the consumer's side, and the importer is told where it is

`texteda lib import <name> --from <dir> --rev <rev> --trust <file>` reads a **consumer trust
table**: a file the consumer organisation maintains, covering any number of libraries, outside the
project tree. It is not discovered: there is no default path, no environment variable, no search
under `assets/` or `external/`. The operator names it, and the copies carry the result.

The file never enters the build. The claim it produces does: `provenance` is a component field
([ADR-0047](0047-an-external-library-is-a-template-not-a-dependency.md) decision 5), so a reviewed
copy is a different IR shard and a different project hash. That is correct — whether a device was
vouched for is part of the design state, not a caching detail — and it is why the policy file only
has to exist on the machine that runs the import.

### 2. Same rows as a library manifest, plus the library name — and no whole-library form

```toml
[[trust]]
library    = "vendor"
by         = "tz"
on         = "2026-10-24"
components = ["tps7a02@2.1.0"]
symbols    = ["tps7a02@2.1.0"]
footprints = ["sot-23-5@2.0.0"]

[[trust]]
library    = "kicad-passives"
by         = "tz"
on         = "2026-10-24"
components = ["res-thick-0402@9.0.2", "cap-mlcc-0402@9.0.2"]
```

- `library` is mandatory: one file covers several upstream libraries, and an entry that does not say
  which one is ambiguous. It must equal the `--from` library name being imported.
- A row is one **act** — who checked, on which day — and each item names `id@rev`, the revision the
  verification was of ([ADR-0049](0049-a-file-carries-its-own-revision.md) decision 3). One act
  covering files from several releases is one row, so `by` / `on` are written once per act rather
  than once per revision.
- Review is per group (`components` / `symbols` / `footprints`), as in a library manifest: listing a
  device does not vouch for its geometry.
- A row lists the items it covers. An entry that lists none is an error: it would vouch for nothing.
- Unknown keys, a missing `by` / `on`, a mistyped date, the same `(library, id, rev)` stated twice
  with different attribution, and an id the library does not provide all refuse the import and write
  nothing.

**There is deliberately no "whole library" form.** A flag meaning "everything at this revision" was
considered and removed: it made one row claim coverage wider than the act behind it. Two different
states would have collapsed into it — "I compared all of these with their sources" (then the ids
are known, and listing them is mechanical) and "I did not look, but I will ship it anyway" (then no
row is the honest answer, and the copies stay `generated` with the disclaimer header). The second
state is a policy about a board, not a fact about a library, and this format records facts about
libraries. Deciding to accept unreviewed material belongs to the review record
([ADR-0033](0033-review-records-and-attribution.md)) or to the process, where it can carry a reason
([ADR-0034](0034-manufacturing-output-target-form.md) decision 6).

### 3. The two records compose; a disagreement is a conflict

Both records are keyed by revision, so one import can see two candidate statements. They do not
override each other:

- **Ids one record covers and the other does not**: both apply. A consumer may vouch for ids the
  library did not sign — a board-specific acceptance, or a review the library's maintainer never did.
- **The same id at the same revision with different attribution**: an **error**. Two people cannot
  be the author of one act, and the importer will not silently pick one. A human resolves it by
  fixing whichever record is wrong.
- The origin header names the record that decided, file by file, so a reader can tell them apart.

The earlier draft of this decision let the consumer's entry win outright, on the reasoning that an
upstream library cannot overrule the organisation importing it. That case is covered without
discarding an attribution: a conflicting claim is a defect in one of the two files, and hiding it
behind a precedence rule is how a record stops being trustworthy.

### 4. The record is a statement, not a gate

Nothing at build time consults it. There is no hash of the copied bytes and no post-import
verification — [ADR-0046](0046-vendored-libraries-are-verified-by-their-hash.md) stays withdrawn. A
copy edited after the import cannot hide behind the table: the claim `check` reads is the one written
in the file that holds the facts, and the header above it is dated.

The friction that remains is deliberate: a new revision needs a new entry. A record that carried
forward to revisions nobody looked at would be worse than no record
([ADR-0047](0047-an-external-library-is-a-template-not-a-dependency.md) decision 5 —
an unattributable `reviewed` is worse than an absent one).

### 5. It is not a asset, and it does not live in the project

The table is organisation policy about libraries the organisation does not own. Putting a copy in
each project would create a second source that goes stale in one of the copies, which is the failure
[ADR-0047](0047-an-external-library-is-a-template-not-a-dependency.md) removed when it deleted
vendoring. A project that wants to record *its own* judgement about a specific device edits that
device's `provenance` line — that is what the line is for, and it is visible in the diff.

### 6. Attribution is a field, not a commit

`by` and `on` stay in the row. They are not delegated to the repository that holds the table, even
though that repository's pull requests and commit history are an excellent record of who did what.

The reason is where the claim has to work: `lib import` turns a row into `provenance reviewed` plus
`verified_by` / `verified_on` **inside a copy**, and the copy leaves the repository. It lands in a
project that has no access to the table's history, its pull requests, or the account that merged
them. An attribution that lives only in git would arrive at the reader as an unsigned `reviewed` —
the one claim [ADR-0028](0028-library-trust-and-derived-overrides.md) and
[ADR-0047](0047-an-external-library-is-a-template-not-a-dependency.md) decision 5 treat as worse than
no claim at all.

So the two records serve different purposes and both are kept: the row is the statement the copy
carries, and the commit history is how the organisation corroborates it after the fact (`git log` on
the table shows who touched the row and when). Writing `by` and `on` once per act is the price of
the claim being self-contained; writing them once per item would be the price of nothing.

## Consequences

- A company keeps one table **per library it consumes** (and one tree per library it owns); a new
  project imports the few devices it uses and they arrive reviewed, attributed, and dated. No
  re-review per project, no copy of the policy.
- A new file revision is unreviewed until a row covers it, and the import says so on stdout. Bumping
  a revision is a decision with a name and a date attached to it, and with per-file matching
  ([ADR-0049](0049-a-file-carries-its-own-revision.md) decision 3) it does not disturb the files a
  release did not touch.
- The absence of a row is meaningful and visible: the copies stay `generated`, and each one says
  "verify before manufacturing, the template was not human-reviewed". A library that is entirely
  unreviewed needs no record at all, which is the cheapest honest statement available.
- A large library is no longer a reason to reach for a coarse claim: if the ids were verified, the
  list can be produced; if they were not, there is nothing to list.
- Geometry still has no claim field in the IR, so for symbols and footprints the consumer's entry
  reaches a reader only through the origin header. Gating geometry means giving `symbol` /
  `footprint` a claim of their own — a language decision, deliberately not made here.

## Alternatives considered

- **Ship a manifest with the upstream library.** Requires owning the library. It is exactly the case
  this record exists to complement, not replace.
- **Reinstate a pinned dependency layer so no copy exists.** That is the shape
  [ADR-0047](0047-an-external-library-is-a-template-not-a-dependency.md) rejected for third-party
  libraries: version resolution, a transitive graph, a lockfile, and one more question ("which copy
  is real") to answer per build — for a trust statement that needs none of it.
- **A trust file per project.** 20 projects, 20 copies of the same policy, and nineteen of them are
  wrong after the first revision bump.
- **A whole-library flag (`all = true`).** Cheap to type and therefore cheerfully granted, and it
  cannot distinguish "verified every id" from "shipped without looking"; it makes the record say
  more than the act did, which is the one failure this record exists to prevent.
  ([ADR-0028](0028-library-trust-and-derived-overrides.md) rejected the same coarseness at library
  level: "a library may hold a thousand parts of which twelve have been reviewed".)
- **Record the hash of each copied file in the table.** A copy is editable by design
  ([ADR-0047](0047-an-external-library-is-a-template-not-a-dependency.md) decision 5), so the hash
  would be wrong exactly where the design expects a local correction — and a re-import of an
  unchanged revision would then fail against a file nobody disagrees with. Vouching for a revision,
  by a named person, on a date, is the honest granularity.

## Addendum (2026-10-24): ownership, one record per library

An organisation is usually on both sides of the import at once. It owns a private library and it
consumes an external one, and the rule is per library:

| The library | The tree | The record |
|---|---|---|
| somebody else's — an upstream or "official" library | the organisation keeps **no** copy | this consumer table, passed with `--trust` |
| the organisation's own — its private library | it maintains the tree | that tree's `library.toml` |

So "the consumer does not fork" means: a library the organisation does not own is never mirrored,
ingested or re-published by it. It does not mean an organisation has no library tree — the tree it
owns is where its own facts and reviews live.

Three consequences:

- **Exclusive per library, not globally.** A library the organisation owns needs no consumer table;
  a library it consumes needs no `library.toml` of its own. Having both for one library would put two
  statements of the same review in two places, and one of them would be stale.
- **A local correction is a fork only for libraries you do not own.** In an owned library, editing
  the file is the library, and the revision is bumped for the release that carries it
  ([ADR-0049](0049-a-file-carries-its-own-revision.md) decision 6).
- **Rows are matched per file** ([ADR-0049](0049-a-file-carries-its-own-revision.md) decision 3): a
  release that touches one file must not invalidate trust in the files it did not touch. This
  matters most for the external library, where the organisation cannot annotate the source.

Publishing a private library to others is a different decision and still deferred
(`docs/backlog.md` F29).
