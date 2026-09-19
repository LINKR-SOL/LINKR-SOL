#!/usr/bin/env python3
"""
Build the hero parallax from real photographs.

  python3 scripts/build-mountain-photos.py <peak.jpg> <ridge.jpg>

Outputs public/mountains/photo-{sky,peak,mid,near}.{png,webp} plus _preview.jpg.

  sky   — the peak photo's own sky, graded to the LINKR canvas, with the
          mountain region inpainted by extending each column's sky downward so
          the peak layer can drift over it without revealing a ghost of itself
  peak  — the peak cut from its sky, alpha-feathered along the ridgeline
  mid   — the ridge photo's silhouetted range, hazed toward the sky colour
  near  — the same range, larger and darker, as the foreground plane

Keying is column-wise: for each column, walk down from the top of the sky and
stop at the first sustained run of non-sky pixels. Mountains are solid below
their ridgeline, so this produces a clean silhouette without segmentation
models, and it survives the alpenglow (orange rock vs magenta sky) that a
plain hue key would confuse.

Both source photos are CC BY-SA 4.0 from Wikimedia Commons; see
public/mountains/ATTRIBUTION.md.
"""

from __future__ import annotations

import os
import sys
import numpy as np
from PIL import Image, ImageFilter

W, H = 2560, 1440
OUT = os.path.join(os.path.dirname(__file__), "..", "public", "mountains")

PLUM_TOP = np.array([0x16, 0x12, 0x1A], np.float32) / 255
PLUM_MID = np.array([0x3A, 0x22, 0x3C], np.float32) / 255
EMBER = np.array([0xF2, 0x5A, 0x38], np.float32) / 255
FOG = np.array([0x33, 0x25, 0x37], np.float32) / 255


# --------------------------------------------------------------------------- utils
def load(path: str) -> np.ndarray:
    return np.asarray(Image.open(path).convert("RGB"), np.float32) / 255


