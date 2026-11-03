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

A symbol pin without a component fact is invalid. `lib:verify` requires exact equality between component and symbol pin sets. Every component pin that needs a physical pad must have one; extra footprint pads are reported and must be intentional (for example, a non-electrical exposed pad).

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

Use the symbol source for pin connection points, directions, lengths, styles, body geometry, and visibility only. Pin-label positions and rotations are computed by the renderer; the symbol source cannot set or control them. `.teda` has no independent per-pin text-position or text-rotation field. Do not add unsupported text keys or move pins/body solely to chase renderer label placement.

1. **Pin lattice**: a pin's connection point *and* its inner end are exact multiples of `0.5 mm`, so `length` is one too ([ADR-0057](../../docs/adr/08-libraries/0057-symbol-pins-sit-on-a-half-millimetre-lattice.md) D1). The review app snaps placement to the same `0.5 mm` grid, so a symbol dropped on the grid keeps every pin reachable by an axis-aligned wire.
2. **Symbol pin pitch**: `2.0 mm` for new regular pin rows. `2.0` is the smallest pitch that is both a multiple of `0.5` and even, so an even pin count on a side centres symmetrically. Use `2.5 mm` only where pin numbers would otherwise collide (the 100-pin MCU and the 12/9-pin sides of a wide controller), and `1.0 mm` only for two pins that must sit close together. Do not use `1.27 mm` as a symbol pin pitch.
3. **Body frame and artwork**: a visible `rect` body's edge is where the pin tails end, so its coordinates are on the lattice too. Decorative artwork that is not a frame (the resistor rectangle, inductor humps, diode triangles) keeps its shape; only the pin rows and tails move onto the lattice.
4. **Footprints are physical**: pad centres and sizes keep the datasheet's values even when they fall off the `0.5 mm` lattice. A symbol's lattice never propagates into a pad's coordinates.

### 4.3 Write the footprint

Use the syntax in [spec/footprint.md](../../spec/footprint.md). Footprint coordinates use `+x` right and `+y` down. Pad rows are:

```text
pads
  <number>  <type>  <shape>  <x>  <y>  <w>  <h>  [key=value ...]
```

Preserve the datasheet's physical values. The `2.0 mm` pin-pitch rule above is a symbol authoring convention; it does not override a package's actual pad pitch. Never change pad centers or sizes to force a convenient grid when that would change the land pattern. If a datasheet value is not on the `0.5 mm` lattice, keep the exact representable value: the lattice governs symbol artwork, not physical geometry.

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

Preview is mandatory for visual work. Contract checks cannot detect a reversed pin, a missing polarity mark, or an undersized courtyard.

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

- Symbol pin sides, order, lengths, styles, body bounds, and fields.
- Footprint pad numbering, pitch, orientation, pad sizes, thermal pad, courtyard, fab outline, silkscreen, reference mark, and fields.
- Component preview: symbol pin numbers and names agree with the matching footprint pad numbers.

## 6. Run the repository checks

Run the narrow checks first, then the project check:

```sh
bun run fmt:teda --check <project-dir>/assets/symbols
bun run fmt:teda --check <project-dir>/assets/footprints
bun run lib:verify <project-dir>
bun run check <project-dir>
```

`fmt:teda --check` checks canonical source formatting. `lib:verify <project-dir>` checks library closure, canonical compilation and contract validation, exports, rendering, and cross-asset pin/pad references. `check <project-dir>` checks the project-level contract and semantic rules.

When KiCad is available, run the downstream smoke checks as well:

```sh
bun run smoke:symbol <symbol-file> <component-file>
bun run smoke:footprint <footprint-file>
bun run lib:verify:kicad <project-dir>
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
| Symbol pin mismatch | Component and symbol number sets differ | Compare pin rows by number; fix the owner that is factually wrong, then rerun `lib:verify <project-dir>` |
| Pad mismatch or unconnected exposed pad | Footprint pad number or component pin fact is wrong | Reconcile the datasheet, component table, symbol, and pad table; do not add a duplicate alias; rerun `lib:verify <project-dir>` |
| Symbol appears upside down | Symbol `+y` convention was confused with footprint `+y` | Recompute symbol pin coordinates and rotations using [spec/symbol.md](../../spec/symbol.md); do not mirror the footprint blindly |
| Precision diagnostic | A value cannot be represented as the required integer nanometers or millidegrees | Use an exact representable datasheet value; never rely on rounding |
| Silkscreen covers a pad | Graphics were reviewed only as geometry, not as a rendered package | Move or shorten the silk, preview at high scale, then run the KiCad smoke/DRC check when available |
| Courtyard is too small | Body or assembly clearance was omitted | Re-read the package drawing and enlarge the courtyard; do not shrink pads or body geometry |
| 3D model is displaced | Model origin, rotation, or scale is wrong | Align the model to the footprint datum and verify it in a 3D-capable downstream tool |

## 8. Definition of done

A library change is complete only when all applicable items are true:

- Component, symbol, and footprint ownership is unambiguous.
- Classification paths and `<classification>:<id>` references resolve.
- Component pin numbers equal symbol pin numbers, and required pads cover the component pins.
- Every symbol pin's connection point and inner end are multiples of `0.5 mm`, new regular pin rows use `2.0 mm` spacing, and a visible body frame sits on the same lattice. Do not round physical footprint pad geometry to fit it.
- Footprint pad geometry matches the datasheet, independent of symbol spacing conventions.
- Both symbol and footprint previews were inspected at a useful scale.
- `fmt:teda --check`, `lib:verify`, and the project `check` pass.
- KiCad smoke checks pass when the downstream tool is available.
- Generated artifacts, temporary previews, and unrelated working-tree changes are not committed as source-library edits.
