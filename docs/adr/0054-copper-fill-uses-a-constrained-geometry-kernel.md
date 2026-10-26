# ADR-0054: Copper Fill Uses a Self-Built Constrained Geometry Kernel

Status: Accepted
Date: 2026-10-26
Related: [ADR-0003](0003-agent-first-pcb-ir.md), [ADR-0018](0018-zero-dependency-and-manufacturing-target.md), [ADR-0034](0034-manufacturing-output-target-form.md), [ADR-0041](0041-connect-pairs-must-be-implemented-by-copper.md), [ADR-0053](0053-layout-and-routing-are-agent-driven.md), `docs/backlog.md` F15 / F49
Impact: `AGENTS.md` §4.3 / §8; `spec/pcb.md` §0 / §4.7 / §5.2; [ADR-0034](0034-manufacturing-output-target-form.md) D9; `docs/backlog.md` F15 / F49; README ADR index. No source syntax, IR schema, or hash rule changes in this record.

## Context

`pcb` stores `zone` as intent: an outline, a net, and a layer. The fill result never enters the IR
([ADR-0003](0003-agent-first-pcb-ir.md) decision 3, `AGENTS.md` invariant 17, `spec/pcb.md` §4.7).
That is the right split: connectivity is decided by `sch` plus `connect`, and a fill cache is a
derived artifact, not a fact.

Gerber cannot emit the intent. It needs actual copper: a filled region with clearances around
other nets, thermal connections for pads on the same net, keepouts removed, and the board edge
respected. The writer therefore needs a fill computation even though the IR carries no fill.

An earlier note in `docs/backlog.md` F15 said the writer should read precomputed filled zones from
the IR. That does not remove the computation; it only moves it into a producer. Somebody still has
to offset polygons, subtract clearances, and compute thermal relief. Calling the result a shard
does not make the geometry engine disappear.

The zero-dependency rule ([ADR-0018](0018-zero-dependency-and-manufacturing-target.md), invariant
20) rules out borrowing a polygon/boolean library for the mandatory path. KiCad may remain an
optional comparison, but it cannot be the thing that makes a manufacturing package correct.

## Decision

### D1. The kernel is ours, and it is constrained

TextEDA owns a small 2D geometry kernel (working package name `packages/geom`). It has no external
runtime dependency, no native module, and no WASM dependency. It is not a general CAD kernel and
does not try to become one.

The supported surface is the one the repository can actually describe today:

- primitives: point, segment, polyline, polygon, rect, rounded rect, circle, oval, capsule;
- operations: point-in-polygon, distance, offset, union, difference, intersection, area, contour
  orientation;
- input and output in integer nanometers, matching the IR's unit convention.

Arcs, Bezier curves, custom pad primitives, HDI microvias, and arbitrary self-intersecting input
are outside the first surface. Unsupported geometry is a diagnostic error; the kernel never
silently approximates it or drops it.

### D2. Fill is computed from intent; the IR stays intent-only

The Gerber writer reads `zone` intent and computes the fill at export. The fill result is not added
to `pcb` IR, not added to the shard tree, and not included in the project hash or the board hash.

A cache may be introduced later as an implementation detail, but it is derived, disposable, keyed
by the exact inputs that produced it, and recomputable by the same kernel. It is never a second
source of truth and never changes what the canonical IR means. If a cache cannot be deleted and
recomputed, it is not allowed.

This keeps invariant 17 intact and resolves the contradiction between `spec/pcb.md` §4.7 and
[ADR-0034](0034-manufacturing-output-target-form.md) D9: the writer reads zone intent, not
precomputed fill.

### D3. Geometry and fill policy are separate layers

The kernel knows shapes and set operations. It does not know nets, clearance rules, thermal
settings, layer names, or Gerber.

Fill policy lives above it: it converts `zone`, `trace`, `via`, pad geometry from the footprint,
`keepout`, board outline, and `rules` into the shapes the kernel operates on, then converts the
result into contours. This boundary matters for two reasons:

- the same kernel can serve the DRC subset and the layout/routing tools
  ([ADR-0053](0053-layout-and-routing-are-agent-driven.md)), instead of a second geometry
  implementation appearing in `packages/core`;
- fill semantics can change without turning the kernel into a PCB-specific program.

### D4. The writer serializes; it does not own geometry

The Gerber/Excellon writer (F15) calls the fill layer and serializes contours, apertures, draws,
flashes, and drill hits. It does not implement its own polygon clipping or offsetting. This keeps
[ADR-0034](0034-manufacturing-output-target-form.md) D9's "the writer does not do geometry" true
without pretending that no geometry happens anywhere.

