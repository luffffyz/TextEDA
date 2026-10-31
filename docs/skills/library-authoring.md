# Skill: Author and Review TextEDA Libraries

> **Audience**: agents and engineers creating or reviewing project-owned component symbols and footprints.
> **Scope**: the `assets/` library, its `component` facts, previews, and verification. This is an operating procedure, not a replacement for the language specifications.
> **Authority**: use [symbol-authoring.md](../guides/symbol-authoring.md), [footprint-authoring.md](../guides/footprint-authoring.md), [spec/symbol.md](../../spec/symbol.md), and [spec/footprint.md](../../spec/footprint.md) for syntax and contract details.

## 1. Non-negotiable ownership rules

A library entry is not a second schematic or PCB description. Keep each fact at its owner:

| Owner | Facts |
|---|---|
| `component` | Component identity, pin numbers, pin names, electrical types, `symbol` reference, and `footprint` reference |
| `symbol` | Pin connection points, directions, lengths, styles, body geometry, fields, units, and pin-name/number visibility |
| `footprint` | Pad numbers and geometry, pad layers, graphics, attributes, fields, package code, and optional 3D model reference |
| `sch` / `pcb` | Circuit use and board placement; neither repeats library geometry |

The symbol does not own pin names or electrical types. The footprint does not own electrical meaning. Never repair a mismatch by duplicating facts in another file.

The source of truth is the `.teda` file. IR and KiCad files are generated outputs. Do not hand-edit generated IR or treat a generated `.kicad_sym` / `.kicad_mod` as the library source.

## 2. Locate and classify the assets

Use the current project tree:

```text
assets/
├── components/<device-category>/<component-id>.teda
├── symbols/<device-category>/<symbol-id>.teda
└── footprints/<package-family>/<footprint-id>.teda
```

The directory is load-bearing:

- Symbols are classified by the device category of the part they depict.
- Footprints are classified by their package family, not by the electrical role of the component.
- References use `<classification>:<id>`, for example `symbol passives:c` and `footprint chip:chip-0402`.
- Keep the tree one classification level deep. Do not infer electrical facts from a directory name.

If the source is an external library, import a copy into `assets/` with `texteda lib import`. External libraries are templates, not build-time dependencies. Read the import procedure in [library-import.md](../guides/library-import.md) before copying files; preserve the imported revision information and then treat the copy as project-owned.

## 3. Extract facts before writing files

Start from the datasheet and make three separate fact lists. Record the source page or drawing for every non-obvious value.

### Component facts

- Exact pin number, pin name, and electrical type.
- Exposed pad or thermal pad identity, if it is an electrical pin.
- Whether the component is a specific `part` or a `generic` device.
- The component's intended symbol and footprint references.

### Symbol facts

- Pin connection-point coordinates and direction in the **symbol** coordinate system (`+x` right, `+y` up).
- Body extent and any meaningful body markings.
- Whether the part needs multiple units or common pins.
- Which pin names and numbers should be visible.

### Footprint facts

- Package body dimensions and orientation convention.
- Pad number, center, size, shape, layer, and drill data.
- Lead pitch and row offsets.
- Recommended courtyard clearance.
- Silkscreen and fab geometry that must be present.
- 3D model path and alignment, when available.

Do not copy a package drawing directly into a symbol. Symbol coordinates describe the logical drawing; footprint coordinates describe the physical land pattern and use `+y` down.

## 4. Author in dependency order

### 4.1 Write the component pin table

Create or update the component first when the pin facts are known. The pin number is the join key across all three assets. Keep the complete pin table in the component; do not put names into the symbol file.

Before previewing, check these sets:

```text
component pin numbers = symbol pin numbers
component pin numbers ⊆ footprint pad numbers
```

A symbol pin without a component fact is an error. A component pin without a drawn symbol pin is at least a warning and must be intentional. Every component pin that requires a physical pad must have one; additional pads may be warned about and need an intentional explanation (for example, a non-electrical exposed pad).

### 4.2 Write the symbol

Use the syntax in [spec/symbol.md](../../spec/symbol.md). The essential pin row is:

```text
pins
  <number>  <x>  <y>  <rot>
```

The direction convention is:

| `rot` | Pin points |
|---:|---|
| `0` | right |
| `180` | left |
| `90` | up |
| `270` | down |

