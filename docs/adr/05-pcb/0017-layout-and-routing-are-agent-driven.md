# ADR-0017: Layout and Routing Are Agent-Driven, Checker-Gated, and Frozen on Acceptance

Status: Accepted
Date: 2026-10-26
Scope: Decides: that placement and routing are produced by an agent and gated by the checker, and that an accepted board is frozen. Does not decide: the solver — there is none, and this record says so.
Related: [ADR-0016](0016-agent-first-pcb-description.md), [ADR-0018](0018-copper-fill-uses-a-geometry-kernel.md), [ADR-0019](0019-a-partial-layout-is-legal.md)
Impact: `spec/pcb.md` §4, §6; `docs/guides/review-app.md`; `docs/backlog.md` F48

## Context

`pcb` already carries the physical facts: `stackup`, `outline`, `place`, `connect`,
`trace`, `via`, `zone`, `keepout`, `rules`, `silk`, `physical_only`, and `deviation`
([ADR-0016](0016-agent-first-pcb-description.md)). What it does not carry is a procedure that produces
those facts. The repository has deliberately stayed out of placement and routing: a traditional
autorouter is a large geometry and search program, and [ADR-0021](../06-manufacturing/0021-the-manufacturing-output-path.md)
keeps the mandatory path free of external tools.

That left two options, and both are wrong for this project:

- **Borrow a solver.** It works, but it puts the decision procedure outside the contract, makes
  the result depend on a black box, and separates the thing that searches from the thing that
  explains why a layout is acceptable.
- **Write our own solver.** It is a multi-year geometry problem, and it duplicates work that
  already exists.

The third option is the one this record takes. A coding agent can act as the **search policy**:
it reads the board, proposes placements and routes, observes violations, and repairs them. The
project's job is not to replace the agent's policy with an algorithm; it is to provide a state,
an action space, and a deterministic evaluator strong enough that the policy cannot talk its way
past a bad board.

This is not "the agent can do anything". It is the same division the rest of the project already
uses: the agent edits facts, code checks the facts, and a human accepts the result.

## Decision

### D1. Placement and routing are in scope; a built-in solver is not

B0 PCB placement and copper routing are in the roadmap. TextEDA does **not** ship an automatic
placer or autorouter. The agent is the search policy; the repository supplies deterministic
geometry primitives, checks, and a sandbox.

S1 print-page placement remains a separate drawing concern ([ADR-0035](../09-view/0035-the-view-layer-is-a-drawing.md)).
This record is about B0: coordinates, layers, vias, and copper.

### D2. Work happens in a sandbox, never directly in `design/**`

The agent operates on a derived board state in a sandbox under `dist/` (the exact directory is
an implementation detail). The sandbox is gitignored, disposable, and never a second source of
truth. A change becomes source only after an explicit `apply` step:

1. the sandbox state is checked;
2. if the check fails, the agent receives structured violations and the source is untouched;
3. if the check passes, the accepted state is written to `design/pcb/<board>.teda`;
4. `check` runs again on the written source;
5. the accepted snapshot is frozen with its evidence.

An agent never edits `design/**` as text to lay out a board. It calls tools; the CLI owns the
write.

### D3. The tool surface is structured and small

The minimum tool set is:

| Tool | Purpose |
|---|---|
| `query` | Read board state, nets, rules, stackup, geometry, and unconnected items |
| `place` | Move or rotate an instance; set side |
| `route_segment` | Add or replace a copper segment on a layer |
| `add_via` | Add a via between allowed layers |
| `ripup` | Remove copper for a net or a region |
| `check` | Run connectivity, DRC, and layout metrics against the sandbox |
| `render` | Produce the PCB view for the agent and the human |
| `diff` | Show the proposed change against the last accepted state |
| `apply` | Commit a passing sandbox state to source |

The exact JSON schema is implementation work, but the shape is a contract: tools accept
identifiers and geometry, not free-form text. The agent never receives a whole board as one
prompt and returns a whole board as one answer.

### D4. Tools enforce what can be enforced before the check

The tool layer rejects actions that are invalid by construction: a width below the net's minimum,
a layer outside the stackup, a via with an illegal drill/size, a placement on the wrong side, a
route through a keepout. DRC catches what survives the tool layer; neither is allowed to be the
only defense.

### D5. Feedback is more than DRC

DRC is a hard-constraint checker, not an objective function. An agent can produce a DRC-clean
board that is expensive, fragile, or unbuildable. The feedback therefore has three layers:

