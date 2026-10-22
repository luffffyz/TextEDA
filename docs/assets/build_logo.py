#!/usr/bin/env python3
"""
TextEDA logo generator.

Everything ships as outlined vector paths — no font dependency at render time,
so the logo looks identical in a browser, Figma, Illustrator or a PDF.

Concept: the "T" of Text is drawn as a PCB trace. One trunk (the single source
of truth) splits into two routed branches ending in two pads — the two sibling
descriptions (sch / pcb) derived from the same text.

Files produced: lockups (plain / with descriptor, light + dark), square icon,
brand sheet, and a 1280x640 social preview.
"""
import os
import re
import numpy as np
from matplotlib.path import Path as MPath
from matplotlib.textpath import TextPath, TextToPath
from matplotlib.font_manager import FontProperties
from fontTools.ttLib import TTFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "svg")
os.makedirs(OUT, exist_ok=True)
os.makedirs(os.path.join(HERE, "png"), exist_ok=True)

# Wordmark face.
#   liberation - Arial metrics. Lowercase "e"/"t" overshoot the baseline by <1 unit.
#   freefont   - Helvetica clone, drops 2.3 units -> visibly ragged baseline, avoid.
#   cascadia   - Monospace (OFL-1.1). Says "plain text" out loud; also a clean baseline.
WORD_FONT = "cascadia"

_FONTS = {
    "liberation": ("/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
                   "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"),
    "freefont":   ("/usr/share/fonts/truetype/freefont/FreeSans.ttf",
                   "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf"),
}

# Wordmark spacing per face, measured against the rendered ink gaps.
#   tracking  - extra advance per letter (negative tightens a monospace grid)
#   gap       - optical gap between the "Text" and "EDA" ink edges, in final units
#               (the boundary must be wider than the average internal gap, or the
#                colour change looks cramped instead of deliberate)
_WORDMARK_OPT = {
    "cascadia":   dict(tracking=-0.026, tracking_eda=-0.010, gap=11.0, text_bold=True),
    "liberation": dict(tracking=0.004, tracking_eda=0.004, gap=7.0, text_bold=False),
    "freefont":   dict(tracking=0.004, tracking_eda=0.004, gap=7.0, text_bold=False),
}
CASCADIA_REG = os.path.join(HERE, "_font", "Cascadia-Regular.ttf")
CASCADIA_BOLD = os.path.join(HERE, "_font", "Cascadia-Bold.ttf")
CASCADIA_VTT_URL = ("https://cdn.jsdelivr.net/gh/microsoft/cascadia-code@v2407.24"
                    "/sources/vtt_data/CascadiaCode_VTT.ttf")


def _fix_name_table(font, wght):
    """The variable font has no STAT table, so the instancer cannot update the
    names itself. The outlines are already pinned to the right weight; this only
    fixes the metadata so tools report the right style."""
    bold = wght >= 600
    style = "Bold" if bold else "Regular"
    ps = "CascadiaCode-%s" % style
    name = font["name"]
    for nid, value in ((1, "Cascadia Code"), (2, style), (3, "TextEDA:%s" % ps),
                       (4, "Cascadia Code %s" % style), (6, ps),
                       (16, "Cascadia Code"), (17, style)):
        name.setName(value, nid, 3, 1, 0x409)
        name.setName(value, nid, 1, 0, 0)
    os2 = font["OS/2"]
    os2.usWeightClass = wght
    if bold:
        os2.fsSelection = (os2.fsSelection & ~0x40) | 0x20
        font["head"].macStyle |= 0x01
    else:
        os2.fsSelection = (os2.fsSelection & ~0x20) | 0x40
        font["head"].macStyle &= ~0x01


def ensure_cascadia():
    """Fetch Cascadia Code's variable font and pin Regular/Bold instances.

    Cascadia Code and Cascadia Mono share identical glyph outlines (Mono just drops
    the programming ligatures), so the Code variable font renders as Cascadia Mono.
    """
    if os.path.exists(CASCADIA_REG) and os.path.exists(CASCADIA_BOLD):
        return CASCADIA_REG, CASCADIA_BOLD
    os.makedirs(os.path.dirname(CASCADIA_REG), exist_ok=True)
    import urllib.request
    from fontTools.ttLib import TTFont
    from fontTools.varLib.instancer import instantiateVariableFont
    vtt = os.path.join(os.path.dirname(CASCADIA_REG), "CascadiaCode_VTT.ttf")
    if not os.path.exists(vtt):
        urllib.request.urlretrieve(CASCADIA_VTT_URL, vtt)
    for wght, out in ((400, CASCADIA_REG), (700, CASCADIA_BOLD)):
        f = TTFont(vtt)
        instantiateVariableFont(f, {"wght": wght}, inplace=True, updateFontNames=False)
        _fix_name_table(f, wght)
        f.save(out)
    return CASCADIA_REG, CASCADIA_BOLD


def word_fonts(name=None):
    name = (name or WORD_FONT).lower()
    if name == "cascadia":
        return ensure_cascadia()
    return _FONTS.get(name, _FONTS["liberation"])


FREE_REG, FREE_BOLD = _FONTS['liberation']          # sheet labels
LABEL_REG, LABEL_BOLD = _FONTS['liberation']
CJK_TTC = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
CJK_SC = os.path.join(HERE, "_cjk_sc.otf")

