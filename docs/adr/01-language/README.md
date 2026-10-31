# Language — decisions

## Scope

What the language is: how a fact is written, how a file declares its version, how a diagnostic is named, and where a source position lives. These are the decisions that every other decision assumes.

## Not here

- The IR's shape and contract — [ADR-0005](../02-ir/0005-ir-representation.md).
- How a value becomes a shard — [ADR-0006](../02-ir/0006-ir-shards-and-hashes.md).

## Reading order

1. [0001](0001-fact-layer-has-no-expressions.md) — the fact layer has no expressions, so the language stays a table.
2. [0002](0002-one-language-version-number.md) — the language has one version number.
3. [0003](0003-diagnostic-error-codes.md) — a diagnostic is a code, a severity and a location.
4. [0004](0004-source-spans.md) — a diagnostic points at the file, and the IR stays clean.

## Records

| Record | Title | Status | Date |
|---|---|---|---|
| [ADR-0001](0001-fact-layer-has-no-expressions.md) | The Fact Layer Has No Expressions; Generators Live Outside the Language | Accepted | 2026-10-22 |
| [ADR-0002](0002-one-language-version-number.md) | One Language Version Number | Accepted | 2026-10-27 |
| [ADR-0003](0003-diagnostic-error-codes.md) | Diagnostic Error Code Registry (`domain.slug`) | Accepted | 2026-10-21 |
| [ADR-0004](0004-source-spans.md) | Source Spans — Diagnostics Point at the File, the IR Stays Clean | Accepted | 2026-10-22 |
