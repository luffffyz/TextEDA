# ADR-0022: JLC Prototype Delivery (BOM / Coordinates / Part Number)

Status: Accepted
Date: 2026-10-21
Scope: Decides: the BOM, coordinate and part-number format a prototype order needs. Does not decide: the manufacturing-neutral data itself — see ADR-0021.
Related: [ADR-0021](0021-the-manufacturing-output-path.md), [ADR-0029](../devices/0029-the-procurement-layer.md)
Impact: `spec/procurement.md` §5; `packages/cli/src/bom.ts`; `docs/backlog.md` F14

## Background

**Prototype files.** Manufacturing needs Gerber + Drill; SMT placement needs BOM + coordinate files
(CPL). JLC publishes **format specifications that are independent of any EDA** (the official *JLC
BOM and Coordinate Format Specification*, updated 2026-08-11). Any EDA can produce this set of
files.

Facts on the SMT side, from the same official specification: the BOM requires `Comment` /
`Designator` / `Footprint`, and it is recommended to fill in the **JLC part number (C-number)**,
with **the number taking priority** — the official wording is "a wrong number causes wrong
matching more easily than a missing number". The coordinate file requires `Designator` / `Mid X` /
`Mid Y` / `Layer` / `Rotation`, and the recommended column order is `Designator → Footprint → Mid X
→ Mid Y → Ref X → Ref Y → Pad X → Pad Y → Layer → Rotation → Comment`, in mm, with the origin
matching the PCB. It is recommended to keep top and bottom in one file, and since each EDA rotates
the bottom layer differently, a 2D review is needed. The PCB, BOM and coordinates must be of the
same version; designators must have no duplicates and no omissions; do-not-populate handling must
be consistent — otherwise the SMT check flags an anomaly. The JLC DFM client can perform SMT checks
(open/short analysis, rout length calculation, and so on).

**The gap.** The component bindings in the reference project carry `mpn` and KiCad
symbol/footprint references but **no JLC mall part number**, so the BOM cannot reliably match SMT
materials.

## Decision

**D1. Prototype files are EDA-independent.** Gerber and Excellon are produced by this project's own
writers ([ADR-0021](0021-the-manufacturing-output-path.md)); the BOM and coordinate files are
produced according to JLC's public specification. **No JLC EDA dependency is introduced** — the
specifications are EDA-independent, so the prototype obligation adds no second EDA to the chain.

**D2. Verification still belongs to an external DRC.** This is unchanged by the added prototype
obligation ([ADR-0021](0021-the-manufacturing-output-path.md) decision 6); the JLC DFM client is
the vendor's external checker, and the boundary against building CAM-level DFM in-house stays as it
is.

**D3. Component bindings gain the JLC mall part number.** A `component` gets a new scalar `lcsc
<C-number>` (e.g. `C14663`).

- **Part numbers are not guessed.** The part number must be manually verified before being
  written. A wrong number is more dangerous than no number — the official text says so — so tools
  must not fill it in automatically and must not guess by model.
- The `lcsc` may be omitted for common passive parts (the category is `resistor` / `capacitor` /
  `inductor` and `params` contains `value`).
- A missing `lcsc` does not block export, but the BOM export must give a **warning** and mark
  that row as "pending manual matching".

**D4. The BOM and coordinate files are a projection of the IR.** They are export targets and
introduce no new semantics:

- BOM columns: `Comment` (component description), `Designator`, `Footprint` (taken from the
  package code), the JLC part number (taken from `lcsc`), `Quantity`.
- Coordinate columns: `Designator`, `Mid X`, `Mid Y`, `Layer`, `Rotation` (derived from the
  placement), in mm, with the origin matching Gerber.
- Consistency — PCB, BOM and coordinates of the same version; designators with no duplicates and
  no omissions; consistent do-not-populate handling — is guaranteed by the checker, which refuses
  to emit the package otherwise.

**D5. The measured LCEDA format facts.** The facts below were measured from a real project
backup. They are kept for two reasons: the `Supplier Part` field is the empirical confirmation
of the `lcsc` scalar (D3), and the per-pad mask and paste finding constrains how the mask and
paste rules may land at export time ([ADR-0018](../pcb/0018-copper-fill-uses-a-geometry-kernel.md)).
**No native LCEDA project output is in scope**; nothing here commits the project to one.

The `.epro2` file exported by JLC EDA Professional is a zip containing `project2.json` (title and
editor version), `<name>.epru` (project data), and `IMAGE/*.webp` (models and images). The
`.epru` is the official V3 format: **each line is `{outer}||{inner}`**, where the outer is
`{type, id, ticket, firstTicket}` — the `id` is often a composite id of the form
`["type","key"]`, and `ticket` determines final consistency — and the inner is the data.

