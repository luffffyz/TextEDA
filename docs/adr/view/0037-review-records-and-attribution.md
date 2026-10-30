# ADR-0037: Review Is Not a Description Type — Notes, Decisions, and the One Accountable Person

Status: Accepted
Date: 2026-10-22
Scope: Decides: that a review is a record and not a description type, and that one project has exactly one accountable person. Does not decide: how a review is displayed — see `docs/guides/review-app.md`.
Related: [ADR-0033](../libraries/0033-libraries-are-unverified-facts.md), [ADR-0035](0035-the-view-layer-is-a-drawing.md), [ADR-0036](0036-our-own-reference-renderer.md), [ADR-0040](../process/0040-process-entities-outside-the-language.md)
Impact: `docs/guides/review-records.md`; `docs/guides/role-reviews.md`; `packages/core/src/review/**`

## Background

[ADR-0033](../libraries/0033-libraries-are-unverified-facts.md) gave every library item a `provenance`, and
left one question open: how a reviewed part is signed, if at all.

That question was framed too narrowly. Review is not a library mechanism. In a team, people
review the **design** — the board, a print page, a part someone else wrote — and the review has
to leave a trace: who looked, what they saw, and what was decided about it.

Today that trace is a wiki page or a chat message. It is not in the repository, so it is not
diffed, not reviewed in the same pull request as the change it comments on, and not checked by
anything. The board's exit criterion in `AGENTS.md` §1.2 even lists a review record, and there is
nowhere to put one.

Two things shape the answer.

**Review produces observations, and observations are not decisions.** In a project there is
exactly one person who is finally accountable for the design: the person who created it, or the
person who took it over. Everyone else who reviews writes down what they saw; whether those
observations are adopted is the accountable person's call. A tool that treats a reviewer's note
as a verdict would be inventing authority that does not exist.

**A project may accumulate hundreds of notes.** That number is the second shape, and it decides
the format.

## Decision

### 1. One shape of review, three kinds of target

A review says **who looked at what, when, what they saw, and what was decided**. That shape is
the same everywhere; only the target differs:

| Target | Where the record lives |
|---|---|
| A library item | The record itself: `provenance`, `verified_by`, `verified_on` ([ADR-0033](../libraries/0033-libraries-are-unverified-facts.md) decision 1) |
| A design (a board, a print page) | A review round in this project |
| A part the project derived from a library | A review round whose target is that component, next to the derived file ([ADR-0033](../libraries/0033-libraries-are-unverified-facts.md) decision 3) |

All of them are **attributed statements**, not proofs. Nothing here certifies that a human read a
datasheet; it records that somebody said so, and makes the statement visible to the people who
depend on it.

### 2. Reviews are not a description type

The notes of a review are **prose**, and a project accumulates hundreds of them. They are not a
description, and the language is not the right container for them:

- The language is **one fact per line, in tables of fixed columns**. Notes are prose of arbitrary
  length, and a round of them is not a table of facts.
- The language has **no prose form** — no quoting, no escaping, no text fields. Notes would have
  to be smuggled into a column, which is the language working against itself.
- A review record is **not an input to anything that is built**. It needs no schema, no IR
  shard, no canonical form, and no hash. Putting hundreds of notes into the shard tree would
  add hash noise for a thing no build reads.
- The language is **strict by design** — an unknown construct is an error. Review notes are
  written quickly, by several people, in parallel; a strict parser is the wrong instrument for
  them.

So there is no `review` description type, no `review` schema, and no review shard.

### 3. Notes are Markdown, one file per round

Review records live in `docs/reviews/`, next to the design intent and the analysis evidence
([ADR-0008](../project/0008-project-tree-has-owners.md) decision 1) — they are about the project, not about
the circuit, so they do not belong inside `design/`.

A round's notes live in `docs/reviews/<round_id>.md` — prose, diffable, readable by anyone:

```markdown
# Review of mcu-board, round 1

- alice (2026-10-22): U3 power supply part does not match the BOM
- bob (2026-10-22): R7 value does not match the BOM
```

The convention is deliberately minimal: one bullet per note, the author and the date in front,
the observation after the colon. **The tools do not parse the notes.** They are read by people;
the machine reads the decision.

### 4. The decision is a small TOML file

The three facts the tools need — who decided, when, and what was decided about which target —
are in `docs/reviews/<round_id>.decision.toml`:

```toml
target  = "board:mcu-board"
owner   = "carol"
date    = "2026-10-23"
verdict = "accepted"
```

- `target` is `board:<board_id>`, `page:<board_id>/<page_id>` or `component:<component_id>`.
- `owner` is the accountable person.
- `verdict` is `accepted`, `declined` or `deferred`.

TOML is used because the project already uses it for the small metadata files that are not
descriptions (`project.toml`, the library reference), and because a decision is metadata about a
process rather than a fact about the design.

The verdicts are about **the notes of that round**:

