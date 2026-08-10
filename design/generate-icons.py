#!/usr/bin/env python3
"""Regenerate the favicon / PWA icon set for apps/web from the committed source
artwork at design/icon-source.png.

Usage: python3 design/generate-icons.py
(Run from anywhere — paths are relative to this file, not the working directory.
Needs Pillow: pip install pillow.)

icon-source.png is itself a losslessly-optimized 1024x1024 re-encode of the
original 1254x1254 mandala artwork supplied for issue #162; the 1254px
original was only ever used once, offline, to produce this file, and was
never committed. Every shipped icon is derived from icon-source.png,
downscaled with LANCZOS, then palette-quantized to an adaptive 256-color PNG
(the artwork is mostly flat color fields plus one small radial glow, so 256
colors with Floyd-Steinberg dithering shows no visible banding) — this cuts
shipped and precached bytes well below a plain truecolor PNG. icon-source.png
itself is left untouched by this script: it is the lossless archival copy,
not a build output.
"""
import os
from PIL import Image, ImageStat

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(SCRIPT_DIR, "icon-source.png")
OUT_DIR = os.path.join(SCRIPT_DIR, "..", "apps", "web", "public")

os.makedirs(OUT_DIR, exist_ok=True)

src = Image.open(SRC).convert("RGB")
print("source:", SRC, src.size, src.mode)


def sample_bg_color(img, patch=30):
    """Average corner patches for the artwork's background color, robust to
    single-pixel anti-aliasing/noise at the extreme corner. All four patches are
    the same size, so averaging their per-patch means equals the pixel-weighted
    average across all of them combined."""
    w, h = img.size
    boxes = [
        (0, 0, patch, patch),
        (w - patch, 0, w, patch),
        (0, h - patch, patch, h),
        (w - patch, h - patch, w, h),
    ]
    sums = [0.0, 0.0, 0.0]
    for box in boxes:
        means = ImageStat.Stat(img.crop(box)).mean
        for i in range(3):
            sums[i] += means[i]
    return tuple(round(s / len(boxes)) for s in sums)


bg_color = sample_bg_color(src)
print("sampled bg color:", bg_color)


def lanczos(img, size):
    return img.resize((size, size), Image.LANCZOS)


def save_quantized_png(img, path):
    """8-bit adaptive-palette PNG with dithering — cuts shipped/precached bytes
    substantially versus truecolor for artwork this flat, with no visible
    quality loss (spot-check every generated size by eye after running this)."""
    quantized = img.convert("RGB").quantize(
        colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.FLOYDSTEINBERG
    )
    quantized.save(path, format="PNG", optimize=True)


# --- Standard square icons: direct high-quality downscale + palette quantize.
# The source art already fills its square frame edge-to-edge with the dark
# background, so no safe-zone treatment is needed here (that's maskable-only).
direct_sizes = {
    "favicon-32x32.png": 32,
    "apple-touch-icon.png": 180,
    "pwa-192x192.png": 192,
    "pwa-512x512.png": 512,
}

for name, size in direct_sizes.items():
    out = lanczos(src, size)
    save_quantized_png(out, os.path.join(OUT_DIR, name))
    print("wrote", name, out.size)

# --- favicon.ico: 16/32/48 embedded, each individually LANCZOS-resized. Not
# palette-quantized — ICO has its own internal encoding and is already tiny.
icon_16 = lanczos(src, 16)
icon_32 = lanczos(src, 32)
icon_48 = lanczos(src, 48)
ico_path = os.path.join(OUT_DIR, "favicon.ico")
icon_48.save(
    ico_path,
    format="ICO",
    sizes=[(16, 16), (32, 32), (48, 48)],
    append_images=[icon_16, icon_32],
)
print("wrote favicon.ico (16/32/48)")

# --- Maskable 512x512: zoom the whole source out onto a canvas filled with the
# artwork's own background color (see sample_bg_color), so the mandala lands
# safely inside the ~80% maskable safe zone. 0.70 keeps the actual colorful
# content well inside the safe circle with real margin.
MASKABLE_SIZE = 512
SAFE_FRACTION = 0.70
art_size = round(MASKABLE_SIZE * SAFE_FRACTION)
art = lanczos(src, art_size)
canvas = Image.new("RGB", (MASKABLE_SIZE, MASKABLE_SIZE), bg_color)
offset = ((MASKABLE_SIZE - art_size) // 2, (MASKABLE_SIZE - art_size) // 2)
canvas.paste(art, offset)
save_quantized_png(canvas, os.path.join(OUT_DIR, "maskable-512x512.png"))
print("wrote maskable-512x512.png (art", art_size, "px on", MASKABLE_SIZE, "canvas)")

print()
print("=== output sizes ===")
for f in sorted(os.listdir(OUT_DIR)):
    p = os.path.join(OUT_DIR, f)
    if os.path.isfile(p):
        print(f"{f:28s} {os.path.getsize(p):>10d} bytes")
