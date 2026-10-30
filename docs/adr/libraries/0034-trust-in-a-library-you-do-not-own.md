# ADR-0034: Trust in a Library You Do Not Own

Status: Accepted
Date: 2026-10-24
Scope: Decides: that an external library is a template rather than a dependency, that trust in a library you do not own is a consumer-side record, and that a file carries its own revision. Does not decide: what a device may state — see ADR-0025.
Related: [ADR-0008](../project/0008-project-tree-has-owners.md), [ADR-0024](../devices/0024-the-device-kind-is-part-or-generic.md), [ADR-0030](0030-footprint-format-and-geometry.md), [ADR-0033](0033-libraries-are-unverified-facts.md)
Impact: `docs/guides/library-import.md`; `packages/cli` (the `lib import` command, the trust-table reader); `spec/teda.md` §6.1; `schemas/ir/**` (the `provenance` and `rev` fields)

## Background

Two earlier decisions shaped this one and are now folded into it.

**The dependency model.** A dependency is an anchor plus a **vendored** tree, and the anchor is
made tamper-evident by hashing the whole tree. Both were written for a shape this project does not
have yet: an ecosystem of libraries that other people publish and that many projects consume at
different revisions.

Building that machinery produced a question it could not answer. The hash covers the tree, so a
project that needs three devices must vendor three hundred; and review is per item, so the three
hundred arrive unreviewed and nobody will ever review the two hundred ninety-seven that are never
placed. Review is per component — "a library may hold a thousand parts of which twelve have been
reviewed" — so the granularity was right and the *consumption* was wrong: a whole tree is pinned
while a handful of items is used.

Two further costs follow from the anchor, and neither pays for itself today:

- **Recording "I checked this item and it was fine" had no cheap form.** The library is read-only,
  so the only written statement was a full derived component — a complete pin table copied to
  record one approval. Derived files exist for *corrections*; using them for confirmations makes
  the confirmation more expensive than the review.
- **The un-reviewed remainder still entered the build identity.** Every vendored device, symbol
  and footprint becomes a normative shard, so a device nobody placed and nobody read changed the
  project hash.

The project has no operator, no published library, and exactly one consuming project. What it has
is a format that still moves, and every movement would have to be republished as a library
revision that pins break on. Paying the dependency machinery now buys a guarantee about a
population of one.

**The revision model.** A trust record was first written against a **library revision**: one
`[[trust]]` row naming a release and the ids it covers, read at import time. But a tree is not a
batch. It changes one file at a time, and a release is only a name for a commit. So a revision at
library level answers the wrong question:

- **At the source**, one tree-level `rev` cannot distinguish "this file is new in 2.2.0" from
  "this file is unchanged since 2.1.0". A reader of the tree gets the wrong answer for every file
  the release did not touch — which is almost all of them.
- **At the consumer**, a release that fixes one footprint makes every other file's trust claim
  ambiguous. Re-import the tree and every copy is stamped 2.2.0, so every row must be re-signed
  though the bytes did not change; keep the old row and the one file that did change is vouched for
  by a review of its previous self. Neither answer is honest, and both are busywork.

A content hash was tried for this and withdrawn: a maintainer cannot keep hashes honest through
local edits, and a hash that lies is worse than none. What is left is an identity that a human
maintains: **a revision written on the file**.

**The consumer side.** The trust record was first written on the library's side, assuming the
reviewer and the library have the same owner. The common case in an organisation is the opposite:
the library belongs to somebody else — an upstream or "official" library that will never carry a
manifest in our TOML subset — and the **consumer** is the party that looked. Today that act has
nowhere to be written. A project either edits each copy's provenance line by hand (per project, per
file, and it contradicts nothing it can point at), or it re-reviews in every new project. The
first is bookkeeping that goes stale; the second is the multiplication the dependency model was
written to avoid.

Two facts bound the problem:

- **A copy is still required.** The build reads `assets/` and nothing else, so a project that uses
  a device owns a copy of it. What a consumer-side record removes is not the copy but the
  *re-review*: the copy arrives already vouched for, attributed to whoever vouched.
