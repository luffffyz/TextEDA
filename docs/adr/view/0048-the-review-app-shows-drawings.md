# ADR-0048: The Review App Shows Drawings, Not Boards

Status: Accepted
Date: 2026-10-30
Scope: Decides: that the review app shows drawings — a print page, a board's physical canvas, a library symbol, a library footprint — as four kinds of one thing; that the modes belong to the drawing (`review` everywhere, `layout` and `edit` on a print page) and that the `placement` mode is retired; that a finding names an object the app can select on the drawing; and that the app shows what a print page measures. Does not decide: what a print page is or how it is drawn — see ADR-0035 and ADR-0036; how PCB placement and copper routing are produced — see ADR-0017; what a review record says — see ADR-0037.
Related: [ADR-0042](0042-the-review-app-has-modes.md), [ADR-0043](0043-the-review-app-is-a-plugin-of-the-agent-workbench.md), [ADR-0049](../libraries/0049-assets-are-filed-by-what-they-are.md).
Impact: `packages/viewer/**`; `packages/cli` (the `review` command and its model); `plugins/dsh-texteda`; `docs/guides/review-app.md`; `docs/backlog.md` (F34)

## Context

The app was built around a board. The sidebar listed the boards, each board listed its print
pages, and the mode bar chose what the stage showed: the page in `review`, `layout` and `edit`,
the board's physical canvas in `placement`. The canvas of a board was reachable only by picking
the mode first, so "where did the agent put the parts?" was a mode away from "what does this
board look like on paper?".

Two things were wrong with that shape.

The first is that the board canvas was not a drawing like the others. It had its own mode, its own
renderer call, its own branch in the stage, its own empty-state message — four places to keep in
step for what is, in the end, the board description drawn. The second is that the app stopped at
the board's own files. A symbol is a drawing; a footprint is a drawing; the app could show
neither, so a reviewer who wanted to see what a symbol looked like had to leave the app and open
the file.

The app was also behind the drawing rules. The findings it listed named a place in a file, and the
numbers that make a finding fixable — how far a label sits from its net, how much of the sheet the
drawing takes — were not in the app at all. The reviewer was told *that* something was wrong and
had to hunt for *what* on the sheet.

## Decision

### D1. The app shows drawings, and the tree groups them by kind

A drawing is one of four kinds: a **print page** (`sch`), a board's **physical canvas** (`pcb`), a
library **symbol**, a library **footprint**. The model carries them all in one list, each with its
kind, its key, its label, its source file, its sheet, its ink and its problems. One shape, one
list, one code path: the stage draws a drawing, whatever kind it is.

The sidebar groups the drawings by kind — print pages, board canvases, symbols, footprints — and
lists a board that has no print page on its own, with the note that says why and the instances
that are still there to look at.

The kind blocks fold, and the two library kinds go one level further, by the classification
directory the file sits in ([ADR-0049](../libraries/0049-assets-are-filed-by-what-they-are.md)):
sixteen symbols under one heading is a list nobody browses, and the classes are the grouping the
project already has. That second level is **not** a fold the reviewer clicks — it opens under the
pointer, because the pointer is already there to pick a row, and two gestures to reach one row is
one too many. Either way the selection is never hidden: the kind fold opens for the drawing it holds,
and the class block holding the selected drawing stays open after the pointer leaves. What a leaf
row looks like matters for the same reason: the rows a reviewer picks are set apart from the
headings above them — their own type and a chip background — or a list of classes and a list of
drawings read as the same list. Indentation carries the other half of that: it marks what **opens**,
so a class heading is one step in from its kind and a drawing takes no step of its own, its name
lining up under the class name it is filed in. Indenting something that cannot be opened says
something untrue about it, and the third level of a 260px column leaves the names nowhere to go.

The board's own facts (its instances, its nets) stay where they were: on the board, not on the
drawing. A drawing shows; the board says.

### D2. The modes belong to the drawing

The mode bar offers what the current drawing can do:

| Drawing | Modes |
|---|---|
| a print page | `review`, `layout`, `edit` |
| a board canvas | `review` |
| a library symbol | `review` |
| a library footprint | `review` |

The modes still differ only in what a press means; the highlight-and-jump path is one
implementation (ADR-0042). What changed is the question the mode bar asks: not "what can this
board do?" but "what can this drawing do?".

### D3. `placement` is retired; the board canvas is read

`placement` was a mode whose canvas was the PCB. The PCB is a drawing now, so the mode has no
canvas of its own: reading the board's copper is what `review` does on a board canvas, and the
net highlight follows the pointer as it always did.

A host's capability may still name the modes it allows; the retired name is simply not a mode
any more, so a host that named it grants nothing by it (ADR-0043 D3).

### D4. The library's own assets are drawings

Every symbol and every footprint in the project's library is a drawing in the app. A symbol is
drawn with the pins of a device that uses it — the device names the pins, the symbol draws them
(ADR-0031) — so what a reviewer sees is what the board sees; a symbol no device uses is drawn
with unnamed pins.

A library drawing has no sheet of its own: the sheet is what the drawing occupies, plus the
renderer's margin, so the canvas is sized to the ink and no more.

### D5. A finding names an object the app can select

A finding names a place in a file. The identity index (ADR-0004 D6) says which object sits at that
place, and the same index says where else that object appears — so a finding on a board row leads
to the page that draws the instance, and a finding on a label leads to the label.

The app uses this: a finding that names an object can be taken to. The reviewer presses it and the
app switches to the drawing that holds the object and selects it there. A finding that names
nothing the app can show — a board-level fact, a file that is not on any sheet — stays a line of
text, because there is nothing to jump to.

The findings are still the checker's findings: the app does not measure, judge, or soften them.

### D6. The app shows what the page measures

The measurements of spec/schematic-view.md §9.4 — how much of the sheet the drawing takes, how
close its texts are, how much wire is drawn, where the wires cross — are in the model next to the
page that was measured, and the app shows them in the sidebar.

They are the other half of the signal the findings give. A finding says *that* a label is off its
net; the measurement says *how far* the drawing is from comfortable, which is what tells a
reviewer whether the next move is worth making.

The measurement is the core's own; the app only reports it. A page that cannot be measured has no
measurements, and the app says nothing rather than a wrong number.

## Consequences

- **The board's canvas is one drawing among others.** No mode to remember, no separate renderer
  branch, and the arrow keys walk the drawings of the same kind.
- **The library is visible in the app.** A symbol's shape, a footprint's pads: the things a
  reviewer asks about most often, and the things the app could not show at all.
- **A finding is a link.** The distance between "the label is 6.8 mm from its net" and the label
  on the sheet is one press.
- **The page's numbers are next to the page.** The reviewer sees how crowded the drawing is
  without leaving the app for `texteda view metrics`.
- **The host contract loses a mode.** A host that named `placement` grants nothing by it now; the
  capability list is `review`, `layout` and `edit` (ADR-0043 D3).