FONT_SIZE = 100.0   # internal em size used for outline extraction
WORD_SIZE = 86.0    # wordmark size in final units
PAD, MARK, GAP = 40, 240, 58

# ------------------------------------------------------------------ palettes
LIGHT = dict(ink="#14213D", frame="#14213D", teal="#00A38E", coral="#FF6B4A",
             chip="#EDF3FF", pale="#B0C2DB", accent="#C6D4E8", muted="#5A6B85", bg=None)
DARK = dict(ink="#F0F5FF", frame="#E4EBF8", teal="#2FD3B7", coral="#FF7A5C",
            chip="#16233A", pale="#4A6699", accent="#3D5A85", muted="#8AA0C2", bg="#0B1626")


# ------------------------------------------------------------- font plumbing
def _path_to_d(path):
    d = []
    for verts, code in path.iter_segments(simplify=False):
        verts = np.asarray(verts, dtype=float).reshape(-1, 2)
        if code == MPath.MOVETO:
            d.append("M%.2f %.2f" % (verts[0][0], -verts[0][1]))
        elif code == MPath.LINETO:
            d.append("L%.2f %.2f" % (verts[0][0], -verts[0][1]))
        elif code == MPath.CURVE3:
            d.append("Q%.2f %.2f %.2f %.2f" % (verts[0][0], -verts[0][1], verts[1][0], -verts[1][1]))
        elif code == MPath.CURVE4:
            d.append("C%.2f %.2f %.2f %.2f %.2f %.2f" % (
                verts[0][0], -verts[0][1], verts[1][0], -verts[1][1], verts[2][0], -verts[2][1]))
        elif code == MPath.CLOSEPOLY:
            d.append("Z")
    return " ".join(d)


# Manual kerning, in font units at FONT_SIZE.
# "Te" and "ex" are pulled IN so all three gaps in "Text" share one rhythm
# (5.7 / 6.4 / 5.5). "ex" keeps a little more room than the straight-sided
# pairs because an x is diagonal: its bbox gap understates the real whitespace.
# The "xt" pair is left alone - the t's crossbar overhang is the font's design.
_PAIR_ADJ = {"Te": -1.5, "ex": -3.1}


def text_paths(text, fontfile, size=FONT_SIZE, tracking=0.0, pairs=None):
    """Per-glyph outline paths + total advance width.

    Glyph origins come from matplotlib's own prefix metrics, so the font's
    kerning pairs (Te, etc.) are applied — measuring each glyph's raw advance
    instead leaves the word looking loose and uneven.
    """
    fp = FontProperties(fname=fontfile)
    fp_metrics = FontProperties(fname=fontfile, size=size)
    ttp = TextToPath()
    prefixes = []
    for i in range(len(text) + 1):
        w, _h, _d = ttp.get_text_width_height_descent(text[:i], fp_metrics, False)
        prefixes.append(w)
    ds, x = [], 0.0
    for i, ch in enumerate(text):
        if i and pairs:   # pair kerning must move the SECOND letter -> add before drawing
            x += pairs.get(text[i - 1:i + 1], 0.0) * size / FONT_SIZE
        if ch.strip():                # matplotlib's TextPath chokes on spaces
            ds.append(_path_to_d(TextPath((x, 0), ch, size=size, prop=fp)))
        x += (prefixes[i + 1] - prefixes[i]) + tracking
    return ds, (x - tracking if text else 0.0)


def parse_d(d):
    toks = re.findall(r"[MLQZC]|-?\d+\.?\d*", d)
    out, i = [], 0
    while i < len(toks):
        c = toks[i]
        if c == "M":
            out.append(("M", [(float(toks[i + 1]), float(toks[i + 2]))])); i += 3
        elif c == "L":
            out.append(("L", [(float(toks[i + 1]), float(toks[i + 2]))])); i += 3
        elif c == "Q":
            out.append(("Q", [(float(toks[i + 1]), float(toks[i + 2])),
                              (float(toks[i + 3]), float(toks[i + 4]))])); i += 5
        elif c == "C":
            out.append(("C", [(float(toks[i + 1]), float(toks[i + 2])),
                              (float(toks[i + 3]), float(toks[i + 4])),
                              (float(toks[i + 5]), float(toks[i + 6]))])); i += 7
        elif c == "Z":
            out.append(("Z", [])); i += 1
        else:
            i += 1
    return out


def bbox_of(d):
    xs, ys = [], []
    for _, pts in parse_d(d):
        for p in pts:
            xs.append(p[0]); ys.append(p[1])
    return min(xs), min(ys), max(xs), max(ys)


def label(text, x, y, size, fill, fontfile=LABEL_REG, tracking_ratio=0.0):
    """Path-based text label (no font dependency). Returns (svg, width)."""
    k = size / FONT_SIZE
    ds, w = text_paths(text, fontfile, tracking=size * tracking_ratio)
    out = ['<g transform="translate(%.2f %.2f) scale(%.4f)">' % (x, y, k)]
    out += ['<path d="%s" fill="%s"/>' % (d, fill) for d in ds]
    out.append("</g>")
    return "\n  ".join(out), w * k