The coordinate is the connection point. The body is on the pin's inner side. Use `length`, `unit`, and `style` only when the part needs a non-default value. Keep body geometry simple, symmetric, and aligned to the authoring grid.

#### Symbol house style

Apply these rules when placing new symbol pins and reviewing the rendered result:

1. **Pin-number placement**: for a horizontal pin, place the pin number above the pin; for a vertical pin, place it on the right. Keep the number clear of the pin line and body outline.
2. **Pin-label collision**: if a pin-label text would overlap another label, body geometry, or a nearby pin, rotate that text by 90 degrees so it is vertical rather than leaving the overlap.
3. **Symbol pin pitch**: use `1.25 mm` spacing for new regular pin rows. Do not use `1.27 mm` as a symbol pin pitch.
4. **Geometry grid**: use `0.05 mm` as the minimum authoring increment for library artwork. Symbol pin/body coordinates and non-dimensional footprint graphics should use exact multiples of `0.05 mm`. Physical footprint pad centers and sizes must preserve datasheet values, even when they fall off-grid.
5. **Legibility wins**: move the pin or body only when that preserves the electrical pin order and the intended symbol meaning. Do not make a visually neat symbol by changing the datasheet's pin identity.

The current `.teda` symbol contract has no per-pin text-position or text-rotation field. The reference renderer currently generates pin numbers outside the connection point along the pin axis and uses the fixed `1.27 mm` number-text offset documented in [ADR-0036](../adr/view/0036-our-own-reference-renderer.md). That offset is **not pin pitch**. Therefore:

- Do not move a pin by `1.27 mm` merely to match the renderer's number-text offset.
- Do not invent unsupported `rotate` or text-position keys in a symbol file.
- Treat the above house style as a visual acceptance rule until the source format and renderer support the placement directly.
- If exact rotated or offset pin text is a release requirement, record it as a renderer/spec gap or use an explicitly documented downstream KiCad override; do not claim that the `.teda` source expresses it.

The same limitation applies to the 90-degree collision rule: first fix the symbol geometry and spacing where possible; if the text still requires independent rotation, the current `.teda` source cannot encode that rotation. Do not hide a label just to make the preview pass unless hiding it is an intentional symbol decision.

### 4.3 Write the footprint

Use the syntax in [spec/footprint.md](../../spec/footprint.md). Footprint coordinates use `+x` right and `+y` down. Pad rows are:

```text
pads
  <number>  <type>  <shape>  <x>  <y>  <w>  <h>  [key=value ...]
```

Preserve the datasheet's physical values. The `1.25 mm` rule above is a symbol authoring convention; it does not override a package's actual pad pitch. Never change pad centers or sizes to force a convenient grid when that would change the land pattern. If a datasheet value is not on the `0.05 mm` grid, keep the exact representable value and call out the grid exception in review.

Apply these checks:

- Every electrical component pin that needs a PCB pad has the same pad number.
- `th` pads have a drill; SMD pads use the correct default or explicit layer set.
- Thermal and exposed pads are numbered deliberately and use the correct shape and layers.
- Courtyard encloses the physical package and assembly clearance.
- Silkscreen does not cover pads, mask openings, or critical reference marks.
- F.Fab describes the package for documentation; it is not a substitute for the courtyard.
- Use the standard `F.SilkS` width unless the package requires another value; use the supported graphics kinds only.
- A 3D model is optional, but its path, origin, rotation, and scale must be checked when present.

## 5. Format and preview before verification

Preview is mandatory for visual work. Contract checks cannot detect a reversed pin, a label collision, a missing polarity mark, or an undersized courtyard.

From the TextEDA repository root, use the project that owns the assets:

```sh
# Symbol only
bun run preview symbol <symbol-id> --class <device-category> --project <project-dir>

# Footprint only
bun run preview footprint <footprint-id> --class <package-family> --project <project-dir>

# Both views for one component
bun run preview component <component-id> --project <project-dir>

# Zoom small geometry
bun run preview symbol <symbol-id> --class <device-category> --project <project-dir> --scale 8
bun run preview footprint <footprint-id> --class <package-family> --project <project-dir> --scale 20
```

