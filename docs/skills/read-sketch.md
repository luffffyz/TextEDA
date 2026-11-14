# Skill: Turn a Reviewer's Sketch into a Source Edit

> **Audience**: agents handed a sketch from the review app — a picture of a drawing with somebody's
> freehand mark on it — who have to make the change in the source.
> **Scope**: reading a saved sketch, deciding what it means, and changing the file it is about.
> **Not in scope**: drawing the sketch — that is the reviewer, in the review app
> ([`verify-review-app.md`](verify-review-app.md) has the browser procedure); changing a print
> page's geometry — that is [`draw-print-page.md`](draw-print-page.md).
> **Status**: the commands and expected outputs below were run on
> `examples/reference-project` on 2026-11-14.

This file is English on purpose: a skill is an operating manual for an agent, not a design
document (see `AGENTS.md` §12).

Index: [`docs/skills/README.md`](README.md) lists the procedures and when to read which.

## 0. What this skill is for

A reviewer draws on a drawing and hands over a path. The path is a **pair**: the picture
(`…-1.png`) and, beside it, the ink's own millimetres (`…-1.json`). The picture is for your eyes
and the numbers are for your hands.

The ink says *where*; you decide *what*
([ADR-0073](../adr/09-view/0073-the-review-app-has-a-freehand-pen.md) D2). A stroke that says
"the edge should be here" is a request to move that edge — not an instruction to move it two
millimetres, and not an instruction to change it at all if the drawing disagrees with the request.

**Do not measure the picture.** The numbers are already there, in the drawing's own millimetres.
Decoding a PNG to find out where the reviewer pointed is the one thing this pair exists to make
unnecessary.

## 1. Read the numbers

```sh
cat /tmp/texteda-sketches/indicators-led-1.json
```

```json
{
  "drawing": "symbol/indicators:led",
  "kind": "symbol",
  "label": "led",
  "space": "source-millimetres",
  "strokes": [
    { "points": [[-1.792, -1.619], [1.438, 0.631]] }
  ],
  "source_hash": "b98ffa1421a3dd64bf7fd837245798a42d0a693906c5893a518e296711f081c6",
  "tool_version": "0.1.0",
  "saved_at": "2026-11-14T13:01:32.645Z"
}
```

| Field | What it tells you |
|---|---|
| `drawing` | which drawing the ink is on, by the model's key (`symbol/<class>:<id>`) |
| `space` | the ink is in **the drawing's own source frame**, in millimetres: x to the right, y **up** for a symbol (the KiCad convention), y **down** for a footprint or a print page |
| `strokes` | the ink: one stroke is one list of points, `[x, y]`, rounded to the micrometre |
| `source_hash` | the build the reviewer was looking at; if the design has moved on, the request may be stale |
| `saved_at` | when the reviewer drew it |

The frame is the point: the numbers are the ones the drawing's **source file** uses, so they drop
straight into it. A symbol's `body` row and the ink share one frame — compare them directly.

Look at the picture too — the numbers say where the pen went, not what the reviewer meant:

```sh
ls /tmp/texteda-sketches/          # the pair
```

## 2. Find the file the ink is about

The drawing's key names the file:

| The key | The file |
|---|---|
| `symbol/<class>:<id>` | `assets/symbols/<class>/<id>.teda` |
| `footprint/<class>:<id>` | `assets/footprints/<class>/<id>.teda` |

Read it before you change anything: the source is the truth, and the sketch is a note about it.

## 3. Decide what the ink means, and change it

Compare the ink against the source's own geometry. For a symbol, the geometry is the `body` rows'
coordinates — the same frame the ink is in, so the two can be read side by side.

Rules that decide the answer:

- **The ink is freehand; the source is exact.** Take the ink's *direction and intent* and express
  it in the source's own numbers. A stroke that ends 0.05 mm off a lattice point does not mean
  "0.05 mm"; it means "there".
- **The lattice is the source's rule, not the sketch's.** A visible rectangular body's edges sit on
  the `0.5 mm` lattice; decorative shapes keep their coordinates
  ([ADR-0057](../adr/08-libraries/0057-symbol-pins-sit-on-a-half-millimetre-lattice.md) D3).
  Round to the rule, not to the stroke.
- **Keep the shape.** Lengthening a bar keeps its radius and its ends; "sharper" on a triangle
  moves the vertex. Change what the ink points at, and nothing else.
- **The footprint is a separate description.** A sketch of a symbol is about the symbol's drawing.

Worked example — the ink says "the bar's rounded end should be here":

```json
{ "points": [[2.72, 3.27], [3.7, 2.45], [2.72, 1.63]] }
```

The rightmost point is `x = 3.7`, at the bar's mid-height (`y = 2.45` is the bar's centre), and
the stroke's ends sit at the bar's own top and bottom (`3.27` and `1.63`). So the reviewer drew the
bar's **rounded end further right**. The source says the cap is a circle of radius `0.75` centred
on the bar's right edge, and the lattice says that edge sits on `0.5 mm`. So the edge moves to
`3.7 - 0.75 = 2.95`, which the lattice rounds to `3.0` — and both the rectangle and the cap move
together:

```
-  circle  [2,2.5,0.75]         fill=outline
+  circle  [3,2.5,0.75]         fill=outline
-  rect    [-2.5,1.75,2,3.25]   fill=outline
+  rect    [-2.5,1.75,3,3.25]   fill=outline
```

Two numbers, no measuring.

Change the file, and nothing else. The sketch is a message; it does not go into the project.

## 4. Look at the result

```sh
bun run preview symbol <id> --class <class> --png --out /tmp/preview-<id>
```

Read the PNG with the image tool. The drawing should now look the way the reviewer drew, and the
rest of it should look exactly as it did.

To see the reviewer's ink on your new drawing, overlay it: the ink's points are in the drawing's
own millimetres, so the same transformation that places the drawing places the ink.

## 5. Run the gates

```sh
bun run fmt:teda --check .          # the source stayed canonical
bun run lib:verify                   # the symbol still passes the library's own rules
bun run test                         # the whole suite
```

The symbol shard is **normative**: changing a symbol changes the project's hash, and that is the
point of a deliberate source change. A fixture that pins the old hash is a fixture to update, not
a failure to argue with.

## 6. What not to do

- Do not measure the picture. Read the numbers beside it.
- Do not put the sketch in the repository. It is a note, not a record.
- Do not edit the ink into the source as a comment, a note, or a new field. The reviewer's mark is
  not a design fact and does not belong in the design.
- Do not decide *what* to change from the picture alone. The ink says where; the design says what
  is there now.

## 7. References

- [ADR-0073](../adr/09-view/0073-the-review-app-has-a-freehand-pen.md): the pen, and a sketch as
  a message to the agent rather than a fact about the design; D2 the numbers beside the picture.
- [`docs/guides/review-app.md`](../guides/review-app.md): the app's bindings, and what the pen does.
- [`docs/skills/preview-symbols.md`](preview-symbols.md): how to render a symbol and tune its
  geometry.
- [`docs/skills/README.md`](README.md): the index of the procedures.
