# Skill: Repair a Print Page That Already Exists

> **Audience**: agents (humans can follow it too).
> **Scope**: diagnosing and repairing an existing `views/<board_id>/<page_id>.view.teda`.
> **Not in scope**: drawing a page for the first time — that is
> [`draw-print-page.md`](draw-print-page.md).
> **Status**: the commands and expected outputs below were run on
> `examples/reference-project` on 2026-11-04.

This file is English on purpose: a skill is an operating manual for an agent, not a design
document (see `AGENTS.md` §12).

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

1. **Snapshot the source.** Copy the complete `views/<board_id>/<page_id>.view.teda` file to an
   immutable working snapshot before changing it. The snapshot must include the current places,
   labels, ports, fields, notes, and text, not just the wire rows. It is the rollback and the
   comparison point for the operation.
2. **Refresh the authorities.** Generate a fresh review payload for the current page and read pin
   points, symbol boxes, and text boxes from the renderer's current geometry. At the same time,
   load the board schematic with its modules expanded (`parseSchematic` with `loadModules`) and
   derive flattened logical net membership from that IR. Do not infer membership from the old
   wires, a screenshot, or a stale coordinate table; the schematic supplies membership and the
   renderer supplies coordinates.
3. **Remove only wires.** In the working view, delete every `wire` row and no other row. Keep the
   page version, placements, labels, ports, fields, notes, and other text exactly as page source.
   Do not regenerate the page or replace its non-wire drawing state.
4. **Rebuild from logic and geometry.** For each flattened net represented on this page, map its
   page-visible pin members (and any page port) to the fresh renderer connection points. Write new
   orthogonal `wire` rows from those members, splitting multi-member nets into explicit branches.
   Each pin endpoint must be a member of the named net; route around body, pin-stroke, and text
   boxes; approach pins along their permitted axis; and put labels and ports on their own nets.
   Never use the deleted rows as a topology or bend template.
5. **Verify coverage and connectivity.** Make a net-by-net coverage table: every page-visible member pin must be an endpoint of at least one new row, every wire endpoint must belong to that logical net, and each intended page port must be connected. Also verify that, for each drawn net, all of its page-visible member pins and intended page ports lie in one single connected geometric graph through the new wire rows and their endpoint contacts. Endpoint membership and coverage alone are insufficient: the checker can accept disconnected wire subtrees that carry the same net, and matching net names alone do not prove geometric continuity. Before completion, perform an explicit visual/topology check by tracing every drawn net in the rendered page and confirming that each such graph is continuous from every visible member pin to every intended port. A page may intentionally omit a board-level net, but that exception must be page-local and understood; a board-wide `nets-not-drawn` count is not proof that the page's visible pins are covered.
6. **Inspect page-local diagnostics.** Run the project check in JSON mode, then filter it to this
   board/page and inspect its `view.*` findings. Resolve page-local wire, pin, body, label, port,
   and text findings before judging the result; do not let diagnostics from another page stand in
   for this page's evidence.
7. **Measure the page.** Run `view metrics` for this page and record wire count and length,
   crossings, through-body count, and text gaps. Use those numbers to compare the rebuilt drawing
   with the intended layout and with the snapshot, while remembering that a crossing between
   different nets is legal.
8. **Render and crop.** Render this page once, then crop the SVG around each dense or disputed area
   as in §4. Inspect the crop for pin-axis arrivals, body or artwork crossings, label and port
   placement, and junction dots; do not judge a whole-sheet render at its default scale.
9. **Canonicalise last.** Run the canonical TEDA formatter on the finished view and then its
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

The HTML embeds one JSON payload with, per page, a `symbols` array (each entry carries `box` and
`pins`), plus `texts` and `fields` ink boxes. That geometry is **authoritative**: it comes out of
the same `schematicGeometry` the checker uses, so a coordinate read from there is the coordinate
the checker will measure against.

A quick way to read one page's numbers:

