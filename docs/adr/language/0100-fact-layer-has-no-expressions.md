# ADR-0100: The Fact Layer Has No Expressions; Generators Live Outside the Language

Status: Accepted
Date: 2026-10-22
Scope: Decides: that a value in the fact layer is a literal with a unit, and that repetition is handled by a generator outside the language. Does not decide: whether a limited expression may ever be introduced — the trigger is the ten-case corpus, see `docs/backlog.md` F12.
Related: [ADR-0101](0101-one-language-version-number.md), [ADR-0104](../ir/0104-ir-representation.md), [ADR-0112](../schematic/0112-modules-compose-boards.md)
Impact: `AGENTS.md` §5; `spec/teda.md` §5, §13; `docs/backlog.md` F9, F12

## Background

The rule this record states is already in force. The language has no expressions: a value is a
literal with a unit (`3.3V`, `100nF`, `±1%`), the fact layer has no control flow, and a file that
repeats itself is written out in full. What was missing is a document that says so, says *why*,
and says what would have to be true for the rule to change.

The rule was scattered across three places: `teda.md` §5.1 ("one fact per line", "no structure
that needs cross-line reading"), §5.3 ("generators and loops are not supported in v0.1; a later
generation layer produces tables"), and §15 ("expression languages: undefined"). A reader could
find the rule but not the reason, and a proposer of a new feature could find neither.

The reason is not aesthetic. **A human review cannot be skipped**, and the reviewer is a hardware
engineer. So the language's reader model decides its syntax. A line in the fact layer must be
checkable by *reading it*: the reviewer must be able to say "this line states this fact" without
recomputing anything. The moment a value is an expression, review degrades from reading to
*recalculation* — mental arithmetic on the spot, plus tracing a dependency chain — and the cost
grows with the number of lines while the benefit (which a programmer values) does not.

That is also the difference from the two neighbouring projects. tscircuit puts arbitrary
expressions in attributes (`resistance={compute()}`), which leaves no canonical source form — the
Circuit JSON schema exists, the source does not. cohdl puts `fn`, generics and loops in the
language, hits the same wall, and ends up shipping a `cohdl fmt --check` to hold the surface
still. TextEDA keeps the *facts* literal and pushes the *program* outside the language, where its
output is a file a human can read.

## Decisions

### D1. A value in the fact layer is a literal

A value is a literal, optionally with a unit, a tolerance, or a percentage. It is never the
result of a computation.

- `3.3V`, `100nF`, `±1%`, `+5%`, `2.5A` — **terminal values**. The symbol *is* the fact; the
  reader does not need to understand any operational semantics to know what the line states.
- `10k * 2`, `{divider(10k, 4.7k)}`, `R1.value` — **process**. The reader must recompute to
  learn what the line states.

This is not "no symbols": `±`, `%` and units are symbols, and they are fine. The dividing line is
whether the reader needs to understand *arithmetic or evaluation* to know the fact.

### D2. The fact layer has no control flow

No loops, no conditionals, no function calls, no variables, no macro expansion. A construct that
depends on state the reader cannot see in one line is a construct the reader has to trust rather
than check.

### D3. Generators live outside the language, and their output is a table

Repetition is handled by a tool that writes the file, not by the language that reads it. The
generator's product is an ordinary source file: tables, literals, the same surface a human would
write. The review object stays the table — never "the generator plus the table".

This is the same boundary `teda.md` §5.3 draws between the three kinds of content: tables carry
**facts**, blocks with ports carry **composition**, and rules belong to the checker. Composition
is not programming: a module definition and its instantiation are structure, not control flow.

### D4. The boundary: the composition layer and the value layer are not restricted

D1 and D2 constrain the **fact layer** — the tables of instances, nets, ports and constraints.
They do not constrain:

- the **composition layer**: a module file, its `ports`, its `instances`, and the board's
  `modules` section (see [ADR-0112](../schematic/0112-modules-compose-boards.md)) — structured notation,
  no computation;
- the **value layer**: units, `±`, `%`, and the comparison and range forms already allowed in
  constraints (`9V..19.8V`).

What is forbidden is *programmatic facts*, not notation.

### D5. The checkable criterion

Every token in the fact layer must be able to answer one question: **which hardware fact does
this describe?**

A token that needs a reader to understand operational semantics to answer that question is
noise, and it is what this record forbids. The criterion is deliberately about the reader, not
about the syntax: a future feature passes if a reviewer can read one line and check it, even if
the feature is unfamiliar.

### D6. The revision condition

The rule may be revised, and only when the conformance corpus shows the fact layer's form is
unusable for a case it has to cover. The trigger is the "20 power domains" case of the
ten-case corpus (`docs/backlog.md` F12): if that case shows the table form cannot be used
without becoming unreadable — after the 80-column wrapping rule of `teda.md` §5.3 has been
applied — then a **limited expression** may be introduced.

The escape hatch, if it is ever opened, is narrow on purpose:

- constant arithmetic only, over literals with units;
- no function calls, no variables, no control flow, no reference to another row's value;
- the result is still a terminal value: the reader recomputes nothing that is not already in the
  line.

A revision is a decision of its own: it needs its own ADR, a migration note and a migration
script, and it is reviewed under the same admission rule as any other new construct
(`AGENTS.md` §5.2). During the `0.x` phase it is a PATCH on the language version
([ADR-0101](0101-one-language-version-number.md) D5): the version was never the compatibility
mechanism — an unknown construct is an error.

**This record does not close `AGENTS.md` §11 question 2.** It states the principle and the
condition under which the principle may be revised; the question stays open until the corpus
exists, because until then nobody knows whether the condition will be met.

### D7. There is no chain form

The remaining half of `AGENTS.md` §11 question 1 — whether a chain notation (`A -- B -- C`) should
be introduced as an auxiliary form — is answered **no**. The fact layer's form is the table, and
the composition layer's form is the block with ports. A chain form would be a second way to
write the same fact, and a second way to write the same fact is a second canonical form to
format, to diff and to render. The table stays the only form for facts.

## Consequences

- **The source is what the reviewer reads.** A board file is longer than a program would be. That
  is the accepted cost, and the tools that answer it are outside the language: a generator writes
  the file, `fmt` keeps it canonical, and modules ([ADR-0112](../schematic/0112-modules-compose-boards.md))
  carry the reuse that a macro would otherwise carry.
- **The IR keeps a single semantic form.** Because the fact layer has one notation, the IR has
  one shape for it, and `extract(render(ir)) == ir` has one thing to check.
- **The canonical form is stable.** Canonicalisation is a sorting and formatting problem, not an
  evaluation problem; there is no expression to fold, no order of evaluation to fix.
- **An agent's job is writing files, not writing programs.** An agent that needs twenty similar
  rows writes twenty rows (or asks a generator to). The artifact it leaves behind is reviewable,
  which is the point of the language.
- **The revision condition is a real commitment.** If the corpus proves the table form is
  unusable, this record is not a veto — it is a boundary with a stated door.

## Alternatives

- **Allow expressions in the fact layer.** Rejected: it makes the reviewer's job recomputation
  and makes the canonical form an evaluation problem, which is exactly the wall tscircuit and
  cohdl hit. The benefit is a programmer's benefit, and the reader of this language is a
  hardware engineer.
- **Allow expressions in the value layer only (a "computed value" type).** Rejected: the value
  layer already has the forms that carry real engineering meaning — units, tolerances, ranges
  (`9V..19.8V`). A computed value would add a second kind of value with weaker meaning and the
  same review cost.
- **Add a chain form as an auxiliary notation.** Rejected (D7): two notations for one kind of
  fact means two canonical forms, and the diff of a board is only useful if there is one.
- **Keep the rule informal and leave it to reviewers.** Rejected: an unwritten rule is renegotiated
  per feature request. Written down, the burden of proof sits with the proposer.

## Open Points

None. The revision condition of D6 is a future trigger, not an open question: the corpus decides
whether the door opens, and a revision needs its own ADR.
