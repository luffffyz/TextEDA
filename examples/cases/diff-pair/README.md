# Case: a differential pair is a constraint, not a geometry

A CAN transceiver with a split-terminated differential pair. The pair is declared, never drawn:
`diff CANH CANL 120Ω ±10%` states an impedance target, `skew CANH CANL <= 5mm` states a length
relationship. Nothing about geometry, routing or length matching is implied — each net is ordinary,
and members, windows and unassigned pins are checked by the ordinary rules.

## What it proves

| Constraint | Where it lives | What the checker says |
|---|---|---|
| An impedance target between two nets | the board file: a `diff` constraint row on those two nets | nothing — `diff`/`skew` carry no geometry, so no rule can say the pair is short or long. The IR keeps the value (`impedance_mohm`, `tolerance_ppm` / `op`, `length_nm`), and no rule consumes it: judging a pair needs routed copper, which is `pcb` data plus DRC metrics (`docs/backlog.md` F48) |
| A length relationship between two nets | the board file: a `skew` constraint row on those same two nets | nothing — the relationship is a statement, not a drawn length |
| The pair nets are ordinary nets | the board file: each carries three members and nothing else — no window, no port, no bus | the ordinary rules apply to them unchanged: membership, `net.pin-in-two-nets`, the rating notes. A `diff` row neither connects nor exempts anything |
| A live pin deliberately left open | the board file: `U1.Vref` (pin 5) appears in no net | `net.pin-unassigned`, a **warning** — the intended one, pinning what a left-out pin means |

The warning is the point of the case. "I decided not to use Vref" and "I forgot Vref" are the same
drawn circuit; the warning is what makes the difference reviewable instead of invisible. The pair
nets themselves are connected and ordinary — only Vref is open.

## The pair

The differential pair is split termination, not a drawn geometry. Four components sit around one
pair: `R1` and `R2` split the pair, `C1` decouples the transceiver, and `C2` splits the return.
Nothing in the schematic, the footprint or the checker implies a length match; the `skew` constraint
is the only statement that a length relationship between `CANH` and `CANL` is wanted.

- `CANH` / `CANL` are the pair nets, each carrying a header pin, one resistor and the transceiver pin.
- `CAN_RX` / `CAN_TX` are the transceiver's `R` (pin 4, output) and `D` (pin 1, input); each is exposed
  as a port, which is what keeps a one-member net from being reported as a missing connection
  (`spec/teda.md` §11 rule 4) — the same rule `nc-pins` pins.
- `V3V3` carries the transceiver's supply and `GND` the reference, both ordinary nets.

## What this case pins

- `expected/ir/**`, `expected/manifest.json`, `expected/netlist.txt`: the four device shards, the four
  symbol shards, the three footprint shards, the board, the project, and the connectivity projection
  of the board.
- `expected/diagnostics.json`: the intended `net.pin-unassigned` warning (at the board's `instances`
  row for the unassigned `U1.Vref` pin) plus the standing notes (`design.stress-unknown` — 5 of 6
  instances were not compared with a declared window: 4 with no declared voltage capability (the
  header, the transceiver and both resistors) and 1 whose net carries no declared window (`C2`, on
  `SPLIT`) — and `design.power-unknown` — 2 resistive instances, 0 compared, both skipped for
  `no_window`: `R1`/`R2` connect `CANH`/`CANL` to `SPLIT`, none of which declares a window, so the
  dissipation upper bound cannot be computed — and
  `bind.not-checked` — a board with a schematic and no PCB is skipped, not passed).
- The expected `schematic.json` shows the constraint objects as the contract defines them:
  `diff` with `impedance_mohm` 120000 and `tolerance_ppm` 100000, and `skew` with `op` `<=` and
  `length_nm` 5000000.
