# ADR-0146: The Picture Reaches a Host by Three Routes, and a Host-Native Plugin Is Written Only Where Nothing Else Reaches

Status: Accepted
Date: 2026-10-30
Scope: Decides: that a picture reaches a host by one of exactly three routes — a browser, an MCP Apps view, or a host-native plugin; which of the six surveyed hosts takes which route, and therefore where host-native code is worth writing; that all three routes share one client half behind an injected transport; and where the MCP Apps increment belongs. Does not decide: the route the verbs take — see ADR-0143 D5 and ADR-0145 D2; which host the picture half is built for first — see ADR-0142 D9; the MCP Apps protocol itself — see the extension's own specification.
Related: [ADR-0142](../view/0142-the-review-app-is-a-plugin-of-the-agent-workbench.md), [ADR-0143](0143-the-agent-surface-is-a-set-of-verbs.md), [ADR-0144](0144-the-mcp-server-is-a-slice-we-write-ourselves.md), [ADR-0145](0145-a-host-is-entered-once.md)
Impact: `docs/plugin-hosts.md`; `docs/tool-formats.md`; `docs/backlog.md` (F53, F59); `packages/cli/src/mcp.ts`; `packages/viewer/src/types.ts`

## Background

The question that produced this record: *if compatibility is the goal, is the answer MCP plus a
browser — and does adapting to each agent's own webview mean one plugin per host?*

The two halves of our surface answer it differently, and the answers are not the same shape.

The **verb half** needs no plugin per host. It is one MCP server for every host that speaks MCP,
plus two thin native projections where a host has a registry of its own
([ADR-0143](0143-the-agent-surface-is-a-set-of-verbs.md) D5, [ADR-0145](0145-a-host-is-entered-once.md)
D2). That is settled and this record does not reopen it.

The **picture half** had no such census. It has three ways to reach a host and they cost very
different amounts, so *which route a host takes* — not *which host we like* — is what decides
where host-native code is worth writing.

The route nobody had counted is the protocol-level one. **MCP Apps** is an official MCP
extension, identifier `io.modelcontextprotocol/ui`: a tool declares `_meta.ui.resourceUri` pointing
at a `ui://` resource, the host fetches that resource and renders its HTML in a sandboxed iframe,
and the app and the host then exchange a JSON-RPC dialect whose methods carry a `ui/` prefix
(`ui/initialize`, `ui/notifications/tool-result`, `ui/message`, `ui/open-link`, …) over
`postMessage`. It is opt-in on both sides: the client advertises the extension in `capabilities`,
the server declares it too. The specification is
`ext-apps/specification/2026-01-26/apps.mdx` (SEP-1865, stable 2026-01-26).

Two facts about that route had to be verified rather than assumed, and both changed the answer.

**The client list is the extension overview's own sentence, not the community matrix.** The
extension support matrix at `modelcontextprotocol.io/extensions/client-matrix` carries an MCP Apps
column and is maintained by the community; its cells render **empty** for every client, and for
the contract's other extensions too (only the Skills column has marks). An empty cell is not a
"no". The authoritative statement is the paragraph on
`modelcontextprotocol.io/extensions/apps/overview` under *Client support*, which names the
clients: **Claude (web), Claude Desktop, VS Code GitHub Copilot, Microsoft 365 Copilot, Goose,
Postman, MCPJam, Archestra.AI.** **Claude Code is not among them.**

**No host we target renders MCP Apps today.** The list above contains none of the six hosts this
project surveyed. And DSH — our own picture half's first host
([ADR-0142](../view/0142-the-review-app-is-a-plugin-of-the-agent-workbench.md) D9) — has no MCP
Apps support in its source at all: `ui://`, `resourceUri` and `modelcontextprotocol/ui` occur
**zero** times across its packages.

So the route exists, it is the only one that scales without per-host code, and today it reaches
none of the hosts we actually write for.

## Decision

### D1. A picture reaches a host by one of three routes, and that is the whole set

| Route | What carries it | What it costs us | What it gives the person |
|---|---|---|---|
| **Browser** | `texteda review` over HTTP, or its static export | nothing host-specific — the route already exists | a page in a browser, in any host at all |
| **MCP Apps** | a tool's `_meta.ui.resourceUri` and a `ui://` resource on our own MCP server | one more surface on the server we already run, plus a client that speaks the `ui/` dialect | the drawing inside the host's own conversation, sandboxed by the host |
| **Host-native plugin** | the host's own extension API — DSH slots, a Claude Code mod | per-host code, and a second client shape to keep in step | the drawing in the workbench's own surface, with pointer input |

Three is not a preference; it is what the hosts and the protocol actually offer. A fourth
mechanism would have to bring its own transport, and none does.

