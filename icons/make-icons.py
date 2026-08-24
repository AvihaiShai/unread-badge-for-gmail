#!/usr/bin/env python3
"""
Generate the toolbar icon set.

Design brief
------------
The mark must not resemble Gmail's own icon and must not use Google's brand
colours. Google's brand guidance asks third parties not to imitate its product
icons, visual identity or distinctive colours, and a disclaimer elsewhere does
not cure an imitative icon.

So: no envelope, no red. The mark is a stack of list rows with an unread dot
in the corner — a generic "items waiting, one of them new" metaphor that reads
at 16px and belongs to no one. Palette is deep violet and white, which does
not appear in Google's four-colour system.

Geometry
--------
Every dimension is computed per size and rounded to whole pixels, then drawn at
4x and downsampled, so edges land on the pixel grid instead of on fractional
coordinates. Drawing each size independently (rather than scaling one master)
keeps small sizes legible: strokes stay at least 2px and the row count drops
from three to two below 32px.
"""

from PIL import Image, ImageDraw

TILE = (61, 42, 122)        # #3D2A7A  deep violet
INK = (255, 255, 255)       # rows and dot
SIZES = (16, 32, 48, 128)
SS = 4                      # supersampling factor

def geometry(size):
    """All values in final-image pixels, integral."""
    pad = max(2, round(size * 0.19))
    row_h = max(2, round(size * 0.10))
    gap = max(1, round(size * 0.075))
    rows = 3 if size >= 32 else 2
    dot_r = max(2, round(size * 0.115))
    return {
        "radius": max(2, round(size * 0.22)),
        "pad": pad,
        "row_h": row_h,
        "gap": gap,
        "rows": rows,
        "dot_r": dot_r,
        "ring": max(1, round(size * 0.05)),
        # Fraction of the available width each row occupies, top to bottom.
        # The short first row is what keeps the dot clear of the stack.
        "row_fractions": (0.60, 1.0, 0.72) if rows == 3 else (0.60, 1.0),
    }

def draw(size):
    g = geometry(size)
    s = size * SS
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=g["radius"] * SS, fill=TILE)

    block = g["rows"] * g["row_h"] + (g["rows"] - 1) * g["gap"]
    top = round((size - block) / 2)
    left = g["pad"]
    right = size - g["pad"]

    for i in range(g["rows"]):
        y = top + i * (g["row_h"] + g["gap"])
        end = left + max(g["row_h"], round((right - left) * g["row_fractions"][i]))
        d.rounded_rectangle(
            [left * SS, y * SS, end * SS - 1, (y + g["row_h"]) * SS - 1],
            radius=(g["row_h"] * SS) // 2,
            fill=INK,
        )

    # Unread dot, top right, separated from the rows by a tile-coloured ring.
    cx = size - g["pad"] - g["dot_r"] + round(size * 0.04)
    cy = g["pad"] + g["dot_r"] - round(size * 0.04)
    outer = g["dot_r"] + g["ring"]
    d.ellipse(
        [(cx - outer) * SS, (cy - outer) * SS, (cx + outer) * SS - 1, (cy + outer) * SS - 1],
        fill=TILE,
    )
    d.ellipse(
        [(cx - g["dot_r"]) * SS, (cy - g["dot_r"]) * SS,
         (cx + g["dot_r"]) * SS - 1, (cy + g["dot_r"]) * SS - 1],
        fill=INK,
    )

    return img.resize((size, size), Image.LANCZOS)

def main():
    for size in SIZES:
        path = f"icon-{size}.png"
        draw(size).save(path, optimize=True)
        print(f"wrote {path}")

if __name__ == "__main__":
    main()
