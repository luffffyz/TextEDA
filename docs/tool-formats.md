# Tool formats across agent hosts

What each host expects of a **tool** — a model-callable function with a name, a description and
typed arguments. This is the reference for the tool catalogue
([ADR-0044](adr/process/0044-the-agent-surface-is-a-set-of-verbs.md)); it is a description of other
people's interfaces, not a decision of ours.

Sources were read on 2026-10-29. Where a host publishes nothing on a question, the row says so
rather than guessing.

## The six hosts at a glance

| Host | Native (non-MCP) tool? | How a tool is declared | Parameter dialect | Result the model sees |
|---|---|---|---|---|
| **Claude Code** | **yes** — a plugin's mods register tools natively; a plugin can also put a CLI on `PATH` | `.mcp.json` at the plugin root; a mod's `$.tool.register`; or `bin/` + a skill | MCP JSON Schema (`inputSchema`); a mod's registry takes a plain JSON Schema | MCP `CallToolResult` content blocks; a mod's `tool.call` answers `{ result }` |
| **Codex CLI** | no — plugins carry skills + MCP servers | `[mcp_servers.<name>]` in `~/.codex/config.toml`; plugin marketplaces | MCP JSON Schema | MCP `CallToolResult` |
| **DSH** | **yes** | `ctx.tools.register(defineTool({…}))` | flat spec: `{p: {type, required, description}}` | a canonical value plus `output.render` |
| **pi / omp** | **yes** | a tool module: `(pi) => ({name, description, parameters, execute})` | omptype (`pi.zod` / `pi.arktype` / `pi.typebox`) | `{content: [{type:'text', text}], details}` |
| **WorkBuddy** | no — experts cannot add tools at all | `mcp.json` with `mcpServers`; marketplace connector packages | MCP JSON Schema | MCP `CallToolResult` |
| **Qoder** | only inside its SDK | plugin `.mcp.json`; SDK `tool()` + `createSdkMcpServer()` | MCP JSON Schema; SDK takes a Zod raw shape (TS) or a dict (Python) | MCP `CallToolResult` |

## Per host

### Claude Code

