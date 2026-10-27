# Case: NC pins, and the other two ways a pin can be unconnected

A Cortex 10-pin debug header (2x5, 1.27 mm) with one pull-up on reset.

## What it proves

The language has to keep three different facts apart, and the difference is visible in what the
checker says:

| Fact | Where it lives | What the checker says |
|---|---|---|
| The pin is dead on this part (key, unused contact) | the device file: `no_connect` electrical type | nothing — as long as the pin stays out of every net. Put it in a net and `net.no-connect-connected` is an **error** (`spec/teda.md` §11, rule 4) |
| The designer left a live pin open on this board | the board file: the pin appears in no net | `net.pin-unassigned`, a **warning** |
| The pin is wired | the board file: the pin is a net member | nothing |

The warning is the point of the case. "I decided not to use GNDDetect" and "I forgot GNDDetect" are
the same drawn circuit; the warning is what makes the difference reviewable instead of invisible.
The case pins exactly one of them (pin 9), so a change that silences it — or one that starts
flagging the dead pins — fails here.

## The header

Pin 7 is the key: absent on a keyed connector, present and unused on this one. Pin 8 is unused on
the ARM pinout. Both are `no_connect` pins of the part, so both stay silent. Pin 9 (GNDDetect) is a
live `power_in` the board does not use — the one expected warning.

## Also proven here

- **Ports are not single-member nets.** SWDIO, SWCLK and SWO each reach one pin only, because the
  other end is off-board; exposing them as ports (`ports` section) is what keeps a one-member net
  from being reported as a missing connection (`spec/teda.md` §11, rule 4).
- **Through-hole land patterns compile.** The header is the corpus's first TH footprint: its pads
  sit on `*.Cu` / `*.Mask`, which the contract accepts and the exporter writes as `thru_hole`
  (the wildcard is a layer name, [ADR-0011](../../../docs/adr/0011-library-format-and-footprint-ir.md)).

## What this case deliberately leaves out

No PCB and no print page. It also does not show a `no_connect` pin that is wired — that is an
error, and errors belong in negative fixtures, not in the corpus.

## What it pins

- `expected/ir/**` and `expected/netlist.txt`: two device shards, two symbols, two footprints,
  the board, the project, and the connectivity projection of the board.
- `expected/diagnostics.json`: one warning (`net.pin-unassigned` at the board's `instances` row) and
  the three standing notes (`design.stress-unknown`, `design.power-unknown`, `bind.not-checked`).
