# PCB — decisions

## Scope

The board description: the segment set it stores, who produces the layout, how copper fill is computed, and what a partial or an unimplemented layout is allowed to be.

## Not here

- Connectivity authority — [ADR-0113](../schematic/0113-connectivity-has-one-authority.md).
- The manufacturing output path — [ADR-0120](../manufacturing/0120-the-manufacturing-output-path.md).

## Reading order

1. [0115](0115-agent-first-pcb-description.md) — the board description stores physical facts and rule intent.
2. [0116](0116-layout-and-routing-are-agent-driven.md) — layout and routing are agent-driven and checker-gated.
3. [0117](0117-copper-fill-uses-a-geometry-kernel.md) — copper fill is computed by a self-built geometry kernel.
4. [0118](0118-a-partial-layout-is-legal.md) — a partial layout is legal, and it is reported.
5. [0119](0119-connect-pairs-need-copper.md) — a declared `connect` pair must be implemented by copper.

## Records

| Record | Title | Status | Date |
|---|---|---|---|
| [ADR-0115](0115-agent-first-pcb-description.md) | Agent-First PCB Description (Segment Set and Trade-offs) | Accepted | 2026-10-20 |
| [ADR-0116](0116-layout-and-routing-are-agent-driven.md) | Layout and Routing Are Agent-Driven, Checker-Gated, and Frozen on Acceptance | Accepted | 2026-10-26 |
| [ADR-0117](0117-copper-fill-uses-a-geometry-kernel.md) | Copper Fill Uses a Self-Built Constrained Geometry Kernel | Accepted | 2026-10-26 |
| [ADR-0118](0118-a-partial-layout-is-legal.md) | A Partial Layout Is Legal, and It Is Reported | Accepted | 2026-10-23 |
| [ADR-0119](0119-connect-pairs-need-copper.md) | A Declared `connect` Pair Must Be Implemented by Copper | Accepted | 2026-10-23 |
