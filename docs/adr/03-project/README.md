# Project — decisions

## Scope

The project as a container: the ownership model of its tree, the project-wide logical root, physical PCB implementations, explicit interconnects, how boards are linked, what identifies an instance, and how a renumbering is executed.

## Not here

- The IR shard layout — [ADR-0006](../02-ir/0006-ir-shards-and-hashes.md).
## Reading order

1. [0008](0008-project-tree-has-owners.md) — the tree says who owns what.
2. [0009](0009-board-linking.md) — historical board-linking model, replaced by explicit project interconnects in [ADR-0069](0069-project-level-logical-root-and-physical-board-mapping.md).
3. [0010](0010-instance-identity-is-a-uid.md) — an instance's identity is a uid, not its refdes.
4. [0011](0011-renumbering-is-a-code-executed-rename.md) — a renumbering is a rename the code performs.
5. [0060](0060-a-write-keeps-the-bytes-it-replaced.md) — a write keeps what it replaced.
6. [0069](0069-project-level-logical-root-and-physical-board-mapping.md) — one project logic root and explicit physical PCB ownership.

## Records

| Record | Title | Status | Date |
|---|---|---|---|
| [ADR-0008](0008-project-tree-has-owners.md) | The Project Tree Has Owners | Accepted | 2026-10-22 |
| [ADR-0009](0009-board-linking.md) | How Boards Are Linked Together | Accepted | 2026-10-20 |
| [ADR-0010](0010-instance-identity-is-a-uid.md) | Instance Identity Is a Stable Project-Local UID, Not the Refdes | Accepted | 2026-10-25 |
| [ADR-0011](0011-renumbering-is-a-code-executed-rename.md) | Renumbering Is a Code-Executed Global Rename, Not an Agent Edit | Accepted | 2026-10-25 |
| [ADR-0060](0060-a-write-keeps-the-bytes-it-replaced.md) | A Write Keeps the Bytes It Replaced | Accepted | 2026-11-04 |
| [ADR-0069](0069-project-level-logical-root-and-physical-board-mapping.md) | One Project Logic Root, Physical PCB Implementations, and Project Views | Accepted | 2026-11-09 |
