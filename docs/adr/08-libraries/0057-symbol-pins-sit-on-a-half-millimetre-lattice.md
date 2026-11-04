# ADR-0057: Symbol Pin Connection Points Sit on a 0.5 mm Lattice

Status: Accepted
Date: 2026-11-03
Scope: Decides: the coordinate lattice a symbol's pin connection points and pin tails must sit on, the regular pin pitch those rows use, and the review app's placement grid. Does not decide: the view file's own coordinate resolution (`0.01 mm`, [spec/schematic-view.md](../../../spec/schematic-view.md) §4), footprint pad geometry ([ADR-0030](0030-footprint-format-and-geometry.md)), and how a print page is laid out — the page's own coordinates are decided by [ADR-0059](../09-view/0059-print-page-coordinates-anchor-on-the-half-millimetre-lattice.md).
Related: [ADR-0031](0031-symbol-format.md), [ADR-0030](0030-footprint-format-and-geometry.md), [ADR-0035](../09-view/0035-the-view-layer-is-a-drawing.md), [ADR-0056](../09-view/0056-the-review-app-has-one-interaction-surface.md), [ADR-0058](0058-pin-rows-on-a-number-bearing-symbol-are-at-least-two-and-a-half-millimetres-apart.md), [ADR-0059](../09-view/0059-print-page-coordinates-anchor-on-the-half-millimetre-lattice.md)
Impact: `spec/symbol.md` §4 and `spec/symbol.md` §4.1 (new) state the lattice rule, with no new diagnostic; `packages/viewer/src/placement.ts` moves the placement grid from `0.05 mm` to `0.5 mm`; every symbol in `examples/` is re-authored; `views/charger-buck/buck-5v.view.teda` is re-derived.

## Context

The review app moves a placed symbol on a snap grid (`snapPlacement()`), and a print page's wires must stay orthogonal (`view.wire-diagonal`, [spec/schematic-view.md](../../../spec/schematic-view.md) §5). Those two rules only meet if a pin's connection point lands where a wire bend can reach it:

- Wires are drawn between **pin connection points** and **bend points**, in millimetres with `0.01 mm` resolution.
- The placement grid was `0.05 mm`, while pins sat at KiCad-shaped offsets such as `±3.81`, `±15.24`, `±2.54` — multiples of `1.27`, which is not a multiple of `0.05` in a way that survives rotation.
- Consequently a symbol dropped on the grid put its pins at coordinates a wire could not reach with an axis-aligned segment whose other end was on the grid. The drafter had to invent off-grid bends, which is exactly what `view.wire-diagonal` reports.

Measured before this decision (`examples/reference-project/assets/symbols` plus `examples/cases`, 34 symbol files, 26 distinct geometries): **0 of 34** files had every pin connection point on a `0.5 mm` lattice, and the largest deviation was `0.25 mm`. Every symbol, not a handful, was non-conforming.

The existing house style (`docs/skills/library-authoring.md` §4.2) said `1.25 mm` pin pitch and a `0.05 mm` geometry grid. `1.25` is an odd multiple of `0.25` and `0.05`, so an even pin count on a side lands symmetric about the origin only for some counts, and a `0.05 mm` grid is finer than any wire bend needs to be.

## Decision

### 1. The lattice is `0.5 mm`, and it covers the pin's whole drawn length

A symbol's pin **connection point** and that pin's **inner end** (the point where its tail meets the body) are exact multiples of `0.5 mm` in the symbol's local frame. `length` is therefore also a multiple of `0.5 mm`, and a regular pin row is a multiple of `0.5 mm` apart.

The inner end is part of the rule because a wire must be able to leave a pin and reach a corner; a connection point alone would leave the tail hanging at an arbitrary offset, and the tail is the only part of the pin a reader sees as a line.

### 2. Regular pin rows are at least `2.5 mm` apart, anchored per pin

The pitch and the anchoring rule live in [ADR-0058](0058-pin-rows-on-a-number-bearing-symbol-are-at-least-two-and-a-half-millimetres-apart.md): a symbol that draws its pin numbers keeps adjacent same-side pins at least `2.5 mm` apart, and every pin point is a lattice point on both axes rather than part of a row forced symmetric about the origin. Decision 1 above still decides *which* lattice; the pitch is no longer this record's, and the `2.0 mm` value this section originally chose is retired along with the centring rule that produced it.

### 3. The body frame moves with the pins

A visible `rect` body's edge is where the pin tails end, so the frame's coordinates are on the lattice too. Symbols whose body is decorative artwork rather than a frame (`r`, `c`, `l`, `d`, `led`, `thermistor`, `sw-push`, `c-pol`, `nmos-5`) keep their glyph and only their pin rows and tails move onto the lattice.

### 4. The review app's placement grid is `0.5 mm`

`snapPlacement()` snaps to `0.5 mm`, so a symbol dropped on the grid keeps every pin on the lattice and a wire can always be drawn orthogonally to it. The **view file's** coordinate resolution stays `0.01 mm` (`VIEW_GRID_NM = 10_000`): resolution is what the format can express, and the lattice is what the drawing convention uses. They are different questions, and changing `VIEW_GRID_NM` would break canonical form and every length diagnostic.

### 5. A connector's drawing is not its land pattern

`hdr-1x4`, `jst-sh-4`, `hdr-1x3`, and `hdr-2x5` draw their rows at the house-style pitch while their real pad pitch (`2.54 mm`, `1.0 mm`) lives in the footprint ([ADR-0030](0030-footprint-format-and-geometry.md)). The drawn pitch is [ADR-0058](0058-pin-rows-on-a-number-bearing-symbol-are-at-least-two-and-a-half-millimetres-apart.md) decision 5, which supersedes the `2.0 mm` value here. The symbol is a view, not a package; the two lattices answer different questions and neither may be rounded to match the other.

### 6. Footprint geometry is out of scope

Physical pad centres and sizes keep the datasheet's values even when they fall off `0.5 mm` (§4 of [ADR-0030](0030-footprint-format-and-geometry.md) already says geometry is the footprint's). A symbol's lattice never propagates into a pad's coordinates.

## Consequences

- A print page can be drawn entirely with axis-aligned wire segments whose ends are pin points and whose bends are lattice points; `view.wire-diagonal` becomes a signal about a real error rather than a consequence of KiCad-shaped pins.
- Every symbol in `examples/reference-project/assets/symbols`, every symbol under `examples/cases/*/assets/symbols/`, and the case expectations (`expected/ir/**`, `expected/netlist.txt`, `expected/manifest.json`) changed together — the pin coordinates are in the IR shards.
- `views/charger-buck/buck-5v.view.teda` was re-derived rather than nudged: with every pin moving, its `place` rows and every wire endpoint change at once.
- The house style changes from "`1.25 mm` pitch, `0.05 mm` grid" to "at least `2.5 mm` pitch on a numbered symbol, `0.5 mm` lattice" (`docs/skills/library-authoring.md` §4.2, §4.3, §8), and the guides that told a reader to snap to `0.05 mm` follow. The pitch half of that sentence was superseded by [ADR-0058](0058-pin-rows-on-a-number-bearing-symbol-are-at-least-two-and-a-half-millimetres-apart.md).
- No diagnostic code is added or retired: the rule is an authoring convention, checked by the library verifier and by review, not by `check`.