A plugin is a directory of components: skills, commands, subagents, hooks, monitors, output
styles, colour themes, workflows, executables, settings, MCP servers and LSP servers
(<https://code.claude.com/docs/en/plugins/components>). That component list has no "tool"
component — but a plugin can be a **mod**, and a mod registers tools natively.

#### A mod is a plugin with a `modules` key

`hooks/hooks.json` may hold `"modules": ["./register.js"]` — a path relative to that file — and
`hooks/register.js` exports `register(on, options)`. `on` takes an event name, an optional
matcher, and the hook. A mod is code that runs inside Claude Code's own process
(<https://code.claude.com/docs/en/plugins/mods/reference>, <https://code.claude.com/docs/en/plugins/mods/api>).

#### The native tool registry

```javascript
on('session.start', async ($, e, next) => {
  await $.tool.register({
    name: 'ticket',
    description: 'Look up a ticket by its id and return its title and status',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  })
  return next(e)
})

on('tool.call', { tool: 'mcp__my-mod__ticket' }, async ($, e) => {
  return { result: '…' }
})
```

- **`inputSchema` is a plain JSON Schema.** The same shape our catalogue already holds.
- **The model sees a longer name**: `mcp__`, the plugin's name, two underscores, and the
  registered name — `mcp__my-mod__ticket`.
- **The call is handled in a `tool.call` hook** filtered to that full name. The hook answers
  `next(e)`, `{ deny: reason }`, or `{ result }`; a registered tool's result is text, not a
  structured payload.

#### The MCP route, and the CLI floor

Two things in the plugin's component list matter to us as well:

- **`bin/` is how a plugin ships a command line tool.** "While the plugin is enabled, Claude Code
  puts this folder on the `PATH` of the shell it runs commands in, so Claude, or a skill's
  instructions, can run the tool by name without the user installing anything."
- **A skill is model-invoked.** Its frontmatter `description` is what the model matches against,
  and it can also be run by the user as `/<plugin>:<name>`.

So the CLI-and-skill floor works here without any protocol of ours: the plugin ships `bin/texteda`
and a skill that says when to run it. The MCP route exists for hosts that want typed tools, and
the mods registry is a third way in. Which route we take is decided in
[ADR-0046](adr/process/0046-a-host-is-entered-once.md) D2: the verbs go over MCP.

### Codex CLI

Codex uses the same plugin format as ChatGPT: a plugin bundles **skills and MCP servers**, and
plugins come from marketplaces (`.agents/plugins/marketplace.json`, with
`.claude-plugin/marketplace.json` read for compatibility). Plugins work in the CLI and in the
ChatGPT desktop app; the IDE extension has MCP but no plugins.

Tool policy is per tool: `default_tools_approval_mode` (`auto` / `prompt` / `writes` / `approve`)
and a per-tool `approval_mode`, plus `enabled_tools` / `disabled_tools`. Bare MCP servers live in
`~/.codex/config.toml` under `[mcp_servers.<name>]`, with `startup_timeout_sec` and
`tool_timeout_sec`.

(Source: <https://chatgptplugins.directory/tutorials/use-plugins-in-codex>, published 2026-10-04 —
an independent site; the official plugin page refused the fetch.)

### DSH

```ts
ctx.tools.register(defineTool({
  name, description,
  parameters: { project: { type: "string", required: true, description: "…" } },
  output: { schema, render },
  execute(args, exec) { … },
}))
```

The parameter spec is **flat and bespoke** — `{type, required, description}` per parameter, not
JSON Schema. The result is a canonical value; `output.render` turns it into what the model reads.
Registration is effect-based, and cards (`presentCall` / `presentResult`) are optional.

### pi / omp

A tool is a module whose default export is a factory `(pi) => ({name, label, description,
parameters, execute})`. Parameters are declared with `pi.zod` (Zod-compatible), `pi.arktype` or
`pi.typebox`; all three are backed by **omptype**, which normalises to **draft-2020-12 JSON
Schema** at the provider boundary (`toolWireSchema()`), and which can import a JSON Schema
(`fromJsonSchema`). Arguments are validated before `execute` runs. The result is
`{content: [{type: "text", text}], details}` — content blocks plus structured state. Tool
definitions may carry `approval`, and `mcpServerName` / `mcpToolName` show that MCP is supported
here too.

omp's marketplace is compatible with the Claude Code plugin registry, and its tool discovery
already reads `~/.claude/tools` and `~/.codex/tools` — in *omp's own* module format.

### WorkBuddy

WorkBuddy is Tencent's office agent (desktop and web). Tools enter only through MCP: a `mcp.json`
with a top-level `mcpServers` map, at user scope `~/.workbuddy/mcp.json` or project scope
`<project>/.workbuddy/mcp.json`. Server keys: `type` (`stdio` / `sse` / `streamableHttp`), `url`,
`command`, `args`, `headers` / `env` (placeholders only — `${VAR_NAME}`), `timeout` (default
30 000 ms), `cwd`, `disabledTools`.

A marketplace connector is `connector-meta.json` + `mcp.json` + `icon.svg`, optionally with
`skills/<name>/SKILL.md`. The documentation names exactly two connector forms: **"MCP + CLI"** and
**"Skill + CLI（内置脚本）"** — the second one is our floor, and it asks for a clear exit code and
readable errors, with the business result as JSON, which is what `--json` already gives.

Experts cannot add tools: "开发者不可自行添加 tools：所有工具权限由系统统一分配". Permissions are
allow / ask / deny per tool, per MCP service and per individual tool.

### Qoder

Qoder is a family: IDE (a VS Code fork), CLI, JetBrains plugin, an agent SDK and Cloud Agents.

A plugin (`.qoder-plugin/plugin.json`, falling back to `.claude-plugin/plugin.json`) carries
commands, agents, skills, output styles, workflows, hooks, **`mcpServers`** and settings — **no
`tools` component**. MCP is therefore the route for tools: `.mcp.json` in the plugin, or
`mcpServers` in `~/.qoder/settings.json` for the IDE, or `qoder mcp add <name> -- <cmd>` for the
CLI.

The SDK is the exception: `tool(name, description, inputSchema, handler, extras)` registers an
in-process tool, and `createSdkMcpServer()` turns a set of them into an MCP server — so even the
SDK's tools surface as MCP `CallToolResult`. Cloud Agents have their own form,
`{"type": "custom", name, description, input_schema}` (a JSON Schema object).

At runtime the names are rewritten to `mcp__<server>__<tool>`, and permissions are allow / ask /
deny per tool.

## What this means for the catalogue

**The pivot format is JSON Schema.** Four of the six hosts take an MCP `inputSchema` unchanged, and
Claude Code's own registry takes a plain JSON Schema unchanged as well; DSH's flat spec is a
flattening of the same object; omp normalises to draft-2020-12 anyway and can import a JSON Schema
directly; and Claude Code's own `workflows/*.js` use plain JSON Schema for structured calls. So
the catalogue is authored as **name + description + JSON Schema**, and each adapter is a projection
of it.

**Three adapters cover the six hosts.**

1. **The CLI and the skill** — the floor, and it works in all six: Claude Code puts a plugin's
   `bin/` on `PATH`, WorkBuddy documents "Skill + CLI" as a connector form, and Codex and Qoder
   run commands.
2. **Two native registry adapters** — DSH (`defineTool`) and pi / omp (`pi.registerTool`). Thin:
   the catalogue's JSON Schema becomes the host's parameter spec.
3. **One MCP server** — for the four hosts that speak MCP (Claude Code, Codex, WorkBuddy,
   Qoder). Because MCP is JSON-Schema-native, this is the cheapest adapter of the three, and it
   also carries `outputSchema` / `structuredContent`. Claude Code has a registry of its own as
   well, but it is served over MCP ([ADR-0046](adr/process/0046-a-host-is-entered-once.md) D2).

**What no host needs from us:** a protocol of our own, or a second implementation of the verbs.
The verbs stay the command line's; the catalogue is a projection of them.

## Pointing a host at the server

One server, four configurations. The command is the repository's own; a host that installs the
package would name the binary instead.

```sh
bun run packages/cli/scripts/texteda.ts mcp
```

| Host | Where the server is declared | What it looks like |
|---|---|---|
| Claude Code | `.mcp.json` in the plugin, or `mcpServers` in the settings | `{"mcpServers": {"texteda": {"command": "bun", "args": ["run", "<repo>/packages/cli/scripts/texteda.ts", "mcp"]}}}` |
| Codex CLI | `[mcp_servers.texteda]` in `~/.codex/config.toml` | `command = "bun"` and `args = ["run", "<repo>/packages/cli/scripts/texteda.ts", "mcp"]` |
| WorkBuddy | `mcp.json` with a top-level `mcpServers` map, at `~/.workbuddy/mcp.json` or `<project>/.workbuddy/mcp.json` | the same map, plus `"type": "stdio"` |
| Qoder | `.mcp.json` in the plugin, `mcpServers` in `~/.qoder/settings.json`, or `qoder mcp add texteda -- bun run <repo>/packages/cli/scripts/texteda.ts mcp` | the same map |

The tool names a host sees are the catalogue's own (`texteda_check`, `texteda_view_metrics`, …),
rewritten by the host where it rewrites them — Qoder, for one, prefixes them with
`mcp__<server>__`.

## Gaps we did not close

- Neither WorkBuddy nor Qoder states a JSON Schema draft, `strict` or `additionalProperties`
  anywhere; both inherit plain "JSON Schema" from the MCP specification.
- Whether WorkBuddy can run tool calls concurrently within a turn is not documented.
- Claude Code's per-tool permission syntax (`permissions.allow` entries naming
  `mcp__<server>__<tool>`) was not re-verified here.
