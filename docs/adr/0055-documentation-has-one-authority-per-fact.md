# ADR-0055: Documentation Has One Authority per Fact, and the Rest Is a Pointer

Status: Accepted
Date: 2026-10-27
Related: [ADR-0016](0016-diagnostic-error-codes.md), [ADR-0019](0019-agent-contract-reference-and-check-entry.md), [ADR-0022](0022-language-versioning.md), [ADR-0033](0033-review-records-and-attribution.md)
Impact: `scripts/check-links.ts` (section references and backlog items); `AGENTS.md` §10, §12; `docs/backlog.md` F50

## Background

The prose corpus had grown three diseases that only a full re-read could find.

The first is **duplicated definition**. The same fact — the current contract version, the number of
devices in the reference project, the `project.toml` key table — was stated in `AGENTS.md`, in
`docs/comparison.md`, in a dozen decision records and in both READMEs. Every bump of a version was a
search-and-replace across 45 files, and missing one left a document asserting something false.

The second is **contradiction**, and it follows from the first: when two copies disagree, nothing
says which one wins. A reader has to guess, and an agent has to read both and prefer the newer-looking
one.

The third is **positional drift**. This reference was cited from seven places:

```
teda.md §7.7
```

`spec/teda.md` has never had a 7.7 — the flattening rule it means is in §7.6. The pointer was already
wrong when it was written and stayed wrong because nothing resolved it. Four more of the same kind
existed in live documents: a section number meaning "the seventh invariant" in a chapter with no
subsections, a rule number written as a section number, and three in the shape above where the rule
was in `AGENTS.md` all along.

The corpus is not unusually sloppy; it is unusually **large** (96 Markdown files, 1414 links, 656
qualified section references, 398 bare ones, 380 backlog-item references). At that size, correctness
of prose cannot rest on the reviewer's memory of what a number used to mean.

Two properties made this fixable rather than merely regrettable:

- the reference forms are **mechanical**, so a gate can resolve them;
- the documents split into two kinds — those that describe **now** (spec, guides, READMEs,
  `AGENTS.md`) and those that record **then** (decision records, trial-run logs) — and only the
  first kind is obliged to stay true.

## Decision

**D1. One authority per fact; everything else holds a pointer.**

A fact lives in exactly one file. The current contract version lives in `spec/teda.md` §13.1 and in
`schemas/ir/v0.14/`; the `project.toml` keys live in `spec/project.md`; the KiCad size measurements
live in `docs/comparison.md`; a package's behavior lives in its source. Anywhere else, the fact is
either omitted or written as a pointer to the file that owns it.

`AGENTS.md` obeys this literally: it states what is landed and what is missing, never how it works.
When a sentence in it could be replaced by "see X", it is replaced by "see X".

**D2. A reference form must resolve, or it is not allowed.**

Three forms are checked by `bun run check:links`:

- `file.md §N` resolves against the numbered headings of that file. A list (`teda.md §7, §7.5`) binds
  every following number to the named file; a section number separated from the file name by
  anything but a separator is not bound and is not checked against it.
- a bare `§N` is accepted only if this file or some file in the tree declares that number. It is not
  resolved to a specific file, because it cannot be: 557 of the 566 bare references name a number
  that more than one file declares. The rule that follows is D3.
- `F12` resolves to a `## F12.` heading in `docs/backlog.md`, or to the closure list in its preamble
  where a finished item is recorded as closed. A number that is neither is reported.

**D3. Write the qualified form outside the file that owns the section.**

A bare `§N` is legal inside the file that declares it. Everywhere else, write `spec/pcb.md §4.9`.
A reader who has to guess which file a `§4.9` belongs to is the same reader who will later guess
wrong, and the gate cannot help them: it is not that the check is lenient, it is that the reference
carries no information to check.

This is a writing rule, not a gate rule. The gate accepts a bare number that exists somewhere
because rejecting 566 of them on the day it lands would make the check noise instead of signal.

**D4. A dead pointer is an error in a live document and a warning in a record.**

`docs/adr/**` and `docs/trial-run/**` state what was true when they were written. A pointer that has
since rotted there is reported as a warning and is **not** rewritten: editing a decision record to
chase a moved section destroys the attribution the record exists for, and the same reasoning that
forbids rewriting a decision's text (a dated addendum or a superseding record, never an edit) forbids
rewriting its pointers. The twelve dead pointers currently reported are listed in `docs/backlog.md`
F50 and go away when those records are next rewritten for other reasons.

Everywhere else — spec, guides, READMEs, `AGENTS.md`, `skills` — a dead pointer fails the build.

## Consequences

The gate found four dead pointers in live documents and twelve in records, on its first run. The four
were fixed; the twelve are recorded. That is the whole return on the check so far, and it is more
than a re-read had found in two review rounds.

The cost is a rule that has to be learned: a section reference outside its own file must name the
file. It is a small cost, and it is paid at writing time, when the author still knows which file they
mean — which is the only moment that knowledge is cheap.

`AGENTS.md` shrank from 122 KB to 106 KB in the commit that applied D1, not because a size target
exists but because the pointer rule removed text that had no business being there.

What this does **not** fix, and is not meant to: prose that is simply wrong about behavior, a
decision that no longer holds, and a count that is correct today and stale next month. The gate
resolves pointers, not claims. Those stay on the reviewer, and the point of D1 is to make the set
small enough that a reviewer can hold it.

## Alternatives considered

**A documentation site generator.** Rendering the corpus would not change who owns each fact; the
duplicates would still be duplicates in source. Rejected as a solution to the wrong problem (the
problem is authorship, not presentation).

**One big auto-generated reference.** Fine for the contract (`docs/ir-reference.md` already is one)
and useless for prose: the parts that drift are the judgments, and a generated page cannot hold a
judgment.

**Gate the bare `§N` form as an error immediately.** Rejected for the reason in D3: 566 occurrences
on day one, most of them inside the file that declares the section, and a gate that starts red gets
disabled rather than satisfied.

**Rewrite the twelve dead pointers in the records.** Rejected as D4: it destroys the distinction
between "this was believed then" and "this is what we say now", which is the only thing a decision
record has that a wiki page does not.
