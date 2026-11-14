# Skill: Repair a Print Page That Already Exists

> **Audience**: agents (humans can follow it too).
> **Scope**: diagnosing and repairing a drawing that already exists — a project print page
> `views/<page_id>.view.teda`, or a reusable module drawing
> `views/modules/<module_id>.module-view.teda`.
> **Not in scope**: drawing a page for the first time — that is
> [`draw-print-page.md`](draw-print-page.md).
> **Status**: the commands and expected outputs below were run on
> `examples/reference-project` on 2026-11-13.

This file is English on purpose: a skill is an operating manual for an agent, not a design
document (see `AGENTS.md` §12).

> **Reference project (2026-11-13):** the example is module-first. Its one print page is `main`,
> `views/main.view.teda`; that page places three module drawings and draws the two cross-PCB
> interconnects, and carries **no wires of its own**. The wiring lives in the module drawings:
> `views/modules/buck-5v.module-view.teda` is wired, `charger-power` and `mcu-board` are
> placement studies. Open a drawing in `texteda review` for the interaction route. The command
> examples below take a **print-page** id — `view render`, `view metrics` and `view png` name a
> page, not a module drawing; a module drawing is measured with the probe in §5.

Index: [`docs/skills/README.md`](README.md) lists the procedures and when to read which.

## 0. What this skill is for

A page exists and it is wrong. The findings are there: `view.*` warnings from `check`, a run that
wanders, a label that looks detached, a dot in the wrong place. This skill says how to **measure**
the page, how to find the geometry that caused the finding, and how to fix it without guessing.

The normative rules are not repeated here. They live in
[`spec/schematic-view.md`](../../spec/schematic-view.md) §5 and §9.2, and the code table is
`docs/error-codes.md`, generated from `packages/ir/src/diagnostics/codes.ts`.

## 1. The one rule about routing

**There is no router.** `wire` rows are hand-authored bends.

`texteda view rewire` re-derives only the coordinates the drawn shape already pins down: the same
segment count, the same direction sequence, the same interior corners. It never searches for a
path, it knows nothing about symbol bodies, pins, clearance or courtyards, and the same placement
always produces the same corners
([ADR-0042](../adr/09-view/0042-the-review-app-has-modes.md) D5, D6).

So "the lines do not meet" is almost always one of three things:

- a detour in the bends — the run is longer than the Manhattan minimum;
- a label parked off its net;
- two runs of different nets that look coincident but are not connected.

Asking for "the routing algorithm to be optimized" is asking for a router. Adding one needs an
ADR and collides with
[ADR-0017](../adr/05-pcb/0017-layout-and-routing-are-agent-driven.md).

### 1.1 Explicitly authorized full rewire

A full rewire replaces every `wire` row on this page. It is exceptional and requires explicit
authorization from the page owner; it is **not** the default response to a moved part, a stale
bend, or a warning. The default is to re-route only the affected nets and preserve the other
source rows. `texteda view rewire` is a local re-anchor operation, not a router: it keeps the
existing segment count and direction sequence and never chooses a path around bodies, pins, or
text.

When a full rewire is explicitly authorized, use this sequence:

1. **Snapshot the source.** Copy the complete drawing file (`views/<page_id>.view.teda` or
   `views/modules/<module_id>.module-view.teda`) to an immutable working snapshot before changing
   it. The snapshot must include the current places, labels, ports, fields, notes, and text, not
   just the wire rows. It is the rollback and the comparison point for the operation.
2. **Refresh the authorities.** Generate a fresh review payload for the current drawing and read
   pin points, symbol boxes, and text boxes from the renderer's current geometry. At the same time,
   load the project schematic root `design/sch/main.teda` with its modules expanded (`parseSchematic`
   with `loadModules`) and derive flattened project-level logical net membership from that IR. Do not
   infer membership from the old wires, a screenshot, or a stale coordinate table; the project root
   supplies membership and the renderer supplies coordinates.