### D5. Determinism is part of the contract

The kernel must return the same contours for the same inputs on every run and every supported
platform:

- all public coordinates are integer nanometers; floating point may be used internally, but every
  result is quantized back with an explicit rounding rule;
- contours are ordered by a stable rule (layer, net, outer contour, hole, then a documented
  canonical vertex order), never by hash-map iteration;
- coincident points and collinear edges are normalized before operations that need it;
- no global mutable state, no time, no randomness.

The fill layer must expose the rule version it used, so a change in fill semantics is visible in
the manufacturing package even when the `pcb` IR is unchanged.

### D6. Verification uses invariants first, KiCad second

The kernel is tested with geometric invariants, not only pictures:

- `A ∪ B` and `A ∩ B` cover `A` and do not double-count area;
- `A \ B` plus `A ∩ B` reconstructs `A`;
- offsetting by `r` then by `-r` does not grow the shape;
- every output contour is closed, non-degenerate, and consistently oriented;
- the reference board's GND zone produces a deterministic contour set with expected area and hole
 count.

A KiCad fill/Gerber comparison is an optional observation, never the correctness definition
([ADR-0018](0018-zero-dependency-and-manufacturing-target.md)).

### D7. Sequencing

F49 (the kernel) is a prerequisite for F15 on any board with zones. The reference project has a
GND zone, so F15 cannot claim a working manufacturing exit without it.

F14 (the `fab` shard and package) is independent of the kernel: raw Gerber bytes do not need the
manufacturing-neutral data. F14 is required for the self-describing package, not for the copper
geometry.

## Appendix (2026-10-26b): what the first implementation chose

`packages/geom` landed the kernel core the same day. Four decisions below were left open by D5/D6
and are now fixed; they are recorded here because they are visible in the output, not because they
change the split in D1–D4.

- **A region is a set of simple rings, and a boolean returns a disjoint cover of convex pieces.**
  There are no inner rings: a hole is a ring of pieces around the hole. Gerber accepts as many
  regions as the writer emits, so the extra contour-tracing merge step that a holed-contour
  representation would need is not worth its failure modes. This replaces the "hole" half of D5/D6:
  the invariants hold on the cover (no overlap, area adds up, `A \ B` plus `A ∩ B` reconstructs
  `A`), and a hole is asserted as "≥ 4 pieces with no area in the middle".
- **Booleans run on a vertical decomposition**, not a sweep-line Vatti/Martinez. Each output slab is
  a trapezoid, degenerate slivers are dropped instead of repaired, and a bug in one slab cannot
  corrupt the whole topology. Cost is `O(edges²)` crossing detection plus `O(events × active edges)`
  sampling; `union` clusters by touching bounding boxes first so two distant pours are not shredded
  into one shared slab set.
- **Offset is analytic.** Dilation is a closed-form Minkowski sum of each convex piece with the tool
  disc, merged by edge-direction angle in integers, so a trace grown by a clearance is one ring, not
  hundreds of unioned capsules. `erode` uses halfplane clipping only for a single convex ring and
  otherwise is the complement of a dilation of the complement, because erosion does not distribute
  over a union.
- **The tool disc is circumscribed, and the public `circle` is inscribed.** A clearance is a
  guarantee, so growth must be at least `r` and shrinkage must leave no copper closer than `r`; the
  error is `sec(pi/segments) − 1` (0.6 % at 16 segments, 0.05 % at 64). A pad's own radius is a
  declaration, so a `circle` primitive inscribes the requested radius instead.

Canonical form is part of D5 and is implemented as: duplicate and collinear vertices dropped, ring
oriented counter-clockwise, ring rotated to start at its lexicographically smallest vertex, `-0`
erased. Without the rotation, `capsule(a, b)` and `capsule(b, a)` would differ byte for byte.

Quantization is the one place area is lost: crossing x coordinates stay unrounded through a
decomposition and only emitted vertices are rounded to the nanometre with `Math.round`, so bands
thinner than 1 nm collapse. Rounding events early was measured to shift a slanted area from 1153 to
883 mm² and to produce inside-out trapezoids that normalization then deleted.

## Appendix (2026-10-26c): the fill policy and the PCB wire contract

The policy layer and the two writers landed the same day. D3 and D4 said where the split is; this
appendix fixes what actually goes into a file, because those bytes are what a board house reads.

### The policy layer (`packages/core/src/fill/`)

