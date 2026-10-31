# ADR-0036: Our Own Reference Renderer — IR → Drawing Commands → SVG

Status: Accepted
Date: 2026-10-20
Scope: Decides: that the reference renderer is ours, reads the IR and writes SVG, and that its output must be verifiable against the IR. Does not decide: the export targets — see ADR-0021.
Related: [ADR-0031](../08-libraries/0031-symbol-format.md), [ADR-0035](0035-the-view-layer-is-a-drawing.md), [ADR-0037](0037-review-records-and-attribution.md)
Impact: `packages/renderer/src/**`; `spec/symbol.md`; `spec/footprint.md`; `spec/schematic-view.md` §9.5

## Background

The first item under "is" in `AGENTS.md` §1 already says the project needs a **reference renderer** (SVG for sch first), but the only places in the repository where you can "see" library files are two one-off smoke scripts: `scripts/smoke-symbol.ts` and `scripts/smoke-footprint.ts`. Each of them hardcodes one sample (`bq24610rger` / `sot-23-5`), drops the output in `/tmp/texteda-sym-smoke/` and `/tmp/texteda-fp-smoke/`, and prints no path; an agent that has just built a footprint/symbol **cannot see its own work**.

The cost of this is not just "inconvenient to look at a picture", it is **turning whether KiCad is installed into a precondition for being able to work at all**:

- Checks all green ≠ looks right. A pin facing the wrong way, an arrow that was not drawn, a courtyard that is too small, silkscreen overlapping a pad — all of these are green under IR and contract checks (the checks only look at self-consistency, not at whether it looks right).
- Every look pulls up a `kicad-cli`, so the authoring loop hangs off KiCad.
- And KiCad's position in this project is the **manufacturing output** ([ADR-0021](../06-manufacturing/0021-the-manufacturing-output-path.md) decisions 1 and 3: Gerber / Excellon / DRC belong to it). The preview is a matter of the **design loop** and must not go through that path.

## Decision

1. **New package `packages/renderer`** (`@texteda/renderer`, structured like `ir` / `parser` / `exporter`):
   - `renderSymbol(ir, part): SvgDoc`, `renderFootprint(ir): SvgDoc`; P1 adds `renderSchematic(view, instances): SvgDoc` (landed 2026-10-21) — the page's view IR plus the caller-resolved symbol and pin facts, because the renderer reads no files ([ADR-0038](../10-process/0038-implementation-stack-and-agent-entry.md) decision 1).
   - **The intermediate representation is a list of drawing commands** (`line` / `rect` / `circle` / `arc` / `poly` / `polyline` / `text` / `pin` / `pad`), not string concatenation: only then can we write assertions, do round-trips, and later attach other backends.
   - Pure functions, no I/O, no global state; **rendering the same IR twice yields byte-identical output** (no timestamps, no randomness).