The browser route is the floor and it is not a fallback in the dismissive sense: it is the only
route that needs no host to cooperate. A host with a browser and nothing else — Codex, WorkBuddy,
Qoder, a terminal — shows our picture through it today, with zero host-specific code.

### D2. All three routes share one client half behind an injected transport

The drawing is written once. `mountReview(root, model, api)` takes the document and the transport
apart: the model is what the host can tell us, and `ReviewApi.post(path, body)` is how anything is
asked for or written. Nothing below that seam knows whether the answer came from `fetch`, from a
`ui/` JSON-RPC call, or from a host route.

This is the rule that keeps the three routes from becoming three implementations, and it is a
rule about our code, not about a host's API: a new route is an adapter behind `ReviewApi`, never a
fork of the drawing.

### D3. Host-native code is written only for a host that has a drawing surface and no other route

The census, host by host. A host earns its own picture half only when the first two columns are
both true and the third is false:

| Host | Drawing surface | Renders MCP Apps | Picture route |
|---|---|---|---|
| DSH | yes — slots in the `web` and `desktop` profiles | no — zero occurrences in its source | **host-native plugin** (built; see below) |
| Claude Code | yes — a mod's `Pane`, `AbovePrompt`, and `Client` / `Svg` regions | no — absent from the client-support list | **host-native plugin**, when the picture half reaches it |
| Codex CLI | none found | no | browser |
| WorkBuddy | none found | no | browser |
| Qoder | none found | no | browser |
| pi / omp | none — no webview, no panel extension point | no | browser |

Two host-native halves, not six. That is the answer to the question this record came from:
adapting to an agent's own webview does **not** mean one plugin per host — it means one plugin
per host that has a webview and no protocol-level way to fill it.

A host that later declares `io.modelcontextprotocol/ui` moves from the third route to the second
and *keeps* whatever host-native code it already has; the record does not require removing it. What
it forbids is writing a third one for a host the browser already reaches.

### D4. The MCP Apps increment belongs to our own MCP server, and it is filed, not built

The portable route needs no new process: `texteda mcp` is ours to extend
([ADR-0144](0144-the-mcp-server-is-a-slice-we-write-ourselves.md) D1). The increment is bounded —
`resources/read` serving a `ui://` resource with mimeType `text/html;profile=mcp-app`, a tool
carrying `_meta.ui.resourceUri`, and a client entry that speaks the `ui/` dialect behind D2's
`ReviewApi`.

It is **not built here**, because nothing on our machines renders it: no host in the census is an
MCP Apps client, so the route could be written but not exercised, and an unexercised surface is
one we would be guessing about. Backlog F59 carries the increment and its conditions.

### D5. The verbs are not part of this

The question mixed the two halves. The verb half's census is [ADR-0145](0145-a-host-is-entered-once.md)
D2's and its route is [ADR-0143](0143-the-agent-surface-is-a-set-of-verbs.md) D5's; this record
neither restates nor changes them. A host-native picture and an MCP-served verb catalogue are one
plugin only when the host needs both — which is the case for exactly the hosts in D3's
host-native column.

## Consequences

- Writing a picture half is now a decision with a test: does this host have a drawing surface, and
  does it render MCP Apps? If the second is yes, the answer is the server, not the host.
- F53's DSH plugin stays worth building, and its justification is sharper: DSH is the one host in
  the census that has the drawing surface *and* provably no MCP Apps support.
- Claude Code's picture half is justified on the same test, and its cost is known:
  [ADR-0145](0145-a-host-is-entered-once.md) D3 already recorded that its client file is a
  different shape.
- The `ReviewApi` seam in `packages/viewer/src/types.ts` is load-bearing: a route that cannot be
  expressed behind it is a route we cannot take without forking the drawing.
- The client-support list is a dated fact, not a constant. When a host in D3's browser column joins
  it, the route changes without any of our code changing — that is the point of D1's second route.
- `docs/plugin-hosts.md` gains the three-route census and loses the claim that the community
  matrix is the authority for MCP Apps support.

## What this record does not change

- The plugin's one write is still the print page's positions
  ([ADR-0142](../view/0142-the-review-app-is-a-plugin-of-the-agent-workbench.md) D3), and the
  re-anchor is still the command line's (D10).
- One route per half per host ([ADR-0145](0145-a-host-is-entered-once.md) D1).
- The verbs are still one catalogue served by the command line
  ([ADR-0143](0143-the-agent-surface-is-a-set-of-verbs.md) D1, D2).
- The browser route's server and static export stay
  ([ADR-0142](../view/0142-the-review-app-is-a-plugin-of-the-agent-workbench.md) D7).
