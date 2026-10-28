# ADR-0130: Self-Built Symbol Libraries Use Our Own Format

Status: Accepted
Date: 2026-10-20
Scope: Decides: that a self-built symbol library uses our own format, and that a pin's electrical facts live in the device rather than in the symbol. Does not decide: the device vocabulary — see ADR-0124.
Related: [ADR-0127](../devices/0127-package-code-and-3d-models.md), [ADR-0129](0129-footprint-format-and-geometry.md), [ADR-0131](0131-the-reference-project-is-self-built.md), [ADR-0135](../view/0135-our-own-reference-renderer.md)
Impact: `spec/symbol.md`; `packages/cli/src/lib-import.ts`

## Background

[ADR-0129](0129-footprint-format-and-geometry.md) settled that "self-built footprint libraries are written in `.teda` and the KiCad format is an export artifact", and left the symbol side open (`AGENTS.md` §11 question 3). This ADR answers it.

There is one key difference between symbols and footprints, and it decides that symbols must not copy the structure of footprints:

- **A footprint is pure geometry**: pad positions, silkscreen, courtyard, 3D references — all "how to draw it", with no "what it is".
- **A symbol is half geometry, half electrical fact**: **where a pin is drawn** is a view; **what a pin is called, what electrical type it has, what number it has** are facts of the component.

If the symbol file also carried pin names and electrical types, the same fact would have two owners (`component.pins` and `symbol.pins`), and there would be no rule for arbitrating when the two disagree — an amplified version of the "component description drift" pitfall in `AGENTS.md` §7. KiCad itself has hit this historically: the pin names in the symbol library did not match the actual component datasheet, and the only fix was for a human to edit the symbol in KiCad, after which it diverged from the other copy in the schematic.

Another practical constraint: **symbol libraries are almost always borrowed**. The vast majority of symbols in a project come from the KiCad official libraries or JLC, and only a few are self-built (custom components, special packages, ones whose drawing needs to change). So the symbol-side effort concentrates on "can we correctly **consume** someone else's library" and "can the few self-built ones be validated", not on "migrating the whole symbol library into our format".

## Decision

1. **The source of truth of a self-built symbol is `.teda` source code**, with the syntax described in `spec/symbol.md`. One symbol per file: `assets/symbols/<lib>/<symbol_id>.teda`; the library name is determined by the directory and is not part of the file content. Isomorphic to `footprint`: compiled into an IR shard (the `symbol` kind of the IR contract, a closed schema), and `.kicad_sym` is an export artifact.
   - **Why not writing JSON directly**: same as [ADR-0129](0129-footprint-format-and-geometry.md) decision 1 — the agent's working surface is the `.teda` source plus line/column-level diagnostics, not JSON paths.
2. **There is exactly one owner of the electrical facts of a pin: `component`**. The `symbol` only records **where a pin is drawn and how it is drawn** (position, orientation, length, style, unit membership), plus the outline and the display switches; it **does not record pin names and does not record electrical types**.
   - When exporting `.kicad_sym` the two are combined: the pin numbers and positions come from `symbol`, the pin names and electrical types come from `component`, and they are matched **by pin number**.
   - **The two pin number sets must be aligned**: the symbol has it but the component does not → **error** (the export refuses); the component has it but the symbol does not draw it → **warning** (it may be a deliberately hidden power pin).
   - `component.symbol = "<lib>:<name>"` is the only binding point; the symbol file does not restate the reference relation.
3. **An external symbol library is a template, not a dependency.** The build reads no external
   library: an official, a company-internal and a third-party library are all used the same way —
   copied into `assets/` once by `texteda lib import` and owned by the project afterwards (see
   [ADR-0133](0133-trust-in-a-library-you-do-not-own.md)). `scripts/verify-libs.ts` therefore
   requires every device's `symbol` and `footprint` to resolve **inside** the project, and a
   qualified `<lib>:<id>` reference is an error rather than a resolution.
