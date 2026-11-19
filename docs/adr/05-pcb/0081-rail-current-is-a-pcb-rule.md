# ADR-0081: A Rail's Maximum Current and Trace Minimum Width Are PCB Rules

Status: Accepted
Date: 2026-11-19
Scope: Decides: where a rail's stated maximum current belongs, how its provenance is recorded, and the narrow check performed on matching traces. Does not decide: how maximum current is derived, how current splits between branches, or the current capacity of vias and pours; those remain unmodeled (F80).
Related: [ADR-0026](../07-devices/0026-a-part-states-its-own-ratings.md)
Impact: `spec/teda.md` §7.3, §12.1, §12.4; `spec/pcb.md` §4.10, §6.2; `packages/parser`; `packages/core`; `schemas/ir/v0.23`; `scripts/migrate-0.19.ts`

## Context

A schematic `current <net> <max>` is a restatement of a rail's current, not a requirement on an individual component. The schematic cannot identify which net members or branches carry it. Keeping the value there both assigns the fact to the wrong layer and invites readers to mistake it for a checked component rating. The schematic's `current <pin> <max>` remains a component requirement and continues to be compared with the part's rating ([ADR-0026](../07-devices/0026-a-part-states-its-own-ratings.md)).

The PCB rules already own physical design intent, including `min_width`, but had no place for a rail's stated maximum current or its provenance. A rule must not imply that TextEDA can derive a physical track width from current: it has no declared current-distribution model and does not apply an IPC or manufacturer capacity model.

## Decision

### 1. The PCB owns the stated rail value

Language 0.19 removes `current <net> <max>` from schematic constraints. `current <pin> <max>` remains unchanged.

A PCB may state one current rule per net:

```text
rules
  current  VBUS  3A  0.5mm  docs/power-budget.md#vbus
```

The columns are `current <net> <max_current> <min_width> <source>`. `max_current` is a positive current quantity, `min_width` is a positive length, and `source` is one non-empty cell. A source may be a URI or a project-relative path with an optional anchor. The parser stores its exact text. It does not fetch the source or assert that it exists, is true, or has been reviewed.

### 2. The only comparison is declared trace width

For every `trace` whose net equals the rule's net, the checker compares its declared `width` with the same `min_width`. A smaller width is an error; equality and larger widths pass this comparison. The declared maximum current is retained as the rail input and report context; it is not used to calculate a width.

The report states that the comparison is trace-only and does not check actual geometric current capacity. It does not check ordinary vias, `physical_only stitching` vias or zones/pours for current capacity, and identifies same-net vias (including stitching vias) and zones as unchecked when present. It does not prove every branch carries the stated maximum current. It does not apply IPC, temperature-rise, copper-weight or manufacturer ampacity rules. A passing trace-width comparison is not a finding that the rail is safe at the stated current.

### 3. Migration preserves uncertainty

The language and IR advance to 0.19 and v0.23 respectively. v0.22 remains immutable. `bun run migrate:0.19 <project dir>` updates recognized language version headers and project format. Each removed schematic net-current row becomes a `TODO(F88)` comment retaining the original net and exact current literal; the migration does not create an active PCB rule or infer a replacement value. The comment directs the designer to add an approved maximum current, minimum width and source manually. Pin-current rows are preserved byte-for-byte apart from normal version/header rendering.

The reference project removes active net-current rows and retains TODO comments. It does not gain a current rule without an approved value, width and source.

## Consequences

- The PCB description now records the maximum current it is intended to carry, a minimum declared width for each matching trace, and the text that points to the design evidence.
- A narrow machine check catches a trace whose declared width violates that explicit rule, but does not claim that its copper can carry the stated current.
- `design.current-rail` is no longer emitted. Pin-current rating checks and their coverage remain unchanged.
- Old schematic rail values cannot silently become new physical facts during migration; the designer must review and replace them.
