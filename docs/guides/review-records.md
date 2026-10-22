# Review Records

How a project records what its reviewers saw, and what the accountable person decided about it.

Decision: [ADR-0033](../adr/0033-review-records-and-attribution.md). This file is the convention; the
decision is the reason.

## The shape

| Thing | Where | Form |
|---|---|---|
| Notes (what reviewers saw) | `docs/reviews/<round_id>.md` | Markdown, prose |
| Decision (what was decided about them) | `docs/reviews/<round_id>.decision.toml` | TOML, four facts |
| The accountable person | `project.toml` → `[project] owner` | one name |

A **round** is one review pass over one target. The `round_id` is a short slug, unique in the
project: `mcu-board-r1`, `mcu-board-r2`, `tps7a02-correction-1`.

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

The tool does not read the notes. It reads the decision file, and it reports which rounds have
notes without a decision.

## The decision

```toml
target  = "board:mcu-board"
owner   = "carol"
date    = "2026-10-23"
verdict = "accepted"
```

| Field | Value |
|---|---|
| `target` | `board:<board_id>`, `page:<board_id>/<page_id>` or `component:<component_id>` |
| `owner` | The accountable person (see below) |
| `date` | `YYYY-MM-DD` |
| `verdict` | `accepted`, `declined` or `deferred` |

| Verdict | Meaning |
|---|---|
| `accepted` | The notes have been dealt with and the accountable person stands behind them. For a board, this is the sign-off. |
| `declined` | The notes are recorded and not adopted. The reasoning is a note the accountable person wrote. |
| `deferred` | The notes are postponed to a later revision. |

A round is **closed** when it has a decision. Notes that arrive after a decision belong to a new
round, so that a decision is never reinterpreted.

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

| Diagnostic | Severity | Meaning |
|---|---|---|
| A round with notes and no decision | warning | Someone raised something and nobody has answered it |
| A decision whose `owner` is not the project's owner | warning | Authority, or an unrecorded handover |
| Review rounds but no `owner` in `project.toml` | error | Nobody is accountable for the notes |

None of these fail the build, and none of them change a hash. A review's state is a human
process, not a property of the design.

## Library items

A review of a **library item** is a claim about the record, and it lives in the record:
`provenance`, `verified_by` and `verified_on` ([ADR-0028](../adr/0028-library-trust-and-derived-overrides.md)).
When a project disagrees with a library item, it writes a round whose `target` is that component,
next to the derived file that acts on the disagreement.

## No signatures

Reviews are not signed. The version control already records who wrote what; the author in a note
and the owner in a decision are there for the reader. A signature could at most bind a statement
to an identity — it says nothing about whether the pin table was compared with the datasheet. The
lever for review quality is a published criterion plus a visible attribution.
