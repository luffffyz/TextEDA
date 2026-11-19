# Case: twenty power domains, one table

Twenty regulated rails on one board: one LDO per rail, an input and an output capacitor, a load and
an enable pull-up. Five devices per domain, one hundred instances, and two nets that carry the whole
board — `VDD_IN` with sixty members and `GND` with eighty.

## What it proves

| Claim | Where it lives | What the checker says |
|---|---|---|
| The table form survives repetition | the board file: 100 instance rows, 42 net rows, 22 ports, 22 constraints | nothing — the form is not a rule the checker enforces. It is the *case* that answers `AGENTS.md` §11 Q2: after the 80-column wrapping rule every row is at most 78 columns, and the board reads as short rows a reviewer can scan, so the trigger in [ADR-0001](../../../docs/adr/01-language/0001-fact-layer-has-no-expressions.md) D6 (a table that stays unreadable after wrapping) is **not met** |
| A wide net is still an ordinary net | the board file: `GND` with 80 members, `VDD_IN` with 60 | the ordinary rules apply unchanged: membership, no pin in two nets, the rating notes. The members wrap into continuation lines — a layout fact, not a semantic one (`spec/teda.md` §11 rule 8) |
| A PCB current rule is explicit and trace-only | `design/pcb/power-domains.teda`: `VDD_IN` has an illustrative `current` rule, with one `physical_only stitching` via and no trace declarations | the IR preserves max current, minimum width and provenance text; the report names the stitching via as unchecked. The reference URI is deliberately illustrative, not an asserted review artifact. No physical ampacity or branch split is inferred ([ADR-0081](../../../docs/adr/05-pcb/0081-rail-current-is-a-pcb-rule.md)) |
| Every rail is its own net with its own window | the board file: 20 `voltage` rows, one per rail | the windows are compared with the parts' own ratings ([ADR-0026](../../../docs/adr/07-devices/0026-a-part-states-its-own-ratings.md)): the capacitors sit inside their 16 V and 10 V ratings. A rail whose window no part could meet would be an error here, not a note |
| An enable pin is an input, not a power pin | the device file: `U1.3` is `input`, `U1.1` is `power_in`, `U1.5` is `power_out` | nothing here — the pin types are the device's fact. The case shows a rail tree that mixes them without the checker objecting |

## What it deliberately leaves out

- **No procurement.** The capacitors and resistors are `kind: generic`, so the design says what it
  needs and no part is selected; the case is about the form, not about buying.
- **No physical placement or routing.** The PCB intentionally has no placed instances or traces;
  binding reports the unplaced instances. The current rule consequently checks zero trace declarations.
- **No derived rail current or branch split.** Its PCB rule is explicitly illustrative only; it does
  not claim that the 1 A value is sourced from an analysis or reviewed artifact. The LDO's
  `rated_current` is not used to infer the rail value, and no physical ampacity model is applied.
- **No repetition mechanism.** The twenty domains are twenty copies of the same five devices, and the
  language has no way to say "the same domain twenty times" — on purpose: generators live outside
  the language ([ADR-0001](../../../docs/adr/01-language/0001-fact-layer-has-no-expressions.md) D3) and hierarchy is `module` ([ADR-0013](../../../docs/adr/04-schematic/0013-modules-compose-boards.md), the `hierarchy reuse` case). This
  case writes the copies out, which is what a table is.

## What this case pins

- `expected/ir/**`, `expected/manifest.json`, `expected/netlist.txt`: three device shards, three
  symbol shards, two footprint shards, the board, the project, and the connectivity projection —
  42 nets over 100 instances, 168 lines of netlist.
- `expected/diagnostics.json`: no errors; existing unplaced-instance / missing-uid warnings and
  the `design.stress-unknown` and `design.power-unknown` notes; plus `drc.current-trace-only`, which
  reports zero checked traces and the same-net stitching via as outside the capacity check.
- **The uid rule.** The hundred instance rows carry a stable uid
  ([ADR-0010](../../../docs/adr/03-project/0010-instance-identity-is-a-uid.md)); the nets, the ports and
  the constraints carry their names as identity and have no uid to carry. The board shard shows it —
  an instance object has a `uid` field, a net object does not.