def label_c(text, cx, y, size, fill, fontfile=FREE_REG, tracking_ratio=0.0):
    _, w = label(text, 0, 0, size, fill, fontfile, tracking_ratio)
    return label(text, cx - w / 2.0, y, size, fill, fontfile, tracking_ratio)


# ------------------------------------------------------------------- the mark
def mark_svg(p, ox=0.0, oy=0.0, s=1.0, trunk=15, branch=15):
    """TextEDA mark: a 'T' drawn as a PCB trace inside a chip outline."""
    def g(x, y):
        return (ox + x * s, oy + y * s)

    def path(d):
        out = []
        for code, pts in parse_d(d):
            out.append(code + " ".join("%.2f %.2f" % g(*pt) for pt in pts))
        return " ".join(out)

    def tr(d, w):
        return ('<path d="%s" fill="none" stroke="%s" stroke-width="%.2f" '
                'stroke-linecap="round" stroke-linejoin="round"/>' % (path(d), p["teal"], w * s))

    parts = []
    parts.append('<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" rx="%.2f" '
                 'fill="%s" stroke="%s" stroke-width="%.2f"/>'
                 % (g(26, 26)[0], g(26, 26)[1], 188 * s, 188 * s, 32 * s,
                    p["chip"], p["frame"], 7 * s))
    # T: bar + stem
    parts.append(tr("M72 76 L168 76", trunk))
    parts.append(tr("M120 76 L120 124", trunk))
    # 45-degree routing down to two pads — one source, two siblings
    parts.append(tr("M120 124 L120 144 L100 164 L60 164", branch))
    parts.append(tr("M120 124 L120 144 L140 164 L180 164", branch))
    # board vias
    for cx, cy in ((52, 48), (188, 48)):
        x, y = g(cx, cy)
        parts.append('<circle cx="%.2f" cy="%.2f" r="%.2f" fill="%s"/>' % (x, y, 7.5 * s, p["pale"]))
    # pads
    for cx, cy in ((52, 164), (188, 164)):
        x, y = g(cx, cy)
        parts.append('<circle cx="%.2f" cy="%.2f" r="%.2f" fill="%s"/>' % (x, y, 11 * s, p["coral"]))
        parts.append('<circle cx="%.2f" cy="%.2f" r="%.2f" fill="%s"/>' % (x, y, 4.6 * s, p["chip"]))
    return "\n  ".join(parts)


# ----------------------------------------------------------------- wordmark
def wordmark(x, baseline, p, tracking_ratio=None, gap=None, size=None):
    size = size or WORD_SIZE
    k = size / FONT_SIZE
    reg, bold = word_fonts()
    opt = _WORDMARK_OPT.get((WORD_FONT or "liberation").lower(),
                             _WORDMARK_OPT["liberation"])
    if opt.get("text_bold"):
        reg = bold
    tr = size * (opt["tracking"] if tracking_ratio is None else tracking_ratio)
    gap = (opt["gap"] * size / WORD_SIZE) if gap is None else gap
    ds_text, w_text = text_paths("Text", reg, tracking=tr)
    ds_eda, w_eda = text_paths("EDA", bold, tracking=tr)

    # place EDA by INK edge, so the optical gap between "Text" and "EDA" is exact
    bt = [bbox_of(d) for d in ds_text]
    be = [bbox_of(d) for d in ds_eda]
    text_ink_right = max(b[2] for b in bt) * k
    eda_ink_left = min(b[0] for b in be) * k
    xe = x + text_ink_right + gap - eda_ink_left

    out = ['<g transform="translate(%.2f %.2f) scale(%.4f)">' % (x, baseline, k)]
    out += ['<path d="%s" fill="%s"/>' % (d, p["ink"]) for d in ds_text]
    out.append("</g>")
    out.append('<g transform="translate(%.2f %.2f) scale(%.4f)">' % (xe, baseline, k))
    out += ['<path d="%s" fill="%s"/>' % (d, p["teal"]) for d in ds_eda]
    out.append("</g>")

    x0 = min(b[0] for b in bt) * k + x
    x1 = max(b[2] for b in be) * k + xe
    y0 = min(min(b[1] for b in bt), min(b[1] for b in be)) * k + baseline
    y1 = max(max(b[3] for b in bt), max(b[3] for b in be)) * k + baseline
    return "\n  ".join(out), (x0, y0, x1, y1)


# ------------------------------------------------------------------ builders
def mark_t_svg(p, ox=0.0, oy=0.0, s=1.0, tw=22, ring_r=14, ring_w=8, lx=42, rx=198):
    """Minimal mark: the 'T' as a single trace with a ring on each of its three ends."""
    # the trace must stop where the round cap just touches the ring's inner edge,
    # otherwise the cap pokes into the hole and eats the bottom of the ring
    edge = (ring_r - ring_w / 2.0) + tw / 2.0
    L, R, B = (lx, 56), (rx, 56), (120, 184)

    def g(x, y):
        return (ox + x * s, oy + y * s)

    parts = []
    parts.append('<path d="M%.2f %.2f L%.2f %.2f" fill="none" stroke="%s" stroke-width="%.2f" '
                 'stroke-linecap="round"/>'
                 % (g(L[0] + edge, L[1])[0], g(L[0] + edge, L[1])[1],
                    g(R[0] - edge, R[1])[0], g(R[0] - edge, R[1])[1], p["teal"], tw * s))
    parts.append('<path d="M%.2f %.2f L%.2f %.2f" fill="none" stroke="%s" stroke-width="%.2f" '
                 'stroke-linecap="round"/>'
                 % (g(B[0], L[1])[0], g(B[0], L[1])[1],
                    g(B[0], B[1] - edge)[0], g(B[0], B[1] - edge)[1], p["teal"], tw * s))
    for cx, cy in (L, R, B):
        x, y = g(cx, cy)
        parts.append('<circle cx="%.2f" cy="%.2f" r="%.2f" fill="none" stroke="%s" stroke-width="%.2f"/>'
                     % (x, y, ring_r * s, p["coral"], ring_w * s))
    return "\n  ".join(parts)