3. **Remove only wires.** In the working drawing, delete every `wire` row and no other row. Keep the
   file version, placements, labels, ports, fields, notes, and other text exactly as they were. Do
   not regenerate the drawing or replace its non-wire drawing state.
4. **Rebuild from logic and geometry.** For each flattened net represented on this drawing, map its
   visible pin members (and any port) to the fresh renderer connection points. Write new
   orthogonal `wire` rows from those members, splitting multi-member nets into explicit branches.
   Each pin endpoint must be a member of the named net; route around body, pin-stroke, and text
   boxes; approach pins along their permitted axis; and put labels and ports on their own nets.
   Never use the deleted rows as a topology or bend template.
5. **Verify coverage and connectivity.** Make a net-by-net coverage table: every visible member
   pin must be an endpoint of at least one new row, every wire endpoint must belong to that logical
   net, and each intended port must be connected. Also verify that, for each drawn net, all of
   its visible member pins and intended ports lie in one single connected geometric graph
   through the new wire rows and their endpoint contacts. Endpoint membership and coverage alone are
   insufficient: the checker can accept disconnected wire subtrees that carry the same net, and
   matching net names alone do not prove geometric continuity. Before completion, perform an explicit
   visual/topology check by tracing every drawn net in the rendered drawing and confirming that each
   such graph is continuous from every visible member pin to every intended port. A drawing may
   intentionally omit a project-level net, but that exception must be local and understood; a
   project-wide `nets-not-drawn` count is not proof that the visible pins are covered.
6. **Inspect page-local diagnostics.** Run the project check in JSON mode, then filter it to this
   drawing and inspect its `view.*` findings. Resolve local wire, pin, body, label, port,
   and text findings before judging the result; do not let diagnostics from another drawing stand in
   for this one's evidence.
7. **Measure the page.** Run `view metrics` for this page and record wire count and length,
   crossings, through-body count, and text gaps. Use those numbers to compare the rebuilt drawing
   with the intended layout and with the snapshot, while remembering that a crossing between
   different nets is legal.
8. **Render and crop.** Render this page once, then paint a crop of it as in §4. Inspect the crop
   for pin-axis arrivals, body or artwork crossings, label and port placement, and junction dots;
   do not judge a whole-sheet render at its default scale.
9. **Canonicalise last.** Run the canonical TEDA formatter on the finished drawing and then its
   check form. The final diff should contain the authorized wire replacement plus formatter-owned
   canonical changes only; do not silently absorb unrelated placement or text edits.

### 1.2 Evaluate routes without a quality gate

Route evaluation is a comparison aid, not a router and not a universal quality gate. For competing
hand-authored routes, compare logical correctness and clearance first, then the Manhattan length,
unnecessary bends, crossings, text gaps, and the rendered crop's readability. Prefer a short,
simple route that keeps labels legible and leaves the pin axis clean, but explain a longer route
when it avoids a body, pin, or text obstacle. Use `view metrics` and the crop as evidence rather
than turning any one number into a pass/fail threshold. The formal diagnostics and verification
loop in §9 still apply; this guidance only helps choose among routes that are otherwise valid.

## 2. Get the real geometry first

Never infer a pin's position from the page's `place` row or from the symbol source. Ask the
renderer.

```sh
bun run texteda review examples/reference-project --out /tmp/review.html
```

The HTML embeds one JSON object after `window.__TEXTEDA_REVIEW__ = `. Read it as JSON — do not
scan for braces, and do not split it at the first `;` (a `;` can sit inside a string).

A quick way to read one drawing's numbers:

```sh
python3 - <<'PY'
import io, json
s = io.open('/tmp/review.html', encoding='utf-8').read()
marker = 'window.__TEXTEDA_REVIEW__ = '
payload, _ = json.JSONDecoder().raw_decode(s, s.index(marker) + len(marker))
for d in payload["drawings"]:
    if d.get("page") != "main":       # a print page; use d.get("module") for a module drawing
        continue
    for sym in d["symbols"]:
        b = sym["box"]
        pins = " ".join(f'{n}={v["x"]},{v["y"]}' for n, v in sorted(sym["pins"].items()))
        print(f'{sym["id"]:8} box {b["x"]}..{round(b["x"]+b["w"],2)} '
              f'y {b["y"]}..{round(b["y"]+b["h"],2)}  pins {pins}')
    break
PY
```

Output — the page's real geometry, in millimetres (the first rows of the composed page):

```text
M1.C1    box 41..43 y 40.5..43.5  pins 1=38,42 2=46,42
M1.C2    box 76..78 y 40.5..43.5  pins 1=73,42 2=81,42
M1.C3    box 111..113 y 40.5..43.5  pins 1=108,42 2=116,42
M1.C4    box 146..148 y 40.5..43.5  pins 1=143,42 2=151,42
M1.C5    box 181..183 y 40.5..43.5  pins 1=178,42 2=186,42
M1.C6    box 216..218 y 40.5..43.5  pins 1=213,42 2=221,42
```

That geometry is **authoritative**: it comes out of the same `schematicGeometry` the checker uses,
so a coordinate read from there is the coordinate the checker will measure against.

### 2.1 Two frames, and the one you need

The payload carries one entry per drawing, and each entry has **its own frame**:

| Entry | Key | Frame | Instance ids |
|---|---|---|---|
| print page | `page/main` | the sheet, after the module drawings are placed | `M2.C1` |
| module drawing | `module/buck-5v` | the drawing's own local bounds | `C1` |

Use the frame of the file you are about to write: a repair to
`views/modules/buck-5v.module-view.teda` is written in the module drawing's local coordinates,
never in the composed page's. The page's frame moves with every `module_place`.

To read a module drawing instead of a page, change the filter:

```sh
    if d.get("module") != "buck-5v": continue
```

Output — the module drawing's own geometry, in its local frame:

```text
C1       box 16..19 y 10.5..12.5  pins 1=17.5,7.5 2=17.5,15.5
C2       box 60..63 y 16..18  pins 1=61.5,21 2=61.5,13
C3       box 112..115.5 y 18.75..21.5  pins 1=113.5,16.5 2=113.5,24.5
C4       box 116.5..119.5 y 19.5..21.5  pins 1=118,16.5 2=118,24.5
D1       box 75..78 y 22..25  pins 1=76.5,19.5 2=76.5,27.5
L1       box 84..89 y 9.875..10.5  pins 1=82.5,10.5 2=90.5,10.5
```

**Do not copy coordinates out of a document into a page.** A drawing's geometry moves whenever a
part is re-placed, and a stale table of pin positions is worse than no table: it produces routes
that miss. Read the geometry at the time of the repair.

What each source is good for:

| Need | Source |
|---|---|
| Pin connection points, body boxes | `texteda review --out` → the drawing's `symbols` |
| Label / port / text ink boxes | the same payload's `texts` and `fields` |
| Where a wire actually goes | the rendered drawing (`view render`, §4) |
| What the checker thinks | `texteda check --json` |
| How long a run is, how many crossings | `texteda view metrics` |

## 3. Graph junctions are declared; perpendicular pin endpoints also get visual dots

A dot normally claims a drawing-graph connection, so it is **written**: a `junction` row gives a
drawing node a stable id and a sheet position, and `wire` rows name that id as an endpoint
([`spec/schematic-view.md`](../../spec/schematic-view.md) §5.1). The renderer also draws a visual
dot when a wire ends at a pin connection point with a final segment perpendicular to the pin stroke.
That pin dot does not create a junction graph node; the wire's pin endpoint identity and net remain
the connection source of truth.

The checker enforces the graph rules below; the renderer additionally draws the visual pin marker:

- A declared junction must be **used** by the wires of exactly one net, with a degree of 2 to 4 arms
  (`view.junction-isolated`, `view.junction-invalid-degree`, `view.endpoint-wrong-net`).
- A wire that **passes through** a declared junction of its own net without naming it reports
  `view.wire-gap`: the drawing would show a dot that wire does not belong to.
- Two runs of the same net that meet at a point **do not** get a dot just because they touch. If the
  drawing needs a dot there, declare a junction and make both rows end on it; if it must not look
  joined, leave the junction out and the crossing unmarked.

Where the arms of one net genuinely fork (three or more branches from one point), declare a junction
there and end every branch row on it. A plain two-arm corner is not a junction: it is a bend.

| Situation | What the source says | Dot |
|---|---|---|
| One wire ending on a pin with a perpendicular final segment | no junction row | yes — visual pin dot |
| One wire ending on a pin with a parallel final segment | no junction row | no |
| Two rows ending on one declared junction, third row also ending there | `junction` row + three endpoints | yes |
| Two rows of one net merely meeting at a point | no junction row | no — and adding no dot is correct, not a defect |
| A row passing through a declared junction of its net without naming it | junction row, row not an endpoint | `view.wire-gap` |
| A junction named by rows of two different nets | one junction, two nets | `view.endpoint-wrong-net` |

**Crossings between different nets are legal.** No dot means "not connected", and the drawing
says so by omission. `view.wire-crossing` is **deprecated** — it is never emitted, it is kept only
so old reports parse. Crossings show up as a number in `view metrics`, not as a diagnostic.

To audit graph dots on a rendered page, compare `data-ref="junction:*"` with the drawing's
`junction` rows. A perpendicular pin endpoint is a visual dot and has a `data-ref="pin-junction:*"`;
it is intentionally not counted against the `junction` rows. The rows live in the file that draws
them — the page's own `views/<page_id>.view.teda`, or the module drawing it places:

```sh
grep -o 'data-ref="junction:[^"]*"' /tmp/page.svg | wc -l
awk '/^junction/{p=1;next} /^[a-z_]+/{p=0} p&&NF' examples/reference-project/views/modules/buck-5v.module-view.teda | wc -l
```

On the reference project both counts are **7**: the composed page draws the seven junctions the
`buck-5v` module drawing declares, and no more. A `pin-junction:*` circle without a `junction` row
is expected when a wire ends perpendicularly on a pin (the reference page has **5** of those);
any other circle with no source rule is a renderer defect.

## 4. Look at it: crop, do not re-render

A whole-page render at the default scale is too small to judge. Crop the drawing instead of asking
for another render.

`texteda view png` paints a region of the page in millimetres — the zoom a dense area needs, with
no crop arithmetic to get wrong:

```sh
bun run texteda view render examples/reference-project main --out /tmp/page.svg
bun run texteda view png examples/reference-project main --crop 420,25,444,50 --width 900 --out /tmp/page-crop.png
```

```text
Wrote /tmp/page-crop.png (900×937 px, 34259 bytes)
```

**Where the window comes from.** The crop is in sheet millimetres, so take it from the geometry you
just read: take the boxes of the symbols you want to look at from the payload, union them, and pad
the union by a few millimetres. The example above is the union of the `M2.D1` and `M2.L1` boxes
(`425 29.875 439 45`), padded by 5 mm on every side. Crop windows of roughly 40–60 mm are the
useful size.

For the vector drawing, the same window is a `viewBox` on the SVG root — one viewBox unit is one
millimetre, so the crop's `x` / `y` are sheet coordinates:

```sh
python3 - <<'PY'
import re, io
s = io.open('/tmp/page.svg', encoding='utf-8').read()
crop = re.sub(r'viewBox="[^"]*"', 'viewBox="420 25 24 25"', s, count=1)   # x y w h, in mm
crop = re.sub(r'width="[^"]*" height="[^"]*"', 'width="960" height="1000"', crop, count=1)
io.open('/tmp/page-crop.svg', 'w', encoding='utf-8').write(crop)
PY
```

