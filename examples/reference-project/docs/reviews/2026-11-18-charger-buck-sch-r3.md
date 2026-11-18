# Review of charger-buck (schematic), round 3

target: board:charger-buck
owner: luffffyz
date: 2026-11-18
verdict: accepted

Artifact the input stage of the schematic (`design/sch/modules/charger-power.teda`) and the parts it
uses, after the jack and the indicators became classes
([ADR-0077](../../../../docs/adr/07-devices/0077-a-jack-and-an-led-are-classes.md)). Roles:
librarian, hardware, power. The notes stand as observations; round 1 of this board is
`2026-10-23-charger-buck-sch-r1` and round 2 is `2026-11-18-charger-buck-sch-r2`, and their
notes stay where they are. The method is
[role-reviews.md](../../../../docs/guides/role-reviews.md); the record format is
[ADR-0037](../../../../docs/adr/09-view/0037-review-records-and-attribution.md).

- librarian (2026-11-18): the jack's part number was not an identity. The string `DC-005-20A`
  names **two different drawings** — a 2013 one and a 2021 one — with different PCB layouts and
  different ratings (0.5 A / 30 V against 3 A / 24 V), and the series name `DC-005` is used by
  at least two manufacturers, each with its own drawing. A number that names two drawings cannot
  be the identity of a device, and a number copied from one of them may be the number of the
  other. Settled by: the design stating a requirement instead of a part number.
  → addressed 2026-11-18: the design states what it needs — `dc-jack-th`, a generic with
  `construction barrel`, a 2.0 mm plug, 2 A and 19 V — and the procurement layer names the part
  that fills it (`dc-005-a200`, Xun Pu, `assets/procurement/primary/charger-buck.teda`). The
  deleted part file is written down in `docs/datasheets.md`.

- librarian (2026-11-18): the old part file's `datasheet` field pointed at a **distributor's
  purchase page** (`https://item.szlcsc.com/datasheet/DC-005-20A/148060.html`), so the numbers
  the file carried (30 V, 500 mA) were the distributor's summary, not the manufacturer's
  statement. A rating that a second-hand page wrote is not the part's rating; it is that page's
  number. Settled by: the `datasheet` field naming the vendor's own document.
  → addressed 2026-11-18: `dc-005-a200`'s `datasheet` is the vendor's own product page
  (`https://www.xunpu.com.cn/product/458.html`) — the document that carries the part's numbers,
  because the vendor's PDF is a drawing (the pin table and the land pattern) and carries no
  ratings. The rule is stated once, in
  [ADR-0077](../../../../docs/adr/07-devices/0077-a-jack-and-an-led-are-classes.md) D6: the
  vendor's own document that carries the numbers, and never a distributor's purchase page.

- librarian (2026-11-18): the vendor's **own two documents disagree** about the part it sells.
  Xun Pu's product page for the `DC-005` series states 2 A and 30 V DC; the drawing of the same
  part states 30 V DC and 3 A. Both documents are the vendor's. A design that picks the higher of
  two numbers a vendor publishes for one part is sitting on a number the vendor does not
  consistently claim. Settled by: the lower number, with the contradiction written down.
  → addressed 2026-11-18: the part file states **2 A** and names the document each number came
  from; the contradiction is recorded in `docs/datasheets.md` under "Two vendor documents that
  disagree". The rule is [ADR-0077](../../../../docs/adr/07-devices/0077-a-jack-and-an-led-are-classes.md)
  D6.

- hardware (2026-11-18): the jack was rated **below** the current the design carried. The old
  file rated the part at 500 mA while the stage's own comment called for a 4 A adapter
  (`design/sch/modules/charger-power.teda:3`), and the check reported it as
  `design.rating-exceeded`. The requirement and the part have to agree: a design may not ask for
  more than the thing it buys can carry. Settled by: one adapter limit, stated as a fact and
  matched by the part's rating.
  → addressed 2026-11-18: the adapter's limit is **2 A**, declared as `current ADAPTER_P 2A`,
  `current J1.1 2A` and `current R21.1 2A` in the module's constraints
  (`design/sch/modules/charger-power.teda:142-143`, `:153`). The jack's requirement is 2 A and
  the bought part is rated 2 A, so the requirement and the part agree and the check has nothing
  to report. The old 4 A figure was a comment, never a constraint — the note stands as the
  reason the limit is now a declared fact.

