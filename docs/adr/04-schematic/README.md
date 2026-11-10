# Schematic — decisions

## Scope

The schematic as the truth about the project: its module composition, flattening, connectivity authority, and project-wide logical root.

## Not here

- The view layer, where a partition becomes a print page — [ADR-0035](../09-view/0035-the-view-layer-is-a-drawing.md).
- The project/PCB mapping — [ADR-0069](../03-project/0069-project-level-logical-root-and-physical-board-mapping.md).
## Reading order

1. [0012](0012-one-flat-schematic-per-board.md) — historical single-board schematic rule, replaced at project scope by [ADR-0069](../03-project/0069-project-level-logical-root-and-physical-board-mapping.md).
2. [0013](0013-modules-compose-boards.md) — modules hold electrical truth and flatten into the logical IR.
3. [0014](0014-connectivity-has-one-authority.md) — connectivity has one authority.
4. [0015](0015-flattening-and-the-net-set.md) — flattening, and what a net becomes.
5. [0069](../03-project/0069-project-level-logical-root-and-physical-board-mapping.md) — the project-level logical root and physical ownership.

## Records

| Record | Title | Status | Date |
|---|---|---|---|
| [ADR-0012](0012-one-flat-schematic-per-board.md) | One Flat Schematic per Board; the Partition Moves to the View Layer | Accepted | 2026-10-21 |
| [ADR-0013](0013-modules-compose-boards.md) | A Board Is Composed of Modules; the IR Stays Flat | Accepted | 2026-10-22 |
| [ADR-0014](0014-connectivity-has-one-authority.md) | Connectivity Has One Authority; Reverse Engineering Is an Import, Not a Mode | Accepted | 2026-10-22 |
| [ADR-0015](0015-flattening-and-the-net-set.md) | Flattening and the Net Set | Accepted | 2026-10-20 |
| [ADR-0069](../03-project/0069-project-level-logical-root-and-physical-board-mapping.md) | One Project Logic Root, Physical PCB Implementations, and Project Views | Accepted | 2026-11-09 |
