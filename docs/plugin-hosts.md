# Plugin hosts — what a plugin looks like from the inside

> Reference notes, not a decision. The decision these notes feed is
> [ADR-0142](adr/view/0142-the-review-app-is-a-plugin-of-the-agent-workbench.md).
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

Two hosts are worth knowing:

- **DSH (DeepSeek Harness)** — a harness with a real plugin market: bundles are npm packages, and
  a bundle carries both a host half and a browser half.
- **pi (oh-my-pi / OMP)** — the harness this repository is developed in. Its extension surface is
  code, not pixels: tools, commands, hooks, and a small text widget.

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
a session page**, and any host that has one can carry our drawing — whatever the vendor.

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
- The plugin would ship no new geometry code. The renderer, the model and the checks stay in the
  core, and the plugin is a delivery form for them.

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

## The common shape

| Need | DSH | pi |
|---|---|---|
| The agent calls our verbs | a tool registered by the host half | `pi.registerTool` |
| The person triggers a command | a slot's control | `pi.registerCommand` |
| The person sees the board | a client half rendering our SVG — where the session has a page | no native surface; a widget's worth of text, or a terminal pane |
| The person hands a selection to the agent | the client half plus the session service | `pi.sendUserMessage` |
| The plugin reads and writes project files | the host half, via `shell` or the file system | the agent's own tools |

The split that follows: the **agent-facing half** is portable and belongs in every host; the
**picture half** is an add-on that only exists where a session page does. A plugin package can
carry both, and a host that has no page simply uses the first.

Both hosts already have a native way to expose our verbs to the agent. That is the reason there is
no MCP layer in the plan: MCP would be a second protocol for the same verbs, needed only by
traditional applications and cloud services that cannot host a plugin at all.

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
