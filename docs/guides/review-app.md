# Reviewing a board in the browser

`texteda review` serves the review app: the project's print pages, drawn by the renderer, with
hover and click so a reviewer can ask "what is this, and what is it on" without leaving the drawing.
Decision: [ADR-0021](../adr/0021-schematic-view-layer.md) (the 2026-10-24 appendix records the form
this first version takes; the 2026-10-25 appendix records the planned `layout` mode).

## Run it

```sh
bun run texteda review examples/reference-project            # serve on a free port
bun run texteda review examples/reference-project --port 4719
bun run texteda review examples/reference-project --out review.html
```

The server prints the URL it is listening on:

```
review reference-project at http://127.0.0.1:4719/
2 boards, 140 diagnostics
```

It binds `127.0.0.1` only and answers one route (`/`); Ctrl-C stops it, and stopping it is a
normal end (exit code 0), not a failure. Everything the page needs — the model, the
drawing, the script — is in that one document, so `--out` writes byte-identical bytes to what the
server sends. That file is the static report for a pull request: no build step, no assets beside it.

## What the page shows

| Column | What it is |
|---|---|
| left | The project and its build hash, the boards and their print pages, then the findings from `texteda check` (errors, then warnings, then notes). The first five show; "show all N" opens the rest. |
| middle | The page the renderer produced, with a status line naming the source file, the sheet size, and the symbol count. |
| right | The facts about whatever is under the pointer or was selected: instance id, device, symbol, footprint, spec, source file, and the nets its pins land on with those pins listed. The selected identity also has a **definitions** button; `Enter` or a double-click opens it. |

- **A board with no view file is listed, not drawn.** The reference project's `mcu-board` has a
  schematic and no print page; the app says so on the canvas and draws nothing (ADR-0021 decision 2).
  It does not invent a layout. What it does show is the board's instances as chips: the logic is
  there even when the drawing is not, and clicking a chip reports that instance's facts.
- **A page that cannot be drawn says why** and is marked in the board list.
- **`review` writes nothing back.** The app adds behaviour to the SVG it is given; the drawing is
  not regenerated, and there is no way to move a symbol from the `review` canvas (ADR-0021,
  AGENTS.md §2 invariant 3). The planned `layout` mode is the one exception: it writes `place`
  rows, never `design/**` (2026-10-25 appendix).

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

These bindings are `review`'s. The planned `layout` mode reuses click to select, drag to move the
selected symbol (not to pan), and a 90-degree rotate key; wires are not recomputed until `Apply`
(2026-10-25 appendix). The source jump is an explicit action in both modes: double-click or press
`Enter`; a single click only selects. The definitions come from the advisory
`dist/ir/identity.json` written by `texteda ir` ([ADR-0020](../adr/0020-source-spans.md),
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

- **`layout`, `placement` and `edit` modes** from ADR-0021 decision 5. `layout` is the S1
  placement surface: select, drag, 90-degree rotate, writes `place` only; routing is rerouted on
  `Apply`, never live (2026-10-25 appendix). This is S1 drawing work, not B0 copper routing: the
  agent-driven PCB layout/routing loop lives outside the review app
  ([ADR-0053](../adr/0053-layout-and-routing-are-agent-driven.md)).
- **Note anchors** (`[instance:U3]` prefixes), which are an open point of
  [ADR-0033](../adr/0033-review-records-and-attribution.md).

## When it looks wrong

- `0 boards` — the project has no `design/sch/<board>.teda`; the model lists only boards that have a
  schematic. Point the command at the project root, not at `design/`.
- A page marked as a problem — its file failed to parse or the cross-check refused it; the status
  line carries the parse messages.
- "not compiled" instead of a build hash — the project has an error somewhere, so `texteda ir` wrote
  no shard tree and there is no build to name. Run `texteda check`.
