# ADR-0049: A File Carries Its Own Revision, and Trust Matches That Revision

Status: Accepted
Date: 2026-10-24
Related: [ADR-0047](0047-an-external-library-is-a-template-not-a-dependency.md), [ADR-0048](0048-trust-in-a-library-you-do-not-own.md), [ADR-0028](0028-library-trust-and-derived-overrides.md), [ADR-0046](0046-vendored-libraries-are-verified-by-their-hash.md), [ADR-0022](0022-language-versioning.md)
Impact: `spec/teda.md` §6–§8 (a `rev` scalar on `component` / `symbol` / `footprint`); `schemas/ir/v0.13/` (three descriptions gain `rev`); `packages/parser` (parse + format); `packages/cli` (`lib import` stamping and the byte comparison, trust matching); `library-manifest.ts` (`[library] rev` removed); `packages/cli/src/trust-table.ts` (match per file); `docs/guides/library-import.md` §3

## Background

[ADR-0047](0047-an-external-library-is-a-template-not-a-dependency.md) made a review a statement about a
**library revision**: `[[trust]] rev = "2.1.0"` plus the ids it covers, read at import time.
[ADR-0048](0048-trust-in-a-library-you-do-not-own.md) hangs the same rows on the consuming side. Both
assume a revision is a coherent batch: importing 2.1.0 brings the facts of 2.1.0, and a review of
2.1.0 covers them.

A tree is not a batch. It changes one file at a time, and a release is only a name for a commit. So
a revision at library level answers the wrong question:

- **At the source**, one `[library] rev` cannot distinguish "this file is new in 2.2.0" from "this
  file is unchanged since 2.1.0". A reader of the tree gets the wrong answer for every file the
  release did not touch — which is almost all of them.
- **At the consumer**, a release that fixes one footprint makes every other file's trust claim
  ambiguous. Re-import the tree and every copy is stamped 2.2.0, so every row must be re-signed
  though the bytes did not change; keep the old row and the one file that did change is vouched for
  by a review of its previous self. Neither answer is honest, and both are busywork.

[ADR-0046](0046-vendored-libraries-are-verified-by-their-hash.md) tried to solve this with a content
hash and was withdrawn: a maintainer cannot keep hashes honest through local edits, and a hash that
lies is worse than none. What is left is an identity that a human maintains: **a revision written
on the file**.

## Decision

### 1. A description may state the revision its facts belong to

```
version 0.1.6
component tps7a02
rev       2.1.0
```

- `rev` is a scalar on `component`, `symbol` and `footprint`. It names **the release in which this
  file's facts were last established** — not the format version (the `version` line), not the
  library's release as a whole.
- Optional. A file that says nothing has no per-file revision, and is trusted at the granularity of
  the import that brought it in (decision 4).
- Release names rather than counters, so values stay comparable across files: "these ids, last
  changed in 2.1.0" is a sentence a reviewer can check.
- It is a fact about the file, like `datasheet` ([ADR-0042](0042-a-device-description-enters-the-ir.md)),
  so it enters the IR and the shard bytes. Nothing computes with it.

### 2. `[library] rev` is removed

A tree-level revision cannot be true for a tree whose files change independently, and every consumer
that reads it will misread the files the release did not touch. The library's own history is git's
job; the library's identity in `library.toml` stays `name` and `source`. For a library the
organisation owns, `source` is the address of the tree's own repository — it answers "whose tree is
this", which is exactly the question a reader of a copy needs answered. A release tag still exists as
a git tag and is still what `lib import --rev <tag>` selects — it is just not a fact stored in a
file.

### 3. Trust is matched per item, and an item names the revision it covers

A row is one **act**: who checked something, on which day. It does not carry a revision of its own,
because one act covers files whose revisions differ. Each item names its own:

```toml
[[trust]]
library    = "vendor"
by         = "tz"
on         = "2026-10-24"
components = ["tps7a02@2.1.0", "bq24610@2.2.0"]
symbols    = ["tps7a02@2.1.0", "bq24610@2.2.0"]
footprints = ["sot-23-5@2.0.0", "vqfn-24@2.2.0"]
```

- An item is `<id>@<rev>`, and the id is vouched for only by a file whose own `rev` equals that
  string **character for character**. `+local.N` therefore matches nothing upstream (decision 6).
- `by` and `on` are paid once per act, not once per revision. A review of files that last changed in
  three different releases is one row, not three. The list length grows with what was verified —
  which is the irreducible cost of an honest record — and not with how the releases happened to fall.
- Two rows may not state the same `(library, id, rev)` with different attribution: one act, one
  author. A conflict is resolved by a person, not by the importer picking a row
  ([ADR-0048](0048-trust-in-a-library-you-do-not-own.md) decision 3).
- There is no row-level `rev` to be inherited by items that omit `@rev`: one fact, one spelling.

Consequences follow directly:

- A release that touches one file leaves the other files' `rev` values alone, so their items still
  match. Trust does not reset on unrelated work.
- A file whose `rev` moved is not vouched for until an item names that revision. This is the friction
  we want: a new revision of a file is an unreviewed file until somebody says otherwise.
- There is no whole-library coverage ([ADR-0048](0048-trust-in-a-library-you-do-not-own.md) decision 2
  removed the flag; this decision explains why it cannot come back in another spelling).

### 4. `lib import --rev` selects the tree; it does not overwrite a file's revision

