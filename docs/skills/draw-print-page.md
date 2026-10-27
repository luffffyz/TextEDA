# Skill: Draw and Review a Print Page (S1)

> **Status**: first draft (2026-10-25). The commands below were run on
> `examples/reference-project`.
> **Audience**: agents (humans can follow it too).
> **Scope**: `views/<board_id>/<page_id>.view.teda` only. A drawing never changes
> `design/**`, `assets/**`, the netlist, the BOM or the PCB.

This file is English on purpose: a skill is an operating manual for an agent, not a design
document (see `AGENTS.md` §12).

## 0. What this skill is for

How to produce one reviewable print page: where the symbols sit, how the wires run, which labels
and ports go where, and **which diagnostic code to look at when the page is wrong**.

The normative rules are not repeated here. The definitions live in
[`spec/schematic-view.md`](../../spec/schematic-view.md) §5 and §9.2; the code table is
`docs/error-codes.md`, generated from `packages/ir/src/diagnostics/codes.ts`. This skill only gives
the command loop, the two authoring modes, and the repair action for each code.

## 1. Prerequisites

Run from the repository root (`REPO`):

```sh
REPO=/path/to/TextEDA
```

The commands used below:

| Command | What it does |
|---|---|
| `bun run texteda check <project>` | Parse, contract validation, ERC, binding and drawing checks. Errors block; warnings do not. |
| `bun run texteda view-metrics <project> <board>/<page>` | The drawing's numbers: sheet use, counts, label/text gaps, wire length, crossings, bodies. |
| `bun run preview view <board>/<page> [--project <project>] [--out <dir>]` | Render one page to SVG and print its path. |
| `bun run texteda review <project> [--out <file>]` | Serve `review` mode on `127.0.0.1`; `--out` writes the same self-contained HTML. |
| `bun run fmt:teda <project>` / `bun run fmt:teda --check <project>` | Canonicalise the view; `--check` is the gate. |

The page needs two inputs:

1. the **logical** design (`design/sch/<board_id>.teda` plus modules and components) — the source
   of nets and pins;
2. the **view** file (`views/<board_id>/<page_id>.view.teda`) — the only source of positions and
   wires.

A board with no view file has no drawing. That is legal; do not invent one.

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
  `design/sch/**`; a view wire must name pins that the logical net already contains
  (`view.pin-net-mismatch` is an error). Deriving a netlist from geometry breaks the project's
  invariant 2; the image cannot overrule the logical IR.
- **A screenshot of a different circuit is only inspiration.** Do not copy its net names or part
  identities. If it is the same circuit, it is still only a cross-check, not the authority.
