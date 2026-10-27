# ADR-0047: An External Library Is a Template, Not a Dependency

Status: Accepted
Date: 2026-10-24
Related: [ADR-0046](0046-vendored-libraries-are-verified-by-their-hash.md), [ADR-0031](0031-project-tree-ownership-model.md), [ADR-0028](0028-library-trust-and-derived-overrides.md), [ADR-0010](0010-footprint-and-3d-model-ownership.md), [ADR-0013](0013-reference-project-self-built-libraries.md), [ADR-0027](0027-device-parts-families-and-library-dependencies.md), [ADR-0023](0023-ir-layer-on-disk.md), [ADR-0018](0018-zero-dependency-and-manufacturing-target.md)
Impact: supersedes [ADR-0046](0046-vendored-libraries-are-verified-by-their-hash.md); amends [ADR-0031](0031-project-tree-ownership-model.md) decisions 5–7 and [ADR-0028](0028-library-trust-and-derived-overrides.md) decisions 3–4; `spec/libref.md` (removed); `docs/guides/library-import.md` (new); `spec/teda.md` §2, §4.2, §6.1, §7.1, §13.4; `schemas/ir/v0.12/` (the `libref` shard removed, `provenance` added to `component`, `libs` removed from `project`); `packages/parser` (the `libref` parser removed, `provenance` added); `packages/cli` (library discovery and resolution removed, `lib import` replaces `lib add`); `project.toml` (`[libs]` removed); `scripts/verify-libs.ts`; `scripts/libhash.ts` (removed); `docs/backlog.md` F29; `AGENTS.md` §4.5, §9, §10

## Background

[ADR-0031](0031-project-tree-ownership-model.md) decided that a dependency is a `libref` anchor
plus a **vendored** tree, and [ADR-0046](0046-vendored-libraries-are-verified-by-their-hash.md)
made the anchor tamper-evident by hashing the whole tree. Both were written for a shape this
project does not have yet: an ecosystem of libraries that other people publish and that many
projects consume at different revisions.

Building that machinery produced a question it could not answer. The hash covers the tree, so a
project that needs three devices must vendor three hundred; and review is per item, so the
three hundred arrive unreviewed and nobody will ever review the two hundred ninety-seven that
are never placed. [ADR-0028](0028-library-trust-and-derived-overrides.md) decision 1 already
says review is per component — "a library may hold a thousand parts of which twelve have been
reviewed" — so the granularity was right and the *consumption* was wrong: a whole tree is pinned
while a handful of items is used.

Two further costs follow from the anchor, and neither pays for itself today:

- **Recording "I checked this item and it was fine" had no cheap form.** The library is
  read-only, so the only written statement was a full derived component
  ([ADR-0028](0028-library-trust-and-derived-overrides.md) decision 3) — a complete pin table
  copied to record one approval. Derived files exist for *corrections*; using them for
  confirmations makes the confirmation more expensive than the review.
- **The un-reviewed remainder still enters the build identity.** Every vendored device,
  symbol and footprint becomes a normative shard, so a device nobody placed and nobody read
  changes the project hash.

The project has no operator, no published library, and exactly one consuming project
([ADR-0015](0015-licensing-and-open-standard.md) — no commercial plan, no service). What it has
is a format that still moves, and every movement would have to be republished as a library
revision that pins break on. Paying the dependency machinery now buys a guarantee about a
population of one.

## Decision

### 1. A project does not consume a library in place

The build reads `assets/**` and `design/**`. It does not read `external/libs/**`. A tree there
holding `components/`, `symbols/` or `footprints/` is an **error** (`ref.library-in-tree`),
because the alternative is the failure this record avoids: a device that resolves only because
a checkout happens to sit in the tree, in a revision nobody stated.

A qualified device id (`<lib>:<id>`) is likewise an error (`ref.library-qualified-id`): there is
no library to qualify against. The grammar stays in one place so that the message is about the
policy, not a typo.

### 2. An external library is a template, and importing is a one-way copy

```sh
texteda lib import <name> --from <dir> --rev <tag-or-commit> [--only <id>[,<id>…]]
```

The command copies the template's assets into `assets/` under **bare ids**, rewriting every
`<name>:` qualifier in the copied files. Three properties:

- **A subset is legal, and must be closed under references.** `--only` takes device ids and pulls
  in the symbols and footprints those devices name. A device without its geometry is not a
  device that can be drawn or matched against a land pattern, so the closure is not optional.
