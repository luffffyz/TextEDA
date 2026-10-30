# Importing an external library

> Decision: [ADR-0034](../adr/libraries/0034-trust-in-a-library-you-do-not-own.md). An
> external library is a **template**, not a dependency: you copy the devices you need into
> `assets/`, and from that moment they are the project's own files.

## 1. The shape

```
somebody's library            your project
├── components/*.teda   ──▶   assets/components/**/*.teda   (bare ids)
├── symbols/*.teda      ──▶   assets/symbols/<lib>/*.teda
└── footprints/*.teda   ──▶   assets/footprints/<lib>/*.teda
```

Nothing is resolved from a template in place: `texteda init` does not even create an
`external/libs/`, and a library tree left anywhere the loader would find it is an error
(`ref.library-in-tree`). A qualified device reference (`vendor:tps7a02`) is an error too
(`ref.library-qualified-id`): after the import the device id is bare. The `<lib>:` in a symbol or
footprint reference is not a dependency — it is the directory under `assets/symbols/` (or
`assets/footprints/`) that holds the geometry.

Why a copy instead of a pinned dependency: the full argument is in
[ADR-0034](../adr/libraries/0034-trust-in-a-library-you-do-not-own.md). The short version
is that a content hash only pins a whole tree, review is per item, and the two disagree —
a three-hundred-device library would arrive unreviewed for the three devices you actually place.

## 2. Import

```sh
texteda lib import vendor --from /path/to/library --rev v2.1.0
```

- `--from <dir>` points at a directory that already exists. The command does not fetch: cloning
  the upstream repository at a tag is your step, and no gate in this repository needs a network
  ([ADR-0021](../adr/manufacturing/0021-the-manufacturing-output-path.md)).
- `--rev <tag-or-commit>` is required and selects the tree. A branch name is refused: it describes
  an instant, not a revision. The revision a *file* carries is its own `rev` (stamped from this
  one when the template has none), so re-importing a later release leaves the files it did not
  change at the revision they were reviewed at.
- `--only <id>[,<id>…]` imports a subset. A subset is legal here — there is no hash that would
  claim it is the whole revision — but it is **closed under references**: the symbols and
  footprints the chosen devices name are pulled in with them, because a device without its
  geometry cannot be drawn or matched against a land pattern.
- The template must be able to name itself: a device's `symbol` and `footprint` are library
  references (`lib:name`), and both must be written as `<name>:<id>`. A bare id, or somebody
  else's qualifier, refuses the import before anything is written — a bare id resolves to no
  directory under `assets/symbols/`, so the copy would arrive unable to draw. Two files of one id
  in one group are refused for the same reason the closure exists: a reference, a trust item and
  the copy's own path all name a file by its id alone.
- `--force` replaces files that already exist. Without it, an id that is already in `assets/`
  stops the import, naming the file: overwriting a device by accident is how a project loses a
  correction it made. What collides is the **id**, not the path: the directory under
  `assets/components/` is a filing choice (`spec/teda.md` §2), so an id the project already
  holds under another one stops the import as well, and `--force` does not resolve that — it
  replaces a file, it cannot merge two files of one id into one.
- `--dest <lib>` names the symbol/footprint library directory under `assets/symbols/` and
  `assets/footprints/` (default: the library name). The qualifier in the copied files is
  rewritten to it.

### What the copy looks like

```text
version 0.9.1
component tps7a02
# imported from vendor@v2.1.0 on 2026-10-24: verify before manufacturing, the template was not human-reviewed
rev v2.1.0
...
provenance generated
symbol vendor:tps7a02
footprint vendor:sot-23-5
```

The header comment is the record of where the file came from; the `rev` line above the scalars is
the revision whose facts it holds. Both are visible in a diff, neither changes a hash, and the
comment never enters the IR. There is no anchor file to update and nothing to verify later.

A device that already declares `provenance reviewed` in the template keeps it, attribution and
all: the copy is verbatim, so the claim travels with the facts it is about. The header then says so
instead of repeating the unreviewed warning:

```text
# imported from vendor@v2.1.0 on 2026-10-24: the template declares provenance reviewed (tz)
```

A template whose devices do not compile is refused, and so is one whose `reviewed` claim has no
attribution (`value.provenance-invalid`): import is verbatim, so a broken device would arrive in
`assets/` broken, with the error pointing at the copy instead of at the template.

