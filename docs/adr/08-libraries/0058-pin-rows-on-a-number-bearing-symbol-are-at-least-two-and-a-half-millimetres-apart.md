# ADR-0058: Pin Rows on a Number-Bearing Symbol Are at Least 2.5 mm Apart, and Every Pin Point Is Anchored on Both Axes

Status: Accepted
Date: 2026-11-03
Scope: Decides: the minimum distance between adjacent pins on one side of a symbol that draws pin numbers, and that a pin row is not required to be symmetric about the symbol origin. Does not decide: which lattice a pin point must sit on ([ADR-0057](0057-symbol-pins-sit-on-a-half-millimetre-lattice.md) §1), footprint pad pitch ([ADR-0030](0030-footprint-format-and-geometry.md)), the coordinates of decorative body artwork ([ADR-0057](0057-symbol-pins-sit-on-a-half-millimetre-lattice.md) §3), and how the renderer places a pin number ([ADR-0050](../09-view/0050-pin-number-placement-is-a-renderer-convention.md)).
Related: [ADR-0057](0057-symbol-pins-sit-on-a-half-millimetre-lattice.md), [ADR-0050](../09-view/0050-pin-number-placement-is-a-renderer-convention.md), [ADR-0051](../09-view/0051-pin-number-clearance-is-measured-from-painted-ink.md), [ADR-0030](0030-footprint-format-and-geometry.md), [ADR-0031](0031-symbol-format.md), [ADR-0059](../09-view/0059-print-page-coordinates-anchor-on-the-half-millimetre-lattice.md)
Impact: `spec/symbol.md` §4.1 states the floor and the per-pin anchoring rule; `bun run lib:verify` gains a pitch check; `docs/skills/library-authoring.md` §4.2, §4.3, §8, `docs/guides/symbol-authoring.md`, and the `library-authoring` skill follow; ten symbol files are re-authored (`bq24610rger`, `dc-dc-soic8`, `ldo-sot23-5` ×2, `sn65hvd230`, `opa2333`, `hdr-1x4`, `jst-sh-4`, `hdr-1x3`, `hdr-2x5`, `sw-push`); `views/charger-buck/buck-5v.view.teda` is re-derived; case expectations are regenerated.

## Context

`spec/symbol.md` §4.1 fixes the regular row pitch at `2.0 mm` ([ADR-0057](0057-symbol-pins-sit-on-a-half-millimetre-lattice.md) §2). That value was chosen for an arithmetic property, not for legibility: `2.0` is the smallest multiple of `0.5` that is also even, so an even pin count centred on the origin lands on the lattice. The drawing pays for it in the one place the pitch exists to serve — the pin numbers the renderer draws beside each pin ([ADR-0050](../09-view/0050-pin-number-placement-is-a-renderer-convention.md), [ADR-0051](../09-view/0051-pin-number-clearance-is-measured-from-painted-ink.md)).

Measured with the renderer's own metrics (Hershey ink plus half the stroke width, `1.27 mm` text size):

| Pitch | Number pair | Painted gap |
|---|---|---|
| `2.0 mm` | `"10"` beside `"9"` (two digits, `1.808 mm` wide) | `0.192 mm` |
| `1.0 mm` | `"3"` / `"4"` on `sw-push` | **overlap `0.974 × 0.397 mm`** |
| `2.5 mm` | `"10"` beside `"9"` | `0.692 mm` |
| `2.5 mm` | the 100-pin MCU's tightest row | `0.450 mm` |

A three-character number is `2.824 mm` wide, so no `2.5 mm` row can hold one: `"24"` fits at `2.5`, `"100"` does not. That is why this record states a **floor** and not a single value.

The obstacle to `2.5 mm` is the centring convention, not the lattice. `2.5` is an odd multiple of `0.5`, so a symmetric row of an even pin count sits at `±1.25` — half a lattice step off every connection point a wire can reach. Centring was never a requirement ([ADR-0057](0057-symbol-pins-sit-on-a-half-millimetre-lattice.md) states no symmetry rule); it entered the spec only as the reason `2.0` was picked. Dropping it costs nothing: a row that starts at any multiple of `0.5 mm` and steps by `2.5` keeps every pin on the lattice for every pin count, because `2.5` is itself a multiple of `0.5`.

## Decision

### 1. A symbol that draws pin numbers keeps adjacent same-side pins `2.5 mm` apart

