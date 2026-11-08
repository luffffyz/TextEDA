# ADR-0065: A Coordinate Tuple Is One Cell

Status: Accepted
Date: 2026-11-08
Scope: Decides: that a geometric value — a point, a size, an offset — is written as one bracketed lexical cell `[a,b]` whose arity is fixed by the column, and that a list of points is a sequence of such cells; single scalars (length, angle, ratio) stay plain cells. Does not decide: the drawing lattice a page's coordinates must land on — see [ADR-0059](../09-view/0059-print-page-coordinates-anchor-on-the-half-millimetre-lattice.md); what a wire endpoint may name — see [ADR-0062](../09-view/0062-a-run-may-end-at-a-port.md).
Related: [ADR-0001](0001-fact-layer-has-no-expressions.md), [ADR-0002](0002-one-language-version-number.md), [ADR-0003](0003-diagnostic-error-codes.md), [ADR-0030](../08-libraries/0030-footprint-format-and-geometry.md), [ADR-0031](../08-libraries/0031-symbol-format.md), [ADR-0035](../09-view/0035-the-view-layer-is-a-drawing.md), [ADR-0057](../08-libraries/0057-symbol-pins-sit-on-a-half-millimetre-lattice.md), [ADR-0059](../09-view/0059-print-page-coordinates-anchor-on-the-half-millimetre-lattice.md), [ADR-0062](../09-view/0062-a-run-may-end-at-a-port.md)
Impact: `spec/teda.md` §4.3, §12, §13.4; `spec/schematic-view.md` §4–§7, §11; `spec/pcb.md` §4, §6; `spec/symbol.md` §2, §4, §6; `spec/footprint.md` §2, §4, §5, §8; `packages/parser/src/{view,pcb,symbol,footprint,fmt,fmt-view,fmt-pcb}.ts`; `packages/cli/src/layout.ts`; `scripts/migrate-0.11.ts`; `schemas/ir/**`; `examples/**`

## Background

A point in this language has always been written as **two cells**: `place` is
`<instance_id> <x> <y> [<rot>]`, a pad is `number type shape x y w h`, a wire bend is a run
of `x y` pairs. The cells are separated by whitespace like every other column, so
**the number of columns in a row depends on how many points it carries**, and a point is
not one thing in the source: it is two unrelated tokens that happen to sit next to
each other.

Three costs came out of that, and they got worse as the surface grew.

**A missing number moves the rest of the row.** `U1 10.0` (one coordinate where two are
required) does not fail at the coordinate; it fails at the rotation column, or the
key=value tail, or it parses as something else entirely. The parser has to count cells
first and decide what each one means afterwards, so the diagnostic it can honestly emit is
`syntax.row-too-short` at column 1 — "this row is wrong" rather than "this point is
missing".

**A point has no column.** Diagnostics carry a file, a line and a **column**. With `x` and
`y` as separate cells, `view.out-of-sheet` can point at `x` or at `y`, but nothing in the
language says they belong together; the `[x,y]` form the `junction` section already uses
was the first construct where this was not true, and it was chosen for exactly this
reason. A tuple that is one cell has one column, and its two components still have
offsets inside that cell for a diagnostic that wants to be exact.

**Alignment stops working.** Canonical form aligns columns to the widest cell in the
section. A row whose point count varies (`wire` bends, `trace` points, polygon vertices)
cannot be aligned by column, so the `wire` section already carries a documented
exception: "bend points are printed in pairs" because splitting them would break the
pairing (`spec/schematic-view.md` §11, `spec/pcb.md` §6.2, `spec/teda.md` §12 rule 3).
That exception is a workaround for tuples pretending to be columns. A tuple that is
one cell needs no exception.

The precedent already exists in the same language, and it is not accidental: `field
at=-6.5,20` and `model offset=x,y,z` put a geometric tuple in **one `key=value` cell**
with commas inside, because a key=value cell cannot contain whitespace. So the language
already knows two spellings for a point — `x y` in a table and `x,y` inside an attribute —
and the second one is the one that behaves.

