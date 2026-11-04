# Skill: Preview and Tune a Symbol's Geometry

> **Audience**: agents and engineers editing a drawn shape in `assets/symbols/**` or
> `assets/footprints/**`.
> **Scope**: looking at the rendered SVG, and changing drawn geometry so the render is right.
> **Not in scope**: authoring a library entry from a datasheet — that is
> [`library-authoring.md`](library-authoring.md).
> **Status**: the commands and expected outputs below were run on
> `examples/reference-project` on 2026-11-04.

This file is English on purpose: a skill is an operating manual for an agent, not a design
document (see `AGENTS.md` §12).

Index: [`docs/skills/README.md`](README.md) lists the procedures and when to read which.

## 0. What this skill is for

The symbol parses, the gates pass, and the **drawing is wrong**: a pin is on the wrong side, a
body does not meet the pin tails, an arrow tip reads as a blob, a rotated name reads upside down.
Contract checks cannot see any of that. This skill says how to look at the real SVG, how to change
the geometry so the render is right, and how to prove it did not break anything else.

The normative rules are not repeated here: [`spec/symbol.md`](../../spec/symbol.md) is the format,
[`spec/footprint.md`](../../spec/footprint.md) the land pattern, and
[ADR-0057](../adr/08-libraries/0057-symbol-pins-sit-on-a-half-millimetre-lattice.md) /
[ADR-0058](../adr/08-libraries/0058-pin-rows-on-a-number-bearing-symbol-are-at-least-two-and-a-half-millimetres-apart.md)
the lattice and the pin pitch.

## 1. Render it

```sh
# A symbol (--class is the device-category directory)
bun run preview symbol <symbol-id> --class <device-category> --project examples/reference-project

# A footprint (--class is the package-family directory)
bun run preview footprint <footprint-id> --class <package-family> --project examples/reference-project

# Both views for one component
bun run preview component <component-id> --project examples/reference-project
```

The command prints the absolute SVG path; the default output is under
`/tmp/texteda-preview/<id>/`. Use `--out <directory>` when the artifact must be kept.

`--scale N` enlarges the SVG **canvas** only — the viewBox stays the same size in millimetres. It
changes how big the picture is, not the geometry. A whole symbol reads at `--scale 14`; detail
wants `40`–`60`; at `--scale 1` the picture is a few dozen pixels wide.

`preview` does not need KiCad. It uses the bundled stroke font, so unsupported non-ASCII text is
reported rather than silently disappearing.

**Inspect the SVG, not the exit status.** A reversed pin, a missing polarity mark and an
undersized courtyard all pass every contract check.

## 2. The SVG's y axis is flipped

The model's `+y` is up; the SVG's is down. A source feature at `y = +2.0` appears at SVG
`y = -2.0`. Every coordinate you read from the SVG has to be flipped before you compare it with
the `.teda` source.

## 3. Crop to zoom

A large `--scale` is not enough for a 1 mm feature — it enlarges the canvas, so the detail is the
same number of millimetres. Crop the SVG's `viewBox` to the region of interest instead.

```sh
bun run preview symbol led --class indicators --project examples/reference-project --scale 14
# → /tmp/texteda-preview/led/led.symbol.svg

bun -e '
const s = await Bun.file("/tmp/texteda-preview/led/led.symbol.svg").text();
const crop = s.replace(/width="[^"]*" height="[^"]*" viewBox="[^"]*"/,
  `width="240mm" height="160mm" viewBox="-6 -6.135 12 11.27"`);
await Bun.write("/tmp/texteda-preview/led/zoom.svg", crop);'
```

The output path is `/tmp/texteda-preview/<id>/<id>.<kind>.svg` — the id appears **twice**, once as
the directory and once in the file name.

The `viewBox` is `x y width height` in millimetres, in the **flipped** SVG frame. Read the
rendered `viewBox` first and crop **inside** it: the numbers above are the LED symbol's own
bounds, and they change whenever the symbol's geometry does. A crop window of a few millimetres
around the feature you are checking is the useful size.

## 4. Sharp tips vs round caps — the trap that reads as a bug

The renderer emits `stroke-linecap="round" stroke-linejoin="round"` on every layer group
(`packages/renderer/src/svg.ts`). So a stroke whose **endpoint** sits on a sharp polygon vertex
blunts that vertex: the cap is a disc of radius `width / 2` centred on the endpoint, and it bulges
past the point.

That is why an arrow tip comes out as a round blob — the stroke ran all the way to the apex and
the cap covers it.

The reference LED symbol shows it. Its light rays are

```text
line  -1,2,0,3                  width=0.25
line  0,2,1,3                   width=0.25
poly  -0.5,3,0,2,0.5,3          fill=outline
```

Each ray **ends on the triangle's edge**, and the cap of radius `width / 2` bulges past it: the
rendered arrowhead has two round blobs sitting on its points, where it should have two sharp
ones. Crop the arrowhead to see it:

```sh
bun run preview symbol led --class indicators --project examples/reference-project --scale 14
bun -e '
const s = await Bun.file("/tmp/texteda-preview/led/led.symbol.svg").text();
await Bun.write("/tmp/texteda-preview/led/arrowhead.svg",
  s.replace(/width="[^"]*" height="[^"]*" viewBox="[^"]*"/, `width="800" height="400" viewBox="-2 -3.5 4 2"`));'
```

**Fix it in the geometry, not in the renderer.** End the stroke *inside* a filled shape so the cap
is hidden and the shape's own vertex stays sharp. For the LED, the ray's end moves off the
triangle's edge to a point inside it:

```text
- line  -1,2,0,3          width=0.25
+ line  -1,2,0.25,2.75    width=0.25
```

Two details make this work, and both are visible in the render:

- the cap must be **inside** the fill, so the endpoint has to be deeper than `width / 2` from the
  boundary — a hair's breadth inside still shows a bump;
- the stroke must not **cross** the shape's far edge. A ray that enters the triangle and leaves
  on the other side trades a blunt tip for a notch in the triangle's edge. Check the far side in
  the crop, not just the tip.

The same applies to a stroke tail: it still shows a round cap unless it overlaps a solid region.
Either extend the tail into a solid area, or draw the whole shape as one filled polygon.

`poly` with `fill=outline` is filled with the outline colour; `width=0` means no stroke.

Changing the renderer's linecap is a language-and-renderer policy change and needs an ADR
([`spec/symbol.md`](../../spec/symbol.md)) — never do it to fix one asset.

## 5. What the symbol file owns, and what it does not

The symbol source owns the **pin connection point, direction, length, style, body geometry, and
visibility**. It does **not** own the pin number's or pin name's position or rotation — the
renderer computes those from the pin axis and the body's painted bounds. `.teda` has no
per-pin text-position or text-rotation field.

So: do not add a source field for a label position, and do not move the body or the pins to chase
one. That is the same rule as
[`library-authoring.md`](library-authoring.md) §4.2, and it is a **renderer** decision, not an
asset decision.

## 6. Moving a shape

The `body` rows are plain coordinate lists, so translating one shape means adding the same
`(dx, dy)` to every coordinate of that shape. A small script that rewrites the numbers is the
practical way; render candidates before choosing an offset, because too far and the shape collides
with a neighbouring bar or with the body outline.

**Read the direction of an offset from the request.** "Move X closer to Y" means the offset vector
points **from X toward Y**, in the symbol's own frame, on both axes. For the LED symbol the
diode triangle is left-and-down of the light rays, so the inward offset is negative x **and**
negative y; a positive-x offset moves the element *away*, and that is the opposite of what was
asked.

## 7. Edit in a copy, then swap in

Never edit the real asset while exploring.

1. Copy the file to a scratch path: `cp led.teda /tmp/led-<variant>.teda`.
2. Edit the copy.
3. Render it to a **separate** `--out` directory, so the two renders do not overwrite each other.
4. Compare the zoom crops (§3).
5. Copy the chosen variant into the real file, then canonicalise and gate (§8).

To A/B two variants, swap each into the real path, render to its own `--out` directory, and
restore.

Classified symbol directories are real: `assets/symbols/<device-category>/<symbol-id>.teda`.
List them with:

```sh
find examples/reference-project/assets/symbols -name '*.teda'
```

## 8. Canonicalise and gate

`fmt:teda` rewrites the **entire file** — body lines sorted by kind and geometry, columns aligned
— so `git diff` may show pre-existing reformatting that is not yours. Judge your change against
the file you edited, not against `HEAD`.

```sh
bun run fmt:teda examples/reference-project
bun run fmt:teda --check examples/reference-project
bun run lib:verify examples/reference-project
bun run check examples/reference-project
bun run test
```

`texteda check` on the reference project reports pre-existing procurement warnings
(`value.procurement-generic-unsourced`). They are unrelated noise, not a regression — read the
count and compare it with the previous run rather than treating the number as a failure.

**Do not edit `examples/cases/**` expected IR for a symbol change.** Each case carries its own
symbol assets under `examples/cases/<case>/assets/symbols/**`, so a change in one project's
symbols does not reach a case's golden files. Change a case's own symbol and that case's
expectations do move.

## 9. Traps

- Source is English only: `.ts` comments and strings, `schemas/ir/**` descriptions,
  `examples/**` `.teda` content.
- Never commit a stray scaffold. The repository root keeps only entry files, build configuration
  and directories (`AGENTS.md` §9).
- `dist/ir/` shards are derived and gitignored. Changing symbol geometry changes the project
  hash, but no committed golden IR includes the reference project's symbols.
- A pin's connection point **and its inner end** are multiples of `0.5 mm`, and `length` follows
  ([ADR-0057](../adr/08-libraries/0057-symbol-pins-sit-on-a-half-millimetre-lattice.md) D1). The
  anchor is the pin on **both** axes — a row need not be symmetric about the origin. A visible
  `rect` body's edge is where the pin tails end, so it sits on the same lattice; decorative
  artwork keeps its shape.
- Do not reach for a renderer change to fix one symbol. The renderer serves every symbol and
  footprint; a stroke-style rule belongs in [`spec/symbol.md`](../../spec/symbol.md) plus an ADR,
  not in a hotfix.

## 10. Definition of done

- The rendered SVG shows the intended shape: pin sides, order, lengths, styles, body bounds,
  fields; no blunt tip, no floating blob, no upside-down name.
- `fmt:teda --check`, `lib:verify`, `check` and `test` pass.
- The change is a source edit in the asset, not a renderer tweak.
- No scratch files, variant copies or generated artifacts are left in the repository.

## 11. References

- [`spec/symbol.md`](../../spec/symbol.md) §5 (the `body` segment), §7 (validation),
  §8 (canonical form).
- [`spec/footprint.md`](../../spec/footprint.md) for the land pattern.
- [ADR-0057](../adr/08-libraries/0057-symbol-pins-sit-on-a-half-millimetre-lattice.md) D1: the
  `0.5 mm` pin lattice.
- [ADR-0058](../adr/08-libraries/0058-pin-rows-on-a-number-bearing-symbol-are-at-least-two-and-a-half-millimetres-apart.md):
  the `2.5 mm` pin-pitch floor on numbered symbols.
- [`library-authoring.md`](library-authoring.md): authoring a library entry from a datasheet.
- [`docs/skills/README.md`](README.md): the index of the procedures.