A project is self-contained: it embeds its components, symbols and footprints. The document kinds
are `SCH` 1, `SCH_PAGE` 2, `SYMBOL` 38, `DEVICE` 38, `FOOTPRINT` 13, `PCB` 1, `BOARD` 1,
`CONFIG` 1, `BLOB` 1.

| Content | LCEDA record | Field essentials |
|---|---|---|
| Net name | `NET` | The net name is in the **outer id**: `["NET","GND"]`; auto-generated net names look like `$1N1324` |
| Trace | `LINE` | `{netName, layerId, startX/Y, endX/Y, width}` |
| Via | `VIA` | `{netName, centerX/Y, holeDiameter, viaDiameter, viaType, topSolderExpansion, bottomSolderExpansion}` |
| Pad (inside a footprint document) | `PAD` | `{netName, layerId, num, centerX/Y, defaultPad{padType,width,height,radius}, specialPad, hole, plated, topSolderExpansion, bottomSolderExpansion, topPasteExpansion, bottomPasteExpansion}` |
| Pad↔net binding | `PAD_NET` | Outer id = `["PAD_NET",<component id>,<pad number>,<net id>]` |
| Component | `COMPONENT` + child `ATTR` | `COMPONENT` stores position/angle/layer; designator, value, footprint and device are `ATTR` child records (their `parentId` points back to the component), with `key` ∈ `Designator` / `Value` / `Footprint` / `Device` |
| Copper pour | `POUR` + `POURED` | `POUR` stores the outline (`netName/layerId/width/path/pourType{fineness}/keepIsland`); `POURED` stores the **fill result** — a derivative quantity, and both are present in the file |
| Rules | `RULE` + `RULE_SELECTOR` | `RULE` stores `ruleContext{unit:"mm", safeSpacing[…]}`; `RULE_SELECTOR` has 18 entries, bound by selectors such as `["NET","+5V"]` — that is, per-net rules |
| Component metadata | `DEVICE`'s `META.attributes` | `{"LCSC Part Name", "Supplier Part", "Manufacturer", "Manufacturer Part", "Supplier Footprint", "JLCPCB Part Class", "Datasheet"}` plus `images` and `tags` |
| Layers | `LAYER` | 1 Top, 2 Bottom, 3/4 silkscreen, 5/6 solder mask, 7/8 solder paste, 9/10 assembly, 11 board outline, 12 Multi, 13 Document, 14 Mechanical; the board outline is a `POLY` (`polyType: BOARD_OUTLINE`) |

Two pitfalls are worth stating because following the official wording would produce wrong numbers:

1. **The unit is 1 mil (0.0254 mm), not the 0.01 inch the official documentation claims.** The
   evidence: a 0402 pad `19.685×21.26` → 0.50×0.54 mm; a 0603 pad `31.496×35.433` →
   0.80×0.90 mm; a USB-C contact `11.811×55.118` → 0.30×1.40 mm; a trace width `11.811` →
   0.30 mm; a via `21.6536/11.811` → 0.55/0.30 mm. The official *JLC EDA File Format* V3 chapter
   says "0.01 inch", which differs by a factor of 10; following the official wording would scale
   everything by 10×.
2. **Solder mask expansion and solder paste expansion are per-pad fields** (`topSolderExpansion` /
   `topPasteExpansion` and so on), not board-level settings. The mask and paste rules therefore
   have to land on every pad at export time, not only as board-level defaults.

**The part number field is confirmed**: the JLC mall part number is exactly `DEVICE`'s
`attributes["Supplier Part"]` (values like `C14663`). This project's `component` scalars `mpn` /
`manufacturer` / `lcsc` correspond one-to-one to `Manufacturer Part` / `Manufacturer` /
`Supplier Part`.

The script that parses the project data remains a one-off analysis script and is not in the
repository.

## Consequences

- The prototype chain adds no external dependency, but the IR gains one more fact that must be
  maintained by hand (the part number); a wrong one silently places the wrong part — hence the
  rule "do not guess part numbers, warn when missing".
- The BOM and coordinate column names are coupled to the JLC specification, so specification
  changes must be followed; that goes into the periodic review.
- The supplier part number is the only vendor-specific field in the device contract: it is a fact
  about the physical part, not about the schematic, so it stays on the device and never leaks into
  nets or constraints.
- A vendor format carries its own unit and its own field placement, so a reader of this record
  should not assume that another vendor's format behaves the same way. What is reusable is the
  *shape* — a projection of the IR into the vendor's columns — not the constants.

## Open Points

- The BOM and coordinate file export follows decision 4.
- The `lcsc` scalar and its validation rule are in `spec/teda.md` §6.1; the demo devices do not
  carry part numbers, because a number that nobody verified is worse than none.
