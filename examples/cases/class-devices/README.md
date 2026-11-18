# Case: a jack and an LED are classes

A 5 V / 2 A adapter plugs into `J1`, a capacitor takes the input ripple, a resistor limits the
current, and a green LED says the rail is there. What the case is about is not the circuit: it is
that **two of these devices are classes and not parts**, that a class's primary value may be a
**class** (a colour) rather than a quantity, and that a part chosen for such a class is compared
for **equality** rather than for "at least"
([ADR-0077](../../../docs/adr/07-devices/0077-a-jack-and-an-led-are-classes.md)).

## What it proves

| Claim | Where it lives | What the checker says |
|---|---|---|
| A DC barrel jack is a class | `dc-jack-th`: `construction barrel`, with `value length`, `rated_current current` and `voltage voltage` as its required columns; the instance row is `J1 … dc-jack-th 2.0mm 2A 6V` | nothing — the three-column row is legal from language 0.16 on, and the plug size reaches the IR as a length in nanometres (`"value": 2000000`). A row below 0.16 is rejected with `syntax.unknown-field`: the column arrived with the construct |
| An indicator LED is a class | `led-indicator-0603`: `construction indicator`, with `value string` and `wavelength length`; the instance row is `D1 … led-indicator-0603 green 565nm` | nothing — the colour is a **string**, and the wavelength is a length. The string reaches the IR as `text`, not as a number: `expected/ir/components/ltst-c190gkt.json` carries `{"name": "value", "type": "string", "text": "green"}` |
| A class-valued primary compares for **equality** | the procurement row `led-indicator-0603 green 565nm -> ltst-c190gkt`, against the part's own `value green` and `wavelength 565nm` | nothing — the two sides are the same class and the same bin. A 570 nm green LED would not qualify, and the report would say "the value class is not the one the line asks for" (pinned by `packages/core/test/procurement.test.ts`) |
| A quantity-valued primary still compares as an envelope | the procurement row `dc-jack-th 2.0mm 2A 6V -> dc-005-a200` | nothing — the plug size is a length, so 2.5 mm is not a 2.0 mm jack, while the part's 30 V and 2 A both cover what the line asks for |
| A class states a requirement, and the requirement is comparable | `current J1.1 2A` in the module, against the class's own `rated_current 2A` | nothing — the pin's requirement and the class's requirement agree, so the pin is **compared** rather than skipped (ADR-0026 D18). The coverage line says so: "1 of 4 instances were compared with a declared window" is about the stress check; this one is the current check, which has no note because nothing was left unknown |
| Unknown is counted, not passed | `J1` has three contacts, so its `voltage` requirement cannot be paired with two nets; the LED and the resistor state no voltage capability at all | `design.stress-unknown`, a **note**: "3 of 4 instances were not compared with a declared window: 1 whose rating names no terminals, 2 with no declared voltage capability". The capacitor `C1` *is* compared: its 16 V requirement against `VIN` (0–6 V) and `GND` (0 V) |
| A resistor's dissipation is bounded when the design states the windows | `R1` is 1 kΩ between `VIN` (0–6 V) and `LED_A` (0–6 V) | nothing — the bound is ΔV²/R = 36 mW against the 0402 package floor of 62.5 mW, so the resistor is compared and passes. Without `LED_A`'s window the check says "1 on a net without a declared voltage window" instead |

## What it deliberately leaves out

- **The two unsourced lines.** `C1` and `R1` are generic lines that nobody has chosen a part
  for. That is the honest state of a panel that is not being bought yet, and `check` says so
  (`value.procurement-generic-unsourced`). The two classes this case is about *are* sourced, and
  those rows are the ones the comparison reads.
- **No layout.** The board description exists and owns the module instance, but its `place` and
  `connect` sections are empty; `bind.instance-unplaced` is the standing warning that says so.
- **No reversed polarity.** The jack and the LED both declare `polarized yes`, and their two
  poles are typed `polarized`, but nothing reads the polarity of a **generic's requirement** yet:
  the stress check still reads it as a magnitude across the part's two pins
  ([ADR-0075](../../../docs/adr/07-devices/0075-a-ratings-polarity-is-the-roles.md) closed the
  same hole for a part's rating, one level up; `docs/backlog.md` F85 is the same hole one level
  down). The jack is not compared at all, so the case does not pin a wrong reading as if it were a
  result.
- **A closed colour set.** "green" is a plain string here, so "GREEN" would be a second BOM line.
  The colour vocabulary is not decided
  ([ADR-0077](../../../docs/adr/07-devices/0077-a-jack-and-an-led-are-classes.md), open point;
  `docs/backlog.md` F86). The case pins the comparison, not the spelling.
- **A second source.** The procurement file has one role (`primary`). The alternatives file
  exists for every board in the reference project and is empty there too.

## What this case pins

- `expected/ir/components/led-indicator-0603.json`: the class's two required columns, and the
  instance's `value` and `wavelength` as they reach the IR.
- `expected/ir/components/ltst-c190gkt.json`: a rating measured in a class reaches the IR in the
  contract's **second** shape — `{"name": "value", "type": "string", "text": "green"}` — next to
  the numeric ones (`{"name": "wavelength", "type": "length", "value": 565}`).
- `expected/ir/components/dc-005-a200.json` and `expected/ir/components/dc-jack-th.teda`: the
  same, with the plug size as a length of 2 000 000 nm.
- `expected/ir/**`, `expected/manifest.json`, `expected/netlist.txt`: five component shards, four
  symbol shards, three footprint shards, the board, the project, and the connectivity projection —
  four nets over four instances.
- `expected/diagnostics.json`: **no error**, three warnings (`bind.instance-unplaced` and the two
  `value.procurement-generic-unsourced`) and one note (`design.stress-unknown`).

## Notes on the sources

- `dc-005-a200`: Xun Pu's product page for the `DC-005` series states 2 A and 30 V DC; the
  series drawing states 30 V DC and 3 A. The part file takes the lower number
  ([ADR-0077](../../../docs/adr/07-devices/0077-a-jack-and-an-led-are-classes.md) D6), and the
  contradiction is written down in the reference project's `docs/datasheets.md`.
- `ltst-c190gkt`: Lite-On DS-22-98-0011 Rev. H — λP = 565 nm, λd = 569 nm, IF = 30 mA, VR = 5 V,
  PD = 100 mW, 0603.
- The jack's pin numbers are the project's own: 1 = TIP, 2 = SLEEVE, 3 = SWITCH. The vendor's
  drawing numbers them 4 = tip, 3 = switch, 2 = sleeve.
