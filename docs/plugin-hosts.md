# Plugin hosts — what a plugin looks like from the inside

> Reference notes, not a decision. The decision these notes feed is
> [ADR-0043](adr/09-view/0043-the-review-app-is-a-plugin-of-the-agent-workbench.md).
>
> The facts below were read from the hosts' own documentation and from a third-party plugin's
> contract notes on 2026-10-29. Host APIs move fast: treat the version numbers as the anchor and
> re-read before writing code against them. Anything that is *our* plan rather than a host fact is
> marked as such.

## Why this document exists

The agent is becoming the entry point for the work, so the tool a person uses has to live inside
the agent's workbench rather than beside it. That means the tool has to be a **plugin** — but
"plugin" means something different in every host, and the difference decides what we would have to
build.

Three hosts are worth knowing:

- **DSH (DeepSeek Harness)** — a harness with a real plugin market: bundles are npm packages, and
  a bundle carries both a host half and a browser half.
- **pi (oh-my-pi / OMP)** — the harness this repository is developed in. Its extension surface is
  code, not pixels: tools, commands, hooks, and a small text widget.
- **Claude Code** — a plugin can be a **mod**: code that runs inside Claude Code's own process and
  draws into the interface. It has a drawing surface without a page, which is what makes it
  different from the two above.

## The axis is the profile, not the vendor

The first thing to get right is not *which vendor*, but *which session*. A plugin is two halves —
a host half that runs inside the agent's process, and a client half that renders in the session's
page — and only the second one needs a page:

| Session | Host half | Client half |
|---|---|---|
| a browser or desktop session | yes | yes — the drawing can be shown |
| a terminal session | yes | no — there is no page to load it into |

DSH is one launcher with several profiles: `web`, `desktop`, `headless`, `sdk`, `sdk-minimal`,
`acp`, and a `tui` profile that some installs carry. A DSH plugin therefore has a client half in
the web and desktop profiles and **none** in `headless`, `sdk` or `acp` — the same bundle, in the
same product, with no picture. (Our reading: an editor driving DSH over `acp` brings its own
window, so there the surface would have to live in the editor, not in DSH.) pi's modes are `tui`,
`rpc`, `json` and `print` — all terminal, no page anywhere.

So the statement "DSH is a GUI host and pi is a CLI host" is wrong in both directions: DSH has a
CLI, and its terminal profiles behave exactly like pi. The correct statement is: **a picture needs
a drawing surface**, and any host that has one can carry our drawing — whatever the vendor.

A drawing surface is a place the host draws what we return. It is usually a page, but it does not
have to be: Claude Code's mods draw into a pane or a band above the prompt, with no page anywhere
([ADR-0046](adr/10-process/0046-a-host-is-entered-once.md) D3). So the question a host has to answer
is not "does it have a page" but "can a plugin draw here".

## DSH (DeepSeek Harness)

### A plugin is a bundle with two halves

One npm package, two runtimes:

| Half | Where it runs | What it is |
|---|---|---|
| host half | inside the DSH process | Node ESM, a cordis plugin |
| client half | the browser session page | a single-file bundle loaded by the host's client loader |

Both halves ship in the same package and are versioned together. The client half is loaded through
`__ModuleLoader__.load({ id, factory })` as a single-file factory with no top-level imports;
`react` is injected by the loader and is the only external the loader allows.

### The host half

- It declares the host services it needs through `inject` (for example `shell`, `sessions`,
  `agents`) and reaches the rest with `ctx.get(...)`. A service that is not declared is not
  reachable — the guard swallows the access rather than throwing.
- It can register HTTP routes on the host's own `connection` service:
  `fetch.register({ path, methods, requestBody, fetch })`, with exact path matching and
  `GET | HEAD | POST`. The web profile mounts these under `/api`; the desktop profile dispatches
  them from the same URLs.
- It can execute commands through the `shell` service, with a sandbox policy and a workspace root.
- It can contribute a settings entry; only fields marked volatile are writable at runtime.

### The client half

- It extends the UI through **slots** — the host's typed extension points. The 0.2.2 contract
  enumerates 54 of them. Two that matter for a drawing:
  - `conversation.chat.node` — keyed, session-scoped: a place to attach controls to chat messages.
  - `plugins.bundle.config` — keyed, root-scoped: a card in the plugin manager's settings page.
- Slots are React-shaped: the client half renders React components, not a page.

### Installing

`dsh plugin --profile web add <package>` (or `--profile desktop`), from npm or from
`github:<org>/<repo>`. Restart the host afterwards. Compatibility is declared in the package
(`engines.dsh`, or `peerDependencies` ranges per minor line) and the host refuses a plugin whose
declared range it does not satisfy. The host half needs Node ≥ 22.19.

