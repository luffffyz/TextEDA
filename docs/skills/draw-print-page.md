# Skill: Draw and Review a Print Page (S1)

> **Status**: the commands and expected outputs below were run on
> `examples/reference-project` on 2026-11-04.
> **Audience**: agents (humans can follow it too).
> **Scope**: `views/<page_id>.view.teda` only. A drawing never changes
> `design/**`, `assets/**`, the netlist, the BOM or any PCB.
> **Not in scope**: diagnosing a page that already exists and is wrong — that is
> [`repair-print-page.md`](repair-print-page.md).

This file is English on purpose: a skill is an operating manual for an agent, not a design
document (see `AGENTS.md` §12).

Index: [`docs/skills/README.md`](README.md) lists the procedures and when to read which.

## 0. What this skill is for

How to produce one reviewable print page: where the symbols sit, how the wires run, which labels
and ports go where, and **which diagnostic code to look at when the page is wrong**.

The normative rules are not repeated here. The definitions live in
[`spec/schematic-view.md`](../../spec/schematic-view.md) §5 and §9.2; the code table is
`docs/error-codes.md`, generated from `packages/ir/src/diagnostics/codes.ts`. This skill only gives
the command loop, the two layout-seeding workflows, and the repair action for each code.

## 1. Prerequisites

Run from the repository root (`REPO`):

```sh
REPO=/path/to/TextEDA
```

The commands used below:

| Command | What it does |
|---|---|
| `bun run texteda check <project>` | Parse, contract validation, ERC, binding and drawing checks. Errors block; warnings do not. |
| `bun run texteda view metrics <project> <page_id>` | The drawing's numbers: sheet use, counts, label/text gaps, wire length, crossings, bodies. |
| `bun run texteda view rewire <project> <page_id> [--dry-run]` | Bring the wiring back onto the pins after a part moved; the interior corners keep their place. |
| `bun run texteda view render <project> <page_id> [--out <file>]` | Write the page's drawing as an SVG file (same renderer as the review app). |
| `bun run preview view <page_id> [--project <project>] [--out <dir>]` | Render one project page to SVG and print its path. |
| `bun run texteda review <project> [--out <file>]` | Serve the single review surface on `127.0.0.1`; `--out` writes the same self-contained, read-only HTML. |
| `bun run fmt:teda <project>` / `bun run fmt:teda --check <project>` | Canonicalise the view; `--check` is the gate. |

The page needs two inputs:
1. the **logical** design (`design/sch/main.teda` plus modules and components) — the source
   of project-wide nets, ports, interconnects and pins;
2. the **view** file (`views/<page_id>.view.teda`) — the only source of positions and
   wires for that page.

A project with no view file has no drawing. That is legal; do not invent one.

The conventional project overview is `views/main.view.teda`; it may show module boxes, ports, and
declared interconnects without a `place` section. A topology-only overview is valid and is distinct
from the component-placement workflow below.

**Every coordinate the page stores is anchored on the `0.5 mm` lattice**, in both axes: a `place`
origin, a `field` anchor (symbol-local), a `wire` bend, a `label` position, a `port` position, a
`text` position ([ADR-0059](../adr/09-view/0059-print-page-coordinates-anchor-on-the-half-millimetre-lattice.md)
D1). Free placement is not admitted today (same record, D5). The reason is constructive: a wire
leaves a **pin**, whose connection point is a lattice point, and turns at a **bend**; when both
sides are on the lattice, an axis-aligned run between them always exists. The file's `0.01 mm`
**resolution** is a different question — it is what the format can express, and it stays finer than
the lattice so a historical file or a hand nudge remains expressible
([spec/schematic-view.md](../../spec/schematic-view.md) §2.1).

## 2. Two ways to seed a layout, one way to finish it

A and B are not alternatives. A is a source for the **first** positions; B is how the page is
finished. Both end in a wired page (§2.4); a placement-only page is a working state, not a handoff.

### 2.1 Mode A: an external reference image (datasheet / application circuit)