`docs/backlog.md` F60 wrote the bracket form for `junction` as a local choice: "use a
bracketed coordinate tuple with no whitespace inside, `[x,y]` ... Keep ordinary
space-separated `x y` fields unchanged elsewhere". The owner's finding is that this
split is the defect, not the fix: **one language should not have two ways to write a
point, and the better one should not be limited to the newest section.**

## Decision

### D1. A Geometric Tuple Is One Bracket Cell

A value that is a **tuple** — a point, a size, an offset, a rotation triple — is written
as **one cell**, `[a,b]` or `[a,b,c]`, with no whitespace inside. Its arity is fixed by
the column that consumes it, never inferred from the row.

| Kind | Written | Example |
|---|---|---|
| point | `[x,y]` | `M2.U1  [140.0,105.0]  0` |
| size | `[w,h]` | `1  smd  roundrect  [-0.95,0.95]  [1.1,0.6]` |
| offset | `[x,y,z]` | `model foo.step offset=[0,0,1.5]` |

A **single scalar** — one length, one angle, one ratio — stays a plain cell: `[3.3]` is
not a tuple, and bracketing a scalar would be ceremony without a rule behind it. So
`width 0.25`, `rot 90` and `rratio 0.25` are unchanged.

### D2. A List of Points Is a List of Cells

Where a row carries an open-ended run of points — `outline` vertices, `trace` bends,
`zone` and `keepout` rings, wire bends, `poly` and `arc` geometry, pad lists — the run is
a sequence of **one cell per point** (plus one cell per scalar that follows the arity of
the shape):

```
outline
  [0,0]
  [40,0]
  [40,30]
  [0,30]

trace
  VBUS  F.Cu  0.25  [8.0,6.0]  [12.0,6.0]  [12.0,9.0]

wire
  GND  J_GND_C3  M2.C3.2  [220.0,99.5]  [230.0,122.5]  [213.5,122.5]
```

