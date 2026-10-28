# Language — decisions

## Scope

What the language is: how a fact is written, how a file declares its version, how a diagnostic is named, and where a source position lives. These are the decisions that every other decision assumes.

## Not here

- The IR's shape and contract — [ADR-0104](../ir/0104-ir-representation.md).
- How a value becomes a shard — [ADR-0105](../ir/0105-ir-shards-and-hashes.md).

## Reading order

1. [0100](0100-fact-layer-has-no-expressions.md) — the fact layer has no expressions, so the language stays a table.
2. [0101](0101-one-language-version-number.md) — the language has one version number.
3. [0102](0102-diagnostic-error-codes.md) — a diagnostic is a code, a severity and a location.
4. [0103](0103-source-spans.md) — a diagnostic points at the file, and the IR stays clean.

## Records

| Record | Title | Status | Date |
|---|---|---|---|
| [ADR-0100](0100-fact-layer-has-no-expressions.md) | The Fact Layer Has No Expressions; Generators Live Outside the Language | Accepted | 2026-10-22 |
| [ADR-0101](0101-one-language-version-number.md) | One Language Version Number | Accepted | 2026-10-27 |
| [ADR-0102](0102-diagnostic-error-codes.md) | Diagnostic Error Code Registry (`domain.slug`) | Accepted | 2026-10-21 |
| [ADR-0103](0103-source-spans.md) | Source Spans — Diagnostics Point at the File, the IR Stays Clean | Accepted | 2026-10-22 |
