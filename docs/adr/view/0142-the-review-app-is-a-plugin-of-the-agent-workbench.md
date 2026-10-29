# ADR-0142: The Review App Is a Plugin of the Agent Workbench, and the Agent Owns the Source

Status: Proposed
Date: 2026-10-29
Scope: Decides: that the review app becomes a preview surface inside an agent workbench rather than an editing product; that the agent is the single writer of the design sources; that the plugin writes nothing; that the agent's surface is the skills and the CLI, with no MCP layer; and that the standalone app survives as the bridge for hosts that cannot host a plugin. Does not decide: which workbench is targeted first, whether the plugin may ever write positions, or what the standalone app keeps — see "Open points".
Impact: `packages/viewer/**`; `packages/cli/src/review.ts`; `packages/cli/src/layout.ts`; `docs/guides/review-app.md`; `docs/backlog.md` (F34); `docs/plugin-hosts.md`

## Background

The agent became the entry point for the work. A design tool that sits beside the agent is a tool
people stop opening: the agent holds the whole project, and the person now talks to it.

Three things a person used to want from a design tool, and where each of them actually lives:

| Surface | What changes | Where it lives |
|---|---|---|
| instances and nets | the logical truth | `design/sch/<board>.teda` |
| where the parts sit, where the wires run | the drawing | `views/<board>/<page>.view.teda` (the page), `design/pcb/<board>.teda` (the board) |
| electrical rules | the checks | `texteda check` |

All three are files or commands the agent owns. The schematic IR carries no geometry at all — an
instance is `uid`, `id`, `component`, `params`, `dnp`, `logical_only`, `note`
(`schemas/ir/v0.14/schematic.schema.json`) — so "drag a part in the schematic" can only ever mean
the print page or the PCB. The print page is a drawing and not a build input: its shard is
advisory ([ADR-0134](0134-the-view-layer-is-a-drawing.md) D5), while the schematic and PCB shards
are normative (`packages/cli/src/ir-tree.ts`).

So the app was never the place where those three surfaces change. It is the place where they are
**seen**. What is left for it, once it lives inside somebody else's window, is the picture and the
pointing.

The correction that shapes this record: in a plugin, the dialogue box and the source editing are
the agent's own functions. The plugin needs to preview. The shape of the candidate hosts' plugin
APIs — what a bundle is, what an extension may register, where each of them can show a picture —
is in [docs/plugin-hosts.md](../../plugin-hosts.md).

This record is a draft: it is written to be argued with, and the parts that are still open are
named as such rather than smuggled in as decisions.

## Decision

### D1. The workbench is the entry point; the app is a surface inside it

A person opens the agent's workbench and asks. The app appears where the drawing helps, inside
that workbench's window, and it goes away when the workbench does. It is not a product with its
own lifecycle, its own file formats, or its own idea of what a project is: it is a surface over
the core, hosted by somebody else's shell.

The contract with a person is therefore three verbs — look, select, ask — and nothing else.

### D2. The plugin is two halves over one core

The core does not change. The parser, the IR, the checks, the renderer and the canonical write
path stay where they are, and `packages/{ir,parser,exporter,renderer,core}` keep their rules: no
runtime dependency, no `Bun.*`, no `process.env`, loadable in a browser and in Node.

The plugin is a delivery form with two halves:

- a **host half** that answers questions about a project — the model, the findings, the drawing —
  and, when a write is allowed at all, writes through the core;
- a **client half** that renders the reference renderer's SVG and reports what the person
  selected.

Neither half parses anything. The client draws what the renderer produced and asks the host for
everything else. This is [ADR-0134](0134-the-view-layer-is-a-drawing.md) D7's "the shell stays
replaceable", taken one step further: the shell is now somebody else's shell, and the plugin
adapts to it.

Our code already is these two halves: the host half is `packages/cli/src/review.ts`, the client
half is `packages/viewer/src/client.ts`. Neither knows what a plugin is, and neither has to.

### D3. The plugin writes nothing

The three change surfaces are the agent's. The plugin previews them and reports what the person
pointed at; it does not edit instances, does not move parts, and does not write files.

The reason is an authority problem, not a capability problem. A writer that is not the agent needs
its own canonical form, its own conflict rules and its own notion of when a file is consistent —
and then a project has two truths and a class of bugs that only appear when both have written.
The repository already holds the rule that keeps this honest: the agent owns the source, the human
owns the positions, and no mode of the print-page workflow writes `design/**`
(`docs/skills/draw-print-page.md` §2.2 and §2.3).