- **The copy is the project's own content.** It enters the project hash because it now *is* the
  project's asset ([ADR-0023](0023-ir-layer-on-disk.md) decision 2), not because an anchor says
  so. Editing it is normal work, not tampering.
- **Nothing is verified afterwards.** There is no anchor, no `content_hash`, no revision check.
  The hash existed to prove "this tree is that revision"; once the copy is editable, that claim
  would be false the first time it is edited, and enforcing a false claim is worse than not
  claiming it.

### 3. The origin travels as a comment, not as a gate

Every imported file gets one header line:

```text
# imported from vendor@v2.1.0 on 2026-10-24: verify before manufacturing, the template was not human-reviewed
```

A comment never enters the IR, never changes a hash, and is read by exactly the person who opens
the file — which is the person who needs it. The machine-visible half is the `provenance` field
(decision 5); the human-visible half is the line above, and the two say the same thing at
different resolutions.

The disclaimer of [ADR-0028](0028-library-trust-and-derived-overrides.md) decision 2 therefore
does not need to be carried by the consumer: a project that never consumed the library in the
first place has nothing to disclaim, and the files it does have are its own.

### 4. A subset is not a fork, because there is no upstream claim left to protect

The reason a whole tree had to be vendored was that `content_hash` identified a revision, and a
subset would have made the hash identify "someone's revision". With the anchor gone, the subset
carries no false claim: it is three devices the project copied, and the header says where from.
Re-importing later is a merge the author performs, and the diff of the header line is what says
how far behind the copy is.

### 5. A device states its provenance, and review flips it in place

`component` gains three optional scalars: `provenance` (`generated` | `reviewed`), and, for
`reviewed`, `verified_by` and `verified_on`. `lib import` writes `provenance generated`.
A human who has compared the facts with the datasheet changes the value **in the same file** —
which is exactly the operation the derived-file machinery made expensive, and exactly what
[ADR-0028](0028-library-trust-and-derived-overrides.md) decision 1 wanted to be visible.

Nothing enforces the claim: there is no signature and no strict mode
([ADR-0028](0028-library-trust-and-derived-overrides.md) addendum). What is enforced is shape —
`reviewed` without an attribution is an error (`value.provenance-invalid`), because an
unattributable claim is worse than no claim.

### 6. Sharing your own devices across projects is not solved here

When a curated set of devices must be shared by several of *your* projects, that set becomes a
library you publish, and the dependency machinery returns — for libraries you maintain, where
moving a revision is your own decision and the review surface is your own. That is deferred
until a second project exists (`docs/backlog.md` F29); nothing in this record prevents it,
because it is the same `libref` shape with a different population.

### 7. `[libs]` and the library content hash go away with the anchor

`project.toml` carried a `[libs.<name>]` table whose only purpose was to pin a library
(`source` + one of `rev` / `version` / `content_hash`), and `bun run lib:hash` computed the
`content_hash` of a self-built library because a self-built library had no upstream revision.
Both existed to name a dependency. A project whose devices are all its own has nothing to pin:
the files are in `assets/`, they enter the project hash as normative shards, and editing them is
editing the design.

So `[libs]` is a top-level key that is now an **error** (`value.project-unknown-key`), the
`libs` array leaves the `project` shard (IR contract v0.12), and `scripts/libhash.ts` is deleted.
The consequence is worth stating plainly: two projects that copied the same template have no
machine-readable way to say they did. That is the intended trade — the copy is the project's own
content (decision 2), and `git log` on the header comment answers "where did this come from"
better than a hash of files the author is allowed to change.

## Consequences

- **Deleted**: the `libref` description type, its schema and shard, the content-hash rule and its
  two error codes' emitters, the qualified-id resolver and its ambiguity hook, the vendored-tree
  readers in the geometry loaders, the shard paths `librefs/**` and `components/<lib>/**`, and
  the derived-component / family-override machinery of
  [ADR-0028](0028-library-trust-and-derived-overrides.md) decisions 3–4 (in-place edits replace
  it).
- **The dependency link is documentation.** No tool answers "is my copy behind upstream?". The
  header line answers "how old is it", which is the question that actually gets asked before a
  build; an update is a manual merge, and that is the price of deleting the anchor.
- **Licensing**: a copy is a distribution act, and the copy now lives in the project's tree under
  the project's licence obligations. Vendoring was already that
  ([ADR-0028](0028-library-trust-and-derived-overrides.md) decision 7); copying makes it
  unavoidable, which is honest.
- **A device is one file with one history.** Corrections are edits, so a reviewer reads a diff
  instead of comparing a derived file against a library item — fewer artefacts, one source.