The count of points is now the count of cells in that run: `[x,y]` cells cannot be
half-present, so "the run has an odd number of coordinates" stops being a possible
mistake instead of a diagnostic (`value.invalid-value`, "coordinates must come in
pairs") that has to be written for every section.

### D3. The Same Rule Applies to Every Description Type

The tuple rule is language-wide: any geometric tuple has one lexical cell. The coordinate-bearing
columns currently affected are these:

| Description | Tuple columns |
|---|---|
| `view` | `place` origin, `field` offset, `junction`, `wire` bends, `label`, `port`, `text` position |
| `pcb` | `outline` vertex, `place` origin, `trace` bend, `via` position, `zone`/`keepout` vertex, `physical_only` reference point |
| `symbol` | `pins` connection point, `body` geometry (`line`/`rect`/`circle`/`arc`/`poly`), `field at=`, `field size=` |
| `footprint` | `pads` position and size, `graphics` geometry, `field at=`, `field size=`, `model offset=` |

`key=value` cells whose value is a tuple keep the key and gain the brackets:
`at=[-6.5,20]`, `size=[1,1]`, `offset=[0,0,1.5]`, `rot=[0,0,90]`, `scale=[1,1,1]`.

### D4. A Tuple Fails as a Whole, and Says Which Component

A malformed tuple is one diagnostic at the tuple's column: brackets required, exactly the
arity the column fixes, no whitespace inside. The message names the expected arity, so
`[10.0]` where a point is required is "a point is `[x,y]`", not "row too short".

The components inside a tuple keep their own offsets, so a finding about one coordinate
(a length off the `0.01 mm` grid, a point off the sheet) still points at that component
while the cell remains the unit of alignment and of "one geometric value".

### D5. This Is a Breaking Change: `0.10` → `0.11`

Files written in the old form are **not** accepted. The old form does not fail ambiguously
— `10.0 10.0` is simply not a tuple — but it cannot be accepted by a reader that expects
one cell per point, and accepting both would revive the defect this record removes. So
the language takes an explicit MINOR step (ADR-0002 D5). The reader floors for the four
geometric description types (`view`, `pcb`, `symbol`, `footprint`) advance to `0.11`; other
description types retain their existing floors and version lines.

The migration has two halves, and only the first is mechanical:

1. **`bun run migrate:0.11 <project dir>`** rewrites the `version` line for those four
   geometric types, updates the project's `format`, and folds each run of coordinate cells
   into `[x,y]`. It reads and writes text, so it works on files the current parser refuses.
2. **The author's half**: no judgment is needed for valid old rows. The fold is complete —
   `x y` becomes `[x,y]`, and a tuple column that was already `key=value` gains brackets
   around its existing value.

Unlike the `0.9.2` asset-directory migration, this one decides nothing: every tuple's
arity is fixed by the column, and the arity in the old file is exactly the number of
cells the column consumed. A file whose row does not have the arity its column requires
was already invalid, and the script leaves it for the parser to report.

## Consequences

- **One way to write a point.** The `key=value` spelling (`at=-6.5,20`) and the table
  spelling (`[x,y]`) carry the same tuple; the brackets are what makes them one form.
- **`syntax.row-too-short` stops being the finding for a malformed point.** The row
  either has the cells the section requires, or the tuple is malformed and says which
  arity it wanted.
- **The alignment exception goes away.** `wire` bends and `trace` points no longer need
  the "printed in pairs" rule, because a pair is one cell.
- **The `0.01 mm` resolution, the `0.5 mm` lattice, the right-angle rule, the junction
  graph and the `wire` endpoint identity rules are untouched.** This record changes how a
  tuple is spelled, not what it means.
- **`REF`/`Value` field overrides, ports, labels** keep their semantics; only their
  coordinates become tuples.
- **IR is unchanged.** The IR already stores `x_nm` / `y_nm` as separate integers
  (ADR-0005: no floating point, no nested tuples for values that are just points); a
  surface change does not move the contract. `ir_version` does not move for this.

## Migration

`bun run migrate:0.11 <project dir>`:

| Section | Old | New |
|---|---|---|
| `view` `place` | `M2.U1  140.0  105.0  0` | `M2.U1  [140.0,105.0]  0` |
| `view` `field` | `M2.C3  Reference  2.0  -3.0` | `M2.C3  Reference  [2.0,-3.0]` |
| `view` `junction` | `J1  [220.0,101.5]` | unchanged |
| `view` `wire` | `…  220.0 99.5  230.0 99.5` | `…  [220.0,99.5]  [230.0,99.5]` |
| `view` `label` / `port` / `text` | `GND  130.0  121.0` | `GND  [130.0,121.0]` |
| `pcb` `outline` | `0.0 0.0` | `[0.0,0.0]` |
| `pcb` `place` | `U1  12.0 12.0  0  top` | `U1  [12.0,12.0]  0  top` |
| `pcb` `trace` | `VBUS  F.Cu  0.25  8.0 6.0  12.0 6.0` | `VBUS  F.Cu  0.25  [8.0,6.0]  [12.0,6.0]` |
| `pcb` `via` | `VBUS  12.0 6.0  0.6  0.3` | `VBUS  [12.0,6.0]  0.6  0.3` |
| `pcb` `zone` / `keepout` | `GND  B.Cu  0.0 0.0  40.0 0.0 …` | `GND  B.Cu  [0.0,0.0]  [40.0,0.0] …` |
| `pcb` `physical_only` | `H1  mounting  5  5  6  3.2` | `H1  mounting  [5,5]  6  3.2` |
| `symbol` `pins` | `1  -12.5  -13.5  0` | `1  [-12.5,-13.5]  0` |
| `symbol` `body` | `rect  -10,-16.5,10,16.5` | `rect  [-10,-16.5,10,16.5]` |
| `symbol` `field` | `field Reference at=-6.5,20 U` | `field Reference at=[-6.5,20] U` |
| `footprint` `pads` | `1  smd  roundrect  -0.95  0.95  1.1  0.6` | `1  smd  roundrect  [-0.95,0.95]  [1.1,0.6]` |
| `footprint` `graphics` | `rect  F.CrtYd  -1.65,-1.2,1.65,1.2` | `rect  F.CrtYd  [-1.65,-1.2,1.65,1.2]` |

A shape whose geometry mixes points and a scalar keeps one cell for the shape:
`circle  [0,0,1.0]` (centre and radius), `arc  [x,y,x,y,x,y]` (three points).