A screenshot is an input to the author's eyes, **not to the parser**. Use it for:

- the arrangement of parts (signal flow, power/ground grouping, connector at the edge);
- relative spacing and orientation;
- a visual sanity check of the finished page.

Hard limits:

- **Never take connectivity from the image.** Net membership and pin binding come from
  `design/sch/main.teda` and its modules; a view wire must name pins that the logical net already contains
  (`view.pin-net-mismatch` is an error). Deriving a netlist from geometry breaks the project's
  invariant 2; the image cannot overrule the logical IR.
- **A screenshot of a different circuit is only inspiration.** Do not copy its net names or part
  identities. If it is the same circuit, it is still only a cross-check, not the authority.
- **Do not commit the screenshot or the datasheet PDF.** Vendor figures are copyrighted; keep them
  local (the reference project's `docs/datasheets/` is gitignored) and cite the source in prose if
  needed.
- **Snap placement to the 0.5 mm layout grid.** Image coordinates are approximate; write rounded `place`
  rows. The grid is the symbol pin lattice ([ADR-0057](../adr/08-libraries/0057-symbol-pins-sit-on-a-half-millimetre-lattice.md)):
  a symbol whose origin is a multiple of `0.5 mm` has every pin point on a multiple of `0.5 mm` too,
  so a wire can always leave a pin and bend on the same lattice. Any OCR/vision step is an authoring
  aid outside the language; it produces text for review, not an IR input, and it adds no runtime
  dependency.

Procedure:

1. Read the reference and decide a rough arrangement.
2. Write only the `place` rows (instance id, `[x,y]`, rotation) in the view file. Every geometric
   value is one bracketed cell ([ADR-0065](../adr/01-language/0065-a-coordinate-tuple-is-one-cell.md)),
   so a point is `[x,y]`, not two numbers. This is an
   intermediate: the page handed over for review is wired (§2.4).
3. Run `view metrics` to check the sheet is used and parts do not collide.
4. Route the wires from the logical netlist with Mode B. Do not trace the reference's lines.

### 2.2 Mode B: human-owned placement, agent wiring (the finish)

This is the finish, not a seed: the renderer never places anything
([ADR-0035](../adr/09-view/0035-the-view-layer-is-a-drawing.md) decision 6). The human owns the final positions
(however they were seeded), the agent writes the wires, and the human reviews the wired page.
The initial placement can come from a reference, an agent proposal, or the human.

Procedure:

1. **Place.** Write the `place` rows (or accept a proposed placement). The layout grid is 0.5 mm;
   keep physical pin positions from the library rather than deriving them from this placement grid.
   - **Default:** place, then inventory, read geometry, and route (steps 2–4); hand over a wired
     draft. The human reviews placement and wiring together.
   - **Optional:** when the human explicitly wants to settle positions first, or the rearrangement
     is large, render a placement-only page with `preview view`, ask the human to move parts or
     name coordinates, and route after acceptance. A view with `place` and no `wire` section is
     legal; `view metrics` will report `nets undrawn`, which is expected at this stage. This page
     is not the review artifact.
2. **Inventory the flattened nets.** Export the project's machine-readable netlist before routing:

   ```sh
   bun run texteda netlist examples/reference-project --json
   ```
   Use each net's `id` and `members` (`<instance>.<pin>`) as the complete pin inventory, including
   module instances after flattening. The netlist is logical truth, not a page drawing: route only
   pins belonging to each listed net, and do not infer membership from symbols, labels, or images.
   The command requires a design without errors; fix logical errors before treating its output as
   authoritative.
3. **Read fresh renderer geometry.** After the final placement is settled and before routing, run
   `bun run texteda review <project> --out /tmp/review.html` and inspect that page's embedded
   geometry payload. Use its `symbols[].pins` connection points and `symbols[].box` body boxes for
   real endpoints and clearance; use `texts` and `fields` for text obstacles. This geometry is
   authoritative for the current placement, unlike guessed coordinates from the `place` row or a
   stale earlier render. Re-read it whenever placement changes.
4. **Route from logic.** For each net with two or more members, read the member pins and their
   connection points from the symbols, then write `wire` rows:
   - `<net> <end> <end> [[x,y] …]`; an end is a pin reference (`U1.5`), a port this page draws
     (`GND`), or a junction this page declares. Each bend is its own `[x,y]` cell
     ([ADR-0065](../adr/01-language/0065-a-coordinate-tuple-is-one-cell.md)). A pin end must be a
     member of the net; a port end takes its point from the page's `port` row (`view.port-not-drawn`
     when the page draws neither that port nor a junction of that name), and moving the row moves
     the run's end with it;
   - every segment is horizontal or vertical (`view.wire-diagonal` forbids slants);
   - route around symbol bodies (`view.wire-crosses-symbol`) and foreign pin connection points
     (`view.wire-crosses-pin`). A plain crossing of another net is legal: no dot means "not
     connected". Keep crossings low for readability, but do not contort a route to avoid one;
   - a pin in the middle of a run is not a junction: split the run into a second `wire` row or
     route around it. When a wire ends at a pin with a perpendicular final segment, the renderer
     draws a visual dot at that pin; the pin endpoint identity still supplies the connection;
   - split a net with more than two pins into several rows. **Graph junctions are declared**: where
     one net genuinely forks, write a `junction` row and end every branch on its id. Two rows that
     merely meet at a point draw no dot, and a row passing through a declared junction of its own net
     without ending there reports `view.wire-gap`;
   - put labels and ports on their own net (`view.label-not-on-net` /
     `view.port-not-on-net`);
   - every member pin of every drawn net must be an endpoint of at least one wire row for that net;
     a wire passing through a pin does not cover it. Endpoint coverage is necessary but not
     sufficient: verify that each drawn net forms one connected geometric graph containing all
     page-visible member pins and its intended port, if any. Build an explicit per-net
     connectivity/edge table from the wire geometry, or inspect the rendered geometry to confirm
     that all those endpoints belong to one component. Do not infer connection from shared net
     names or proximity. Check both coverage and connectivity per net against the inventory: the
     checker reports undrawn **nets** (`view.nets-not-drawn`), not missing member pins or
     disconnected components.
