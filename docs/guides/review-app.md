# Reviewing a board in the browser

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
2 boards, 141 diagnostics
```

It binds `127.0.0.1` only and answers three routes: `/` (the document) and two write routes, `POST
/api/layout` and `POST /api/source`. Ctrl-C stops it, and stopping it is a normal end (exit code 0),
not a failure. Everything the page needs — the model, the drawing, the script — is in that one
document, so `--out` writes byte-identical bytes to what the server sends. That file is the static
report for a pull request: no build step, no assets beside it.

A static `--out` document has no server behind it, so it has no write routes: the `Apply` and
`Save` buttons are disabled and say "this document cannot write". The same drawing, selection,
navigation, and read-only PCB behavior remain available.

## The three columns

| Column | What it is |
|---|---|
| left | The project and its build hash, the drawings grouped by kind (print pages, board canvases, library symbols, library footprints), what the current print page measures, then the findings from `texteda check` (errors, then warnings, then notes). The first five show; "show all N" opens the rest. A finding that names an object carries a **show** button: it takes the reviewer to that object on the drawing. |
| middle | The current drawing with explicit actions above it, a status line naming the source file, the size, and what the drawing is made of. |
| right | The facts about whatever is under the pointer or was selected: instance id, device, symbol, footprint, spec, source file, and the nets its pins land on with those pins listed. The selected identity also has a **definitions** button; `Enter` or a double-click opens it. |

## What the app shows

The app shows **drawings**, and there are four kinds of them
([ADR-0048](../adr/09-view/0048-the-review-app-shows-drawings.md) D1):

| Kind | What it is | Where it comes from |
|---|---|---|
| print page | the page a reviewer reads: the symbols, the wires, the labels and the ports | `views/<board_id>/<page_id>.view.teda` |
| board canvas | the board as it is placed: outline, pads, copper, silkscreen | `design/pcb/<board_id>.teda` |
| symbol | one symbol of the project, drawn with the pins of a device that uses it (ADR-0031) | `assets/symbols/<category>/<id>.teda` |
| footprint | one footprint of the project: its pads and its graphics | `assets/footprints/<family>/<id>.teda` |

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

- **A board with no print page is listed, not drawn.** The reference project's `mcu-board` has a
  schematic and no print page; the app says so on the canvas and draws nothing (ADR-0035 decision 6).
  It does not invent a layout. What it does show is the board's instances as chips: the logic is
  there even when the drawing is not, and clicking a chip reports that instance's facts.
- **A drawing that cannot be drawn says why** and is marked in the list.

### The board canvas

The board's own canvas, drawn from the `pcb` description and the footprints it places — the answer
to "where did this part land, and what copper is it on". It is read-only by design: the copper, the
zones and the spacing belong to the agent-driven layout loop, not to a browser
([ADR-0017](../adr/05-pcb/0017-layout-and-routing-are-agent-driven.md)). Clicking lights one net's
pads, tracks and vias, and the status line names it; a part's reference and value are printed only
where the board's `silk` section says so (spec/pcb.md §4.10), so the canvas shows what the board
will print. Here the click is resolved from the drawing's own objects, so what is picked is what
was drawn — a pad, a track, a via — and not an invisible box around it.

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
- **Left-click completes the local move preview.** The result remains pending until `Apply` or
  `Ctrl+Enter` sends a commit to `POST /api/layout`.
- **`Escape` during a move cancels that transaction only.** It restores the symbol or field's
  original placement and preserves unrelated pending edits. It does not commit anything.
- **`r` queues a clockwise 90-degree rotation** for the selected schematic symbol. Rotation is a
  pending view edit. The click or `Escape` after rotation clears the selection but does not undo the
  queued rotation.
- **`Apply` / `Ctrl+Enter` is the commit point.** Placement, rotation and permitted field changes
  are written together through the CLI. A full-capability standalone surface may also use the
  explicit **Source** action to preview and save source text; source editing is never entered by a
  drawing click.

The browser never writes files. The server owns canonical parsing and writing, and these actions
write only `views/<board_id>/<page_id>.view.teda`; they do not write `design/**`, IR shards, project
hashes or build hashes. The standalone server's full capability accepts fields and source. The DSH
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
| `Enter` or double-click the selection | Opens the definitions menu: the board/module row, print-page placement, PCB placement, component, symbol, footprint and pin rows for an instance; the board net row and every view wire/label for a net. Choosing a row opens `vscode://file/<absolute path>:<line>:<col>`. |
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
- **Board editing.** The board canvas is read-only: moving a part on the board, routing copper,
  editing the stackup belong to the agent-driven layout loop
  ([ADR-0017](../adr/05-pcb/0017-layout-and-routing-are-agent-driven.md)), not to the review app.
- **A write from the static report.** `--out` has no server, so nothing can be applied or saved.
- **Note anchors** (`[instance:U3]` prefixes), which are an open point of
  [ADR-0037](../adr/09-view/0037-review-records-and-attribution.md).

## When it looks wrong

- `0 boards` — the project has no `design/sch/<board>.teda`; the model lists only boards that have a
  schematic. Point the command at the project root, not at `design/`.
- `Apply` or `Save` disabled — either the current host capability does not permit that action, or the
  document was written by `--out`. The button's title says which.
- A page marked as a problem — its file failed to parse or the cross-check refused it; the status
  line carries the parse messages.
- "not compiled" instead of a build hash — the project has an error somewhere, so `texteda ir` wrote
  no shard tree and there is no build to name. Run `texteda check`.