The root element's `viewBox` is the **whole sheet plus a 2 mm margin** (`-2 -2 598 424` for the
reference project's A2 page, whose sheet is `594.0 × 420.0 mm` — `view metrics` prints both), so
the crop's `x` / `y` are sheet coordinates in millimetres — the same frame the `place` and
`module_place` rows use, with the y axis flipped.

The SVG's y axis is **flipped** relative to the `.teda` source: the model's `+y` is up, the SVG's
is down. A source feature at `y = +2.0` appears at SVG `y = -2.0`.

What you see in a crop is the drawing **and** the sheet furniture: the A2 template's rules and
title block are drawn on the same canvas, so a grey rule may cross the artwork. A rule is not a
net.

## 5. Measure a run against its Manhattan minimum

"Wandering lines" is measurable. Walk the rendered primitives; for each `polyline` on the `wire`
layer, sum the segment lengths and compare with `|dx| + |dy|` between its first and last point:

- ratio ≈ 1 → the run is honest, leave it;
- ratio > ~1.5 → investigate a detour and rewrite the bend list when appropriate. This ratio is a
  review heuristic, not a route-quality gate; a route still needs the geometry, diagnostics, and
  visual review in §1.1.

A ratio above 1 is **not** a defect on its own: a run that climbs over a part's body to reach a pin
on the far side is doing exactly what it should. Ask what the run is going around before you
shorten it.

The same walk yields the `junction` layer's `circle` primitives with their nets — that is where
the reader believes the connections are.

The prerequisites are the same ones the review app uses: the project schematic root
`design/sch/main.teda` compiled with its modules, the instances built from the symbol library, and
the module drawings the page places. A module drawing is drawn on **its own bounds** with the
**module's own** instances (`C1`, not `M2.C1`), so measure it there — those are the coordinates the
fix is written in.

Run the probe **from the repository root** — a probe started in a temporary directory cannot resolve
`@texteda/parser` (§11).

```ts
import { parseSchematic, parseView } from "@texteda/parser";
import { renderModuleDrawing } from "@texteda/renderer";
import { loadComponents, loadModules, loadSchematic, loadViews } from "./packages/cli/src/project.ts";
import { loadSymbolLibrary, schematicInstances } from "./packages/cli/src/symbols.ts";
import { loadPageComposition } from "./packages/cli/src/page-composition.ts";

const root = "examples/reference-project";
const { resolver, shards } = loadComponents(root);
const symbols = loadSymbolLibrary(root);
const loaded = loadSchematic(root)!;
const source = loadViews(root).find((view) => view.pageId === "main")!;
const view = parseView(source.text, { file: source.file }).ir!;
const schematic = parseSchematic(loaded.text, {
  file: loaded.file, components: resolver, modules: loadModules(root),
}).ir!;
const composition = loadPageComposition(root, view, symbols, { resolver, shards });
const instances = schematicInstances(
  schematic,
  (id) => resolver.resolve(id)?.pins ?? [],
  (id) => shards.find((shard) => shard.id === id)?.ir.component.symbol,
  symbols,
);

const drawing = composition.composition.drawings.get("buck-5v")!;
const local = composition.composition.moduleInstances.get("buck-5v")!;
const doc = renderModuleDrawing(drawing, local);

const mm = (nm: number): string => (nm / 1e6).toFixed(1);
for (const p of doc.primitives) {
  if (p.kind !== "polyline" || p.layer !== "wire") continue;
  const pts = p.points;
  let drawn = 0;
  for (let i = 1; i < pts.length; i++) drawn += Math.hypot(pts[i]!.x - pts[i-1]!.x, pts[i]!.y - pts[i-1]!.y);
  const a = pts[0]!, b = pts[pts.length - 1]!;
  const min = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
  const ratio = min > 0 ? drawn / min : 0;
  const redundant = pts.some((q, i) => i >= 2 && q.x === pts[i-1]!.x && q.y === pts[i-1]!.y);
  const points = pts.map((q) => `${mm(q.x)},${mm(q.y)}`).join(" ");
  console.log(`${ratio > 1.5 ? "DETOUR" : "      "} ratio ${ratio.toFixed(2)} ${points}${redundant ? "  REDUNDANT" : ""}`);
}
```

