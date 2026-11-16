# Review Records

How a project records what its reviewers saw, and what the accountable person decided about it.

Decision: [ADR-0037](../adr/09-view/0037-review-records-and-attribution.md). This file is the convention; the
decision is the reason.

## The shape

| Thing | Where | Form |
|---|---|---|
| A round (what reviewers saw, and what was decided about it) | `docs/reviews/<date>-<slug>.md` | Markdown: four plain lines, then prose |
| The accountable person | `project.toml` → `[project] owner` | one name |

A **round** is one review pass over one target, and it is **one file**. The date is the day the
round happened and the slug names what it looked at: `2026-10-23-main-sch-r1`,
`2026-10-23-charger-buck-pcb-r1`, `2026-11-16-tps7a02-correction`. A date in the name sorts the
rounds in the order they happened, and the slug keeps the artifact visible.

Reviews are **not a description type**. They are not in the language, they have no schema, they
produce no IR shard, and they change no hash. A project may accumulate hundreds of notes; prose
is the right container for them, and the tools do not parse it.

## Notes

One bullet per note, the author and the date in front, the observation after the colon:

```markdown
# Review of mcu-board, round 1

- alice (2026-10-22): U3 power supply part does not match the BOM
- bob (2026-10-22): R7 value does not match the BOM
```

The convention is deliberately minimal so that a round can be written by several people in one
sitting without arguing about the format. Notes carry **no verdict**: what a reviewer thinks is
a note; what the project accepts is the accountable person's decision.

The tool does not read the notes. It reads the decision at the top of the file, and it reports
which rounds have notes without a decision.

## The decision

The four facts stand at the top of the round's own file, **above the notes**: the tool reads the head
of the file and stops at the first note, so a decision written below the notes is not read — the
round stays open, which is the safe way to be wrong.

```
target: board:mcu-board
owner: carol
date: 2026-10-23
verdict: accepted
```

| Field | Value |
|---|---|
| `target` | `board:<board_id>`, `page:<page_id>`, `component:<component_id>` or `repo` |
| `owner` | The accountable person (see below) |
| `date` | `YYYY-MM-DD` |
| `verdict` | `accepted`, `declined` or `deferred` |

`repo` names a round about the repository itself — its toolchain, its records, its library —
rather than about a design. The set has no `project:` form, so a decision on `board:<board_id>`
is not project-wide sign-off.

| Verdict | Meaning |
|---|---|
| `accepted` | The notes have been dealt with and the accountable person stands behind them. For a board, this is the sign-off. |
| `declined` | The notes are recorded and not adopted. The reasoning is a note the accountable person wrote. |
| `deferred` | The notes are postponed to a later revision. |

A round is **closed** when its file carries the four facts. Notes that arrive after a decision
belong to a new round, so that a decision is never reinterpreted.

## The accountable person

One project, one accountable person: the creator, or whoever took the project over.

```toml
[project]
owner = "carol"
```

Handing a project over is changing that field. Ownership is a fact about the project, not about
the design: changing it changes no hash and invalidates no build.

Only the accountable person decides. A reviewer writes notes; the owner writes the decision.
A decision whose `owner` is not the project's current owner is reported as a warning — either
somebody decided without the authority, or the handover was never recorded.

## What `check` reports

> Status: **implemented** — `texteda check` reads the four facts at the top of each round file and
> reports the cases below ([ADR-0037](../adr/09-view/0037-review-records-and-attribution.md)). The
> notes stay prose: the tool reads the head of the file, not the notes. How to run a round with
> several roles is in [role-reviews.md](role-reviews.md).

| Diagnostic | Severity | Meaning |
|---|---|---|
| A round with notes and no decision | warning | Someone raised something and nobody has answered it |
| A decision whose `owner` is not the project's owner | warning | Authority, or an unrecorded handover |
| Review rounds but no `owner` in `project.toml` | error | Nobody is accountable for the notes |

None of these fail the build, and none of them change a hash. A review's state is a human
process, not a property of the design.

## Library items

A review of a **library item** is a claim about the record, and it lives in the record:
`provenance`, `verified_by` and `verified_on` ([ADR-0033](../adr/08-libraries/0033-libraries-are-unverified-facts.md)).
When a project disagrees with a library item, it writes a round whose `target` is that component,
next to the derived file that acts on the disagreement.

## No signatures

Reviews are not signed. The version control already records who wrote what; the author in a note
and the owner in a decision are there for the reader. A signature could at most bind a statement
to an identity — it says nothing about whether the pin table was compared with the datasheet. The
lever for review quality is a published criterion plus a visible attribution.
