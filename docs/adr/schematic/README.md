# Schematic — decisions

## Scope

The schematic as the truth about a board: its shape, the modules it is composed of, the flattening that erases the hierarchy, and the authority that decides connectivity.

## Not here

- The view layer, where a partition becomes a print page — [ADR-0134](../view/0134-the-view-layer-is-a-drawing.md).
- How copper implements a declared connection — [ADR-0119](../pcb/0119-connect-pairs-need-copper.md).

## Reading order

1. [0111](0111-one-flat-schematic-per-board.md) — one flat schematic per board; a partition is a print page.
2. [0112](0112-modules-compose-boards.md) — a board is composed of modules; the IR stays flat.
3. [0113](0113-connectivity-has-one-authority.md) — connectivity has one authority.
4. [0114](0114-flattening-and-the-net-set.md) — flattening, and what a net becomes.

## Records

| Record | Title | Status | Date |
|---|---|---|---|
| [ADR-0111](0111-one-flat-schematic-per-board.md) | One Flat Schematic per Board; the Partition Moves to the View Layer | Accepted | 2026-10-21 |
| [ADR-0112](0112-modules-compose-boards.md) | A Board Is Composed of Modules; the IR Stays Flat | Accepted | 2026-10-22 |
| [ADR-0113](0113-connectivity-has-one-authority.md) | Connectivity Has One Authority; Reverse Engineering Is an Import, Not a Mode | Accepted | 2026-10-22 |
| [ADR-0114](0114-flattening-and-the-net-set.md) | Flattening and the Net Set | Accepted | 2026-10-20 |
