# MCU Board (mcu-board) Component Selection

## Board positioning

- CH32V307VCT6 minimal system + 3.3V LDO: 5V in, 3.3V out, SWD (PA13/PA14) reserved.
- Selection principle: the pins and electrical parameters of every component can be looked up in the **local datasheet** (`docs/datasheets/`); no values taken from memory or second-hand pages.

## Datasheet localization

> The vendor PDFs in `docs/datasheets/` are **not committed** (copyright-protected, already excluded by `.gitignore`). Download them yourself from the vendor websites using the file names in the table below.

| Component | Local file | Original source |
|---|---|---|
| TPS7A2033PDBVR | `docs/datasheets/tps7a20.pdf` | TI SBVS348H (TPS7A20, 2024-07 revision) |
| CH32V307VCT6 | `docs/datasheets/CH32V307DS0.pdf` | WCH V3.9 (CH32V303/305/307/317 datasheet) |
| SST-3225/8.000M-12PF | `docs/datasheets/SST-3225-8M-12PF-10PPM.pdf` | Sichuan Sorst "Approval Sheet" |
| TS-1187 | `docs/datasheets/TS-1187.pdf` | Shuofang Precision TS-1187 series specification |

## Component selection table

| Ref | Component | Part number | Package | Value / parameters | Basis | Library file |
|---|---|---|---|---|---|---|
| U1 | MCU | CH32V307VCT6 | LQFP-100 | — | CH32V307DS0 V3.9 Table 3-1 pin definitions | `components/mcu/ch32v307vct6.teda` |
| U2 | LDO 3.3V | TPS7A2033PDBVR | SOT-23-5 | 3.3V / 300mA | SBVS348H §4 pin functions, §5.3 recommended operating conditions | `components/regulators/tps7a2033pdbvr.teda` |
| Y1 | Crystal | SST-3225/8.000M-12PF | SMD-3225-4P | 8.000MHz, CL=12pF, ±10ppm | Sorst approval sheet, electrical characteristics / Connection diagram | `components/passives/xtal-8mhz-3225.teda` |
| SW1 | Tactile switch | TS-1187 | SMD-5.2×5.2mm-4P | Normally open, closes on press | TS-1187 circuit diagram (1-2 and 3-4 form one pair each) | `components/mechanical/sw-ts-1187.teda` |
| C1–C7 | Decoupling capacitors | 0402 X7R 16V | 0402 | 100nF | One per VDD/VIO/VDDA pin | `c-0402` |
| C8 | 3V3 rail bulk | 0402 X7R 10V | 0402 | 1µF | CH32V307DS0 V3.9 Table 4-2: VDDA must be the same as VIO → VDDA tied directly to 3V3, 1µF as local bulk | `c-0402` |
| C9 | LDO input | 0402 X7R 10V | 0402 | 1µF | SBVS348H footnote 2: CIN effective value ≥0.47µF | `c-0402` |
| C10 | LDO output | 0402 X7R 10V | 0402 | 1µF | SBVS348H footnote 3: COUT effective value 0.47–200µF | `c-0402` |
| C11, C12 | Crystal load | 0402 C0G/NP0 | 0402 | 10pF | Load-capacitance matching (see below) | `c-0402` (`dielectric C0G`) |
| C13 | NRST | 0402 | 0402 | 100nF | Engineering practice, not specified by the datasheet | `c-0402` |
| R1 | NRST pull-up | 0402 | 0402 | 10k | Engineering practice, not specified by the datasheet | `r-0402` |
| R2 | BOOT0 pull-down | 0402 | 0402 | 10k | CH32V307DS0 V3.9 pin note 5: chips with BOOT0 not brought out have an internal pull-down; this chip's BOOT0 is brought out | `r-0402` |
| R3 | Indicator current limit | 0402 | 0402 | 1k | 3.3V → green LED | `r-0402` |
| D1 | Power indicator | LTST-C190GKT | 0603 | Green | Already in the library | `components/indicators/led-green.teda` |

Decoupling-capacitor placement (pin numbers from CH32V307DS0 Table 3-1): VDD_5(11), VDD_4(28), VDD_2(75), VIO_1(50), VIO_3(100), VDDA(22), VREF+(21).

## Key calculations

### Crystal load capacitance

