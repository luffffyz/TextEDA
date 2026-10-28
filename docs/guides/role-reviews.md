# Role Reviews

A round records what reviewers saw and what the accountable person decided ([ADR-0136](../adr/view/0136-review-records-and-attribution.md); the file convention is [review-records.md](review-records.md)). This guide adds one thing on top of that: **how to run a round from several roles' points of view**, so that the notes cover the failures one reviewer would not think to look for.

Roles are not personas. A role differs from another role in exactly three ways:

| Dimension | Question to answer per role |
|---|---|
| Input set | What is it allowed to read? |
| Loss function | Which failure is it paid to find? |
| Blind spot | What is it deliberately not shown? |

Drop any of the three and two "roles" produce the same review with different vocabulary. The blind spot is the one people leave out. A reviewer who reads the designer's reasoning reviews the reasoning, not the design; the first answer it finds is the one the designer already believed.

## The role set

### Definition

| Role | Signs off on | Reads | Blind to |
|---|---|---|---|
| Requirements / product | measurable acceptance criteria per requirement | nothing machine-readable: requirements are prose ([ADR-0139](../adr/process/0139-process-entities-outside-the-language.md)) | the implementation |
| System architect | interface table, power tree, clock tree | `system` shards, every board's `ports` and `constraints` | module internals |
| Project manager | milestones, long-lead risk register, baseline freeze | the risk list and dates | electrical detail |
| Accountable person (`owner`) | the decision file | the notes | — (may not write notes of its own in the same round) |

### Design

| Role | Signs off on | Reads | Blind to |
|---|---|---|---|
| Hardware engineer | the schematic: instances, nets, constraints, ports | `schematic` IR, `component` pin facts and ratings | layout, other roles' notes |
| Component / sourcing engineer | MPN, lifecycle, alternates, derating | `component` `ratings` and `params`, `procurement` shards | the circuit |
| Analysis (SI / PI / thermal / timing) | worst-case conclusion and its assumptions | the nets and constraints it is asked about | the intent, and any earlier conclusion |
| Library owner | symbol pin set, land pattern | `assets/{symbols,footprints}` with `lib:verify` | board usage of the part |
| Layout engineer | stackup, placement, routing, rules | `pcb` IR, the netlist, outline and keepouts | why each net is connected that way |
| Mechanical engineer | outline, connector positions, height and keepouts, assembly order | `outline`, `keepout`, `place` | electrical performance |
| Firmware engineer | power sequencing, strap pins, debug access | `ports`, the nets around boot and reset, `physical_only` | layout detail |

### Build and supply

| Role | Signs off on | Reads | Blind to |
|---|---|---|---|
| DFM / process engineer | capability conformance | `pcb` IR against a capability sheet | design intent and review history |
| Assembly (SMT) | stencil, coordinates, variant handling | BOM, placement, variants | schematic |
| Purchasing | lead time, MOQ, alternates exist | `procurement` primary and alternatives | the circuit |
| Production test (ICT / FCT) | test point coverage, fixture feasibility | `test_point`, `physical_only`, `ports`, acceptance criteria | the designer's self-assessment |
| Compliance / safety | standards, creepage, certification plan | `[compliance]`, clearances | everything else |
| Reliability | derating, thermal cycling, HALT | ratings against operating conditions | the board's purpose |

Two failures are worth naming because they are cheap to prevent and expensive to discover late: a **wrong land pattern** (library owner) and an **unconstrained external interface** (architect). Both are invisible to a review that only reads the schematic's connectivity.

## Running a round with several roles

The container does not change:

- **one round = one target = one decision.** The roles are note authors, not extra rounds.
- the round id names the target **and the artifact**: `mcu-board-sch-r1`, `charger-buck-pcb-r1`. A round covers **one artifact** of the board (`sch` or `pcb`), because the decision covers the round: a schematic round that also holds layout notes cannot be closed while the layout is open, and a verdict written to unblock it would then cover statements nobody examined. Two artifacts, two rounds, one decision each.
- the author field carries the role, because the review is often run by agents and the person is in the commit: `- hardware (2026-10-23): ...`.
- notes carry no verdict. Disagreement is two notes, never an average; the decision says which one the owner followed and why.
- a note is an **observation at a date**, not a status. When its claim stops being true (a stale comment got deleted, a rating got added, a check landed), do not rewrite the note: append `→ addressed <date>: <what changed>`. A note without that line is still open, whatever the code now does — the round's decision is the only place a note is closed.
- every note carries the **evidence** and **what would settle it**. Evidence must resolve: `file:line`, `instance_id.pin`, a net id, a constraint line, a shard path. A note whose evidence does not resolve is rejected by the owner, and that rejection is the only quality lever a review has.
- **one agent holds one role per round.** The same agent in two roles reconciles the disagreement in silence, which is exactly the conflict a review exists to surface.

### Targets the enum does not have

The target enum is `board:<id>`, `page:<id>` and `component:<id>`. A review whose evidence spans boards (the cross-board wiring in a `system`, or the project's compliance targets) is recorded against the board whose evidence it cites, and its first line says so. This is an interim rule, not a design: it is the reason the first rounds below are `board:` rounds.

## Pairs worth running first

| Producer | Skeptic | Artifact | Question the skeptic is paid to ask |
|---|---|---|---|
| Power tree author | Worst-case calculator | constraints + component ratings | do the declared maxima hold simultaneously, at the corner where it matters? |
| Schematic author | Pin auditor | `schematic` IR + component pins | is every pin used, exempt, or declared `no_connect` — and is the exemption real? |
| Requirement author | Test engineer | acceptance criteria + `ports` | which criterion cannot be measured on this hardware? |
| Layout | SI / PI | `pcb` IR | does any rule assume a return path that the stackup does not provide? |
| Library owner | Board author | symbols and footprints | does the land pattern match the package the part is bought in? |

## What the tools cannot say yet

| Gap | Consequence |
|---|---|
| The target enum has no `system:` or `project:` | cross-board rounds must be filed against a board (see above) |
| Requirements, interface tables and analyses are outside the language ([ADR-0139](../adr/process/0139-process-entities-outside-the-language.md)) | requirement coverage can never be a `check` result; it is a reviewer's judgement with citations |
| The round reporting described in [review-records.md](review-records.md) is not implemented (`docs/backlog.md` F33) | an open round is invisible to `check`; nothing warns that notes have no decision |
| `owner` is an accepted `project.toml` key but is not projected into the `project` shard | nothing downstream can read who is accountable, so the reporting above cannot be built without a contract change |

None of these stops a review from being useful today: the notes and the decision are files, and the evidence in them is checkable by reading the cited lines.
