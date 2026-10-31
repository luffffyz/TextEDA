# ADR-0003: Diagnostic Error Code Registry (`domain.slug`)

Status: Accepted
Date: 2026-10-21
Scope: Decides: that diagnostics carry a `domain.slug` code from a closed domain vocabulary, that the registry is the single source of truth, and that a shipped code is frozen. Does not decide: the wording of a message, nor the severity of a given check — severity is a property of the registry entry, and the wording belongs to the call site.
Related: [ADR-0004](0004-source-spans.md), [ADR-0038](../10-process/0038-implementation-stack-and-agent-entry.md), [ADR-0041](../10-process/0041-documentation-has-one-authority-per-fact.md)
Impact: `packages/ir/src/diagnostics/**`, `packages/parser/src/**`, `packages/cli/**`, `docs/error-codes.md`

## Background

Errors are the product. A diagnostic has to be machine-readable enough that an agent can branch on
it, and readable enough that a human can fix the file without reading the code.

Numbers were the obvious candidate and they are the wrong one. `E1105` carries no semantics — the
reader has to look it up — classification boundaries can then only be arbitrated by documentation,
and inserting a code forces a renumbering. Compact numeric codes are a historical artifact: they
come from environments whose payload cannot carry text (early compilers, embedded consoles, 8-bit
error bytes), and from cases where "the code itself is the ABI contract" (system call return-value
tables, the integer `code` in LSP). TextEDA's diagnostics are for humans and agents, so the text
payload is not bound by bandwidth or storage constraints, and numeric codes here do nothing but
harm.

The thing worth learning from C is not "do not use numbers" but "once a code ships it is an ABI".
That is why this project's codes are frozen — but freezing slugs costs far less: new codes do not
renumber, and the semantics of old codes never move.

## Decision

### D1. Codes Take the Form `domain.short-slug`

The slug is kebab-case and the domain comes from a **closed vocabulary**:

| Domain | Covers |
|---|---|
| `syntax` | Lexical / syntax / parsing |
| `value` | Values and dimensions |
| `ref` | References and resolution |
| `contract` | IR contract / schema, including the unknown-construct error |
| `net` | Net integrity, including the three-state "not connected" rule |
| `bind` | sch↔pcb binding |
| `library` | Library level |
| `format` | Version / canonical form |
| `drc` | Emergent checks (ERC / DRC) |
| `cli` | Invocation layer |

If we later plug into transports such as LSP / JSON-RPC that require an integer `code`, the
numeric code is generated **at the boundary** from the slug and must be stable; the slug always
remains the source of truth. That is a transport-layer requirement, not a diagnostic-layer design.

### D2. The Registry Is the Single Source of Truth

`packages/ir/src/diagnostics/codes.ts` holds the table. `docs/error-codes.md` is **generated** by
`bun run gen`, not hand-written; CI uses `bun run gen:check` to block drift. The code table belongs
to the contract layer: it must not be closed off along with the implementation.

### D3. The Registry Is Checked in Both Directions

`packages/ir/test/codes.test.ts` checks that every entry in the code table has a real call site,
and that every code literal in the code is in the table. The definition is copied from cohdl's
`tests/error_registry.rs`.

### D4. One Diagnostic Shape for Every Layer

The parser, the semantic checker and schema validation all share one `Diagnostic` type
(`@texteda/ir/diagnostics`), and the `--json` output carries `code`.

### D5. Domains Are Split by the Kind of Error, Not by the Stage of Discovery

A unit mismatch is `value.*` no matter which layer discovers it; a missing reference is `ref.*`
whether it appears in an instance row or in a constraint. Severity is **independent** of domain
(`error` / `warning` / `note`): emergent checks are naturally warnings, and they must not become all
errors just because "it is an ERC".

### D6. The Payload

```json
{
  "code": "net.pin-in-two-nets",
  "severity": "error",
  "message": "U1.3 belongs to both net A and net B",
  "expected": "A pin may belong to only one net",
  "actual": "U1.3 appears in 2 nets",
  "hint": "A pin may belong to only one net; remove the extra member",
  "location": { "file": "design/modules/charger-power.teda", "line": 42, "col": 12 },
  "related": [{ "file": "design/sch/charger-buck.teda", "line": 18 }],
  "data": { "component_id": "U1", "pin": "3" },
  "cause": { "source": "ajv", "instancePath": "/pins/2", "keyword": "required" }
}
```

- `code` / `severity` / `location` / `data` = **machine contract** (agents branch on `code` and
  auto-fix from `data`).
- `message` / `expected` / `actual` / `hint` = **for humans** (reviewers fix files based on them).
- The **fallback for `hint` lives in the registry**: a registry entry may carry a `hint` (how this
  code is usually fixed), while a call site may give a more specific wording (with context). When
  the payload is assembled, take "call site first, registry as fallback" — this way
  `docs/error-codes.md` can list "how to fix" for every code, and an agent does not have to hit the
  error once before it knows how to fix it.
