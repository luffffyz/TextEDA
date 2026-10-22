# ADR-0006: JLC Prototype Delivery (BOM / Coordinates / Part Number)

Status: Accepted (revised 2026-10-21: scope narrowed to the public BOM / coordinates format specification and the part-number binding)
Date: 2026-10-21
Impact: `teda.md` §6.1 (new `lcsc` scalar), §11, §13; `docs/adr/0005-manufacturing-output.md` decisions 1, 4

## Background

- **Prototype files**: manufacturing needs Gerber + Drill, SMT placement needs BOM + coordinate files (CPL). JLC provides **public format specifications independent of any EDA** (official *JLC BOM and Coordinate Format Specification* (嘉立创BOM&坐标相关格式规范), updated 2026-08-11). Any EDA can produce this set of files.

Facts on the SMT side (from the same official specification): the BOM requires `Comment` / `Designator` / `Footprint`, and it is recommended to fill in the **JLC part number (C-number)**, with **the number taking priority** — the official wording is "a wrong number causes wrong matching more easily than a missing number"; the coordinate file requires `Designator` / `Mid X` / `Mid Y` / `Layer` / `Rotation`, and the recommended column order is `Designator → Footprint → Mid X → Mid Y → Ref X → Ref Y → Pad X → Pad Y → Layer → Rotation → Comment`, in mm, with the origin matching the PCB; it is recommended to keep top and bottom in one file, and since each EDA rotates the bottom layer differently, a 2D review is needed. The PCB, BOM and coordinates must be of the same version, designators must have no duplicates and no omissions, and do-not-populate handling must be consistent, otherwise the SMT check flags an anomaly. The JLC DFM client can perform SMT checks (open/short analysis, rout length calculation, etc.).

Current gap: the component bindings in the project (`examples/reference-project/assets/components/**/*.teda`) only have `mpn` and KiCad symbol/footprint references, **no JLC mall part number**, so the BOM cannot reliably match SMT materials.

## Decision

1. **Prototype files are EDA-independent**: Gerber / Excellon are produced by the KiCad chain (`docs/adr/0005-manufacturing-output.md` decision 1); the BOM and coordinate files are produced according to JLC's public specification. **No JLC EDA dependency is introduced** — the specifications are EDA-independent, so the prototype obligation adds no second EDA to the chain.
2. **Verification still belongs to KiCad DRC** ([ADR-0005](0005-manufacturing-output.md) decision 6), unchanged by the added prototype obligation; the JLC DFM client is the vendor's external checker, and our boundary of not building CAM-level DFM in-house stays as is.
3. **Component bindings gain the JLC mall part number**: `component` gets a new scalar `lcsc <C-number>` (e.g. `C14663`). Rules:
   - **Part numbers are not guessed**: the part number must be manually verified before being written. A wrong number is more dangerous than no number (the official text says so), so tools must not fill it in automatically and must not guess by model.
   - The `lcsc` may also be omitted for common passive parts (`category` is `resistor` / `capacitor` / `inductor` and `params` contains `value`).
   - A missing `lcsc` does not block export, but the BOM export must give a **warning** and mark that row as "pending manual matching".
4. **The BOM and coordinate files are a projection of the IR** (export targets), introducing no new semantics:
   - BOM columns: `Comment` (component description), `Designator`, `Footprint` (taken from `package`), the JLC part number (taken from `lcsc`), `Quantity`.
   - Coordinate columns: `Designator`, `Mid X`, `Mid Y`, `Layer`, `Rotation` (derived from `place`), in mm, with the origin matching Gerber.
   - Consistency (PCB / BOM / coordinates of the same version, designators with no duplicates and no omissions, consistent do-not-populate handling) is guaranteed by the checker, which refuses to emit the package otherwise.

## Consequences

- The prototype chain adds no external dependency (still only KiCad), but the IR gains one more fact that must be maintained by hand (the part number); a wrong one silently places the wrong part → hence the rule "do not guess part numbers, warn when missing".
- The BOM / coordinate column names are coupled to the JLC specification → spec changes must be followed, so this goes into the periodic review.
- The supplier part number is the only vendor-specific field in the component contract: it is a fact about the physical part, not about the schematic, so it stays on the component and never leaks into nets or constraints.

## Follow-up

- `teda.md`: add the `lcsc` scalar and the validation rule (`C[0-9]+`) — done; demo components do not carry part numbers for now (no guessing).
- Implement BOM and coordinate file export, following the columns of decision 4.
- Periodically review the JLC BOM / coordinate specification page.

## Appendix: measured LCEDA format facts (2026-10-20, from the real project backup `ProPrj_DMX512_FT232_2026-10-20.epro2`)

