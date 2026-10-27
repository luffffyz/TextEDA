# Case: a bus names nets, it does not join them

A sensor hub: one 2.54 mm uplink header and fourteen Qwiic / STEMMA QT connectors, all on the same
four signals, plus a second bus for the two rails.

## What it proves

`bus <id> = <type>` is a **naming scheme**, not a connection. The compiler expands every member row
into an ordinary net called `<bus_id>.<member>`, and nothing else changes: each member net has its
own member list, its own constraints, and is checked by the same rules as a net written with a
plain `nets` row (`spec/teda.md` §7.3).

| Question | Answer this case pins |
|---|---|
| Does a bus join its members? | No. `i2c0.sda` and `i2c0.scl` are two nets with fifteen members each; nothing connects sda to scl. |
| May a port name a member net? | Yes. `I2C_SCL i2c0.scl` is legal without a `nets` row: the bus declaration is what brings `i2c0.scl` into existence. |
| May a constraint name one? | Yes. `voltage pwr.vdd 3.0V..3.6V` is checked against the member net, not against the bus. |
| Does the bus type check the protocol? | No. `I2C` is a label; it is carried into the IR as `type` and nothing reads it. |
| Is one bus id one block? | Yes. Two `bus i2c0` blocks are `ref.duplicate-bus` (error); a repeated **member row** inside one block merges, a repeated bus does not. |

## The board

Fifteen instances of two connector parts, four nets, four ports, two constraints. H1 is the uplink;
J1–J14 are the downstream Qwiic ports. Every row in the two `bus` blocks is longer than 80 columns,
so the canonical form carries the tail on continuation rows with a bare `:` — a layout fact, not a
semantic one: the same members written on one line compile to byte-identical IR (`AGENTS.md` §10).

`pwr` is a bus whose members are supply nets. A bus member is still a net: `pwr.gnd` gets the
`0V..0V` window like any ground, and `PWR_VDD` exposes `pwr.vdd` to the board above.

## What this case deliberately leaves out

No PCB and no print page. It also does not show the two error paths (`ref.duplicate-bus`,
`net.duplicate-member`): errors belong in negative fixtures and in the parser's unit tests, not in
the corpus of valid designs (`examples/cases/README.md`).

## What it pins

- `expected/ir/**` and `expected/netlist.txt`: two device shards, two symbols, two footprints, the
  board, the project, and the connectivity projection of the board.
- `expected/manifest.json`: the project hash. Membership order comes from the source's pin order
  (H1 before J1…J14), not from the bus row layout.
- `expected/diagnostics.json`: two notes (`design.stress-unknown` — connectors declare no voltage
  window — and `bind.not-checked` — no pcb). There is no `net.pin-unassigned`: every pin is in a
  member net.
