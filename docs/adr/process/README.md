# Process — decisions

## Scope

How the project itself is run: the implementation stack and the agent's entry point, the openness policy, the questions that stay outside the language, and the rule that each fact has one authority.

## Not here

- The diagnostic registry — [ADR-0102](../language/0102-diagnostic-error-codes.md).
- The module mechanism — [ADR-0112](../schematic/0112-modules-compose-boards.md).

## Reading order

1. [0137](0137-implementation-stack-and-agent-entry.md) — the implementation stack, and the agent's one entry point.
2. [0138](0138-licensing-and-open-standard.md) — the openness policy.
3. [0139](0139-process-entities-outside-the-language.md) — process entities stay outside the language.
4. [0140](0140-documentation-has-one-authority-per-fact.md) — each fact has one authority, and the rest is a pointer.
5. [0143](0143-the-agent-surface-is-a-set-of-verbs.md) — the agent's surface is a set of verbs; every host adapts the same ones.
6. [0144](0144-the-mcp-server-is-a-slice-we-write-ourselves.md) — the MCP server is a slice we write ourselves.
7. [0145](0145-a-host-is-entered-once.md) — a host is entered once per half: one route for the tools, one surface for the picture.
8. [0146](0146-the-picture-reaches-a-host-by-three-routes.md) — the picture reaches a host by three routes, and host-native code is written only where nothing else reaches.

## Records

| Record | Title | Status | Date |
|---|---|---|---|
| [ADR-0137](0137-implementation-stack-and-agent-entry.md) | Implementation Stack and the Agent's Entry Point | Accepted | 2026-10-21 |
| [ADR-0138](0138-licensing-and-open-standard.md) | Licensing and Openness Policy | Accepted | 2026-10-21 |
| [ADR-0139](0139-process-entities-outside-the-language.md) | Process Entities Stay Outside the Language | Accepted | 2026-10-22 |
| [ADR-0140](0140-documentation-has-one-authority-per-fact.md) | Documentation Has One Authority per Fact, and the Rest Is a Pointer | Accepted | 2026-10-27 |
| [ADR-0143](0143-the-agent-surface-is-a-set-of-verbs.md) | The Agent's Surface Is a Set of Verbs; Every Host Adapts the Same Ones | Accepted | 2026-10-29 |
| [ADR-0144](0144-the-mcp-server-is-a-slice-we-write-ourselves.md) | The MCP Server Is a Slice We Write Ourselves | Accepted | 2026-10-29 |
| [ADR-0145](0145-a-host-is-entered-once.md) | A Host Is Entered Once — One Route for the Tools, One Surface for the Picture | Accepted | 2026-10-29 |
| [ADR-0146](0146-the-picture-reaches-a-host-by-three-routes.md) | The Picture Reaches a Host by Three Routes, and a Host-Native Plugin Is Written Only Where Nothing Else Reaches | Accepted | 2026-10-30 |