T_MARK_INK = (24, 38, 216, 202)   # visible bounds of the T mark inside its 240 box


def mark_t_boxed_svg(p, ox=0.0, oy=0.0, s=1.0, tw=22, ring_r=14, ring_w=8,
                     lx=62, rx=178, by=172, cy=68, vias=True, via_r=7.5,
                     via_pos=((56, 186), (184, 186))):
    """T mark with the board frame back: heavy trace, three rings, chip outline."""
    edge = (ring_r - ring_w / 2.0) + tw / 2.0
    L, R, B = (lx, cy), (rx, cy), (120, by)

    def g(x, y):
        return (ox + x * s, oy + y * s)

    parts = []
    parts.append('<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" rx="%.2f" '
                 'fill="%s" stroke="%s" stroke-width="%.2f"/>'
                 % (g(26, 26)[0], g(26, 26)[1], 188 * s, 188 * s, 32 * s,
                    p["chip"], p["frame"], 7 * s))
    parts.append('<path d="M%.2f %.2f L%.2f %.2f" fill="none" stroke="%s" stroke-width="%.2f" '
                 'stroke-linecap="round"/>'
                 % (g(L[0] + edge, L[1])[0], g(L[0] + edge, L[1])[1],
                    g(R[0] - edge, R[1])[0], g(R[0] - edge, R[1])[1], p["teal"], tw * s))
    parts.append('<path d="M%.2f %.2f L%.2f %.2f" fill="none" stroke="%s" stroke-width="%.2f" '
                 'stroke-linecap="round"/>'
                 % (g(B[0], L[1])[0], g(B[0], L[1])[1],
                    g(B[0], B[1] - edge)[0], g(B[0], B[1] - edge)[1], p["teal"], tw * s))
    for cx, cyy in (L, R, B):
        x, y = g(cx, cyy)
        parts.append('<circle cx="%.2f" cy="%.2f" r="%.2f" fill="none" stroke="%s" stroke-width="%.2f"/>'
                     % (x, y, ring_r * s, p["coral"], ring_w * s))
    if vias:                      # board vias in the bottom corners
        for cx, cyy in via_pos:
            x, y = g(cx, cyy)
            parts.append('<circle cx="%.2f" cy="%.2f" r="%.2f" fill="%s"/>'
                         % (x, y, via_r * s, p["pale"]))
    return "\n  ".join(parts)


def mark_flat_svg(p, ox=0.0, oy=0.0, s=1.0, tw=22, ring_r=14, ring_w=8,
                  lx=54, rx=186, cy=60, by=112, fx=16, fy=16, fw=208, fh=138, frx=30,
                  vias=True, via_r=7.5, via_pos=((46, 124), (194, 124))):
    """Flattened T in a landscape board frame -> body in a 240x170 design space."""
    edge = (ring_r - ring_w / 2.0) + tw / 2.0

    def g(x, y):
        return (ox + x * s, oy + y * s)

    parts = []
    parts.append('<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" rx="%.2f" '
                 'fill="%s" stroke="%s" stroke-width="%.2f"/>'
                 % (g(fx, fy)[0], g(fx, fy)[1], fw * s, fh * s, frx * s,
                    p["chip"], p["frame"], 7 * s))
    parts.append('<path d="M%.2f %.2f L%.2f %.2f" fill="none" stroke="%s" stroke-width="%.2f" '
                 'stroke-linecap="round"/>'
                 % (g(lx + edge, cy)[0], g(lx + edge, cy)[1],
                    g(rx - edge, cy)[0], g(rx - edge, cy)[1], p["teal"], tw * s))
    parts.append('<path d="M%.2f %.2f L%.2f %.2f" fill="none" stroke="%s" stroke-width="%.2f" '
                 'stroke-linecap="round"/>'
                 % (g(120, cy)[0], g(120, cy)[1],
                    g(120, by - edge)[0], g(120, by - edge)[1], p["teal"], tw * s))
    for cx, cyy in ((lx, cy), (rx, cy), (120, by)):
        x, y = g(cx, cyy)
        parts.append('<circle cx="%.2f" cy="%.2f" r="%.2f" fill="none" stroke="%s" stroke-width="%.2f"/>'
                     % (x, y, ring_r * s, p["coral"], ring_w * s))
    if vias:                      # board vias in the bottom corners
        for cx, cyy in via_pos:
            x, y = g(cx, cyy)
            parts.append('<circle cx="%.2f" cy="%.2f" r="%.2f" fill="%s"/>'
                         % (x, y, via_r * s, p["pale"]))
    return "\n  ".join(parts)