- hardware (2026-11-18): the indicators were parts, and the part carried its colour in its
  **file name** (`led-green`) and its wavelength nowhere. A green LED is not one thing: it is a
  bin, and the bin is what the design states and what the buyer is asked for. The colour in a
  file name is invisible to every check and to the BOM. Settled by: the colour and the bin as
  stated values, and the part number in the procurement layer.
  → addressed 2026-11-18: `led-indicator-0603` is a generic with `construction indicator` and
  two required columns — `value green` and `wavelength 565nm` — and D2, D3 and D4 in the module
  state them (`design/sch/modules/charger-power.teda:50-52`). The part that fills them is
  `ltst-c190gkt` (Lite-On), rated from DS-22-98-0011 Rev. H: λP = 565 nm, IF = 30 mA, VR = 5 V.
  The comparison of a class is an **equality**, so the line buys a bin and not a colour
  ([ADR-0077](../../../../docs/adr/07-devices/0077-a-jack-and-an-led-are-classes.md) D3).

- power (2026-11-18): with the adapter limited to 2 A, the charger's own input current limit
  has to sit **below** it, or the design asks the adapter for more than it promised. The stage
  set that limit with the `ACSET` divider: `IDPM = VACSET / (20 × RAC)`, and `VACSET` is
  `0.395 V` from `R3` = 100 k and `R4` to ground over `VREF` = 2.1 V. With `R4` = 32.4 k that
  gives `IDPM` = 2.35 A, which is above the adapter's 2 A — the stage would have asked for more
  than the supply can give. Settled by: a divider value whose limit is under the adapter's.
  → addressed 2026-11-18: `R4` is **23.2 k** (`design/sch/modules/charger-power.teda:64`), an
  E96 value, and `IDPM` = 0.395 / (20 × 10 mΩ) = **1.98 A** ≤ 2 A. The header comment states
  the arithmetic. (23.7 k would have given 2.011 A — just over the limit — so the value is not
  interchangeable with the next step up.)

- power (2026-11-18): the stage's charge and precharge numbers did not follow from the
  resistors. The header comment claimed **3 A** charge and **0.3 A** precharge, while the sense
  resistor is `R22` = 10 mΩ and the `ISET1` / `ISET2` dividers set `VISET1` = 0.380 V and
  `VISET2` = 0.191 V. Those give `ICHARGE` = 0.380 / (20 × 10 mΩ) = **1.9 A** and
  `IPRECHARGE` = `ITERM` = 0.191 / (100 × 10 mΩ) = **0.19 A** — the comment was high by a
  factor of 1.58, which is what a 6.3 mΩ sense resistor would have produced. A comment that
  states a number no equation in the file produces is a second source of truth, and it was the
  wrong one. Settled by: the arithmetic, written where the numbers live.
  → addressed 2026-11-18: the header comment of `design/sch/modules/charger-power.teda` now
  gives the SLUS892D equation behind each number (Eq. 2 for the charge current, Eq. 4 for the
  precharge and termination current, Eq. 6 for the safety timer), with the divider values it
  uses: 1.9 A charge, 0.19 A precharge and termination, 5.2 h timer (`CTTC` = 56 nF ×
  `KTTC` = 5.6 min/nF). The safety timer was already right and stays.

- power (2026-11-18): the project root still declares `current VBAT 3A`
  (`design/sch/main.teda:49`) while the stage that charges the pack now sets 1.9 A. The two
  numbers are not the same claim — the root's figure sizes the copper that carries the rail
  (a layout question), and a design that states 3 A has told the layout to expect 3 A. Nothing
  in this round changed the root, so the note stays open: the root's rail current is a
  project-level fact, and the stage's charge current is a module-level one.
  Settled by: the schematic ceasing to carry a net's current at all, and the pcb layer sizing
  the copper from the rail's actual maximum current.
  → addressed 2026-11-18: the question this note asked was the wrong one — it asked whether the
  root's 3 A should become 1.9 A, as if the root should carry a rail current at all. The
  decision is that **it should not**: the schematic states component parameters, and a rail's
  current is a pcb-layer fact, with the copper sized from the actual maximum current
  ([ADR-0026](../../../../docs/adr/07-devices/0026-a-part-states-its-own-ratings.md) D18,
  corrected; `docs/backlog.md` F88). **Not implemented**: the language still has the
  `current <net>` constraint, the reference project still declares four rails, and the
  `design.current-rail` note still fires. The pin requirements stay — `current J1.1 2A` and
  `current R21.1 2A` are requirements on one part, which is the schematic's business.