5. **Freeze.** The routed rows are source, not a cache. Do not regenerate them over manual
   adjustments; when the placement changes, re-route the affected nets by hand or with a
   deterministic generator and review the diff. If the human has edited a wire, reroute only on an
   explicit request and keep the human edit in the diff.
6. **Verify** with the command loop in §3.

This is the first route: author wire rows from the flattened inventory and current renderer geometry.
`texteda view rewire` is not a first-route command or router; use it only when an existing wired
page's parts have moved and the existing route shape should be re-anchored. It preserves the route's
segment and direction pattern and does not find a path or avoid obstacles. Review its diff and
render; if placement changes substantially, design the affected routes anew instead.

Routing determinism matters: for the same `place` rows and the same logical schematic, the same
wires should come out. If an LLM proposes routes, its output is still a source edit to review;
do not run it again after a human has moved a label or a wire.

### 2.3 Which seed to choose

- **Default: no external seed.** Let the human place, or let an agent propose positions; either way
  the human owns them. This keeps the logical truth in `schematic` and the drawing in `view`.
- **Mode A** is a seed, not a second authoring mode. Use it when the datasheet's arrangement is the
  point (a reference design, a known-good layout); then finish with Mode B.
- Never import a netlist from an image, and never let either mode write `design/**`.

### 2.4 The page handed to a human is wired

Both seeds are only about the first positions. The artifact a human reviews is the same in both:
symbols placed, nets wired, labels and ports on their nets, checks run.

A placement-only page hides connectivity: the reviewer sees boxes and has to reconstruct the nets
in their head. The page exists to make the circuit reviewable, so a bare placement is an
intermediate for the first or large moves, not a handoff. Labels on every pin are a compromise,
but they still do not show signal flow; a wired page does.