Kept as reference material for two reasons: the `Supplier Part` field is the empirical confirmation of `teda.md` §6.1's `lcsc` scalar (decision 3), and the per-pad mask / paste finding constrains how `rules.mask` / `rules.paste` may land at export time ([ADR-0005](0005-manufacturing-output.md)). **No native LCEDA project output is in scope**; nothing here commits us to one.

The `.epro2` exported by JLC EDA Professional 4.1.78 is a zip containing `project2.json` (title / editorVersion), `<name>.epru` (project data), `IMAGE/*.webp` (models and images). `.epru` is the official V3 format: **each line is `{outer}||{inner}`**, where the outer is `{type, id, ticket, firstTicket}` (the `id` is often a composite id of the form `["type","key"]`, and `ticket` determines final consistency), and the inner is the data.

**Document kinds** (a project is self-contained): `SCH` 1, `SCH_PAGE` 2, `SYMBOL` 38, `DEVICE` 38, `FOOTPRINT` 13, `PCB` 1, `BOARD` 1, `CONFIG` 1, `BLOB` 1. Components, symbols and footprints are all embedded in the project (`ELE_PLACEHOLDER` records library object counts, e.g. `{dataType:"PAD", max:19}`).

**Key record models** (and where they land in this project's IR):

| Content | LCEDA record | Field essentials |
|---|---|---|
| Net name | `NET` | The net name is in the **outer id**: `["NET","GND"]`; auto-generated net names look like `$1N1324` |
| Trace | `LINE` | `{netName, layerId, startX/Y, endX/Y, width}` |
| Via | `VIA` | `{netName, centerX/Y, holeDiameter, viaDiameter, viaType, topSolderExpansion, bottomSolderExpansion}` |
| Pad (inside a footprint document) | `PAD` | `{netName, layerId, num, centerX/Y, defaultPad{padType,width,height,radius}, specialPad, hole, plated, topSolderExpansion, bottomSolderExpansion, topPasteExpansion, bottomPasteExpansion}` |
| Pad↔net binding | `PAD_NET` | Outer id = `["PAD_NET",<component id>,<pad number>,<net id>]` |
| Component | `COMPONENT` + child `ATTR` | `COMPONENT` stores position/angle/layer; designator, value, footprint and device are `ATTR` child records (`parentId` points back to the component), with `key` ∈ `Designator` / `Value` / `Footprint` / `Device` |
| Copper pour | `POUR` + `POURED` | `POUR` stores the outline (`netName/layerId/width/path/pourType{fineness}/keepIsland`), `POURED` stores the **fill result** (a derivative quantity; both are present in the file) |
| Rules | `RULE` + `RULE_SELECTOR` | `RULE` stores `ruleContext{unit:"mm", safeSpacing[…]}`; `RULE_SELECTOR` has 18 entries, bound by selectors like `["NET","+5V"]` (i.e. per-net rules) |
| Component metadata | `DEVICE`'s `META.attributes` | `{"LCSC Part Name", "Supplier Part", "Manufacturer", "Manufacturer Part", "Supplier Footprint", "JLCPCB Part Class", "Datasheet"}` + `images` + `tags` |
| Layers | `LAYER` | 1 Top, 2 Bottom, 3/4 silkscreen, 5/6 solder mask, 7/8 solder paste, 9/10 assembly, 11 board outline, 12 Multi, 13 Document, 14 Mechanical; the board outline is a `POLY` (`polyType: BOARD_OUTLINE`) |

**Two important pitfalls**:

1. **The unit is 1 mil (0.0254 mm), not the 0.01 inch the official documentation claims.** Evidence: 0402 pad `19.685×21.26` → 0.50×0.54 mm; 0603 pad `31.496×35.433` → 0.80×0.90 mm; USB-C contact `11.811×55.118` → 0.30×1.40 mm; trace width `11.811` → 0.30 mm; via `21.6536/11.811` → 0.55/0.30 mm. The official *JLC EDA File Format* (嘉立创EDA文件格式) V3 chapter says "0.01 inch", which differs by a factor of 10; following the official wording would scale everything by 10×.
2. **Solder mask expansion and solder paste expansion are "per-pad" fields** (`topSolderExpansion` / `topPasteExpansion` etc.), not board-level settings → the IR's `rules.mask` / `rules.paste` must land on every pad at export time, not only as board-level defaults.

**Part number field confirmed**: the JLC mall part number is exactly `DEVICE`'s `attributes["Supplier Part"]` (values like `C14663`). This project's `component` scalars `mpn` / `manufacturer` / `lcsc` correspond one-to-one (to `Manufacturer Part` / `Manufacturer` / `Supplier Part`). `teda.md` §6.1's `lcsc` therefore gains empirical backing.

The script that parses `.epru` remains a one-off analysis script, not in the repository.