4. **The symbol range supported in v0.1**: pin placement (position/orientation/length/style/unit), outline (`rect`/`line`/`circle`/`arc`/`poly`, with line width and fill), unit grouping (`units`), display switches (pin number/pin name visibility, name offset), attribute fields (`Reference`/`Value`/`Datasheet`/arbitrary fields).
   **Not supported yet**: text annotations (polarity `+`/`−`, function names), images, Béziers, polyline stroke styles. The gaps are not force-fitted: in a self-built library you can hand-write a `.kicad_sym` as a fallback (the same escape-hatch rule as for `footprint`).
5. **The coordinate convention follows the target format**: symbols use **+x to the right, +y upward** (the KiCad symbol convention), footprints use +y downward (the PCB convention). Each side follows its target format, and the exporter does not flip symbols — flipping is a purely visual operation and stays in the render layer (`AGENTS.md` §6).
6. **Unit conversion happens only at the boundary**: on parsing, values are converted to **integer nanometers / integer millidegrees** ([ADR-0104](../ir/0104-ir-representation.md) decision 3); a value that is not an integer is an error, and nothing is rounded. The canonical form converts back to the column's default unit (mm / degrees) when writing.
7. **What does not change**: symbol geometry still **does not enter the `.teda` board description** ([ADR-0129](0129-footprint-format-and-geometry.md) decision 1 unchanged); symbols do not participate in connectivity determination and do not write back to IR.

## Consequences

- **The benefit**: self-built symbols have a schema, a canonical form, and a readable diff; there is only one copy of the pin facts, so drift is downgraded from "manual synchronization in two places" to "the tool reports an error".
- **The cost**: exporting `.kicad_sym` requires both the symbol and the component description at once, one more parameter for the exporter; the symbol library format is narrower than the footprint format (no layers, no pad geometry), but it adds one cross-description constraint that the footprint format does not have (the pin numbers must be aligned).
- **It works end to end** (`bun run smoke:symbol`, measured): the example symbol (`examples/reference-project/assets/symbols/project/bq24610rger.teda`) → compiled to IR (the contract passes, 25 pins) → merged with `component` by pin number (pin names/electrical types in place) → `.kicad_sym` written out (25 pins) → **KiCad 10 can parse it** (`kicad-cli sym upgrade`) → **it renders** (`kicad-cli sym export svg` produces an image; the outline, the left and right pins, the top and bottom pins, and the names are all correct).
- **IR ordering depends only on semantics** (measured): `pins` by (`unit`, `number` in natural order), `body` by (`kind`, coordinates), `fields` by name, `tags` in byte order; the same symbol with reordered entries, changed units, or a changed key order compiles to IR **byte-identical** to the canonical source.
- **`fmt` works** (measured): `bun run fmt:teda --check examples/reference-project/symbols` exits 0; the example files are fixed points of `fmt`. `fmt` only reorders the surface and refuses to format when there are semantic errors (consistent with gofmt).
- **Diagnostics are given by line and column**: unknown scalars, unknown keys, out-of-range `unit`, a missing `layer`, and duplicate pin numbers are all reported at `file:line:col` (`packages/parser/src/symbol.ts`).
- **An honest projection**: `packages/parser/src/component-facts.ts` reads only the few things needed to export a symbol from the `component` description (the pin table, the footprint, the datasheet, the description). It is a projection over the full device parser, which now exists (`packages/parser/src/component.ts` carries the `PARAM_TYPES` table, the `mpn` / `category` branches, and the part/generic identity rules of ADR-0123). The `lcsc` shape check (`^C[0-9]+$`) lives in the IR contract rather than the parser, so that one sub-claim was never a parser feature. The projection strictly validates the part it does read, skips the remaining sections verbatim, and does not pretend to have validated them.

## Follow-up

- A full parser for `component` (`params` columns, variants, `lcsc` validation) — next.
- An **import** path for the KiCad official symbol libraries (reading `.kicad_sym` into our IR, to check whether the pin numbers of a borrowed library match `component`).
- Text annotations for symbols (polarity, function names) and images.
- Joint validation of symbols and footprints: the symbol pin numbers ⊇ the component pin numbers, the component pin numbers ⊆ the footprint pad numbers (the library-level check of [ADR-0129](0129-footprint-format-and-geometry.md) decision 3 is done in the toolchain).
