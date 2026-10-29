# ADR-0143: The Agent's Surface Is a Set of Verbs; Every Host Adapts the Same Ones

Status: Proposed
Date: 2026-10-29
Scope: Decides: that the agent reaches TextEDA through the command line's verbs and the skill that documents them; that a host's tool registry is an optional adapter over those same functions rather than a second interface; that the skill stays the floor and is never replaced by a tool; that the print page's verbs live under one noun, `texteda view`; and that the catalogue's parameters are JSON Schema, which is the only format every host can be projected onto. Does not decide: which hosts get an adapter, what the catalogue contains, and whether the command line's surface gets a version line of its own — see "Open points".
Related: [ADR-0142](../view/0142-the-review-app-is-a-plugin-of-the-agent-workbench.md)
Impact: `packages/cli/**`; `docs/skills/**`; `docs/plugin-hosts.md`; `docs/tool-formats.md`; `docs/backlog.md` (F55, F57, F58)

## Background

The agent is the entry point for the work ([ADR-0142](../view/0142-the-review-app-is-a-plugin-of-the-agent-workbench.md)).
What the agent needs from this repository is a set of verbs it can call. Today those verbs are the
command line's, and two skills document how to use them: `docs/skills/draw-print-page.md` and
`docs/skills/new-project.md`. That surface works today, in every harness that gives the agent a
shell.

Hosts offer a second surface as well: a **tool registry** — a list of model-callable functions,
each with a name, a description and typed arguments, that the model sees in its context and
invokes by name. DSH calls it `ctx.tools.register(defineTool(...))`; pi calls it
`pi.registerTool(...)`. The question this record answers is whether TextEDA publishes its verbs
there, and if so, as what.

The codebase already points at the answer. The command line's payloads are machine contracts
(`--json`; [ADR-0102](../language/0102-diagnostic-error-codes.md): code / severity / location /
data), and the skills already say which command to run. A tool registry can therefore be an
adapter over the same functions — or it can be skipped, and the agent keeps using the shell.

## Decision

### D1. The verbs are the command line's

Every action the agent takes on a project is a command line verb. The verbs are the interface; the
skill is their manual. A verb that existed only as a tool would be a second interface with its own
name, its own arguments and its own failure modes, and it would drift from the command a person
can also type.

### D2. A host's tool registry is an adapter, not a second implementation

Where a host has a tool registry, the verb is registered there — same meaning, same result — and
the tool and the command call **the same function**. The adapter translates arguments and renders
the result; it does not re-implement the verb.

That is why the verbs have to return values instead of printing them. Today `runBom`,
`runCompile`, `runViewMetrics` and `runIr` print their result and return an exit code, so there
is nothing for an adapter to hand back. The split is `build*(options) → value`, with the printer
left in the script. `check` already has that shape (`checkProject`, `analyzeProject`).

The test that keeps the two faces honest: a tool's result equals the same verb's `--json` output,
field for field.

### D3. The skill is the floor; a tool registry is an accelerator

The skills are how the agent works today, in any harness that gives it a shell, and they stay
that way. A tool registry saves the model a step (reading the manual) and gives it typed
arguments. It never replaces the manual, because the manual carries what a schema cannot: when a
verb is the right move, what its output means, and what to do with a diagnostic.

### D4. What an adapter buys, and what it costs

| | Through the shell | Through a registered tool |
|---|---|---|
| arguments | the model writes a command line; a typo is a usage error | the host validates the arguments before the verb runs |
| result | text the model reads (or JSON it parses) | a canonical JSON value the host validates, persists and can render as a card |
| policy | every command looks the same to the policy engine | the host can allow one verb and ask before another |
| discovery | the model must read the skill first | the schemas are in the model's context |
| context cost | the manual is read on demand | the tool list is always there |
| maintenance | nothing extra | an adapter per host, which can drift from the catalogue |

The middle three are the reason to build the adapter where a host offers one: a malformed call
never reaches the core, the result arrives as data rather than as prose, and a verb that writes
files can be separated from a verb that only reads. The last two rows are the cost.

### D5. MCP is a transport, not a second implementation

MCP is how a host accepts a tool from outside its own registry. Of the six hosts surveyed in
`docs/tool-formats.md` — Claude Code, Codex, WorkBuddy, Qoder, DSH and pi — **four take tools
only through MCP** (Claude Code, Codex, WorkBuddy, Qoder), and two have a registry of their own
(DSH, pi). MCP is therefore not a legacy compatibility layer for traditional applications; it is
the ordinary route for most of the ecosystem.

What that changes is the wording, not the shape: MCP is an **adapter over the same verbs**, never
a second implementation of them. The functions behind an MCP tool are the same functions the
command line calls, so the tool and the command cannot drift. What we do not do is maintain an
MCP server for our own harness, or let MCP become a place where behaviour is defined twice.

### D6. The print page's verbs live under one noun

The verbs that act on the print page (S1) are `texteda view metrics`, `texteda view rewire` and
`texteda view render`. They are grouped because the print page is the description type the
language already names `view` (`views/<board>/<page>.view.teda`, `spec/schematic-view.md`), and
because a verb should read the same as the tool that mirrors it: `texteda view metrics` and
`texteda_view_metrics` are one name in two spellings the model already knows.

`review` (the app), `check` (the project), `ir` and `compile` stay at the top level: none of them
is scoped to one page. The precedent for a two-level command is `texteda export gerbers`.

Naming discipline, so the words keep meaning one thing each: `view` is the print page, `sch` is
the schematic, `pcb` is the board. The app's scopes (`sch`, `pcb`) name the same two things.

### D7. The catalogue is machine-readable

`texteda tools --json` prints the verbs that can be exposed as tools — name, description,
parameters — so that a host we have never seen can adapt them without our code, and so that the
catalogue cannot drift from the implementation.

### D8. The catalogue's parameters are JSON Schema

Every host can be projected onto JSON Schema, and most already speak it: four take an MCP
`inputSchema` unchanged, DSH's flat `{type, required, description}` spec is a flattening of the
same object, and pi normalises to draft-2020-12 at the provider boundary anyway (and can import a
JSON Schema directly). So the catalogue is authored as **name + description + JSON Schema**, and
each adapter is a projection of that — not a second schema to maintain per host.

The six hosts and what each of them accepts are recorded in `docs/tool-formats.md`.

## Open points

1. **What the catalogue contains.** The verbs an agent actually calls in a loop, against every
   verb the command line has.
2. **Which adapters get built first, and where they live.** The survey narrows the field to three:
   the command line and the skill (the floor, which works everywhere), two native registry
   adapters (DSH's `defineTool`, pi's `registerTool`), and one MCP server for the four hosts that
   take tools only through MCP. A pi extension loads TypeScript directly and needs no build; a DSH
   bundle is an npm package with a host half and a client half, and it has to bundle this
   repository's code, because these packages are not published.
3. **Whether the command line's surface gets a version line of its own.** The language has one
   version number ([ADR-0101](../language/0101-one-language-version-number.md)); the command
   line's verbs are not covered by it.

## Consequences

- The command line's verbs become library functions first and interfaces second. That is a small
  refactor with a payoff beyond the tools: the same values become testable without a subprocess.
- The skills stay the portable surface, and they stay the place where the meaning of a verb
  lives. A tool's description is a pointer to the same sentence, not a second explanation.
- The rename in D6 is a breaking change to the command line's surface. It is cheap now — the
  print page's verbs are few, and their references are few — and expensive after a catalogue
  exists, because then both faces carry the old name.
- Hosts we do not write an adapter for are not left behind: the skill and the command line are
  enough, and D7 lets a host build its own adapter from the catalogue.