Output on the reference project — the wired module drawing has **24** runs:

```text
       ratio 1.00 61.5,21.0 61.5,23.5 55.0,23.5
       ratio 1.00 17.5,15.5 17.5,36.5
       ratio 1.00 113.5,24.5 113.5,36.5
       ...
       ratio 1.22 17.5,7.5 17.5,4.5 40.0,4.5 40.0,12.5
       ...
```

Every run but one is honest (ratio 1.00). The one at 1.22 is the `SYS` run from `C1.1` to `U1.7`:
it climbs over the top of the converter to reach a pin on the far side, so the length is earned.
No run repeats a vertex — the redundant-vertex case is detected by the `REDUNDANT` marker, and the
reference project has none today.

The primitives carry **nanometres**, so divide by `1e6` for millimetres. `p.layer` is the string
`"wire"`; the layer is on every primitive, and `p.kind` is `"polyline"` for a run.

To measure the composed page instead of the module drawing, swap the last two lines for
`renderComposedPage(composition.view, instances, composition.composition)` — same numbers, in the
page's frame.

Then: replace the over-long run's bends with the minimal elbow — **one** corner when the two pins
share neither coordinate, **two** when the path must clear a body or a text. Keep the drawing
canonical: write the coordinates on the grid the file already uses, then confirm the formatter is
a fixed point.

After moving a run, **re-seat the net's `label` row onto the new polyline**. A label left on the
old stroke raises `view.label-not-on-net`; a label left in mid-air on the new one raises
`view.text-on-wire`.

## 6. The traps that cost iterations

These are the recurring ones on a page that is already wrong.

- **A pin in the middle of a run is not a junction.** A `wire` row whose `to_pin` is another pin of
  the same net cannot pass through an intermediate pin's connection point: that reads as an
  undeclared join. Use two rows (`A → mid`, `mid → B`). The checker tests both the connection
  point and the drawn pin stroke, and the stroke test is **not** exempt at the wire's own
  endpoint — a run that ends at a pin still has to arrive along the pin's axis.
- **A port's glyph is a text box, not a point.** `port` rows carry a position and a rotation
  (180 = the tag sits to the left), but the drawn tag occupies a box to one side of that position.
  A bus drawn straight under a port tag yields `view.text-on-wire` even though the bus misses the
  tag's tip. Read the tag's box from the review payload's `texts` and route around it.
- **A symbol's `Reference` / `Value` fields are obstacles too.** They come from the **symbol**
  (`field Reference at=` in the symbol source), not from the page, and they count as text. The
  renderer places a page's automatic fields together, so a field whose place is taken steps aside
  by itself: a vertical drop through a part's value field is `view.text-on-wire` only when that
  field was placed by hand (a `field` row) or when the page has no room left. Route around the box,
  or move the row ([`draw-print-page.md`](draw-print-page.md) §4.2).
- **Labels draw their text to the right of the anchor**; ports draw theirs on the `rot` side. Keep
  other text, including a port's glyph, clear of that box — the port glyph counts in the same
  `text min gap` number as everything else.
- **A label must land on its own net.** Moving a label to dodge an overlap easily produces
  `view.label-not-on-net`; only label / port / text coordinates are free text, and each one has to
  sit on a wire of its net or on a pin of it.
- **Approach a left-side pin from the left.** A run leaving a pin on the body's left edge toward the
  right crosses the body. Go left first, then up or down, then across.
- **The checker does not see pin-graphic crossings.** It tests a wire against a pin's connection
  point and its drawn stroke, but a wire crossing a *part's artwork* is only visible in the
  render. Eyeball the crop (§4).