- **A pour cuts around copper, not around nets.** Every pad, trace, via and `physical_only` circle
  becomes a `FillObstacle` with its real outline (a pad's own shape, a trace as one capsule per
  segment), its layers, and its net. A pad whose pin the schematic does not place carries
  `net: null`: it is *no* pour's net, so every pour keeps clear of it. Dropping such copper would let
  a pour flow over metal of unknown potential, which is the one thing a fill must never do.
- **Pair clearance is the larger of the two sides' values.** A `net` rule replaces the board default
  for that net, and a gap has to satisfy both nets, so `max(clearance(a), clearance(b))`. A pad's own
  `clearance_nm` may only widen.
- **`zone_connect` decides, not the net.** A pad declares `solid` / `thermal` / `none`; the default is
  `thermal` for a through-hole pad and `solid` for an SMD pad. Same-net `solid` copper is left alone,
  `none` is cut away with the same clearance, and `thermal` gets a gap ring with four axis-aligned
  spokes (0°/90°/180°/270°) clipped to a ring grown by 1 nm so a spoke overlaps the pour instead of
  merely touching it.
- **`min_width` is an opening, and what it removes is reported** (`drc.zone-min-width` with the lost
  area). It is the one expensive step: 0.15 mm on the reference board costs ~370 ms and takes a
  195-piece pour to 629 pieces while removing 0.005 mm². That measurement is the anchor to decide
  later whether the cost is worth it.
- **Nothing else is clipped.** The pour meets the board outline exactly and no cutout or `no_pour`
  keepout is crossed; copper-to-edge clearance is not expressible in `rules` and is a DRC concern
  (`spec/pcb.md` §7).

### The image and the two writers

`BoardImage` (in `packages/core/src/image.ts`) is the last shape-bearing structure: regions, strokes
and flashes in board nanometres, plus drill hits. `boardImage()` assembles it from the pcb IR, the
placed footprints and the fill output. The writers serialize it and nothing else: no net, no clip, no
kernel call, no clock, no randomness (`packages/exporter/src/gerber.ts`, `excellon.ts`).

**RS-274X, frozen:**

- `%FSLAX46Y46*%` with `%MOMM*%`, leading zeros suppressed, four integer digits and six decimals.
  One unit is therefore 1 nm, so a written coordinate **is** the nanometre count: no rescale, no
  rounding, `-` for negatives.
- Header order: `G04 TextEDA <tool_version>*`, `G04 source <source_hash>*`, format, units, `%LPD*%`,
  then one `%ADDnnC,<diameter>*%` per distinct diameter.
- Apertures are deduplicated, ascending from `D10`, and formatted by integer arithmetic (six
  decimals), never by float `toFixed`. A select is emitted only when the aperture changes.
- Flash `X..Y..D03*`; draw `X..Y..D02*` then one `D01*` per following point; region `G36*` … `G37*`
  with the ring **not repeated** (the last edge closes implicitly).
- Statement order: kind rank (`region` < `draw` < `flash`), then the canonical geometry text. A
  polyline is reversed when its first point sorts after its last, so the same stroke written from
  either end is the same file.
- Every statement ends `*` and a LF; the file ends with exactly one LF after `M02*`.
- File names `<board>-<layer with dots as underscores>.gbr`; an empty layer is still a complete file
  (header, `M02*`), because a missing layer means "undefined" to a board house, not "empty".

**Excellon, frozen:**

- One file `<board>.drl` covering plated and unplated holes; no file at all when the board has none.
- `M48`, `;TextEDA <tool_version>`, `;source <source_hash>`, `;unplated: <n>` (omitted at zero),
  `FMAT,2`, `METRIC,TZ`, tools `T1C<diameter>` ascending from `T1` with six decimals, `%`.
- Coordinates are exact millimetres with trailing zeros dropped and at least one decimal digit
  (`13.0`, `25.2`, `0.000001`), never a fixed digit count.
- Holes are grouped by tool and sorted by `(x, y)`; `M30` ends the file after one LF.

### Known limitations, stated rather than hidden

- Boolean cost is `O(edges²)` crossings; there is no spatial index beyond box pruning. The opening
  in `min_width` is the expensive step.
- Bands thinner than 1 nm collapse: that is the only place the pour loses area.
- No arcs anywhere. A curved rim arrives as a polygon; the radius error is at most
  `r·(1 − cos(π/32))` (~0.5 % of the pad radius, about 1 µm on a 0.5 mm pad) and the circumscribed
  tool cancels its direction.
- A hole is a ring of pieces, so a Gerber file carries many regions where another writer would
  emit one holed contour.
- Copper-to-edge clearance is not checked: the pour meets the board outline exactly, and a
  copper-to-edge rule has no field in `rules` (`spec/pcb.md` §7).
