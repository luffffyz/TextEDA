# Case: twenty power domains, one table

Twenty regulated rails on one board: one LDO per rail, an input and an output capacitor, a load and
an enable pull-up. Five devices per domain, one hundred instances, and two nets that carry the whole
board — `VDD_IN` with sixty members and `GND` with eighty.

## What it proves

| Claim | Where it lives | What the checker says |
|---|---|---|
| The table form survives repetition | the board file: 100 instance rows, 42 net rows, 22 ports, 22 constraints | nothing — the form is not a rule the checker enforces. It is the *case* that answers `AGENTS.md` §11 Q2: after the 80-column wrapping rule every row is at most 78 columns, and the board reads as short rows a reviewer can scan, so the trigger in [ADR-0001](../../../docs/adr/language/0001-fact-layer-has-no-expressions.md) D6 (a table that stays unreadable after wrapping) is **not met** |
| A wide net is still an ordinary net | the board file: `GND` with 80 members, `VDD_IN` with 60 | the ordinary rules apply unchanged: membership, no pin in two nets, the rating notes. The members wrap into continuation lines — a layout fact, not a semantic one (`spec/teda.md` §12 rule 8) |
| Every rail is its own net with its own window | the board file: 20 `voltage` rows, one per rail | the windows are compared with the parts' own ratings ([ADR-0026](../../../docs/adr/devices/0026-a-part-states-its-own-ratings.md)): the capacitors sit inside their 16 V and 10 V ratings. A rail whose window no part could meet would be an error here, not a note |
| An enable pin is an input, not a power pin | the device file: `U1.3` is `input`, `U1.1` is `power_in`, `U1.5` is `power_out` | nothing here — the pin types are the device's fact. The case shows a rail tree that mixes them without the checker objecting |

## What it deliberately leaves out

- **No procurement.** The capacitors and resistors are `kind: generic`, so the design says what it
  needs and no part is selected; the case is about the form, not about buying.
- **No PCB.** `bind.not-checked` is the standing note: a board with a schematic and no board
  description is skipped for the binding check, not passed.
- **No current.** The LDO states a `rated_current` of 300 mA, and the checker has no current model
  yet ([ADR-0026](../../../docs/adr/devices/0026-a-part-states-its-own-ratings.md) D8, D11 — current is still undecided), so the case says nothing about load.
- **No repetition mechanism.** The twenty domains are twenty copies of the same five devices, and the
  language has no way to say "the same domain twenty times" — on purpose: generators live outside
  the language ([ADR-0001](../../../docs/adr/language/0001-fact-layer-has-no-expressions.md) D3) and hierarchy is `module` ([ADR-0013](../../../docs/adr/schematic/0013-modules-compose-boards.md), the `hierarchy reuse` case). This
  case writes the copies out, which is what a table is.

## What this case pins

- `expected/ir/**`, `expected/manifest.json`, `expected/netlist.txt`: three device shards, three
  symbol shards, two footprint shards, the board, the project, and the connectivity projection —
  42 nets over 100 instances, 168 lines of netlist.
- `expected/diagnostics.json`: **no error and no warning**, and the three standing notes:
  `design.stress-unknown` — 60 of 100 instances were not compared with a declared window (the
  twenty LDOs and the forty resistors declare no voltage capability, so nothing could be compared),
  `design.power-unknown` — 20 of 40 resistive instances were not compared with a power limit (the
  twenty enable pull-ups sit on `EN01`…`EN20`, which declare no window), and `bind.not-checked`.
- **The uid rule.** The hundred instance rows carry a stable uid
  ([ADR-0010](../../../docs/adr/project/0010-instance-identity-is-a-uid.md)); the nets, the ports and
  the constraints carry their names as identity and have no uid to carry. The board shard shows it —
  an instance object has a `uid` field, a net object does not.
