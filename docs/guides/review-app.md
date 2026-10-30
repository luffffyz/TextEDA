# Reviewing a board in the browser

`texteda review` serves the review app: the project's print pages, drawn by the renderer, with
hover and click so a reviewer can ask "what is this, and what is it on" without leaving the drawing.
Decision: [ADR-0035](../adr/view/0035-the-view-layer-is-a-drawing.md) (D7 records the form
this first version takes) and [ADR-0042](../adr/view/0042-the-review-app-has-four-modes.md)
(the four modes, and what each may write).

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
`Save` buttons are disabled and say "this document cannot write". Its `Review` and `Placement`
modes are as complete as the served one; `Layout` and `Edit` show, but cannot write.

## What the page shows

| Column | What it is |
|---|---|
| left | The project and its build hash, the boards and their print pages, then the findings from `texteda check` (errors, then warnings, then notes). The first five show; "show all N" opens the rest. |
| middle | The mode bar (see below) over the drawing the mode shows, with a status line naming the source file, the size, and what the drawing is made of. |
| right | The facts about whatever is under the pointer or was selected: instance id, device, symbol, footprint, spec, source file, and the nets its pins land on with those pins listed. The selected identity also has a **definitions** button; `Enter` or a double-click opens it. |

## The four modes

The bar above the drawing switches what the canvas shows. One code path serves the drawing,
the hover and the selection in every mode; the mode decides which drawing it is and what a click
means ([ADR-0042](../adr/view/0042-the-review-app-has-four-modes.md) D1).

| Mode | Draws | A click | Can write |
|---|---|---|---|
| `Review` | the print page | selects a symbol, a label, a port or a net | nothing (invariant 3) |
| `Layout` | the print page, with the moves the user has made | drags the symbol under the pointer; `r` turns the selection; `Ctrl+Enter` applies, `Esc` drops | `views/<board_id>/<page_id>.view.teda` only |
| `Placement` | the board's physical canvas: outline, pads, copper, silkscreen (ADR-0042 D1) | lights the copper of the net under the pointer | nothing |
| `Edit` | the source text on the left, drawn as you type | puts the cursor on the row the clicked object came from | the same page file, in the formatter's form |

A mode the board cannot show is disabled with a title saying why: `Layout` and `Edit` need a print
page, `Placement` needs a `pcb` description.

### `Layout`

The print page is a drawing, so its edits are drawing edits: `place` rows and the wires and labels
that depend on them. `design/**`, the IR and the build hash are never touched (ADR-0042 D3).

- **Press and move a symbol** to drag it. The symbol snaps to 1.27 mm (the 0.05 inch pin pitch the
  symbols are drawn on); `r` turns it in 90-degree steps. The other modes keep drag as pan, so a
  move cannot happen by accident.
- **The wires are re-anchored, not re-routed** (ADR-0042 D5). A wire keeps its shape — the same
  number of segments in the same directions — and only the corners the shape pins down move with
  the pins. A wire that cannot keep its shape (both pins moved apart in different directions) is
  replaced by one elbow and reported in the status line; so is a label or a port that was left off
  its net and had to be put back on it.
- **Nothing is written until `Apply`.** The release of the drag asks the server what the page would
  look like (`/api/layout` with `commit: false`), which draws the re-anchored page and reports the
  conflicts. `Apply` (or `Ctrl+Enter`) is the commit; `Revert` (or `Esc`) drops the moves.
- **An unsaved edit survives the move.** If the editor holds text that was never saved, it rides
  along with the layout request and the write is *that* text with the moved rows applied — a drag
  never silently discards what was typed. Without an edit the file on disk is the base, as before
  ([ADR-0042](../adr/view/0042-the-review-app-has-four-modes.md) D6).
