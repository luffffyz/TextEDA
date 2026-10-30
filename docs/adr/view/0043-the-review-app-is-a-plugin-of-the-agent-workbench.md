# ADR-0043: The Review App Is a Plugin of the Agent Workbench, and the Agent Owns the Source

Status: Accepted
Date: 2026-10-29
Scope: Decides: that the review app becomes a preview surface inside an agent workbench rather than an editing product; that the agent is the single writer of the design sources, with one exception — the plugin writes the print page's positions; that the standalone app survives as the bridge for hosts that cannot host a plugin; which host the picture half targets first; where the re-anchor after a drag happens; and what the standalone app keeps meanwhile. Does not decide: the shape of the agent's surface — see ADR-0044; which route serves a host that has two — see ADR-0046; what a print page is or how it is drawn — see ADR-0035 and ADR-0036.
Related: [ADR-0035](0035-the-view-layer-is-a-drawing.md), [ADR-0036](0036-our-own-reference-renderer.md), [ADR-0042](0042-the-review-app-has-modes.md), [ADR-0044](../process/0044-the-agent-surface-is-a-set-of-verbs.md), [ADR-0046](../process/0046-a-host-is-entered-once.md), [ADR-0047](../process/0047-the-picture-reaches-a-host-by-three-routes.md), [ADR-0048](0048-the-review-app-shows-drawings.md)
Impact: `packages/viewer/**`; `packages/cli/src/review.ts`; `packages/cli/src/review-model.ts`; `packages/cli/src/layout.ts`; `docs/guides/review-app.md`; `docs/backlog.md` (F34, F52, F53); `docs/plugin-hosts.md`

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
advisory ([ADR-0035](0035-the-view-layer-is-a-drawing.md) D5), while the schematic and PCB shards
are normative (`packages/cli/src/ir-tree.ts`).

So the app was never the place where those three surfaces change. It is the place where they are
**seen**. What is left for it, once it lives inside somebody else's window, is the picture and the
pointing.

Two of those three surfaces are not worth fighting over with a person: the agent edits the
schematic file and runs the checks better than a form would. The third is different. **Position is
the one fact that language carries badly.** "Move U1 a little left of the divider" asks the agent
to guess millimetres it cannot see, and it is exactly the kind of instruction that produces a
plausible-looking wrong answer. A person's judgement of where a part sits is worth keeping, and
the cheap, exact channel for it is a pointer, not a sentence. That is the whole reason the plugin
keeps a write — and the write is of positions only.

The correction that shapes this record: in a plugin, the dialogue box and the source editing are
the agent's own functions. The plugin needs to preview — and to be a good place to point. The
shape of the candidate hosts' plugin APIs — what a bundle is, what an extension may register, which
sessions can carry a picture — is in [docs/plugin-hosts.md](../../plugin-hosts.md).

This record was a draft when it was written, and the parts that were still open in it are now
decided in D9 to D11.

## Decision

### D1. The workbench is the entry point; the app is a surface inside it

A person opens the agent's workbench and asks. The app appears where the drawing helps, inside
that workbench's window, and it goes away when the workbench does. It is not a product with its
own lifecycle, its own file formats, or its own idea of what a project is: it is a surface over
the core, hosted by somebody else's shell.

The contract with a person is therefore four verbs — look, select, ask, place — and nothing else.

### D2. The plugin is two halves over one core

The core does not change. The parser, the IR, the checks, the renderer and the canonical write
path stay where they are, and `packages/{ir,parser,exporter,renderer,core}` keep their rules: no
runtime dependency, no `Bun.*`, no `process.env`, loadable in a browser and in Node.

The plugin is a delivery form with two halves:

- a **host half** that answers questions about a project — the model, the findings, the drawing —
  and writes the one thing a person is allowed to write, positions, through the core (D3);
- a **client half** that renders the reference renderer's SVG and reports what the person
  selected.

Neither half parses anything. The client draws what the renderer produced and asks the host for
everything else. This is [ADR-0035](0035-the-view-layer-is-a-drawing.md) D7's "the shell stays
replaceable", taken one step further: the shell is now somebody else's shell, and the plugin
adapts to it.

Our code already is these two halves: the host half is `packages/cli/src/review.ts`, the client
half is `packages/viewer/src/client.ts`. Neither knows what a plugin is, and neither has to.

### D3. The plugin writes positions, and nothing else

The plugin's one write is the print page's `place` rows: where a symbol sits and how it is
rotated. Nothing else.

Three things keep that write from becoming a second truth:

- **The print page is not a build input.** Its shard is advisory
  ([ADR-0035](0035-the-view-layer-is-a-drawing.md) D5), so moving a symbol cannot change the
  circuit, the BOM or the project hash. The plugin's write cannot make the project wrong; at worst
  it makes the drawing wrong, and `texteda check` says so.
- **The write is one kind of row.** `place` rows only. The plugin cannot touch instances, nets,
  constraints, `design/**` or the PCB.
- **The write is the core's write.** Canonical form, a temporary file and a rename (D8).

What the plugin does **not** write is the wiring. A drag disturbs the wires attached to the moved
symbol: their endpoints follow the symbol, their stored bends do not. Those wires go stale, and
the staleness is reported rather than hidden — `view.wire-diagonal` and `view.wire-crosses-pin` say
which wires no longer fit. Fixing them is the agent's or the command line's work.

This narrows [ADR-0042](0042-the-review-app-has-modes.md) D3, which gave `layout` the bends of
the disturbed nets as well: under this record the plugin writes the `place` rows and not the bends.
The re-anchor algorithm exists (`packages/core/src/view/reroute.ts`), and the command line can
run it — `texteda view rewire`, and the agent's `texteda_view_rewire` tool (D10).

