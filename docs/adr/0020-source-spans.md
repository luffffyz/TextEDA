# ADR-0020: Source Spans — Diagnostics Point at the File, the IR Stays Clean

Status: Accepted
Date: 2026-10-22
Related: [ADR-0004](0004-ir-representation.md), [ADR-0008](0008-ir-shard-identity-and-hash.md), [ADR-0016](0016-diagnostic-error-codes.md), [ADR-0021](0021-schematic-view-layer.md), [ADR-0023](0023-ir-layer-on-disk.md), [ADR-0030](0030-procurement-layer.md)
Impact: `packages/parser` (the source map the compiler builds); `packages/ir` (the diagnostic location type); `spec/**` (the position model); `docs/backlog.md` F11; IR contract v0.10 (amendment 2026-10-23)

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
  `design/sch/mcu-board.teda`", not enough for an agent to repair a line.
- **Write the source map to disk from the start.** Deferred: it is a second artifact that must
  agree with the IR, and the only consumer that needs it on disk — the review GUI — needs the
  identity index (D6) rather than the map. Writing it now would mean maintaining a file nothing
  reads.

## Open Points

- ~~The shape of the persisted identity index for the review GUI (D6).~~ Resolved 2026-10-26:
  `dist/ir/identity.json`, advisory, `version: 1`; see the amendment below.
- How a multi-site diagnostic groups its `related` locations (D5): whether the list is ordered,
  capped, and how a reviewer reads a long list.

## Amendment 2026-10-23: The IR Carries No Line Numbers (Contract v0.10)

D1 said spans never enter the IR. The contract disagreed: the shard records carried a `line`
field (`$defs.proxy_line` in `common.schema.json`, and a `line: number` property on instances,
places, wires, labels, ports, texts and selections), because the source map was read back out of
the IR by index. The consequence was the one D1 forbids: **moving a row changed the shard**, so
the byte-identical guarantee of `AGENTS.md` §10 held for `pcb`/`footprint` but not for
`schematic`, `schematic-view` and `procurement`. A test that shuffled the rows of a board caught
it.

### Remove the field, do not document the contradiction

`line` is gone from every shard record. The IR contract moves to **v0.10**, and to **v0.11** in the
same unreleased batch — [ADR-0046](0046-vendored-libraries-are-verified-by-their-hash.md) widened
`instance.component` from a slug to a device reference, so the directory that ships is
`schemas/ir/v0.11/` (`$defs.proxy_line` deleted, `line` removed from the record definitions);
the language version is untouched, because which source files are legal did not change. The
remaining `line` in a shard is `source.line` — spelled `1` by every producer, a property of the
file rather than of its contents.

The position now lives in exactly one place: the source map D2 describes. Each parser records a
record's line beside the record (identity-keyed for the duration of the parse), and the map turns
that into the `IR path → span` entries the shard publishes. Nothing about the map changed; what
changed is that the IR no longer holds a second, order-dependent copy of it.

### Consequences

- **The rules take locators, not fields.** `checkRatings` gains `locateInstance`,
  `checkViews` gains a per-page `locate`, `checkReadability` gains `locate`, and the procurement
  facts gain `locateInstance`; `packages/core` stays pure (facts in, diagnostics out, no file
  reads). `packages/cli` supplies them from the parses it already holds — that is where the
  files are.
- **The view IR is sorted**, per `spec/schematic-view.md` §11: the spec already promised that
  row order does not reach the IR, and it did not hold. `wire` keeps its point order, which is
  the one row order with meaning.
- **The renderer stops emitting `data-line`.** Two stages read the dropped field through the IR,
  which is exactly the leak D1 exists to prevent.
- **Two tests pin the invariant** (`packages/parser/test/schematic.test.ts`,
  `packages/parser/test/view.test.ts`): the same description with its rows reordered must
  compile to byte-identical IR.

## Amendment 2026-10-26: the identity index is `dist/ir/identity.json`

D6 left the shape open. It is now fixed by the first consumer, the review app's jump-to-source
(`docs/backlog.md` F34):

```json
{
  "version": 1,
  "identities": {
    "instance:charger-buck/M2.C1": [
      {
        "kind": "instance",
        "label": "sch instance row",
        "file": "design/modules/buck-5v.teda",
        "line": 10,
        "col": 3
      },
      {
        "kind": "view-place",
        "label": "view place (buck-5v)",
        "file": "views/charger-buck/buck-5v.view.teda",
        "line": 12,
        "col": 3
      }
    ]
  }
}
```

- **The file sits beside the shards, not inside them.** `texteda ir` writes `identity.json` next to
  `manifest.json`; it is not a shard, is absent from `manifest.shards`, and never enters the
  project hash, a board hash or `advisory_hash`. Moving it, deleting it or editing it changes no
  build identity. This is the advisory split D6 already required.
- **The key is the identity, the value is every place it appears.** The namespaces are
  `instance:<board>/<id>`, `net:<board>/<id>`, `port:<board>/<id>`, `component:<component-id>`,
  `component-pin:<component-id>/<pin-number>`, `symbol:<lib>:<id>` and
  `footprint:<lib>:<id>`. Board-level instances are the flattened ids (`M2.C1`), and a module-local
  row points at its module file because that is where the fact is written.
- **Occurrences share the identity key.** A print-page `place` appends to its instance, a `wire`
  or `label` to its net, a `port` to its port, and a PCB `place` to its instance. The `kind` and
  `label` fields say which record it is (`sch instance row`, `view wire (buck-5v)`, …); the viewer
  does not need to know where to look.
- **Locations are relative to the project root** and use `/` separators, exactly like
  `DiagnosticLocation.file` (D3). The artifact therefore contains no machine-specific path and no
  absolute path.
- **Only descriptions that compiled are indexed.** The index is built from the same `Draft`s whose
  shards passed the contract; a file with an error is not silently presented as a definition.
- **The document has its own version.** `version: 1` describes this advisory shape, not the IR
  contract. A future change to the key grammar or location fields increments it; the IR contract
  is untouched.
- **The index is derived, never authoritative.** It is reproducible from the sources, and a tool
  that needs a definition should parse again rather than trust a stale copy. `texteda ir` regenerates
  it with the shards and prunes it like any other file it owns.

The parser already carries the record locations D2 describes; no IR or language change was
needed. The index is assembled in `packages/cli/src/identity.ts` and consumed by the review model
in `packages/cli/src/review.ts`. The viewer turns a selected `instance:` or `net:` key into the
definition menu and opens a location with the editor's `vscode://file/...` URI.