### What it means for TextEDA — our plan

- The **host half** is what `packages/cli/src/review.ts` already is: a process that answers
  questions about a project (`/api/model`, `/api/layout`, `/api/source`) and writes through the
  core. It would move into the host as a cordis plugin and register the same routes. It works in
  every profile, terminal ones included.
- The **client half** is what `packages/viewer/src/client.ts` already is: a client that draws the
  reference renderer's SVG, highlights by identity, and reports what the person clicked. It would
  become a React component mounted in a slot — and it only mounts where the session has a page
  (`web`, `desktop`). (Our plan, not a DSH fact: the client half is vanilla TypeScript today;
  wrapping it in React is a small adapter.)
- The **picture** is not the same thing as the **page**. What the client half needs is a drawing
  surface; DSH's `web` and `desktop` profiles have one because they have a page, and Claude
  Code's mods have one without one ([ADR-0046](adr/10-process/0046-a-host-is-entered-once.md) D3).
- The plugin would ship no new geometry code. The renderer, the model and the checks stay in the
  core, and the plugin is a delivery form for them.

### What we built for DSH

`plugins/dsh-texteda/` is the host half: a cordis plugin that registers the catalogue's eight
verbs as tools, with the catalogue's JSON Schema projected onto DSH's flat parameter spec. Each
tool returns one canonical JSON value, and `output.render` is what the model reads
([ADR-0044](adr/10-process/0044-the-agent-surface-is-a-set-of-verbs.md) D2).

```sh
bun run scripts/build-dsh-plugin.ts     # one file, with our packages inside it
```

The bundle carries our packages because they are not published (F5); the host's own packages
stay external, because the host provides them. The client half — the drawing surface — is the
review app's business ([ADR-0043](adr/09-view/0043-the-review-app-is-a-plugin-of-the-agent-workbench.md)).

## pi (oh-my-pi / OMP)

### An extension is a module with a default-export factory

```ts
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  /* register here */
}
```

Registration happens in the factory; runtime actions (sending messages, aborting) only after the
runtime is initialized.

### What an extension can register

| Surface | Purpose |
|---|---|
| `pi.registerTool(...)` | an LLM-callable tool — the agent calls it like any other tool |
| `pi.registerCommand(...)` | a slash command the person runs |
| `pi.registerShortcut` / `registerFlag` | keys and flags |
| `pi.registerMessageRenderer(...)` | custom rendering of a message kind in the transcript |
| `pi.on(...)` | event hooks: `session_start`, `tool_call`, `tool_result`, `input`, `assistant_message`, `before_agent_start`, `turn_end`, … |
| `pi.sendMessage` / `sendUserMessage` / `appendEntry` | inject content into the session |
| `pi.registerProvider(...)` | a model provider |

### What the UI context can do

`ctx.ui` offers notifications, `select` / `confirm` / `input` / `editor` dialogs, a **widget**
above or below the editor (a handful of content lines), an editor-component wrapper, theme
loading, and `openTerminal(...)` — which opens a pane in a terminal multiplexer (tmux, Zellij,
Herdr, Orca, CMUX), *not* an OS window.

`ctx.mode` is `"tui" | "rpc" | "json" | "print"`.

### What it means for TextEDA — our plan

- There is **no webview and no panel extension point**, and no session page in any mode. A picture
  cannot be shown natively; the closest native surfaces are the text widget and a terminal pane.
- The agent surface is excellent and needs no protocol of our own: `pi.registerTool` exposes the
  CLI's verbs to the agent directly, and `pi.registerCommand` gives the person a `/texteda`
  entry point. `pi.sendUserMessage` can hand a selection to the agent as a message.
- So in pi the natural plugin is a *tool and command* package, not a drawing surface. The drawing
  would have to live elsewhere: the browser, or a terminal renderer that does not exist yet.
- pi is not special here: it is what a terminal session looks like. A DSH plugin in `headless`,
  `sdk` or `acp` is in the same position.

### What we built for pi

`plugins/pi-texteda/` is the adapter: an extension whose factory registers the catalogue's eight
verbs as pi tools, with the catalogue's JSON Schema projected onto the host's `pi.zod` builder.
The projection is the whole of it — the tools call the same verbs the command line calls, and a
tool's answer is the value the command line prints with `--json`
([ADR-0044](adr/10-process/0044-the-agent-surface-is-a-set-of-verbs.md) D2).

```sh
omp --extension plugins/pi-texteda        # or: symlink it into ~/.omp/agent/tools/
```

