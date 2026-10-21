# ADR-0015: Licensing and Openness Policy — The Contract Layer Is Open Source Forever, the Project Is a Pure Open Technical Specification

Status: Accepted
Date: 2026-10-21
Impact: repository root (new `LICENSE`, `NOTICE`), `package.json` × 7 (add `license` field; see the addendum in decision 1), `README.md` (public statement + license section), `AGENTS.md` §2 (new invariant 19), `docs/backlog.md` (deferred-item registry); the openness of `spec/**`, `schemas/ir/v0.1/**`, `examples/**`, `tests/**` is constrained by this ADR

## Background

This repository previously had **no license statement at all**: no `LICENSE` at the root, no `license` field in any of the five `package.json` files, and the first line of the README said "this is a **private repository**". In other words, "who owns these things, can others use them, can others implement them from the spec" had never been decided.

This must be decided today, for three reasons:

1. **The value of a contract exists only when others implement it.** `AGENTS.md` §2 invariant 1 says "the IR is the single source of truth; the syntax can change, the renderer can change, the exporter can change". If the IR and the spec are private, that sentence means in practice "only I can change them" — that is not replaceability, that is lock-in.
2. **Agents are consumers, not authors.** This project targets agents: machine-parsable, checkable, locatable errors. For a machine to consume a format, that format must first have a stable public contract and a public license.
3. **The commercialization path is the opposite of "close-source first, accumulate users, open-source later".** A closed-source product only receives bug reports; it never receives the feedback a standard needs — third-party implementations, third-party designs, third-party tools built around your format. "Close it now, open it once we have feedback" has the logic inverted: by the time you open it, the ecosystem has already been taken by another format.

## Decision

### 1. Apache-2.0 across the whole repository; repository visibility stays private for now, public is the next step

- The root gains a `LICENSE` (the full Apache-2.0 text) and a `NOTICE` (attribution statement + third-party component notes: Hershey glyph data is public domain, obtained via `hersheytext` (MIT); KiCad is only an external tool and is not distributed with this repository).
- The five `package.json` files that existed at the time (root + `ir` / `parser` / `exporter` / `renderer`) uniformly gain `"license": "Apache-2.0"`. **Addendum (2026-10-21)**: two packages were added later — `core` (pure connectivity rules) and `cli` (the `texteda` command line). The rule is now **seven** `package.json` files (root + `ir` / `parser` / `exporter` / `renderer` / `core` / `cli`), and all seven carry `"license": "Apache-2.0"` and `"private": true`. The rule itself did not change: every `package.json` in the repository, present or future, follows it.
- **GitHub visibility does not change in this round; it stays private.** Switching to public is a pending manual action, not a side effect of this commit; the precondition is that the roughly 15 MB of vendor datasheets (TI, WCH and other third-party PDFs) under `examples/reference-project/docs/datasheets/` are cleaned out — distributing vendor PDFs alongside the repository is a copyright problem, not a format problem. **Addendum (2026-10-21)**: that precondition has now been cleared — the PDFs were removed from the index, excluded via `.gitignore`, declared in `NOTICE`, and **the git history was rewritten** (`filter-branch` + gc), so the PDF objects in old commits are no longer reachable. All that remains is manual work: scan for internal information → switch the GitHub visibility to public → sync the README wording (see `docs/backlog.md` F6). **The license and the "we will definitely open-source later" commitment are settled now; the visibility switch waits until the manual work is done.**
- Why Apache-2.0 rather than MIT: **standard-like projects need patent licensing** (Apache-2.0 §3 grants contributors a patent license over their contributions; MIT does not). A format that others are meant to implement must have its patent risk handled up front. MIT is reserved for pure tooling code; a single uniform license for this repository is simpler at this stage.

### 2. The Contract Layer Is Open Forever — The Hardest Rule in This ADR

The paths below belong to the **contract layer**: they are public forever, freely implementable, freely redistributable, and **must never be closed-sourced or given extra restrictions**:

|Path|What it is|
|---|---|
|`teda.md`, `spec/**`|Normative text for the language and each description kind|
|`schemas/ir/v0.1/**`|The JSON Schema contract of the IR ([ADR-0004](0004-ir-representation.md), [ADR-0008](0008-ir-shard-identity-and-hash.md))|
|`examples/reference-project/**`|A self-contained reference project: components / symbols / footprints / libraries|
|`tests/**`|Unit, contract, round-trip and conformance corpora plus golden IR|

- The **implementation layer** (`packages/**`) may change its license at any time, may be closed-sourced, may ship only binaries; none of that **affects the openness of the contract layer**. A closed-source implementation is still required to consume the public contracts listed above.
- **No back-contamination**: private extensions that "only the official implementation can read" must not leak into the contract layer. Any extension that needs to be commercialized lives in the implementation layer or in a separate description.
- This rule goes into `AGENTS.md` §2 as invariant 19, because it is a clause that **constrains the behavior of future agents**: without it, a change that "casually folds the spec into a license restriction" looks harmless.

### 3. Positioning: build a "standard proposal", not a SaaS

This is the commercial part of the ADR. The target form of textEDA is **a specification that other people's tools are built around**, not a product with subscription revenue. The payoff path, in priority order:

1. **Reputation and influence** — the specification gets adopted, cited, and written into other people's toolchains.
2. **Consulting and training** — turn "let an agent modify the board" into a deliverable service: enterprise library governance, footprint generation from datasheets, sch↔pcb consistency review.
3. **Hiring premium** — expert standing in the intersection of hardware description and agent toolchains.
4. **Ecosystem position** — others build tools on the KiCad side, the PLM side, the CI side; textEDA provides the semantic layer they all depend on.

We explicitly **do not pursue** making the implementation a subscription service as the main line. If a hosted service is offered later, it is positioned as "an optional implementation of the contract" and **must not conflict with decision 2** (a paid service must never be the only way to be "textEDA-conformant").

### 4. Acting Like a Standard Means Paying a Standard's Obligations

"Public" does not mean "a standard". As a specification proposal, TextEDA takes on these obligations:

1. **Normative**: `spec/**` must be written so that others can implement against it — clear MUST / SHOULD semantics, defined error behavior, not a description of this repository's implementation alone. The machine-readable part is carried by `schemas/ir/v0.1/**`.
2. **The conformance suite is part of the standard**: the cases and golden IR in `tests/**` are the acceptance suite for others. A third-party implementation that passes this suite may claim conformance with "TextEDA v0.x".
3. **Implementability is a release gate**: before v0.1 ships, there must be a minimal implementation that depends only on `spec/**` and `schemas/**` — and does not read `packages/**` source — that passes the core of the conformance suite. This rule is testable: you know the moment you write it. It prevents the most common way a standard fails: "only my implementation understands the spec".
4. **Versioning and compatibility**: `format` (syntax) and `ir_version` (IR shape) are versioned independently ([ADR-0008](0008-ir-shard-identity-and-hash.md)); breaking changes must ship a migration script and migration notes (`AGENTS.md` §2 invariant 10). No SLA is promised — only semantic versioning plus a migration path.
5. **Do not treat the reference implementation as the spec**: the reference implementation (`packages/**`) is "an implementation", not "the only correct behavior". When the spec and the implementation conflict, change the spec — do not bend the implementation to fit the implementation.

### 5. Trademarks and Naming

- Apache-2.0 §6 grants no trademark license. Third-party implementations should call themselves "TextEDA v0.x-conformant" or "TextEDA-compatible" and **must not** use TextEDA as their product name (unless a separate trademark license is granted). No trademark is registered.
- The project name TextEDA itself implies no endorsement of KiCad / Altium / EAGLE trademarks; this project is a complement and an upstream for those tools, not a replacement (`AGENTS.md` §1 "not").

### 6. Governance and Contribution

- At this stage there is a single maintainer, which matches the early stage of most open standards; we do not pretend to have a community governance process.
- The contribution entry point follows `AGENTS.md` §12: **the spec and the conformance cases go in the same commit** — submitting only the implementation is not the rule, and neither is submitting only cases without the spec. Breaking changes go through an ADR.
- The merge bar for external PRs is the same as internally: pass `bun test`, `bun run typecheck`, `bun run gen:check`, `bun run fmt:teda --check`, plus the implementability check from §4.3.

### 7. Deferred (recorded in `docs/backlog.md`)

- **npm publishing**: the seven packages keep `"private": true` and are not published to npm for now. Reasons: there are no external consumers yet, and the current packages are TS source at version `0.0.0`. The publishing form (npm / git dependency / IR schema only) is decided once a real third-party implementation has landed.
- **Official paid hosted validator**: doable, but it must be an optional implementation, never the only way to be "textEDA-conformant" (decisions 3 and 4.2).
- **Trademark registration**: deferred until the ecosystem has formed.

## Consequences

- **Benefits**: the contract can be implemented and consumed by third parties; agents get a stable public input format; "the IR can be reimplemented" stops being a slogan and becomes an enforceable premise; with the license and the openness commitment settled, switching to public later is a single settings operation that needs no further negotiation.
- **Costs**: normative text becomes a public commitment and is slower to change than in the private era (every breaking change needs a migration script and notes); the reference implementation is demoted from "product" to "example + acceptance baseline", and we have to accept others writing different implementations; once we go public there is no way back, and the repository's rough edges stay visible for good.
- **The parts that cost nothing**: the language syntax, the IR contract and the `packages/**` implementation code are untouched; `package.json` only gained one `license` field, and both `private: true` and the repository visibility stay unchanged.
- **The main risk**: the biggest risk of the standard-proposal model is **adoption rate** — a specification nobody uses is nothing, and going public only makes that visible earlier. The mitigations are the three items in decision 4: the conformance suite as a distribution vehicle, the reference project as a copyable sample, and the "implementable from the spec alone" gate, which is testable. This risk is not dissolved by staying closed (closing only lowers the adoption rate); it can only be addressed through spec quality and usability. **The cost of this is that the risk stays hidden while the repository is still private** — that is a known cost of keeping it private, and F4's implementability check plus F6's cleanup are meant to surface it early.
- **An honest addition**: this repository is currently at the "toolchain start" stage (`AGENTS.md` §0), and board-level description (`sch` / `pcb`) is not implemented yet. When we switch to public, what can be shown externally is the language, the IR, the libraries and the export loop — not full board-level capability. The timing trade-off is: **switch to public first in exchange for external feedback**, or **wait until P0 is done**. This ADR's choice is to **settle the license and the openness commitment now, and switch visibility once the datasheet copyright cleanup (F6) is done** — the copyright problem is harder than the timing problem, and switching too early means rewriting history.