- **Routing is not live.** The drawing is not re-routed during the drag, and a move can introduce a
  readability finding (a wire through a symbol's body, a label off its net). `Apply` writes, the
  server re-checks, and the left column says what the move did. That report is the point: the app
  shows the consequence instead of hiding it.

### `Placement`

The board's own canvas, drawn from the `pcb` description and the footprints it places — the answer
to "where did this part land, and what copper is it on". It is read-only by design: the copper, the
zones and the spacing belong to the agent-driven layout loop, not to a browser
([ADR-0017](../adr/pcb/0017-layout-and-routing-are-agent-driven.md)). Clicking lights one net's
pads, tracks and vias, and the status line names it; a part's reference and value are printed only
where the board's `silk` section says so (spec/pcb.md §4.10), so the canvas shows what the board
will print. Here the click is resolved from the drawing's own objects, so what is picked is what
was drawn — a pad, a track, a via — and not an invisible box around it.

### `Edit`

The page's source with its drawing beside it. The browser cannot parse a `.teda` file, so the
server does: `/api/source` with `save: false` draws the draft and answers with the line each object
came from, and the same route with `save: true` writes it — in the formatter's form, and only if the
source parses. A draft that does not parse is reported and the last good drawing stays on the
sheet. Clicking a drawn object puts the cursor on its row: that is how a reviewer gets from a
drawing that looks wrong to the line that made it. The click is resolved from the object's box, not
from its ink, so a 0402 body — a 0.4 mm stroke — is as easy to hit as a QFP.

- **A board with no view file is listed, not drawn.** The reference project's `mcu-board` has a
  schematic and no print page; the app says so on the canvas and draws nothing (ADR-0035 decision 6).
  It does not invent a layout. What it does show is the board's instances as chips: the logic is
  there even when the drawing is not, and clicking a chip reports that instance's facts.
- **A page that cannot be drawn says why** and is marked in the board list.
- **`review` writes nothing back.** The app adds behaviour to the SVG it is given; the drawing is
  not regenerated, and there is no way to move a symbol from the `review` canvas (ADR-0035,
  AGENTS.md §2 invariant 3). The `layout` mode is the one exception: it writes `place`
  rows, never `design/**` ([ADR-0042](../adr/view/0042-the-review-app-has-four-modes.md) D3).

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
| `←` / `→` | Previous and next print page of the board. |

These bindings are the page modes'. `Layout` adds `r` (turn the selection), `Ctrl+Enter` (apply)
and `Esc` (drop the moves), and its drag moves the symbol instead of panning
([ADR-0042](../adr/view/0042-the-review-app-has-four-modes.md) D4). The source jump is an explicit
action in `Review` and `Layout`: double-click or press `Enter`; a single click only selects. In
`Edit` a single click is the jump, because the source is on screen and there is nothing to select.
The definitions come from the advisory
`dist/ir/identity.json` written by `texteda ir` ([ADR-0004](../adr/language/0004-source-spans.md),
2026-10-26 amendment), so the app never re-parses a file.

`vscode://file/...` is handled by whatever the user has bound to that URI scheme. A static
`--out` report embeds the build machine's absolute paths; it is useful where that project tree
exists and otherwise still shows the relative file and line.

The mark is a screen annotation: its stand-off (4 px plus half the drawing's typical 0.25 mm stroke)
and its stroke (1.25 px hovered, 1.75 px picked) are rewritten in sheet units on every zoom, so both
the outline and the gap to the drawn edge keep their size at any magnification. The half-stroke term
is not decoration: the boxes in the model are centreline boxes, and the drawing's ink grows outward
from them as you zoom in, so a fixed pixel stand-off would look tighter the closer you look. `vector-effect: non-scaling-stroke` would be the obvious way to do that and does not
work here — it compensates the SVG's own viewBox, not the CSS `scale()` on the canvas around it, and
a "1.5 px" stroke then paints 1.5 mm, which reads as a slug over small parts.

## What is not built

- **Live routing.** The `Layout` mode moves symbols and re-anchors the wires they are on; it never
  searches for a new path, and it does not route around a symbol the user moved onto a wire
  (ADR-0042 D5). A move that creates a finding is reported, not repaired.
- **Board editing.** `Placement` is read-only: moving a part on the board, routing copper, editing
  the stackup belong to the agent-driven layout loop
  ([ADR-0017](../adr/pcb/0017-layout-and-routing-are-agent-driven.md)), not to the review app.
- **A write from the static report.** `--out` has no server, so nothing can be applied or saved.
- **Note anchors** (`[instance:U3]` prefixes), which are an open point of
  [ADR-0037](../adr/view/0037-review-records-and-attribution.md).

## When it looks wrong

- `0 boards` — the project has no `design/sch/<board>.teda`; the model lists only boards that have a
  schematic. Point the command at the project root, not at `design/`.
- `Apply` or `Save` disabled — either the mode is not one that writes, or the document was written by
  `--out`. The button's title says which.
- A page marked as a problem — its file failed to parse or the cross-check refused it; the status
  line carries the parse messages.
- "not compiled" instead of a build hash — the project has an error somewhere, so `texteda ir` wrote
  no shard tree and there is no build to name. Run `texteda check`.