## 3. Review

A device that the template did not vouch for arrives as `provenance generated`. A human who
compares the pin table, the electrical types and the ratings with the datasheet changes that line —
in the same file — to:

```text
provenance reviewed
verified_by tz
verified_on 2026-10-24
```

`reviewed` without both fields is an error (`value.provenance-invalid`): a claim nobody can be
asked about is worse than no claim. Nothing else is enforced — there is no signature and no
strict mode ([ADR-0033](../adr/libraries/0033-libraries-are-unverified-facts.md) D2); the point
is that the statement exists and is attributable.

`verified_by` is an **account or a name a reader can look up** — in practice the GitHub handle of
the person who did the comparison (`tz`). It is not a signature and not an email address: git
already records who committed the change, and the repository's public-tree gate refuses email
shapes in tracked files (`bun run check:public`).

**Review once, at the place the facts are born.** If the library is one you maintain, do the
comparison there, at the revision you are about to import: every project that imports it then
inherits the reviewed claim, and no project has to flip hundreds of files by hand. Flipping after
import is legal but local: it says "this copy was checked", which is what a per-file claim means,
and it does not travel back upstream. A claim written into a copy is that copy's own: a re-import
that finds the same facts at the same revision does not write the file at all (§5), so it cannot
withdraw the review.

### The library's trust record

When the review is one act over a whole library **you maintain**, write it once, in the library, not
once per file: `library.toml` at the library root.

```toml
[library]
name = "vendor"
source = "https://example.invalid/vendor"   # optional: where this library is published

[[trust]]
by = "tz"
on = "2026-10-24"
components = ["tps7a02@2.1.0", "bq24610@2.2.0"]
symbols = ["tps7a02@2.1.0", "bq24610@2.2.0"]
footprints = ["sot-23-5@2.0.0", "vqfn-24@2.2.0"]
```

`[library]` states what the tree is, never which revision it is (the files say that); `source` is
for the human who receives the tree, and is not written into imports.