- **A vouching act is about a revision, not about bytes we can watch.** "We looked at X@rev and it
  was right" is a statement, and the sentence names its revision, its date and its author — which
  is what makes it checkable by a reader, not by a hash.

## Decision

### D1. A project does not consume a library in place

The build reads `assets/**` and `design/**`. It does not read `external/libs/**`. A tree there
holding `components/`, `symbols/` or `footprints/` is an **error**, because the alternative is the
failure this record avoids: a device that resolves only because a checkout happens to sit in the
tree, in a revision nobody stated.

A qualified device id (`<lib>:<id>`) is likewise an error: there is no library to qualify
against. The grammar stays in one place so that the message is about the policy, not a typo.

### D2. An external library is a template, and importing is a one-way copy

```sh
texteda lib import <name> --from <dir> --rev <tag-or-commit> [--only <id>[,<id>…]]
```

The command copies the template's assets into `assets/` under **bare ids**, rewriting every
`<name>:` qualifier in the copied files. Three properties:

- **A subset is legal, and must be closed under references.** `--only` takes device ids and pulls
  in the symbols and footprints those devices name. A device without its geometry is not a device
  that can be drawn or matched against a land pattern, so the closure is not optional.
- **The copy is the project's own content.** It enters the project hash because it now *is* the
  project's asset, not because an anchor says so. Editing it is normal work, not tampering.
- **Nothing is verified afterwards.** There is no anchor, no content hash, no revision check. The
  hash existed to prove "this tree is that revision"; once the copy is editable, that claim would
  be false the first time it is edited, and enforcing a false claim is worse than not claiming it.

### D3. The origin travels as a comment, not as a gate

Every imported file gets one header line:

```text
# imported from vendor@v2.1.0 on 2026-10-24: verify before manufacturing, the template was not human-reviewed
```

A comment never enters the IR, never changes a hash, and is read by exactly the person who opens
the file — which is the person who needs it. The machine-visible half is the `provenance` field
(D5); the human-visible half is the line above, and the two say the same thing at different
resolutions.

A project that never consumed the library in the first place has nothing to disclaim, and the
files it does have are its own.

### D4. A subset is not a fork, because there is no upstream claim left to protect

The reason a whole tree had to be vendored was that a content hash identified a revision, and a
subset would have made the hash identify "someone's revision". With the anchor gone, the subset
carries no false claim: it is three devices the project copied, and the header says where from.
Re-importing later is a merge the author performs, and the diff of the header line is what says
how far behind the copy is.

### D5. A device states its provenance, and review flips it in place

`component` gains three optional scalars: `provenance` (`generated` | `reviewed`), and, for
`reviewed`, `verified_by` and `verified_on`. `lib import` writes `provenance generated`. A human
who has compared the facts with the datasheet changes the value **in the same file** — which is
exactly the operation the derived-file machinery made expensive, and exactly what was wanted: the
review must be visible.

Nothing enforces the claim: there is no signature. What is enforced is shape — `reviewed` without
an attribution is an error, because an unattributable claim is worse than no claim.

### D6. A description may state the revision its facts belong to

```
version 0.1.6
component tps7a02
rev       2.1.0
```

- `rev` is a scalar on `component`, `symbol` and `footprint`. It names **the release in which this
  file's facts were last established** — not the format version (the `version` line), not the
  library's release as a whole.
- Optional. A file that says nothing has no per-file revision, and is trusted at the granularity of
  the import that brought it in.
- Release names rather than counters, so values stay comparable across files: "these ids, last
  changed in 2.1.0" is a sentence a reviewer can check.
- It is a fact about the file, like `datasheet`, so it enters the IR and the shard bytes. Nothing
  computes with it.

### D7. A tree-level revision goes away

A tree-level revision cannot be true for a tree whose files change independently, and every
consumer that reads it will misread the files the release did not touch. The library's own history
is git's job; the library's identity in `library.toml` stays `name` and `source`. For a library
the organisation owns, `source` is the address of the tree's own repository — it answers "whose
tree is this", which is exactly the question a reader of a copy needs answered. A release tag
still exists as a git tag and is still what `lib import --rev <tag>` selects — it is just not a
fact stored in a file.