After a review, the human moves parts. The wire endpoints are pin references, so they follow the
symbol; only the absolute bends can go stale (and then `view.wire-diagonal` or a pin/body
collision appears; a crossing is not stale by itself).
The agent re-routes the affected nets; the human is not asked to hand-fix the wires. When the human
does edit a wire by hand, that edit is source: do not run a wholesale regenerator over it
([ADR-0035](../adr/09-view/0035-the-view-layer-is-a-drawing.md)). Re-route only on an explicit
request and show the diff.

The review app has one interaction surface: select a schematic symbol, press `m` to start an
explicit move transaction, or press `r` to queue a clockwise 90-degree rotation. A label or a port
is movable too: select it and press `m` to place it by hand. Selection does not
navigate: a single click only selects; `Enter` or a double-click opens the definition menu. The move
preview uses the 0.5 mm placement grid (ADR-0057); a left-click completes only the local preview, and `Escape`
restores that move transaction without reverting unrelated pending edits. `Apply` writes the pending
view changes and **re-anchors** affected wires — same segment count, same directions, only the corners
the moved pin positions require. Until `Apply` the page is local state: the old wires stay with stale
bends, and `view.wire-diagonal` / `view.wire-crosses-pin` are the signal. A move can therefore create
a readability finding; `texteda check` reports it after `Apply`, and the app shows it in the left
column beside the page's measurements. Do not run a router on every drag frame. The PCB, symbol and
footprint drawings are read-only. Built per [ADR-0056](../adr/09-view/0056-the-review-app-has-one-interaction-surface.md).

## 3. The command loop

### 3.0 Check the page's house style

```sh
bun run view:verify examples/reference-project
```

Expected:

```
view:verify ok — 3 print page(s) on the 0.5 mm lattice
```

This is the gate for the lattice rule (§1). It reports every coordinate that is off the lattice,
naming the record and the value. Run it after editing a page, before the project check.

### 3.1 Check the project

```sh
bun run texteda check examples/reference-project
```

Expected tail (the counts move with the project):

```
Checked the project schematic and 2 PCBs: 0 errors, 201 warnings (stages: parse 47 · contract 0 · design 156)
```

Errors block the build; warnings do not. Use `--json` when a script needs the payload. A project check covers the logical root, every
physical PCB and every view page; for this page's gate, inspect only `view.*` diagnostics whose
location is this page's view file.
Exclude `view.nets-not-drawn` from that page-local set: it is a project-level count and may reflect
nets drawn on another page (or deliberately omitted from a partial research page). Require zero
other page-local `view.*` warnings, and still fix every project error. Do not mistake unrelated
pages' warnings for this page's findings.

### 3.2 Measure the page

```sh
bun run texteda view metrics examples/reference-project buck-5v
```
Expected shape (the numbers move with the page):

```
buck-5v — 297.0 × 210.0 mm sheet
content   x 20.0..241.5  y 14.0..121.6 mm  (38.2% of the sheet)
counts    9 instances, 10 labels, 2 ports, 1 notes, 17 wires, 30 nets undrawn
spacing   label min gap 5.7 mm, text min gap 5.7 mm
wires     422.5 mm total, 0 crossings of other nets, 0 through a body
net texts all sit on their nets
```

Read it as:

- `through a body` must be **0** for a finished page; `crossings of other nets` is a readability
  number, not a rule: a crossing with no dot is not a connection, so a few are legal;
- `label min gap` / `text min gap` must be **> 0** (no overlap);
- `net texts all sit on their nets` means every label/port's anchor is on its net;
- `nets undrawn` is a project-level count; a research page may legitimately be nonzero, but a
  finished page should say 0.

### 3.3 Look at it

```sh
bun run preview view buck-5v --project examples/reference-project
```

The SVG path is printed; open it or embed it. For the interactive review, run
`bun run texteda review examples/reference-project` and open the printed `127.0.0.1` URL.

For a legible visual review, render the current page and inspect a crop rather than judging a
whole-sheet image at fit-to-page scale:

```sh
bun run texteda view render examples/reference-project buck-5v --out /tmp/page.svg
```

Crop the SVG by changing its root `viewBox` to the region of interest (sheet coordinates in mm)
and setting a matching larger `width` / `height`; a 40–60 mm window is a useful starting size.
Open the resulting crop as an image. Inspect the full page for layout, then crops for every dense
area: trace each net to confirm every inventoried member pin is reached by a wire endpoint, labels
and ports sit on their nets, every dot sits on a declared `junction` row, and no wire crosses symbol or
text artwork. A metrics summary or a clean check cannot replace this rendered inspection. See
[`repair-print-page.md`](repair-print-page.md) §4 for a crop example.

### 3.4 Format and re-check

```sh
bun run fmt:teda examples/reference-project
bun run fmt:teda --check examples/reference-project
bun run texteda check examples/reference-project
```

The formatter rewrites the whole view file (columns, spacing). Run it before the final check so
the diff is canonical.

## 4. Code → repair

Errors first; warnings are triage, not a gate.

| Code | Meaning | Repair |
|---|---|---|
| `ref.unknown-instance` / `ref.unknown-net` / `ref.unknown-port` | The view names an id the project does not have | Fix the id; do not add a second source of truth |
| `view.pin-not-placed` | A wire names a pin whose instance is not in the `place` section | Place the instance, or drop the wire |
| `view.pin-net-mismatch` | A wire endpoint pin is not a member of the row's net | Change the endpoint or the net; the logical netlist wins |
| `view.out-of-sheet` | A record sits outside the sheet | Move it inside |
| `view.nets-not-drawn` | A net with ≥2 members has no wire and no label on any page | Draw it or put a label on it |
| `view.label-not-on-net` / `view.port-not-on-net` | A label or port is not on its net's wiring | Move its anchor onto a wire or pin of that net |
| `view.wire-crosses-symbol` | A wire runs through a symbol body | Route around the body |
| `view.wire-diagonal` | A segment is not horizontal or vertical | Add a corner where the run turns |
| `view.wire-crosses-pin` | A wire passes through a pin connection point that is not its own endpoint | Split the run at the pin, or route around it |
| `view.text-overlap` / `view.label-collision` | Two pieces of text overlap | Move one; overlap area must be zero |
| `view.text-on-wire` | A wire runs through text (including a symbol's Reference/Value) | Move the text or reroute the wire |
| `format.unsupported-version` | The page declares a language older than the section it uses | Raise the `version` line; a `field` section needs language `0.10` |

Definitions and data fields: [`spec/schematic-view.md`](../../spec/schematic-view.md) §9.2 and
[`spec/schematic-view.md`](../../spec/schematic-view.md) §9.2.1. Do not copy them into this file.

### 4.1 Moving a label or a port

A label is addressed by its **net**; a port by its **port id**. Two rules follow, and both are
errors rather than warnings when a tool breaks them:

- A net with **more than one** label on the page cannot be moved by net name — the name does not
  pick a row. Move it by its own row.
- A label or a port placed by hand is **not reseated** afterwards. The write stores the position
  the app sent; `texteda check` then reports `view.label-not-on-net` / `view.port-not-on-net`
  with the distance, if the position is off the net. Snapping back would silently undo a
  deliberate decision.

### 4.2 Writing a `field` override

The `field` section stores a position for one instance's `Reference` or `Value`, in symbol-local
mm. Two things bite:

- The section requires language **`0.10`**. A page that still declares `0.9.2` and gains a
  `field` row is rejected with `format.unsupported-version`. **Raise the `version` line first.**
- The coordinates are **relative to the symbol origin**, so they follow the symbol when it moves
  or rotates. They are not sheet coordinates, and they are not the label/port anchor.

An override is for a place the author *wants* a field to sit. The renderer places a page's
automatic fields together: a field whose place is taken — by a neighbour's body, by another field,
by a wire — steps aside by itself, so no row is needed to keep two fields apart. Write a row when
the text belongs somewhere else, and expect it to stay there while its symbol moves.

## 5. Acceptance checklist

- [ ] The flattened `texteda netlist --json` inventory was used; every net's member pins are
      accounted for, and every drawn member pin is a wire endpoint (not merely crossed by a run).
- [ ] Fresh `texteda review --out` geometry was read after final placement; routes use its pin
      points and body/text boxes rather than guessed or stale coordinates.
- [ ] `view:verify <project>` passes: every coordinate on the `0.5 mm` lattice (§1).
- [ ] `texteda check <project>` has **0 errors**; page-local `view.*` findings are filtered by
      this page's view-file location, with `view.nets-not-drawn` treated as the documented
      project-level exception and no other page-local warning left unexplained.
- [ ] `view metrics` says `0 through a body` and both text gaps `> 0`; crossings are reported but
      are not a failure (no dot means not connected).
- [ ] `fmt:teda --check <project>` passes.
- [ ] The page is wired before it is handed to a human for review; a placement-only page is not a
      review artifact (a deliberately partial research page is the exception and says so).
- [ ] The full render and legible rendered crops show every placed instance's Reference, every
      inventoried endpoint reached by its net, labels/ports on their nets, and no wire/text/body
      collision; crop review is not replaced by metrics or diagnostics.
- [ ] The view file is committed; no generator re-ran over a manual adjustment.
- [ ] The logical design was not edited by this workflow.

For the reference project, the round-trip and metrics tests are the extra gate:

```sh
bun run test packages/cli/test/view-roundtrip.test.ts packages/cli/test/view.test.ts
```

## 6. What not to do

- Do not infer connectivity from a screenshot, a PDF or a rendered image.
- Do not hand a placement-only page to a human as the review artifact; wires are what make the
  circuit readable.
- Do not let the renderer choose positions; do not run an auto-placer.
- Do not add a hop, a curve or a diagonal to dodge a crossing: a crossing with no dot is already
  "not connected". Do not use a crossing where a dot is required, either; a join is a dot.
- Do not assume a dot appears where wires merely meet: a dot is drawn only for a declared `junction`
  row, and a fork with no junction row reads as two separate runs.
- Do not place a coordinate off the `0.5 mm` lattice (§1). There is no free-placement escape hatch
  today; if a position seems to need one, that is a design question, not a coordinate to invent.
- Do not read the view file's `0.01 mm` resolution as the drawing grid. They are different
  questions, and only the lattice is a placement rule.
- Do not let a router choose the wiring. `texteda view rewire` re-anchors ends onto moved pins
  and reseats labels; it does not search for a path, avoid bodies or pins, and it can leave a
  bend off the lattice. It is a repair for a pure placement move, never a substitute for drawing.
- Do not add a `field` row to a page that declares a language older than `0.10`; raise the
  `version` line first, or the page stops parsing.
- Do not overwrite a reviewed view with a regenerated one (ADR-0035).
- Do not commit vendor datasheet PDFs or screenshots.
- Do not treat a `view.*` warning as a circuit error, and do not silence one by deleting the
  record that proves it.

## 7. References

- [`spec/schematic-view.md`](../../spec/schematic-view.md) §5 (wire),
  [`spec/schematic-view.md`](../../spec/schematic-view.md) §9.2 (warnings),
  [`spec/schematic-view.md`](../../spec/schematic-view.md) §9.5 (round-trip).
- [ADR-0035](../adr/09-view/0035-the-view-layer-is-a-drawing.md) D1: the view is an independent description; the
  renderer draws but never places.
- [ADR-0035](../adr/09-view/0035-the-view-layer-is-a-drawing.md) D4、D5: a view is kept, advisory and not
  a build input.
- [ADR-0014](../adr/04-schematic/0014-connectivity-has-one-authority.md): the schematic decides
  connectivity; geometry never does.
- [`docs/skills/new-project.md`](new-project.md): the other end of the toolchain (project →
  netlist).
- [`docs/skills/README.md`](README.md): the index of the procedures.
