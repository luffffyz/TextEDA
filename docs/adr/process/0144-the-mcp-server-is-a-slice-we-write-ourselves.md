# ADR-0144: The MCP Server Is a Slice We Write Ourselves

Status: Accepted
Date: 2026-10-29
Scope: Decides: that the MCP server is written by hand, in the CLI package, over the verbs' own functions; that it speaks both eras of the protocol, the `initialize` handshake and the `server/discover` probe; and that its tools are the catalogue's entries and nothing else. Does not decide: what the catalogue holds (ADR-0143 D9), which hosts get a native adapter, or whether the command line's surface gets a version line of its own (ADR-0143).
Related: [ADR-0143](../process/0143-the-agent-surface-is-a-set-of-verbs.md), [ADR-0137](0137-implementation-stack-and-agent-entry.md), [ADR-0120](../manufacturing/0120-the-manufacturing-output-path.md)
Impact: `packages/cli/src/mcp.ts`; `packages/cli/scripts/texteda.ts`; `packages/cli/test/mcp.test.ts`; `docs/tool-formats.md`; `docs/backlog.md` (F57)

## Background

Four of the six hosts surveyed in `docs/tool-formats.md` — Claude Code, Codex, WorkBuddy and Qoder —
take a tool only through MCP (ADR-0143 D5). So the MCP server is not a compatibility layer for
traditional applications; it is the ordinary route into the ecosystem, and it is the adapter that
has to exist first.

The question this record answers is what the server is made of: the official SDK
(`@modelcontextprotocol/sdk`) or the slice we need, written here.

## Decision

### D1. The server is written by hand

The stdio transport is one JSON object per line, in and out. The server side needs three methods —
`initialize`, `tools/list`, `tools/call` — and the answers are the verbs' own values. That is a
file's worth of code, and taking the SDK would add a runtime dependency to a repository whose core
chain has none (invariant 20) and whose parser is explicitly meant to stay dependency-free
([ADR-0137](../process/0137-implementation-stack-and-agent-entry.md)).

The cost of writing it is that the protocol's edges are ours to keep: the version negotiation, the
error codes, the shape of a tool result. Those are checked by the protocol's own specification, and
the server's answers are checked against the catalogue.

### D2. It lives in the CLI package

`packages/cli/src/mcp.ts`, behind the verb `texteda mcp`. It is another transport over the same
verbs, not a package of its own: a separate package would be a second place where a verb's name,
its arguments and its result are written down, and the catalogue would then have a third home.

### D3. The server speaks both eras of the protocol

The `initialize` handshake of the older revisions, and the `server/discover` probe of the 2026-07-28
revision. The newer revision dropped the handshake: every request carries the version in `_meta`,
and a server that speaks only the new one rejects an `initialize` request. A dual-era server is
what the specification describes, and it is what the surveyed hosts need while they move from one
era to the other.

The versions it speaks: `2026-07-28`, `2025-11-25`, `2025-06-18`, `2025-03-26`, `2024-11-05`. A
request that asks for a version among them is answered in that version; a request that asks for
another is refused with the modern error that lists what the server does speak.

### D4. The tools are the catalogue's entries

`tools/list` is the catalogue, projected into MCP's field names (`inputSchema`, `annotations`).
There is no second list of tools, and a verb that is not in the catalogue cannot be called through
MCP.

### D5. A tool's result is the verb's value

The result carries the value in `structuredContent` and the same value serialized as text, so a
client that understands only the older shape still reads something. A tool that could not do its
work is a tool execution error (`isError: true`) with the reason as text — the model can read it
and try again. An unknown tool is a protocol error, because no argument would make it work.

The value is the same one the command line prints with `--json`, field for field, because both
faces call the same function (ADR-0143 D2).

## Consequences

- The four MCP-only hosts can be served by one command: `texteda mcp`.
- The protocol's edges are ours: a change in the specification is a change in `mcp.ts`, and the
  test is the specification's own examples.
- The SDK stays available as an option: if the slice grows past what this file can hold, taking
  the SDK is a new dependency and needs its own decision ([ADR-0137](../process/0137-implementation-stack-and-agent-entry.md)).