| Layer | Examples | Gate |
|---|---|---|
| Hard | connectivity, every declared `connect` pair in scope backed by copper, clearance, width, via, keepout, board edge | must pass before `apply`; a partial layout is legal but must be reported, not silently treated as complete ([ADR-0019](0019-a-partial-layout-is-legal.md)) |
| Soft | total trace length, via count, layer changes, crossings, area, current density, differential skew | reported as metrics; budgets are reviewed, not silently optimized |
| Human | decoupling placement, return paths, thermal, testability, DFM, intent | review record; not automatable |

The agent-facing DRC subset is our own code in `packages/core`; it must run without KiCad. KiCad
DRC remains an optional cross-check, not the gate ([ADR-0021](../06-manufacturing/0021-the-manufacturing-output-path.md)).
CAM-level DFM judgement remains borrowed.

### D6. Rules are facts; strategy is skill; approval is interactive

The word "rule" covers three different things and they do not live in the same place:

| Kind | Where it lives | Who consumes it |
|---|---|---|
| Invariants | `AGENTS.md` / `spec/` | `check`; not negotiable |
| Numeric design rules | `pcb.rules` and the spec; per-net overrides | DRC and tool guards |
| Routing strategy | `docs/skills/**` | the agent; never the checker |

A skill must not hardcode a clearance, width, or via number. It refers to the rule and to the
diagnostic code that reports a violation. If a skill and `pcb.rules` disagree, `pcb.rules` wins;
the skill is wrong.

PCB rules are not silently chosen by the agent. An **interactive mode** presents the proposed
rules (defaults, per-net overrides, consequences) to the user; the user accepts or changes them;
only then are they written to `pcb.rules`. The approval itself is a review record, not a new IR
field. A rule that exists only in a prompt is not a rule.

### D7. Skills are testable policy, not prose

A routing skill is a procedure with inputs, an order of work, failure handling, and stop
conditions. It must be testable against the same fixtures as the checker:

- every diagnostic code the skill handles has exactly one repair entry;
- each entry has a small fixture: a known violation, the repair, and a passing result;
- the skill has trap boards (dense escape, power loop, differential pair, keepout, edge connector);
- a regression run records violations, unrouted count, vias, total length, and iterations.

Without these, a skill silently degrades with the model that reads it, and there is no evidence
which side changed.

### D8. Acceptance is frozen and attributable

An accepted layout is a source snapshot with evidence:

- `source_hash` of the accepted tree;
- provider, model, model version, prompt identifier, and seed (where the provider exposes one);
- the tool trace or a digest of it;
- the check report and the human review record.

The agent's output is not a reproducible build. The **accepted snapshot** is. Re-running the
agent is allowed; it never overwrites an accepted layout without a new acceptance.

### D9. Connectivity authority does not move

The agent may not create a logical connection. `sch` and the declared `connect` pairs remain the
authority; geometry is checked against them. A route that would short two nets, or a placement
that would require a connection the schematic does not declare, is rejected by the existing
binding rules ([ADR-0014](../04-schematic/0014-connectivity-has-one-authority.md),
[ADR-0020](0020-connect-pairs-need-copper.md)). The agent can propose a
`deviation` only through the existing whitelist and the human review path.

### D10. No convergence guarantee; escalation is part of the loop

Agent routing is not guaranteed to converge on dense or high-speed boards. The skill must define
when to stop: after N failed repair rounds, on a metric budget, or when the remaining violations
need a decision the agent cannot make. Escalation is a normal outcome, not a failure of the
tool.

## Consequences

- `AGENTS.md` no longer says "no layout or routing". It says "no built-in solver; layout and
  routing are agent-driven and checker-gated".
- `docs/comparison.md` gains a fourth axis of comparison: the agent workflow (tools + skills +
  checks), not just the source language.
- `docs/backlog.md` F48 tracks the implementation: sandbox, tool schema, DRC subset, skill,
  interactive rule approval, freeze record.
- The mandatory path stays zero-dependency: the checker and the tools are ours. KiCad remains
  optional.
- New risk: an agent can produce a DRC-clean, human-rejected board. The acceptance record and
  the review gate are what make that visible.

## Open Points

- The exact sandbox path and tool JSON schema.
- The first DRC coverage set (clearance, width, via, keepout, edge, unrouted) and its geometry
  tolerances.
- The interactive rule-approval UI: whether it is a `placement` sub-mode or a separate mode.
- How much of the agent trace is recorded, and where (review record vs a derived artifact).
- High-speed and current-capacity checks, which need more than geometric DRC.
- Whether an external router may be exposed as a tool; if it is, it remains a tool, not the
  architecture.