2. **The coordinate system follows the source**: symbol +y up, footprint +y down ([ADR-0031](../08-libraries/0031-symbol-format.md) decision 5); lengths are always **integer nanometers**, converted to mm on output. When converting to SVG, y is flipped according to `orientation` (SVG's y points down).
3. **The preview command is a thin shell** (`scripts/preview.ts`):
   ```bash
   bun run preview symbol|footprint|component <id> [--lib <name>] [--out <dir>] [--scale <n>] [--project <dir>]
   ```
   - The `component` mode produces **two pictures, symbol + footprint**, which makes it easy to check "do the pin numbers and the positions match".
   - It prints the absolute path of the artifact; without `--out` the output lands in `/tmp/texteda-preview/<id>/`.
   - A failure has to say which step and which file failed (no such id in the library / does not compile / does not render), not a bare `exit 1`.
   - `--scale` only changes the SVG's `width/height` (not the `viewBox`); it is for zooming in on details, the geometric proportions do not change.
4. **Pin text is aligned with KiCad**, so that "the preview looks right but KiCad draws it differently" cannot happen:
   - The pin name sits at the **inner end of the pin** (the end that touches the symbol body), moved a further `pin_name_offset` along the pin direction (default 0.508mm) — the same meaning as KiCad's `(pin_names (offset …))`. The sentence "offset relative to the pin endpoint" in `spec/symbol.md` is spelled out accordingly.
   - The pin number sits **1.27mm outside the connection point** (KiCad uses 0.05 inch), with the glyph centre sitting on the pin axis.
   - The glyph height follows KiCad's convention (cap height); the **baseline is computed by ourselves** (`anchor + cap height/2`), without relying on `dominant-baseline` (some rasterizers do not support it).
   - **Text is drawn as paths, without depending on system fonts**: SVG's `<text>` relies on system fonts, and on a machine without fonts installed (container, CI, no font server) it opens as "pictures with no text". Instead we draw the glyphs as `<path>` with the bundled Hershey single-stroke font (`packages/core/src/font/`), so every renderer produces the same picture; the glyph height is still the cap height, the anchor is still the visual centre of the glyph, and rotation is done in the model coordinate system following the "visually counter-clockwise" convention. The glyph data comes from the npm package `hersheytext` (MIT, © 2014 James T); the Hershey fonts themselves are public domain.
   - Pin styles (the `inverted` bubble, the `clock` wedge, the `input_low` low-level arc, the `non_logic` zigzag) have to be drawn: the style is part of the symbol's semantics, and not drawing it is lying.
5. **The round-trip is landed through a "semantic projection"** (`extract(render(ir)) == ir` in `AGENTS.md` §10):
   - Each end computes one projection — one end **reverse-extracts from the drawing commands** (`extractSymbol` / `extractFootprint`), the other **computes it directly from the IR** (`symbolProjection` / `footprintProjection`) — and it is the projections that are compared.
   - It covers the **entire reference library** (15 symbols + 16 footprints), not a handful of hand-picked samples; plus a sensitivity assertion that "change one pad and the reverse-extracted result must change", so that this test cannot pass without doing anything.
   - The two known non-reversible spots are written down in code comments: `symbol.units` (unit count) can only be reverse-extracted as "the largest unit number that appeared"; `pin_names_hidden` can only be reverse-extracted from "whether there is name text at all", so the round-trip runs with a **named component**.
6. **Consistency with the KiCad rendering: a one-off manual comparison, the conclusion recorded in this ADR, not in CI**. This comparison (`bq24610rger` symbol, `sot-23-5` footprint):
   - Symbol: pin positions, orientations, the inside/outside of names/numbers, property field positions are **item-for-item identical with KiCad**; the only difference is the colouring (we use the engineering-drawing style: black outline, brown pins, grey text; KiCad uses the PCB colouring).
   - Footprint: pad positions and sizes, courtyard, F.Fab, silkscreen, property text positions are **identical with KiCad**.
   - Conclusion: **the geometry and the text layout follow KiCad**; our renderer does not set up a competing set of conventions.
7. **Where KiCad stays does not change** ([ADR-0021](../06-manufacturing/0021-the-manufacturing-output-path.md), [ADR-0032](../08-libraries/0032-the-reference-project-is-self-built.md) decision 4): the manufacturing output and DRC belong to it; the cross-check in `lib:verify` that "our exports can be read and rendered by KiCad" is **kept** — it verifies that "downstream can consume our artifacts", and depending on KiCad here is deliberate. **The preview and the renderer itself do not depend on KiCad**: the authoring loop is pure TS/Bun, so whether or not KiCad is installed you can look at the pictures and review the libraries.
8. **Share the "read libraries + compile" half** (`scripts/lib/project.ts`): the preview command and the two smoke scripts both use it to find files, compile `.teda` and read component facts. The smoke scripts keep the assertion "KiCad can read our exports"; the preview command only produces pictures and makes no assertions.

## Consequences

- **Benefit**: once an agent has built a symbol/footprint it can look at it right away — "does it look right" no longer needs KiCad; the renderer is a pure function, the same IR reproduces byte for byte and can go into the regression suite; pin text is aligned with KiCad, so the preview does not lie.
- **Cost**: one more package to maintain; the rendering conventions (text position, layer colouring) are new things that KiCad does not know, so we have to keep them consistent ourselves; beyond symbols/footprints (sch, PCB, 3D, copper) nothing is drawn yet.
- **The part that costs nothing**: the exporter, the IR contract and the `.teda` syntax are untouched. The semantics of `pin_name_offset` were only **spelled out** (they were KiCad's semantics all along), no behaviour changed.
- **Verified in practice**: `bun test packages/renderer` is all green on 17 items (including the whole-library round-trip, determinism and font typesetting); `bun run preview component bq24610rger` produces the two pictures (25 pins, 25 pads); `bun run preview footprint nonexistent` reports "footprint not in library project:nonexistent" and exits non-zero; `bun run smoke:symbol` / `smoke:footprint` are still all green (KiCad can read our exports, DRC 0 violations).
- **Addendum (same day)**: the text originally used SVG `<text>` with system fonts, so opening it in a container gave "pictures with no text". It has been changed to the bundled Hershey stroke font, with text drawn as paths (see decision 4); the SVG no longer contains `<text>` and no longer declares `font-family`; the price is about 10 KB of glyph data in the repository, and the glyphs only cover ASCII (Chinese and other non-ASCII characters cannot be drawn).