The division this produces — the person places, the agent wires — is the rule the repository
already holds for the print page: the human owns the final positions, the agent writes the wires,
and no mode of the print-page workflow writes `design/**`
(`docs/skills/draw-print-page.md` §2.2 and §2.3). This record gives that rule a surface.

### D4. The agent's surface is a set of verbs, and the hosts adapt them

The agent reaches TextEDA through the command line's verbs and the skill that documents them.
Where a host offers a tool registry, the same verbs are registered there as tools, over the same
functions — an adapter, not a second interface. Where a host speaks MCP, the same verbs are served
there over the same functions
([ADR-0044](../process/0044-the-agent-surface-is-a-set-of-verbs.md) D5); MCP is a transport for
the same verbs, not a third interface. A host that has both routes is entered once
([ADR-0046](../process/0046-a-host-is-entered-once.md) D1, D2).

The shape of that surface — the verbs, the skill, the adapters, the naming of the print page's
commands — is decided in [ADR-0044](../process/0044-the-agent-surface-is-a-set-of-verbs.md).

### D5. The person's gestures are look, select, ask, place

Hover highlights by identity; a click selects; a selection becomes a brief that the agent
receives; a drag moves a symbol on the sheet and writes the `place` row (D3).

The brief is a request, not an edit. "U1 is where I pointed — move it and re-route what it
disturbs" is work the agent does in the file, through the CLI, with the whole project in view. The
drag is the exception, and it is narrow: it says *where*, and never *what*.

This keeps the existing ownership rule intact and needs no new one: the human owns the final
positions, the agent writes the wires, and the drawing stays advisory so that rearranging a sheet
never changes the build.

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
[ADR-0042](0042-the-review-app-has-modes.md) D9 unchanged; it is stated here because a plugin
adds a second potential writer to the picture.

### D9. The picture half's first host is DSH's `web` profile

The picture half needs a drawing surface, not a session page
([ADR-0046](../process/0046-a-host-is-entered-once.md) D3; see
[docs/plugin-hosts.md](../../plugin-hosts.md)). DSH's `web` profile is where it goes first, for
three reasons that are facts rather than preferences:

- It is the only host today whose two halves have the documented shape: a host half in the host
  process and a client half in the session page. The bundle that carries the tools already exists
  and is exercised (`plugins/dsh-texteda/`).
- Its client half speaks the transport the standalone app already speaks — the model and two write
  routes — so making the app mountable serves both shells instead of forking the drawing.
- Its write path is the core's write path (D8), so the plugin's one write is the same write the
  app's Apply makes.

The other two hosts are not first, for reasons that are also facts. pi has no drawing surface at
all, so only its agent-facing half can ship there — and does. Claude Code's mods can draw, but
its client file is a different shape: it posts data to the mod instead of asking for routes
([ADR-0046](../process/0046-a-host-is-entered-once.md) D3), so it is a second client half rather
than a second mount of the first.

The agent-facing half is portable and ships to every host regardless of this decision: it is the
tools, and the tools are the command line's ([ADR-0044](../process/0044-the-agent-surface-is-a-set-of-verbs.md)).

### D10. The re-anchor after a drag is the command line's job

The division of labour already exists on both sides. The plugin writes where a symbol sits (D3);
the wiring is put back by `texteda view rewire`, which re-anchors the disturbed wires and reports
the ones it could not fix, and the agent has the same verb as a tool (`texteda_view_rewire`). So a
plugin's drag leaves the wires stale and says so — `view.wire-diagonal` and
`view.wire-crosses-pin` — and never rewires them itself. The plugin's write stays one kind of row
(D3).

### D11. The standalone app keeps `layout` and `edit` for now

The plugin is added, not substituted. Until a person has actually arranged a sheet through the
plugin, the standalone app keeps its write modes: they are the only way to rearrange a sheet
without the agent in the loop, and they are the reference implementation the plugin's write path
is tested against. The two are not two implementations — the app and the plugin share one core and
one write path (D8).

What the app stops carrying is not decided here; it is earned by the plugin doing the job.

## Consequences

- The critical path stays the core ([ADR-0035](0035-the-view-layer-is-a-drawing.md) D8): a plugin
  is a consumer of artifacts, exactly as the app was.
- The plugin becomes an instrument rather than a viewer: it is where a person says *where*. That
  is the one thing language cannot carry, and it is worth a write path.
- The plugin's contract with a person is four verbs, so the plugin has no source editing and no
  chat; the standalone app keeps its modes until the plugin has actually arranged a sheet (D11).
  That removes capability only when the replacement exists — the brief — and has passed a fair
  test: can a person actually get their sheet arranged this way?
- A write path a person uses has to be as careful as any other: one kind of row, canonical output,
  and a warning about what the write left stale instead of a silent fix.
- The repository gains a second consumer of the core and a host shape that is not ours to
  control. The core must therefore stay loadable in a browser and in Node, which it already is.
- Work is deferred, not cancelled: the standalone app, the bridge and the static report remain
  useful on their own, whatever the plugin becomes.

## What this record does not change

- The IR and the schemas.
- The ownership of the three source layers: the schematic is normative, the print page is
  advisory, the PCB is normative.
- That layout and routing are agent-driven
  ([ADR-0017](../pcb/0017-layout-and-routing-are-agent-driven.md)) — a plugin that wrote copper
  would contradict that record.
- The canonical write path.