- `--rev` answers "which tree do I copy from", and the origin header records it:
  `# imported from vendor@2.2.0 on 2026-10-24: …`.
- A copied file that carries `rev` keeps it verbatim. A library that tracks per-file revisions is
  more specific than the checkout, and an import must not flatten it to the tag it happened to use.
- A copied file that carries no `rev` is stamped with the imported revision. An upstream that does
  not maintain per-file revisions is thus trusted at batch granularity, which is the best statement
  that can be made about it.

### 5. A re-import keeps the previous revision when the bytes are unchanged

For a library that cannot state per-file revisions, the importer recovers the per-file fact from
what it has:

- it builds the copy as it would today (qualifier rewrite plus origin header),
- and when a file already exists at the target, it compares the new content with the existing file
  after removing the origin header,
- if they are identical, the existing `rev` is preserved; otherwise the new revision is written.

The comparison is local and immediate — no hash is stored, so nothing can drift out of date. This is
what makes a release that touches one file stop resetting trust for its siblings in an upstream
library that nobody can annotate.

### 6. An edited copy of a library you do not own is a fork, and says so

A copy is editable ([ADR-0047](0047-an-external-library-is-a-template-not-a-dependency.md) decision 5).
A project that changes the facts of a copy taken from a library **it does not own** appends `+local.N`
to `rev` (or removes the line):

```
rev  2.1.0+local.1
```

Exact matching then stops an upstream item from vouching for it — the string no longer equals the
revision anybody reviewed. A fork is trusted only by an item that names that exact string, which in
practice means it is trusted by whoever owns the fork. With [ADR-0047](0047-an-external-library-is-a-template-not-a-dependency.md)
and the rule that projects do not reference one another, a fork is never a shared artefact; the
convention exists so that a reader and an audit can see that the facts diverged from their source.

In a library the organisation **owns**, there is no fork to mark: editing the file *is* the library,
and the revision is bumped for the release that carries the change. `+local` in your own tree would
say the tree is not its own source.

### 7. Ownership decides which record is kept — one record per library

An organisation can be on both sides of the import at once, but never for the same library:

| The library | The tree | The record | The import |
|---|---|---|---|
| somebody else's (an upstream or "official" library) | the organisation keeps **no** copy | the consumer trust table ([ADR-0048](0048-trust-in-a-library-you-do-not-own.md)) | `--from <upstream> --rev <tag> --trust <table>` |
| the organisation's own (its private library) | the organisation maintains it | that tree's `library.toml` | `--from <private library> --rev <tag>` |

So "the company has no library tree" is true per library, not globally: it has a tree for what it
owns and none for what it consumes. The two records have the same shape — items that name `id@rev`,
by someone, on a day — and this decision applies equally to both: an item covers a file whose own
`rev` equals it.

Consequences that follow from keeping one record per library:

- A library the organisation owns is imported as a copy like any other (builds read `assets/`); what
  it does not need is a second table describing its own tree.
- The two records may compose for one library only in the sense of adding ids the other does not
  cover. Two statements about the same `(library, rev, id)` with different attribution are a
  conflict to be resolved by a person, not a precedence rule to be applied by the importer
  ([ADR-0048](0048-trust-in-a-library-you-do-not-own.md) addendum).
- Trust in an owned library never depends on decision 5's byte comparison: the organisation knows
  which files it changed, because it is the one releasing them. That recovery path exists for
  upstream libraries that cannot state a per-file revision.

## Consequences

- Trust survives releases that do not touch a file — the point of the whole change.
- A file's origin is answerable from the file (or its shard) instead of from a tag somebody has to
  look up, and per-file answers stay correct across hops: project copy ← upstream.
- Cost: three description types gain a scalar (schema, IR, formatter, versioning); libraries must
  decide whether to write it; `lib import` gains one comparison and one preserve rule.
- A file with `rev` and a file without behave differently at trust time. That is visible in the
  coverage rather than silent: an untracked file can only be trusted at batch granularity, and a
  re-import of the whole tree is what resets it.
- The convention `+local.N` is not enforced. Nothing can tell an edited copy from a pristine one
  without a hash, and [ADR-0046](0046-vendored-libraries-are-verified-by-their-hash.md) stays
  withdrawn; the suffix is an honest act, and its absence is what an audit looks for.

## Alternatives considered

- **Keep the library revision as the unit (status quo).** Misdescribes every untouched file and
  turns a one-file fix into a library-wide re-signing, or into a lie. Rejected.
- **Record a content hash per file.** [ADR-0046](0046-vendored-libraries-are-verified-by-their-hash.md)
  withdrew this: an editable copy makes the hash wrong exactly where local edits are expected, and
  keeping it honest is maintenance nobody does.
- **Trust by id alone ("these ids, forever").** Claims more than the act: a file that changes
  afterwards silently inherits a review of its previous contents. This is the failure mode
  [ADR-0028](0028-library-trust-and-derived-overrides.md) decision 1 and
  [ADR-0047](0047-an-external-library-is-a-template-not-a-dependency.md) decision 5 exist to
  prevent.
- **Let the importer stamp every copy with the imported tag, and require re-signing on every
  release.** Simple, and it makes trust maintenance proportional to release count rather than to
  change count. Rejected as the default because it is the exact busywork decision 5 removes for
  upstream libraries that cannot carry a revision.
