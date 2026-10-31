# Project — decisions

## Scope

The project as a container: the ownership model of its tree, how boards are linked, what identifies an instance, and how a renumbering is executed.

## Not here

- The IR shard layout — [ADR-0006](../02-ir/0006-ir-shards-and-hashes.md).
- The module layer — [ADR-0013](../04-schematic/0013-modules-compose-boards.md).

## Reading order

1. [0008](0008-project-tree-has-owners.md) — the tree says who owns what.
2. [0009](0009-board-linking.md) — boards are linked in a `system` description.
3. [0010](0010-instance-identity-is-a-uid.md) — an instance's identity is a uid, not its refdes.
4. [0011](0011-renumbering-is-a-code-executed-rename.md) — renumbering is a rename the code performs.

## Records

| Record | Title | Status | Date |
|---|---|---|---|
| [ADR-0008](0008-project-tree-has-owners.md) | The Project Tree Has Owners | Accepted | 2026-10-22 |
| [ADR-0009](0009-board-linking.md) | How Boards Are Linked Together | Accepted | 2026-10-20 |
| [ADR-0010](0010-instance-identity-is-a-uid.md) | Instance Identity Is a Stable Project-Local UID, Not the Refdes | Accepted | 2026-10-25 |
| [ADR-0011](0011-renumbering-is-a-code-executed-rename.md) | Renumbering Is a Code-Executed Global Rename, Not an Agent Edit | Accepted | 2026-10-25 |