```
CL_eff = C1·C2/(C1+C2) + C_stray
C_stray = OSC_IN input capacitance ≤5pF (CH32V307DS0 Chapter 4, electrical characteristics) + PCB trace parasitics ≈2pF ≈ 7pF
C1 = C2 = 10pF → C1·C2/(C1+C2) = 5pF → CL_eff = 5 + 7 = 12pF = crystal CL ✓
```

- Crystal ESR ≤150Ω (approval sheet §6); the MCU-side HSE drive current is 0.53mA at a 20pF load (CH32V307DS0 Chapter 4, electrical characteristics). 150Ω is the upper limit and startup margin is slim; if oscillation proves difficult in practice, switch to a same-CL model with ESR ≤60Ω.
- Choose C0G/NP0 for the load capacitors; the value drift of X7R with temperature/bias would push frequency offset into the clock.

### LDO input/output capacitors

- CIN: effective value ≥0.47µF (SBVS348H footnote 2); use 1µF X7R 0402 (still >0.47µF effective under 3.3V bias).
- COUT: effective value 0.47–200µF (footnote 3); use 1µF X7R 0402; the ESR of X7R at 3.3V is far below the 100mΩ limit.

### Current budget

| Item | Typical value | Source |
|---|---|---|
| MCU running at 144MHz (all peripherals on) | 22.4mA | CH32V307DS0 Table 4-6 |
| MCU running at 144MHz (all peripherals off) | 12.4mA | Table 4-6 |
| MCU running at 8MHz | 1.8mA | Table 4-6 |
| LDO capability | 300mA | SBVS348H §5.3 |

300mA leaves ample margin on the MCU side; the USB HS PHY current is not in the table above — if the board runs USB, it must be accounted separately.

### Reset and boot

- The chip has built-in POR/PDR; the external reset circuit exists only for debugging and manual reset: NRST with a 10k pull-up + 100nF to ground, and the button pulls NRST directly low.
- BOOT0 must have an external 10k pull-down; otherwise it floats at power-up and may mistakenly enter download mode.
- VREF+ and VDDA both connect to 3V3, VREF- connects to VSS (when the ADC is not used, VDDA must be the same as VIO; VREF+ 2.4–3.6V).

## Schematic

`sch/mcu-board.teda` (`version 0.2`, single-page board: if it fits on one page, do not split it).

- **Power**: `VIN_5V` (board-level port `DC_IN`) → U2.IN and U2.EN (EN tied directly to IN, always on; the datasheet says EN has an internal 500kΩ pull-down, so it is off by default) → U2.OUT = `V3V3`; C9 sits at IN, C10 at OUT, C8 provides bulk for the 3V3 rail.
- **MCU power**: `V3V3` feeds VDD_2/VDD_4/VDD_5/VIO_1/VIO_3/VDDA/VBAT/VREF+, each with one 100nF (C1–C7); VSSA and each VSS go to ground, VREF- to ground.
- **Clock**: Y1 (1=OUT, 3=IN, 2/4=ground) bridges U1.OSC_OUT / U1.OSC_IN, with C11/C12 of 10pF each to ground.
- **Reset and boot**: NRST = U1.NRST + R1 (10k pull-up to 3V3) + C13 (100nF to ground) + SW1 (pins 1/2 to NRST, pins 3/4 to ground); BOOT0 goes to ground through R2 (10k).
- **Indicator**: 3V3 → R3 (1k) → D1 (green) → GND.
- **External ports**: `DC_IN`, `VOUT_3V3`, `GND`, `SWDIO` (PA13), `SWCLK` (PA14), `NRST`, `BOOT0`.

Known ERC warnings (expected, not errors):

- `SWDIO` / `SWCLK` each have only one member — add the second end once the connector component is in the library.
- Unused GPIOs are unconnected pin by pin — board-level reservations.

## Open items

- **Connectors**: 5V input, 3.3V output, SWD header — the library has no connector component, so they are expressed with board-level `ports` for now; add the component to the library once decided.
- **ESD/TVS**: add at the 5V entrance if EMC requires it; the part depends on the actual connector.
- **USB**: the CH32V307 has USB HS/FS; whether to include USB determines the ESD and power-supply scheme.
- **Y1 startup margin**: see above; switch to a low-ESR model if necessary.
- **PCB**: there is no PCB description for this board under `pcb/` yet, so sch↔pcb binding verification is currently unavailable.
