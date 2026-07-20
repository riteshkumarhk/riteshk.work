#!/usr/bin/env python3
"""Generate the extension toolbar icons (16/48/128) with the standard library only.
Draws an indigo rounded square with a white lightning bolt (4x supersampled)."""
import os
import struct
import zlib

BG = (99, 102, 241)      # indigo
BOLT = (255, 255, 255)   # white
RADIUS = 0.22            # rounded-corner radius (fraction of the square)
SS = 4                  # supersampling factor per axis

# Lightning bolt polygon in a 0..1 unit square (y grows downward).
BOLT_POLY = [
    (0.56, 0.06), (0.26, 0.54), (0.47, 0.54),
    (0.40, 0.94), (0.76, 0.40), (0.53, 0.40),
]


def inside_round_rect(px, py, r):
    cx = min(max(px, r), 1 - r)
    cy = min(max(py, r), 1 - r)
    dx, dy = px - cx, py - cy
    return dx * dx + dy * dy <= r * r + 1e-9


def inside_poly(px, py, poly):
    inside = False
    n = len(poly)
    j = n - 1
    for i in range(n):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if ((yi > py) != (yj > py)) and (px < (xj - xi) * (py - yi) / (yj - yi + 1e-12) + xi):
            inside = not inside
        j = i
    return inside


def sample(px, py):
    """Return (r,g,b,a) for a unit-square point (supersampled by the caller)."""
    if inside_poly(px, py, BOLT_POLY):
        return BOLT + (255,)
    if inside_round_rect(px, py, RADIUS):
        return BG + (255,)
    return (0, 0, 0, 0)


def render(size):
    pixels = bytearray()
    for y in range(size):
        pixels.append(0)  # PNG filter byte (none) per row
        for x in range(size):
            r = g = b = a = 0
            for sy in range(SS):
                for sx in range(SS):
                    px = (x + (sx + 0.5) / SS) / size
                    py = (y + (sy + 0.5) / SS) / size
                    cr, cg, cb, ca = sample(px, py)
                    r += cr * ca
                    g += cg * ca
                    b += cb * ca
                    a += ca
            n = SS * SS
            alpha = a // n
            if a > 0:
                pixels += bytes((r // a, g // a, b // a, alpha))
            else:
                pixels += bytes((0, 0, 0, 0))
    return pixels


def chunk(typ, data):
    return (
        struct.pack(">I", len(data))
        + typ
        + data
        + struct.pack(">I", zlib.crc32(typ + data) & 0xFFFFFFFF)
    )


def write_png(path, size):
    raw = render(size)
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)  # 8-bit RGBA
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", ihdr))
        f.write(chunk(b"IDAT", zlib.compress(bytes(raw), 9)))
        f.write(chunk(b"IEND", b""))


if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    for s in (16, 48, 128):
        write_png(os.path.join(here, "icon%d.png" % s), s)
        print("wrote icon%d.png" % s)
