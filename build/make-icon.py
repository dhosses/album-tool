#!/usr/bin/env python3
"""Generate build/icon.png — a 1024x1024 lime-green app icon with a vinyl disc."""
import zlib, struct, math, os

def make_png(filename, width, height, pixels):
    """pixels: flat list of (r,g,b) tuples, row-major."""
    def chunk(name, data):
        crc = zlib.crc32(name + data) & 0xffffffff
        return struct.pack('>I', len(data)) + name + data + struct.pack('>I', crc)

    raw = b''
    for y in range(height):
        raw += b'\x00'
        for x in range(width):
            r, g, b = pixels[y * width + x]
            raw += bytes([r, g, b])

    compressed = zlib.compress(raw, 6)
    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0))
    png += chunk(b'IDAT', compressed)
    png += chunk(b'IEND', b'')
    with open(filename, 'wb') as f:
        f.write(png)
    print(f'Written {filename} ({os.path.getsize(filename)//1024}KB)')

SIZE = 1024
cx, cy = SIZE // 2, SIZE // 2

# Brand colors
BG = (200, 245, 0)       # #c8f500 lime green
DARK = (10, 10, 10)      # #0a0a0a near-black
ACCENT = (200, 245, 0)   # lime center hole

outer_r = int(SIZE * 0.38)
inner_r = int(SIZE * 0.10)
hole_r  = int(SIZE * 0.04)

pixels = []
for y in range(SIZE):
    for x in range(SIZE):
        dx, dy = x - cx, y - cy
        dist2 = dx*dx + dy*dy
        if dist2 <= hole_r * hole_r:
            pixels.append(BG)
        elif dist2 <= inner_r * inner_r:
            pixels.append(DARK)
        elif dist2 <= outer_r * outer_r:
            # Subtle grooves on the disc
            angle = math.atan2(dy, dx)
            groove = int((math.sqrt(dist2) * 6) % 20)
            if groove < 3:
                pixels.append((20, 20, 20))
            else:
                pixels.append(DARK)
        else:
            pixels.append(BG)

out = os.path.join(os.path.dirname(__file__), 'icon.png')
make_png(out, SIZE, SIZE, pixels)