def avatar_body(p):
    """Bare flat T in a square canvas — safe for circular crops (GitHub avatar)."""
    edge = (14 - 8 / 2.0) + 22 / 2.0
    parts = []
    for (x1, y1, x2, y2) in ((40 + edge, 94, 200 - edge, 94), (120, 94, 120, 148 - edge)):
        parts.append('<path d="M%.2f %.2f L%.2f %.2f" fill="none" stroke="%s" stroke-width="22" '
                     'stroke-linecap="round"/>' % (x1, y1, x2, y2, p["teal"]))
    for cx, cy in ((40, 94), (200, 94), (120, 148)):
        parts.append('<circle cx="%d" cy="%d" r="14" fill="none" stroke="%s" stroke-width="8"/>'
                     % (cx, cy, p["coral"]))
    return "\n  ".join(parts)


def build_avatar(p, out_path, dark=False):
    return write_svg(out_path, avatar_body(p), 240, 240, "TextEDA avatar", None)


def build_flat_icon(p, out_path, dark=False):
    body = mark_flat_svg(p, 0, 0)
    return write_svg(out_path, body, 240, 170, "TextEDA flat mark", p["bg"] if dark else None)


def flat_lockup_body(p, s=1.0, word_size=108, descriptor=None, desc_font=None,
                     desc_size=25, desc_tracking=0.08):
    """Landscape flat mark + wordmark, in design space -> (body, width, height)."""
    H = 250
    if desc_font is None:          # descriptor follows the wordmark face
        desc_font = word_fonts()[0]
    mw, mh = 240 * s, 170 * s
    wm_x = PAD + mw + GAP
    _, rel = wordmark(wm_x, 0.0, p, size=word_size)
    baseline = H / 2.0 - (rel[3] + rel[1]) / 2.0
    wm, bbox = wordmark(wm_x, baseline, p, size=word_size)
    body = [mark_flat_svg(p, PAD, (H - mh) / 2.0, s), wm]
    acc_y = bbox[3] + 30
    body.append('<path d="M%.2f %.2f L%.2f %.2f" fill="none" stroke="%s" stroke-width="4" '
                'stroke-linecap="round"/>'
                % (bbox[0], acc_y, bbox[2] - 14, acc_y, p["accent"]))
    body.append('<circle cx="%.2f" cy="%.2f" r="6" fill="%s"/>' % (bbox[2] - 8, acc_y, p["coral"]))
    if descriptor:
        d, _ = label(descriptor, bbox[0], acc_y + 48, desc_size, p["muted"], desc_font, desc_tracking)
        body.append(d)
        H = int(acc_y + 48 + desc_size * 0.35 + 30)
    return "\n  ".join(body), int(round(bbox[2] + PAD)), H


def build_flat_lockup(p, out_path, dark=False, **kw):
    body, w, h = flat_lockup_body(p, **kw)
    return write_svg(out_path, body, w, h, "TextEDA logo", p["bg"] if dark else None)


def build_t_boxed_icon(p, out_path, dark=False):
    body = mark_t_boxed_svg(p, 0, 0)
    return write_svg(out_path, body, 240, 240, "TextEDA mark", p["bg"] if dark else None)


def t_boxed_lockup_body(p, s=0.95, word_size=96):
    """Boxed T mark + wordmark, in design space -> (body, width, height)."""
    H = 320
    wm_x = PAD + 240 * s + GAP
    _, rel = wordmark(wm_x, 0.0, p, size=word_size)
    baseline = H / 2.0 - (rel[3] + rel[1]) / 2.0
    wm, bbox = wordmark(wm_x, baseline, p, size=word_size)
    body = [mark_t_boxed_svg(p, PAD, (H - 240 * s) / 2.0, s), wm]
    acc_y = bbox[3] + 32
    body.append('<path d="M%.2f %.2f L%.2f %.2f" fill="none" stroke="%s" stroke-width="4" '
                'stroke-linecap="round"/>'
                % (bbox[0], acc_y, bbox[2] - 14, acc_y, p["accent"]))
    body.append('<circle cx="%.2f" cy="%.2f" r="6" fill="%s"/>' % (bbox[2] - 8, acc_y, p["coral"]))
    return "\n  ".join(body), int(round(bbox[2] + PAD)), H


def build_t_boxed_lockup(p, out_path, dark=False, **kw):
    body, w, h = t_boxed_lockup_body(p, **kw)
    return write_svg(out_path, body, w, h, "TextEDA logo", p["bg"] if dark else None)


def build_t_icon(p, out_path, dark=False):
    body = mark_t_svg(p, 0, 0)
    return write_svg(out_path, body, 240, 240, "TextEDA T mark", p["bg"] if dark else None)