def rgb_to_hsv(img: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    r, g, b = img[..., 0], img[..., 1], img[..., 2]
    mx, mn = img.max(-1), img.min(-1)
    d = mx - mn + 1e-6
    h = np.zeros_like(mx)
    m = mx == r
    h[m] = ((g - b)[m] / d[m]) % 6
    m = mx == g
    h[m] = (b - r)[m] / d[m] + 2
    m = mx == b
    h[m] = (r - g)[m] / d[m] + 4
    h = (h * 60) % 360
    s = np.where(mx > 0, (mx - mn) / (mx + 1e-6), 0)
    return h, s, mx


def median1d(a: np.ndarray, k: int) -> np.ndarray:
    pad = k // 2
    ap = np.pad(a, pad, mode="edge")
    win = np.lib.stride_tricks.sliding_window_view(ap, k)
    return np.median(win, axis=-1)


def ridge_from_mask(land: np.ndarray, min_run: int = 14) -> np.ndarray:
    """Per column: first row where `min_run` consecutive land pixels begin."""
    Hh, Ww = land.shape
    ridge = np.full(Ww, Hh - 1, np.int32)
    # cumulative run length of land, per column
    run = np.zeros_like(land, np.int32)
    run[0] = land[0]
    for y in range(1, Hh):
        run[y] = (run[y - 1] + 1) * land[y]
    hit = run >= min_run
    has = hit.any(0)
    first = np.argmax(hit, axis=0) - (min_run - 1)
    ridge[has] = np.clip(first[has], 0, Hh - 1)
    return median1d(ridge.astype(np.float32), 9)


def rolling_min(a: np.ndarray, k: int) -> np.ndarray:
    pad = k // 2
    ap = np.pad(a, pad, mode="edge")
    return np.lib.stride_tricks.sliding_window_view(ap, k).min(axis=-1)


def rolling_max(a: np.ndarray, k: int) -> np.ndarray:
    pad = k // 2
    ap = np.pad(a, pad, mode="edge")
    return np.lib.stride_tricks.sliding_window_view(ap, k).max(axis=-1)


def close_dips(ridge: np.ndarray, k: int) -> np.ndarray:
    """Morphological closing (in screen-y): fills dips narrower than k without
    widening peaks — a bare rolling minimum grows every peak by k/2 a side."""
    return rolling_max(rolling_min(ridge, k), k)


def box_mean(a: np.ndarray, k: int) -> np.ndarray:
    """k×k box mean in float — separable running sums with edge padding."""
    pad = k // 2
    ap = np.pad(a.astype(np.float64), pad, mode="edge")
    c = np.cumsum(ap, axis=0)
    v = (c[k - 1 :] - np.vstack([np.zeros((1, c.shape[1])), c[: -k]])) / k
    c = np.cumsum(v, axis=1)
    h = (c[:, k - 1 :] - np.hstack([np.zeros((c.shape[0], 1)), c[:, : -k]])) / k
    return h.astype(np.float32)


def local_std(lum: np.ndarray, k: int = 9) -> np.ndarray:
    """Standard deviation of luminance in a k×k window.

    Computed in float. An earlier version box-filtered 8-bit images, and in the
    dark upper sky the squared luminance rounded to zero, producing phantom
    texture of up to 0.06 that keyed clean sky as rock."""
    m = box_mean(lum, k)
    m2 = box_mean(lum * lum, k)
    return np.sqrt(np.clip(m2 - m * m, 0, 1))


def alpha_below(ridge: np.ndarray, Hh: int, feather: float = 2.0) -> np.ndarray:
    yy = np.arange(Hh, dtype=np.float32)[:, None]
    return np.clip((yy - ridge[None, :]) / feather + 0.5, 0, 1)


def to_rgba(rgb: np.ndarray, a: np.ndarray) -> Image.Image:
    out = np.concatenate([np.clip(rgb, 0, 1), np.clip(a, 0, 1)[..., None]], -1)
    return Image.fromarray((out * 255 + 0.5).astype(np.uint8), "RGBA")


def cover(img: Image.Image, w: int, h: int, focus_y: float = 0.5, scale: float = 1.0) -> Image.Image:
    """Scale to cover w×h (times `scale`), anchoring the crop at focus_y."""
    s = max(w / img.width, h / img.height) * scale
    im = img.resize((round(img.width * s), round(img.height * s)), Image.LANCZOS)
    x0 = (im.width - w) // 2
    y0 = int(np.clip((im.height - h) * focus_y, 0, im.height - h))
    return im.crop((x0, y0, x0 + w, y0 + h))


def save(im: Image.Image, name: str) -> None:
    im.save(os.path.join(OUT, f"{name}.png"), optimize=True)
    im.save(os.path.join(OUT, f"{name}.webp"), quality=84, method=6)
    print(name, im.size)


# --------------------------------------------------------------------------- peak
ANCHORS: dict[str, dict[str, float]] = {}


def crest(ridge: np.ndarray, x0: float, x1: float, dy: int = 0, avoid: int | None = None, gap: int = 600) -> dict[str, float]:
    """Highest ridge point within [x0,x1] of the width, at least `gap` px from
    `avoid` — fractions of the layer, so the UI can pin overlays to it."""
    lo, hi = int(x0 * W), int(x1 * W)
    xs = np.arange(lo, hi)
    if avoid is not None:
        xs = xs[np.abs(xs - avoid) > gap]
    x = int(xs[np.argmin(ridge[xs])])
    return {"x": round(x / W, 4), "y": round((float(ridge[x]) + dy) / H, 4)}


def build_peak(path: str) -> tuple[Image.Image, Image.Image]:
    src = Image.open(path).convert("RGB")
    # Frame: the apex should sit high and right of centre, with the mass of the
    # mountain filling the lower right so the ink wash on the left has rock behind it.
    framed = cover(src, W, H, focus_y=0.18, scale=1.08)
    img = np.asarray(framed, np.float32) / 255
    h, s, v = rgb_to_hsv(img)

    # Three cues, any of which makes a pixel land: real texture (the sky has
    # only JPEG grain, well under the threshold), warm hue (lit rock, alpenglow
    # snow — never sky here), or darkness. Shadowed snow is bluish and can be
    # smooth, so a few columns still dip; those dips are far narrower than any
    # true saddle and a closing fills them.
    lum = img.mean(-1)
    std = local_std(lum, 9)
    # Lit rock and alpenglow snow sit at 10-40°; pink horizon haze sits at
    # 350-360° and must not count, or the far-left sky keys as land.
    warm = (h < 60) & (s > 0.14)
    # v < 0.16, not 0.30: the upper sky in this frame is deep violet and sits
    # around 0.25, so a looser darkness cue starts land runs inside the sky.
    land = (std > 0.032) | warm | (v < 0.16)
    ridge = ridge_from_mask(land, min_run=16)
    # Opening removes upward spikes narrower than 41px (sky false positives);
    # closing then fills downward dips narrower than 31px (shadowed snow).
    ridge = rolling_min(rolling_max(ridge, 41), 41)
    ridge = close_dips(ridge, 31)
    ridge = median1d(ridge, 7)

    # Summit and second peak, as fractions of the layer, for the markers.
    ax = int(np.argmin(ridge))
    ANCHORS["apex"] = {"x": round(ax / W, 4), "y": round(float(ridge[ax]) / H, 4)}
    ANCHORS["second"] = crest(ridge, 0.08, 0.95, avoid=ax, gap=560)

    a = alpha_below(ridge, H, feather=2.2)
    # Soft refinement in a band around the ridge so snow edges are not sawtooth.
    band = np.abs(np.arange(H)[:, None] - ridge[None, :]) < 7
    a = np.where(band, a * 0.6 + land.astype(np.float32) * 0.4, a)
    a = np.asarray(Image.fromarray((a * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8)), np.float32) / 255

    # Grade the peak toward the canvas: keep alpenglow, cool the shadows to plum.
    lum = img.mean(-1, keepdims=True)
    shadow = np.clip(1 - lum / 0.45, 0, 1)
    graded = img * (1 - shadow * 0.35) + PLUM_MID[None, None, :] * shadow * 0.35
    graded = graded * 0.94
    peak = to_rgba(graded, a)

    # Sky: graded, with the mountain inpainted by column-extension of the sky.
    sky_rgb = img.copy()
    yy = np.arange(H)[:, None]
    ridge_i = np.clip(ridge.astype(int) - 3, 1, H - 1)
    for x in range(W):
        ry = ridge_i[x]
        col = sky_rgb[:ry, x]
        if ry < 8:
            col = sky_rgb[:8, x]
            ry = 8
        # extend: blend the last sky rows downward with a slow fade toward fog
        tail = col[-6:].mean(0)
        below = np.arange(H - ry, dtype=np.float32)[:, None] / max(1, H - ry)
        sky_rgb[ry:, x] = tail[None, :] * (1 - below * 0.55) + FOG[None, :] * (below * 0.55)
    # The sky plane is scaled differently from the peak plane on the page, so
    # the inpainted columns can show beside the peak. A heavy blur turns the
    # column extension into featureless sky; nothing in this image is sharper
    # than a gradient, so the blur costs no detail.
    sky_arr = np.asarray(
        Image.fromarray((np.clip(sky_rgb, 0, 1) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(34)), np.float32
    ) / 255
    # LINKR grade: plum at the top, the photo's own glow kept near the horizon.
    t = np.clip(yy / (H * 0.55), 0, 1).astype(np.float32)[..., None]
    sky_arr = sky_arr * (0.42 + 0.58 * t) + PLUM_TOP[None, None, :] * (1 - t) * 0.58
    # Ember bloom low and right, behind the peak.
    xx = np.linspace(0, 1, W, dtype=np.float32)[None, :]
    d = np.sqrt(((xx - 0.66) * 1.5) ** 2 + ((yy / H - 0.34) * 1.0) ** 2)
    bloom = np.exp(-(d / 0.30) ** 2) * 0.26
    sky_arr = sky_arr + bloom[..., None] * (EMBER[None, None, :] - sky_arr)
    sky_im = Image.fromarray((np.clip(sky_arr, 0, 1) * 255 + 0.5).astype(np.uint8), "RGB")
    return sky_im, peak


# --------------------------------------------------------------------------- ridges
def shift_down(layer: Image.Image, dy: int) -> Image.Image:
    """Translate an RGBA layer down by dy px, leaving transparent above."""
    out = Image.new("RGBA", layer.size, (0, 0, 0, 0))
    out.paste(layer, (0, dy))
    return out


def silhouette_ridge(src: Image.Image, scale: float, focus_y: float) -> np.ndarray:
    framed = cover(src, W, H, focus_y=focus_y, scale=scale)
    img = np.asarray(framed, np.float32) / 255
    _, _, v = rgb_to_hsv(img)
    land = v < 0.30  # a backlit range against a sunrise: land is simply dark
    return median1d(ridge_from_mask(land, min_run=20), 15)


def build_ridges(ridge_path: str, texture_path: str) -> tuple[Image.Image, Image.Image]:
    ridge_src = Image.open(ridge_path).convert("RGB")
    tex_src = Image.open(texture_path).convert("RGB")
    yy = np.arange(H, dtype=np.float32)[:, None]

    # --- mid: the silhouetted range, hazed as middle distance -------------------
    framed = cover(ridge_src, W, H, focus_y=0.62, scale=1.02)
    img = np.asarray(framed, np.float32) / 255
    ridge = silhouette_ridge(ridge_src, 1.02, 0.62)
    a = alpha_below(ridge, H, feather=2.0)
    col = img * 0.45 + PLUM_TOP[None, None, :] * 0.55 * 0.7
    col = col * 0.66 + FOG[None, None, :] * 0.34
    fogv = np.clip((yy - ridge[None, :]) / (H * 0.8), 0, 1)[..., None] ** 1.2
    col = col * (1 - fogv * 0.5) + FOG[None, None, :] * fogv * 0.5
    mid = shift_down(to_rgba(col, a), int(H * 0.05))
    ANCHORS["mid"] = crest(ridge, 0.46, 0.64, dy=int(H * 0.05))

    # --- near: real rock texture cut to a real ridge -----------------------------
    # The backlit source has no surface detail, so the foreground borrows its
    # texture from the peak photo's lower faces (scaled up, as a near object
    # would be) and its outline from the silhouetted range. A warm rim along the
    # crest reads as the last light catching the edge.
    tex = np.asarray(cover(tex_src, W, H, focus_y=0.88, scale=1.55), np.float32) / 255
    ridge = silhouette_ridge(ridge_src, 1.34, 0.92)
    a = alpha_below(ridge, H, feather=1.6)
    lum = tex.mean(-1, keepdims=True)
    # Keep contrast, drop brightness: foreground is in shadow but not crushed.
    col = tex * 0.58
    col = col + (lum * 0.08)  # lift the highlights slightly so detail survives
    col = col * 0.82 + PLUM_TOP[None, None, :] * 0.18
    d = yy - ridge[None, :]
    rim = np.clip(1 - d / 16.0, 0, 1) ** 2 * (d >= 0)
    col = col + rim[..., None] * np.array([0.62, 0.30, 0.18], np.float32)[None, None, :] * 0.55
    near = shift_down(to_rgba(col, a), int(H * 0.19))
    ANCHORS["near"] = crest(ridge, 0.70, 0.93, dy=int(H * 0.19))
    return mid, near


def main() -> None:
    if len(sys.argv) < 3:
        sys.exit("usage: build-mountain-photos.py <peak.jpg> <ridge.jpg>")
    os.makedirs(OUT, exist_ok=True)
    sky, peak = build_peak(sys.argv[1])
    mid, near = build_ridges(sys.argv[2], sys.argv[1])
    save(sky, "photo-sky")
    save(peak, "photo-peak")
    save(mid, "photo-mid")
    save(near, "photo-near")
    import json
    meta = {"width": W, "height": H, "apex": ANCHORS["apex"], "anchors": ANCHORS}
    with open(os.path.join(os.path.dirname(__file__), "..", "components", "causa", "mountain-meta.json"), "w") as f:
        json.dump(meta, f)
    print("meta", meta)
    comp = sky.convert("RGBA")
    for layer in (peak, mid, near):
        comp.alpha_composite(layer)
    # Debug outputs (composite preview + peak matte) stay out of /public.
    dbg = os.environ.get("MOUNTAIN_DEBUG_DIR")
    if dbg:
        os.makedirs(dbg, exist_ok=True)
        comp.convert("RGB").save(os.path.join(dbg, "photo-preview.jpg"), quality=82)
        peak.split()[3].save(os.path.join(dbg, "peak-matte.png"))
        print("preview + matte ->", dbg)


if __name__ == "__main__":
    main()
