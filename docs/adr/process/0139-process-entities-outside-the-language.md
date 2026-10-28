# ADR-0139: Process Entities Stay Outside the Language

Status: Accepted
Date: 2026-10-22
Scope: Decides: that requirements, blocks and analyses stay outside the language, and how a simulation is bound to a source hash. Does not decide: the module mechanism — see ADR-0112.
Related: [ADR-0112](../schematic/0112-modules-compose-boards.md), [ADR-0136](../view/0136-review-records-and-attribution.md), [ADR-0140](0140-documentation-has-one-authority-per-fact.md)
Impact: `spec/teda.md` §11; `docs/guides/design-flow.md`

## Background

`AGENTS.md` §4.1 lists three "flow-related entities" as proposals: `Requirement`, `Block` and
`Analysis`. `AGENTS.md` §1.2's flow puts them before the schematic — requirements, architecture, interfaces,
selection, analysis, then the schematic. `AGENTS.md` §12 already states a rule the language cannot
keep:
"a simulation conclusion must not be written only as a comment or prose; as `Analysis` evidence it
binds a `source_hash` and the assumptions, otherwise it counts as unverified."

Three questions were open: do these entities enter the language as first-class citizens or stay
references in documents; how fine the traceability goes; and what makes a simulation conclusion
authoritative.

## Decision

### D1. None of the three enters the language

Not because they are unimportant, but because of what the language is for.

- **The language has no prose form.** One fact per line, tables of fixed columns, no quoting, no
  text fields. A requirement's text and an analysis's conclusion are prose of arbitrary length
  ([ADR-0136](../view/0136-review-records-and-attribution.md) decision 2). Putting them in the language
  means smuggling prose into a column.
- **They are not inputs to anything that is built.** No schema, no IR shard, no canonical form, no
  hash. This is the same reason a review record is not a description type.
- **The IR is flat.** The design's identity is the flattened names
  ([ADR-0112](../schematic/0112-modules-compose-boards.md)); a tree of blocks has no place in a flat table,
  and the source-level hierarchy is already `module`.
- **An agent does not need the IR to find them.** Listing a directory is enough. The IR is not the
  only way in, and it should not become one just to hold prose.

### D2. The difference between `Block` and `module` is reuse — and that settles it

`module` and `Block` sound like two ways to say "group of parts". They are not, and the difference
is worth writing down because it is the reason `Block` needs no language construct.

| | `module` | `Block` |
|---|---|---|
| Axis | **reuse** | **function** |
| What it is | an instantiable composition with ports | how one board is decomposed (power, analog, interface) |
| Where it lives | the source layer; instances are flattened into the board | a document about the board |
| Why it exists | so the same structure is not written twice | so the board can be explained |
| How many | one definition, many instances | one per board |

The axes are orthogonal: a power block can span three modules, and a module can contain blocks
from several functional areas. So the two cannot be merged into one "group" concept with a reuse
flag — one axis would win and the other would be mangled.

The consequence is short: **whatever needs reuse already has a construct (`module`), and whatever
does not need reuse is only a description.** A block tree is therefore a document, the same way
the interface table is a document.

### D3. A simulation is a reference, and it does not enter the hash

The analysis binds to the design version it verified: the board hash
([ADR-0105](../ir/0105-ir-shards-and-hashes.md)), or the project hash for a project-wide analysis. The
analysis itself is **not part of the design**: it is not in the IR tree, not in the manifest, and
it does not change the project hash. "Reference" means exactly that — it points at a design
version, it is not part of it.

The machine-readable part is a small header on the report; the report itself is Markdown, the
shape [ADR-0136](../view/0136-review-records-and-attribution.md) settled:

```
source_hash: <the board or project hash this analysis verified>
tool: <name and version>
corner: <process / temperature / model>
```

The body carries the prose: the assumptions, the conclusion, the artifact path. The header
carries only what a tool can judge. This keeps `AGENTS.md` §12's rule satisfiable — the assumptions sit next
to the hash they were made under — without giving the language a text field.

### D4. The checker reports a stale analysis

When the design's hash no longer matches the one the analysis recorded, the conclusion is not
verified against the current version, and the checker says so — a **warning**, not an error: the
design is not wrong, the evidence is old.

The check is "does the hash still match", never "is the conclusion true". A tool cannot judge a
simulation, and an attributed statement is not a proof ([ADR-0136](../view/0136-review-records-and-attribution.md)
decision 1).

### D5. Traceability stops at the net and lives in the documents

The chain is requirement → block → component → net, and it is written in documents. The language
does not carry it. A trace from a requirement to a net is a reading of the design, not a fact
about the design, and "every requirement must reach a net" is an organizational policy rather than
a rule about circuits — so it is checked by the organization, or by a script over the documents,
and not by the language's checker.

## The cost, stated plainly

- The coverage of requirements cannot be enforced by the language.
- The interface table — a block's power, clock and bus interfaces — is a document; if it is to be
  checked at all, it needs a small machine-readable form. Not decided here
  (`docs/backlog.md` F45: decided *not* to build it yet, with the trigger that would reopen it).
- The stale-analysis check needs the checker to read a document header (a small parser) and to
  compute the board hash in memory (the tree builder already computes it).
- Nothing forces these documents to be well-formed. That is the same trade the review records
  made, and it is deliberate: a schema for prose is a schema for nothing.

## Closes

`AGENTS.md` §11 questions 10, 11 and 12.