- **The reference project is unaffected**: it never consumed a library
  ([ADR-0013](0013-reference-project-self-built-libraries.md)). Its `project.toml` did carry a
  `[libs.project]` lock for its *own* assets; that table and its `content_hash` are gone with
  decision 7.
- **Amends three more records by subtraction**, without rewording them:
  [ADR-0008](0008-ir-shard-identity-and-hash.md) (a `libs` list is not among the shard kinds),
  [ADR-0023](0023-ir-layer-on-disk.md) (no `librefs/**` shard) and
  [ADR-0027](0027-device-parts-families-and-library-dependencies.md) (`libref` files are not part
  of the device model).

## Alternatives Rejected

- **Keep hash-pinned vendoring and add a review sidecar** (`*.review.toml`, per-item verdicts,
  stale detection). Correct engineering for a real dependency, but it adds a fourth artefact per
  library to serve a population of one, and it still requires the whole tree to be vendored for
  the hash to mean anything.
- **Vendor a subset with a `derived_from` field and hash the subset.** The hash then identifies
  the subset rather than the revision, so every consumer must read two facts ("derived from X at
  Y, and this is the subset") to learn one thing. Complexity that buys an audit trail nobody can
  verify without the upstream tree.
- **Forbid external libraries entirely.** Too strong: the template path is what makes it
  practical to start a library from somebody else's work, which is the common case.
- **Consume in place with a warning.** A warning is the shape that lets a checkout become a
  silent dependency: the build works on the machine where the directory exists and fails
  elsewhere, which is the inconsistency a project tree exists to prevent.

## 2026-10-24 — A Reviewed Template Arrives Reviewed

Decision 5 said `lib import` writes `provenance generated`. That is right for a template that makes
no claim, and wrong for one whose devices already say `provenance reviewed`: the copy is verbatim,
so the claim is about exactly the facts being copied, and downgrading it would make the importer
assert something it cannot know ("nobody has looked at this") — while touching a fact it is only
supposed to carry.

`lib import` now keeps a template's `provenance` block instead of overwriting it, and the origin
header states what the template said (`the template declares provenance reviewed (tz)`) rather than
the fixed "the template was not human-reviewed" sentence, which would otherwise contradict the file
below it. A template device that carries an error is refused before anything is written — including
`reviewed` without an attribution (`value.provenance-invalid`): the copy would be born invalid, and
the error would point at the copy instead of at the source.

The consequence is the one that makes review pay once. The facts a device holds are the same in
every copy, so **review the library at the revision you import**: each project that imports it
inherits the claim, and no project flips hundreds of files by hand. A review made *after* import
stays local, as decision 5 describes — it says "this copy was checked", and it does not travel back
upstream.

### The trust record: one statement per library revision

The addendum above makes a claim in a template travel. A claim made *about* a template needs
somewhere to live, because the reviewer usually does not own the library: you cannot commit
`provenance reviewed` into somebody else's repository, and editing three hundred copied files to
repeat one review is the friction that makes reviews stop happening.

A library may carry `library.toml` at its root: one `[[trust]]` entry per revision, naming who
compared it with its sources, when, and which `components` / `symbols` / `footprints` they looked
at. `lib import --rev` reads the entry for that revision and writes the result into the copies —
`provenance reviewed` with the recorded attribution for components, the origin header for the
geometry, which has no claim of its own in the IR. An import of a revision the record does not
cover is unreviewed and says so.

The record is **read at import time only**. It is the table a generator reads, and the per-file
claim is the row a build checks (ADR-0017: generators live outside the language, and the fact layer
holds only final values). That ordering is what keeps the trust honest: the claim `check` acts on
lives in the same file as the facts, so a copy edited after import cannot sit behind a review of
what it used to be — the thing a project-level "this library is trusted" flag would have produced,
and the reason this record is not one.

## Addendum (2026-10-27): the withdrawn key reports `syntax.unknown-field`

Decision 7 says a `[libs]` table in `project.toml` is an error named `value.project-unknown-key`.
That code does not exist in the registry. The parser reports the withdrawn table (and any other
unknown top-level table) as **`syntax.unknown-field`**, with a message that states the fix
(`packages/parser/src/project.ts`); the only surviving `[libs]`-related row is
`value.project-lib-invalid`, marked `[DEPRECATED]` in
`packages/ir/src/diagnostics/codes.ts`. `spec/teda.md` §13.4 describes the actual behaviour.

The rule is unaffected — `[libs]` is still an error, and `init` still does not create
`external/libs/`. Only the code name in this sentence was wrong.
