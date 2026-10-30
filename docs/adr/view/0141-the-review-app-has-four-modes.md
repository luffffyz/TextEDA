# ADR-0141: The Review App Has Four Modes, and `layout` Writes Placement, Not Copper

Status: Accepted
Date: 2026-10-28
Scope: Decides: that the review app has four modes — `review`, `layout`, `placement`, `edit` — that share one highlight-and-jump path, that `layout` writes only the print page's `place` rows plus the bends of the nets it disturbed, and that the app never writes `design/**`. Does not decide: what a print page is or how it is drawn — see ADR-0134 and ADR-0135; how PCB placement and copper routing are produced — see ADR-0116.
Related: [ADR-0103](../language/0103-source-spans.md), [ADR-0116](../pcb/0116-layout-and-routing-are-agent-driven.md), [ADR-0134](0134-the-view-layer-is-a-drawing.md), [ADR-0135](0135-our-own-reference-renderer.md), [ADR-0142](0142-the-review-app-is-a-plugin-of-the-agent-workbench.md)
Impact: `packages/viewer/**`; `packages/cli` (the `review` command); `packages/renderer`; `packages/core`; `docs/guides/review-app.md`; `docs/backlog.md` (F34)

## Background

The review app was built with one mode. `texteda review <project>` serves the print pages of a
project, drawn by the reference renderer, with hover and click so a reviewer can ask "what is this,
and what is it on" without leaving the drawing. That answers a question about a **finished** drawing.

Everything else a person does with a drawing is unanswered. Three moves come up immediately when a
sheet does not read well:

- The symbol overlaps a label, or sits at an awkward angle. A person wants to nudge it. Today the
  only way to do that is to open the `.view.teda` file in an editor, compute the new origin in
  millimetres, and type it — while the drawing they are looking at is in another window.
- The board's parts are placed but nobody can see where. The PCB has real geometry (outline,
  placements, copper) and the app shows none of it.
- The sheet needs a small text change — a label, a note. The app shows the drawing, not the source,
  so the two cannot be edited side by side.

These are the three missing modes of F34: `layout`, `placement`, `edit`.

The decision this record replaces was taken on 2026-10-25 as an appendix to the schematic-view
record. That appendix was lost in the 2026-10-28 restructuring of `docs/adr/` — the corpus was
rebuilt into topic folders and the appendix did not survive the move, while four live documents
still pointed at it. This record restates that decision as a record of its own, so the pointer has
something to point at. What follows is therefore a restatement plus the additions the
implementation forced.

## Decision

### D1. Four modes, one highlight-and-jump path

The app has four modes. They differ in **what the canvas is** and **what a drag means**; they do
not differ in how the app finds an object, highlights it, or takes the reviewer to its source.

| Mode | Canvas | What a drag does | Writes |
|---|---|---|---|
| `review` | the print page | pans | nothing |
| `layout` | the print page | moves the selected symbol (pending, until Apply) | the print page |
| `placement` | the PCB | pans | nothing |
| `edit` | the print page, beside its source | nothing (the canvas is not editable here) | the print page |

The shared path is the point. Hover, selection, the facts panel, the definitions menu and the
`vscode://` jump are one implementation, exercised by every mode; a mode switch changes the SVG and
the overlay, and nothing else. A second implementation of "highlight the thing under the pointer"
would be a second opinion about what an object is, and the two would drift.

`placement` is a **read-only** canvas. It shows the board's placement, outline, courtyard and
copper, and it highlights nets. It does not move parts: PCB placement and copper are the agent's
and the CLI's work under ADR-0116, and the app writes no `design/**` in any mode.

### D2. Rendered objects carry a stable identity

Every drawn object gets a stable ref: `instance:<id>`, `net:<net>`, `label:<net>`,
`port:<id>`, `pad:<instance>.<pad>`. The renderer writes it into the SVG as `data-ref`.

The renderer stays pure — it knows what it drew, not what hover and click mean (D1's shared path
lives in the app). But without a ref in the output, the app can only address objects by asking the
model for their boxes, and a net's copper is many separate traces: there is no single box to
highlight. A ref in the drawing is what makes "light up every piece of this net" a matter of
styling the drawing the renderer already produced.

The ref is also the handle the app drags: the SVG groups a placed instance's primitives under its
ref, so a pending move is a transform on that group — the drawing is not re-rendered per pointer
move.

### D3. `layout` writes the print page, and nothing else

`layout` is the S1 placement surface (ADR-0134). Its writes are:

- the `place` row of the symbol being moved: its origin and its rotation;
- the bends of the wires whose nets the move disturbed;
- the positions of the labels and ports on those nets, when the move left them off the net.

It writes **no** `design/**`, no IR shard, no project hash, no manufacturing artifact. The print
page stays outside the build identity (ADR-0134 D5), and `design/**` stays the truth about the
circuit. A person rearranging a sheet for legibility has not changed the circuit, and the tool must
not pretend otherwise.

What the app writes is canonical (ADR-0134 D10): the file it writes is byte-identical to what `fmt`
produces for that content, so a save leaves a diff that shows design changes and nothing else.

The base of that write is the editor's text when the editor holds one, and the file on disk
otherwise (D6).