- The manufacturing package (`fab`, ADR-0034) and the `.kicad_pcb` board file are still missing;
  the six side-surface files below complete the layer set a board house reads.

## Appendix (2026-10-26d): mask, paste and silkscreen

The remaining manufacturing layers landed the same day, so a board's file set is now copper, mask,
paste, silk, drills and the edge. The layer set a board house forwards a job with is complete; what
is still missing is the package around it (`fab`) and the KiCad-side board file.

**Mask and paste are openings, not copper.** A mask image states where the covering layer is
*absent*, and a stencil states where paste is deposited. Both therefore start from the pad's own
outline — never from its bounding box, so a `roundrect` keeps its corners:

- **Mask**: the pad's outline grown (or shrunk) by the expansion. `*.Mask` opens on **both** sides,
  because a through-hole barrel is open at both ends; an explicit `F.Mask` on a bottom-side part
  mirrors like its copper.
- **Paste**: the pad's outline scaled about its centre by `sqrt(area ratio)`, then offset per edge.
  Scaling rather than resizing keeps a rotated or rounded pad's shape; the square root is what makes
  `ratio` an area ratio, which is what a stencil specification means. Paste exists only where the
  pad's layers name a paste family, so a through-hole pad gets none.
- **Defaults are the identity and are documented**: absent `mask` is expansion 0 (the opening *is*
  the pad), absent `paste` is ratio 1 offset 0 (the aperture *is* the pad). Written down in
  `spec/pcb.md` §4.9 because these numbers decide a delivered file.
- Openings go through the same kernel: a grown outline comes back as a cover of convex pieces, and
  the tool disc is circumscribed, so a grown opening is never smaller than asked — the safe direction,
  since an opening that is too small leaves covered copper. A shrunk one errs the same way by
  construction: erosion removes a disc of at least the radius, so the remaining area is never larger
  than asked. Collapsing to zero area emits no item rather than a degenerate polygon.
- **Rule ownership**: these two read `pcb.rules` themselves (`mask-paste.ts`) and stay out of
  `FillRules`, which the pour reads. A pad's own `mask=` / `paste=` override the board's rule.

**Silkscreen is a library fact plus a board decision.** The footprint draws (graphics on a silk
layer, plus where its reference and value text sit); the board says which items print, on which
layer, at what height (`pcb.silk`, `spec/pcb.md` §4.10). Consequences frozen here:

- The field's own `layer` does **not** choose the output layer — the board's row does. The field's
  `hide` does gate: the library's assertion is not overridable by layout.
- Text never prints upside down: the baseline direction is placement rotation plus the field's own
  rotation, and half a turn about the centred anchor fixes the cases where it points leftwards. The
  same rule applies on both sides, because a bottom-side string is *mirrored* (which is what makes it
  read correctly from the bottom) and must not then also be turned.
