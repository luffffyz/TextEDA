# Rendering targets — the drawing commands, SVG, and PNG

> What a drawing is, which backends write it, and what a picture may and may not be used for.

## 0. Position and authority

This file owns the **rendering targets**: the drawing commands the renderer produces, the two
backends that write them, and the rules for what a picture is for.

It owns nothing else:

- the geometry of a description type lives in [`symbol.md`](symbol.md), [`footprint.md`](footprint.md)
  and [`schematic-view.md`](schematic-view.md);
- the round-trip rules live in [`schematic-view.md`](schematic-view.md) §9.5 and
  [ADR-0036](../docs/adr/09-view/0036-our-own-reference-renderer.md);
- the decision to write our own rasterizer lives in
  [ADR-0072](../docs/adr/09-view/0072-a-second-rendering-backend-paints-the-same-drawing.md).

## 1. The drawing commands

The renderer turns IR into **drawing commands** — a list of `line` / `rect` / `circle` / `arc` /
`poly` / `polyline` / `text` / `pin` / `pad` items with integer nanometres, not a string. That list
is the interface; the backends are interchangeable readings of it.

Consequences that hold for every backend:

- **The renderer only reads.** A backend adds, moves or drops nothing (invariant 3).
- **One drawing, one truth.** Two backends of the same drawing show the same thing: same geometry,
  same colours, same draw order. A picture and the vector drawing of one page cannot disagree.
- **Coordinates stay in nanometres.** A backend converts to its own units on the way out; it never
  rounds a coordinate in the drawing itself (invariant 18).

## 2. The backends

### 2.1 SVG

The **kept artifact**. Vector, diffable, openable in any browser, and the form a review or an
archive keeps. `texteda view render` writes it; `bun run preview` writes it.

### 2.2 PNG

The **picture**: the same drawing commands painted into pixels, written as an ordinary 8-bit
truecolour PNG.

- It is written by **our own** rasterizer and **our own** PNG encoder
  ([ADR-0072](../docs/adr/09-view/0072-a-second-rendering-backend-paints-the-same-drawing.md)).
  Nothing outside this repository is needed to produce one: no browser, no native rasterizer, no
  image library, no MCP server (invariant 20).
- The rasterizer knows **only our drawing commands**. It is not an SVG renderer: it does not read
  SVG files, does not do transforms, gradients, clipping or opacity, and does not lay out text
  (text is drawn as the same stroke paths the SVG backend draws).
- The text is the bundled Hershey stroke font, the same one the SVG backend uses
  ([ADR-0036](../docs/adr/09-view/0036-our-own-reference-renderer.md) decision 4), so a picture
  shows the same glyphs the SVG does. The font is ASCII only.
- Strokes are quantised to whole pixels, fills are drawn with the even-odd rule, and a stroke
  round cap is a disc — the same rule the SVG backend's `stroke-linecap="round"` produces. A
  picture is therefore an **approximation** of the drawing, at the resolution it was painted.

### 2.3 Commands

| Command | What it writes |
|---|---|
| `texteda view render <project> <page_id> [--out <file>]` | The page's drawing as an SVG file. |
| `texteda view png <project> <page_id> [--out <file>] [--width <px>] [--crop <x0,y0,x1,y1 in mm>]` | The page's drawing as a PNG file. |
| `bun run preview symbol\|footprint\|component <id> [--png]` | The library drawing as an SVG file, and with `--png` the same drawing as a PNG file. |

`--width` is the picture's width in pixels; the height follows the drawn area's aspect ratio.
`--crop` is the part of the page to paint, in millimetres from the page's own origin.

## 3. What a picture is not

A picture is **for looking at**. It is not a measurement, and nothing may be concluded from it that
the numbers do not already say:

- **Not a measurement.** "How far is this label from its net?" is answered by
  [`schematic-view.md`](schematic-view.md) §9.4 (`view metrics`), never by counting pixels.
- **Not connectivity.** A picture shows what was drawn; the net set is the schematic's
  (invariant 2). Nothing may be inferred about a net from a picture (invariant 4).
- **Not round-trip evidence.** The round-trip compares the drawing commands with the IR; a picture
  is one step further away and takes part in none of it
  ([`schematic-view.md`](schematic-view.md) §9.5).
- **Not a gate.** No check, no threshold and no CI job reads a picture.

The loop it belongs to is the one the view layer already has: **write → `check` (is it right?) →
`view metrics` (how far off?) → change**. The picture is what the *person* looks at, and what an
agent with a vision model looks at, when it needs to see the drawing rather than read it.

## 4. Determinism

The same drawing always produces the same picture, byte for byte (invariant 18): no timestamps, no
randomness, no font lookup, nothing that depends on the machine. Two runs on two machines produce
the same file.