- One `[[trust]]` entry per **act** — who checked, on which day — and each item names `id@rev`, the
  revision that was checked (the file's own `rev`). A review of files from three releases is one
  entry, not three; the list grows with what was verified, not with how the releases fell.
- An item applies to a file whose own `rev` equals it exactly. A file whose `rev` moved is
  unreviewed until an item names the new one; the record is about facts at a revision, not about a
  library forever. There is no `[library] rev` and no row-level `rev`
  ([ADR-0034](../adr/libraries/0034-trust-in-a-library-you-do-not-own.md)).
- Components the entry lists arrive with `provenance reviewed` and the recorded attribution.
  Components it does not list arrive `generated`. A file that already claims `reviewed` on its own
  keeps its own claim (it is more specific and it is what the template said).
- Symbols and footprints have no provenance field in the IR, so the record reaches them through the
  origin header: `# imported from vendor@v2.1.0 on 2026-10-24: reviewed (tz, 2026-10-24) as the
  library's trust record says`. That is a statement a reader can act on; it is not a gate. Gating
  geometry means giving `symbol` / `footprint` a claim of their own — a language decision, not
  something a comment can do.
- Every departure refuses the import: a `[[trust]]` entry without `by` or `on`, an id the library
  does not provide, two entries for one revision, an unknown key.

The record is read **at import time only**. Nothing at build time consults it, so a copy that is
edited afterwards cannot hide behind a review of what it used to be — the claim that `check` reads
is the one written in the same file as the facts.

### A library you do not own: the consumer's trust table

An upstream or "official" library will not carry a manifest in our subset, and you cannot add one to
it. The vouching act still belongs to the party that looked, so it lives on the consuming side, in a
file the importer is **given** ([ADR-0034](../adr/libraries/0034-trust-in-a-library-you-do-not-own.md)): nothing discovers it, there is no default path and no
environment variable.

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

```bash
texteda lib import vendor --from ../libs/vendor --rev v2.1.0 --trust ../trust/table.toml
```

- `library` is mandatory and must equal the name being imported: one table covers several upstream
  libraries, and an entry that does not say which one is ambiguous.
- The groups are reviewed separately, exactly as in a library manifest — listing a device does not
  vouch for its geometry.
- A row lists the items that were verified as `id@rev`; an entry that lists none is an error,
  because it would vouch for nothing. There is **no whole-library form**: "I did not look, but I will
  ship it" is a decision about a board, not a fact about a library. If nobody verified anything,
  write no row at all — the copies stay `generated` and each one carries the disclaimer header,
  which is the cheapest honest statement available.
- `by` / `on` are written per act, once: they must travel inside the copy, and a copy has no access
  to the repository that holds the table ([ADR-0034](../adr/libraries/0034-trust-in-a-library-you-do-not-own.md)
  decision 5). Pull requests and commit history corroborate the row; they cannot replace it.
- **The two records compose**: ids only one of them covers are vouched for by that one. The same id
  at the same revision with a different attribution is an **error**, not a precedence question — two
  people cannot be the author of one act. The origin header names the record that decided, file by
  file (`as ../trust/table.toml says` vs `as the library's trust record says`).
- Every departure refuses the import and writes nothing: a missing `by` / `on`, a malformed date,
  an item that is not `id@rev`, the same `(library, id, rev)` stated twice with different
  attribution, an unknown key, an id the library does not provide.

The table is organisation policy about libraries the organisation does not own, so it stays **out**
of the project tree — one file for many projects. Ownership decides which record exists, per library
([ADR-0034](../adr/libraries/0034-trust-in-a-library-you-do-not-own.md) D8):

| The library | The tree | The record |
|---|---|---|
| someone else's (an upstream or "official" library) | none — it is never mirrored or re-published | this table, passed with `--trust` |
| the organisation's own (its private library) | maintained, released and reviewed by the organisation | that tree's `library.toml` |

So a company usually has both: a table for what it consumes and a tree for what it owns. Having both
for the *same* library is the thing to avoid — two statements of one review, one of them stale.

**Re-importing does not re-stamp the files a release did not touch.** Each copy carries the
revision it was imported at (`rev`, [ADR-0034](../adr/libraries/0034-trust-in-a-library-you-do-not-own.md)). On
`--force`, the importer compares the template's facts with the copy's — everything except the origin
header, the stamped `rev`, a component's `version` line and the provenance block it derives from a
record. Same facts: the copy keeps its revision, its claim and its date, and is not written at all
(the run says how many). Changed facts: the file takes the revision being imported and its items are
matched again, so a file whose revision moved is unreviewed until a row names the new one.

That comparison is the whole mechanism — local, at import time, with no hash recorded anywhere. Two
consequences worth knowing:

- A copy you edited shows up as changed facts; re-importing it with `--force` replaces your edit.
- A copy whose facts match the library again (the edit was reverted, or a fork marker outlived it)
  rejoins the library's revision when you re-import: `+local.N` describes the facts, and the
  comparison is the check of that statement.

`rev` is a fact of the file, not a lock: it lives in the component's shard and therefore in the
project hash, exactly like `provenance` — a reviewed copy and an unreviewed one are not the same
build, and a copy that moved to a new release changes the hash even if no pin did. There is still no
lockfile and nothing to reconcile at build time; the only reader of `rev` is `lib import`.

The import prints the files no record vouches for, so "imported unreviewed" is visible per file
rather than assumed for the tree.

## 4. Correcting a device

Edit the file. It is yours. There is no derived file and no override: the library's version was
a starting point, not a reference the project must agree with.

## 5. Updating from upstream

Re-run the import for the ids you took, with `--force`, then read the diff. Files whose facts did
not change are not rewritten at all — the run says how many it kept at their imported revision —
so the diff is the files the release actually touched. The header line dates each file, so
`git log` on `assets/` answers "how far behind is this copy" without a lockfile.

`--force` replaces, it does not merge: a correction you made locally is overwritten if the
template's facts differ from it. Read the diff before you commit, or run the import without
`--force` first and let it name the ids that already exist.

## 6. When you want to share devices between your own projects

Publish them as a library (they are already the right shape: `components/`, `symbols/`,
`footprints/`, each file carrying the `rev` in which its facts were last established, plus a
`library.toml` with `[library] name` and the trust entries you are willing to stand behind), and at
that point the dependency machinery returns — for a library you maintain,
where a revision bump is your own decision. Deferred until a second project exists
(`docs/backlog.md` F29), and it does not change this guide: the consuming project still imports.
