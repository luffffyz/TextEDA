# ADR-0076: A Part's Dissipation Is Bounded by the Current the Design States for It, and by the Window Span

Status: Accepted
Date: 2026-11-18
Scope: Decides: how the dissipation bound of a resistive instance is computed. Does not decide: the role vocabulary ([ADR-0025](0025-device-vocabulary-and-parameter-roles.md)); the polarity of a rating ([ADR-0075](0075-a-ratings-polarity-is-the-roles.md)); the derating policy ([ADR-0026](0026-a-part-states-its-own-ratings.md) D14); how a rail's current reaches the layout (`docs/backlog.md` F82).
Related: [ADR-0026](0026-a-part-states-its-own-ratings.md) (D8, D10, D11, D18), [ADR-0027](0027-the-package-gives-a-chip-resistor-its-floor.md), [ADR-0075](0075-a-ratings-polarity-is-the-roles.md)
Impact: `packages/core/src/design/ratings.ts` (the dissipation comparison), `spec/teda.md` §7.3, `packages/core/test/ratings.test.ts`, `examples/reference-project` (the input stage's two series positions)

## Background

[ADR-0026](0026-a-part-states-its-own-ratings.md) D10/D11 gave the dissipation check one bound: the
extreme of the difference between the two declared windows, squared, over the resistance.

> `ΔV² / R`, with `ΔV` the extreme difference of the declared windows of the two nets — the same
> worst-case reading D8 uses for voltage.

That bound is sound **as a bound on the voltage across the part**: a part cannot see more than the
difference of the potentials of the two nets it sits on, and the difference is bounded by the
span of their windows. It is not sound as a statement about a part **in series**: a series element
does not see the whole difference between two nets, because the rest of the path takes the rest.

The reference project ran into it the day the input stage declared its windows. Two positions are
series elements:

| Position | What it is | The bound said | Reality |
|---|---|---|---|
| `R17` | 10 Ω feed resistor from the input FETs' common-source node to the charger's `VCC` | 78.4 W against a 0402's 62.5 mW floor | the charger's own bias current (TI SLUS892D: `IAC`, the current into `VCC`, `ACP` and `ACN`, at most 25 mA) — micro-watts |
| `R21` | 10 mΩ current-sense resistor, adapter current into the charger | 39204 W against the line's 1 W requirement | 4 A of adapter current, 160 mW |

Neither is a design error; both are the bound answering a question nobody asked. The span bound
assumes the two windows' extremes co-occur: `VCC` at 28 V while `AC_COMMON` is at 0 V is not a state
the circuit can be in, and the tool cannot know that — it knows two windows and a topology.

The hole was already named, in [ADR-0026](0026-a-part-states-its-own-ratings.md)'s open points and
in `docs/backlog.md` F42: a position in series between two windows has no way to say "this upper
bound does not apply here". But the gap is not the language's — it is the model's. The design
**already says** what flows through a series part, and the language already has a way to say it.

## Decision

### D1. The bound has two forms, and the tighter one binds

The dissipation of a resistive instance is bounded above by two numbers the design may support:

| Bound | Formula | Needs |
|---|---|---|
| the window span | `ΔV² / R` | the two nets' windows and the resistance |
| the stated current | `I² × R` | the current the design states for the part and the resistance |

The bound the check compares with the part's rating is the **smaller** of the two. A stated current
therefore *adds* a bound; it never removes the window's ceiling, so the check is never weaker than
it was (D6).

### D2. A pin's stated current is the current through the part

`current <pin> <max>` is a requirement on one pin: this pin carries at most so much
([ADR-0026](0026-a-part-states-its-own-ratings.md) D16–D18). For a two-terminal part the current
through one pin is the current through the other, so the requirement names the current of the path
between the two pins — the same path the dissipation is about. The current bound is therefore
`I² × R` with `I` the stated maximum.

Where several pins of one instance carry a requirement, the **largest** is used: the bound must
hold for the worst one.

### D3. A rail's current is not

`current <net> <max>` is what a rail carries in total: a **layout input** that sizes the copper
([ADR-0026](0026-a-part-states-its-own-ratings.md) D18, and F82 on the layout side). The language
does not say which member of a net carries the net's current, so a rail's current is not the
current through any particular part and must not become one. The window span stays the bound for
every position the design has not spoken about with a pin requirement.

### D4. The stated current is an upper bound, so `I² × R` is conservative

A requirement says "at most". The dissipation it bounds is therefore at most `I² × R`, and the
comparison against the part's rating stays a bound and not a measurement — the same standing the
window span has (ADR-0026 D11).

### D5. A part with a stated current needs no window

Each bound needs only the facts it uses. A position whose current the design states can be
compared with the part's rating even when neither of its nets carries a window; the window bound is
then simply not available. Unknown is counted, not passed (ADR-0026 D13) — and a position that
*was* compared must not be reported as one that was not.

### D6. The limit side does not move

What the bound is compared with is unchanged: the design's own dissipation limit, the line's power
requirement, the part's power rating, and — when nothing else narrows the class — the package
floor ([ADR-0027](0027-the-package-gives-a-chip-resistor-its-floor.md)). The stated current is a
bound on the dissipation, never a limit on the part.

### D7. No new syntax

`current <pin> <max>` already exists, the IR contract already carries it, and neither the language
version nor the IR contract version moves. No file changes shape, no migration is needed, and no
corpus case depends on the old reading.

## Consequences

- **The reference project's input stage checks clean.** `R17` and `R21` are compared with the
  current the design states for them, and the window span no longer speaks about a state the
  circuit cannot be in.
- **A series position is now comparable on the facts that describe it.** The design states the
  current through a series part where it knows it (a feed resistor, a sense resistor), and the
  check compares that with what the part can take.
- **The window span is still the fallback**, so a design that states no current is checked exactly
  as before — including a resistor across a rail, where the span bound is the right question.
- **A stated current is a commitment.** A design that understates the current through a position
  lowers the bound; the window span remains the ceiling, and the current comparison
  (`design.current-exceeded`) is what catches a stated current the part cannot carry.

## Open Points

- **The bound is still a bound.** The tool does not compute what a part really dissipates; it
  compares the design's own facts with what the part can take. Where the design states neither a
  current nor a window, the position is counted as not compared (ADR-0026 D13).
- **The current a series position carries is a design statement.** For a sense resistor the
  current is the rail's, for a feed resistor it is the load's bias — the design has to say which,
  and a number copied from a neighbouring rail is wrong in a way no tool here can see.
