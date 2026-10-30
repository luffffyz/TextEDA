# Case: one module, two instances, one board

A two-stage RC filter, written once and instantiated twice on a sensor hub. The module owns its
parts, its nets and its windows; the board owns the part that belongs to no module and the nets the
module's ports merge into.

## What it proves

| Claim | Where it lives | What the checker says |
|---|---|---|
| A module is a piece of circuitry, not a drawing split | `design/modules/rc-filter-2stage.teda`, instantiated by `design/sch/sensor-hub.teda` | the flat IR has no module left in it: the board shard lists `M1.C1`, `M2.C1` … as ordinary instances and `M1.MID`, `M2.MID` as ordinary nets. The module file produces **no shard of its own** — only its parts survive, inside the board |
| The same module may be instantiated twice | the board's `modules` section: `M1` and `M2`, both `rc-filter-2stage` | nothing special — the two instances are two sets of instances. `M1.R1` and `M2.R1` are the same part in two places |
| A port merges a module net into a board net | the module's `ports` section and the board's `nets` section: `M1.IN` in `SIG1`, `M1.OUT` in `OUT1`, `M1.GND` in `GND` | the ordinary rules then apply to the merged net: `GND` carries both modules' capacitors and the board's thermistor, and one window covers all of them |
| A net with no port stays inside the module | the module's `MID` net: no port names it | it lands as `M1.MID` / `M2.MID`, and the module's own `voltage MID 0V..3.3V` lands with it — the constraint does not leak into the board's nets |
| A port the board does not use has to say so | the module's `SPARE` port: `no_connect` | nothing. Without that keyword the same module would be an error (`ref.unbound-port`): a port is an interface, not an optional comment |
| A module-local uid is local to the definition | the module's four instance uids | the flat IR qualifies them with the module instance's uid: `ID4xekqr/IDgt9qvr` for `M1.C1`, `IDcg99hr/IDgt9qvr` for `M2.C1` — the same local uid under two different module instances |
| A window can travel with the module | the module's `voltage OUT 0V..3.3V` | the board declares no window for `OUT1` / `OUT2`; the module's window lands on both, so the module carries its own operating range |

## What it deliberately leaves out

- **No PCB.** `bind.not-checked` is the standing note: a board with a schematic and no board
  description is skipped for the binding check, not passed.
- **No procurement.** The capacitors and resistors are `kind: generic`, so the design says what it
  needs and no part is selected.
- **No parameters.** The module takes none — module parameters are not implemented yet
  (`docs/backlog.md` F13), so the two instances are identical by construction.
- **No nesting.** A module cannot contain a module; the hierarchy is one level deep.
- **No print page.** The drawing is a separate layer with its own rules, and it is not what this
  case is about.

## What this case pins

- `expected/ir/**`, `expected/manifest.json`, `expected/netlist.txt`: the board shard with 9
  instances, 8 nets, 8 constraints and 6 ports; three device shards, three symbol shards, two
  footprint shards and the project. The netlist shows the flat board: the module's `IN`, `OUT` and
  `GND` are gone into `SIG1`, `OUT1` and `GND`, and only `M1.MID` / `M2.MID` keep the qualified
  name.
- `expected/diagnostics.json`: **no error and no warning**, and the two standing notes:
  `design.stress-unknown` — 5 of 9 instances were not compared with a declared window (the four
  resistors and the thermistor declare no voltage capability, so nothing could be compared) — and
  `bind.not-checked`.
