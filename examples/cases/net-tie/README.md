# Case: a net tie is a declared deviation, not a silent short

A 3.3 V rail and the sense line that measures it at the far end of the board. The schematic keeps
the two nets apart; the board joins them with copper. The join changes the connectivity of both
nets, so it is declared in the pcb and it shows up in the report.

## What it proves

| Claim | Where it lives | What the checker says |
|---|---|---|
| A short between two schematic nets must be declared | the pcb's `connect` section: `U1.5` (on `V3V3`) joined to `R1.1` (on `V3V3_SENSE`) | nothing — the pair is legal, because the `deviation` section declares `net_tie V3V3 V3V3_SENSE`. Without that declaration the same pair would be an error (`bind.net-mismatch`), not a warning |
| A declared tie is reported, not hidden | the pcb's `deviation` section | `bind.net-tie`, a **note**: the tie changes the connectivity of both nets, and the reader has to see it (ADR-0014 D10) |
| The schematic stays the authority | the board file: `V3V3` and `V3V3_SENSE` are two nets with their own members | the flat IR keeps them apart — the tie is a board fact, not a net in the schematic. The netlist shows two nets, not one |
| A tie does not need a part | the pcb's `connect` section: the copper joins two pads of two different parts | nothing — the language has no net-tie *part*: the construction vocabulary is closed and has no entry for one (`spec/teda.md` §6.2.1). A real tie footprint would be a `part` with a manufacturer part number; a generic one cannot be written today |

## What it deliberately leaves out

- **No split ground.** The companion deviation is a **warning** (`bind.split-ground`), not a note: a
  net that is physically split breaks the return path of every signal crossing the gap. One case
  tells one story.
- **No DNP.** The tie is always there. A tie that may be left unpopulated needs the `dnp` surface,
  which the language does not have yet.
- **No procurement.** The capacitor and the resistor are `kind: generic`, so the design says what it
  needs and no part is selected.
- **No fabrication output.** The case pins the description and the report, not the Gerbers.

## What this case pins

- `expected/ir/boards/tie-board/schematic.json` and `pcb.json`: the board's four nets and the
  board's own description — the `deviation` shard carries `{type: net_tie, net_a: V3V3,
  net_b: V3V3_SENSE}` and the `connect` shard carries the pair that crosses the two nets.
- `expected/netlist.txt`: the connectivity projection of the **schematic** — four nets, `V3V3` and
  `V3V3_SENSE` still apart. The tie is in the pcb, not in the netlist.
- `expected/diagnostics.json`: **no error and no warning**, and two notes: `bind.net-tie` (at the
  `deviation` row of the pcb) and `design.stress-unknown` — 2 of 3 instances were not compared with
  a declared window (the regulator and the resistor declare no voltage capability; the capacitor
  carries a 10 V rating and was compared).