def t_lockup_body(p, s=0.85, word_size=100, accent=True):
    """T mark + wordmark, in design space -> (body, width, height)."""
    H = 320
    ink = T_MARK_INK
    wm_x = PAD + (ink[2] - ink[0]) * s + GAP
    _, rel = wordmark(wm_x, 0.0, p, size=word_size)
    baseline = H / 2.0 - (rel[3] + rel[1]) / 2.0
    wm, bbox = wordmark(wm_x, baseline, p, size=word_size)
    # centre the T mark's ink on the wordmark's optical centre
    my = (bbox[1] + bbox[3]) / 2.0 - (ink[1] + ink[3]) / 2.0 * s
    body = [mark_t_svg(p, PAD - ink[0] * s, my, s), wm]
    acc_y = bbox[3] + 32
    if accent:
        body.append('<path d="M%.2f %.2f L%.2f %.2f" fill="none" stroke="%s" stroke-width="4" '
                    'stroke-linecap="round"/>'
                    % (bbox[0], acc_y, bbox[2] - 14, acc_y, p["accent"]))
        body.append('<circle cx="%.2f" cy="%.2f" r="6" fill="%s"/>' % (bbox[2] - 8, acc_y, p["coral"]))
    return "\n  ".join(body), int(round(bbox[2] + PAD)), H


def build_t_lockup(p, out_path, dark=False, **kw):
    body, w, h = t_lockup_body(p, **kw)
    return write_svg(out_path, body, w, h, "TextEDA logo", p["bg"] if dark else None)


def lockup_body(p, descriptor=None, accent=True, desc_font=FREE_REG, desc_size=25,
                desc_tracking=0.14):
    """Lockup in design space -> (body svg, width, height)."""
    H = 320
    wm_x = PAD + MARK + GAP
    # ink offsets relative to the baseline -> centre the wordmark on the mark
    _, rel = wordmark(wm_x, 0.0, p)
    baseline = H / 2.0 - (rel[3] + rel[1]) / 2.0
    wm, bbox = wordmark(wm_x, baseline, p)

    body = [mark_svg(p, PAD, (H - MARK) / 2.0), wm]
    acc_y = bbox[3] + 32
    if accent:
        body.append('<path d="M%.2f %.2f L%.2f %.2f" fill="none" stroke="%s" stroke-width="4" '
                    'stroke-linecap="round"/>'
                    % (bbox[0], acc_y, bbox[2] - 14, acc_y, p["accent"]))
        body.append('<circle cx="%.2f" cy="%.2f" r="6" fill="%s"/>' % (bbox[2] - 8, acc_y, p["coral"]))

    H_out = H
    if descriptor:
        dy = (acc_y + 48) if accent else (bbox[3] + 42)
        d, _ = label(descriptor, bbox[0], dy, desc_size, p["muted"], desc_font, desc_tracking)
        body.append(d)
        H_out = max(H, int(dy + desc_size * 0.35 + 30))

    W = int(round(bbox[2] + PAD))
    return "\n  ".join(body), W, H_out


def write_svg(path, body, w, h, aria="TextEDA logo", bg=None):
    head = []
    if bg:
        head.append('<rect width="%d" height="%d" fill="%s"/>' % (w, h, bg))
    head.append(body)
    svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" width="%d" height="%d" '
           'role="img" aria-label="%s">\n  ' % (w, h, w, h, aria)
           + "\n  ".join(head) + "\n</svg>\n")
    open(path, "w").write(svg)
    return w, h


def build_lockup(p, out_path, dark=False, **kw):
    body, w, h = lockup_body(p, **kw)
    return write_svg(out_path, body, w, h, "TextEDA logo", p["bg"] if dark else None)


def build_icon(p, out_path, dark=False):
    body = mark_svg(p, 0, 0)
    return write_svg(out_path, body, 240, 240, "TextEDA icon", p["bg"] if dark else None)


def build_social(out_path, w=1280, h=640):
    """GitHub social preview (1280x640)."""
    p = DARK
    parts = ['<rect width="%d" height="%d" fill="%s"/>' % (w, h, p["bg"])]
    for d in ("M0 500 L160 500 L240 420 L440 420",
              "M1280 150 L1130 150 L1050 230 L880 230",
              "M0 150 L80 150 L160 230",
              "M1280 520 L1170 520 L1090 440"):
        parts.append('<path d="%s" fill="none" stroke="#1B2C49" stroke-width="3" '
                     'stroke-linecap="round" stroke-linejoin="round"/>' % d)
    for cx, cy in ((240, 420), (160, 230), (1090, 440), (1050, 230)):
        parts.append('<circle cx="%d" cy="%d" r="5" fill="#1B2C49"/>' % (cx, cy))

    global WORD_FONT
    WORD_FONT = "cascadia"
    body, lw, lh = flat_lockup_body(p, descriptor="Hardware as text")
    s = 1.28
    tx = (w - lw * s) / 2.0
    ty = (h - lh * s) / 2.0 - 18
    parts.append('<g transform="translate(%.1f %.1f) scale(%.3f)">%s</g>' % (tx, ty, s, body))
    u, _ = label_c("github.com/luffffyz/TextEDA", w / 2.0, h - 66, 24, "#5E7396", FREE_REG, 0.04)
    parts.append(u)
    return write_svg(out_path, "\n  ".join(parts), w, h, "TextEDA", None)