| Verdict | Meaning |
|---|---|
| `accepted` | The notes have been dealt with and the accountable person stands behind them. For a board, this is the sign-off. |
| `declined` | The notes are recorded and not adopted. The reasoning is a note the accountable person wrote. |
| `deferred` | The notes are postponed to a later revision. |

### 5. One project has exactly one accountable person

The project's accountable person is its **creator**, or whoever took it over. It is a fact of
the project, recorded in `project.toml`:

```toml
[project]
owner = "carol"
```

Handing a project over is changing that field. The handover stays visible: every decision
records the person who made it, and the checker warns when a decision's owner is not the current
owner — either somebody decided without the authority, or the handover was never recorded.

The owner is **not** part of the design's identity. Changing the owner changes no hash and
invalidates no build: ownership is a fact about the project, not about the design. Putting the
field in the `project` shard would do exactly that, so the parser returns it **beside** the IR
rather than inside it, and no schema changes. It is project metadata read by the review check,
nothing else.

### 6. Reviewers write notes; the accountable person decides

A note carries **no verdict**. What a reviewer thinks is a note; what the project accepts is the
accountable person's decision. The tool never speaks for the accountable person, and it never
treats a note as a decision.

A round is **closed** when it has a decision. A round with notes and no decision is
**unclosed**. Notes that arrive after a decision belong to a new round, so that the decision on
one round never has to be reinterpreted.

### 7. Two checks, and no gate

`check` reports:

| Diagnostic | Severity | Meaning |
|---|---|---|
| `review.round-unclosed` | warning | A round has notes and no decision. Someone raised something and nobody has answered it. The report carries the target, the authors, the date and the notes. |
| `review.owner-mismatch` | warning | A decision's `owner` is not the project's owner. Either somebody decided without the authority, or the handover was never recorded in `project.toml`. |
| `review.owner-missing` | error | The project has review rounds and names no owner. |
| `review.decision-invalid` | error | A decision file is missing a field, or carries a verdict outside the closed set. |

The first two are warnings and neither fails the build, and neither changes any hash. The reason
is that a review's state is a human process, not a property of the design. The tool's job is to
make it impossible to miss, not to decide what a team may ship.

**The missing-owner case is an error, not a warning.** With no accountable person, *every*
decision a project writes is unauthorised, so a warning would report the symptom (each round
unclosed) and hide the cause. The check therefore emits the error once per project, in addition
to the unclosed warning that the round genuinely has.

**Review problems get their own diagnostic domain.** The domain vocabulary is closed, and adding
one needs a decision of its own — this is that decision. Review problems are neither `value` nor
`ref` nor `cli`: they are about the process, and a reader of a report should be able to see at a
glance that "nobody answered this" is not "the design is wrong".

### 8. Attribution is the default; a signature is for distribution, not for review

- **Who wrote what** is already recorded by the version control: the commit that carries the
  file says who wrote it. The author in a note and the owner in a decision are there for the
  reader — *whose observation this is*, *whose decision this is* — not to prevent forgery.
- **A signature cannot certify a review.** It binds a statement to an identity; it says nothing
  about whether the reviewer compared the pin table with the datasheet. The lever for review
  quality is a **published criterion** plus a visible attribution, which is what ADR-0033
  already settled for library items.
- Therefore **reviews are not signed**. The only place a signature could ever matter is the
  distribution of a **library** — "who published this" — and even there it would be at most a
  **library-level** signature over the library's `content_hash`, never a signature per part. It
  is not done now, for the same reason ADR-0039 records: this project has no operator, no key
  distribution, and no service to keep running.

This closes the open question of [ADR-0033](../libraries/0033-libraries-are-unverified-facts.md).

## Consequences

- The project gains a place to put review notes, and `check` gains a way to show that a board
  has notes nobody has answered. The board's exit criterion in `AGENTS.md` §1.2 becomes
  checkable.
- The tool never speaks for the accountable person. A note is not a verdict, and a reviewer
  cannot close a round; only a decision by the owner can.
- A library item's review claim and a design's review record are the same idea in two places.
  A project that disagrees with a library writes a review round about the component, and the
  derived file that acts on it ([ADR-0033](../libraries/0033-libraries-are-unverified-facts.md) decision 3)
  references the same component.
- The trust story of the ecosystem stays what it was: statements are attributed and visible;
  nothing is certified.

## Open Points

- Whether a note may be bound to a specific instance, net or footprint, and whether the
  accountable person may dispose of notes one by one rather than per round. Version 1 keeps the
  decision at the level of the round.
- Whether an unclosed round blocks the manufacturing output is **not** open: it does not. A trial
  build is never blocked — the sample is what the review is waiting for. A production release
  needs each round to be closed or its risk explicitly accepted and recorded by the accountable
  person. The gate is a process; the tooling reports the review state and does not block on it,
  and the state is never embedded in the manufacturing data (it moves while the design does not).
  See ADR-0021.
- Whether signing off a board and accepting a round of notes are one fact or two. Version 1 folds
  them into `accepted`.
- Whether many people appending to one round's Markdown file is acceptable, or whether a round
  should be split per author.