### D8. The trust record lives on the consumer's side, and the importer is told where it is

`texteda lib import <name> --from <dir> --rev <rev> --trust <file>` reads a **consumer trust
table**: a file the consumer organisation maintains, covering any number of libraries, outside the
project tree. It is not discovered: there is no default path, no environment variable, no search
under `assets/` or `external/`. The operator names it, and the copies carry the result.

The file never enters the build. The claim it produces does: `provenance` is a component field, so
a reviewed copy is a different IR shard and a different project hash. That is correct — whether a
device was vouched for is part of the design state, not a caching detail — and it is why the policy
file only has to exist on the machine that runs the import.

### D9. The trust rows: same shape as a library manifest, plus the library name, and no whole-library form

```toml
[[trust]]
library    = "vendor"
by         = "tz"
on         = "2026-10-24"
components = ["tps7a02@2.1.0", "bq24610@2.2.0"]
symbols    = ["tps7a02@2.1.0", "bq24610@2.2.0"]
footprints = ["sot-23-5@2.0.0", "vqfn-24@2.2.0"]
```

- `library` is mandatory: one file covers several upstream libraries, and an entry that does not
  say which one is ambiguous. It must equal the `--from` library name being imported.
- A row is one **act** — who checked, on which day — and each item names `id@rev`, the revision
  the verification was of. One act covering files from several releases is one row, so `by` / `on`
  are written once per act rather than once per revision.
- Review is per group (`components` / `symbols` / `footprints`): listing a device does not vouch
  for its geometry.
- A row lists the items it covers. An entry that lists none is an error: it would vouch for
  nothing.
- Unknown keys, a missing `by` / `on`, a mistyped date, the same `(library, id, rev)` stated twice
  with different attribution, and an id the library does not provide all refuse the import and
  write nothing.

**There is deliberately no "whole library" form.** A flag meaning "everything at this revision" was
considered and removed: it made one row claim coverage wider than the act behind it. Two different
states would have collapsed into it — "I compared all of these with their sources" (then the ids
are known, and listing them is mechanical) and "I did not look, but I will ship it anyway" (then no
row is the honest answer, and the copies stay `generated` with the disclaimer header). The second
state is a policy about a board, not a fact about a library, and this format records facts about
libraries. Deciding to accept unreviewed material belongs to the review record or to the process,
where it can carry a reason.

### D10. Trust is matched per item, and an item names the revision it covers

- An item is `<id>@<rev>`, and the id is vouched for only by a file whose own `rev` equals that
  string **character for character**. `+local.N` therefore matches nothing upstream (D13).
- `by` and `on` are paid once per act, not once per revision. A review of files that last changed
  in three different releases is one row, not three. The list length grows with what was verified
  — which is the irreducible cost of an honest record — and not with how the releases happened to
  fall.
- Two rows may not state the same `(library, id, rev)` with different attribution: one act, one
  author. A conflict is resolved by a person, not by the importer picking a row.
- There is no row-level `rev` to be inherited by items that omit `@rev`: one fact, one spelling.

Consequences follow directly:

- A release that touches one file leaves the other files' `rev` values alone, so their items still
  match. Trust does not reset on unrelated work.
- A file whose `rev` moved is not vouched for until an item names that revision. This is the
  friction we want: a new revision of a file is an unreviewed file until somebody says otherwise.
- There is no whole-library coverage, and it cannot come back in another spelling: a row that
  claims everything claims more than the act behind it.

### D11. The two records compose; a disagreement is a conflict

Both records are keyed by revision, so one import can see two candidate statements. They do not
override each other:

- **Ids one record covers and the other does not**: both apply. A consumer may vouch for ids the
  library did not sign — a board-specific acceptance, or a review the library's maintainer never
  did.
- **The same id at the same revision with different attribution**: an **error**. Two people cannot
  be the author of one act, and the importer will not silently pick one. A human resolves it by
  fixing whichever record is wrong.
