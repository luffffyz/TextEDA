# Review of charger-buck (schematic), round 2

target: board:charger-buck
owner: luffffyz
date: 2026-11-18
verdict: accepted

Artifact the input stage of the schematic (`design/sch/modules/charger-power.teda`) and the parts it
uses, after the polarity decision ([ADR-0075](../../../../docs/adr/07-devices/0075-a-ratings-polarity-is-the-roles.md)).
Roles: hardware, librarian. The notes stand as observations; round 1 of this board is
`2026-10-23-charger-buck-sch-r1`, and its notes stay where they are. The method is
[role-reviews.md](../../../../docs/guides/role-reviews.md); the record format is
[ADR-0037](../../../../docs/adr/09-view/0037-review-records-and-attribution.md).

- librarian (2026-11-18): the five MOSFETs of the input stage carried no `ratings`, so nothing
  could compare them. The stress check had no limit to compare the declared window against, and
  the coverage line counted the instances as compared while comparing nothing. The gate-source
  limit is exactly the one a P-channel part needs — `V_GS` is written `±` in the datasheet — and the
  directed model could not see the half where the source sits above the gate, which is the half
  these parts see. Settled by: the ratings the datasheets state, and a polarity that covers the
  part.
  → addressed 2026-11-18: `q-si7617dn` and `q-sis412dn` carry `drain_source_voltage` and
  `gate_source_voltage` with their terminal pairs, read off the Vishay datasheets (`V_DS` = 30 V,
  `V_GS` = ±25 V for Si7617DN; `V_DS` = 30 V, `V_GS` = ±20 V for SiS412DN), and both roles are
  `symmetric` ([ADR-0075](../../../../docs/adr/07-devices/0075-a-ratings-polarity-is-the-roles.md) D2).
  The input stage is compared for the first time: 28 of 83 instances are now compared with a
  declared window, against 24 before.

- librarian (2026-11-18): `q-si7616dn`, the part Q2 named, does not exist. Vishay's `Si76xxDN`
  family runs Si7611DN, Si7613DN, Si7615DN/ADN/BDN/CDN, Si7617DN and Si7619DN; every family
  datasheet in Vishay's document range 64700–65300 was checked and none of them is a Si7616DN, and
  no distributor lists the part number. A part file that names a part number nobody sells is a
  design fact that cannot be built, and giving it its neighbour's ratings would put numbers in the
  design that no datasheet supports. Settled by: the right part number, or the file.
  → addressed 2026-11-18: the component file is deleted and Q2 uses `q-si7617dn` — the same part as
  Q1, a P-channel 30 V SiFET whose ratings the datasheet supports. The search is written down in
  `docs/datasheets.md`.

- hardware (2026-11-18): the dissipation bound does not hold for a series element. `M1.R17`
  (10 Ω, feeding VCC from the FETs' common-source node) is reported at 78.4 W against the 62.5 mW
  floor of a 0402 chip resistor, and `M1.R21` (10 mΩ, the ACP current-sense resistor) at 39204 W
  against the line's own 1 W requirement. Both numbers are the bound `ΔV²/R` with `ΔV` the span of
  the two declared windows, not a measurement: the current through a series element is not stated by
  the language, so the bound answers "if the whole window dropped across this part". For a
  resistor in a power path that is the wrong question — the drop across R17 is a few millivolts
  and the current is set by the load, not by the window. The language has no way to say "this bound
  does not apply at this position", so the check reports what it measured, and it is right about
  what it measured. Settled by: a way for a series position to declare that the window's span is
  not the drop across it.
  → addressed 2026-11-18: the model gained the bound that speaks for a series position. When the
  design states the current through the position, the dissipation is bounded by `I² × R` as well,
  and the tighter of the two bounds binds
  ([ADR-0076](../../../../docs/adr/07-devices/0076-a-parts-dissipation-is-bounded-by-its-stated-current.md)).
  The module now declares `current R17.1 25mA` (the current into the charger's `VCC` pin, TI
  SLUS892D §8.5) and `current R21.1 4A` (the adapter current through the sense resistor), so
  `R17` is bounded at 62.5 µW and `R21` at 160 mW, and the board checks clean. No window was
  withdrawn and no finding was silenced: the bound that fired was the wrong question for a series
  position, and the design now answers the right one.
