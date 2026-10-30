# The Shape of the Decision-Record Corpus

How the corpus is filed, and how a record is added. The rules themselves live where they are
enforced: the record shape in `AGENTS.md` §12, the numbering and the retired range in
`docs/adr/README.md`, each folder's scope in its own `README.md`, the gate's rules in
`scripts/check-links.ts`.

## Where a record goes

A record lands in a folder by **what the decision governs**, not by the layer it mentions, not by
the artifact it produces, and not by when it was written.

- A decision that mentions a schematic *and* a pcb is a decision about the boundary between them,
  so it goes where boundaries live, not in either side.
- A decision about how a number is written belongs to the language, whether it appears in a
  schematic, a pcb, or a device file.
- A decision about a file format belongs to the artifact, not to the workflow that produces it.

Each folder answers three questions in its README: **what it decides**, **what it does not decide
(and where that lives instead)**, and **in what order to read it**.

## Adding a record

**A new record takes the next free number and disturbs nothing.**

1. Take the next free number (the highest one in use, plus one) and write
   `docs/adr/<topic>/NNNN-<slug>.md`. The number does not encode the topic, so the folder is
   chosen freely; a new folder needs its own `README.md`.
2. Give it the header `AGENTS.md` §12 prescribes: `Status:`, `Date:`, a `Scope:` line that says
   what it decides and what it does not, and a `Related:` line — symmetric, so add the new number
   to every record it names and to the ones that name it.
3. Add the index row under the record's folder section in `docs/adr/README.md`.
4. If the record retires another, name the superseding record in the retired one's `Status:`.

No other number moves, so no citation in the repository has to change.