- The origin header names the record that decided, file by file, so a reader can tell them apart.

### D12. `lib import --rev` selects the tree; it does not overwrite a file's revision

- `--rev` answers "which tree do I copy from", and the origin header records it:
  `# imported from vendor@2.2.0 on 2026-10-24: …`.
- A copied file that carries `rev` keeps it verbatim. A library that tracks per-file revisions is
  more specific than the checkout, and an import must not flatten it to the tag it happened to use.
- A copied file that carries no `rev` is stamped with the imported revision. An upstream that does
  not maintain per-file revisions is thus trusted at batch granularity, which is the best statement
  that can be made about it.

### D13. A re-import keeps the previous revision when the bytes are unchanged

For a library that cannot state per-file revisions, the importer recovers the per-file fact from
what it has:

- it builds the copy as it would today (qualifier rewrite plus origin header),
- and when a file already exists at the target, it compares the new content with the existing file
  after removing the origin header,
- if they are identical, the existing `rev` is preserved; otherwise the new revision is written.

The comparison is local and immediate — no hash is stored, so nothing can drift out of date. This
is what makes a release that touches one file stop resetting trust for its siblings in an upstream
library that nobody can annotate.

### D14. An edited copy of a library you do not own is a fork, and says so

A copy is editable. A project that changes the facts of a copy taken from a library **it does not
own** appends `+local.N` to `rev` (or removes the line):

```
rev  2.1.0+local.1
```

Exact matching then stops an upstream item from vouching for it — the string no longer equals the
revision anybody reviewed. A fork is trusted only by an item that names that exact string, which in
practice means it is trusted by whoever owns the fork. The convention exists so that a reader and
an audit can see that the facts diverged from their source.

In a library the organisation **owns**, there is no fork to mark: editing the file *is* the
library, and the revision is bumped for the release that carries the change. `+local` in your own
tree would say the tree is not its own source.

### D15. The anchor machinery goes away with the anchor

`project.toml` carried a `[libs.<name>]` table whose only purpose was to pin a library, and a
content-hash tool computed the hash of a self-built library because it had no upstream revision.
Both existed to name a dependency. A project whose devices are all its own has nothing to pin: the
files are in `assets/`, they enter the project hash as normative shards, and editing them is
editing the design.

So `[libs]` is a top-level key that is now an **error**, the `libs` array leaves the `project`
shard, and the hash tool is deleted. The consequence is worth stating plainly: two projects that
copied the same template have no machine-readable way to say they did. That is the intended trade
— the copy is the project's own content, and `git log` on the header comment answers "where did
this come from" better than a hash of files the author is allowed to change.

### D16. Sharing your own devices across projects is not solved here

When a curated set of devices must be shared by several of *your* projects, that set becomes a
library you publish, and the dependency machinery returns — for libraries you maintain, where
moving a revision is your own decision and the review surface is your own. That is deferred until
a second project exists; nothing in this record prevents it, because it is the same shape with a
different population.

## Consequences

- **The dependency link is documentation.** No tool answers "is my copy behind upstream?". The
  header line answers "how old is it", which is the question that actually gets asked before a
  build; an update is a manual merge, and that is the price of deleting the anchor.
- **Licensing**: a copy is a distribution act, and the copy now lives in the project's tree under
  the project's licence obligations.
- **A device is one file with one history.** Corrections are edits, so a reviewer reads a diff
  instead of comparing a derived file against a library item — fewer artefacts, one source.
- **Trust survives unrelated upstream work.** A release that touches one file does not reset the
  trust of its siblings.
- **A new revision of a file is unreviewed until somebody says so.** The friction is deliberate.
- **A fork is visible.** `+local.N` says the facts diverged from their source, and no upstream row
  can vouch for it by accident.
- **The review is a record with an author and a date**, not a hash — because a hash of editable
  files lies the moment one of them is edited.
- **The reference project is unaffected**: it never consumed a library. Its `project.toml` did
  carry a lock for its *own* assets; that table and its content hash are gone with D15.
