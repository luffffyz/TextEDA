# Reviewing a project in the browser

`texteda review` serves one interaction surface: the project's drawings, drawn by the renderer, with
hover, selection, explicit schematic move/rotate actions, and an optional Source panel. PCB drawings
remain read-only. A person can ask "what is this, and what is it on" without leaving the drawing.
Decision: [ADR-0035](../adr/09-view/0035-the-view-layer-is-a-drawing.md) (D7 records the form
this first version takes), [ADR-0048](../adr/09-view/0048-the-review-app-shows-drawings.md) (what
the app shows: drawings, not boards), and [ADR-0056](../adr/09-view/0056-the-review-app-has-one-interaction-surface.md)
(the current interaction and write contract).

## Run it

```sh
bun run texteda review examples/reference-project            # serve on a free port
bun run texteda review examples/reference-project --port 4719
bun run texteda review examples/reference-project --out review.html
```

The server prints the URL it is listening on:

```
review reference-project at http://127.0.0.1:4719/
```

It binds `127.0.0.1` only and answers three routes: `/` (the document) and two write routes, `POST
/api/layout` and `POST /api/source`. Ctrl-C stops it, and stopping it is a normal end (exit code 0),
not a failure. Everything the page needs — the model, the drawing, the script — is in that one
document, so `--out` writes byte-identical bytes to what the server sends. That file is the static
report for a pull request: no build step, no assets beside it.

A static `--out` document has no server behind it, so it has no write routes: the `Apply` and
`Save` buttons are disabled and say "this document cannot write". The same drawing, selection,
navigation, and read-only PCB behavior remain available.

## Two columns, and the keys where the eye already is

The frame is two columns — the drawing list and the sheet — and **the list starts folded**. The
sheet is what a reviewer reads; a fixed 260 px of chrome takes a third of a narrow window
([ADR-0056](../adr/09-view/0056-the-review-app-has-one-interaction-surface.md)). The action bar
carries `Contents` to open it, and folding it gives the whole width back to the sheet and re-fits
the drawing.

| Column | What it is |
|---|---|
| left | Folded by default. The project and its build hash, the drawings grouped by kind (print pages, PCB canvases, library symbols, library footprints), what the current print page measures, then the findings from `texteda check` (errors, then warnings, then notes). The first five show; "show all N" opens the rest. A finding that names an object carries a **show** button: it takes the reviewer to that object on the drawing. |
| right | The current drawing with explicit actions above it, and a status line naming the source file, the size, and what the drawing is made of. It also reports what the selection is: its project-level instance id, device, and the nets its pins land on. |

There is no details panel. A selection's facts are the ones the status line already prints, and
everything else a reviewer wants — the symbol, the footprint, the spec — is one `Enter` away in the
editor, where it can be read next to the source that produces it. A panel that restated those facts
duplicated the source entry and took width from the drawing.

## The key hint

The sheet's top-left corner carries the keys that answer **in the current state**, each in a rounded
box: `Enter` opens the selected object's source, `M` starts a snapped move, `R` rotates a selected
symbol, `Backspace` restores a selected field's automatic placement, `0` / `+` / `-` fit and zoom,
`←/→` walk the drawings, `Esc` clears the selection.

The hint is **resident**: it is up from the start, because a reader who does not know that a key
exists cannot ask for the list that would tell them. `?` folds it away for the moments when it
covers the sheet, and brings it back.

The list is derived from the state, not fixed: while a move is in flight it shows only the two keys
that end it, a field with no override offers no `Backspace`, a host that may not write offers no
`M`, and a PCB drawing offers neither `M` nor `R`. A resident hint does not become a stale one —
it is repainted whenever the state it describes changes.

## What `M` can move

A symbol, a field override, a net label, and a project port all move on the sheet the same way:
select, press `M`, drag, and the offset snaps to the `0.5 mm` lattice. A label is addressed by the
net it names and a port by its `port_id`, and the write stores the position the app sends
(ADR-0056 D2). A note — a free `text` row — does not move: nothing in the language says what a
paragraph's position means, so the app offers no move for it.

