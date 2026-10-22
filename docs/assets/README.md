# Brand assets

Logos, icons and the script that generates them. The kit's own notes (design rationale,
palette, spacing measurements) are in [`DESIGN.md`](DESIGN.md), in the author's original
Chinese.

## What is here

| Path | What it is |
|---|---|
| `svg/texteda-logo.svg` | **Main lockup**: flat board mark + monospace wordmark, transparent background |
| `svg/texteda-logo-dark.svg` | Same, for dark backgrounds |
| `svg/texteda-logo-tagline.svg` | Main lockup + the tagline `Hardware as text` |
| `svg/texteda-logo-cn.svg` | Main lockup + the Chinese tagline `用文本描述硬件` |
| `svg/texteda-icon.svg` | Square avatar (240×240, safe inside a circular crop) |
| `svg/texteda-icon-dark.svg` | Square avatar for dark backgrounds |
| `svg/texteda-social-preview.svg` | GitHub social preview, 1280×640 |
| `svg/texteda-brand-sheet.svg` | One-page brand sheet |
| `svg/texteda-positive-negative.svg` | Positive / negative colour table |
| `png/` | Raster exports of the above at common sizes, plus `favicon.ico` and `preview.png` |
| `build_logo.py` | Generator: rebuilds every SVG from scratch (needs `matplotlib` + `fontTools`) |
| `_font/OFL.txt` | SIL Open Font License 1.1 for the Cascadia fonts the wordmark is set in |

## Which file for which job

| Situation | Use |
|---|---|
| README header, page banner | `svg/texteda-logo.svg` |
| GitHub social preview / OG image | `svg/texteda-social-preview.svg` (1280×640) |
| **GitHub avatar, repository About** | **`svg/texteda-icon.svg`** (square, circular-crop safe) |
| favicon | `png/favicon.ico` |
| npm icon / editor extension icon | `png/icon-128.png` |
| Inline in prose | `svg/texteda-icon.svg` (mark only) |

The avatar is a separate drawing on purpose: GitHub crops avatars to a circle, so a wide
lockup loses its ends and a boxed mark loses its corners. The icon is the bare flat mark,
centred in a square canvas.

## Regenerating

```bash
cd docs/assets
python3 build_logo.py      # needs matplotlib + fontTools
```

The wordmark is set in **Cascadia Code Bold** (SIL OFL-1.1) — a monospace face, because
"everything is plain text" should be visible in the lettering itself. The generated SVGs
contain outline paths only and do not depend on the font at runtime; the font files are only
needed to rebuild them.

The font binaries are **not vendored** in this repository. `build_logo.py` fetches
Cascadia Code from jsDelivr and pins the Regular/Bold instances itself; `_font/OFL.txt` is
kept so the licence travels with the script. If you regenerate offline, drop
`Cascadia-Regular.ttf` and `Cascadia-Bold.ttf` into `_font/` yourself.

The raster exports in `png/` **are** committed — the GitHub avatar, the favicon and the
social preview are uploaded through the web UI, and having them in the tree means a clone
has them without a rasteriser. The attribution for both fonts (Cascadia Code and the
Noto Sans CJK used for the Chinese tagline) is in the repository's `NOTICE`; `bun run
check:public` fails if that attribution or the OFL text goes missing.

## Using it in the README

```html
<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/svg/texteda-logo-dark.svg">
    <img src="docs/assets/svg/texteda-logo.svg" width="420" alt="TextEDA">
  </picture>
</p>
```

The `<picture>` swap is not decoration: the light logo's ink is `#14213D`, which is nearly
invisible on GitHub's dark theme. The dark variant carries its own `#0B1626` background, so
it reads as a banner rather than a floating mark — that is how it is drawn.

The social preview image is uploaded through **Settings → General → Social preview**; GitHub
does not read it from the repository.