- **Do not commit the screenshot or the datasheet PDF.** Vendor figures are copyrighted; keep them
  local (the reference project's `docs/datasheets/` is gitignored) and cite the source in prose if
  needed.
- **Snap to the view's 0.01 mm grid.** Image coordinates are approximate; write rounded `place`
  rows. Any OCR/vision step is an authoring aid outside the language; it produces text for review,
  not an IR input, and it adds no runtime dependency.

Procedure:

1. Read the reference and decide a rough arrangement.
2. Write only the `place` rows (instance id, `x`, `y`, rotation) in the view file. This is an
   intermediate: the page handed over for review is wired (§2.4).
3. Run `view-metrics` to check the sheet is used and parts do not collide.
4. Route the wires from the logical netlist with Mode B. Do not trace the reference's lines.

### 2.2 Mode B: human-owned placement, agent wiring (the finish)

This is the finish, not a seed: the renderer never places anything
([ADR-0021](../adr/0021-schematic-view-layer.md) decision 2). The human owns the final positions
(however they were seeded), the agent writes the wires, and the human reviews the wired page.
The initial placement can come from a reference, an agent proposal, or the human.

Procedure:

1. **Place.** Write the `place` rows (or accept a proposed placement). The view grid is 0.01 mm;
   pin pitch is 1.27 mm (127 steps), so orthogonal runs stay on the grid.
   - **Default:** place, then route (step 2) and hand over a wired draft. The human reviews
     placement and wiring together.
   - **Optional:** when the human explicitly wants to settle positions first, or the rearrangement
     is large, render a placement-only page with `preview view`, ask the human to move parts or
     name coordinates, and route after acceptance. A view with `place` and no `wire` section is
     legal; `view-metrics` will report `nets undrawn`, which is expected at this stage. This page
     is not the review artifact.
2. **Route from logic.** For each net with two or more members, read the member pins and their
   connection points from the symbols, then write `wire` rows:
   - `<net> <from_pin> <to_pin> [bend_x bend_y ...]`; both endpoints must be members of the net;
   - every segment is horizontal or vertical (`view.wire-diagonal` forbids slants);
   - route around symbol bodies (`view.wire-crosses-symbol`) and foreign pin connection points
     (`view.wire-crosses-pin`). A plain crossing of another net is legal: no dot means "not
     connected". Keep crossings low for readability, but do not contort a route to avoid one;
   - a pin in the middle of a run is not a junction: split the run into a second `wire` row or
     route around it;
   - split a net with more than two pins into several rows; junction dots are derived from the
     geometry (three or more arms of one net), never written;
   - put labels and ports on their own net (`view.label-not-on-net` /
     `view.port-not-on-net`);
   - every member pin of a drawn net should be an endpoint of at least one row. The checker
     reports undrawn **nets** (`view.nets-not-drawn`), not undrawn pins; verify pin coverage on
     the rendered page.
3. **Freeze.** The routed rows are source, not a cache. Do not regenerate them over manual
   adjustments; when the placement changes, re-route the affected nets by hand or with a
   deterministic generator and review the diff. If the human has edited a wire, reroute only on an
   explicit request and keep the human edit in the diff.
4. **Verify** with the command loop in §3.

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
([ADR-0032](../adr/0032-view-is-a-drawing-not-a-build-input.md)). Re-route only on an explicit
request and show the diff.

The planned `layout` mode is the one place a human moves a symbol from the canvas: select one
symbol, drag it, rotate it by 90 degrees. Selection does not navigate: a single click only selects;
`Enter` or a double-click opens the definition menu (parameters, view placement, component file).
Drag/rotate only edits the pending placement. It is not a live
route: `Apply` writes the `place` rows and recomputes the affected nets (the moved symbols' nets,
the nets the new geometry collides with, and their labels/ports). Until `Apply` the page is stale:
the old wires stay with stale bends, and `view.wire-diagonal` / `view.wire-crosses-pin` are the
signal. Do not run a router on every drag frame. Placement snaps to
1.27 mm (or the symbol's pin pitch); the view's 0.01 mm grid is storage precision. The first form
selects one symbol. `layout` is not built yet; this is its contract
([ADR-0021](../adr/0021-schematic-view-layer.md) 2026-10-25 appendix).

## 3. The command loop

### 3.1 Check the project

```sh
bun run texteda check examples/reference-project
```

Expected tail:

```
Checked 2 boards: 0 errors, 135 warnings (stages: parse 47 · contract 0 · design 93)
```

Errors block the build; warnings do not. `view.*` warnings are drawing findings, not circuit
errors. Use `--json` when a script needs the payload.

### 3.2 Measure the page

```sh
bun run texteda view-metrics examples/reference-project charger-buck/buck-5v
```

Expected shape (the numbers move with the page):

```
charger-buck/buck-5v — 297.0 × 210.0 mm sheet
content   x 20.0..254.5  y 14.0..173.8 mm  (60.1% of the sheet)
counts    9 instances, 9 labels, 2 ports, 1 notes, 15 wires, 30 nets undrawn
spacing   label min gap 6.7 mm, text min gap 6.7 mm
wires     798.5 mm total, 1 crossings of other nets, 0 through a body
net texts all sit on their nets
```

Read it as:

- `through a body` must be **0** for a finished page; `crossings of other nets` is a readability
  number, not a rule: a crossing with no dot is not a connection, so a few are legal;
- `label min gap` / `text min gap` must be **> 0** (no overlap);
- `net texts all sit on their nets` means every label/port's anchor is on its net;
- `nets undrawn` is a board-level count; a research page may legitimately be nonzero, but a
  finished page should say 0.

### 3.3 Look at it

```sh
bun run preview view charger-buck/buck-5v --project examples/reference-project
```

The SVG path is printed; open it or embed it. For the interactive review, run
`bun run texteda review examples/reference-project` and open the printed `127.0.0.1` URL.

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
| `ref.unknown-instance` / `ref.unknown-net` / `ref.unknown-port` | The view names an id the board does not have | Fix the id; do not add a second source of truth |
| `view.pin-net-mismatch` | A wire endpoint pin is not a member of the row's net | Change the endpoint or the net; the logical netlist wins |
| `view.out-of-sheet` | A record sits outside the sheet | Move it inside |
| `view.nets-not-drawn` | A net with ≥2 members has no wire and no label on any page | Draw it or put a label on it |
| `view.label-not-on-net` / `view.port-not-on-net` | A label or port is not on its net's wiring | Move its anchor onto a wire or pin of that net |
| `view.wire-crosses-symbol` | A wire runs through a symbol body | Route around the body |
| `view.wire-diagonal` | A segment is not horizontal or vertical | Add a corner where the run turns |
| `view.wire-crosses-pin` | A wire passes through a pin connection point that is not its own endpoint | Split the run at the pin, or route around it |
| `view.text-overlap` / `view.label-collision` | Two pieces of text overlap | Move one; overlap area must be zero |
| `view.text-on-wire` | A wire runs through text (including a symbol's Reference/Value) | Move the text or reroute the wire |

Definitions and data fields: [`spec/schematic-view.md`](../../spec/schematic-view.md) §9.2 and
[`spec/schematic-view.md`](../../spec/schematic-view.md) §9.2.1. Do not copy them into this file.

## 5. Acceptance checklist

- [ ] `texteda check <project>` has **0 errors**; every `view.*` warning is fixed or explicitly
      accepted (a research page can keep `nets-not-drawn`).
- [ ] `view-metrics` says `0 through a body` and both text gaps `> 0`; crossings are reported but
      are not a failure (no dot means not connected).
- [ ] `fmt:teda --check <project>` passes.
- [ ] The page is wired before it is handed to a human for review; a placement-only page is not a
      review artifact (a deliberately partial research page is the exception and says so).
- [ ] The rendered page (`preview view` or `review`) shows every placed instance's Reference and
      the labels/ports on their nets.
- [ ] The view file is committed; no generator re-ran over a manual adjustment.
- [ ] The logical design was not edited by this workflow.

For the reference project, the round-trip and metrics tests are the extra gate:

```sh
bun test packages/cli/test/view-roundtrip.test.ts packages/cli/test/view-metrics.test.ts
```

## 6. What not to do

- Do not infer connectivity from a screenshot, a PDF or a rendered image.
- Do not hand a placement-only page to a human as the review artifact; wires are what make the
  circuit readable.
- Do not let the renderer choose positions; do not run an auto-placer.
- Do not add a hop, a curve or a diagonal to dodge a crossing: a crossing with no dot is already
  "not connected". Do not use a crossing where a dot is required, either; a join is a dot.
- Do not write a junction record; the dot is derived.
- Do not overwrite a reviewed view with a regenerated one (ADR-0032).
- Do not commit vendor datasheet PDFs or screenshots.
- Do not treat a `view.*` warning as a circuit error, and do not silence one by deleting the
  record that proves it.

## 7. References

- [`spec/schematic-view.md`](../../spec/schematic-view.md) §5 (wire),
  [`spec/schematic-view.md`](../../spec/schematic-view.md) §9.2 (warnings),
  [`spec/schematic-view.md`](../../spec/schematic-view.md) §9.5 (round-trip).
- [ADR-0021](../adr/0021-schematic-view-layer.md): the view is an independent description; the
  renderer draws but never places.
- [ADR-0032](../adr/0032-view-is-a-drawing-not-a-build-input.md): a view is kept, advisory and not
  a build input.
- [ADR-0035](../adr/0035-connectivity-authority-and-reverse-engineering.md): the schematic decides
  connectivity; geometry never does.
- [`docs/skills/new-project.md`](new-project.md): the other end of the toolchain (project →
  netlist).
