# Case: two dividers, one ratio the language cannot state

A three-leg ladder with two taps and a plain two-leg divider, both fed from one reference. Five
resistors of one value make three different voltages. The ratio lives in how the resistors are
connected — and the description does not say so.

## What it proves

| Claim | Where it lives | What the checker says |
|---|---|---|
| A divider is a set of ordinary nets | the board file: `VREF`, `TAP1`, `TAP2`, `TAP3`, `GND` and five resistors | nothing special — the ordinary rules apply: membership, the rating notes, no pin in two nets. A tap net with two members is an ordinary net |
| The tap voltages are the designer's arithmetic | the board file: `voltage TAP1 2.2V..2.2V`, `voltage TAP2 1.1V..1.1V`, `voltage TAP3 1.65V..1.65V` | nothing — the checker compares the parts against the declared window; it cannot check that the divider divides, because the description never states the ratio. There is no expression (ADR-0001 D3) and no module parameter (F13) |
| The same value can serve three different ratios | the board file: five `res-thick-0402` instances, all `100k` | nothing — `100k` is a value, not a ratio. What makes the taps differ is the topology, and the language says nothing about the topology |
| A ratio cannot be stated today | — | the language has no way to write it. This is the honest answer to `AGENTS.md` §11 Q2 for this shape: a divider is not a wide table, so the trigger in ADR-0001 D6 is not met, and no expression is needed to write the case down |

## What it deliberately leaves out

- **No procurement.** The resistors are `kind: generic`, so the design says what it needs and no
  part is selected. A generic declares no ratings of its own (ADR-0026), which is why the stress
  note below says that nothing could be compared.
- **No PCB.** `bind.not-checked` is the standing note.
- **No tolerance arithmetic.** `±1%` on five resistors says how far each leg may move; nothing in
  the language adds those five tolerances up, and nothing checks the tap against its window.

## What this case pins

- `expected/ir/**`, `expected/manifest.json`, `expected/netlist.txt`: the device shard, the symbol
  shard, the footprint shard, the board and the project, plus the connectivity projection: five
  nets over five instances.
- `expected/diagnostics.json`: **no error and no warning**, and the two standing notes:
  `design.stress-unknown` — 5 of 5 instances were not compared with a declared window (the generic
  resistor declares no voltage capability, so nothing could be compared) — and `bind.not-checked`.
