#!/usr/bin/env python3
"""Render the Rarefaction logo and icon as 8-bit SVG in Rosé Pine Moon.

    python3 tools/render_logo.py   # writes docs/images/logo.svg and docs/images/icon.svg

The mark is the Advanced Test Reactor's four-lobed core seen through pool
water, glowing Cherenkov blue, drawn as a call graph: the symbol at the
centre, callers (foam) above and left, callees (iris) below and right, and a
test (gold) reaching in from the corner. logo.svg adds the lowercase pixel
wordmark; icon.svg is the mark alone for small sizes (Apple's icon guidance:
one centred subject, few shapes, no text).
"""

from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "docs" / "images"

P = dict(base="#232136", surface="#2a273f", overlay="#393552", muted="#6e6a86", subtle="#908caa",
         text="#e0def4", gold="#f6c177", pine="#3e8fb0", foam="#9ccfd8", iris="#c4a7e7", white="#ffffff")

N = 28  # mark grid, in pixels

# Sprites. R ring, H highlight, S shade, D dark flux trap, G glint in the trap.
LOBE = ["..RRRR..",
        ".HHRRRR.",
        "RHDDDDRR",
        "RRDGGDRR",
        "RRDGGDRS",
        "RRDDDDRS",
        ".RRRRSS.",
        "..RSSS.."]
CORE = [".HHTT.",
        "HWHTTT",
        "HHTTTT",
        "TTTTTF",
        "TTTTFF",
        ".TFFF."]
TEST = [".HG.",
        "HGGG",
        "GGGO",
        ".GO."]

C = 14
LOBES = {"n": ((C, 5), "foam"), "w": ((5, C), "foam"), "s": ((C, 23), "iris"), "e": ((23, C), "iris")}
SHADE = {"foam": "pine", "iris": "muted"}
TEST_AT = (21, 1)  # top-left cell of the test sprite

FONT = {
    "r": ["....", "....", "#.##", "##..", "#...", "#...", "#..."],
    "a": [".....", ".....", ".###.", "....#", ".####", "#...#", ".####"],
    "e": [".....", ".....", ".###.", "#...#", "#####", "#....", ".####"],
    "f": ["..##", ".#..", "####", ".#..", ".#..", ".#..", ".#.."],
    "c": [".....", ".....", ".####", "#....", "#....", "#....", ".####"],
    "t": [".#..", ".#..", "####", ".#..", ".#..", ".#..", "..##"],
    "i": [".#.", "...", "##.", ".#.", ".#.", ".#.", "###"],
    "o": [".....", ".....", ".###.", "#...#", "#...#", "#...#", ".###."],
    "n": [".....", ".....", "#.##.", "##..#", "#...#", "#...#", "#...#"],
}


def mark():
    """Return {(x, y): (colour, opacity)} for the 28x28 mark, painted back to front."""
    px = {}

    def put(x, y, c, op=1.0):
        if 0 <= x < N and 0 <= y < N:
            px[(x, y)] = (c, op)

    # Cherenkov glow in the water, stepped like an 8-bit gradient.
    for y in range(N):
        for x in range(N):
            r = ((x + 0.5 - C) ** 2 + (y + 0.5 - C) ** 2) ** 0.5
            if r < 8.5:
                put(x, y, P["pine"], 0.55)
            elif r < 11.5:
                put(x, y, P["pine"], 0.32)
            elif r < 14:
                put(x, y, P["pine"], 0.16)
    for x, y in ((3, 3), (24, 24), (2, 20), (25, 8), (8, 25)):
        put(x, y, P["foam"], 0.7)

    # Edges: the symbol to each lobe, two pixels wide, in the lobe's role colour.
    for (cx, cy), role in LOBES.values():
        if cx == C:
            for y in range(min(cy, C), max(cy, C)):
                put(C - 1, y, P[role])
                put(C, y, P[role])
        else:
            for x in range(min(cx, C), max(cx, C)):
                put(x, C - 1, P[role])
                put(x, C, P[role])
    # The test reaches the top caller and the right callee.
    tx, ty = TEST_AT
    for x in range(C + 4, tx):
        put(x, ty + 2, P["subtle"])
    for y in range(ty + 4, C - 4):
        put(tx + 2, y, P["subtle"])

    def sprite(rows, x0, y0, colours):
        for j, row in enumerate(rows):
            for i, ch in enumerate(row):
                if ch != ".":
                    put(x0 + i, y0 + j, colours[ch])

    for (cx, cy), role in LOBES.values():
        sprite(LOBE, cx - 4, cy - 4, {"R": P[role], "H": P["white"], "S": P[SHADE[role]],
                                     "D": P["base"], "G": P["pine"]})
    sprite(CORE, C - 3, C - 3, {"T": P["text"], "H": P["white"], "W": P["white"], "F": P["foam"]})
    sprite(TEST, tx, ty, {"G": P["gold"], "H": P["white"], "O": P["gold"]})
    return px


def rects(px, cell, ox, oy):
    out = []
    for (x, y), (c, op) in sorted(px.items(), key=lambda kv: (kv[0][1], kv[0][0])):
        o = f' fill-opacity="{op}"' if op < 1 else ""
        out.append(f'<rect x="{ox + x * cell}" y="{oy + y * cell}" width="{cell}" height="{cell}" fill="{c}"{o}/>')
    return "".join(out)


def wordmark(word, px, y):
    cols = sum(len(FONT[ch][0]) for ch in word) + len(word) - 1
    x0 = round((512 - cols * px) / 2)
    out = []
    for dx, colour in ((px // 2, P["pine"]), (0, P["text"])):
        x = 0
        for ch in word:
            glyph = FONT[ch]
            for r, row in enumerate(glyph):
                for c, v in enumerate(row):
                    if v == "#":
                        out.append(f'<rect x="{x0 + (x + c) * px + dx}" y="{y + r * px + dx}" width="{px}" height="{px}" fill="{colour}"/>')
            x += len(glyph[0]) + 1
    return "".join(out)


def svg(title, desc, body):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" '
            f'shape-rendering="crispEdges" role="img" aria-labelledby="t d"><title id="t">{title}</title>'
            f'<desc id="d">{desc}</desc><clipPath id="tile"><rect width="512" height="512" rx="112"/></clipPath>'
            f'<g clip-path="url(#tile)"><rect width="512" height="512" fill="{P["base"]}"/>{body}</g></svg>\n')


DESC = ("A reactor core glowing Cherenkov blue, drawn as a call graph: a bright symbol at the centre linked to "
        "four lobes, callers in blue and callees in violet, with a gold test node in the corner.")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    px = mark()
    (OUT / "icon.svg").write_text(svg("Rarefaction", DESC, rects(px, 14, (512 - N * 14) // 2, (512 - N * 14) // 2)))
    (OUT / "logo.svg").write_text(svg("rarefaction", DESC, rects(px, 12, (512 - N * 12) // 2, 38)
                                      + wordmark("rarefaction", 6, 404)))
    print(f"wrote logo.svg and icon.svg to {OUT}")


if __name__ == "__main__":
    main()