- Width is 10 % of the height (the single-stroke font's own weight, `packages/core/src/font/`); a
  graphic with no `width` uses the 0.12 mm layer default (`spec/footprint.md` §5). The font covers
  printable ASCII, so a character it cannot draw is dropped before it reaches the layer.
- An arc has no kernel representation, so it is tessellated at the drawing (32 segments per turn);
  both endpoints stay exact.
- **No avoidance.** Silk is emitted as declared, including over pads. Silk clipping and mask-sliver
  judgement are CAM rules, and ADR-0018 keeps those out of the writer.

**Layer order and empty files.** Copper from the stackup, then each side's `Mask` / `Paste` / `SilkS`
(top side first), then `Edge.Cuts`, then the drill file. An empty non-copper layer still gets a
complete file (header + `M02*`): a missing file means "layer not defined", an empty one means
"nothing on this layer". A single-sided board emits the top side only, decided by the stackup, not by
a flag.

**The font moved to `packages/core/src/font/`.** Assembly needs it (silk text) and the renderer needs
it (drawing), and `core` is the lower layer: `renderer → core` is acyclic, `core → renderer` would
invert the dependency. D4 said the *renderer* owns text layout; that was true while the only consumer
was the drawing, and it is not true now. Layout code is unchanged; only its home and its import path
moved.

## Hard parts recorded now

These are known to be hard; none of them is assumed solved by "write a polygon library".

| Hard part | Why it is hard | Initial position |
|---|---|---|
| Polygon boolean robustness | Near-coincident edges, collinear overlaps, touching-only intersections, and self-intersections produce wrong topology if handled with naive floating-point clipping | Normalize inputs, use exact orientation predicates where feasible, and reject unresolved self-intersection instead of guessing |
| Offset joins | A clearance around a rect/roundrect/oval/capsule is not just a larger rectangle; joins and negative offsets change topology | Offset primitives analytically where possible; only fall back to polygon offset for free-form polygons |
| Holes and Gerber contours | A filled zone with holes cannot be emitted as one naive polygon; winding and contour orientation matter | Define outer/hole orientation once; emit holes as separate contours or as clear regions only if the Gerber spec requires it |
| Thermal relief | Spokes need a cleared ring, a connection pattern, and solid-vs-thermal behavior per pad; the result must not create isolated islands | Start with a documented spoke count/width/angle policy from `rules.thermal`; reject unsupported combinations |
| Minimum width and smoothing | `rules.min_width` is a manufacturing constraint, not a display filter; removing thin necks can disconnect a zone | Treat min-width as a separate narrowing pass with explicit diagnostics; do not silently delete copper |
| Board edge, cutouts, keepouts | Zones often extend outside the board or into keepouts; clipping order changes the result | Clip to the board outline first, then subtract keepouts and cutouts; report a zone that has no remaining area |
| Multiple zones on one layer | Same-net zones may merge; different-net zones must not touch; overlap priority is not defined by the current IR | Define deterministic priority and report overlap between different nets as a check error before filling |
| Through-hole and via obstacles | A via or TH pad exists on several layers; clearance applies per copper layer; annular ring is not the drill | Build obstacles per layer from the footprint pad type and via span, not from the drill diameter |
| Same-net copper | A same-net trace or pad must connect, not be cleared; a different-net trace crossing a zone must be cleared and redrawn | Classify every obstacle by net before the fill pass; never infer connectivity from the fill result |
| Float-to-integer reproducibility | Small numerical differences can flip a contour or a rounding decision | Quantize at declared boundaries, document the rounding rule, and avoid platform-dependent math |
| Performance and spatial indexing | Large boards have many pads, traces, and zone vertices; naive pairwise clipping is quadratic | Start with a bounding-box index; optimize only against measured boards |
| Oracle design | Gerber viewers show pixels, not topology; a visual diff is not a correctness test | Assert area, hole count, contour count, and layer membership first; use KiCad/Gerber comparison as a secondary observation |
| Cache ownership | A cache can become a second truth if it is hashed or edited | Keep it out of the IR and hashes; key it by inputs; delete-and-recompute must always work |

## Non-goals

- A general-purpose CAD or computational-geometry kernel.
- Arcs, Bezier curves, custom pads, or HDI in the first surface.
- An autorouter or placer; [ADR-0053](0053-layout-and-routing-are-agent-driven.md) still holds.
- CAM-grade DFM judgement: mask expansion, paste volume, silkscreen clearance, and impedance
  manufacturability remain professional CAM work.
- A fill cache that is part of the canonical IR or the project hash.
- Using KiCad's fill engine on the mandatory path.

## Open questions

1. Exact fill algorithm: scanline fill, polygon offset plus boolean, or a hybrid. The choice is an
   implementation decision, but it must satisfy D5 and D6.
2. Zone priority when two different-net zones overlap on one layer. The current IR has no priority
   field; the check should probably reject the overlap before fill.
3. ~~Whether `rules.min_width` narrows the fill, removes islands, or both~~ **answered (2026-10-26c)**:
   it is an opening (erode then dilate, intersected with the input), so it both narrows and removes
   islands thinner than the rule; the loss is reported as `drc.zone-min-width`.
4. Whether a derived fill cache is needed at all after measuring the reference board and a dense
   board.
5. ~~The Gerber layer map, aperture policy, and Excellon format remain F15 work~~ **answered
   (2026-10-26c)** in the appendix above: the layer map, aperture numbering, statement order and the
   Excellon layout are frozen there.

## Consequences

- `docs/backlog.md` F15 no longer claims that RS-274X alone removes the geometry problem; F49 is
  the prerequisite for zones.
- [ADR-0034](0034-manufacturing-output-target-form.md) D9 is amended: the writer reads zone intent
  and computes fill through this kernel; it does not read precomputed filled zones from the IR.
- `spec/pcb.md` §4.7 names the recomputation path and keeps fill out of the IR.
- `AGENTS.md` §8 records the kernel as a self-built, constrained component, not a borrowed CAD
  kernel.
- The first Gerber slice can still be a board without zones, but that is a test slice, not the
  manufacturing exit: the reference board has a ground pour.
- `texteda export gerbers <project> <board>` is the entry point (2026-10-26c); the copper and drill
  files it writes are traceable to the project hash, and the pour is recomputed on every run.
