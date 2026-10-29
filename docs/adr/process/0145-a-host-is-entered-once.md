# ADR-0145: A Host Is Entered Once — One Route for the Tools, One Surface for the Picture

Status: Accepted
Date: 2026-10-29
Scope: Decides: that a host is entered once per half — the verbs reach it over one route and the picture reaches it over one surface; that the verbs go over MCP wherever the host speaks it, our own harness excepted; and that what the picture half needs is a drawing surface, not a session page. Does not decide: which host the picture half is built for first, or what a plugin package carries — see ADR-0142's open points and the backlog.
Related: [ADR-0142](../view/0142-the-review-app-is-a-plugin-of-the-agent-workbench.md), [ADR-0143](0143-the-agent-surface-is-a-set-of-verbs.md), [ADR-0144](0144-the-mcp-server-is-a-slice-we-write-ourselves.md)
Impact: `docs/tool-formats.md`; `docs/plugin-hosts.md`; `packages/cli/src/mcp.ts`; `packages/cli/src/tools.ts`; `docs/backlog.md` (F53)

## Background

The survey in `docs/tool-formats.md` put six hosts on two routes: some take a tool only through
MCP, some have a registry of their own. Claude Code is on both — a plugin can declare an MCP
server, and a plugin's mods API registers tools natively (`$.tool.register`, with a plain JSON
Schema). The route was therefore a property of the *host*, not of the verb.

The picture half had the same shape of mistake. We wrote that a picture needs a session page.
Claude Code shows it otherwise: a mod draws into a pane, with no page, no browser and no window
anywhere in sight.

Two facts, one rule: a host is entered once per half.

## Decision

### D1. One route per half, per host

The **tool half** has one route into a host, and the **picture half** has one surface. Two routes
for the same half in the same host is how a verb gets two names and two places to keep in step:
the model would meet `texteda_check` twice, and every change to the catalogue would have to land
in both ([ADR-0143](0143-the-agent-surface-is-a-set-of-verbs.md) D1, D4).

The two halves are separate decisions. A host can serve the verbs over MCP and still draw our
picture in a way of its own; that is not two routes into one half.

### D2. The verbs go over MCP wherever the host speaks it

The census, corrected: of the six hosts, **three take a tool only through MCP** (Codex,
WorkBuddy, Qoder); **DSH has a registry of its own**; **pi has one too** and speaks MCP as well,
but it is our own harness, so the native route is ours to own ([ADR-0143](0143-the-agent-surface-is-a-set-of-verbs.md)
D5); and **Claude Code has both** — an MCP server declared in a plugin, and a mods registry.

Claude Code's verbs are served by `texteda mcp`
([ADR-0144](0144-the-mcp-server-is-a-slice-we-write-ourselves.md)). Its mods registry stays unused
for the verbs, for two reasons. The MCP server is one process serving four hosts, where a mods
adapter would be a fourth adapter to keep in step with the catalogue. And the mods registry
answers a call with a text result (`{ result }`), where our contract is the verb's value as data
*and* as text ([ADR-0144](0144-the-mcp-server-is-a-slice-we-write-ourselves.md) D5).

### D3. The picture half needs a drawing surface, not a session page

Our earlier statement — that a picture needs a session page — was wrong, and Claude Code is what
shows it. A mod draws into a **`Pane`** or an **`AbovePrompt`** band, and the elements available
are `Svg` (Desktop, VS Code), `Client` (Terminal, Desktop — a second file of ours, with pointer
input), and `Raster` and `Image` (Terminal). No page is involved: in the terminal, a pane that
returns only an `Svg` opens empty, because the terminal draws the other elements.

So the requirement is a place where the host draws what we return. DSH has one in its `web` and
`desktop` profiles (slots in the session page). Claude Code has one in a mod's render sites. pi
has none: no webview, no panel extension point, a widget's worth of text and a terminal pane.

MCP Apps are not that route: the protocol's client matrix records Claude Code among the clients
that do **not** render them, so a picture for Claude Code is a mod or nothing.

### D4. Where the two halves meet in one host, one plugin may carry both

A Claude Code plugin can be a mod *and* declare our MCP server at the same time: the mod draws,
the server answers the verbs. The plugin does not register the verbs a second time, because the
verbs are already in the model through one route (D1).

## Consequences

- The census in [ADR-0143](0143-the-agent-surface-is-a-set-of-verbs.md) D5 changes, and so does
  the pivot-format count in D8: five of the six hosts take plain JSON Schema unchanged.
- [ADR-0142](../view/0142-the-review-app-is-a-plugin-of-the-agent-workbench.md)'s open point 1
  changes shape. The picture half is no longer gated on a session page, so Claude Code is a
  candidate host and the question "which host first" is a question about effort, not about
  whether the host can draw at all.
- Nothing is built for Claude Code's verbs: the surface is unchanged.
- A mod is JavaScript or TypeScript inside Claude Code's process, and its `Client` element is a
  second file of ours with no mods API — it reaches the hooks by posting data that arrives as a
  `ui.message` event. Whether our client half can be carried that way is the picture half's
  business, and it is the backlog's, not this record's.

## What this record does not change

- The verbs are the command line's, the catalogue stays one catalogue, and a tool's result is the
  verb's value ([ADR-0143](0143-the-agent-surface-is-a-set-of-verbs.md) D1, D2, D7, D8;
  [ADR-0144](0144-the-mcp-server-is-a-slice-we-write-ourselves.md) D4, D5).
- The plugin's one write is still the print page's positions
  ([ADR-0142](../view/0142-the-review-app-is-a-plugin-of-the-agent-workbench.md) D3).
- The MCP server still speaks both eras of the protocol
  ([ADR-0144](0144-the-mcp-server-is-a-slice-we-write-ourselves.md) D3).