def build_brand_sheet(out_path):
    """One-page sheet: all lockups, descriptor variant, reversed, marks, palette."""
    W = 1000
    parts = []
    y = 78

    def head(text, size=30, color="#14213D", font=FREE_BOLD, gap=26):
        nonlocal y
        t, _ = label(text, 60, y, size, color, font)
        parts.append(t)
        y += gap

    def rule():
        nonlocal y
        y += 18
        parts.append('<line x1="60" y1="%d" x2="940" y2="%d" stroke="#E3E9F2" stroke-width="2"/>'
                     % (y, y))
        y += 40

    def caption(text):
        nonlocal y
        t, _ = label(text, 60, y, 16, "#94A3B8")
        parts.append(t)
        y += 34

    def show(body, h, dark=False):
        nonlocal y
        if dark:
            parts.append('<g transform="translate(60 %d)">'
                         '<rect width="880" height="%d" fill="%s"/>%s</g>'
                         % (y, h, DARK["bg"], body))
        else:
            parts.append('<g transform="translate(60 %d)">%s</g>' % (y, body))
        y += h + 30

    head("TextEDA - logo sheet")
    head("split / boxed T / flat T / bare T / reversed / marks at 6 sizes / palette",
         15, "#94A3B8", FREE_REG, 46)

    caption("split mark  -  one source, two sibling outputs")
    b, lw, lh = lockup_body(LIGHT)
    show(b, lh)
    b, lw, lh = lockup_body(LIGHT, descriptor="Hardware as text")
    show(b, lh)
    rule()

    caption("boxed T  -  heavy trace, three rings, board frame")
    bx = mark_t_boxed_svg(LIGHT, 0, 0)
    wm, bbox = wordmark(300, 186, LIGHT, size=96)
    show(bx + wm, 240)
    rule()

    caption("flat T  -  landscape board, flattened")
    fl, flw, flh = flat_lockup_body(LIGHT)
    show(fl, flh)
    rule()

    caption("bare T  -  no frame")
    b, lw, lh = t_lockup_body(LIGHT)
    show(b, lh)
    rule()

    caption("reversed  -  boxed T on dark")
    bx = mark_t_boxed_svg(DARK, 0, 0)
    wm, bbox = wordmark(300, 186, DARK, size=96)
    show(bx + wm, 240, dark=True)
    rule()

    caption("marks at size  -  split / boxed T")
    parts.append('<g transform="translate(60 %d) scale(0.6)">%s</g>' % (y, mark_svg(LIGHT, 0, 0)))
    for i, sz in enumerate((120, 90, 64, 44, 28)):
        parts.append('<g transform="translate(%d %d) scale(%.3f)">%s</g>'
                     % (240 + i * 132, y, sz / 240.0, mark_t_boxed_svg(LIGHT, 0, 0)))
    parts.append('<g transform="translate(%d %d) scale(0.4)">%s</g>'
                 % (900, y + 22, mark_flat_svg(LIGHT, 0, 0)))
    y += 130 + 30

    sw = [("#14213D", "Ink"), ("#00A38E", "Teal"), ("#FF6B4A", "Coral"), ("#EDF3FF", "Chip")]
    for i, (c, nm) in enumerate(sw):
        x = 60 + i * 180
        parts.append('<rect x="%d" y="%d" width="46" height="46" rx="10" fill="%s" stroke="#E3E9F2"/>'
                     % (x, y, c))
        t, _ = label(nm, x, y + 72, 16, "#5A6B85", FREE_BOLD)
        parts.append(t)
        t, _ = label(c, x, y + 92, 13, "#94A3B8")
        parts.append(t)
    y += 120

    parts.insert(0, '<rect width="%d" height="%d" fill="#FFFFFF"/>' % (W, y))
    return write_svg(out_path, "\n  ".join(parts), W, y, "TextEDA logo sheet")


def build_compare_sheet(out_path):
    """Positive vs negative, the final set only."""
    W = 1200
    CARD_W = 1000
    PADX = 24
    cjk = ensure_cjk()
    global WORD_FONT
    WORD_FONT = "cascadia"

    rows = [("扁版标志  FLAT LOCKUP", lambda p: flat_lockup_body(p)),
            ("头像  AVATAR", lambda p: (avatar_body(p), 240, 240))]
    card_h = 230
    H = 190 + len(rows) * (card_h + 60) + 30

    parts = ['<rect width="%d" height="%d" fill="#FFFFFF"/>' % (W, H)]
    t, _ = label("TextEDA  -  positive / negative", 60, 76, 30, "#14213D", FREE_BOLD)
    parts.append(t)
    t, _ = label("同一套几何,两套配色  |  same geometry, two palettes",
                 60, 102, 15, "#94A3B8", cjk)
    parts.append(t)

    col_x = [60, 60 + CARD_W + 40]
    for i, title in enumerate(("正色  POSITIVE", "负色  NEGATIVE")):
        t, _ = label(title, col_x[i], 142, 18, "#14213D", cjk, 0.02)
        parts.append(t)
        t, _ = label("on #FFFFFF" if i == 0 else "on #0B1626", col_x[i], 162, 13, "#94A3B8")
        parts.append(t)

    y = 186
    for name, getter in rows:
        t, _ = label(name, 60, y + 18, 14, "#5A6B85", cjk)
        parts.append(t)
        for i, p in enumerate((LIGHT, DARK)):
            body, bw, bh = getter(p)
            sc = min(1.0, (CARD_W - 2 * PADX) / float(bw))
            bg = "#FFFFFF" if i == 0 else DARK["bg"]
            parts.append('<g transform="translate(%d %d)">'
                         '<rect width="%d" height="%d" fill="%s" stroke="%s" stroke-width="1"/>'
                         '<g transform="translate(%.1f %.1f) scale(%.4f)">%s</g></g>'
                         % (col_x[i], y + 30, CARD_W, card_h, bg,
                            "#E3E9F2" if i == 0 else DARK["bg"],
                            PADX, (card_h - bh * sc) / 2.0, sc, body))
        y += card_h + 60
    return write_svg(out_path, "\n  ".join(parts), W, H, "TextEDA positive / negative")