The `0.5 mm` lattice applies to placements, field anchors, wire bends, labels, ports and notes
covered by the view-coordinate rules ([ADR-0059](../adr/09-view/0059-print-page-coordinates-anchor-on-the-half-millimetre-lattice.md)
D1). Explicit `@x,y` wire endpoints use the `0.01 mm` format resolution instead; they are drawing
geometry used to preserve existing wire endpoints, not a free-placement mechanism. `bun run
view:verify <project>` checks the applicable stored-coordinate lattice rules.

A port can also be the **end of a run** (`wire` rows name it instead of a pin). Moving that port
extends or shortens the run to reach it, so the port stays on the wire
([ADR-0062](../adr/09-view/0062-a-run-may-end-at-a-port.md) D4). When the port only sits *near* a
run, moving it off the net is the case below.

A moved label or port that lands off its net is **reported, not snapped back**: `check` says
`view.label-not-on-net` / `view.port-not-on-net` and the status line carries the distance. An
explicit position is a decision (ADR-0056 D6); the automatic reseat that a symbol move triggers
abstains from rows the person placed by hand.

## What the app shows

The app shows **drawings**, and there are four kinds of them
([ADR-0048](../adr/09-view/0048-the-review-app-shows-drawings.md) D1):

| Kind | What it is | Where it comes from |
|---|---|---|
| print page | the page a reviewer reads: the symbols, the wires, the labels and the ports | `views/<page_id>.view.teda` |
| PCB canvas | the physical PCB as it is placed: outline, pads, copper, silkscreen | `design/pcb/<pcb_id>.teda` |
| symbol | one symbol of the project, drawn with the pins of a device that uses it (ADR-0031) | `assets/symbols/<category>/<id>.teda` |
| footprint | one footprint of the project: its pads and its graphics | `assets/footprints/<family>/<id>.teda` |

The project logic comes from `design/sch/main.teda`. Print pages use project-level `page_id`s and
reference its project-level module-instance IDs, flattened instance and net IDs, and interconnect
IDs. PCB canvases use the physical `pcb_id` in their source path.

The sidebar lists them grouped by kind, in that order. The kind blocks fold; the two library kinds
go one level further, by the classification directory the file sits in — a symbol's device
category, a footprint's package family (ADR-0049) — because a project with forty passives is not a
flat list of forty rows. That class level does not wait for a click: it opens under the pointer and
closes when the pointer leaves, so a drawing is one gesture away instead of two. Each summary
carries the block's count, and the rows a reviewer actually picks are drawn as chips on their own
background, set apart from the headings above them. Indentation marks what can be opened: a class
heading takes one step in from its kind, and a drawing takes none — its name lines up under the
class name it is filed in, because a drawing cannot be opened. The selection is never hidden: the kind block
opens for the drawing it holds, and the class block holding the selected drawing stays open even
after the pointer leaves. The arrow keys walk the drawings of the same kind, in the order the tree
shows them — the print pages among themselves, the symbols among themselves — and reaching one
inside a closed class opens it.

- **A project with no print page has no schematic drawing.** If `views/` contains no print pages,
  the app says so and draws no schematic canvas (ADR-0035 decision 6). It does not invent a layout.
  The project's flattened instances remain available as chips, and clicking one reports its facts.
- **A drawing that cannot be drawn says why** and is marked in the list.

### The PCB canvas

The PCB's own canvas, drawn from the physical PCB description at `design/pcb/<pcb_id>.teda` and the
footprints it places — the answer to "where did this part land, and what copper is it on". It is
read-only by design: the copper, the zones and the spacing belong to the agent-driven layout loop,
not to a browser ([ADR-0017](../adr/05-pcb/0017-layout-and-routing-are-agent-driven.md)). Clicking
lights one net's pads, tracks and vias, and the status line names it; a part's reference and value
are printed only where the PCB's `silk` section says so (spec/pcb.md §4.10), so the canvas shows what
the board will print. Here the click is resolved from the drawing's own objects, so what is picked is
what was drawn — a pad, a track, a via — and not an invisible box around it.

## One interaction surface

There is no review, layout or edit mode. The current drawing determines which explicit actions are
available. All drawings share hover, selection, definitions, navigation, zoom and pan. A schematic
print page additionally exposes placement actions when its host can write; the PCB and library
drawings remain read-only.

### Selection and definitions

- **Click a drawn object** to select it. A schematic click does not move anything and does not jump
  to a source row. PCB clicks select the drawn object and highlight its net; they never edit the PCB.