## 7. When the page cannot be routed: move a part

A crossing is a **placement** problem, not a typo to fix. Before moving a wire, enumerate the
pin's exits:

1. List every obstruction the exit must clear: the part's body box, neighbouring drops to the
   bus, other nets' columns, and the symbol's field boxes.
2. If **every** exit is blocked, the page is non-planar. Move a **part**, not the wire.

Moves that work in practice: shift the input capacitor off the pin's left exit; invert a
divider (`rot 270` on both resistors) so the ground leaves the top pin and the feed enters the
bottom pin.

Re-check after **every single edit**: each reroute usually creates one new `view.text-on-wire` or
crossing somewhere else.

## 8. Finding the tightest text pair

`view metrics` reports the **minimum** gap, not which pair produced it. To name the pair, walk
the geometry's text boxes yourself and sort the pairwise distances ascending:

- `schematicGeometry(view.ir, instances)` from `@texteda/renderer` gives the boxes;
- `boxDistance` is in `packages/core/src/view/geometry.ts` — it is **not** re-exported from the
  package index, so import it by path.

Do this in a throwaway script and delete it afterwards; the repository root keeps only entry
files, build configuration and directories (`AGENTS.md` §9).

## 9. Verify

Loop against numbers, not pixels.

```sh
bun run view:verify examples/reference-project          # the 0.5 mm wiring-lattice gate
bun run texteda check examples/reference-project --json  # 0 errors; no view.* on this page
bun run texteda view metrics examples/reference-project main
bun run texteda view render examples/reference-project main --out /tmp/page.svg
bun run fmt:teda examples/reference-project
bun run fmt:teda --check examples/reference-project
```

The lattice gate covers the page and the module drawings:

```text
view:verify ok — 1 print page(s) and 3 module drawing(s), wiring on the 0.5 mm lattice
```

It reports the wiring coordinates that are off the lattice — a placement origin, a wire bend, a
port, a junction. The drawing coordinates (labels, notes, field anchors, module boxes) are free
([ADR-0074](../adr/09-view/0074-the-lattice-binds-what-must-reach-each-other.md) D2) and are not
reported.

The page's own numbers:

```text
main/main — 594.0 × 420.0 mm sheet
content   x 39.5..578.8  y 23.9..401.0 mm  (81.5% of the sheet)
counts    82 instances, 6 labels, 15 ports, 3 notes, 0 wires, 44 nets undrawn
spacing   label min gap 7.4 mm, text min gap 7.4 mm
wires     0.0 mm total, 0 crossings of other nets, 0 through a body
```

The page carries no wires of its own: it composes three module drawings and draws the two
interconnects, so `0 wires` is the truth about the **page**, not about the product.

When filtering the check output, keep the `view.*` findings and drop `view.nets-not-drawn` (a
project-level count that a partial drawing may legitimately have). Require **zero other** `view.*`
warnings:

```sh
bun run texteda check examples/reference-project --json | python3 -c "
import json, sys
payload = json.load(sys.stdin)
print([d['code'] for d in payload['diagnostics'] if d['code'].startswith('view.')])
"
```

```text
['view.nets-not-drawn']
```

Acceptance:

- `view:verify` passes;
- 0 errors, and no `view.*` warning other than an accepted `nets-not-drawn`;
- `view metrics` reports `0 through a body`, both text gaps `> 0`; crossings are reported but are
  not a failure;
- the rendered crop shows the labels and ports on their nets and no dot on a pin that carries one
  visible run;
- the page is canonical (`fmt:teda --check` passes).

If the page lives under `examples/cases/**`, regenerate its expectations **only** because the page
itself changed, and re-run the full gates afterwards:

```sh
bun run test
bun run typecheck
bun run gen:check
bun run fmt:teda --check .
bun run cases:check
bun run check:links
bun run check:public
bun run lib:verify
```