The default output is under `/tmp/texteda-preview/<id>/`; the command prints the absolute SVG path. Use `--out <directory>` when the artifact must be retained elsewhere. `preview` does not require KiCad. It uses the bundled stroke font, so unsupported non-ASCII text is reported rather than silently disappearing.

Inspect the actual SVG, not only the command exit status:

- Symbol pin sides, order, lengths, styles, body bounds, fields, pin-number placement, and pin-label clearance.
- Footprint pad numbering, pitch, orientation, pad sizes, thermal pad, courtyard, fab outline, silkscreen, reference mark, and fields.
- Component preview: symbol pin numbers and names agree with the matching footprint pad numbers.

## 6. Run the repository checks

Run the narrow checks first, then the project check:

```sh
bun run fmt:teda --check <project-dir>/assets/symbols
bun run fmt:teda --check <project-dir>/assets/footprints
bun run lib:verify
bun run check <project-dir>
```

`fmt:teda --check` checks canonical source formatting. `lib:verify` checks library closure and cross-asset pin/pad references. `check` checks the project-level contract and semantic rules.

When KiCad is available, run the downstream smoke checks as well:

```sh
bun run smoke:symbol
bun run smoke:footprint
bun run lib:verify:kicad
```

These checks answer a different question: whether generated KiCad artifacts can be consumed and checked downstream. They do not replace the TextEDA checks or visual preview. A missing KiCad installation blocks only these optional downstream checks, not authoring or preview.

For a documentation change to this skill, run:

```sh
bun run check:links
```

## 7. Failure diagnosis

| Symptom | Likely cause | Corrective action |
|---|---|---|
| `symbol` or `footprint` cannot be found | Wrong classification, id, or directory depth | Check `assets/<group>/<classification>/<id>.teda` and the `<classification>:<id>` reference; pass `--class` when ids collide |
| Symbol pin mismatch | Component and symbol number sets differ | Compare pin rows by number; fix the owner that is factually wrong, then rerun `lib:verify` |
| Pad mismatch or unconnected exposed pad | Footprint pad number or component pin fact is wrong | Reconcile the datasheet, component table, symbol, and pad table; do not add a duplicate alias |
| Symbol appears upside down | Symbol `+y` convention was confused with footprint `+y` | Recompute symbol pin coordinates and rotations using [spec/symbol.md](../../spec/symbol.md); do not mirror the footprint blindly |
| Pin label or number overlaps | Insufficient symbol spacing or a required text rotation is not representable | Adjust pin/body geometry first; preview again; do not add unsupported text keys or silently hide the label |
| `1.27 mm` appears in a symbol review | Renderer number-text offset was confused with pin pitch | Keep the regular pin row at `1.25 mm`; the current renderer's `1.27 mm` value is a separate text offset |
| Precision diagnostic | A value cannot be represented as the required integer nanometers or millidegrees | Use an exact representable datasheet value; never rely on rounding |
| Silkscreen covers a pad | Graphics were reviewed only as geometry, not as a rendered package | Move or shorten the silk, preview at high scale, then run the KiCad smoke/DRC check when available |
| Courtyard is too small | Body or assembly clearance was omitted | Re-read the package drawing and enlarge the courtyard; do not shrink pads or body geometry |
| 3D model is displaced | Model origin, rotation, or scale is wrong | Align the model to the footprint datum and verify it in a 3D-capable downstream tool |

## 8. Definition of done

A library change is complete only when all applicable items are true:

- Component, symbol, and footprint ownership is unambiguous.
- Classification paths and `<classification>:<id>` references resolve.
- Component pin numbers equal symbol pin numbers, and required pads cover the component pins.
- New symbol pin rows use `1.25 mm` regular spacing and keep pin/body coordinates and graphical geometry on the `0.05 mm` grid. Keep non-dimensional footprint artwork on the same grid; do not round physical pad geometry to fit it.
- Pin-number placement and any 90-degree label rotation were compared against the rendered output; unsupported source-format limitations are recorded, not hidden.
- Footprint pad geometry matches the datasheet, independent of symbol spacing conventions.
- Both symbol and footprint previews were inspected at a useful scale.
- `fmt:teda --check`, `lib:verify`, and the project `check` pass.
- KiCad smoke checks pass when the downstream tool is available.
- Generated artifacts, temporary previews, and unrelated working-tree changes are not committed as source-library edits.