def build_brand_sheet(out_path):
    """One-page sheet for the final set."""
    W = 1000
    cjk = ensure_cjk()
    global WORD_FONT
    WORD_FONT = "cascadia"
    parts = []
    y = 78

    def head(text, size=30, color="#14213D", font=FREE_BOLD, gap=26):
        nonlocal y
        t, _ = label(text, 60, y, size, color, font)
        parts.append(t)
        y += gap

    def rule():
        nonlocal y
        y += 18
        parts.append('<line x1="60" y1="%d" x2="940" y2="%d" stroke="#E3E9F2" stroke-width="2"/>' % (y, y))
        y += 40

    def caption(text):
        nonlocal y
        t, _ = label(text, 60, y, 15, "#94A3B8", cjk)
        parts.append(t)
        y += 32

    def show(body, h, dark=False):
        nonlocal y
        if dark:
            parts.append('<g transform="translate(60 %d)">'
                         '<rect width="880" height="%d" fill="%s"/>%s</g>' % (y, h, DARK["bg"], body))
        else:
            parts.append('<g transform="translate(60 %d)">%s</g>' % (y, body))
        y += h + 26

    head("TextEDA  -  logo sheet")
    head("扁版标志 + 等宽字标  |  flat board, Cascadia Mono wordmark",
         15, "#94A3B8", cjk, 46)

    caption("主标志  -  扁版 + 等宽字标")
    b, lw, lh = flat_lockup_body(LIGHT)
    show(b, lh)
    b, lw, lh = flat_lockup_body(LIGHT, descriptor="Hardware as text")
    show(b, lh)
    b, lw, lh = flat_lockup_body(LIGHT, descriptor="用文本描述硬件", desc_font=cjk)
    show(b, lh)
    rule()

    caption("负色  -  反转配色")
    b, lw, lh = flat_lockup_body(DARK)
    show(b, lh, dark=True)
    rule()

    caption("头像  -  方形,圆形裁切安全")
    parts.append('<g transform="translate(60 %d) scale(0.62)">%s</g>' % (y + 25, avatar_body(LIGHT)))
    for i, sz in enumerate((130, 96, 68, 46, 30, 20)):
        parts.append('<g transform="translate(%d %d) scale(%.4f)">%s</g>'
                     % (320 + i * 118, y + (150 - sz) / 2.0, sz / 240.0, avatar_body(LIGHT)))
    y += 160 + 26
    rule()

    caption("色板")
    sw = [("#14213D", "Ink"), ("#00A38E", "Teal"), ("#FF6B4A", "Coral"), ("#EDF3FF", "Chip"),
          ("#B0C2DB", "Via")]
    for i, (c, nm) in enumerate(sw):
        x = 60 + i * 150
        parts.append('<rect x="%d" y="%d" width="46" height="46" rx="10" fill="%s" stroke="#E3E9F2"/>'
                     % (x, y, c))
        t, _ = label(nm, x, y + 72, 16, "#5A6B85", FREE_BOLD)
        parts.append(t)
        t, _ = label(c, x, y + 92, 13, "#94A3B8")
        parts.append(t)
    y += 120

    parts.insert(0, '<rect width="%d" height="%d" fill="#FFFFFF"/>' % (W, y))
    return write_svg(out_path, "\n  ".join(parts), W, y, "TextEDA logo sheet")


def ensure_cjk():
    if not os.path.exists(CJK_SC):
        f = TTFont(CJK_TTC, fontNumber=2, lazy=True)
        f.save(CJK_SC)
    return CJK_SC


if __name__ == "__main__":
    o = os.path.join(OUT, "")

    def build_wordmark(font, sfx, tag):
        """flat board + this wordmark face, light + dark."""
        global WORD_FONT
        WORD_FONT = font
        print("--- %s ---" % tag)
        print("  logo          ", build_flat_lockup(LIGHT, o + "texteda-logo%s.svg" % sfx))
        print("  logo dark     ", build_flat_lockup(DARK, o + "texteda-logo-dark%s.svg" % sfx, dark=True))
        if sfx == "":                      # descriptor variants only for the primary face
            print("  logo + desc   ", build_flat_lockup(
                LIGHT, o + "texteda-logo-tagline.svg", descriptor="Hardware as text"))
            print("  logo + cn     ", build_flat_lockup(
                LIGHT, o + "texteda-logo-cn.svg", descriptor="用文本描述硬件", desc_font=ensure_cjk()))

    build_wordmark("cascadia", "", "wordmark: Cascadia Mono")

    print("--- marks ---")
    print("  icon          ", build_avatar(LIGHT, o + "texteda-icon.svg"))
    print("  icon dark     ", build_avatar(DARK, o + "texteda-icon-dark.svg", dark=True))
    print("  social        ", build_social(o + "texteda-social-preview.svg"))
    print("  compare sheet ", build_compare_sheet(o + "texteda-positive-negative.svg"))
    print("  brand sheet   ", build_brand_sheet(o + "texteda-brand-sheet.svg"))
