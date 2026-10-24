# Case: dual op-amp, one part, three units

A TI OPA2333 (SOIC-8) used as a non-inverting amplifier (unit A, gain 3.21) feeding a unity-gain
buffer (unit B), on a single 3.3 V supply carried by unit 3.

## What it proves

**Unit identity is part of a pin reference.** `OUT`, `IN+` and `IN-` exist in both amplifier units,
so a member of a net has to name the unit: `U1.1.OUT` and `U1.2.OUT` are different pins of one
instance. Every net row in `design/sch/multi-unit.teda` is written that way.

**A bare name that matches two units is rejected, not guessed.** `U1.OUT` would be ambiguous; the
parser reports `ref.ambiguous-pin` and suggests `U1.1.OUT` (`spec/teda.md` §4.5). Picking the first
match would silently wire unit B to unit A's net, and no drawing would show the difference. The
same rule catches two pins that share a name inside one unit (two grounds).

**One instance, not three.** A multi-unit part is one `instances` row and one `component_id`, not one
row per unit: units are a property of the pins, not of the placement (`expected/ir/boards/multi-unit/schematic.json`
has `U1` once). The net members carry pin *numbers* (`U1.7`), because the IR's identity key is the
pin number, and the unit is only a fact of the device.

## The pins

| Pin | Name | Unit | Type |
|---|---|---|---|
| 1 | OUT | 1 | output |
| 2 | IN- | 1 | input |
| 3 | IN+ | 1 | input |
| 5 | IN+ | 2 | input |
| 6 | IN- | 2 | input |
| 7 | OUT | 2 | output |
| 4 | V- | 3 | power_in |
| 8 | V+ | 3 | power_in |

## What this case deliberately leaves out

No decoupling, no mid-rail reference, no PCB, no print page: it is about unit identity, not about
analog design or drawing. It also does not show *per-unit placement* — the language has no such
concept today, and this case is what makes that visible: an instance is placed whole, and the units
are separated only where the drawing says so (a view file, `spec/schematic-view.md`).

## What it pins

- `expected/ir/**` and `expected/netlist.txt`: three device shards, two symbols, two footprints,
  the board, the project, and the connectivity projection of the board.
- `expected/diagnostics.json`: three notes and nothing else — `design.stress-unknown` and
  `design.power-unknown` (no instance was compared with a declared window: the resistors sit on nets
  that declare none) and `bind.not-checked` (a board with a schematic and no PCB is skipped, not
  passed). No warnings: every pin is connected and every net has a port or a second member.