- **`Enter` or a double-click** opens the definitions menu for the selected identity. Choosing an
  entry opens `vscode://file/<absolute path>:<line>:<col>`.
- **Click empty paper** clears the selection. `Escape` closes an open definitions menu first, then
  clears the selection when no transaction is active.

### Schematic placement actions

Placement is a local transaction on the current schematic print page. It is available to a standalone
server and to a host with `write: "layout"`; a places-only host with `write: "places"` may move
placements but cannot edit fields or source.

- **`m` starts movement** only after a schematic symbol or permitted field is selected. The preview
  uses the existing `snapPlacement()` path and its 0.5 mm grid (ADR-0057). Pointer movement changes the local
  preview; it does not write a file.
- **Left-click completes the local move preview.** The object stays selected afterwards, so the
  next `m` nudges the same object — a placement is often a second nudge, not a second selection.
  The result remains pending until `Apply` or `Ctrl+Enter` sends a commit to `POST /api/layout`.
- **`Escape` during a move cancels that transaction only.** It restores the symbol or field's
  original placement and preserves unrelated pending edits. It does not commit anything.
- **`r` queues a clockwise 90-degree rotation** for the selected schematic symbol. Rotation is a
  pending view edit. The click or `Escape` after rotation clears the selection but does not undo the
  queued rotation.
- **`Apply` / `Ctrl+Enter` is the commit point.** Placement, rotation and permitted field changes
  are written together through the CLI. A full-capability standalone surface may also use the
  explicit **Source** action to preview and save source text; source editing is never entered by a
  drawing click.

The full-write schematic action bar has two independent, default-off preview controls. **Auto fields**
places only page-level `Reference` and `Value` fields to avoid collisions; it does not move symbols.
When off, fields stay at their symbol-local anchors and follow symbol translation and rotation; the
page-level collision placement pass does not run. Turn it on only when the preview should place fields
to avoid collisions. **Re-anchor wires** controls the moved-endpoint re-anchor and path-simplification
pass. When off, a moved or rotated pin endpoint keeps its identity and the wire keeps every authored
bend; the affected net is reported stale until an explicit rewire. When on, pin endpoints follow the
moved symbols through the existing re-anchor behavior. Neither setting implies the other. Both
controls are sent to the server for preview and Apply; they do not change the DSH places-only contract.

### What the Apply writes

The page is recomputed, but only the rows that changed are written back. Moving one symbol on the
reference page changes four rows: the symbol's own `place` row, the first endpoint of each wire
that hangs on it, and whatever was sitting on that net's wiring. The wires keep their shape, their
bends and their directions — only their endpoints follow the pins. Every other row of the page
stays byte-identical.

A label or a port **follows its net only when it was already on that net's wiring**. A label the
reviewer placed freely — 9 mm below the bus it names, because that is where the text reads
clearly — stays where it was put; a move elsewhere on that net is no reason to pick it up
(ADR-0061 D1). What did follow is named in the report the app shows.

The recomputation costs a scan of the page, not a scan per row, so it grows with the page rather
than with its square (ADR-0061 D3).

The browser never writes files. The server owns canonical parsing and writing, and these actions
write only `views/<page_id>.view.teda`; they do not write `design/**` (including
`design/sch/main.teda` and `design/pcb/<pcb_id>.teda`), IR shards, project hashes or build hashes.
The write goes through a temporary name and an atomic rename, so a reader
sees either the old page or the new one — never half of each — and the bytes the write replaced are
kept under `dist/backups/`, so a page that was moved by mistake can be put back. The standalone
server's full capability accepts fields and source. The DSH
places-only host rejects `fields`, `remove_fields` and `text` payload keys instead of ignoring them.
The app does not route wires during a move or solve placement; stale or conflicting wires are
reported for the CLI/agent workflow.

The definitions menu is backed by the advisory `dist/ir/identity.json` written by `texteda ir`
([ADR-0004](../adr/01-language/0004-source-spans.md), 2026-10-26 amendment), so the app does not
re-parse a file merely to locate a definition.

`vscode://file/...` is handled by whatever the user has bound to that URI scheme. A static `--out`
report embeds the build machine's absolute paths; it is useful where that project tree exists and
otherwise still shows the relative file and line.

## Interaction