## 10. Fixture drift is not an implementation regression

The page-shaped verbs are exercised on a **fixture**, not on the reference project's own drawing:
`packages/cli/test/view.test.ts` and `packages/cli/test/layout-places.test.ts` copy the reference
project into a scratch directory and write the historical detail page
`packages/cli/test/fixtures/legacy-buck.view.teda` into it as `views/buck-5v.view.teda`
(`view.test.ts` also restores `legacy-charger.view.teda` the same way). Editing the reference
project's own drawings therefore does not move these tests; editing the fixture does, and a fixture
that needs rewiring makes the tool see an already-fixed project. When they fail after a drawing
edit, the drawing is what changed — **fix the drawing, never the tests**.

## 11. Traps around the tooling

- An ad-hoc Bun probe started from a temporary directory dies with
  `Cannot find package '@texteda/parser'`. Give the probe directory a `node_modules` symlink to
  the repository's, or run it with the repository as `cwd`.
- The review payload is **one** JSON object after `window.__TEXTEDA_REVIEW__ = `. Read it with
  `json.JSONDecoder().raw_decode`; splitting the file at the first `;` cuts a string in half.
- `formatComponent` does not exist: `component` files have no canonical formatter. A "format
  everything" smoke therefore covers footprint / symbol / schematic / module / view / pcb /
  procurement and project metadata only.
- `texteda view render` writes `dist/view/<page>.svg` unless `--out` says otherwise.
- `view render`, `view metrics` and `view png` take a **print-page** id. A module drawing is not a
  page: `view render examples/reference-project buck-5v` fails with `Print page buck-5v not found
  (available: main)`. Measure a module drawing with the probe in §5.

## 12. What not to do

- Do not add a router, and do not treat `texteda view rewire` as one (§1). It re-anchors ends
  onto moved pins and reseats labels; it does not find a path, avoid bodies or pins, and it can
  leave a bend off the `0.01 mm` format resolution, which the parser then rejects as
  `value.length-invalid`.
- Do not copy pin coordinates from any document into a drawing; read them at repair time (§2).
- Do not write coordinates in the composed page's frame into a module drawing, or the other way
  round (§2.1).
- Do not write a junction record, and do not draw a dot where the geometry does not make one
  (§3).
- Do not treat a crossing as a defect to route around. It is legal, and routing around it may
  cost a body crossing instead.
- Do not write a `field` row to a page that declares a language older than `0.10`; raise the
  `version` line first, or the page stops parsing.
- Do not overwrite a reviewed view with a regenerated one
  ([ADR-0035](../adr/09-view/0035-the-view-layer-is-a-drawing.md)).
- Do not edit a test to accommodate a drawing you changed (§10).

## 13. References

- [`spec/schematic-view.md`](../../spec/schematic-view.md) §5 (wire).
- [`spec/schematic-view.md`](../../spec/schematic-view.md) §5.1 (junctions).
- [`spec/schematic-view.md`](../../spec/schematic-view.md) §9.2 (warnings).
- [`spec/schematic-view.md`](../../spec/schematic-view.md) §9.5 (round-trip).
- [`spec/rendering.md`](../../spec/rendering.md) §2–§3: the drawing commands, the two backends, and
  what a picture is not.
- [ADR-0042](../adr/09-view/0042-the-review-app-has-modes.md) D5, D6: what `view rewire` does
  and is not.
- [ADR-0074](../adr/09-view/0074-the-lattice-binds-what-must-reach-each-other.md) D1: the wiring
  coordinates — a placement origin, a wire bend, a port, a junction — are `0.5 mm` lattice points;
  the rest of the page is drawing and is free.
- [ADR-0035](../adr/09-view/0035-the-view-layer-is-a-drawing.md): the view is a drawing, kept and
  not regenerated.
- [`draw-print-page.md`](draw-print-page.md): producing a page in the first place.
- [`docs/skills/README.md`](README.md): the index of the procedures.
