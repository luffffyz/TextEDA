# ADR-0024: Level Tags in Flattened Names — `P` for Pages, `MOD` for Modules

Status: Accepted
Date: 2026-10-21
Impact: `teda.md` §7.7 (naming); `AGENTS.md` §4.2; `examples/reference-project/`; the descriptions in `schemas/ir/v0.2/common.schema.json` and `schemas/ir/v0.2/schematic.schema.json`; [ADR-0007](0007-page-internal-net-naming.md) (examples only)

**Amendment (2026-10-21, [ADR-0025](0025-flat-board-and-print-pages.md))**: the page level is
withdrawn, so the `P` tag goes with it. The remaining hierarchy is the **module**, and its tag is
**`M`** — one character, because the tag reaches the silkscreen: `M1.R1`, not `MOD1.R1`. The table in
decision 1 is therefore:

| Level | Qualified name | Example | Tag |
|---|---|---|---|
| Board root | `<name>` (no `.`) | `R1`, `GND` | none |
| Module instance (planned) | `<module_instance_id>.<local>` | `M1.R1` | `M` |

`P` is free again (no page level exists to tag), and `MOD` is not used. The reference project's
`M1` / `M2` page instances are gone with the pages; the module tag `M` is reserved for the hierarchy
when it lands (`docs/backlog.md` F13).

The decisions below are the record of the withdrawn `P` / `MOD` scheme; the table above is the rule
in force.

## Background

A design has three levels: the **board root**, a **page** inside the board, and — planned, not yet implemented — a **module** (hierarchy, `docs/backlog.md` F13). After flattening, everything lives in one namespace, and the level survives only in the *name*:

- board-root names are bare: `R1`, `GND`;
- in-page names are qualified: `<page_instance_id>.<local>`, e.g. `M1.R1`, `M2.BOOT` ([ADR-0007](0007-page-internal-net-naming.md) decision 3).

The reference project named its page instances `M1` and `M2`. `M` reads as "module", and the hierarchy — a third level with the same shape — is coming. A reader of a `pcb` file sees `M2.C1` and cannot tell whether `M2` is a page or a module, because the letter is the only marker and it points at the wrong level. The names were also free-form: nothing in the language required `M`, so the meaning was carried entirely by the examples.

## Decision

### 1. The outer id of a qualified name carries the level, by a reserved tag

| Level | Flattened name | Example | Tag |
|---|---|---|---|
| Board root | `<name>` (no `.`) | `R1`, `GND` | none |
| Page instance | `<page_instance_id>.<local>` | `P1.R1`, `P2.BOOT` | `P` |
| Module instance (planned) | `<module_instance_id>.<local>` | `MOD1.R1` | `MOD` |

- `P` is the tag for page instances; `MOD` is reserved for module instances and may not be reused by the hierarchy. `M` is retired — it read as "module", which is exactly the confusion.
- The reference project and the documentation move from `M1` / `M2` to `P1` / `P2`. The rule of [ADR-0007](0007-page-internal-net-naming.md) is unchanged: a board-level name contains no `.`, an in-page name is `<page_instance_id>.<local>`.

### 2. The tag is a convention, not a grammar rule

`page_instance_id` stays a free identifier (`[A-Z]+[0-9]+`, the same rule as `refdes`). The tool does not reject a page instance named `Q1`.

The reason is the language version rule ([ADR-0022](0022-language-versioning.md)): restricting a free identifier makes existing files invalid, which is a MAJOR change, and MAJOR is reserved for the `1.0` semantic freeze. A naming style is not worth the freeze. The tag is therefore carried by the spec, the examples and the reference project — and it can be enforced at `1.0` without a migration.

### 3. The level is structural wherever the IR has a field for it

A name is not the only carrier:

- in the IR, an in-page instance carries its `page` field, so a consumer never has to parse the instance id to learn the level;
- a net id keeps the qualified form, and a `.` in a net id means "in-page" ([ADR-0007](0007-page-internal-net-naming.md) decision 4);
- when the hierarchy lands, module instances get the same treatment.

Adding a `page` field to nets in the IR would make the level machine-readable for nets as well, but that changes the IR shape and therefore the IR contract version. It is not needed to make the names unambiguous, so it is not done here.

## Consequences

- **The names say what they are.** `P2.BOOT` in a `pcb` file is a page net; `MOD1.BOOT` will be a module net. The two cannot be confused, and the third level has a reserved tag before it exists.
- **The convention is not enforced.** A project that names its page instances `M1` keeps working and keeps producing `M1.*` names; the level is still unambiguous to the tools, only the human reading the file has to look it up. Enforcement is deferred to the `1.0` milestone.
- **Existing artifacts change.** The reference project's instance ids, net names and PCB references change, so the IR shards and the project hash change. Nothing in the contract changes: the id patterns in the schemas accept both forms, and the IR contract version stays `0.1`.
- **The examples in [ADR-0007](0007-page-internal-net-naming.md) are updated** to the `P` tag; its decisions are unchanged.

## Follow-up

- When the hierarchy lands (`docs/backlog.md` F13), it must use the `MOD` tag and must document how a module instance and a page instance may coexist in one board's namespace.
- At the `1.0` milestone, decide whether the tag becomes a checked rule (a diagnostic that a page instance id does not start with `P`).