| Input | Effect |
|---|---|
| hover a symbol / label / port | The element is outlined in the app's layer and the facts appear at the bottom and on the right. Moving off it releases the mark and the status line goes back to describing the page. The SVG is not regenerated. Hovering one net label lights every place that net is named. |
| click | Selects it: a slightly thicker outline and a wash, kept while the pointer moves away. It does not open a file. |
| `Enter` or double-click the selection | Opens the definitions menu: the project/module-instance row, print-page placement, PCB placement, component, symbol, footprint and pin rows for an instance; the project net row and every view wire/label for a net. Choosing a row opens `vscode://file/<absolute path>:<line>:<col>`. |
| click empty paper, or `Esc` | With the definitions menu open, `Esc` closes the menu first; a second `Esc` (or a click on empty paper) drops the selection. |
| drag | Pans. |
| wheel | Zooms about the cursor. The sheet is re-rendered as vectors at the new size, so it never goes soft in between. |
| `0` | Fits the page again. |
| `+` / `-` | Zooms in and out. |
| `←` / `→` | Previous and next drawing of the same kind: the print pages among themselves, the library symbols among themselves. |

These bindings apply to the one surface. `m`, `r`, `Ctrl+Enter` and the transaction rules are
available only when the current schematic drawing and host capability allow them. A single click
always selects; it never jumps to a source row. Source navigation is available through the explicit
Source action and through the definitions menu, not through drawing clicks.

The mark is a screen annotation: its stand-off (4 px plus half the drawing's typical 0.25 mm stroke)
and its stroke (1.25 px hovered, 1.75 px picked) are rewritten in sheet units on every zoom, so both
the outline and the gap to the drawn edge keep their size at any magnification. The half-stroke term
is not decoration: the boxes in the model are centreline boxes, and the drawing's ink grows outward
from them as you zoom in, so a fixed pixel stand-off would look tighter the closer you look.
`vector-effect: non-scaling-stroke` would be the obvious way to do that and does not work here — it
compensates the SVG's own viewBox, not the CSS `scale()` on the canvas around it, and a "1.5 px"
stroke then paints 1.5 mm, which reads as a slug over small parts.


## The findings and the measurements

The left column carries the findings of `texteda check` and the numbers the current print page
measures. The two belong together: a finding says *that* something is wrong, and the measurement
says how much of the sheet it takes and how far it is from comfortable
(spec/schematic-view.md §9.4).

- **A finding can be taken to.** A finding that names an object — an instance, a label, a port —
  carries a **show** button. Pressing it switches to the drawing that holds the object and selects
  it there, so the reviewer does not have to hunt for it on the sheet. The way there is the identity
  index the app already had: the finding names a place in a file, and the index says which object
  sits at that place and where else it appears
  ([ADR-0048](../adr/09-view/0048-the-review-app-shows-drawings.md) D5).
- **The measurements are the core's own.** The app measures nothing itself: it reports what
  `packages/core`'s measurement says, and a page that cannot be measured shows no numbers rather
  than a wrong one.

## What is not built

- **No live routing.** An explicit schematic move keeps the existing wire geometry in the local
  preview; it never searches for a new path or routes around a symbol. `Apply` reports stale or
  conflicting wiring for the CLI/agent workflow instead of repairing it in the browser.
- **PCB editing.** The PCB canvas is read-only: moving a part on a physical PCB, routing copper,
  editing the stackup belong to the agent-driven layout loop
  ([ADR-0017](../adr/05-pcb/0017-layout-and-routing-are-agent-driven.md)), not to the review app.
- **A write from the static report.** `--out` has no server, so nothing can be applied or saved.
- **Note anchors** (`[instance:M1.U1]` prefixes), which are an open point of
  [ADR-0037](../adr/09-view/0037-review-records-and-attribution.md).

## When it looks wrong

- **No schematic drawing** — the project is missing a usable `design/sch/main.teda` or has no
  project print page at `views/<page_id>.view.teda`. Point the command at the project root, not at
  `design/`.
- `Apply` or `Save` disabled — either the current host capability does not permit that action, or the
  document was written by `--out`. The button's title says which.
- A page marked as a problem — its file failed to parse or the cross-check refused it; the status
  line carries the parse messages.
- "not compiled" instead of a build hash — the project has an error somewhere, so `texteda ir` wrote
  no shard tree and there is no build to name. Run `texteda check`.
