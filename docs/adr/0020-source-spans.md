# ADR-0020: Source Spans — Diagnostics Point at the File, the IR Stays Clean

Status: Accepted
Date: 2026-10-22
Related: [ADR-0004](0004-ir-representation.md), [ADR-0008](0008-ir-shard-identity-and-hash.md), [ADR-0016](0016-diagnostic-error-codes.md), [ADR-0021](0021-schematic-view-layer.md), [ADR-0023](0023-ir-layer-on-disk.md), [ADR-0030](0030-procurement-layer.md)
Impact: `packages/parser` (the source map the compiler builds); `packages/ir` (the diagnostic location type); `spec/**` (the position model); `docs/backlog.md` F11

## Background

TextEDA is a one-way projection: source → IR. The IR carries semantics and nothing else
([ADR-0004](0004-ir-representation.md)); the source position of a fact is not part of it, and by
construction it cannot be ([ADR-0008](0008-ir-shard-identity-and-hash.md) fixes the identity and
hash rules on the semantic content). Two things break because of that.

First, the diagnostics requirement: every diagnostic names a file, a line and a column
(`AGENTS.md` §10). The parser can do this, because it is reading the file. But the semantic
checkers and the schema validator work on the IR, and the IR has no positions: they can only
name a file, and the schema validator can only name a JSON Pointer into the IR (`/pins/2`) —
which the reader cannot use, because the reader holds a `.teda` file, not an IR document.

Second, the agent's repair loop. An agent that is told "line 42, column 7" can fix one line; an
agent that is told "instancePath /pins/2" has to re-parse the file to find the line. A diagnostic
that cannot be acted on directly is a diagnostic the agent has to guess about.

The neighbouring projects do not have this problem because they do not separate the two:
cohdl's IR *is* an AST, so positions come along for free, and its package-level diagnostics
anchor on `cohdl.toml` lines. TextEDA separates the semantic contract from the source on
purpose — that is what makes the IR a contract, the hashes stable, and the renderer replaceable —
so the position has to be carried alongside instead of inside.

The constraint that decides the whole design is in `AGENTS.md` §10: *reordering the lines of a
description, changing how a unit is written, or changing the key order must produce byte-identical
IR*. A span inside the IR would break that immediately, because a line number is a function of the
line order. So spans cannot go into the IR — and the question this record answers is where they
go instead.

## Decisions

### D1. Spans never enter the IR

A shard's bytes depend on the semantics alone. The same description, written with its lines in a
different order, compiles to byte-identical IR; the diagnostics that come out of it point at the
new line numbers. This is the acceptance criterion in `AGENTS.md` §10, and it is what makes the
IR a contract rather than a transcript.

### D2. The compiler produces a source map next to the IR

While a description is compiled, the compiler keeps a map from **IR path** to **source span**:
a JSON Pointer into the shard ↔ the place in the file the record came from. The map is used to
turn a semantic or schema diagnostic into a located diagnostic, and it is dropped when the
compilation ends.

It is not an artifact in this phase. A file on disk that maps IR paths to source positions is a
second thing that can disagree with the IR, and nothing needs it yet (see D6 for the one case
that does).

### D3. The shape of a span, and the semantics of a column

A span is:

| Field | Meaning |
|---|---|
| `file` | Path relative to the project root, `/`-separated |
| `line` | 1-based line number |
| `col` | 1-based **Unicode scalar** column |
| `byte` | 0-based byte offset of the first character of the span in the file |
| `end` | Optional end of the span, in the same fields, exclusive |

Both `col` and `byte` are carried, because a source file may contain `Ω`, `±` or Chinese text, and
two implementations that count differently will otherwise report the same place differently. The
scalar column is what a human and an editor use; the byte offset is what a tool that seeks in the
file uses. The choice is fixed here so that a third-party implementation computes the same
numbers.

### D4. Record-level granularity

A span points at the **first token of the record** it belongs to; `end` is optional. It is not
token-level.

