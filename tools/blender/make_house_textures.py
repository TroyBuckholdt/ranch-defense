"""Textures for the house model, painted to match the walk-through video.

Plain Python (Pillow + numpy), no Blender needed:
    python3 tools/blender/make_house_textures.py
Writes tools/blender/tex/*.png. make_house.py uses them (and the Poly Haven sets in
client/public/assets/tex) and the glTF export embeds them.

Each one is drawn from close-ups in the video rather than cut out of it: the footage is
1024 pixels wide and smeared by motion, so redrawn patterns come out sharper.
"""
import math, os, random
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'tex')
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(7)
random.seed(7)


def noise(w, h, scale, octaves=4, seed=0):
    """Smooth value noise in 0..1 (tileable)."""
    r = np.random.default_rng(seed)
    out = np.zeros((h, w))
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        gw, gh = max(2, int(w / scale * 2 ** o)), max(2, int(h / scale * 2 ** o))
        g = r.random((gh, gw))
        g = np.concatenate([g, g[:1]], 0); g = np.concatenate([g, g[:, :1]], 1)  # wrap
        img = Image.fromarray((g * 255).astype(np.uint8)).resize((w + w // gw, h + h // gh), Image.BICUBIC)
        a = np.asarray(img, dtype=float)[:h, :w] / 255
        out += a * amp; tot += amp; amp *= 0.5
    return out / tot


def save(name, arr):
    arr = np.clip(arr, 0, 255).astype(np.uint8)
    Image.fromarray(arr).save(os.path.join(OUT, name))
    print('wrote', name, arr.shape)


def rgb(c):
    return np.array(c, dtype=float)


# ---- honey-coloured polished floor tiles: 4 x 4 tiles of 50 cm, 2 m per repeat
def floor_tiles(name='floor_tile.png', N=1024, base=(222, 166, 98), grout=(196, 150, 96), tiles=4, spread=4.5, seed=1):
    r = np.random.default_rng(seed)
    img = np.zeros((N, N, 3))
    t = N // tiles
    mott = noise(N, N, 90, 5, seed) - 0.5
    fine = noise(N, N, 12, 3, seed + 1) - 0.5
    for i in range(tiles):
        for j in range(tiles):
            c = rgb(base) + r.normal(0, spread, 3) * np.array([1, 0.9, 0.7]) + r.normal(0, spread * 0.8)
            img[i * t:(i + 1) * t, j * t:(j + 1) * t] = c
    img += (mott * 26)[..., None] * np.array([1, 0.85, 0.6]) + (fine * 8)[..., None]
    g = max(2, N // 512)
    for k in range(tiles + 1):
        p = k * t
        for a, b in ((p - g, p + g),):
            img[max(0, a):min(N, b), :] = img[max(0, a):min(N, b), :] * 0.25 + rgb(grout) * 0.75
            img[:, max(0, a):min(N, b)] = img[:, max(0, a):min(N, b)] * 0.25 + rgb(grout) * 0.75
    save(name, img)


# ---- the patterned cement-tile border band that frames every room (and runs down the hall)
# One square tile per 256 px; the band image is 4 tiles long. Cream ground, blue-grey edge
# stripes, a navy-and-white X through each tile with a bow-tie knot in the middle and ochre
# diamonds in the side triangles, like the close-ups by the bar room's glass doors.
def border_band():
    S = 4 * 256
    T = 256
    img = Image.new('RGB', (S, T), (226, 214, 184))
    d = ImageDraw.Draw(img)
    navy, white, grey, ochre, cream = (52, 58, 78), (238, 234, 222), (138, 148, 166), (214, 168, 74), (226, 214, 184)
    for k in range(4):
        x0 = k * T
        # ochre diamonds in the four triangles
        for (cx, cy) in ((x0 + T / 2, T * 0.2), (x0 + T / 2, T * 0.8), (x0 + T * 0.2, T / 2), (x0 + T * 0.8, T / 2)):
            r = T * 0.11
            d.polygon([(cx, cy - r), (cx + r, cy), (cx, cy + r), (cx - r, cy)], fill=ochre)
        # the X: white with navy edges
        for (a, b) in (((x0 + 18, 18), (x0 + T - 18, T - 18)), ((x0 + T - 18, 18), (x0 + 18, T - 18))):
            d.line([a, b], fill=navy, width=26)
            d.line([a, b], fill=white, width=12)
        # bow-tie knot at the crossing
        cx, cy, r = x0 + T / 2, T / 2, T * 0.17
        d.polygon([(cx - r, cy - r * 0.75), (cx, cy), (cx - r, cy + r * 0.75)], fill=navy)
        d.polygon([(cx + r, cy - r * 0.75), (cx, cy), (cx + r, cy + r * 0.75)], fill=navy)
        d.polygon([(cx - r * 0.75, cy - r), (cx, cy), (cx + r * 0.75, cy - r)], fill=navy)
        d.polygon([(cx - r * 0.75, cy + r), (cx, cy), (cx + r * 0.75, cy + r)], fill=navy)
        d.ellipse([cx - 9, cy - 9, cx + 9, cy + 9], fill=ochre)
        # little navy arrow-heads where the X meets the tile edges
        for (ex, ey, sx, sy) in ((x0 + 6, 6, 1, 1), (x0 + T - 6, 6, -1, 1), (x0 + 6, T - 6, 1, -1), (x0 + T - 6, T - 6, -1, -1)):
            d.polygon([(ex, ey), (ex + sx * 34, ey), (ex, ey + sy * 34)], fill=navy)
    # blue-grey edge stripes and the thin dark lines inside them
    for y0, y1 in ((0, 14), (T - 14, T)):
        d.rectangle([0, y0, S, y1], fill=grey)
    d.line([(0, 15), (S, 15)], fill=navy, width=3)
    d.line([(0, T - 16), (S, T - 16)], fill=navy, width=3)
    a = np.asarray(img, dtype=float)
    a += ((noise(S, T, 40, 4, 3) - 0.5) * 18)[..., None]  # worn cement
    a = a * 0.92 + np.asarray(img.filter(ImageFilter.GaussianBlur(1.2)), dtype=float) * 0.08
    save('border.png', a)


# ---- cement-tile "rugs" set into the floor (kitchen: blue and yellow medallions; the big room:
# grey, white and slate geometric). One 20 cm tile per 256 px, 4 x 4 tiles per image.
def cement_rug(name, ground, ink, accent, kind, seed):
    T, n = 256, 4
    S = T * n
    img = Image.new('RGB', (S, S), ground)
    d = ImageDraw.Draw(img)
    for i in range(n):
        for j in range(n):
            x0, y0 = j * T, i * T
            cx, cy = x0 + T / 2, y0 + T / 2
            if kind == 'medallion':
                # quarter circles at the corners make blue ovals across tiles, yellow star in the middle
                for (qx, qy) in ((x0, y0), (x0 + T, y0), (x0, y0 + T), (x0 + T, y0 + T)):
                    d.ellipse([qx - T * 0.32, qy - T * 0.32, qx + T * 0.32, qy + T * 0.32], fill=ink)
                    d.ellipse([qx - T * 0.2, qy - T * 0.2, qx + T * 0.2, qy + T * 0.2], fill=ground)
                    d.ellipse([qx - T * 0.12, qy - T * 0.12, qx + T * 0.12, qy + T * 0.12], fill=accent)
                for a in range(8):
                    ang = a * math.pi / 4
                    d.polygon([(cx, cy), (cx + math.cos(ang - 0.18) * T * 0.3, cy + math.sin(ang - 0.18) * T * 0.3), (cx + math.cos(ang) * T * 0.38, cy + math.sin(ang) * T * 0.38), (cx + math.cos(ang + 0.18) * T * 0.3, cy + math.sin(ang + 0.18) * T * 0.3)], fill=accent)
                d.ellipse([cx - T * 0.1, cy - T * 0.1, cx + T * 0.1, cy + T * 0.1], fill=ink)
            else:
                # slate square-in-diamond with white curls, grey ground
                r = T * 0.42
                d.polygon([(cx, cy - r), (cx + r, cy), (cx, cy + r), (cx - r, cy)], fill=ink)
                r2 = T * 0.3
                d.polygon([(cx, cy - r2), (cx + r2, cy), (cx, cy + r2), (cx - r2, cy)], fill=accent)
                d.rectangle([cx - T * 0.1, cy - T * 0.1, cx + T * 0.1, cy + T * 0.1], fill=ink)
                for (qx, qy) in ((x0, y0), (x0 + T, y0), (x0, y0 + T), (x0 + T, y0 + T)):
                    d.ellipse([qx - T * 0.14, qy - T * 0.14, qx + T * 0.14, qy + T * 0.14], fill=accent)
                    d.ellipse([qx - T * 0.07, qy - T * 0.07, qx + T * 0.07, qy + T * 0.07], fill=ink)
            d.rectangle([x0, y0, x0 + T - 1, y0 + T - 1], outline=tuple(int(v * 0.85) for v in ground), width=2)
    a = np.asarray(img, dtype=float)
    a += ((noise(S, S, 60, 4, seed) - 0.5) * 20)[..., None]
    a = a * 0.85 + np.asarray(img.filter(ImageFilter.GaussianBlur(1.5)), dtype=float) * 0.15
    save(name, a)


# ---- the cream stone floor in the kitchen: 60 cm slabs, 2 x 2 per 1.2 m repeat
def cream_stone():
    N = 1024
    a = np.zeros((N, N, 3)) + rgb((226, 218, 196))
    a += ((noise(N, N, 140, 5, 11) - 0.5) * 22)[..., None] * np.array([1, 1, 0.9])
    a += ((noise(N, N, 10, 2, 12) - 0.5) * 10)[..., None]
    for p in (0, N // 2):
        a[max(0, p - 2):p + 2, :] = rgb((190, 180, 160)); a[:, max(0, p - 2):p + 2] = rgb((190, 180, 160))
    a[-2:, :] = rgb((190, 180, 160)); a[:, -2:] = rgb((190, 180, 160))
    save('stone_cream.png', a)


# ---- veined stone: the bar's black-and-white marble, the travertine columns, the granite
def veined(name, N, ground, vein, vein2, freq, sharp, seed, speck=0.0, speck_col=(0, 0, 0)):
    n1 = noise(N, N, N / freq, 5, seed)
    n2 = noise(N, N, N / (freq * 2.2), 4, seed + 1)
    yy, xx = np.mgrid[0:N, 0:N] / N
    w = np.sin((xx * 1.0 + yy * 0.6) * freq * 2.2 + n1 * 9.0)       # wavy bands
    v = np.exp(-np.abs(w) * sharp)                                  # thin bright veins
    v2 = np.exp(-np.abs(np.sin((xx * 0.3 - yy) * freq * 3.1 + n2 * 11)) * sharp * 1.6)
    a = rgb(ground) * (0.85 + 0.3 * n2[..., None])
    a = a * (1 - v[..., None]) + rgb(vein) * v[..., None]
    a = a * (1 - 0.6 * v2[..., None]) + rgb(vein2) * 0.6 * v2[..., None]
    if speck:
        s = rng.random((N, N)) < speck
        a[s] = rgb(speck_col) * (0.7 + 0.6 * rng.random((s.sum(), 1)))
    save(name, a)


def granite():
    N = 1024
    a = np.zeros((N, N, 3)) + rgb((128, 104, 84))
    a += ((noise(N, N, 70, 4, 21) - 0.5) * 50)[..., None] * np.array([1, 0.85, 0.7])
    for col, p, sz in (((40, 30, 28), 0.10, 3), ((196, 168, 120), 0.06, 3), ((90, 60, 50), 0.10, 2), ((220, 200, 170), 0.02, 2)):
        m = rng.random((-(-N // sz), -(-N // sz))) < p
        m = np.kron(m, np.ones((sz, sz), dtype=bool))[:N, :N]
        a[m] = a[m] * 0.2 + rgb(col) * 0.8
    img = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8))
    save('granite.png', np.asarray(img, dtype=float))


# ---- red brick with pale mortar (the hood and the counter arches): bricks 22 x 6.5 cm,
# one repeat 0.88 x 0.88 m
def brick():
    N = 1024
    img = Image.new('RGB', (N, N), (198, 176, 150))
    d = ImageDraw.Draw(img)
    bw, bh, m = N / 4, N / (0.88 / 0.075), 5
    rows = int(round(N / bh))
    bh = N / rows
    r = np.random.default_rng(31)
    for i in range(rows):
        off = (bw / 2) * (i % 2)
        for j in range(-1, 5):
            x0 = j * bw + off
            c = np.array((170, 90, 60)) + r.normal(0, 4, 3) * np.array([1, 0.8, 0.6]) + r.normal(0, 9)
            if r.random() < 0.1: c *= 0.86
            d.rectangle([x0 + m / 2, i * bh + m / 2, x0 + bw - m / 2, (i + 1) * bh - m / 2], fill=tuple(int(v) for v in c))
    a = np.asarray(img, dtype=float)
    a += ((noise(N, N, 16, 3, 33) - 0.5) * 26)[..., None]
    save('brick.png', a)


# ---- the hood's band of blue-and-white triangle tiles (Talavera style)
def hood_trim():
    W, H = 1024, 128
    img = Image.new('RGB', (W, H), (236, 232, 220))
    d = ImageDraw.Draw(img)
    n = 16
    for k in range(n):
        x0 = k * W / n
        d.polygon([(x0, H - 6), (x0 + W / n, H - 6), (x0 + W / n / 2, 18)], fill=(36, 60, 132))
        d.polygon([(x0 + W / n * 0.3, H - 18), (x0 + W / n * 0.7, H - 18), (x0 + W / n / 2, 50)], fill=(236, 232, 220))
    d.rectangle([0, 0, W, 8], fill=(36, 60, 132)); d.rectangle([0, H - 6, W, H], fill=(36, 60, 132))
    a = np.asarray(img, dtype=float) + ((noise(W, H, 20, 3, 41) - 0.5) * 10)[..., None]
    save('hood_trim.png', a)


# ---- woven placemats on the dining table (bright Mexican stripes)
def placemat():
    W, H = 512, 256
    img = Image.new('RGB', (W, H), (214, 40, 92))
    d = ImageDraw.Draw(img)
    cols = [(214, 40, 92), (247, 168, 30), (40, 150, 170), (120, 60, 160), (232, 92, 40), (60, 170, 90), (247, 220, 60)]
    y = 0
    k = 0
    while y < H:
        h = random.choice([6, 8, 12, 18, 24])
        d.rectangle([0, y, W, y + h], fill=cols[k % len(cols)])
        y += h; k += random.choice([1, 2, 3])
    a = np.asarray(img, dtype=float)
    a += ((rng.random((H, W)) - 0.5) * 30)[..., None]
    save('placemat.png', a)


# ---- the office's red-and-blue oriental rug
def oriental():
    W, H = 768, 512
    img = Image.new('RGB', (W, H), (150, 40, 40))
    d = ImageDraw.Draw(img)
    for i, c in enumerate([(30, 40, 80), (220, 200, 160), (150, 40, 40), (30, 40, 80)]):
        m = 14 + i * 18
        d.rectangle([m, m, W - m, H - m], outline=c, width=12)
    cx, cy = W / 2, H / 2
    for r, c in ((150, (30, 40, 80)), (110, (220, 200, 160)), (80, (150, 40, 40)), (40, (30, 40, 80))):
        d.polygon([(cx - r * 1.5, cy), (cx, cy - r), (cx + r * 1.5, cy), (cx, cy + r)], fill=c)
    for (x, y) in ((140, 130), (W - 140, 130), (140, H - 130), (W - 140, H - 130)):
        d.ellipse([x - 30, y - 30, x + 30, y + 30], fill=(220, 200, 160)); d.ellipse([x - 14, y - 14, x + 14, y + 14], fill=(30, 40, 80))
    a = np.asarray(img, dtype=float) + ((rng.random((H, W)) - 0.5) * 26)[..., None]
    save('oriental.png', a)


floor_tiles()
border_band()
cement_rug('rug_kitchen.png', (232, 222, 190), (54, 88, 156), (226, 178, 70), 'medallion', 51)
cement_rug('rug_grey.png', (196, 198, 196), (70, 78, 92), (238, 236, 228), 'diamond', 52)
cream_stone()
veined('marble_black.png', 1024, (20, 20, 22), (230, 226, 214), (170, 150, 110), 5.0, 6.0, 61)
veined('travertine.png', 1024, (222, 214, 196), (176, 168, 152), (200, 190, 170), 1.5, 5.0, 62, speck=0.002, speck_col=(150, 140, 120))
veined('stone_slab.png', 1024, (150, 120, 90), (210, 186, 140), (90, 70, 60), 2.0, 4.0, 63, speck=0.01, speck_col=(60, 40, 30))
granite()
brick()
hood_trim()
placemat()
oriental()
