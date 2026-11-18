# Case: a polarised class names its positive pin

A 5 V rail carries a bulk capacitor. What the case is about is not the circuit: it is that **a
polarised generic says which of its two pins is the positive pole**, and that its `voltage`
requirement is therefore compared **in that direction** — the forward stress across the two poles
— instead of as a magnitude across the part's two pins
([ADR-0078](../../../docs/adr/07-devices/0078-a-polarised-class-names-its-positive-pin.md)).

## What it proves

| Claim | Where it lives | What the checker says |
|---|---|---|
| A polarised class names its positive pole | `assets/components/passives/cap-tantalum-7343.teda`: `polarized yes` and the scalar `positive_pin` with the value `1`, beside the pin table `1 P polarized` / `2 N polarized` | nothing — the scalar is a generic fact in language 0.17 and reaches the IR as `component.positive_pin` (`"positive_pin": "1"` in `expected/ir/components/cap-tantalum-7343.json`). A file below 0.17 that names one is rejected with `value.component-positive-pin-invalid`: the scalar arrived with the construct |
| The polarity is stated once, in the class | the instance row `C1  ID7kq3mz  cap-tantalum-7343  220u  20%  10V` carries the class's own columns — the value, the tolerance and the voltage — and no polarity of its own | nothing — the direction comes from the class file, not from every row of every board (ADR-0078 D1). A class written against an older language says only that it is polarised, and its requirement is then read as a magnitude, the way the language read it before |
| The requirement is compared in the class's direction | the same row: the class's `voltage` requirement of 10 V, with pin 1 (`P`) on `VOUT` (4.5–5.5 V) and pin 2 (`N`) on `GND` (0 V) | nothing — the forward stress is the extreme of `V(+) − V(−)` = 5.5 V, and the 10 V requirement covers it. The instance is **compared**: 1 of 1 |
| Both nets need a declared window | `voltage VOUT 4.5V..5.5V` and `voltage GND 0V..0V` on the project root | nothing — drop one of the two windows and the instance is not compared at all: the report says `design.stress-unknown` ("1 of 1 instances were not compared with a declared window: 1 on a net without a declared voltage window") and the coverage line reads "Not fully checked: 0 of 1 instances were compared with a declared window." The window is what makes the comparison possible (ADR-0026 D13) |
| A class nobody has bought yet is reported, not passed over | the class is a `generic`, and `assets/procurement/primary/bulk-cap.teda` selects nothing for it | `value.procurement-generic-unsourced`, a **warning**: "cap-tantalum-7343 is used by M1.C1 but no part is selected for it" |

## What it deliberately leaves out

- **The reversal.** The same class mounted the wrong way round is an **error**
  (`design.polarity-reversed`), and an error does not belong in the corpus: the corpus is the shape
  of valid designs (`examples/cases/README.md`). That branch is pinned by the unit tests in
  `packages/core/test/ratings.test.ts` — "the wrong way round is reported, naming both nets and
  both potentials". This case pins the direction the comparison reads, not the failure it finds.
- **A part.** There is no part here and no procurement selection: the class is a requirement, and
  which part fills it is the procurement layer's business (`spec/procurement.md`). The unsourced
  line is reported as a warning, which is what the other class case carries too.
- **No layout.** The board description exists and owns the module instance, but its `place` and
  `connect` sections are empty; `bind.instance-unplaced` is the standing warning that says so.
- **No current and no dissipation.** The class states no `rated_current` and the design declares
  no current, so the current comparison has nothing to compare (ADR-0026 D16–D18), and the
  capacitor is not resistive, so the dissipation comparison has no instance to speak about.
- **No ESR.** The class declares `esr` as an optional column and the instance leaves it empty:
  what is checked here is the requirement the class states, not the part's own loss.

## What this case pins

- `expected/ir/components/cap-tantalum-7343.json`: the class's `positive_pin` (`"positive_pin":
  "1"`) beside `"polarized": true`, and the two pins typed `polarized`.
- `expected/ir/project/schematic.json`: the instance's `voltage` parameter as 10 000 000 µV, the
  two windows (`VOUT` 4 500 000..5 500 000 µV, `GND` 0..0 µV), and the net members `M1.C1.1`
  (on `VOUT`) and `M1.C1.2` (on `GND`).
- `expected/ir/**`, `expected/manifest.json`, `expected/netlist.txt`: seven shards — the board,
  the procurement page, the component, the footprint, the symbol, the project and the schematic —
  and the connectivity projection: two nets over one instance.
- `expected/diagnostics.json`: **no error**, two warnings (`bind.instance-unplaced` and
  `value.procurement-generic-unsourced`) and **no note**: the comparison reached every instance,
  so there is nothing to count as unknown.
- The coverage the report carries: **1 of 1** instances were compared with a declared window. The
  report prints the "Not fully checked" line only when the comparison falls short, so this case
  prints none — every instance was compared, and a report that says "0 errors" means it here.

## Notes on the sources

- The class, the land pattern and the symbol are the reference project's own
  (`examples/reference-project/assets/`): the tantalum capacitor of its `buck-5v` module, the
  `7343` land pattern and the polarised capacitor view. A case carries its own assets and never
  reads `external/libs` (ADR-0034).
- The numbers are the numbers of a real rail: the reference project uses the same line
  (`220u 20% 10V`) for the bulk capacitor on its 5 V buck output.
- The symbol marks the positive side in the US convention: the positive pin ends on a straight
  plate with a plus sign above it, the negative pin on an arc whose middle leans toward that
  plate. The land pattern's `package_code 7343` is the case size the drawing names.
- The pin numbers are the project's own: 1 = `P` (the positive pole), 2 = `N` (the negative one).
  The class names which of the two is the positive one; the schematic says which net sits on it.
