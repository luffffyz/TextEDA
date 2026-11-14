# ADR-0072: A Second Rendering Backend Paints the Same Drawing

Status: Accepted
Date: 2026-11-13
Scope: Decides: that the reference renderer gets a second backend that paints the same drawing commands into a PNG, that both the rasterizer and the PNG encoder are ours rather than a dependency, and that a picture is for looking at, not for measuring. Does not decide: the drawing's geometry and the round-trip rules — see ADR-0036; nor what the review app shows — see ADR-0056.
Related: [ADR-0036](0036-our-own-reference-renderer.md), [ADR-0035](0035-the-view-layer-is-a-drawing.md), [ADR-0021](../06-manufacturing/0021-the-manufacturing-output-path.md)
Impact: `packages/renderer/src/raster.ts`; `packages/renderer/src/png.ts`; `packages/cli/src/view.ts`; `scripts/preview.ts`; `spec/rendering.md`; `AGENTS.md` §8

## Background

[ADR-0036](0036-our-own-reference-renderer.md) built the reference renderer as **IR → drawing
commands → SVG**, and it named the reason for the intermediate list: "only then can we write
assertions, do round-trips, and later attach other backends". The SVG is the artifact we keep, but
it is not the only thing a reader may want.

The question came from the design loop. An agent draws a symbol or a print page and has to **look**
at it: a pin on the wrong side, a body that does not meet its pin tails, an arrow tip that reads as
a blob, two labels on top of each other. The project's answer so far has been numbers —
`view metrics` and the `view.*` diagnostics — and that answer stays: numbers are what a machine can
compare, and they are what the checks use.

But some things are visual by nature. "Move that small triangle a bit up and to the right" is a
visual instruction, and it has to be carried by a picture. A character grid — the obvious
text-only answer — cannot carry it: it is unreadable, and a cell has no usable coordinate, so
neither a person nor an agent can act on what it shows.

The picture has to come from somewhere, and the options were:

1. **The agent's own tools.** The host may offer a rasterizer (an SVG-rendering MCP server, a
   browser, an image tool). That works on the machine it is installed on, and it works today. It
   does not work on the next machine, it is not part of the project, and a command in this project
   that needs it would make the command local rather than shipped.
2. **A dependency.** `@resvg/resvg-js` is a complete, correct rasterizer in one package. It also
   brings platform-specific native binaries into a package whose whole point is that it runs
   anywhere ([ADR-0038](../10-process/0038-implementation-stack-and-agent-entry.md) decision 1).
3. **Our own rasterizer over our own drawing commands.** The renderer already knows the geometry:
   it emits lines, polygons, circles, arcs and text strokes. Painting those into pixels is a
   bounded piece of work, and the drawing commands are a much smaller language than SVG.

## Decision

1. **The drawing commands are the interface.** A backend is a reading of the list the renderer
   produced. The SVG backend and the PNG backend read the same list, so the picture and the vector
   drawing of one page show the same geometry in the same colours in the same draw order.
2. **The rasterizer is ours**, and it knows only our own drawing commands. It is not an SVG
   renderer: it does not read SVG files, and it does not do transforms, gradients, clipping or
   opacity. It paints lines, rectangles, circles, arcs, polygons, polylines, text strokes, pins and
   pads — with a round cap as a disc and a fill with the **even-odd** rule. The round cap is what
   the SVG backend's own `stroke-linecap="round"` produces. The fill rule is **not** the same as
   the SVG's: the SVG backend writes no `fill-rule` attribute, so an SVG polygon is filled by the
   default **nonzero** rule. For a polygon that does not cross itself the two rules agree; for one
   that does, the picture and the vector drawing disagree about what is inside. Making them agree
   is open work (`docs/backlog.md`).
3. **The PNG encoder is ours too.** The renderer package has to run in a browser and in a Node host
   ([ADR-0038](../10-process/0038-implementation-stack-and-agent-entry.md) decision 1), so
   `node:zlib` is not available to it: the deflate stream, the Adler-32, the CRC-32 and the PNG
   chunks are written in TypeScript. The output is an ordinary 8-bit truecolour PNG with one IDAT
   chunk, and the test suite checks the stream against Node's own inflate — a mistake in the
   encoder cannot pass unnoticed.
4. **Text is the same text.** The bundled Hershey stroke font draws the glyphs, in both backends
   ([ADR-0036](0036-our-own-reference-renderer.md) decision 4). The picture shows the same glyphs
   the SVG does, and the font's ASCII-only limit is the same limit.
5. **A picture is for looking at.** It is not a measurement, not connectivity, not round-trip
   evidence and not a gate. The rules are in `spec/rendering.md` §3; the short version is that the
   numbers stay with `view metrics` and the diagnostics, and the picture answers "what does this
   look like".
6. **The commands.** `texteda view png <project> <page_id>` paints a print page; `--width` sets
   the picture's width in pixels and `--crop x0,y0,x1,y1` (millimetres) paints a part of the page.
   `bun run preview … --png` writes the same drawing of a library asset as a PNG next to its SVG.
7. **Deterministic.** The same drawing always produces the same bytes: no timestamps, no
   randomness, no font lookup (invariant 18).

## Consequences

- **Benefit**: looking at a drawing no longer depends on anything that is not in the repository.
  `texteda view png` and `preview --png` work on a fresh checkout, in a container, in CI, on every
  machine — which is what "the design loop does not hang off KiCad"
  ([ADR-0036](0036-our-own-reference-renderer.md) decision 7) asks for, extended from SVG to pixels.
- **Benefit**: the agent that drives the loop can *see* the drawing it just produced, in the same
  session, without installing anything. A visual instruction ("move that triangle up and to the
  right") becomes actionable.
- **Cost**: two more things to keep honest — a rasterizer and an encoder. The rasterizer is a
  restricted one, and that restriction is the price: it only knows our drawing commands, so it can
  never become a general SVG renderer, and a picture of a foreign SVG is out of reach by design.
- **Cost**: our rasterizer is an approximation — strokes are quantised to whole pixels, and text is
  drawn as strokes. A picture is therefore *not* evidence: every rule that says "do not conclude
  this from a picture" stays in force.
- **Not decided here**: whether the review app or any other host should offer a picture surface.
  The app's interaction surface is [ADR-0056](0056-the-review-app-has-one-interaction-surface.md)'s
  business, and this record does not touch it.
- **Not decided here**: whether a picture ever becomes an artifact worth keeping in the repository.
  Today it is written where the caller asks for it (`dist/view/`, `/tmp/texteda-preview/`), and it
  does not enter the project hash.
