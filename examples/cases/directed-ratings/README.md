# Case: a rating may name the two pins it is about

A 5 V rail comes in on `VIN`, an LDO makes `V3V3`, an N-FET switches the `SW` rail, and a diode
clamps `SW` back to ground. The parts state what they can take; the design states what it applies.
The two statements meet in one place: the stress comparison, which needs to know **which two pins**
each limit is about.

## What it proves

| Claim | Where it lives | What the checker says |
|---|---|---|
| A rating may name the two pins it is about | the part files: `drain_source_voltage voltage 100V 2 3` and `gate_source_voltage voltage 20V 1 3` in `irf540n`, `reverse_voltage voltage 100V 2 1` in `d-1n4148w` | nothing — the five-column row is legal in language 0.15, and the pair is carried into the IR as `ratings[].terminals` (`{"from": "2", "to": "3"}`). A row below 0.15 is rejected with `syntax.unknown-field`: the column arrived with the construct |
| A multi-pin part can be compared | `Q1`: the drain-source limit (100 V) against `SW` (4.5–5.5 V) and `GND` (0 V); the gate-source limit (20 V) against `GATE` (4.5–5.5 V) and `GND` | nothing — the stress is the span of the difference between the two windows: 5.5 V across `SW` and `GND`, 5.5 V across `GATE` and `GND`, both inside the limits. `Q1` and `D1` are **compared**: 2 of 3 instances |
| The pair carries the polarity | `D1`: `reverse_voltage` names from = the anode (pin 2), to = the cathode (pin 1) | nothing — the reverse stress is `SW.max − GND.min = 5.5 V` against a 100 V limit. The diode is a flyback clamp, so the design stresses it in reverse, and the pair says which way that is |
| A role says which polarity it covers | `irf540n`: `drain_source_voltage` and `gate_source_voltage` are magnitudes in the datasheet (`V_DS`, `V_GS = ±20 V`), so both roles are **symmetric** ([ADR-0075](../../../docs/adr/07-devices/0075-a-ratings-polarity-is-the-roles.md) D2); `reverse_voltage` stays directed, because a diode's reverse rating is a reverse-only rating | nothing — the numbers are the same under either reading here: this N-channel part's drain sits above its source and its gate above its source, so the span and the one-polarity reading agree. The polarity that used to be invisible — a P-channel part whose source sits above its drain — is pinned by the unit tests in `packages/core/test/ratings.test.ts` |
| A number without a pair is not a pass | `U1`: the `voltage` rating (6.5 V) names no terminals, and the part has five pins | `design.stress-unknown`, a **note**: "1 of 3 instances were not compared with a declared window: 1 whose rating names no terminals". Unknown is counted, not passed (ADR-0026 D13) |

## What it deliberately leaves out

- **No procurement.** The parts are named, not selected: the design says which device it uses, and
  nothing says where it is bought.
- **No current model.** `U1` states a `rated_current` of 300 mA, and no current is declared
  anywhere in the design, so the current comparison has nothing to compare (ADR-0026 D16–D18).
- **No layout.** The board description exists and owns the module instance, but its `place` and
  `connect` sections are empty; `bind.instance-unplaced` is the standing warning that says so.
- **The opposite polarity.** The "the role's polarity never occurs, so the design never stresses the
  part that way" branch of the directed model is pinned by the unit tests in
  `packages/core/test/ratings.test.ts`, not by this case. A case is a whole project; a branch with
  no design behind it is a fixture. After [ADR-0075](../../../docs/adr/07-devices/0075-a-ratings-polarity-is-the-roles.md)
  that branch belongs to the directed roles only (`reverse_voltage`); the two MOSFET roles are
  symmetric, so the polarity they once could not see is compared like any other.
- **No violation.** The design is inside every limit it can be compared against, so the case pins
  the *coverage*, not a failure. The numbers are real: `VIN` at 4.5–5.5 V would satisfy `U1`'s own
  6.5 V limit even if that rating named its pins, so the unknown is not hiding a violation.

## What this case pins

- `expected/ir/components/irf540n.json`: the terminal pairs, as `ratings[].terminals` —
  `{"from": "2", "to": "3"}` for the drain-source limit and `{"from": "1", "to": "3"}` for the
  gate-source limit. `expected/ir/components/d-1n4148w.json` carries the reverse pair
  `{"from": "2", "to": "1"}`, and `expected/ir/components/tps7a2033pdbvr.json` carries a rating
  with **no** `terminals` field at all.
- `expected/ir/**`, `expected/manifest.json`, `expected/netlist.txt`: three device shards, three
  symbol shards, three footprint shards, the board, the project, and the connectivity projection —
  five nets over three instances.
- `expected/diagnostics.json`: **no error**, two warnings (`bind.instance-unplaced`,
  `value.instance-uid-missing`) and one note: `design.stress-unknown` — 1 of 3 instances were not
  compared with a declared window, the regulator, whose rating names no terminals.
- The coverage line the report ends with: "Not fully checked: 2 of 3 instances were compared with a
  declared window." A report that says "0 errors" and leaves this out reads as a pass on a design
  where a part was never checked.

## Notes on the sources

- `irf540n`: Vishay Siliconix, the IRF540 datasheet (Document Number 91021, S21-0819-Rev. C,
  02-Aug-2021) — absolute maximum ratings V_DS = 100 V and V_GS = ±20 V, and the TO-220AB pin
  order 1 = G, 2 = D, 3 = S. The datasheet is the family's (IRF540PbF); the MPN written here is
  IRF540N.
- `d-1n4148w`: onsemi, the 1N4148W-D datasheet — peak reverse voltage V_RRM = 100 V, and the
  pinning 1 = cathode, 2 = anode.
- `tps7a2033pdbvr`: TI SBVS338H (TPS7A20) — §5.1 absolute maximum input voltage 6.5 V, and the
  pin functions IN = 1, GND = 2, EN = 3, N/C = 4, OUT = 5.
- The diode's id carries a `d-` prefix because an identifier may not start with a digit and the
  part number does; the reference project names its parts the same way (`d-bat54c`,
  `q-si7617dn`).