- `cause` as a backstop: a large share of TextEDA's diagnostics come from **schema validation**
  (Ajv reports on the IR and gives an `instancePath`). Keeping the original `cause` lets
  third-party implementations, which also use Ajv, map directly onto `contract.*` codes instead of
  each inventing its own — this is an advantage of TextEDA over cohdl (which has no schema layer,
  so third parties must implement the semantic checks one by one).
- Failures in the `cli` domain **do not enter the `--json` diagnostics array**; they go to stderr
  plus an exit code (copied from cohdl's E000 classification).
- **The stage is determined by the domain**: `parse` (syntax / value / ref / format: the description
  cannot be read or the references are broken) · `contract` (contract: the IR does not satisfy the
  schema) · `semantic` (net / drc / bind / library: readable, but the design has problems). The
  payload carries `countsByStage`, and all three keys are always present. Agents use this to decide
  "fix the file or fix the design" without reading every code.

### D7. A Shipped Code Is Frozen

A code is frozen the moment it ships: its meaning cannot change, it cannot be renamed, it cannot be
reused.

- If the semantics change, issue a new code; mark the old code `[DEPRECATED → new.code]` and keep
  the old row.
- "Relocation" (same semantics, different location) is allowed, but the old and new codes must point
  at the same semantics.
- The domain vocabulary is closed: adding a domain requires a record of its own (to prevent the
  domains from bloating into "one per file").

### D8. The Legacy Numeric Codes Are Retired

The old numeric codes (`F200` / `S113` / `C007` …) are all retired by this decision. They were
never published externally, so no legacy rows are kept; the mapping is left here for people who
remember the old codes.

| Old code | New code |
|---|---|
| `C001` | `syntax.header-invalid` |
| `C002` | `syntax.row-too-short` |
| `C003` | `value.pin-number-invalid` / `value.pin-name-invalid` |
| `C004` | `value.electrical-type-unknown` |
| `C005` | `library.duplicate-pin-number` |
| `C006` | `library.pins-empty` |
| `C007` | `value.pin-column-invalid` |
| `F100` | `value.length-invalid` (at an angle: `value.angle-invalid`) |
| `F101` | `value.ratio-invalid` |
| `F110` | `syntax.unknown-section` |
| `F111` | `syntax.unknown-field` |
| `F112` | `syntax.row-too-short` |
| `F113` | `syntax.header-invalid` / `format.invalid-version` / `format.unsupported-version` / `syntax.invalid-token` |
| `F200` | `value.pad-number-invalid` / `value.pad-type-unknown` / `value.pad-shape-unknown` / `value.pad-size-invalid` |
| `F201` | `value.pad-attribute-invalid` (where "unknown key" is now judged `syntax.unknown-field`) |
| `F202` | `value.pad-ratio-invalid` |
| `F203` | `value.pad-connection-unknown` |
| `F204` | `value.layer-name-invalid` |
| `F210` | `library.pads-empty` |
| `F211` | `library.duplicate-pad-number` |
| `F300` | `value.graphic-invalid` |
| `F301` | `value.graphic-attribute-invalid` |
| `F400` | `library.model-invalid` / `library.field-invalid` |
| `S110` | `syntax.unknown-section` / `syntax.unknown-field` |
| `S111` | `syntax.invalid-literal` / `value.length-invalid` |
| `S112` | `syntax.row-too-short` |
| `S113` | `syntax.header-invalid` / `format.invalid-version` / `format.unsupported-version` / `syntax.invalid-token` |
| `S200` | `value.pin-number-invalid` / `value.pin-geometry-invalid` |
| `S201` | `value.pin-attribute-invalid` |
| `S202` | `value.invalid-unit` / `syntax.row-too-short` |
| `S210` | `library.pins-empty` |
| `S211` | `library.duplicate-pin-number` |
| `S212` | `syntax.row-too-short` |
| `S300` | `value.graphic-invalid` |
| `S301` | `value.graphic-attribute-invalid` |
| `S312` | `syntax.row-too-short` |
| `S400` | `library.field-invalid` |

The reasons for the splits and reclassifications:

- The old codes mixed "structural problems" and "value problems" under one number (e.g. `F201`
  reported both "through-hole missing drill" and "unknown key bogus"). After the split,
  `syntax.unknown-field` and `value.*` each belong to their own domain, and only then can agents
  branch by domain.
- The old codes' numbers never lined up with their semantics anyway (`C003` reported an invalid pin
  number/name, `C007` reported an invalid unit/alt/unknown column) — which is exactly the evidence
  that numeric codes are unmaintainable.

## Consequences

- **Cost**: the registry is one more thing to maintain; a new code means editing the table first.
  Mitigation: the code table is enforced by types (`Diagnostic["code"]` is a key of the registry, so
  wild codes do not compile), and a new code carries no ritual cost of "allocating a number".
- **Benefit**: third-party implementers can align their behavior on `code`; the `--json` payload is
  stable; error wording can be changed freely without breaking the contract.
- **Not doing**: a code's **severity** is not left to implementation discretion (the registry gives
  the normative severity; a call site may downgrade but never upgrade); no `fix` field for now (the
  hook for mechanical fixes is left for later).