Within one unit and one side, the distance between two adjacent pins' connection points along the row is at least `2.5 mm`. "Chip" needs no separate definition here: a symbol that shows its pin numbers is the case the floor protects, and a symbol that hides them has nothing to separate (§4).

### 2. The anchor is the pin, on both axes — not the row, and not the origin

Every pin's connection point is a lattice point in **both** coordinates, and so is its inner end ([ADR-0057](0057-symbol-pins-sit-on-a-half-millimetre-lattice.md) §1). A row decides only the pitch along its own axis; the offset of the whole row along that axis is free, and the perpendicular coordinate of the row is chosen separately.

Both axes matter because a print page connects **pin to pin**: a wire runs from one pin point to another, and an axis-aligned route between them exists only if each endpoint is a lattice point in `x` and in `y` independent of which symbol's row it came from ([ADR-0057](0057-symbol-pins-sit-on-a-half-millimetre-lattice.md) §4). Anchoring a row as a rigid unit would still be one number per row; anchoring per pin is what makes it composable, and it is what the requirement — every pin reachable from every other pin — actually says.

Consequently a row of an even pin count is **not** required to be symmetric about `0`: `-3.5, -1, 1.5, 4` is as legal as `-2.5, 0, 2.5, 5`, and either is balanced inside the body to within half a lattice step. A row that happens to be symmetric is a coincidence of its pin count and its offset, not a rule.

### 3. The regular pitch is exactly `2.5 mm`; a row may be wider

Rows use `2.5 mm` unless something concrete needs more: a three-character pin number needs `3.0 mm` (two characters plus a gap is `2.5`), and `crystal-4` already draws its `2`/`3` pair `3.0 mm` apart to leave room for the package's plates. A wider row stays a multiple of `0.5 mm` (§2). Nothing is gained by going below `2.5`.

### 4. A symbol that hides its pin numbers has no floor

`pin_numbers hide` draws a device glyph whose close pins describe one terminal pair — the FET's three source pins share a bus (`1.5 mm`), the dual diode's two anodes sit one glyph apart (`1.0 mm`), and `sw-push`'s two pins per side are one contact (`1.0 mm`). Their pitch is the glyph's, and there is no number to collide. A symbol that needs both a tight pair and legible numbers cannot have both; it hides the numbers.

`sw-push` starts drawing no numbers under this record. It was the one symbol whose numbers already overlapped (`0.974 × 0.397 mm`), and the button glyph cannot be stretched to `2.5 mm` without ceasing to be a button.

### 5. A connector's drawn rows follow the same floor

`hdr-1x4`, `jst-sh-4`, `hdr-1x3`, and `hdr-2x5` draw their rows `2.5 mm` apart. The ADR-0057 §5 clause that pinned them at `2.0 mm` "for legibility" is superseded by this floor, which is the same argument carried further. Their real pad pitch (`2.54 mm`, `1.0 mm`) still lives in the footprint ([ADR-0030](0030-footprint-format-and-geometry.md)); the two lattices answer different questions.

## Consequences

- Every chip symbol in `examples/` is re-authored: `bq24610rger` (12 and 9 pins per side, spanning `27.5 mm` and `20 mm`), `dc-dc-soic8`, `ldo-sot23-5` (both copies), `sn65hvd230`, `opa2333`; connectors and `sw-push` as described above. `ch32v307vct6` already sits at `2.5 mm` and does not move.
- Bodies stay as they are: a visible `rect` body's edges are where the tails end ([ADR-0057](0057-symbol-pins-sit-on-a-half-millimetre-lattice.md) §3), and every new row fits inside the existing frame.
- `views/charger-buck/buck-5v.view.teda` is re-derived rather than nudged: `dc-dc-soic8` pins 1, 2, 3, 4, 5, 6, 8, 9 move, so the wires that end on them move with them.
- Case expectations (`expected/ir/**`, `expected/manifest.json`, `expected/netlist.txt`) change for `diff-pair`, `dual-opamp-multi-unit`, `nc-pins`, `bus`, `power-domains`; `expected/diagnostics.json` does not — no finding is added or removed.
- `bun run lib:verify` gains the pitch check, so the floor is machine-checked rather than trusted to review. No diagnostic code is added: the library verifier is not `check`, and a bad house-style pitch is not a semantic error in the language.
- `spec/symbol.md` §4.1, `docs/skills/library-authoring.md` §4.2, §4.3, §8, `docs/guides/symbol-authoring.md`, `docs/backlog.md`, and the `library-authoring` skill stop saying `2.0 mm`.