What this means for [ADR-0141](0141-the-review-app-has-four-modes.md): `layout` and `edit` are
write modes, so under this record they leave the plugin's surface. They are not deleted — the
standalone app keeps them (D7) — and whether a plugin may write positions is an open point below.

### D4. The agent's surface is the skills and the CLI; there is no MCP layer

The agent reaches TextEDA the way it reaches everything else: a skill that says how to use the
command line, and the command line. A skill can state the whole workflow — which file to edit,
which command to run, what a diagnostic means, what to re-run afterwards — and it lives in the
repository next to the code it drives, where it is reviewed like code.

MCP would be a second protocol for the same verbs. It earns its place only with consumers that
can neither host a plugin nor run a command: traditional desktop applications, cloud services,
editors whose agent is not ours. That is a compatibility surface for other people's tools, not a
layer between our agent and our core, so it is not built. If it is ever built, it is an adapter
over the same commands — never a second implementation of them.

The hosts give this for free anyway: a DSH plugin registers tools in the host process, and a pi
extension registers them with `pi.registerTool`. Neither needs a protocol of ours
(see [docs/plugin-hosts.md](../../plugin-hosts.md)).

### D5. The person's gestures are read-only: look, select, ask

Hover highlights by identity; a click selects; a selection can become a brief that the agent
receives. The brief is a request, not an edit. "U1 is where I pointed — move it and re-route what
it disturbs" is work the agent does in the file, through the CLI, with the whole project in view.

This keeps the existing ownership rule intact and does not need a new one: the human owns the
final positions, the agent writes the wires, and the drawing stays advisory so that rearranging a
sheet never changes the build.

### D6. The scopes are explicit

A plugin instance shows one scope at a time: `sch` (the print pages, with the schematic's logic
behind them) or `pcb` (the board canvas). They are different drawings over different IR shards,
so they do not share a mode bar, and the findings, the definitions menu and the routes are scoped
to the scope on screen. The standalone app grows the same split.

### D7. The standalone app survives as the bridge

A browser-only host needs an HTTP surface, and CI needs a file. The `texteda review <dir>`
server and its static export stay, and they are the same code the plugin's host half uses. The
standalone app keeps its write modes for as long as they are useful; see open point 3.

### D8. Writes, where they happen, go through the core

When a write does happen — in the standalone app today, or in a plugin that is later allowed to
write — it is the core's write: canonical form, a temporary file and a rename, and a refusal when
the result would not be consistent. No half of a plugin edits a file directly. This restates
[ADR-0141](0141-the-review-app-has-four-modes.md) D9 unchanged; it is stated here because a plugin
adds a second potential writer to the picture.

## Open points

1. **Which workbench is targeted first.** DSH has a plugin market and a browser client half, so a
   plugin there can carry the drawing. pi has native tools but no picture surface, so a plugin
   there is tools and commands, and the drawing stays a browser app. The two are not the same
   deliverable.
2. **Whether the plugin may write positions.** Spatial judgement is the one thing a person is
   better at than an agent, and the repository's own print-page workflow gives the human the
   positions. A drag-to-place gesture would keep that ownership inside the plugin — but it is the
   one write this record currently denies (D3). It is open because it is the difference between a
   viewer and an instrument.
3. **What the standalone app keeps.** If the plugin takes the drawing, does the standalone app
   keep `layout` and `edit`? Keeping both is two applications to keep in step; dropping them
   takes away the ability to rearrange a sheet without the agent in the loop.

## Consequences

- The critical path stays the core ([ADR-0134](0134-the-view-layer-is-a-drawing.md) D8): a plugin
  is a consumer of artifacts, exactly as the app was.
- The app's own surface shrinks: no source editing, no chat, fewer modes. That is the point of the
  record, but it removes capability that exists today, so it needs a replacement (the brief) and a
  fair test — can a person actually get their sheet arranged this way?
- The repository gains a second consumer of the core and a host shape that is not ours to
  control. The core must therefore stay loadable in a browser and in Node, which it already is.
- Work is deferred, not cancelled: the standalone app, the bridge and the static report remain
  useful on their own, whatever the plugin becomes.

## What this record does not change

- The IR and the schemas.
- The ownership of the three source layers: the schematic is normative, the print page is
  advisory, the PCB is normative.
- That layout and routing are agent-driven
  ([ADR-0116](../pcb/0116-layout-and-routing-are-agent-driven.md)) — a plugin that wrote copper
  would contradict that record.
- The canonical write path.
