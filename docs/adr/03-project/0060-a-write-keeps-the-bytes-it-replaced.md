# ADR-0060: A Write Keeps the Bytes It Replaced

Status: Accepted
Date: 2026-11-04
Scope: Decides: that a write to a source file keeps the bytes it replaced, under `dist/backups/`, mirroring the file's own path. Does not decide: what a print page contains or how it is rendered — see [ADR-0035](../09-view/0035-the-view-layer-is-a-drawing.md); which files the review app may write — see [ADR-0056](../09-view/0056-the-review-app-has-one-interaction-surface.md).
Related: [ADR-0008](0008-project-tree-has-owners.md), [ADR-0035](../09-view/0035-the-view-layer-is-a-drawing.md), [ADR-0056](../09-view/0056-the-review-app-has-one-interaction-surface.md), [ADR-0061](../09-view/0061-a-move-carries-only-what-belonged-to-the-net.md), [ADR-0043](../09-view/0043-the-review-app-is-a-plugin-of-the-agent-workbench.md).
Impact: `packages/cli/src/layout.ts`; `docs/guides/review-app.md`

## Context

The review app writes a print page when the reviewer applies a placement change. The write is
already atomic: the bytes go to a temporary name and a rename puts them in place, so a reader sees
either the old page or the new one, never half of each. That protects against a crash *during* the
write.

It does not protect against a write that succeeded and was wrong. A reviewer nudges a symbol onto
the wrong net, applies, and the page now says something false — and the previous version is gone.
The reviewer has the page's own history in git, but only if the page was committed, and a
scratch project has no such history.

The review app has an undo of its own for changes that were not applied, but nothing for changes
that were: once the write lands, the old bytes exist only if something kept them.

## Decision

### D1. A write keeps what it replaced

Before a source file is written, the bytes it is about to replace are kept under `dist/backups/`,
mirroring the file's own path below that root. `views/main.view.teda` is kept as
`dist/backups/views/main.view.teda`.

The backup holds the state before *this* write, so after a second write the backup is the first
write's result: one step back is always available, and stepping back twice means writing the older
bytes again, not replaying history.

A write that changes nothing keeps nothing. A file that does not exist yet has no previous bytes to
keep.

### D2. The backup is a derived artifact

`dist/backups/` sits under `dist/`, which holds derived artifacts: it is gitignored, it is not part
of the project's identity, and nothing in the build reads it. A backup is a local undo, not a
second copy of the project and not a source of truth.

The backup mirrors the source path rather than piling into one directory, so a page keeps its place
in the tree and a reader can tell which page a backup belongs to.

### D3. The backup is written atomically too

The backup is written through a temporary name and renamed into place, like the file it is keeping.
A crash during the backup cannot leave a torn backup that would later be restored over a good file:
the restore is a copy of bytes that were complete when they were taken.

## Consequences

- A write that was wrong can be put back by copying the backup over the file. The app does not offer
  an undo action; the backup is there to be used by whoever is undoing their own change.
- The backups accumulate. They are local and gitignored, so they cost disk and nothing else; a
  project that writes a lot keeps a lot.
- A file that is written but never committed still has its previous version on disk, which is what
  makes the undo work for scratch projects.
- The write path now touches two files instead of one. The second is under `dist/`, so the project's
  own files are still the only ones the write changes.