pi loads TypeScript directly, so there is no build step and no new dependency.

## Claude Code

### A plugin can be a mod

A mod is a plugin whose `hooks/hooks.json` carries a `modules` key — a path to a JavaScript or
TypeScript file that exports `register(on, options)`. The mod runs inside Claude Code's own
process; a hook is an event handler, and `on` takes an event name, an optional matcher, and the
handler (<https://code.claude.com/docs/en/plugins/mods/reference>).

A mod can do what the other two hosts do — register tools for the agent
(<https://code.claude.com/docs/en/plugins/mods/api>) — and it can draw.

### Where a mod draws

Drawing happens in **render sites**: `Pane` (a panel of the conversation) and `AbovePrompt` (a band
above the prompt). The site is drawn by a `ui.render` hook that returns a tree of elements:

| Element | What it is | Terminal | Desktop | VS Code |
|---|---|:-:|:-:|:-:|
| `Box`, `Text`, `Button`, `Link`, `Code`, `Markdown`, `Input`, `Select` | the ordinary widgets | ✓ | ✓ | ✓ |
| `Svg` | SVG markup, up to 131,072 characters | | ✓ | ✓ |
| `Client` | a region drawn by a second file of yours, for animation and pointer input | ✓ | ✓ | |
| `Raster`, `Image` | a grid of coloured cells; a picture | ✓ | | |

(`<https://code.claude.com/docs/en/plugins/mods/interface>`.)

Three facts that decide what we could build here:

- **`Client` is the interesting one.** It is a region drawn by *our* file, with pointer input — the
  shape of an interactive canvas. It works in the terminal and on the desktop. That file gets no
  mods API: it reaches our hooks by posting data, which arrives as a `ui.message` event.
- **The terminal cannot draw an `Svg`.** "In the terminal, a pane that returns only an `Svg` opens
  empty" (<https://code.claude.com/docs/en/plugins/mods/gallery>). A picture in the terminal is
  therefore a `Client` region or an `Image`, not markup.
- **An `Image` needs a terminal that draws pictures** — kitty 0.28 or later, Ghostty, or iTerm2
  3.5 or later. In any other terminal the person sees the image's `alt` text instead.

### Where mods run, and where they draw

Hooks run in every kind of session that loads the plugin. Drawing is narrower.

| Where you run Claude Code | Hooks run | What the mod draws appears |
|---|---|---|
| `claude` in a terminal | yes | yes |
| The Code tab of the Desktop app | yes | yes, except the terminal-only elements |
| A WSL session in the Desktop app | no | no |
| The VS Code extension's chat panel | yes | yes, with extension version 2.1.299 or later |
| `claude -p` and the Agent SDK | yes | **no** |
| A cloud session | yes, for a plugin that reaches it | **no** |

(<https://code.claude.com/docs/en/plugins/mods/overview>.)

### MCP Apps are not a route here

The extension's own *Client support* paragraph names the clients that render MCP Apps — Claude
(web), Claude Desktop, VS Code GitHub Copilot, Microsoft 365 Copilot, Goose, Postman, MCPJam,
Archestra.AI — and Claude Code is not among them
(<https://modelcontextprotocol.io/extensions/apps/overview>). The community matrix at
<https://modelcontextprotocol.io/extensions/client-matrix> has a column for it, but its cells render
**empty for every client** (only the Skills column carries marks), so the matrix is not the
authority for this — an empty cell is not a "no". So a picture for Claude Code is a mod, or
nothing. Two GitHub reports about MCP rendering in the CLI (#88881, #48132) are closed as stale and
are not policy.

### What it means for TextEDA — our plan

- The verbs do **not** come from a mod. Claude Code speaks MCP, and one server serves it
  ([ADR-0046](adr/10-process/0046-a-host-is-entered-once.md) D2). A mod that also registered them
  would give the model the same verb twice.
- The picture is the other half. A mod can draw our SVG — as a `Client` region, which takes
  pointer input, so hovering and clicking have somewhere to live.
- A Claude Code plugin can be a mod *and* declare our MCP server at the same time. The mod draws;
  the server answers the verbs. That is one plugin, one route per half.
- Our client half is `packages/viewer/src/client.ts`, a browser client. Carrying it as a `Client`
  region means giving it the shape a mod's client file has — a file that draws and posts messages
  — and that is the picture half's work, not this document's.

## The picture's three routes, and which host takes which

A picture reaches a host by one of three routes ([ADR-0047](adr/10-process/0047-the-picture-reaches-a-host-by-three-routes.md)):

1. **A browser** — our own `texteda review` over HTTP, or its static export. Nothing host-specific,
   works in every host.
2. **MCP Apps** (`io.modelcontextprotocol/ui`) — a tool's `_meta.ui.resourceUri` and a `ui://`
   resource on our own MCP server; the host renders the HTML in a sandboxed iframe and the app
   talks to it in a `ui/`-prefixed JSON-RPC dialect over `postMessage`.
3. **A host-native plugin** — DSH's slots, a Claude Code mod.

All three sit behind the same `ReviewApi.post(path, body)` seam, so a route is an adapter and never
a fork of the drawing. A host-native half is worth writing only where the host has a drawing
surface **and** no other route reaches it:

| Host | Drawing surface | Renders MCP Apps | Picture route |
|---|---|---|---|
| DSH | yes — slots in the `web` and `desktop` profiles | no — `ui://`, `resourceUri` and `modelcontextprotocol/ui` occur zero times in its source | host-native plugin (`plugins/dsh-texteda/`) |
| Claude Code | yes — a mod's `Pane` / `AbovePrompt` / `Client` / `Svg` | no — absent from the client-support list | host-native plugin, when the picture half reaches it |
| Codex CLI | none found | no | browser |
| WorkBuddy | none found | no | browser |
| Qoder | none found | no | browser |
| pi / omp | none — no webview, no panel extension point | no | browser |

Two host-native halves, not six. **The DSH one has landed** (`plugins/dsh-texteda/`,
[ADR-0043](adr/09-view/0043-the-review-app-is-a-plugin-of-the-agent-workbench.md) D9): the host half
registers the verbs and the two routes, the client half puts the review app in a
`sidebar.right.pane.tab` whose project root is the session's `cwd`. Claude Code's half is not
written.

The MCP Apps increment is filed as backlog F59: no host we support is on the client-support list,
so nothing on this box could exercise it.

## The common shape

| Need | DSH | pi | Claude Code |
|---|---|---|---|
| The agent calls our verbs | a tool registered by the host half | `pi.registerTool` | our MCP server, declared in the plugin |
| The person triggers a command | a slot's control | `pi.registerCommand` | a mod's `$.command.register` |
| The person sees the board | a client half rendering our SVG — where the session has a page | no native surface; a widget's worth of text, or a terminal pane | a mod's `Client` region (Terminal, Desktop) or `Svg` (Desktop, VS Code) |
| The person hands a selection to the agent | the client half plus the session service | `pi.sendUserMessage` | a `Client` region posting data, arriving as `ui.message` |
| The plugin reads and writes project files | the host half, via `shell` or the file system | the agent's own tools | the agent's own tools |

The split that follows: the **agent-facing half** is portable and belongs in every host; the
**picture half** is an add-on that only exists where a drawing surface does. A plugin package can
carry both, and a host with no drawing surface simply uses the first.

What the agent-facing half *is* — the verbs, the skill, and what a host's tool registry may add
on top — is decided in
[ADR-0044](adr/10-process/0044-the-agent-surface-is-a-set-of-verbs.md).

All three hosts have a native way to expose our verbs to the agent. That is not the whole picture:
the survey in [docs/tool-formats.md](tool-formats.md) found that four of the six hosts — Claude
Code, Codex, WorkBuddy and Qoder — speak MCP. So MCP is not a second protocol for traditional
applications; it is the ordinary route into the ecosystem, and the native registries are the
accelerators on top of it ([ADR-0044](adr/10-process/0044-the-agent-surface-is-a-set-of-verbs.md) D5).

The server is `texteda mcp` ([ADR-0045](adr/10-process/0045-the-mcp-server-is-a-slice-we-write-ourselves.md)):
one stdio process that answers `initialize`, `tools/list` and `tools/call`, and hands back the
values the command line prints with `--json`. A host that speaks MCP points at it like this:

```json
{
  "mcpServers": {
    "texteda": {
      "command": "bun",
      "args": ["run", "packages/cli/scripts/texteda.ts", "mcp"]
    }
  }
}
```

The path is the repository's own; a host that installs the package would name the binary instead.

## What a plugin would reuse from this repository

| Plugin part | Today |
|---|---|
| drawing | `packages/renderer` (reference renderer → SVG) |
| model, findings, write paths | `packages/cli/src/review.ts` (HTTP routes over `ReviewModel`) |
| checks, re-anchor, canonical writes | `packages/core` |
| client | `packages/viewer/src/client.ts` |
| agent instructions | `docs/skills/**` |

Nothing in that list is host-specific, which is the point: the core does not know what a plugin
is, and the plugin does not know what a board is.
