# ADR-0041: Documentation Has One Authority per Fact, and the Rest Is a Pointer

Status: Accepted
Date: 2026-10-27
Scope: Decides: that each fact has exactly one authority and every other mention is a pointer. Does not decide: what the authorities say — see `spec/**`.
Related: [ADR-0002](../01-language/0002-one-language-version-number.md), [ADR-0003](../01-language/0003-diagnostic-error-codes.md), [ADR-0038](0038-implementation-stack-and-agent-entry.md), [ADR-0040](0040-process-entities-outside-the-language.md)
Impact: `AGENTS.md` §12; `scripts/check-links.ts`; `docs/backlog.md`

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

`spec/teda.md` has never had a 7.7 — the flattening rule it means is in `spec/teda.md` §7.6. The pointer was already
wrong when it was written and stayed wrong because nothing resolved it. Four more of the same kind
existed in live documents: a section number meaning "the seventh invariant" in a chapter with no
subsections, a rule number written as a section number, and three in the shape above where the rule
was in `AGENTS.md` all along.

The corpus is not unusually sloppy; it is unusually **large** — hundreds of Markdown files, thousands
of links, hundreds of qualified section references and bare ones, and hundreds of backlog-item
references. At that size, correctness of prose cannot rest on the reviewer's memory of what a
number used to mean.

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
  resolved to a specific file, because it cannot be: most bare references name a number that more
  than one file declares. The rule that follows is D3.
- `F12` resolves to a `## F12.` heading in `docs/backlog.md`, or to the closure list in its preamble
  where a finished item is recorded as closed. A number that is neither is reported.

**D3. Write the qualified form outside the file that owns the section.**

A bare `§N` is legal inside the file that declares it. Everywhere else, write `spec/pcb.md §4.9`.
A reader who has to guess which file a bare section number belongs to is the same reader who will later guess
wrong, and the gate cannot help them: it is not that the check is lenient, it is that the reference
carries no information to check.

This is a writing rule, not a gate rule. The gate accepts a bare number that exists somewhere
because rejecting 566 of them on the day it lands would make the check noise instead of signal.

**D4. A dead pointer is an error in a live document and a warning in a record.**

`docs/adr/**` and `docs/trial-run/**` state what was true when they were written. A pointer that has
since rotted there is reported as a warning and is **not** rewritten: editing a decision record to
chase a moved section destroys the attribution the record exists for, and the same reasoning that
forbids rewriting a decision's text (a dated addendum or a superseding record, never an edit) forbids
rewriting its pointers.

Everywhere else — spec, guides, READMEs, `AGENTS.md`, `skills` — a dead pointer fails the build.

**D5. A fact that must live twice is pinned by a test, not by care.**

D1 says a fact lives in one place. Two places are not a rule change — they are a fact that cannot
be stated once, and such a pair has to be pinned rather than trusted.

The language version table is the case. `spec/teda.md` §13.1 has to list it, because the contract
layer has to be readable on its own by a third-party implementer who will never open this
repository. `packages/parser/src/version.ts` has to hold it, because the parser decides what it
accepts. The two are not the same statement either: the spec carries the patch component of the
current surface, and the parser deliberately tracks only the minor, because a patch never changes
the acceptance decision.

So the spec table is a table (a row per description type, with the current version, the version
the type was born at, and the accepted range) rather than a sentence in prose, and
`packages/parser/test/version-spec.test.ts` reads that table and compares it with what the parser
accepts. Raising a type's version now fails a test instead of quietly making the spec wrong.

The same move is available wherever a document has to be self-contained and a program has to agree
with it. The gate for that is a test, not a link check: a link check proves the pointer resolves,
not that the two ends say the same thing.

**D6. The moving values are not in the index, and the changelog pins the current one.**

- **The current values are not in the index.** The current language version and the current IR
  contract version must not appear in `AGENTS.md` outside a code span. They are the facts that
  move, and a copy of a moving fact in the index is a copy that will be wrong. The version table
  in `spec/teda.md` §13.1 and the directory name under `schemas/ir/` own them.
- **The changelog's newest entry is the current version.** The language's changelog lives in
  `spec/teda.md` §13.4, one entry per version, newest first. A version that is not in the changelog
  cannot be the current one, which is what makes "record a changelog entry" a rule with teeth
  instead of a habit.

The disease D1 names was already visible in the corpus while this was decided: both READMEs said
the repository held "54" decision records, and it held more. The counts are gone; the index link
is there instead.

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