A record — one instance row, one net, one constraint — is what a reviewer thinks of as "the
thing", and a diagnostic names a record. Token-level spans would multiply the size of the map
without giving a reader anything they do not already have.

### D5. A reference has two points

When a diagnostic is about a reference — a board file naming a component, a module naming a port
— the diagnostic carries the **reference site** in `location` and the **definition site** in
`related`. The reader needs to know which line to fix and which file declares the thing that is
wrong; the agent needs the same two points to repair and to re-check.

### D6. The persisted index is a later, separate artifact

The review GUI needs something the source map is not: **"where is this identity defined?"** — a
click in a drawing jumps to the source, and a list of an identity's occurrences comes from the
board file, not from a pointer into a JSON document. That is an *identity index*, not a source
map, and it is derived from the same parse.

When it is built, it is an **advisory** artifact beside the shards: reproducible from the
sources, not part of the project hash, not part of any build input — the same split the
procurement alternatives use ([ADR-0030](0030-procurement-layer.md) decision 5b, and the
normative/advisory amendment of [ADR-0023](0023-ir-layer-on-disk.md)). A drawing is authored
content; where a label sits must never change what a board is.

The shape of that artifact is not decided here. What is decided is that it exists, that it is
advisory, and that it is derived — not that it is written by the compiler today.

### D7. Positions belong to the file as parsed

A position is valid for the source file as it was read. `fmt` rewrites the file, and after that
the old line numbers are wrong; positions are recomputed by parsing again. A diagnostic is
therefore always produced against a specific parse, and a tool that formats and then reports
positions must re-parse.

### D8. A schema violation carries both points

A diagnostic from the schema validator carries the **source location** in `location` and the **IR
path** in `cause.instancePath`. Neither replaces the other: the source location is what a human
and an agent act on, and the IR path says what the contract says about that record.

## Consequences

- **The parser keeps its origins until the IR is built.** The internal structures carry the
  source path of every record, and the compiler strips it when it produces the shard. The IR
  bytes do not change; the map is a by-product of the same pass.
- **The diagnostic type grows two optional fields** (`byte`, `end`). The IR contract
  (`schemas/ir/v0.2/**`) is untouched: the position model is not part of the semantic contract.
- **The agent's repair loop becomes a one-step operation.** A diagnostic names a line and a
  column, so a fix is an edit, not a re-parse.
- **The semantic checkers and the schema validator can point at lines**, which is what
  `AGENTS.md` §10 asks for and what the current implementation cannot do.
- **The review GUI's jump-to-source has a home**, but it still needs the identity index of D6,
  which is a separate piece of work (`docs/backlog.md` F34).
- **The byte-identical guarantee survives** — that is the point of D1.

## Alternatives

- **Put the span in the IR.** Rejected: the IR is the contract, and a contract that carries line
  numbers of one particular source file is a contract about the file, not about the design. It
  also breaks the byte-identical acceptance criterion in `AGENTS.md` §10 outright.
- **Token-level spans.** Rejected: a much larger map for information a reader does not use; the
  record is the unit a diagnostic names.
- **Byte offsets only.** Rejected: a byte offset is not what an editor shows and not what a
  human reads; the scalar column is the primary number and the offset is the machine's aid.
- **File-level positions only (the current state).** Rejected: enough to write "look at
  `sch/mcu-board.teda`", not enough for an agent to repair a line.
- **Write the source map to disk from the start.** Deferred: it is a second artifact that must
  agree with the IR, and the only consumer that needs it on disk — the review GUI — needs the
  identity index (D6) rather than the map. Writing it now would mean maintaining a file nothing
  reads.

## Open Points

- The shape of the persisted identity index for the review GUI (D6): which identities are
  indexed, how the occurrences are grouped, and how the artifact is named and versioned. It
  belongs with the GUI work (`docs/backlog.md` F34), and it must land before the GUI's
  jump-to-source can be specified.
- How a multi-site diagnostic groups its `related` locations (D5): whether the list is ordered,
  capped, and how a reviewer reads a long list.