```sh
bun run texteda review examples/reference-project --out /tmp/review.html
python3 - <<'PY'
import re, io, json
s = io.open('/tmp/review.html', encoding='utf-8').read()

# The payload embeds one JSON object per page; each carries "page", "symbols", "texts", "fields".
for m in re.finditer(r'"page"\s*:\s*"', s):
    i = m.start(); depth = 0; j = i
    while j > 0:
        c = s[j]
        if c == '}': depth += 1
        elif c == '{':
            if depth == 0: break
            depth -= 1
        j -= 1
    depth = 0; k = j
    while k < len(s):
        c = s[k]
        if c == '{': depth += 1
        elif c == '}':
            depth -= 1
            if depth == 0: break
        elif c == '"':
            k += 1
            while k < len(s):
                if s[k] == '\\': k += 1
                elif s[k] == '"': break
                k += 1
        k += 1
    p = json.loads(s[j:k+1])
    if p.get("page") != "buck-5v": continue
    for sym in p.get("symbols", []):
        b = sym.get("box", {})
        pins = " ".join(f'{n}={v["x"]},{v["y"]}' for n, v in sorted(sym.get("pins", {}).items()))
        print(f'{sym["id"]:8} box {b.get("x")}..{round(b.get("x",0)+b.get("w",0),2)} '
              f'y {b.get("y")}..{round(b.get("y",0)+b.get("h",0),2)}  pins {pins}')
    break
PY
```

Output — the page's real geometry, in millimetres:

```text
M2.C1    box 116..119 y 95.5..97.5  pins 1=117.5,92.5 2=117.5,100.5
M2.C2    box 160..163 y 101..103  pins 1=161.5,106 2=161.5,98
M2.U1    box 127.5..152.5 y 100..110  pins 1=155,108.5 2=155,106 3=155,103.5 4=125,106 ...
```

**Do not copy coordinates out of a document into a page.** A page's geometry moves whenever a
part is re-placed, and a stale table of pin positions is worse than no table: it produces routes
that miss. Read the geometry at the time of the repair.

What each source is good for:

| Need | Source |
|---|---|
| Pin connection points, body boxes | `texteda review --out` → the page's `symbols` |
| Label / port / text ink boxes | the same payload's `texts` and `fields` |
| Where a wire actually goes | the rendered SVG (`view render`, §4) |
| What the checker thinks | `texteda check --json` |
| How long a run is, how many crossings | `texteda view metrics` |

## 3. A junction is declared, and a dot is drawn only where one is declared

A dot is a claim about connectivity, so it is **written**: a `junction` row gives a drawing node a
stable id and a sheet position, and `wire` rows name that id as an endpoint
([`spec/schematic-view.md`](../../spec/schematic-view.md) §5.1). The renderer draws a circle only
for a declared junction (`packages/renderer/src/schematic.ts`); it derives nothing from the geometry.

That makes three rules, and the checker enforces all three:

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
| One wire ending on a pin | no junction row | no |
| Two rows ending on one declared junction, third row also ending there | `junction` row + three endpoints | yes |
| Two rows of one net merely meeting at a point | no junction row | no — and adding no dot is correct, not a defect |
| A row passing through a declared junction of its net without naming it | junction row, row not an endpoint | `view.wire-gap` |
| A junction named by rows of two different nets | one junction, two nets | `view.endpoint-wrong-net` |

**Crossings between different nets are legal.** No dot means "not connected", and the drawing
says so by omission. `view.wire-crossing` is **deprecated** — it is never emitted, it is kept only
so old reports parse. Crossings show up as a number in `view metrics`, not as a diagnostic.

To audit the dots on a rendered page, compare them with the page's `junction` rows:

```sh
grep -o 'data-ref="junction:[^"]*"' /tmp/page.svg | wc -l   # one dot per declared junction
grep -c '^  [A-Za-z0-9_+-]*  *\[' examples/reference-project/views/charger-buck/buck-5v.view.teda   # rows declared

The two counts agree. A circle with no row is a renderer defect; a row with no circle means the page
has not been rendered yet.

## 4. Look at it: crop, do not re-render

A whole-page render at the default scale is too small to judge. Crop the SVG instead of asking
for another render: replace the root element's `width` / `height` / `viewBox` with a region of
interest and a matching canvas size.

```sh
bun run texteda view render examples/reference-project charger-buck/buck-5v --out /tmp/page.svg
python3 - <<'PY'
import re, io
s = io.open('/tmp/page.svg', encoding='utf-8').read()
crop = re.sub(r'viewBox="[^"]*"', 'viewBox="150 78 92 48"', s, count=1)   # x y w h, in mm
crop = re.sub(r'width="[^"]*" height="[^"]*"', 'width="920" height="480"', crop, count=1)
io.open('/tmp/page-crop.svg', 'w', encoding='utf-8').write(crop)
PY
```

Then read `/tmp/page-crop.svg` as an image. Crop windows of roughly 40–60 mm are the useful size.

The root element's `viewBox` is the **whole sheet** (`-2 -2 301 214` for an A4 landscape page),
so the crop's `x` / `y` are sheet coordinates in millimetres — the same frame the `place` rows
use, with the y axis flipped.

The SVG's y axis is **flipped** relative to the `.teda` source: the model's `+y` is up, the SVG's
is down. A source feature at `y = +2.0` appears at SVG `y = -2.0`.

## 5. Measure a run against its Manhattan minimum

"Wandering lines" is measurable. Walk the rendered primitives; for each `polyline` on the `wire`
layer, sum the segment lengths and compare with `|dx| + |dy|` between its first and last point:

- ratio ≈ 1 → the run is honest, leave it;
- ratio > ~1.5 → investigate a detour and rewrite the bend list when appropriate. This ratio is a review heuristic, not a route-quality gate; a route still needs the geometry, diagnostics, and visual review in §1.1.

The same walk yields the `junction` layer's `circle` primitives with their nets — that is where
the reader believes the connections are.

The prerequisites are the same ones the review app uses: the board's schematic compiled with its
modules, and the instances built from the symbol library. `parseSchematic` expands the modules,
so a page that names `M2.C1` needs the `modules` option — without it the renderer refuses the
page with `no symbol facts for placed instance M2.C1`.

```ts
import { readFileSync } from "node:fs";
import { parseSchematic, parseView } from "@texteda/parser";
import { renderSchematic } from "@texteda/renderer";
import { loadComponents, loadModules, loadBoard } from "./packages/cli/src/project.ts";
import { loadSymbolLibrary, schematicInstances } from "./packages/cli/src/symbols.ts";

const root = "examples/reference-project";
const { resolver, shards } = loadComponents(root);
const symbolLibrary = loadSymbolLibrary(root);
const componentOf = (id: string) => shards.find((s) => s.id === id)?.ir.component;

const loaded = loadBoard(root, "charger-buck")!;
const schematic = parseSchematic(loaded.text, {
  file: loaded.file, board: "charger-buck", components: resolver, modules: loadModules(root),
}).ir!;
const instances = schematicInstances(
  schematic,
  (id) => resolver.resolve(id)?.pins ?? [],
  (id) => componentOf(id)?.symbol,
  symbolLibrary,
);

const view = parseView(readFileSync(`${root}/views/charger-buck/buck-5v.view.teda`, "utf8"), { file: "v" }).ir!;
const doc = renderSchematic(view, instances);