The plugin that carries this app into a host writes **less**, not more: the `place` rows only, and
not the bends of the disturbed nets ([ADR-0142](0142-the-review-app-is-a-plugin-of-the-agent-workbench.md)
D3). This record governs the standalone app, which keeps its modes for now
([ADR-0142](0142-the-review-app-is-a-plugin-of-the-agent-workbench.md) D11).

### D4. Routing is not live; the stale signal is the warning

A `wire` row is a derivative of `place` plus the logical netlist: its endpoints are pin
references, and the renderer derives their connection points from the symbol geometry. So moving a
symbol moves the wire's endpoints with it, while the row's stored bends stay where they were. The
wire can therefore stop being orthogonal, or start crossing a pin, before anything is written.

That is the design, not a defect: **routing is recomputed at a commit point, not on every pointer
move.** Per-frame routing would make the result depend on the drag path rather than on the final
placement, would churn the drawing while the person is judging placement, and would turn the canvas
into the interactive router this project does not have (ADR-0116).

The stale wires are marked in the app, and `texteda check` reports them as
`view.wire-diagonal` and `view.wire-crosses-pin`. Those warnings are the signal: the page is not a
finished artifact until it is rerouted.

### D5. Apply is the commit point, and "recompute" is a re-anchor, not a route

`Apply` writes the pending placement and the bends of the disturbed nets in one transaction. The
**affected set** is: the wires whose endpoint connection points moved, plus the labels and ports
on those nets. Every other wire, label and port is left byte-identical.

Recomputing a disturbed wire is a **re-anchor**, not a route. The wire's drawn shape is preserved:
the same number of segments and the same sequence of axis directions. Each segment's shared
coordinate is re-derived from the new endpoint; each coordinate the shape leaves free keeps the
value it had. The result is a polyline that starts at the new from-pin connection point, ends at
the new to-pin connection point, and is axis-parallel throughout — the drawing the person drew,
re-attached to the pins that moved.

A wire that was a single straight run and whose endpoints are no longer aligned cannot keep that
shape; it becomes one elbow, with the first segment keeping the direction it had.

This is deliberately not obstacle avoidance. A re-anchor does not know about symbols, clearance or
courtyards, and does not pretend to. A wire that now runs across the body of the symbol it was
attached to is reported as `view.wire-crosses-symbol` and left for a person or an agent to fix.

### D6. Manual edits survive; conflicts are reported, not overwritten

A reroute must not silently overwrite work a person did. The re-anchor only touches the affected
set (D5), and within that set it changes bends, not intent: it keeps the shape and the free
coordinates, so a hand-placed detour stays a hand-placed detour.

Text the person typed but did not save is work a person did, and it survives a move the same way: a
layout write is computed on the editor's text when there is one, so the file that is written is that
text with the moved rows applied. The draft travels with the write request, not with the pointer
move, and a request without a draft is computed on the file on disk — the behavior before this rule
existed. A draft that does not parse is refused, and nothing is written.

Where the shape cannot be kept at all — the single-run wire of D5 — the app says so rather than
silently choosing an elbow the person did not draw. A wholesale regeneration is a separate,
explicit action that announces it may replace manual work. It is never the default.

### D7. `edit` is text-first

`edit` shows the print page's **source** beside the drawing. The text is the source of truth; the
canvas follows it.

- Clicking an object in the canvas moves the text cursor to that object's line in the source. The
  mapping is the advisory identity index (ADR-0103 D6), the same one the definitions menu uses.
- Typing in the text re-renders the canvas.
- The canvas is **not** directly editable in `edit`. Moving a symbol belongs to `layout`, which
  knows how to re-anchor the wires it disturbs; a canvas that moved symbols without doing that
  would be a second, worse way to lay out a sheet.

### D8. Selection is state; jumping is an action

A single click selects. It does not open a file, and in `layout` it does not start a drag. The
definitions menu opens on `Enter` or on a double-click that did not travel. The source jump is
always an explicit act.

This holds in every mode, and it is why `layout`'s drag and the jump can share a pointer without
one stealing from the other.

### D9. The app writes through the CLI, never from the browser

The browser holds no filesystem access. A write is a request to the CLI process that serves the
app, and the CLI does the writing — the same place that owns the file system (ADR-0134 D7), the
same place that knows the canonical form (D3) and the same place that can refuse a write it cannot
make consistent.

A static export (`--out`) has no server to write to. The export stays byte-identical to what the
server serves, and the write controls report that there is nowhere to write to, rather than
pretending.

## Consequences

- **The sheet becomes editable where it is read.** A person rearranging a print page no longer has
  to leave the drawing, and cannot accidentally change the circuit while doing it (D3).
- **The PCB becomes visible.** `placement` answers "where did the agent put the parts, and what is
  this net" without leaving the app, and it is read-only, so it cannot become a second placement
  editor competing with the agent-driven flow of ADR-0116.
- **The source and the drawing sit side by side.** `edit` makes the file the place where text
  changes happen, which is what it is for (D7).
- **Wires are recomputed by formula, not by search.** The re-anchor is closed-form and
  deterministic; the same placement always produces the same bends. That is what makes the app
  safe to trust with a file a person is working on (D5, D6).
- **The cost is a second canvas.** The PCB canvas is a drawing of the PCB IR, and it is the first
  consumer of the PCB side of the reference renderer.