for (const p of doc.primitives) {
  if (p.kind !== "polyline" || p.layer !== "wire") continue;
  const pts = p.points;
  let drawn = 0;
  for (let i = 1; i < pts.length; i++) drawn += Math.hypot(pts[i]!.x - pts[i-1]!.x, pts[i]!.y - pts[i-1]!.y);
  const a = pts[0]!, b = pts[pts.length - 1]!;
  const min = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
  if (min > 0 && drawn / min > 1.5) console.log("detour", drawn / min, pts);
}
```

Run it **from the repository root** — a probe started in a temporary directory cannot resolve
`@texteda/parser` (§11).

The primitives carry **nanometres**, so divide by `1e6` for millimetres. `p.layer` is the string
`"wire"`; the layer is on every primitive, and `p.kind` is `"polyline"` for a run.

A run whose last point repeats its predecessor is a **redundant vertex** — the same finding,
seen from the other end. The reference page has one such run, and the detour ratio exposes it.

Then: replace the over-long run's bends with the minimal elbow — **one** corner when the two pins
share neither coordinate, **two** when the path must clear a body or a text. Keep the page
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
- **Approach a left-side pin from the left.** A run leaving a pin on the body's left edge toward
  the right crosses the body. Go left first, then up or down, then across.
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
bun run view:verify examples/reference-project          # the 0.5 mm lattice gate
bun run texteda check examples/reference-project --json  # 0 errors; no view.* on this page
bun run texteda view metrics examples/reference-project charger-buck/buck-5v
bun run texteda view render examples/reference-project charger-buck/buck-5v --out /tmp/page.svg
bun run fmt:teda examples/reference-project
bun run fmt:teda --check examples/reference-project
```

When filtering the check output, keep the `view.*` findings and drop `view.nets-not-drawn` (a
board-level count that a partial page may legitimately have). Require **zero other** `view.*`
warnings.

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

Two tests assume the reference page is already clean and that `view rewire` is a no-op on it:
`packages/cli/test/layout-places.test.ts` and `packages/cli/test/view.test.ts`. A fixture that
needs rewiring makes the tool see an already-fixed project. When they fail after a page edit, the
page is what changed — **fix the page, never the tests**.

## 11. Traps around the tooling

- An ad-hoc Bun probe started from a temporary directory dies with
  `Cannot find package '@texteda/parser'`. Give the probe directory a `node_modules` symlink to
  the repository's, or run it with the repository as `cwd`.
- `formatComponent` does not exist: `component` files have no canonical formatter. A "format
  everything" smoke therefore covers footprint / symbol / schematic / module / view / pcb /
  procurement / system only.
- `texteda view render` writes `dist/view/<board>/<page>.svg` unless `--out` says otherwise.

## 12. What not to do

- Do not add a router, and do not treat `texteda view rewire` as one (§1). It re-anchors ends
  onto moved pins and reseats labels; it does not find a path, avoid bodies or pins, and it can
  leave a bend off the `0.01 mm` format resolution, which the parser then rejects as
  `value.length-invalid`.
- Do not copy pin coordinates from any document into a page; read them at repair time (§2).
- Do not write a junction record, and do not draw a dot where the geometry does not make one
  (§3).
- Do not treat a crossing as a defect to route around. It is legal, and routing around it may
  cost a body crossing instead.
- Do not write a `field` row to a page that declares a language older than `0.10`; raise the
  `version` line first, or the page stops parsing.
- Do not overwrite a reviewed view with a regenerated one
  ([ADR-0035](../adr/09-view/0035-the-view-layer-is-a-drawing.md)).
- Do not edit a test to accommodate a page you changed (§10).

## 13. References

- [`spec/schematic-view.md`](../../spec/schematic-view.md) §5 (wire).
- [`spec/schematic-view.md`](../../spec/schematic-view.md) §5.1 (junctions).
- [`spec/schematic-view.md`](../../spec/schematic-view.md) §9.2 (warnings).
- [`spec/schematic-view.md`](../../spec/schematic-view.md) §9.5 (round-trip).
- [ADR-0042](../adr/09-view/0042-the-review-app-has-modes.md) D5, D6: what `view rewire` does
  and is not.
- [ADR-0059](../adr/09-view/0059-print-page-coordinates-anchor-on-the-half-millimetre-lattice.md) D1:
  every stored coordinate is a `0.5 mm` lattice point.
- [ADR-0035](../adr/09-view/0035-the-view-layer-is-a-drawing.md): the view is a drawing, kept and
  not regenerated.
- [`draw-print-page.md`](draw-print-page.md): producing a page in the first place.
- [`docs/skills/README.md`](README.md): the index of the procedures.
