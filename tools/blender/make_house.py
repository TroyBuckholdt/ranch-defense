"""The ranch house, built in Blender from the game's own floor plan.

    node scripts/houselayout.js > tools/blender/house_layout.json
    python3 tools/blender/make_house_textures.py
    python3 tools/blender/make_house.py -- OUT_DIR [--preview] [--bake] [--lo]

Writes OUT_DIR/house.glb (everything that never moves) plus, with --bake, OUT_DIR/house_light.png
(a Cycles light map in the second UV set: sky light and bounced sun; the game adds the direct
sun itself). --preview renders stills of each room into OUT_DIR/preview_*.png. --lo makes the
phone version (fewer small things, smaller textures).

Everything is traced from the family's walk-through video (Nov 2026): the honey tile floors
framed by a patterned cement-tile border, white plaster walls, deep red mahogany doors and
louvered shutters, square stone columns under plastered arches, the brick hood in the kitchen,
the black-marble bar, the long dining table, the cane rockers, Troy's office with the saddles.

Coordinates: the game's (x, y up, z south) is Blender (X = x, Y = -z, Z = y), which the glTF
export turns back into the game's frame, so positions here are the game's numbers.

Named nodes the game looks for (each with its origin on its hinge or centre):
  Leaf_<entry>_L / _R   glazed leaves of each French-door 'window' (shut; the game swings them
                        open when the cows tear the last board off)
  Grille_<entry>        the wrought-iron grille outside each of those (torn out with the last board)
  Fan_<n>, Lamp_<n>     empties marking ceiling fans and hanging lights (the game hangs its own)
"""
import bpy, bmesh, sys, os, math, json, random
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = os.path.abspath(argv[0] if argv else os.path.join(ROOT, 'client/public/assets/models/house'))
PREVIEW = '--preview' in argv
BAKE = '--bake' in argv
LO = '--lo' in argv
ONLY = next((a.split('=')[1] for a in argv if a.startswith('--only=')), None)  # preview one view
os.makedirs(OUT, exist_ok=True)
L = json.load(open(os.path.join(HERE, 'house_layout.json')))
H, HB = L['HOUSE'], L['HB']
WH, T, IW = H['wallH'], H['t'], H['iw']
rnd = random.Random(11)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def V(x, y, z):
    """game coords -> Blender"""
    return Vector((x, -z, y))


# ---------------------------------------------------------------- materials
TEX = os.path.join(ROOT, 'client/public/assets/tex')
MTEX = os.path.join(HERE, 'tex')
_images = {}


def image(path, colour=True):
    if path not in _images:
        im = bpy.data.images.load(path)
        if not colour: im.colorspace_settings.name = 'Non-Color'
        _images[path] = im
    return _images[path]


MATS = {}
SCALE = {}   # metres per texture repeat, for the box-projected UVs


def tinted(src, tint, name):
    """a copy of a texture multiplied by a colour (in linear light, like a shader would)"""
    from PIL import Image
    import numpy as np
    dst = os.path.join(MTEX, f'_t_{name}.jpg')
    if not os.path.exists(dst) or os.path.getmtime(dst) < os.path.getmtime(__file__):
        a = np.asarray(Image.open(src).convert('RGB'), dtype=float) / 255
        lin = np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4) * np.array(tint)
        srgb = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.clip(lin, 0, None) ** (1 / 2.4) - 0.055)
        Image.fromarray(np.clip(srgb * 255, 0, 255).astype(np.uint8)).save(dst, quality=92)
    return dst


def mat(name, color=(1, 1, 1), rough=0.6, metal=0.0, tex=None, nor=None, arm=None, scale=1.0, alpha=None, emit=None, tint=None):
    if name in MATS: return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    b.inputs['Base Color'].default_value = (*color, 1)
    if tex:
        if tint: tex = tinted(tex, tint, name)
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = image(tex)
        nt.links.new(t.outputs['Color'], b.inputs['Base Color'])
    if nor and not LO:
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = image(nor, False)
        nm = nt.nodes.new('ShaderNodeNormalMap'); nm.inputs['Strength'].default_value = 0.6
        nt.links.new(t.outputs['Color'], nm.inputs['Color']); nt.links.new(nm.outputs['Normal'], b.inputs['Normal'])
    if arm:
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = image(arm, False)
        sep = nt.nodes.new('ShaderNodeSeparateColor')
        nt.links.new(t.outputs['Color'], sep.inputs['Color'])
        nt.links.new(sep.outputs['Green'], b.inputs['Roughness'])
        nt.links.new(sep.outputs['Blue'], b.inputs['Metallic'])
    if alpha is not None:
        b.inputs['Alpha'].default_value = alpha
        try: m.surface_render_method = 'BLENDED'
        except Exception: pass
        m.blend_method = 'BLEND' if hasattr(m, 'blend_method') else None
    if emit:
        b.inputs['Emission Color'].default_value = (*emit[0], 1)
        b.inputs['Emission Strength'].default_value = emit[1]
    MATS[name] = m
    SCALE[name] = scale
    return m


def ph(name):  # a Poly Haven set in the game's texture folder
    return dict(tex=os.path.join(TEX, f'{name}_diff.jpg'), nor=os.path.join(TEX, f'{name}_nor.jpg'), arm=os.path.join(TEX, f'{name}_arm.jpg'))


def mt(f): return os.path.join(MTEX, f)


mat('Plaster', rough=0.92, scale=2.4, tint=(0.97, 0.94, 0.87), **ph('white_stucco'))
mat('Stucco', rough=0.95, scale=2.4, tint=(0.98, 0.96, 0.92), **ph('white_stucco'))
mat('Ceiling', rough=0.95, scale=3.0, tint=(0.99, 0.98, 0.95), tex=os.path.join(TEX, 'white_stucco_diff.jpg'))
mat('FloorTile', rough=0.18, scale=2.0, tex=mt('floor_tile.png'))
mat('Border', rough=0.25, scale=1.44, tex=mt('border.png'))
mat('RugKitchen', rough=0.35, scale=0.8, tex=mt('rug_kitchen.png'))
mat('RugGrey', rough=0.3, scale=0.8, tex=mt('rug_grey.png'))
mat('StoneCream', rough=0.3, scale=1.2, tex=mt('stone_cream.png'))
mat('Skirting', color=(0.78, 0.5, 0.25), rough=0.25)
mat('Mahogany', rough=0.32, scale=1.5, tint=(0.62, 0.2, 0.14), tex=os.path.join(TEX, 'dark_wood_diff.jpg'))
mat('Cedar', rough=0.4, scale=1.5, tint=(0.95, 0.42, 0.26), tex=os.path.join(TEX, 'dark_wood_diff.jpg'))
mat('DarkWood', rough=0.38, scale=1.5, tint=(0.42, 0.24, 0.17), tex=os.path.join(TEX, 'dark_wood_diff.jpg'))
mat('Travertine', rough=0.45, scale=1.4, tex=mt('travertine.png'))
mat('Terracotta', rough=0.6, scale=1.6, tint=(0.95, 0.8, 0.72), **ph('terracotta_floor_tiles'))
mat('RedPaint', color=(0.5, 0.12, 0.08), rough=0.7)
mat('RoofTile', rough=0.8, scale=2.2, **ph('clay_roof_tiles_02'))
mat('Plinth', color=(0.6, 0.58, 0.54), rough=0.95, scale=2.4, tex=os.path.join(TEX, 'white_stucco_diff.jpg'))
mat('Iron', color=(0.03, 0.03, 0.035), rough=0.45, metal=0.7)
mat('Brass', color=(0.75, 0.55, 0.25), rough=0.3, metal=0.9)
mat('Glass', color=(0.7, 0.82, 0.82), rough=0.04, alpha=0.18)
mat('Frosted', color=(0.92, 0.94, 0.93), rough=0.5, alpha=0.62)
mat('Brick', rough=0.85, scale=0.88, tex=mt('brick.png'))
mat('Granite', rough=0.2, scale=1.2, tex=mt('granite.png'))
mat('StoneSlab', rough=0.3, scale=1.4, tex=mt('stone_slab.png'))
mat('MarbleBlack', rough=0.12, scale=1.6, tex=mt('marble_black.png'))
mat('HoodTrim', rough=0.3, scale=1.0, tex=mt('hood_trim.png'))
mat('Mirror', color=(0.95, 0.95, 0.95), rough=0.03, metal=1.0)
mat('Gilt', color=(0.8, 0.6, 0.28), rough=0.35, metal=0.85)
mat('WhitePlastic', color=(0.92, 0.92, 0.9), rough=0.4)
mat('BlackPlastic', color=(0.03, 0.03, 0.03), rough=0.35)
mat('Steel', color=(0.75, 0.75, 0.76), rough=0.25, metal=1.0)
mat('Skylight', color=(1, 1, 1), rough=0.5, emit=((1.0, 0.98, 0.95), 4.0))


# ---------------------------------------------------------------- mesh building
# All static geometry goes into one bmesh per material and becomes one object per material
# at the end, so the game draws the whole house in a few dozen calls.
class Bucket:
    def __init__(self, name):
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new('UVMap')
        self.name = name


BUCKETS = {}
# Big surfaces (walls, floors, ceilings, built-ins) get the baked light map; small things
# (bottles, bars, slats, round turned pieces) go in a second mesh lit the ordinary way, so
# the light map's pixels are spent where they show.
MODE = ['lit']


class detail:
    def __enter__(self): MODE.append('detail')
    def __exit__(self, *a): MODE.pop()


class lit:
    def __enter__(self): MODE.append('lit')
    def __exit__(self, *a): MODE.pop()


def bucket(m, kind=None):
    name = m if isinstance(m, str) else m.name
    key = (kind or MODE[-1], name)
    if key not in BUCKETS: BUCKETS[key] = Bucket(name)
    return BUCKETS[key]


def box_uv(face, uvl, s, ox=0.0, oy=0.0):
    """world-scale projection on the face's dominant axis (Blender coords)"""
    n = face.normal
    ax = max(range(3), key=lambda i: abs(n[i]))
    for loop in face.loops:
        p = loop.vert.co
        if ax == 2: u, v = p.x, p.y
        elif ax == 0: u, v = p.y * (1 if n.x > 0 else -1), p.z
        else: u, v = p.x * (-1 if n.y > 0 else 1), p.z
        loop[uvl].uv = ((u + ox) / s, (v + oy) / s)


def add_geom(m, verts, faces, uvs=None, smooth=False, kind=None):
    """verts in game coords; faces as index tuples; uvs: per face list of (u,v) or None for box UVs"""
    b = bucket(m, kind)
    vs = [b.bm.verts.new(V(*p)) for p in verts]
    s = SCALE.get(b.name, 1.0)
    out = []
    for fi, f in enumerate(faces):
        try: face = b.bm.faces.new([vs[i] for i in f])
        except ValueError: continue
        face.smooth = smooth
        face.normal_update()
        if uvs is not None and uvs[fi] is not None:
            for loop, uv in zip(face.loops, uvs[fi]): loop[b.uv].uv = uv
        else:
            box_uv(face, b.uv, s)
        out.append(face)
    return out


def box(m, x0, y0, z0, x1, y1, z1, skip=()):
    """axis-aligned box in game coords; skip: faces to leave out ('-x','+x','-y','+y','-z','+z')"""
    x0, x1 = min(x0, x1), max(x0, x1); y0, y1 = min(y0, y1), max(y0, y1); z0, z1 = min(z0, z1), max(z0, z1)
    vs = [(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1), (x0, y1, z0), (x1, y1, z0), (x1, y1, z1), (x0, y1, z1)]
    # (faces wound so normals point out once mapped to Blender's right-handed frame)
    F = {'-y': (0, 1, 2, 3), '+y': (4, 7, 6, 5), '-z': (0, 4, 5, 1), '+z': (3, 2, 6, 7), '-x': (0, 3, 7, 4), '+x': (1, 5, 6, 2)}
    return add_geom(m, vs, [f for k, f in F.items() if k not in skip])


def quad_floor(m, x0, z0, x1, z1, y, uv_rot=False, uvs=None):
    vs = [(x0, y, z0), (x0, y, z1), (x1, y, z1), (x1, y, z0)]
    return add_geom(m, vs, [(0, 1, 2, 3)], [uvs] if uvs else None)


def quad_ceiling(m, x0, z0, x1, z1, y):
    vs = [(x0, y, z0), (x1, y, z0), (x1, y, z1), (x0, y, z1)]
    return add_geom(m, vs, [(0, 1, 2, 3)])


def prism(m, pts, y0, y1, cap=True, smooth=False):
    """vertical prism over a 2D outline (game x, z), counter-clockwise seen from above"""
    n = len(pts)
    vs = [(x, y0, z) for x, z in pts] + [(x, y1, z) for x, z in pts]
    faces = [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
    if cap: faces += [tuple(reversed(range(n))), tuple(range(n, 2 * n))]
    return add_geom(m, vs, faces, smooth=smooth)


def lo_seg(seg, least=4):
    """rounder on the full model, coarser on the phone one"""
    return max(least, seg // 2) if LO else seg


def cyl(m, x, y0, z, r, h, seg=16, cap=True, smooth=True, r2=None, kind='detail'):
    r2 = r if r2 is None else r2
    seg = lo_seg(seg)
    vs = []
    for k in range(seg):
        a = 2 * math.pi * k / seg
        vs.append((x + math.cos(a) * r, y0, z + math.sin(a) * r))
    for k in range(seg):
        a = 2 * math.pi * k / seg
        vs.append((x + math.cos(a) * r2, y0 + h, z + math.sin(a) * r2))
    faces = [(seg + k, seg + (k + 1) % seg, (k + 1) % seg, k) for k in range(seg)]
    if cap: faces += [tuple(range(seg)), tuple(reversed(range(seg, 2 * seg)))]
    return add_geom(m, vs, faces, smooth=smooth, kind=kind if MODE[-1] == 'lit' else 'detail')


def lathe(m, x, y, z, prof, seg=16, smooth=True, sx=1.0, sz=1.0, kind='detail'):
    """surface of revolution: prof = [(radius, height)] bottom to top"""
    seg = lo_seg(seg)
    vs, faces = [], []
    n = len(prof)
    for k in range(seg):
        a = 2 * math.pi * k / seg
        for r, h in prof: vs.append((x + math.cos(a) * r * sx, y + h, z + math.sin(a) * r * sz))
    for k in range(seg):
        k2 = (k + 1) % seg
        for i in range(n - 1):
            faces.append((k * n + i + 1, k2 * n + i + 1, k2 * n + i, k * n + i))
    return add_geom(m, vs, faces, smooth=smooth, kind=kind if MODE[-1] == 'lit' else 'detail')


def tube(m, pts, r, seg=6, smooth=True, kind='detail'):
    """a round bar through game-coordinate points"""
    seg = lo_seg(seg, 3)
    vs, faces = [], []
    P = [Vector(p) for p in pts]
    for i, p in enumerate(P):
        d = (P[min(i + 1, len(P) - 1)] - P[max(i - 1, 0)]).normalized()
        a = Vector((0, 1, 0)) if abs(d.y) < 0.9 else Vector((1, 0, 0))
        u = d.cross(a).normalized(); w = d.cross(u).normalized()
        for k in range(seg):
            t = 2 * math.pi * k / seg
            vs.append(tuple(p + (u * math.cos(t) + w * math.sin(t)) * r))
    for i in range(len(P) - 1):
        for k in range(seg):
            k2 = (k + 1) % seg
            faces.append((i * seg + k, i * seg + k2, (i + 1) * seg + k2, (i + 1) * seg + k))
    return add_geom(m, vs, faces, smooth=smooth, kind=kind if MODE[-1] == 'lit' else 'detail')


def sphere(m, x, y, z, r, seg=12, rings=8, sy=1.0, kind='detail'):
    seg, rings = lo_seg(seg), lo_seg(rings, 3)
    vs, faces = [], []
    for i in range(rings + 1):
        th = math.pi * i / rings
        for k in range(seg):
            ph_ = 2 * math.pi * k / seg
            vs.append((x + r * math.sin(th) * math.cos(ph_), y + r * sy * math.cos(th), z + r * math.sin(th) * math.sin(ph_)))
    for i in range(rings):
        for k in range(seg):
            k2 = (k + 1) % seg
            faces.append((i * seg + k, i * seg + k2, (i + 1) * seg + k2, (i + 1) * seg + k))
    return add_geom(m, vs, faces, smooth=True, kind=kind if MODE[-1] == 'lit' else 'detail')


def transformed(fn, origin=(0, 0, 0), yaw=0.0, scale=1.0):
    """run fn() building in local coords, then turn it (about game y, yaw), scale and move it"""
    before = {k: len(b.bm.verts) for k, b in BUCKETS.items()}
    fn()
    c, s = math.cos(yaw), math.sin(yaw)
    for k, b in BUCKETS.items():
        b.bm.verts.ensure_lookup_table()
        for i in range(before.get(k, 0), len(b.bm.verts)):
            v = b.bm.verts[i]
            x, z, y = v.co.x * scale, -v.co.y * scale, v.co.z * scale
            v.co = V(x * c + z * s + origin[0], y + origin[1], -x * s + z * c + origin[2])


# ---------------------------------------------------------------- the shell
X0, X1, Z0, Z1 = HB['x0'], HB['x1'], HB['z0'], HB['z1']
FLOOR_Y = 0.04
ENTRIES = L['ENTRIES']
DECOR_WINDOWS = L.get('WINDOWS', [])


def wall_openings(side):
    out = []
    for e in ENTRIES:
        if e['wall'] == side and not e.get('level'): out.append(dict(at=e['at'], w=e['width'], sill=e['sill'], top=e['top'], kind=e['kind'], id=e['id']))
    for w in DECOR_WINDOWS:
        if w['wall'] == side: out.append(dict(at=w['at'], w=w['width'], sill=w['sill'], top=w['top'], kind='glazed', id=None))
    return sorted(out, key=lambda o: o['at'])


def outer_wall(side):
    """the outside walls in two skins (stucco outside, plaster inside), with the openings"""
    along = side in 'NS'
    lo, hi = (X0, X1) if along else (Z0, Z1)
    lo -= T / 2; hi += T / 2
    c = {'N': Z0, 'S': Z1, 'W': X0, 'E': X1}[side]
    out_sign = {'N': -1, 'S': 1, 'W': -1, 'E': 1}[side]
    ops = wall_openings(side)
    segs, cur = [], lo
    for o in ops:
        segs.append((cur, o['at'] - o['w'] / 2, 0, WH)); cur = o['at'] + o['w'] / 2
        if o['sill'] > 0: segs.append((o['at'] - o['w'] / 2, o['at'] + o['w'] / 2, 0, o['sill']))
        segs.append((o['at'] - o['w'] / 2, o['at'] + o['w'] / 2, o['top'], WH))
    segs.append((cur, hi, 0, WH))
    for a, b, y0, y1 in segs:
        if b - a < 0.005: continue
        for skin, m in ((1, 'Stucco'), (-1, 'Plaster')):
            d0, d1 = (0, T / 2) if skin * out_sign > 0 else (-T / 2, 0)
            if along: box(m, a, y0, c + d0, b, y1, c + d1)
            else: box(m, c + d0, y0, a, c + d1, y1, b)
    # grey plinth round the bottom of the outside, skirting inside
    for a, b, y0, y1 in segs:
        if y0 > 0 or b - a < 0.005: continue
        o = out_sign * (T / 2 + 0.015)
        if along: box('Plinth', a, 0, c + o - 0.015, b, 0.45, c + o + 0.015)
        else: box('Plinth', c + o - 0.015, 0, a, c + o + 0.015, 0.45, b)
    return ops, c, out_sign


def skirting_along(x0, z0, x1, z1, nx, nz, y=FLOOR_Y, h=0.1, t=0.012):
    """baseboard on a wall face from (x0,z0) to (x1,z1), facing (nx, nz)"""
    if nx: box('Skirting', x0, y, min(z0, z1), x0 + nx * t, y + h, max(z0, z1))
    else: box('Skirting', min(x0, x1), y, z0, max(x0, x1), y + h, z0 + nz * t)


def build_shell():
    for side in 'NSWE': outer_wall(side)
    # interior walls (from the game's collision boxes) and the wall over each doorway
    for w in L['HOUSE_WALLS']:
        if w['kind'] != 'iwall': continue
        box('Plaster', w['x'] - w['w'] / 2, 0, w['z'] - w['d'] / 2, w['x'] + w['w'] / 2, WH, w['z'] + w['d'] / 2)
    for p in L['PORTALS']:
        if not p['wall']: continue
        hw = p['w'] / 2
        if p['nx'] == 0: box('Plaster', p['x'] - hw, p['top'], p['z'] - IW / 2, p['x'] + hw, WH, p['z'] + IW / 2)
        else: box('Plaster', p['x'] - IW / 2, p['top'], p['z'] - hw, p['x'] + IW / 2, WH, p['z'] + hw)
    # skirting round every room, broken at the doorways and openings
    for r in L['ROOMS']:
        x0, x1, z0, z1 = r['x0'], r['x1'], r['z0'], r['z1']
        edges = [  # (fixed coord, axis, from, to, normal)
            ('z', z0 + (T if z0 == Z0 else IW) / 2, x0, x1, (0, 1)),
            ('z', z1 - (T if z1 == Z1 else IW) / 2, x0, x1, (0, -1)),
            ('x', x0 + (T if x0 == X0 else IW) / 2, z0, z1, (1, 0)),
            ('x', x1 - (T if x1 == X1 else IW) / 2, z0, z1, (-1, 0)),
        ]
        for ax, c, a, b, n in edges:
            gaps = []
            for p in L['PORTALS']:
                on = (ax == 'z' and p['nz'] and abs(p['z'] - (c - n[1] * (IW / 2))) < 0.3) or (ax == 'x' and p['nx'] and abs(p['x'] - (c - n[0] * (IW / 2))) < 0.3)
                if on: gaps.append(((p['x'] if ax == 'z' else p['z']) - p['w'] / 2, (p['x'] if ax == 'z' else p['z']) + p['w'] / 2))
            side = {'z': {Z0 + T / 2: 'N', Z1 - T / 2: 'S'}, 'x': {X0 + T / 2: 'W', X1 - T / 2: 'E'}}[ax].get(round(c, 3))
            if side:
                for o in wall_openings(side):
                    if o['sill'] == 0: gaps.append((o['at'] - o['w'] / 2, o['at'] + o['w'] / 2))
            # the colonnade line has no wall: no skirting there
            col = L['COLONNADE']
            if ax == 'z' and abs(c - n[1] * (IW / 2) - col['z']) < 0.3 and a >= col['x0'] - 0.01 and b <= col['x1'] + 0.01: continue
            a2, b2 = a + IW / 2, b - IW / 2
            pieces, cur = [], a2
            for g0, g1 in sorted(gaps):
                if g1 < a2 or g0 > b2: continue
                if g0 > cur: pieces.append((cur, g0))
                cur = max(cur, g1)
            if cur < b2: pieces.append((cur, b2))
            for p0, p1 in pieces:
                if ax == 'z': skirting_along(p0, c, p1, c, 0, n[1])
                else: skirting_along(c, p0, c, p1, n[0], 0)


# ---------------------------------------------------------------- floors
def band(x0, z0, x1, z1, w=0.36, y=FLOOR_Y + 0.002):
    """the patterned border round a rectangle (outer edge given)"""
    s = 1.44
    def strip(ax0, az0, ax1, az1, along_x):
        L_ = (ax1 - ax0) if along_x else (az1 - az0)
        if along_x: uvs = [(0, 0), (0, 1), (L_ / s, 1), (L_ / s, 0)]
        else: uvs = [(0, 1), (L_ / s, 1), (L_ / s, 0), (0, 0)]
        quad_floor('Border', ax0, az0, ax1, az1, y, uvs=uvs)
    strip(x0, z0, x1, z0 + w, True)
    strip(x0, z1 - w, x1, z1, True)
    strip(x0, z0 + w, x0 + w, z1 - w, False)
    strip(x1 - w, z0 + w, x1, z1 - w, False)


def build_floors():
    for r in L['ROOMS']:
        x0, x1, z0, z1 = r['x0'], r['x1'], r['z0'], r['z1']
        m = 'StoneCream' if r['id'] == 'kitchen' else 'FloorTile'
        quad_floor(m, x0, z0, x1, z1, FLOOR_Y)
    # foundation under it all
    box('Plinth', X0 - T / 2, -0.4, Z0 - T / 2, X1 + T / 2, 0.0, Z1 + T / 2, skip=('+y',))
    # the border bands, inset from the walls like the real floors
    ins = 0.5
    band(-13 + T / 2 + ins, -1 + IW / 2 + ins, -7 - IW / 2 - ins, 7 - T / 2 - ins)          # bar room
    band(-13 + T / 2 + 0.35, -4 + IW / 2 + 0.35, -7 + 0.1, -1 - IW / 2 - 0.35)             # passage runner
    S = L['STAIR']
    band(-7 + IW / 2 + 0.45, S['z1'] + 0.35, 4 - IW / 2 - 0.45, -1 - 0.45)                  # stair hall corridor
    band(4 + IW / 2 + 0.5, -9 + T / 2 + 0.5, 11 - T / 2 - 0.5, -1 - IW / 2 - 0.5)            # office
    # the big room: a frame round the dining table filled with grey cement tiles, another
    # round the sitting area
    dx0, dx1, dz0, dz1 = -5.6, 2.1, 1.25, 4.75
    quad_floor('RugGrey', dx0 + 0.36, dz0 + 0.36, dx1 - 0.36, dz1 - 0.36, FLOOR_Y + 0.001)
    band(dx0, dz0, dx1, dz1)
    band(-7 + IW / 2 + 0.5, -1 + 0.6, 11 - T / 2 - 0.5, 7 - T / 2 - 0.5)                    # the whole room
    sx0, sx1, sz0, sz1 = 6.3, 9.6, 2.2, 5.3
    quad_floor('RugGrey', sx0, sz0, sx1, sz1, FLOOR_Y + 0.001)
    band(sx0 - 0.36, sz0 - 0.36, sx1 + 0.36, sz1 + 0.36)
    # kitchen: blue-and-yellow cement tiles under the table, in a border of blue
    kt = next(f for f in L['FURNITURE'] if f['kind'] == 'ktable')
    quad_floor('RugKitchen', kt['x'] - 1.35, kt['z'] - 1.15, kt['x'] + 1.35, kt['z'] + 1.15, FLOOR_Y + 0.001)
    # thresholds under the doorways
    for p in L['PORTALS']:
        if not p['wall']: continue
        hw = p['w'] / 2
        if p['nx'] == 0: quad_floor('FloorTile', p['x'] - hw, p['z'] - IW / 2, p['x'] + hw, p['z'] + IW / 2, FLOOR_Y + 0.0005)
        else: quad_floor('FloorTile', p['x'] - IW / 2, p['z'] - hw, p['x'] + IW / 2, p['z'] + hw, FLOOR_Y + 0.0005)
    for e in ENTRIES:
        hw = e['width'] / 2
        if e['nx'] == 0: quad_floor('FloorTile', e['x'] - hw, e['z'] - T / 2, e['x'] + hw, e['z'] + T / 2, FLOOR_Y + 0.0005)
        else: quad_floor('FloorTile', e['x'] - T / 2, e['z'] - hw, e['x'] + T / 2, e['z'] + hw, FLOOR_Y + 0.0005)


# ---------------------------------------------------------------- ceilings
def build_ceilings():
    S = L['STAIR']
    for r in L['ROOMS']:
        x0, x1, z0, z1 = r['x0'], r['x1'], r['z0'], r['z1']
        if r['id'] == 'hall':
            # leave the stairwell open over the flight
            wx0, wx1, wz0, wz1 = S['x0'] - 0.05, S['x1'], z0, -7.25
            quad_ceiling('Ceiling', x0, wz1, x1, z1, WH)
            quad_ceiling('Ceiling', x0, z0, wx0, wz1, WH)
            quad_ceiling('Ceiling', wx1, z0, x1, wz1, WH)
            # the edge of the stairwell: the slab's thickness shows, plastered
            box('Plaster', wx0, WH, wz1 - 0.02, wx1, WH + 0.3, wz1)
            box('Plaster', wx0 - 0.02, WH, wz0, wx0, WH + 0.3, wz1)
            continue
        quad_ceiling('Ceiling', x0, z0, x1, z1, WH)
    # a stepped cornice where walls meet the ceiling, all round each room
    for r in L['ROOMS']:
        x0, x1, z0, z1 = r['x0'] + 0.1, r['x1'] - 0.1, r['z0'] + 0.1, r['z1'] - 0.1
        for (a, b) in ((0.07, 0.05), (0.13, 0.025)):
            y0 = WH - b - (0.05 if a == 0.07 else 0.0)
            box('Ceiling', x0, WH - 0.09 + (0.04 if a > 0.1 else 0), z0, x1, WH, z0 + a, skip=('+y',))
            box('Ceiling', x0, WH - 0.09 + (0.04 if a > 0.1 else 0), z1 - a, x1, WH, z1, skip=('+y',))
            box('Ceiling', x0, WH - 0.09 + (0.04 if a > 0.1 else 0), z0, x0 + a, WH, z1, skip=('+y',))
            box('Ceiling', x1 - a, WH - 0.09 + (0.04 if a > 0.1 else 0), z0, x1, WH, z1, skip=('+y',))


# ---------------------------------------------------------------- arches and columns
def arch_block(m, a, b, c, depth, spring, rise, top, along_x=True, seg=18):
    """the wall over a segmental arch from a to b (centre line c, thickness depth)"""
    vs, faces = [], []
    pts = []
    span = b - a
    R = (span * span / 4 + rise * rise) / (2 * rise)
    mid = (a + b) / 2
    cy = spring + rise - R
    for i in range(seg + 1):
        t = a + span * i / seg
        y = cy + math.sqrt(max(0, R * R - (t - mid) ** 2))
        pts.append((t, y))
    for side in (-1, 1):
        for t, y in pts:
            vs.append((t, y, c + side * depth / 2) if along_x else (c + side * depth / 2, y, t))
            vs.append((t, top, c + side * depth / 2) if along_x else (c + side * depth / 2, top, t))
    n = seg + 1
    for i in range(seg):
        f0 = [2 * i, 2 * (i + 1), 2 * (i + 1) + 1, 2 * i + 1]
        f1 = [2 * n + 2 * i, 2 * n + 2 * i + 1, 2 * n + 2 * (i + 1) + 1, 2 * n + 2 * (i + 1)]
        faces += [tuple(f0), tuple(f1)]
        faces.append((2 * i, 2 * n + 2 * i, 2 * n + 2 * (i + 1), 2 * (i + 1)))  # soffit
    if not along_x: faces = [tuple(reversed(f)) for f in faces]
    add_geom(m, vs, faces)


def column(x, z, size, h, base=True):
    s = size / 2
    box('Travertine', x - s, FLOOR_Y, z - s, x + s, h, z + s)
    if base:
        box('Travertine', x - s - 0.05, FLOOR_Y, z - s - 0.05, x + s + 0.05, FLOOR_Y + 0.16, z + s + 0.05)
        box('Travertine', x - s - 0.06, h - 0.1, z - s - 0.06, x + s + 0.06, h, z + s + 0.06)


def build_arches():
    col = L['COLONNADE']
    sz, sp = col['size'], col['spring']
    xs = [col['x0'] + IW / 2] + col['cols'] + [col['x1'] - IW / 2]
    supports = [(xs[0], xs[0] + 0.15)] + [(x - sz / 2, x + sz / 2) for x in col['cols']] + [(xs[-1] - 0.15, xs[-1])]
    for x in col['cols']: column(x, col['z'], sz, sp)
    for (x, z) in ((xs[0] + 0.15, col['z']), (xs[-1] - 0.15, col['z'])):  # pilasters on the walls
        box('Travertine', x - 0.15, FLOOR_Y, z - sz / 2, x + 0.15, sp, z + sz / 2)
    for i in range(len(supports) - 1):
        a, b = supports[i][1], supports[i + 1][0]
        arch_block('Plaster', a, b, col['z'], sz, sp, 0.55, WH, True)
    # over the column between the dining and sitting ends: two arches across the room
    ac = L['ARCH_COL']
    column(ac['x'], ac['z'], ac['size'], ac['spring'])
    zs = [(-1 + IW / 2, -1 + IW / 2 + 0.15), (ac['z'] - ac['size'] / 2, ac['z'] + ac['size'] / 2), (7 - T / 2 - 0.15, 7 - T / 2)]
    for z0, z1 in (zs[0], zs[2]):
        box('Travertine', ac['x'] - ac['size'] / 2, FLOOR_Y, z0, ac['x'] + ac['size'] / 2, ac['spring'], z1)
    for i in range(2):
        arch_block('Plaster', zs[i][1], zs[i + 1][0], ac['x'], ac['size'], ac['spring'], 0.6, WH, False)
    # the wide opening from the passage into the hall gets an arch too
    for p in L['PORTALS']:
        if p['kind'] == 'open':
            arch_block('Plaster', p['z'] - p['w'] / 2, p['z'] + p['w'] / 2, p['x'], IW, 2.9, 0.45, WH, False)


# ---------------------------------------------------------------- the stair
def build_stair():
    S = L['STAIR']
    n = S['steps']
    x0, x1, z0, z1 = S['x0'], S['x1'], S['z0'], S['z1']
    run = (x1 - x0) / n
    rise = S['rise'] / (n + 1)
    soffit = 0.22
    for i in range(n):
        xa, xb = x0 + i * run, x0 + (i + 1) * run
        ya = FLOOR_Y + rise * (i + 1)
        box('Plaster', xa, max(FLOOR_Y, ya - rise - soffit * 1.6), z0, xb + 0.001, ya, z1, skip=('-y',) if i > 6 else ())
        box('FloorTile', xa - 0.025, ya, z0, xb, ya + 0.025, z1 + 0.02)                    # honey tile treads
        box('Skirting', xa - 0.025, ya - rise, z1 - 0.001, xa + 0.001, ya, z1 + 0.012)     # riser face
    # the landing at the top, under the upper floor
    lx = S['landingX']
    box('Plaster', x1, S['rise'] - 0.3, z0, lx, S['rise'] + FLOOR_Y, z1)
    box('FloorTile', x1, S['rise'] + FLOOR_Y, z0, lx, S['rise'] + FLOOR_Y + 0.025, z1)
    # the sloping underside
    vs = [(x0, FLOOR_Y, z0), (x0, FLOOR_Y, z1), (x1, S['rise'] - 0.3, z1), (x1, S['rise'] - 0.3, z0)]
    add_geom('Plaster', vs, [(0, 3, 2, 1)])
    # solid white balustrade wall along the open side, capped, ending in a square newel
    bt = 0.12
    zb = z1 + bt / 2
    pts_lo, pts_hi = [], []
    for i in range(n + 1):
        x = x0 + i * run
        pts_lo.append((x, FLOOR_Y + rise * i - 0.25))
        pts_hi.append((x, FLOOR_Y + rise * (i + 1) + 0.92))
    vs, faces = [], []
    for s in (-1, 1):
        for (x, ylo), (_, yhi) in zip(pts_lo, pts_hi):
            vs += [(x, max(FLOOR_Y, ylo), zb + s * bt / 2), (x, yhi, zb + s * bt / 2)]
    m_ = n + 1
    for i in range(n):
        faces.append((2 * i, 2 * i + 2, 2 * i + 3, 2 * i + 1))
        faces.append((2 * m_ + 2 * i, 2 * m_ + 2 * i + 1, 2 * m_ + 2 * i + 3, 2 * m_ + 2 * i + 2))
        faces.append((2 * i + 1, 2 * i + 3, 2 * m_ + 2 * i + 3, 2 * m_ + 2 * i + 1))  # top
    add_geom('Plaster', vs, faces)
    box('Plaster', x0 - 0.2, FLOOR_Y, z1 - 0.02, x0 + 0.12, FLOOR_Y + 1.15, z1 + bt + 0.08)    # newel
    box('Plaster', x0 - 0.23, FLOOR_Y + 1.15, z1 - 0.05, x0 + 0.15, FLOOR_Y + 1.2, z1 + bt + 0.11)
    # across the landing
    box('Plaster', x1, S['rise'], z1, lx, S['rise'] + 0.95, z1 + bt)


# ---------------------------------------------------------------- doors and windows
def frame_casing(x, z, nx, nz, w, y0, y1, depth, m='Mahogany', cw=0.08, face_out=None):
    """a door/window frame lining an opening: two jambs and a head, plus casing on the faces"""
    along_x = nx == 0
    hw = w / 2
    if along_x:
        box(m, x - hw, y0, z - depth / 2, x - hw + 0.05, y1, z + depth / 2)
        box(m, x + hw - 0.05, y0, z - depth / 2, x + hw, y1, z + depth / 2)
        box(m, x - hw, y1 - 0.05, z - depth / 2, x + hw, y1, z + depth / 2)
        for s in ((-1, 1) if face_out is None else (face_out,)):
            zf = z + s * (depth / 2 + 0.012)
            box(m, x - hw - cw, y0, zf - 0.012, x - hw, y1 + cw, zf + 0.012)
            box(m, x + hw, y0, zf - 0.012, x + hw + cw, y1 + cw, zf + 0.012)
            box(m, x - hw - cw, y1, zf - 0.012, x + hw + cw, y1 + cw, zf + 0.012)
    else:
        box(m, x - depth / 2, y0, z - hw, x + depth / 2, y1, z - hw + 0.05)
        box(m, x - depth / 2, y0, z + hw - 0.05, x + depth / 2, y1, z + hw)
        box(m, x - depth / 2, y1 - 0.05, z - hw, x + depth / 2, y1, z + hw)
        for s in ((-1, 1) if face_out is None else (face_out,)):
            xf = x + s * (depth / 2 + 0.012)
            box(m, xf - 0.012, y0, z - hw - cw, xf + 0.012, y1 + cw, z - hw)
            box(m, xf - 0.012, y0, z + hw, xf + 0.012, y1 + cw, z + hw + cw)
            box(m, xf - 0.012, y1, z - hw - cw, xf + 0.012, y1 + cw, z + hw + cw)


def leaf_geom(kind, w, h, t=0.045):
    """one door leaf in local coords: hinge at x=0, spanning x 0..w, y 0..h, centred on z=0.
    Returns a list of (material, builder) calls via the global buckets."""
    st = 0.09 if kind != 'louver' else 0.06
    box('Mahogany' if kind != 'cedar' else 'Cedar', 0, 0, -t / 2, st, h, t / 2)
    box('Mahogany' if kind != 'cedar' else 'Cedar', w - st, 0, -t / 2, w, h, t / 2)
    if kind in ('glazed', 'frosted'):
        box('Mahogany', st, h - 0.11, -t / 2, w - st, h, t / 2)
        box('Mahogany', st, 0, -t / 2, w - st, 0.62, t / 2)            # raised panel at the bottom
        box('Mahogany', st + 0.05, 0.1, -t / 2 - 0.012, w - st - 0.05, 0.5, t / 2 + 0.012)
        box('Mahogany', st, 0.62, -t / 2, w - st, 0.68, t / 2)
        g = 'Glass' if kind == 'glazed' else 'Frosted'
        add_geom(g, [(st, 0.68, 0), (w - st, 0.68, 0), (w - st, h - 0.11, 0), (st, h - 0.11, 0)], [(0, 1, 2, 3)])
        box('Brass', w - st - 0.035, 1.0, -t / 2 - 0.04, w - st - 0.02, 1.16, t / 2 + 0.04)
    elif kind in ('louver', 'cedar'):
        m = 'Mahogany' if kind == 'louver' else 'Cedar'
        for y0, y1 in ((0, 0.1), (h - 0.1, h), (h * 0.48, h * 0.48 + 0.08)):
            box(m, st, y0, -t / 2, w - st, y1, t / 2)
        y = 0.13
        while y < h - 0.13:
            if not (h * 0.46 < y < h * 0.48 + 0.1):
                # slanted slat
                add_geom(m, [(st, y, -0.02), (w - st, y, -0.02), (w - st, y + 0.045, 0.02), (st, y + 0.045, 0.02)], [(0, 1, 2, 3), (3, 2, 1, 0)])
            y += 0.042
    else:  # raised-panel door
        box('Mahogany', st, h - 0.13, -t / 2, w - st, h, t / 2)
        box('Mahogany', st, 0, -t / 2, w - st, 0.2, t / 2)
        box('Mahogany', st, h * 0.45, -t / 2, w - st, h * 0.45 + 0.12, t / 2)
        for y0, y1 in ((0.2, h * 0.45), (h * 0.45 + 0.12, h - 0.13)):
            box('Mahogany', st, y0, -t / 2 + 0.012, w - st, y1, t / 2 - 0.012)
            box('Mahogany', st + 0.05, y0 + 0.05, -t / 2 - 0.006, w - st - 0.05, y1 - 0.05, t / 2 + 0.006)
        box('Iron', w - st - 0.04, 1.0, -t / 2 - 0.05, w - st - 0.02, 1.08, t / 2 + 0.05)


def place_leaf(kind, hinge, w, h, yaw):
    """a leaf with its hinge at game point hinge=(x,y,z), turned by yaw about the hinge"""
    with detail(): transformed(lambda: leaf_geom(kind, w, h), hinge, yaw)


DYNAMIC = []   # (name, fn, origin) built as separate objects


def build_entries():
    for side in 'NSWE':
        for o in wall_openings(side):
            e = next((x for x in ENTRIES if x['id'] == o['id']), None) if o['id'] is not None else None
            nx, nz = {'N': (0, -1), 'S': (0, 1), 'W': (-1, 0), 'E': (1, 0)}[side]
            c = {'N': Z0, 'S': Z1, 'W': X0, 'E': X1}[side]
            x, z = (o['at'], c) if nx == 0 else (c, o['at'])
            w, y0, y1 = o['w'], o['sill'] + FLOOR_Y * (o['sill'] == 0), o['top']
            # terracotta-red reveals on the outside half (like the real house), mahogany frame inside
            hw = w / 2
            if nx == 0:
                zo = z + nz * T / 4
                box('RedPaint', x - hw, o['sill'], zo - T / 4, x - hw + 0.02, o['top'], zo + T / 4)
                box('RedPaint', x + hw - 0.02, o['sill'], zo - T / 4, x + hw, o['top'], zo + T / 4)
                box('RedPaint', x - hw, o['top'] - 0.02, zo - T / 4, x + hw, o['top'], zo + T / 4)
                if o['sill'] > 0: box('RedPaint', x - hw, o['sill'], zo - T / 4, x + hw, o['sill'] + 0.02, zo + T / 4)
            else:
                xo = x + nx * T / 4
                box('RedPaint', xo - T / 4, o['sill'], z - hw, xo + T / 4, o['top'], z - hw + 0.02)
                box('RedPaint', xo - T / 4, o['sill'], z + hw - 0.02, xo + T / 4, o['top'], z + hw)
                box('RedPaint', xo - T / 4, o['top'] - 0.02, z - hw, xo + T / 4, o['top'], z + hw)
                if o['sill'] > 0: box('RedPaint', xo - T / 4, o['sill'], z - hw, xo + T / 4, o['sill'] + 0.02, z + hw)
            # mahogany frame on the inner half
            ci = -T / 4
            fx, fz = (x, z + nz * ci) if nx == 0 else (x + nx * ci, z)
            frame_casing(fx, fz, nx, nz, w, max(FLOOR_Y, o['sill']), o['top'], T / 2, face_out=-(nz if nx == 0 else nx))
            if o['sill'] > 0:  # wooden sill board inside
                if nx == 0: box('Mahogany', x - hw - 0.05, o['sill'] - 0.04, z - nz * (T / 2 + 0.05), x + hw + 0.05, o['sill'], z)
                else: box('Mahogany', x - nx * (T / 2 + 0.05), o['sill'] - 0.04, z - hw - 0.05, x, o['sill'], z + hw + 0.05)
            inner = (x - nx * (T / 2), z - nz * (T / 2))
            lw = (w - 0.1) / 2
            lh = o['top'] - max(FLOOR_Y, o['sill']) - 0.05
            # direction along the wall ("right" when looking out), and inward normal
            ax, az = (1, 0) if nx == 0 else (0, 1)
            yaw_along = 0.0 if nx == 0 else -math.pi / 2   # leaf local +x along the wall
            # louvered shutters (or, on the doors, the panelled door leaves) folded back flat
            # against the inside wall either side of the opening
            for s in (-1, 1):
                hx = inner[0] + ax * s * (w / 2) - nx * 0.03
                hz = inner[1] + az * s * (w / 2) - nz * 0.03
                yaw = yaw_along + (0 if s > 0 else math.pi)
                kind = 'panel' if o['kind'] == 'door' else 'cedar' if (o['at'] * 7) % 3 < 1 else 'louver'
                place_leaf(kind, (hx, max(FLOOR_Y, o['sill']) + 0.02 * (o['kind'] != 'door'), hz), lw, lh, yaw)
            if o['kind'] == 'door':
                # transom light over the door
                if nx == 0: add_geom('Glass', [(x - hw, o['top'], z), (x + hw, o['top'], z), (x + hw, WH - 0.3, z), (x - hw, WH - 0.3, z)], [(0, 1, 2, 3), (3, 2, 1, 0)])
                continue
            if o['kind'] == 'glazed':
                # fixed glazed casement with grille: kitchen and office windows
                mx, mz = (x, z + nz * 0.02) if nx == 0 else (x + nx * 0.02, z)
                g = [(mx - hw * ax, y0, mz - hw * az), (mx + hw * ax, y0, mz + hw * az), (mx + hw * ax, y1, mz + hw * az), (mx - hw * ax, y1, mz - hw * az)]
                add_geom('Glass', g, [(0, 1, 2, 3), (3, 2, 1, 0)])
                for k in range(5):  # muntins
                    t_ = -hw + w * k / 4
                    box('Mahogany', mx + ax * t_ - 0.025 * ax - 0.03 * (1 - ax), y0, mz + az * t_ - 0.025 * az - 0.03 * (1 - az), mx + ax * t_ + 0.025 * ax + 0.03 * (1 - ax), y1, mz + az * t_ + 0.025 * az + 0.03 * (1 - az))
                for yy in (y0, (y0 + y1) / 2, y1 - 0.05):
                    box('Mahogany', mx - hw * ax - 0.03 * (1 - ax), yy, mz - hw * az - 0.03 * (1 - az), mx + hw * ax + 0.03 * (1 - ax), yy + 0.05, mz + hw * az + 0.03 * (1 - az))
                grille_geom((x + nx * (T / 2 + 0.03), z + nz * (T / 2 + 0.03)), nx, nz, w, o['sill'], o['top'])
                continue
            # a French-door 'window' the cows come through: two glazed leaves (shut) and an
            # iron grille outside, each its own node so the game can break them open
            eid = o['id']
            for s, tag in ((-1, 'L'), (1, 'R')):
                hx = x + ax * s * (w / 2 - 0.05) - nx * 0.02 * 0
                hz = z + az * s * (w / 2 - 0.05)
                yaw = yaw_along + (0 if s < 0 else math.pi)
                DYNAMIC.append((f'Leaf_{eid}_{tag}', lambda yaw=yaw, lw=lw, lh=lh: transformed(lambda: leaf_geom('glazed', lw - 0.02, lh, 0.05), (0, 0, 0), yaw), (hx, max(FLOOR_Y, o['sill']) + 0.02, hz)))
            DYNAMIC.append((f'Grille_{eid}', lambda nx=nx, nz=nz, w=w, o=o: grille_geom((0, 0), nx, nz, w, o['sill'], o['top']), (x + nx * (T / 2 + 0.035), 0, z + nz * (T / 2 + 0.035))))


def grille_geom(at, nx, nz, w, sill, top):
    """wrought iron bars with forged collars and spear tips, flat bands across"""
    ax, az = (1, 0) if nx == 0 else (0, 1)
    n = max(5, round(w / 0.13))
    y0, y1 = sill + 0.03, top - 0.02
    for i in range(n + 1):
        t = -w / 2 + 0.05 + (w - 0.1) * i / n
        px, pz = at[0] + ax * t, at[1] + az * t
        cyl('Iron', px, y0, pz, 0.011, y1 - y0, seg=6, cap=False)
        for yy in (y0 + (y1 - y0) * 0.33, y0 + (y1 - y0) * 0.66):
            lathe('Iron', px, yy - 0.04, pz, [(0.011, 0), (0.022, 0.015), (0.024, 0.04), (0.022, 0.065), (0.011, 0.08)], seg=8)
        lathe('Iron', px, y1 - 0.12, pz, [(0.011, 0), (0.026, 0.05), (0.0, 0.12)], seg=6)
    for yy in (y0, (y0 + y1) / 2, y1 - 0.15):
        if nx == 0: box('Iron', at[0] - w / 2, yy, at[1] - 0.006, at[0] + w / 2, yy + 0.035, at[1] + 0.006)
        else: box('Iron', at[0] - 0.006, yy, at[1] - w / 2, at[0] + 0.006, yy + 0.035, at[1] + w / 2)


def build_interior_doors():
    for p in L['PORTALS']:
        if not p['wall']: continue
        x, z, w, top = p['x'], p['z'], p['w'], p['top']
        nx, nz = p['nx'], p['nz']
        frame_casing(x, z, nx, nz, w, FLOOR_Y, top, IW)
        # transom panes over the door (two little lights, like the kitchen and glass doors)
        if top < WH - 0.6:
            yb, yt = top + 0.1, min(WH - 0.25, top + 0.5)
            frame_casing(x, z, nx, nz, w, yb, yt, IW, cw=0.05)
            for k, (a, b) in enumerate(((-w / 2 + 0.06, -0.03), (0.03, w / 2 - 0.06))):
                if nx == 0: add_geom('Frosted', [(x + a, yb + 0.05, z), (x + b, yb + 0.05, z), (x + b, yt - 0.05, z), (x + a, yt - 0.05, z)], [(0, 1, 2, 3), (3, 2, 1, 0)])
                else: add_geom('Frosted', [(x, yb + 0.05, z + a), (x, yb + 0.05, z + b), (x, yt - 0.05, z + b), (x, yt - 0.05, z + a)], [(0, 1, 2, 3), (3, 2, 1, 0)])
            if nx == 0: box('Mahogany', x - 0.03, yb, z - IW / 2, x + 0.03, yt, z + IW / 2)
            else: box('Mahogany', x - IW / 2, yb, z - 0.03, x + IW / 2, yt, z + 0.03)
        # the leaves, open flat against the wall on the far side
        kind = {'glass': 'frosted', 'door': 'panel', 'double': 'panel'}[p['kind']]
        lw = (w - 0.1) / 2
        lh = top - FLOOR_Y - 0.05
        ax, az = (1, 0) if nx == 0 else (0, 1)
        side = 1
        for f in L['FURNITURE']:
            fx, fz = x + nx * 0.4, z + nz * 0.4
            if abs(fx - f['x']) < f['w'] / 2 + w and abs(fz - f['z']) < f['d'] / 2 + 0.5: side = -1
        for s in (-1, 1):
            hx = x + ax * s * (w / 2 - 0.05) + side * nx * (IW / 2 + 0.03)
            hz = z + az * s * (w / 2 - 0.05) + side * nz * (IW / 2 + 0.03)
            # leaf runs from the hinge outward along the wall, away from the opening
            if nx == 0: yaw = 0.0 if s > 0 else math.pi
            else: yaw = -math.pi / 2 if s > 0 else math.pi / 2
            place_leaf(kind, (hx, FLOOR_Y, hz), lw, lh, yaw)


# ---------------------------------------------------------------- roof, upper floor, veranda
def wall_run(along_x, c, lo, hi, y0, y1, t, out_sign, openings, m_out='Stucco', m_in='Plaster', both_in=False):
    """a straight wall at x or z = c from lo to hi, floor y0 to y1, with openings
    [(centre, width, sill, top)], stucco on the outside (out_sign side), plaster inside"""
    segs, cur = [], lo
    for (at, w, sill, top) in sorted(openings):
        segs.append((cur, at - w / 2, y0, y1)); cur = at + w / 2
        if sill > 0: segs.append((at - w / 2, at + w / 2, y0, y0 + sill))
        if y0 + top < y1: segs.append((at - w / 2, at + w / 2, y0 + top, y1))
    segs.append((cur, hi, y0, y1))
    for a, b, ya, yb in segs:
        if b - a < 0.005 or yb - ya < 0.005: continue
        for skin, m in ((1, m_in if both_in else m_out), (-1, m_in)):
            d0, d1 = (0, t / 2) if skin * out_sign > 0 else (-t / 2, 0)
            if along_x: box(m, a, ya, c + d0, b, yb, c + d1)
            else: box(m, c + d0, ya, a, c + d1, yb, b)


def upper_window(x, z, nx, nz, y0, w=1.2, sill=0.95, top=2.3, glass_door=False):
    """a window (or glazed door) upstairs: mahogany frame and muntins, glass, a grille outside"""
    along = nx == 0
    hw = w / 2
    yb, yt = y0 + sill, y0 + top
    if along: g = [(x - hw, yb, z), (x + hw, yb, z), (x + hw, yt, z), (x - hw, yt, z)]
    else: g = [(x, yb, z - hw), (x, yb, z + hw), (x, yt, z + hw), (x, yt, z - hw)]
    add_geom('Glass', g, [(0, 1, 2, 3), (3, 2, 1, 0)], kind='detail')
    frame_casing(x, z, nx, nz, w, yb, yt, 0.12)
    for k in range(3):
        u = -hw + w * k / 2
        if along: box('Mahogany', x + u - 0.025, yb, z - 0.03, x + u + 0.025, yt, z + 0.03)
        else: box('Mahogany', x - 0.03, yb, z + u - 0.025, x + 0.03, yt, z + u + 0.025)
    for yy in ((yb + yt) / 2, yb + (yt - yb) * 0.8):
        if along: box('Mahogany', x - hw, yy, z - 0.03, x + hw, yy + 0.04, z + 0.03)
        else: box('Mahogany', x - 0.03, yy, z - hw, x + 0.03, yy + 0.04, z + hw)
    if not glass_door:
        with detail(): grille_geom((x + nx * 0.16, z + nz * 0.16), nx, nz, w, sill + y0, top + y0)
        if along: box('Stucco', x - hw - 0.08, yb - 0.06, z + nz * 0.12, x + hw + 0.08, yb, z + nz * 0.22)
        else: box('Stucco', x + nx * 0.12, yb - 0.06, z - hw - 0.08, x + nx * 0.22, yb, z + hw + 0.08)


def build_exterior():
    top = WH
    U = L['UPPER']['y']
    # the roof over the ground floor (the floor upstairs), the stairwell left open; cornice
    for b in L['UPPER_SOLIDS']:
        if b['kind'] == 'slab':
            box('Stucco', b['x'] - b['w'] / 2, b['y0'], b['z'] - b['d'] / 2, b['x'] + b['w'] / 2, b['h'], b['z'] + b['d'] / 2)
    box('Stucco', X0 - T / 2 - 0.22, top + 0.02, Z0 - T / 2 - 0.22, X1 + T / 2 + 0.22, top + 0.16, Z0 - T / 2, skip=('+y',))
    box('Stucco', X1 + T / 2, top + 0.02, Z0 - T / 2 - 0.22, X1 + T / 2 + 0.22, top + 0.16, Z1 + T / 2 + 0.22, skip=('+y',))
    # parapets round the flat roof (open where the outside stair arrives), with a cap
    for b in L['UPPER_SOLIDS']:
        if b['kind'] != 'parapet': continue
        x0, x1, z0, z1 = b['x'] - b['w'] / 2, b['x'] + b['w'] / 2, b['z'] - b['d'] / 2, b['z'] + b['d'] / 2
        box('Stucco', x0, U, z0, x1, b['h'], z1)
        box('Stucco', x0 - 0.04, b['h'], z0 - 0.04, x1 + 0.04, b['h'] + 0.07, z1 + 0.04)
    # terracotta tiles on the flat roof and in front of the loggia
    UP = L['UPPER']
    quad_floor('Terracotta', UP['x1'] + 0.12, Z0 + 0.07, X1 - 0.07, Z1 - 3.15, U + 0.003)
    quad_floor('Terracotta', UP['x0'] - 0.12, UP['loggiaZ'], UP['x1'] + 0.12, Z1 - 3.15, U + 0.003)
    # terracotta shed roofs: across the front (into the veranda roof) and down the west wing
    pt = U
    hi, lo = pt + 1.1, pt + 0.12
    zf = Z1 - 3.0
    shed([(X0 - 0.3, hi, zf), (X1 + 0.3, hi, zf), (X1 + 0.3, lo, Z1 + 0.3), (X0 - 0.3, lo, Z1 + 0.3)], base=WH + 0.16)
    box('Stucco', X0 - 0.3, pt, zf - 0.22, X1 + 0.3, hi + 0.05, zf)
    xw = UP['x0'] - 0.125
    shed([(xw, hi, Z0 - 0.3), (xw, hi, zf - 0.22), (X0 - 0.3, lo, zf - 0.22), (X0 - 0.3, lo, Z0 - 0.3)], base=WH + 0.16)
    box('Stucco', xw - 0.22, pt, UP['loggiaZ'], xw + 0.0, hi + 0.05, zf - 0.22)   # the west shed's high side, past the loggia
    box('Stucco', xw - 0.22, pt, Z0 - 0.3, xw + 0.0, hi + 0.05, UP['z0'] - 0.125)
    build_upstairs()


def build_upstairs():
    UP = L['UPPER']
    U, UH = UP['y'], UP['h']
    W = U + UH
    x0, x1, z0, z1, lz = UP['x0'], UP['x1'], UP['z0'], UP['z1'], UP['loggiaZ']
    uw = 0.25
    door = next(e for e in ENTRIES if e.get('level'))
    # outside walls with their windows; the bedroom fronts onto the loggia with glazed doors
    wall_run(True, z0, x0 - uw / 2, x1 + uw / 2, U, W, uw, -1, [(-4.5, 1.2, 0.95, 2.3), (-1.0, 1.2, 0.95, 2.3), (2.5, 1.2, 0.95, 2.3)])
    wall_run(False, x0, z0, lz, U, W, uw, -1, [(-7.0, 1.2, 0.95, 2.3), (-3.0, 1.2, 0.95, 2.3)])
    wall_run(False, x1, z0, z1, U, W, uw, 1, [(door['z'], door['width'], 0, door['top']), (-3.0, 1.2, 0.95, 2.3)])
    wall_run(True, z1, x0 + uw / 2, x1 - uw / 2, U, W, 0.2, 1, [(-4.0, 1.3, 0.0, 2.4), (1.5, 1.3, 0.0, 2.4)])
    for (x, z, nx, nz) in ((-4.5, z0, 0, -1), (-1.0, z0, 0, -1), (2.5, z0, 0, -1), (x0, -7.0, -1, 0), (x0, -3.0, -1, 0), (x1, -3.0, 1, 0)):
        upper_window(x, z, nx, nz, U)
    for x in (-4.0, 1.5):
        upper_window(x, z1, 0, 1, U, 1.3, 0.02, 2.4, glass_door=True)
    # the door out onto the roof: frame, the two leaves standing open against the wall,
    # red reveal outside, a transom light
    frame_casing(x1, door['z'], 1, 0, door['width'], U, U + door['top'], uw)
    for s_ in (-1, 1):
        place_leaf('panel', (x1 - uw / 2 - 0.03, U, door['z'] + s_ * door['width'] / 2), (door['width'] - 0.1) / 2, door['top'] - 0.05, -math.pi / 2 if s_ > 0 else math.pi / 2)
    box('RedPaint', x1 + 0.0, U, door['z'] - door['width'] / 2, x1 + uw / 2, U + door['top'], door['z'] - door['width'] / 2 + 0.02)
    box('RedPaint', x1 + 0.0, U, door['z'] + door['width'] / 2 - 0.02, x1 + uw / 2, U + door['top'], door['z'] + door['width'] / 2)
    add_geom('Frosted', [(x1, U + door['top'] + 0.1, door['z'] - 0.65), (x1, U + door['top'] + 0.1, door['z'] + 0.65), (x1, U + door['top'] + 0.5, door['z'] + 0.65), (x1, U + door['top'] + 0.5, door['z'] - 0.65)], [(0, 1, 2, 3), (3, 2, 1, 0)], kind='detail')
    box('Stucco', x1 + uw / 2, U + door['top'] + 0.65, door['z'] - 1.0, x1 + uw / 2 + 0.25, U + door['top'] + 0.72, door['z'] + 1.0)  # little canopy
    # inside: the wall between the gallery and the bedrooms (two doors), the one between them
    for w in L['HOUSE_WALLS']:
        if w.get('level') != 1: continue
        box('Plaster', w['x'] - w['w'] / 2, U, w['z'] - w['d'] / 2, w['x'] + w['w'] / 2, W, w['z'] + w['d'] / 2)
    for p in L['PORTALS']:
        if p.get('level') != 1: continue
        hw = p['w'] / 2
        box('Plaster', p['x'] - hw, p['top'], p['z'] - IW / 2, p['x'] + hw, W, p['z'] + IW / 2)
        frame_casing(p['x'], p['z'], 0, 1, p['w'], U, p['top'], IW)
        for s_ in (-1, 1):
            place_leaf('panel', (p['x'] + s_ * (p['w'] / 2 - 0.05), U, p['z'] + IW / 2 + 0.03), (p['w'] - 0.1) / 2, p['top'] - U - 0.05, 0.0 if s_ > 0 else math.pi)
    # floors: honey tiles in the rooms, framed by the border; the loggia in terracotta
    for r in L['ROOMS']:
        if r.get('level') != 1: continue
        quad_floor('FloorTile', r['x0'], r['z0'], r['x1'], r['z1'], U + 0.003)
        if r['id'] != 'gallery': band(r['x0'] + 0.55, r['z0'] + 0.55, r['x1'] - 0.55, r['z1'] - 0.55, y=U + 0.005)
    quad_floor('Terracotta', x0 + 0.12, z1 + 0.1, x1 + 0.12, lz - 0.4, U + 0.003)
    # skirting in the rooms
    for r in L['ROOMS']:
        if r.get('level') != 1: continue
        for (a, b, c, ax, n) in ((r['x0'] + 0.13, r['x1'] - 0.13, r['z0'] + 0.13, 'z', 1), (r['x0'] + 0.13, r['x1'] - 0.13, r['z1'] - 0.11, 'z', -1)):
            box('Skirting', a, U, c - (0.012 if n < 0 else 0), b, U + 0.1, c + (0.012 if n > 0 else 0))
    # ceiling, with the round skylight over the stair and a cornice
    S = L['STAIR']
    quad_ceiling('Ceiling', x0, z0, x1, z1, W)
    cx, cz = (S['x0'] + S['x1']) / 2 + 1.0, (S['z0'] - 7.25) / 2
    add_geom('Skylight', [(cx + math.cos(a) * 0.8, W - 0.02, cz + math.sin(a) * 0.8) for a in [2 * math.pi * k / 28 for k in range(28)]], [tuple(range(28))], kind='detail')
    lathe('Plaster', cx, W - 0.12, cz, [(0.8, 0.0), (0.95, 0.12)], seg=28, kind='lit')
    # the roof up top: cornice, parapet, the white dome over the skylight, a black water tank
    box('Stucco', x0 - 0.3, W, z0 - 0.3, x1 + 0.3, W + 0.16, lz + 0.15)
    for (a, b, c, d) in ((x0 - 0.12, z0 - 0.12, x1 + 0.12, z0 + 0.1), (x0 - 0.12, lz - 0.2, x1 + 0.12, lz + 0.05), (x0 - 0.12, z0 - 0.12, x0 + 0.1, lz), (x1 - 0.1, z0 - 0.12, x1 + 0.12, lz)):
        box('Stucco', a, W + 0.16, b, c, W + 0.7, d)
    lathe('Stucco', cx, W + 0.16, cz, [(1.05, 0), (1.0, 0.2), (0.85, 0.5), (0.6, 0.75), (0.3, 0.9), (0.0, 0.95)], seg=24, kind='lit')
    lathe('BlackPlastic', -4.6, W + 0.16, -3.6, [(0.0, 0.0), (0.55, 0.0), (0.6, 0.05), (0.6, 1.0), (0.5, 1.15), (0.2, 1.22), (0.2, 1.3), (0.0, 1.3)], seg=20, kind='lit')
    box('Stucco', -5.3, W + 0.16, -4.3, -3.9, W + 0.3, -2.9)
    # the loggia: three arches on piers over a balustrade, its ceiling, open at the east end
    lz0, lz1 = z1, lz
    box('Stucco', x0 - 0.3, W - 0.3, lz0, x1 + 0.3, W, lz1)
    box('Stucco', x1 - 0.2, U, lz1 - 0.4, x1 + 0.125, W, lz1)
    w_ = (x1 + 0.125) - (x0 - 0.125) - 0.8
    cols = [x0 - 0.125 + 0.4 + w_ * k / 3 for k in range(4)]
    for k in range(1, 3): box('Stucco', cols[k] - 0.2, U, lz1 - 0.4, cols[k] + 0.2, U + 2.2, lz1)
    box('Stucco', x0 - 0.125, U, lz1 - 0.4, cols[0], W, lz1)
    for k in range(3):
        a, b = cols[k] + (0.2 if k else 0), cols[k + 1] - (0.2 if k < 2 else 0)
        arch_block('Stucco', a, b, lz1 - 0.2, 0.4, U + 2.2, 0.55, W - 0.3, True)
        n = int((b - a) / 0.2)
        for i in range(n):
            xx = a + 0.1 + i * ((b - a - 0.2) / max(1, n - 1))
            lathe('Stucco', xx, U + 0.1, lz1 - 0.2, [(0.06, 0), (0.06, 0.05), (0.04, 0.1), (0.07, 0.3), (0.035, 0.5), (0.055, 0.56), (0.055, 0.62)], seg=8)
        box('Stucco', a, U + 0.72, lz1 - 0.32, b, U + 0.84, lz1 - 0.08)
        box('Stucco', a, U, lz1 - 0.32, b, U + 0.1, lz1 - 0.08)
    # the railing round the stairwell: iron balusters and a mahogany handrail
    with detail():
        hz, hx0, hx1 = -7.25, S['x0'] - 0.05, S['x1']
        for (ax, az, bx, bz) in ((hx0, hz, hx1, hz), (hx0, S['z0'], hx0, hz)):
            L_ = math.hypot(bx - ax, bz - az); n = int(L_ / 0.13)
            for i in range(n + 1):
                px, pz = ax + (bx - ax) * i / n, az + (bz - az) * i / n
                cyl('Iron', px, U, pz, 0.012, 0.92, seg=6, cap=False)
                lathe('Iron', px, U + 0.4, pz, [(0.012, 0), (0.025, 0.02), (0.027, 0.05), (0.025, 0.08), (0.012, 0.1)], seg=8)
            if az == bz: box('Mahogany', ax, U + 0.92, az - 0.04, bx, U + 0.98, az + 0.04)
            else: box('Mahogany', ax - 0.04, U + 0.92, az, ax + 0.04, U + 0.98, bz)
        box('Iron', hx0 - 0.04, U, hz - 0.04, hx0 + 0.04, U + 1.05, hz + 0.04)
    # the outside stair: solid masonry, terracotta treads, a low wall up the open side
    E = L['EXT_STAIR']
    n = E['steps']; run = (E['x1'] - E['x0']) / n; rise = E['rise'] / (n + 1)
    for i in range(n):
        xa, xb = E['x0'] + i * run, E['x0'] + (i + 1) * run
        ya = rise * (i + 1)
        box('Stucco', xa, 0, E['z0'], xb + 0.001, ya - 0.03, E['z1'], skip=('+y',))
        box('Terracotta', xa - 0.02, ya - 0.03, E['z0'], xb, ya, E['z1'])
        box('Stucco', xa, 0, E['z0'] - 0.14, xb + 0.001, ya + 0.9, E['z0'])
        box('Stucco', xa - 0.01, ya + 0.9, E['z0'] - 0.16, xb + 0.011, ya + 0.96, E['z0'] + 0.02)
    box('Stucco', E['x1'], 0, E['z0'], E['landingX'], U - 0.03, E['z1'])
    box('Terracotta', E['x1'], U - 0.03, E['z0'], E['landingX'], U + 0.003, E['z1'] + 0.15)
    box('Stucco', E['x1'], 0, E['z0'] - 0.14, E['landingX'] + 0.14, U + 0.92, E['z0'])
    box('Stucco', E['landingX'], 0, E['z0'] - 0.14, E['landingX'] + 0.14, U + 0.92, E['z1'] + 0.22)
    box('Stucco', E['x1'] - 0.02, U + 0.92, E['z0'] - 0.16, E['landingX'] + 0.16, U + 0.98, E['z0'] + 0.02)
    build_upstairs_rooms()


def bed(x, z, w, d, y, double=True, yaw=0.0):
    """a carved mahogany bed: headboard, footboard, mattress, white sheets, pillows, a blanket"""
    def fn():
        hb = 1.25 if double else 1.0
        box('Mahogany', -w / 2, 0, -d / 2, w / 2, hb, -d / 2 + 0.07)
        for k in range(5 if double else 3):   # carved panels on the headboard
            u = -w / 2 + 0.15 + k * (w - 0.3) / (4 if double else 2)
            box('Mahogany', u - 0.1, 0.55, -d / 2 + 0.07, u + 0.1, hb - 0.15, -d / 2 + 0.085)
        lathe('Mahogany', -w / 2 + 0.05, hb, -d / 2 + 0.035, [(0.05, 0), (0.06, 0.06), (0.0, 0.14)], seg=8)
        lathe('Mahogany', w / 2 - 0.05, hb, -d / 2 + 0.035, [(0.05, 0), (0.06, 0.06), (0.0, 0.14)], seg=8)
        box('Mahogany', -w / 2, 0, d / 2 - 0.06, w / 2, 0.6, d / 2)
        box('Mahogany', -w / 2, 0.15, -d / 2, -w / 2 + 0.05, 0.38, d / 2)
        box('Mahogany', w / 2 - 0.05, 0.15, -d / 2, w / 2, 0.38, d / 2)
        box('Paper', -w / 2 + 0.04, 0.38, -d / 2 + 0.07, w / 2 - 0.04, 0.58, d / 2 - 0.06)   # sheets
        box('Blanket', -w / 2 + 0.02, 0.5, -d / 2 + 0.75, w / 2 - 0.02, 0.6, d / 2 - 0.05)
        for k in range(2 if double else 1):
            u = (-w / 4 if k == 0 else w / 4) if double else 0
            sphere('Paper', u, 0.65, -d / 2 + 0.3, 0.3 if double else 0.32, seg=10, rings=6, sy=0.25)
    transformed(fn, (x, y, z), yaw)


def build_upstairs_rooms():
    U = L['UPPER']['y']
    F = {f['kind'] + str(i): f for i, f in enumerate(L['UPPER_FURNITURE'])}
    with detail():
        beds = [f for f in L['UPPER_FURNITURE'] if f['kind'] == 'bed']
        for k, b in enumerate(beds):
            bed(b['x'], b['z'], b['w'], b['d'], U, double=k == 0, yaw=math.pi)
        # nightstands with lamps beside the big bed, a crucifix and the wedding photo over it
        bb = beds[0]
        for s_ in (-1, 1):
            nx_ = bb['x'] + s_ * (bb['w'] / 2 + 0.3)
            box('Mahogany', nx_ - 0.22, U, bb['z'] + bb['d'] / 2 - 0.42, nx_ + 0.22, U + 0.55, bb['z'] + bb['d'] / 2)
            lathe('Ceramic', nx_, U + 0.55, bb['z'] + bb['d'] / 2 - 0.2, [(0.07, 0), (0.09, 0.08), (0.05, 0.25), (0.015, 0.3)], seg=12)
            lathe('Shade', nx_, U + 0.78, bb['z'] + bb['d'] / 2 - 0.2, [(0.15, 0.0), (0.1, 0.2)], seg=14)
        zb = L['UPPER']['z1'] - 0.1
        cross(bb['x'], U + 1.9, zb, 0, -1, 0.4)
        photo('family', bb['x'] - 1.4, U + 1.7, zb, 0, -1, 0.7, 0.34, 'Gilt')
        photo('sepia_rafael', bb['x'] + 1.3, U + 1.65, zb, 0, -1, 0.32, 0.4, 'Gilt')
        # wardrobes, the dresser with its mirror, the chest in the gallery
        for f in L['UPPER_FURNITURE']:
            x0_, x1_, z0_, z1_ = f['x'] - f['w'] / 2, f['x'] + f['w'] / 2, f['z'] - f['d'] / 2, f['z'] + f['d'] / 2
            if f['kind'] == 'wardrobe':
                box('Mahogany', x0_, U, z0_, x1_, U + f['h'], z1_)
                box('Mahogany', x0_ - 0.04, U + f['h'], z0_ - 0.04, x1_ + 0.04, U + f['h'] + 0.08, z1_ + 0.04)
                face = 1 if f['x'] < 0 else -1
                xf = x1_ if face > 0 else x0_
                for k in range(2):
                    za, zb_ = z0_ + 0.05 + k * (f['d'] - 0.1) / 2, z0_ + 0.05 + (k + 1) * (f['d'] - 0.1) / 2 - 0.02
                    box('Mahogany', xf, U + 0.1, za, xf + face * 0.015, U + f['h'] - 0.1, zb_)
                    box('Mahogany', xf + face * 0.015, U + 0.3, za + 0.08, xf + face * 0.025, U + f['h'] - 0.3, zb_ - 0.08)
                    box('Brass', xf + face * 0.025, U + 1.0, (zb_ if k == 0 else za) - 0.04 * (1 if k == 0 else -1) - 0.01, xf + face * 0.045, U + 1.15, (zb_ if k == 0 else za) - 0.04 * (1 if k == 0 else -1) + 0.01)
            elif f['kind'] == 'dresser':
                box('Mahogany', x0_, U, z0_, x1_, U + f['h'], z1_)
                for k in range(3): box('Mahogany', x0_ + 0.05, U + 0.08 + k * 0.25, z1_, x1_ - 0.05, U + 0.3 + k * 0.25, z1_ + 0.015)
                box('Mirror', f['x'] - 0.45, U + f['h'] + 0.15, z0_ + 0.02, f['x'] + 0.45, U + f['h'] + 1.05, z0_ + 0.04)
                box('Gilt', f['x'] - 0.5, U + f['h'] + 0.1, z0_, f['x'] + 0.5, U + f['h'] + 1.1, z0_ + 0.02)
                for k in range(3): bottle(f['x'] - 0.4 + k * 0.12, U + f['h'], f['z'], ['PinkGlass', 'Glass', 'Gilt'][k], 0.15, 0.03, 'Gilt')
                lathe('Weave', f['x'] + 0.35, U + f['h'], f['z'], [(0.0, 0.0), (0.12, 0.0), (0.13, 0.05)], seg=12)
                standing_frame('photo_tere', f['x'] + 0.1, U + f['h'], f['z'] + 0.05, math.pi)
            elif f['kind'] == 'chest':
                box('Mahogany', x0_, U, z0_, x1_, U + f['h'], z1_)
                box('Mahogany', x0_ - 0.02, U + f['h'] - 0.06, z0_ - 0.02, x1_ + 0.02, U + f['h'], z1_ + 0.02)
                for k in range(3): box('Iron', x0_ + 0.02 + 0.0, U + 0.1, z0_ + 0.1 + k * (f['d'] - 0.2) / 2, x1_ + 0.01, U + 0.12, z0_ + 0.14 + k * (f['d'] - 0.2) / 2)
                lathe('Talavera', f['x'], U + f['h'], f['z'] + 0.25, [(0.0, 0.0), (0.08, 0.0), (0.12, 0.12), (0.06, 0.3), (0.07, 0.34)], seg=14)
        # the rugs by the beds, a cross and the Madonna in the gallery
        quad_floor('Oriental', bb['x'] - 1.3, bb['z'] - bb['d'] / 2 - 1.2, bb['x'] + 1.3, bb['z'] - bb['d'] / 2 - 0.1, U + 0.008, uvs=[(0, 0), (0, 1), (1, 1), (1, 0)])
        quad_floor('Placemat', 0.6, -3.6, 2.4, -3.1, U + 0.008, uvs=[(0, 0), (0, 1), (1, 1), (1, 0)])
        cross(-6.88, U + 1.8, -6.0, 1, 0, 0.32)
        pic('virgin2', mt('painting_virgin.jpg'), 3.85, U + 1.7, -7.8, -1, 0, 0.42, 0.58, 'Gilt', 0.06, 0.04)
        photo('photo_troy', 3.85, U + 1.6, -6.0 + 0.0 if False else -4.9, -1, 0, 0.3, 0.38, 'DarkWood') if False else None
        # the loggia: a striped hammock between the piers, two equipal chairs, plants
        lzc = (L['UPPER']['z1'] + L['UPPER']['loggiaZ']) / 2
        ha, hb_ = -6.6, -3.6
        pts = []
        for k in range(17):
            t = k / 16
            pts.append((ha + (hb_ - ha) * t, U + 1.6 - math.sin(t * math.pi) * 0.9, lzc))
        for dz in (-0.35, -0.2, 0.0, 0.2, 0.35):
            tube('Blanket', [(p[0], p[1] - 0.05 * (1 - abs(dz) / 0.35), p[2] + dz * math.sin(i / 16 * math.pi)) for i, p in enumerate(pts)], 0.04, seg=4)
        for x_ in (ha, hb_): tube('Wood', [(x_, U + 1.6, lzc), (x_ + (0.3 if x_ == ha else -0.3), U + 1.75, lzc)], 0.01, seg=4)
        for (cx_, yaw) in ((0.6, 2.8), (2.2, 3.5)):
            def chair():
                lathe('Leather', 0, 0.38, 0, [(0.0, 0.0), (0.3, 0.0), (0.3, 0.06), (0.0, 0.07)], seg=16)
                for k in range(13):
                    a = math.pi * 0.15 + k / 12 * math.pi * 1.7
                    tube('Weave', [(math.cos(a) * 0.3, 0.0, math.sin(a) * 0.3 - 0.02), (math.cos(a) * 0.33, 0.4, math.sin(a) * 0.33), (math.cos(a) * 0.36, 0.78, math.sin(a) * 0.36)], 0.018, seg=5)
                tube('Weave', [(math.cos(a) * 0.36, 0.78, math.sin(a) * 0.36) for a in [math.pi * 0.15 + t / 20 * math.pi * 1.7 for t in range(21)]], 0.035, seg=6)
            transformed(chair, (cx_, U, lzc - 0.1), yaw)
        # up on the roof terrace: potted bougainvillea, a clothesline, the satellite dish
        for (px, pz) in ((5.0, 3.2), (10.3, 3.2), (10.3, -2.0), (5.0, -8.3)):
            lathe('Terracotta', px, U, pz, [(0.0, 0.0), (0.18, 0.0), (0.24, 0.4), (0.26, 0.42)], seg=14)
            for k in range(26):   # bougainvillea: arching green stems with magenta bracts
                a = k * 2.399; r_ = 0.05 + (k % 5) * 0.06; hgt = 0.5 + (k % 7) * 0.09
                tip = (px + math.cos(a) * (r_ + 0.25), U + hgt + 0.25, pz + math.sin(a) * (r_ + 0.25))
                tube('LeafGreen', [(px, U + 0.35, pz), (px + math.cos(a) * r_, U + hgt, pz + math.sin(a) * r_), tip], 0.006, seg=3)
                sphere('LeafGreen' if k % 3 == 0 else 'Bougainvillea', tip[0], tip[1], tip[2], 0.055, seg=6, rings=4)
        for x_ in (6.0, 9.5):
            cyl('Steel', x_, U, -4.8, 0.02, 1.7, seg=6)
        tube('WhitePlastic', [(6.0, U + 1.65, -4.8), (7.75, U + 1.55, -4.8), (9.5, U + 1.65, -4.8)], 0.004, seg=4)
        for k, m_ in enumerate(('Curtain', 'Blanket', 'Paper', 'Denim')):
            xx = 6.5 + k * 0.75
            add_geom(m_, [(xx, U + 1.0, -4.8), (xx + 0.5, U + 1.0, -4.8), (xx + 0.5, U + 1.58, -4.8), (xx, U + 1.58, -4.8)], [(0, 1, 2, 3), (3, 2, 1, 0)])
        lathe('WhitePlastic', 10.5, U, -8.4, [(0.0, 0.0), (0.05, 0.0), (0.04, 0.8)], seg=8)
        sphere('WhitePlastic', 10.4, U + 0.9, -8.3, 0.3, seg=12, rings=6, sy=0.35)


def shed(c, base=None):
    """a sloping roof of clay tiles over four corners (high edge first), with a fascia and
    plastered ends closing the triangle under it down to `base`"""
    a, b, cc, d = c
    if base is not None:
        for (hi_, lo_) in ((a, d), (b, cc)):
            add_geom('Stucco', [(hi_[0], base, hi_[2]), (lo_[0], base, lo_[2]), (lo_[0], lo_[1], lo_[2]), (hi_[0], hi_[1], hi_[2])], [(0, 1, 2, 3), (3, 2, 1, 0)])
    across = math.dist((a[0], a[2]), (b[0], b[2])); down = math.dist(a, d)
    s = 2.2
    add_geom('RoofTile', [a, b, cc, d], [(0, 3, 2, 1)], [[(0, down / s), (0, 0), (across / s, 0), (across / s, down / s)]])
    add_geom('Plaster', [a, b, cc, d], [(0, 1, 2, 3)])   # underside
    # fascia board along the low edge
    if abs(cc[0] - d[0]) > abs(cc[2] - d[2]): box('DarkWood', min(cc[0], d[0]), cc[1] - 0.18, cc[2] - 0.06, max(cc[0], d[0]), cc[1] + 0.02, cc[2] + 0.06)
    else: box('DarkWood', cc[0] - 0.06, cc[1] - 0.18, min(cc[2], d[2]), cc[0] + 0.06, cc[1] + 0.02, max(cc[2], d[2]))


def build_veranda():
    v = L['veranda']
    VZ = L['VERANDA']['z']
    x0, x1, z0, z1 = v['x'] - v['w'] / 2, v['x'] + v['w'] / 2, v['z'] - v['d'] / 2, v['z'] + v['d'] / 2
    box('Terracotta', x0, 0, z0, x1, v['h'], z1)
    box('Plinth', x0 - 0.02, 0, z1 - 0.02, x1 + 0.02, v['h'] - 0.03, z1 + 0.02)
    colH = 3.15
    for c in L['VERANDA']['columns']:
        box('Stucco', c['x'] - 0.2, v['h'], c['z'] - 0.2, c['x'] + 0.2, colH, c['z'] + 0.2)
        box('Stucco', c['x'] - 0.27, v['h'], c['z'] - 0.27, c['x'] + 0.27, v['h'] + 0.32, c['z'] + 0.27)
        box('Stucco', c['x'] - 0.27, colH - 0.16, c['z'] - 0.27, c['x'] + 0.27, colH, c['z'] + 0.27)
    # iron railing: balusters with collars, top and bottom rails
    for r in L['VERANDA']['rails']:
        a, b = r['x'] - r['w'] / 2 + 0.25, r['x'] + r['w'] / 2 - 0.25
        box('Iron', a, v['h'] + 0.98, VZ - 0.035, b, v['h'] + 1.04, VZ + 0.035)
        box('Iron', a, v['h'] + 0.12, VZ - 0.02, b, v['h'] + 0.16, VZ + 0.02)
        x = a
        while x < b:
            cyl('Iron', x, v['h'] + 0.12, VZ, 0.012, 0.88, seg=6, cap=False)
            lathe('Iron', x, v['h'] + 0.5, VZ, [(0.012, 0), (0.026, 0.02), (0.028, 0.05), (0.026, 0.08), (0.012, 0.1)], seg=8)
            x += 0.15
    # the roof: tiles over dark rafters, sloping from the house wall down to the column beam
    top_w = WH + 0.22
    low = colH + 0.25
    depth = VZ - Z1 + 0.65
    zA, zB = Z1 + T / 2, VZ + 0.65
    add_geom('RoofTile', [(x0 - 0.3, top_w + 0.12, zA), (x1 + 0.3, top_w + 0.12, zA), (x1 + 0.3, low + 0.12, zB), (x0 - 0.3, low + 0.12, zB)], [(0, 3, 2, 1)],
             [[(0, depth / 2.2), (0, 0), ((x1 - x0 + 0.6) / 2.2, 0), ((x1 - x0 + 0.6) / 2.2, depth / 2.2)]])
    add_geom('Terracotta', [(x0 - 0.3, top_w, zA), (x1 + 0.3, top_w, zA), (x1 + 0.3, low, zB), (x0 - 0.3, low, zB)], [(0, 1, 2, 3)])
    x = x0
    while x <= x1 + 0.01:
        # rafters: dark beams under the boards
        vs = [(x - 0.05, top_w - 0.16, zA), (x + 0.05, top_w - 0.16, zA), (x + 0.05, low - 0.16, zB), (x - 0.05, low - 0.16, zB),
              (x - 0.05, top_w, zA), (x + 0.05, top_w, zA), (x + 0.05, low, zB), (x - 0.05, low, zB)]
        add_geom('DarkWood', vs, [(0, 1, 2, 3), (0, 3, 7, 4), (1, 5, 6, 2)])
        x += 0.9
    box('DarkWood', x0 - 0.3, colH, VZ - 0.17, x1 + 0.3, low, VZ + 0.17)   # beam along the columns
    box('DarkWood', x0 - 0.3, low - 0.05, zB - 0.06, x1 + 0.3, low + 0.18, zB)  # fascia
    # curved front steps down to the path
    for r_, h_ in ((2.0, 0.09), (1.55, 0.18)):
        pts = [(math.cos(a) * r_, math.sin(a) * r_) for a in [math.pi * k / 24 for k in range(25)]]
        prism('Terracotta', [(p[0], VZ + 0.25 + p[1] * 1.0) for p in pts], 0, h_)


# ---------------------------------------------------------------- output
def finish_objects(split=False):
    lit_, det = [], []
    for (kind, name), b in BUCKETS.items():
        if not b.bm.faces: continue
        me = bpy.data.meshes.new(name)
        b.bm.to_mesh(me)
        me.materials.append(MATS[name])
        o = bpy.data.objects.new(name, me)
        scene.collection.objects.link(o)
        # glass and the glowing shades never take the light map
        (det if kind == 'detail' or name in ('Glass', 'Frosted', 'GlassShade', 'Skylight', 'PinkGlass', 'Mirror') else lit_).append(o)
    BUCKETS.clear()
    return (lit_, det) if split else lit_ + det


def build_dynamic():
    out = []
    for name, fn, origin in DYNAMIC:
        fn()
        for mname, b in list(BUCKETS.items()):
            pass
        sub = finish_objects()
        if not sub: continue
        # join this node's per-material pieces into one object with several materials
        bpy.ops.object.select_all(action='DESELECT')
        for o in sub: o.select_set(True)
        bpy.context.view_layer.objects.active = sub[0]
        if len(sub) > 1: bpy.ops.object.join()
        o = bpy.context.view_layer.objects.active
        o.name = name
        o.location = V(*origin)
        out.append(o)
    return out


# ---------------------------------------------------------------- furniture and details
def paint_textures():
    """posters, certificate and blanket stripes for the office (drawn here, like the real ones)"""
    from PIL import Image, ImageDraw, ImageFont
    def font(sz, bold=True):
        for f in ('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf' if bold else '/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'):
            try: return ImageFont.truetype(f, sz)
            except Exception: pass
        return ImageFont.load_default()
    out = {}
    # Brahman expo poster: black with orange and white lettering, a bull's head in a ring
    im = Image.new('RGB', (360, 520), (16, 16, 18)); d = ImageDraw.Draw(im)
    d.rectangle([0, 0, 360, 40], fill=(232, 140, 30)); d.rectangle([0, 480, 360, 520], fill=(232, 140, 30))
    d.text((180, 78), 'EXPO', font=font(40), fill=(245, 245, 240), anchor='mm')
    d.text((180, 122), 'TABASCO', font=font(44), fill=(232, 140, 30), anchor='mm')
    d.ellipse([105, 160, 255, 310], outline=(232, 140, 30), width=6)
    d.polygon([(150, 205), (210, 205), (200, 280), (160, 280)], fill=(200, 196, 188))       # bull's face
    d.polygon([(150, 205), (118, 190), (128, 214)], fill=(200, 196, 188)); d.polygon([(210, 205), (242, 190), (232, 214)], fill=(200, 196, 188))
    d.text((180, 350), 'BRAHMAN', font=font(46), fill=(245, 245, 240), anchor='mm')
    d.text((180, 400), 'GANADO DE REGISTRO', font=font(20), fill=(232, 140, 30), anchor='mm')
    d.text((180, 440), 'JUZGAMIENTO NACIONAL', font=font(18), fill=(200, 200, 200), anchor='mm')
    im.save(os.path.join(MTEX, 'poster_brahman.png')); out['poster'] = os.path.join(MTEX, 'poster_brahman.png')
    # framed certificate
    im = Image.new('RGB', (360, 460), (240, 236, 224)); d = ImageDraw.Draw(im)
    d.rectangle([14, 14, 346, 446], outline=(40, 40, 40), width=3)
    d.text((180, 60), 'ROMANCE', font=font(42, False), fill=(20, 20, 20), anchor='mm')
    d.text((180, 100), 'del Ganadero', font=font(22, False), fill=(60, 60, 60), anchor='mm')
    for i in range(14): d.line([(60, 140 + i * 20), (300 - (i % 3) * 25, 140 + i * 20)], fill=(90, 90, 90), width=2)
    im.save(os.path.join(MTEX, 'certificate.png')); out['cert'] = os.path.join(MTEX, 'certificate.png')
    # saddle blanket: red, green and white stripes
    im = Image.new('RGB', (256, 256), (190, 30, 50)); d = ImageDraw.Draw(im)
    for i, c in enumerate([(30, 120, 70), (240, 236, 220), (190, 30, 50), (30, 60, 130), (240, 200, 60), (190, 30, 50)]):
        d.rectangle([0, i * 42, 256, i * 42 + 16], fill=c)
    im.save(os.path.join(MTEX, 'blanket.png')); out['blanket'] = os.path.join(MTEX, 'blanket.png')
    # embroidered pink cushions on the bar room chairs
    im = Image.new('RGB', (128, 128), (214, 40, 120)); d = ImageDraw.Draw(im)
    for i in range(10):
        x, y = rnd.randint(10, 118), rnd.randint(10, 118)
        d.ellipse([x - 9, y - 9, x + 9, y + 9], fill=rnd.choice([(250, 170, 40), (60, 170, 220), (120, 40, 160), (250, 90, 40)]))
    im.save(os.path.join(MTEX, 'cushion.png')); out['cushion'] = os.path.join(MTEX, 'cushion.png')
    # family photos: head-and-shoulders from the game's own pictures of each of them, some
    # printed in old-photo sepia, and a group picture of all six
    from PIL import ImageOps, ImageEnhance
    thumbs = os.path.join(ROOT, 'client/public/assets/models/people/thumbs')
    heads = {}
    for pid, who in (('p1', 'troy'), ('p2', 'maria'), ('p4', 'rafael'), ('p6', 'rafa'), ('p7', 'julio'), ('p8', 'tere')):
        f = os.path.join(thumbs, pid + '.jpg')
        if not os.path.exists(f): continue
        im = Image.open(f).convert('RGB')
        W_, H_ = im.size
        head = im.crop((int(W_ * 0.18), 0, int(W_ * 0.82), int(H_ * 0.62))).resize((256, 320), Image.LANCZOS)
        heads[who] = head
        warm = ImageEnhance.Color(head).enhance(1.1)
        warm.save(os.path.join(MTEX, f'photo_{who}.jpg'), quality=88); out['photo_' + who] = os.path.join(MTEX, f'photo_{who}.jpg')
        sep = ImageOps.colorize(ImageOps.grayscale(head), (48, 32, 20), (238, 222, 190))
        sep.save(os.path.join(MTEX, f'sepia_{who}.jpg'), quality=88); out['sepia_' + who] = os.path.join(MTEX, f'sepia_{who}.jpg')
    if heads:
        g = Image.new('RGB', (900, 420), (196, 184, 160))
        dg = ImageDraw.Draw(g)
        dg.rectangle([0, 300, 900, 420], fill=(120, 150, 90))     # standing on the lawn
        order = ['rafael', 'tere', 'troy', 'maria', 'rafa', 'julio']
        for i, who in enumerate(order):
            if who not in heads: continue
            hh = heads[who].resize((150, 188))
            g.paste(hh, (i * 150, 70 + (i % 2) * 18))
        g = ImageEnhance.Color(g).enhance(0.85)
        g.save(os.path.join(MTEX, 'photo_family.jpg'), quality=88); out['family'] = os.path.join(MTEX, 'photo_family.jpg')
    return out


PT = paint_textures()
mat('Leather', color=(0.30, 0.15, 0.07), rough=0.5)
mat('RedLeather', color=(0.42, 0.08, 0.06), rough=0.45)
mat('Straw', color=(0.78, 0.64, 0.4), rough=0.85)
mat('Weave', color=(0.45, 0.3, 0.16), rough=0.85)
mat('Cushion', rough=0.9, tex=PT['cushion'], scale=0.4)
mat('Curtain', color=(0.96, 0.82, 0.36), rough=0.95)
mat('Blanket', rough=0.95, tex=PT['blanket'], scale=0.6)
mat('Placemat', rough=0.9, tex=mt('placemat.png'), scale=0.5)
mat('Oriental', rough=0.95, tex=mt('oriental.png'), scale=1.0)
mat('Bronze', color=(0.42, 0.27, 0.13), rough=0.4, metal=0.85)
mat('Shade', color=(0.72, 0.56, 0.38), rough=0.9)
mat('GlassShade', color=(0.97, 0.95, 0.9), rough=0.4, alpha=0.88, emit=((1.0, 0.85, 0.6), 0.6))
mat('FlowerRed', color=(0.8, 0.07, 0.05), rough=0.6)
mat('FlowerOrange', color=(0.95, 0.42, 0.05), rough=0.6)
mat('LeafGreen', color=(0.12, 0.32, 0.08), rough=0.7)
mat('Pampas', color=(0.9, 0.85, 0.74), rough=0.95)
mat('Fruit', color=(0.95, 0.55, 0.1), rough=0.5)
mat('Lime', color=(0.35, 0.6, 0.1), rough=0.5)
mat('Mat', color=(0.24, 0.2, 0.16), rough=1.0)
mat('Paper', color=(0.93, 0.92, 0.88), rough=0.9)
mat('Saint', color=(0.55, 0.12, 0.12), rough=0.5)
mat('SaintBlue', color=(0.15, 0.25, 0.55), rough=0.5)
mat('Skin', color=(0.85, 0.65, 0.5), rough=0.6)
mat('PinkGlass', color=(0.75, 0.35, 0.4), rough=0.1, alpha=0.5)
mat('Ceramic', color=(0.86, 0.82, 0.74), rough=0.35)
mat('Talavera', color=(0.2, 0.32, 0.65), rough=0.3)
mat('Wood', color=(0.55, 0.36, 0.2), rough=0.6)
mat('Bread', color=(0.85, 0.66, 0.38), rough=0.8)
mat('Beans', color=(0.32, 0.16, 0.1), rough=0.7)
mat('Rice', color=(0.92, 0.9, 0.84), rough=0.9)
mat('Sauce', color=(0.75, 0.08, 0.03), rough=0.2)
mat('Yellow', color=(0.95, 0.75, 0.1), rough=0.5)
mat('GreenPlastic', color=(0.15, 0.55, 0.25), rough=0.35)
mat('BluePlastic', color=(0.12, 0.3, 0.7), rough=0.35)
mat('RedPlastic', color=(0.75, 0.08, 0.06), rough=0.35)
mat('Magazine', color=(0.75, 0.62, 0.45), rough=0.6)
mat('Denim', color=(0.17, 0.24, 0.38), rough=0.9)
mat('GreenGlaze', color=(0.12, 0.3, 0.2), rough=0.15)
mat('Bougainvillea', color=(0.75, 0.05, 0.4), rough=0.7)
mat('SageGreen', color=(0.36, 0.5, 0.42), rough=0.55)
mat('NaturalWood', color=(0.72, 0.6, 0.42), rough=0.55)


def pic(name, file, cx, cy, cz, nx, nz, w, h, frame='Gilt', fw=0.07, fd=0.04, liner=None):
    """a framed picture hung on a wall facing (nx, nz)"""
    m = mat('Pic_' + name, rough=0.55, tex=file)
    rx, rz = nz, -nx
    def P(u, v, d): return (cx + rx * u + nx * d, cy + v, cz + rz * u + nz * d)
    add_geom(m, [P(-w / 2, -h / 2, fd * 0.6), P(w / 2, -h / 2, fd * 0.6), P(w / 2, h / 2, fd * 0.6), P(-w / 2, h / 2, fd * 0.6)], [(0, 1, 2, 3)], [[(0, 0), (1, 0), (1, 1), (0, 1)]])
    for (u0, v0, u1, v1) in ((-w / 2 - fw, h / 2, w / 2 + fw, h / 2 + fw), (-w / 2 - fw, -h / 2 - fw, w / 2 + fw, -h / 2), (-w / 2 - fw, -h / 2, -w / 2, h / 2), (w / 2, -h / 2, w / 2 + fw, h / 2)):
        a, b = P(u0, v0, 0), P(u1, v1, fd)
        box(frame, a[0], a[1], a[2], b[0], b[1], b[2])
    if liner:
        for (u0, v0, u1, v1) in ((-w / 2, h / 2 - 0.02, w / 2, h / 2), (-w / 2, -h / 2, w / 2, -h / 2 + 0.02)):
            a, b = P(u0, v0, fd * 0.6), P(u1, v1, fd * 0.75)
            box(liner, a[0], a[1], a[2], b[0], b[1], b[2])


def wall_box(m, cx, cy, cz, nx, nz, w, h, d, off=0.0):
    """a box w wide x h tall standing d out from a wall that faces (nx, nz), centre (cx, cy, cz) on the wall"""
    if nx == 0: box(m, cx - w / 2, cy - h / 2, cz + nz * off, cx + w / 2, cy + h / 2, cz + nz * (off + d))
    else: box(m, cx + nx * off, cy - h / 2, cz - w / 2, cx + nx * (off + d), cy + h / 2, cz + w / 2)


def ac_unit(cx, cy, cz, nx, nz):
    """a white split air conditioner high on the wall"""
    wall_box('WhitePlastic', cx, cy, cz, nx, nz, 0.92, 0.3, 0.2)
    wall_box('BlackPlastic', cx, cy - 0.12, cz, nx, nz, 0.82, 0.03, 0.205)
    wall_box('WhitePlastic', cx + 0.0, cy - 0.05, cz, nx, nz, 0.8, 0.02, 0.21)


def switch(cx, cy, cz, nx, nz):
    wall_box('WhitePlastic', cx, cy, cz, nx, nz, 0.08, 0.12, 0.012)


def cross(cx, cy, cz, nx, nz, s=0.32):
    wall_box('Iron', cx, cy, cz, nx, nz, s * 0.13, s, 0.025)
    wall_box('Iron', cx, cy + s * 0.18, cz, nx, nz, s * 0.62, s * 0.13, 0.025)
    for du in (-1, 1):  # flared ends
        rx, rz = nz, -nx
        wall_box('Iron', cx + rx * du * s * 0.31, cy + s * 0.18, cz + rz * du * s * 0.31, nx, nz, s * 0.08, s * 0.2, 0.027)
    wall_box('Iron', cx, cy + s * 0.5, cz, nx, nz, s * 0.2, s * 0.08, 0.027)
    wall_box('Iron', cx, cy - s * 0.5, cz, nx, nz, s * 0.2, s * 0.08, 0.027)


def ornate_mirror(cx, cy, cz, nx, nz, w=0.75, h=0.95):
    """gilded mirror with a scalloped, lobed frame"""
    rx, rz = nz, -nx
    n = 64
    outer, inner = [], []
    for k in range(n):
        a = 2 * math.pi * k / n
        lob = 1 + 0.07 * math.cos(6 * a) + 0.05 * math.cos(10 * a + 0.5)
        ex, ey = math.cos(a) * w / 2 * lob, math.sin(a) * h / 2 * lob * (1 + 0.12 * max(0, math.sin(a)) ** 3)
        outer.append((ex, ey)); inner.append((math.cos(a) * w * 0.36, math.sin(a) * h * 0.37))
    def P(u, v, d): return (cx + rx * u + nx * d, cy + v, cz + rz * u + nz * d)
    vs, faces = [], []
    for (u, v), (iu, iv) in zip(outer, inner):
        vs += [P(u, v, 0.01), P(iu, iv, 0.05), P(u, v, 0.04)]
    for k in range(n):
        k2 = (k + 1) % n
        faces.append((3 * k + 2, 3 * k2 + 2, 3 * k2 + 1, 3 * k + 1))
        faces.append((3 * k, 3 * k2, 3 * k2 + 2, 3 * k + 2))
    add_geom('Gilt', vs, faces, smooth=True)
    add_geom('Mirror', [P(u, v, 0.035) for u, v in inner], [tuple(range(n))])


def straw_hat(cx, cy, cz, nx, nz, r=0.24, m='Straw', crown=0.12):
    """a hat hung flat on the wall (brim against the wall, crown out)"""
    def fn():
        lathe(m, 0, 0, 0, [(0.0, 0.0), (r, 0.0), (r, 0.015), (r * 0.5, 0.02), (r * 0.45, crown), (r * 0.3, crown + 0.02), (0.0, crown + 0.02)], seg=20)
    # build lying (crown up along local y), then stand it up against the wall
    before = {k: len(b.bm.verts) for k, b in BUCKETS.items()}
    fn()
    for k, b in BUCKETS.items():
        b.bm.verts.ensure_lookup_table()
        for i in range(before.get(k, 0), len(b.bm.verts)):
            v = b.bm.verts[i]
            x, z, y = v.co.x, -v.co.y, v.co.z
            # local y (out of the brim) -> wall normal; local z -> up
            gx = cx + nx * y + (nz * x if nx == 0 else 0) + (0 if nx == 0 else 0)
            gz = cz + nz * y + (0 if nx == 0 else -nx * x)
            if nx == 0: gx = cx + x
            v.co = V(gx, cy + z, gz)


def iron_scroll_table(w, d, h, top='DarkWood', tt=0.04):
    """wrought-iron table: S-curved legs ending in curls, scroll aprons, wooden top (local coords)"""
    hw, hd = w / 2 - 0.05, d / 2 - 0.05
    for sx in (-1, 1):
        for sz in (-1, 1):
            pts = [(sx * hw, h - 0.03, sz * hd), (sx * (hw + 0.04), h * 0.62, sz * (hd + 0.04)), (sx * (hw - 0.02), h * 0.3, sz * (hd - 0.02)), (sx * (hw + 0.02), 0.07, sz * (hd + 0.02))]
            for k in range(10):
                a = math.pi + k / 9 * 2.4; r = 0.045 * (1 - k / 12)
                pts.append((sx * (hw + 0.03 + math.cos(a) * r * 0.7 + 0.04), 0.05 + math.sin(a) * r, sz * (hd + 0.03 + math.cos(a) * r * 0.7 + 0.04)))
            tube('Iron', pts, 0.012, seg=6)
    for (L_, along) in ((w, True), (d, False)):
        for side in (-1, 1):
            for m_ in (-1, 1):
                pts = []
                for k in range(16):
                    a = k / 15 * 2 * math.pi * 1.1
                    r = 0.05 * (1 - k / 22)
                    u = m_ * (L_ / 2 - 0.1) * 0.55 + math.cos(a) * r * m_
                    v = h - 0.1 + math.sin(a) * r
                    pts.append((u, v, side * hd) if along else (side * hw, v, u))
                tube('Iron', pts, 0.008, seg=5)
    tube('Iron', [(-hw, 0.2, -hd), (0, 0.16, 0), (hw, 0.2, hd)], 0.01, seg=6)
    tube('Iron', [(-hw, 0.2, hd), (0, 0.16, 0), (hw, 0.2, -hd)], 0.01, seg=6)
    box(top, -w / 2, h, -d / 2, w / 2, h + tt, d / 2)


def build_kitchen():
    F = {f['kind'] + str(i): f for i, f in enumerate(L['FURNITURE'])}
    cN = next(f for f in L['FURNITURE'] if f['kind'] == 'counter' and f['w'] > 2)
    cW = next(f for f in L['FURNITURE'] if f['kind'] == 'counter' and f['w'] < 1)
    top = 0.92
    zN = Z0 + T / 2           # north wall face
    xW = X0 + T / 2           # west wall face
    # north run: x from the west wall to its east end, 0.7 deep; west run: down the west wall
    runs = [(cN['x'] - cN['w'] / 2, cN['x'] + cN['w'] / 2, zN, zN + cN['d'], 'N'), (cW['z'] - cW['d'] / 2, cW['z'] + cW['d'] / 2, xW, xW + cW['w'], 'W')]
    for a, b, f0, f1, side in runs:
        # brick carcass with arched openings and mahogany louvered doors in alternate bays
        n = max(2, round((b - a) / 0.8))
        bay = (b - a) / n
        for i in range(n):
            u0, u1 = a + i * bay, a + (i + 1) * bay
            arched = (i % 3 != 1) if side == 'N' else (i != 0)
            if side == 'N':
                box('Brick', u0, FLOOR_Y, f1 - 0.1, u0 + 0.09, top - 0.04, f1)   # pier
                if arched:
                    arch_block('Brick', u0 + 0.09, u1, f1 - 0.05, 0.1, 0.42, 0.18, top - 0.04, True)
                    box('Brick', u0, FLOOR_Y, f0, u1, top - 0.04, f0 + 0.04)             # back of the recess
                    box('Brick', u0, FLOOR_Y, f0, u1, FLOOR_Y + 0.08, f1 - 0.1)         # floor of it
                else:
                    box('Brick', u0 + 0.09, top - 0.2, f1 - 0.1, u1, top - 0.04, f1)
                    for k in range(2):
                        with detail(): transformed(lambda: leaf_geom('louver', (u1 - u0 - 0.1) / 2 - 0.01, top - 0.32, 0.03), (u0 + 0.1 + k * (u1 - u0 - 0.1) / 2, FLOOR_Y + 0.08, f1 + 0.015), 0.0)
            else:
                box('Brick', f1 - 0.1, FLOOR_Y, u0, f1, top - 0.04, u0 + 0.09)
                if arched:
                    arch_block('Brick', u0 + 0.09, u1, f1 - 0.05, 0.1, 0.42, 0.18, top - 0.04, False)
                    box('Brick', f0, FLOOR_Y, u0, f0 + 0.04, top - 0.04, u1)
                    box('Brick', f0, FLOOR_Y, u0, f1 - 0.1, FLOOR_Y + 0.08, u1)
                else:
                    box('Brick', f1 - 0.1, top - 0.2, u0 + 0.09, f1, top - 0.04, u1)
                    for k in range(2):
                        with detail(): transformed(lambda: leaf_geom('louver', (u1 - u0 - 0.1) / 2 - 0.01, top - 0.32, 0.03), (f1 + 0.015, FLOOR_Y + 0.08, u0 + 0.1 + k * (u1 - u0 - 0.1) / 2), -math.pi / 2)
        if side == 'N': box('Brick', b - 0.09, FLOOR_Y, f1 - 0.1, b, top - 0.04, f1)
        else: box('Brick', f1 - 0.1, FLOOR_Y, b - 0.09, f1, top - 0.04, b)
        # granite top with a rounded front edge (overhang), stone backsplash up the wall
        if side == 'N':
            box('Granite', a, top - 0.04, f0, b, top, f1 + 0.04)
            cyl_edge = [(u, top - 0.02, f1 + 0.04) for u in (a, b)]
            box('StoneSlab', a, top, f0, b, top + 0.62, f0 + 0.02)
        else:
            box('Granite', f0, top - 0.04, a, f1 + 0.04, top, b)
            box('StoneSlab', f0, top, a, f0 + 0.02, top + 0.62, b)
    # the brick hood over the stove in the corner, with its band of blue-and-white tiles
    hx = cN['x'] - cN['w'] / 2 + 1.05
    y0 = 1.92
    prof = [(0.95, 0.0), (0.95, 0.14), (0.99, 0.15), (0.99, 0.19), (0.9, 0.21), (0.66, 0.85), (0.44, 1.5), (0.34, WH - y0)]
    lathe('HoodTrim', hx, y0, zN, [(0.95, 0.0), (0.95, 0.14)], seg=32, sz=0.82, kind='lit')
    lathe('Brick', hx, y0 + 0.14, zN, prof[2:], seg=32, sz=0.82, kind='lit')
    lathe('Brick', hx, y0 - 0.02, zN, [(0.0, 0.0), (0.95, 0.0), (0.95, 0.02)], seg=32, sz=0.82, kind='lit')
    # gas cooktop under it, a big stone slab behind
    box('BlackPlastic', hx - 0.4, top, zN + 0.12, hx + 0.4, top + 0.015, zN + 0.62)
    for dx in (-0.22, 0.22):
        for dz in (0.24, 0.48):
            cyl('Steel', hx + dx, top + 0.015, zN + dz, 0.075, 0.015, seg=12)
            cyl('Iron', hx + dx, top + 0.03, zN + dz, 0.04, 0.012, seg=10)
    for k in range(5): cyl('Steel', hx - 0.3 + k * 0.15, top - 0.12, zN + 0.735, 0.02, 0.03, seg=8)
    # deep sink under the window, with a gooseneck tap
    sx = -9.2
    box('Steel', sx - 0.42, top - 0.005, zN + 0.12, sx + 0.42, top + 0.004, zN + 0.6)
    box('Iron', sx - 0.36, top - 0.01, zN + 0.17, sx + 0.36, top + 0.0055, zN + 0.55)
    tube('Steel', [(sx, top, zN + 0.08), (sx, top + 0.3, zN + 0.08), (sx, top + 0.38, zN + 0.16), (sx, top + 0.34, zN + 0.3), (sx, top + 0.26, zN + 0.32)], 0.014, seg=8)
    # dish rack with plates, the coffee maker, the iron candelabra, saints, fruit, bottles
    box('Steel', sx + 0.6, top, zN + 0.15, sx + 1.05, top + 0.12, zN + 0.5)
    for k in range(6): cyl('WhitePlastic', sx + 0.66 + k * 0.065, top + 0.03, zN + 0.33, 0.11, 0.008, seg=14)
    box('BlackPlastic', -8.15, top, zN + 0.15, -7.9, top + 0.36, zN + 0.42)
    box('Steel', -8.12, top + 0.02, zN + 0.33, -7.93, top + 0.15, zN + 0.44)
    cx_, cz_ = xW + 0.35, -6.2
    lathe('Iron', cx_, top, cz_, [(0.07, 0), (0.07, 0.015), (0.015, 0.03), (0.012, 0.4), (0.03, 0.42), (0.0, 0.43)], seg=10)
    for k in range(3):
        a = k * 2 * math.pi / 3
        tube('Iron', [(cx_, top + 0.32, cz_), (cx_ + math.cos(a) * 0.1, top + 0.35, cz_ + math.sin(a) * 0.1), (cx_ + math.cos(a) * 0.12, top + 0.45, cz_ + math.sin(a) * 0.12)], 0.006, seg=5)
        cyl('WhitePlastic', cx_ + math.cos(a) * 0.12, top + 0.45, cz_ + math.sin(a) * 0.12, 0.012, 0.12, seg=8)
    for k, (m_, h_) in enumerate((('Saint', 0.24), ('SaintBlue', 0.3), ('Saint', 0.2))):  # little saints on the ledge
        x_ = hx + 0.55 + k * 0.13
        lathe(m_, x_, top, zN + 0.07, [(0.04, 0), (0.035, h_ * 0.7), (0.0, h_ * 0.75)], seg=8)
        sphere('Skin', x_, top + h_ * 0.82, zN + 0.07, 0.025)
    lathe('Weave', xW + 0.35, top, -7.35, [(0.0, 0.0), (0.09, 0.0), (0.17, 0.06), (0.19, 0.1)], seg=16)
    for k in range(6):
        sphere('Fruit' if k % 3 else 'Lime', xW + 0.35 + math.cos(k) * 0.08, top + 0.08 + (k // 4) * 0.05, -7.35 + math.sin(k) * 0.08, 0.04)
    for k, z_ in enumerate((-5.95, -5.88)):
        lathe('Glass' if k else 'BlackPlastic', xW + 0.25, top, z_, [(0.035, 0), (0.035, 0.22), (0.012, 0.27), (0.012, 0.31)], seg=10)
    # the kitchen table, dark wood on square tapered legs
    kt = next(f for f in L['FURNITURE'] if f['kind'] == 'ktable')
    def table():
        w, d, h = kt['w'], kt['d'], kt['h']
        box('DarkWood', -w / 2, h - 0.05, -d / 2, w / 2, h, d / 2)
        box('DarkWood', -w / 2 + 0.06, h - 0.14, -d / 2 + 0.06, w / 2 - 0.06, h - 0.05, d / 2 - 0.06)
        for sx_ in (-1, 1):
            for sz_ in (-1, 1):
                add_geom('DarkWood', *legs(sx_ * (w / 2 - 0.1), sz_ * (d / 2 - 0.1), h - 0.05, 0.035, 0.022))
    transformed(table, (kt['x'], FLOOR_Y, kt['z']))
    with detail():
        for (dx, dz, yaw, green) in ((-0.35, -0.65, 0, True), (0.35, -0.68, 0.08, False), (-0.35, 0.66, math.pi, False), (0.38, 0.65, math.pi - 0.1, True), (-0.98, 0.05, math.pi / 2, True)):
            transformed(lambda green=green: x_chair(green), (kt['x'] + dx, FLOOR_Y, kt['z'] + dz), yaw)
    box('Iron', kt['x'] - 0.05, kt['h'] + FLOOR_Y, kt['z'] - 0.05, kt['x'] + 0.05, kt['h'] + FLOOR_Y + 0.13, kt['z'] + 0.05)   # napkin holder


def legs(x, z, h, r0, r1):
    """a square tapered leg from the floor to h (local), as (verts, faces)"""
    vs = [(x - r1, 0, z - r1), (x + r1, 0, z - r1), (x + r1, 0, z + r1), (x - r1, 0, z + r1), (x - r0, h, z - r0), (x + r0, h, z - r0), (x + r0, h, z + r0), (x - r0, h, z + r0)]
    return vs, [(0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]


def build_bar():
    bb = next(f for f in L['FURNITURE'] if f['kind'] == 'barback')
    bc = next(f for f in L['FURNITURE'] if f['kind'] == 'barcounter')
    x0, x1 = bb['x'] - bb['w'] / 2, bb['x'] + bb['w'] / 2
    zb0, zb1 = bb['z'] - bb['d'] / 2, bb['z'] + bb['d'] / 2
    # back unit: panelled cupboards, black-marble worktop, then the tall section: marble panels
    # either side with glass shelves of bottles, a mirror in the middle, a deep panelled canopy
    box('Mahogany', x0, FLOOR_Y, zb0, x1, 0.88, zb1)
    for k in range(4):
        u0 = x0 + 0.04 + k * (bb['w'] - 0.08) / 4
        u1 = u0 + (bb['w'] - 0.08) / 4 - 0.04
        box('Mahogany', u0 + 0.05, 0.14, zb1, u1 - 0.05, 0.8, zb1 + 0.018)
        box('Brass', u1 - 0.07, 0.62, zb1 + 0.018, u1 - 0.06, 0.7, zb1 + 0.035)
    box('MarbleBlack', x0 - 0.02, 0.88, zb0, x1 + 0.02, 0.92, zb1 + 0.03)
    for (u0, u1) in ((x0, x0 + 0.55), (x1 - 0.55, x1)):
        box('MarbleBlack', u0, 0.92, zb0, u1, 2.45, zb0 + 0.03)
        box('Mahogany', u0, 0.92, zb0, u0 + 0.05, 2.45, zb1)
        box('Mahogany', u1 - 0.05, 0.92, zb0, u1, 2.45, zb1)
        for y_ in (1.3, 1.7, 2.1):
            add_geom('Glass', [(u0 + 0.05, y_, zb0 + 0.03), (u1 - 0.05, y_, zb0 + 0.03), (u1 - 0.05, y_, zb1), (u0 + 0.05, y_, zb1)], [(0, 1, 2, 3), (3, 2, 1, 0)])
            for k in range(3):
                bx = u0 + 0.12 + k * 0.15
                mm = rnd.choice(['Glass', 'BlackPlastic', 'Bronze', 'PinkGlass'])
                hh = rnd.uniform(0.2, 0.3)
                lathe(mm, bx, y_, zb0 + 0.2, [(0.035, 0), (0.035, hh * 0.65), (0.012, hh * 0.85), (0.012, hh)], seg=10)
        for y_ in (0.95,):
            for k in range(3):
                bx = u0 + 0.12 + k * 0.15
                lathe(rnd.choice(['Glass', 'Bronze']), bx, 0.92, zb0 + 0.22, [(0.04, 0), (0.04, 0.2), (0.013, 0.27), (0.013, 0.32)], seg=10)
    mx0, mx1 = x0 + 0.55, x1 - 0.55
    box('Mirror', mx0, 1.05, zb0, mx1, 2.2, zb0 + 0.02)
    box('Mahogany', mx0, 0.92, zb0, mx1, 1.05, zb1 - 0.15)
    box('Mahogany', mx0, 2.2, zb0, mx1, 2.45, zb1 - 0.15)
    for u in (mx0, mx1 - 0.05): box('Mahogany', u, 1.05, zb0, u + 0.05, 2.2, zb0 + 0.06)
    # the canopy over everything, out past the counter
    cz1 = bc['z'] + bc['d'] / 2 + 0.05
    box('Mahogany', x0 - 0.05, 2.45, zb0, x1 + 0.05, 2.95, cz1)
    box('Mahogany', x0 - 0.1, 2.95, zb0, x1 + 0.1, 3.02, cz1 + 0.05)
    for k in range(5):
        u = x0 + 0.1 + k * (bb['w'] - 0.2) / 4
        box('Mahogany', u - 0.2, 2.53, cz1, u + 0.2, 2.87, cz1 + 0.015)
    box('Mahogany', x0 - 0.05, 2.44, zb1, x1 + 0.05, 2.46, cz1)
    for u in (x0 - 0.05, x1 - 0.02): box('Mahogany', u, 2.2, zb1, u + 0.07, 2.45, cz1)   # brackets
    # the counter: raised-panel front, black marble top with a lip
    cz0, czf = bc['z'] - bc['d'] / 2, bc['z'] + bc['d'] / 2
    box('Mahogany', x0, FLOOR_Y, cz0, x1, 1.06, czf)
    box('Mahogany', x0 - 0.04, FLOOR_Y, czf - 0.05, x1 + 0.04, 0.12, czf + 0.03)
    for k in range(4):
        u0 = x0 + 0.06 + k * (bc['w'] - 0.12) / 4
        u1 = u0 + (bc['w'] - 0.12) / 4 - 0.06
        box('Mahogany', u0, 0.2, czf, u1, 0.96, czf + 0.012)
        box('Mahogany', u0 + 0.06, 0.26, czf + 0.012, u1 - 0.06, 0.9, czf + 0.024)
    for u in (x0, x1 - 0.06): box('Mahogany', u, FLOOR_Y, czf, u + 0.06, 1.06, czf + 0.05)
    box('MarbleBlack', x0 - 0.06, 1.06, cz0 - 0.03, x1 + 0.06, 1.1, czf + 0.06)
    # orange bar towel and a spray bottle, like the day of the video
    box('FlowerOrange', x0 + 1.5, 1.1, cz0 + 0.1, x0 + 1.9, 1.13, cz0 + 0.38)
    lathe('WhitePlastic', x0 + 2.05, 1.1, cz0 + 0.2, [(0.03, 0), (0.03, 0.17), (0.012, 0.21), (0.012, 0.25)], seg=8)


def build_dining():
    dt = next(f for f in L['FURNITURE'] if f['kind'] == 'dining')
    w, d, h = dt['w'], dt['d'], dt['h']
    def table():
        box('Mahogany', -w / 2, h - 0.06, -d / 2, w / 2, h, d / 2)
        box('Mahogany', -w / 2 + 0.08, h - 0.16, -d / 2 + 0.08, w / 2 - 0.08, h - 0.06, d / 2 - 0.08)
        for x in (-w / 2 + 0.7, 0.0, w / 2 - 0.7):   # three turned pedestals on sledge feet
            lathe('Mahogany', x, 0.1, 0, [(0.09, 0), (0.12, 0.05), (0.07, 0.12), (0.11, 0.25), (0.06, 0.4), (0.08, 0.52), (0.07, h - 0.26), (0.1, h - 0.16)], seg=12)
            box('Mahogany', x - 0.07, 0, -d / 2 + 0.12, x + 0.07, 0.12, d / 2 - 0.12)
        box('Mahogany', -w / 2 + 0.7, 0.32, -0.05, w / 2 - 0.7, 0.42, 0.05)
    transformed(table, (dt['x'], FLOOR_Y, dt['z']))
    y = FLOOR_Y + h
    # placemats at each place, glasses, two vases of heliconias and pampas plumes
    with detail(): dining_settings(dt, w, d, y)


def dining_settings(dt, w, d, y):
    for i in range(9):
        x = dt['x'] - w / 2 + 0.35 + i * (w - 0.7) / 8
        for s in (-1, 1):
            z = dt['z'] + s * (d / 2 - 0.2)
            quad_floor('Placemat', x - 0.22, z - 0.16, x + 0.22, z + 0.16, y + 0.002, uvs=[(0, 0), (0, 1), (1, 1), (1, 0)])
            if i % 2 == 0: lathe('Glass', x + 0.16, y, z - s * 0.2, [(0.03, 0), (0.035, 0.12)], seg=10, smooth=True)
    for vx in (dt['x'] - 1.5, dt['x'] + 1.5):
        vase(vx, y, dt['z'])
    box('DarkWood', dt['x'] - 0.1, y, dt['z'] - 0.06, dt['x'] + 0.1, y + 0.12, dt['z'] + 0.06)  # napkin box


def vase(x, y, z, tall=0.3):
    lathe('Glass', x, y, z, [(0.0, 0.0), (0.07, 0.0), (0.075, 0.02), (0.06, tall * 0.7), (0.05, tall)], seg=14)
    for k in range(7):
        a = k * 2.4
        tx, tz = x + math.cos(a) * 0.12, z + math.sin(a) * 0.12
        tube('LeafGreen', [(x, y + 0.05, z), (x + (tx - x) * 0.4, y + tall + 0.15, z + (tz - z) * 0.4), (tx, y + tall + 0.35 + (k % 3) * 0.08, tz)], 0.006, seg=4)
        if k % 2: lathe('FlowerRed' if k % 4 == 1 else 'FlowerOrange', tx, y + tall + 0.3 + (k % 3) * 0.08, tz, [(0.0, 0), (0.035, 0.03), (0.0, 0.12)], seg=5)
        else: sphere('Pampas', tx, y + tall + 0.45 + (k % 3) * 0.08, tz, 0.035, seg=6, rings=5, sy=3.0)
    for k in range(3):  # broad leaves
        a = k * 2.1 + 0.4
        tube('LeafGreen', [(x, y + tall, z), (x + math.cos(a) * 0.15, y + tall + 0.2, z + math.sin(a) * 0.15), (x + math.cos(a) * 0.25, y + tall + 0.25, z + math.sin(a) * 0.25)], 0.025, seg=4)


def build_sitting():
    ct = next(f for f in L['FURNITURE'] if f['kind'] == 'coffee')
    transformed(lambda: iron_scroll_table(ct['w'], ct['d'], ct['h'] - 0.05, 'DarkWood', 0.05), (ct['x'], FLOOR_Y, ct['z']))
    vase(ct['x'] - 0.15, FLOOR_Y + ct['h'], ct['z'] + 0.05, 0.28)
    for k, dx in enumerate((0.25, 0.4)):
        lathe('Glass', ct['x'] + dx, FLOOR_Y + ct['h'], ct['z'] - 0.1 + k * 0.15, [(0.0, 0), (0.05, 0.0), (0.05, 0.14)], seg=12)
        cyl('WhitePlastic', ct['x'] + dx, FLOOR_Y + ct['h'] + 0.005, ct['z'] - 0.1 + k * 0.15, 0.03, 0.06, seg=10)
    pw = next(f for f in L['FURNITURE'] if f['kind'] == 'pew')
    def pew():
        Lw = pw['d']   # it runs along z: built along local x, then turned
        box('DarkWood', -Lw / 2, 0.42, -0.22, Lw / 2, 0.46, 0.22)
        for x in (-Lw / 2 + 0.05, Lw / 2 - 0.05):
            box('DarkWood', x - 0.04, 0, -0.22, x + 0.04, 0.66, -0.15)
            box('DarkWood', x - 0.04, 0, 0.15, x + 0.04, 0.95, 0.22)
            box('DarkWood', x - 0.05, 0.62, -0.25, x + 0.05, 0.66, 0.18)   # arm
        box('DarkWood', -Lw / 2, 0.1, -0.02, Lw / 2, 0.14, 0.02)
        box('DarkWood', -Lw / 2, 0.88, 0.16, Lw / 2, 0.95, 0.22)
        box('DarkWood', -Lw / 2, 0.5, 0.16, Lw / 2, 0.55, 0.2)
        n = int((Lw - 0.2) / 0.11)
        for k in range(n):   # back slats with a cut-out in each
            x = -Lw / 2 + 0.12 + k * (Lw - 0.24) / (n - 1)
            box('DarkWood', x - 0.03, 0.55, 0.17, x + 0.03, 0.66, 0.19)
            box('DarkWood', x - 0.03, 0.76, 0.17, x + 0.03, 0.88, 0.19)
            box('DarkWood', x - 0.03, 0.66, 0.17, x - 0.012, 0.76, 0.19)
            box('DarkWood', x + 0.012, 0.66, 0.17, x + 0.03, 0.76, 0.19)
    transformed(pew, (pw['x'], FLOOR_Y, pw['z']), -math.pi / 2)
    # iron side tables at the pew's ends: an armillary sphere on one, a bronze bowl on the other
    for k, z in enumerate((pw['z'] - pw['d'] / 2 - 0.4, pw['z'] + pw['d'] / 2 + 0.4)):
        transformed(lambda: iron_scroll_table(0.55, 0.55, 0.6, 'DarkWood', 0.035), (pw['x'], FLOOR_Y, z))
        yy = FLOOR_Y + 0.635
        if k == 0:
            lathe('Bronze', pw['x'], yy, z, [(0.06, 0), (0.02, 0.05), (0.015, 0.12)], seg=10)
            for j in range(3):
                pts = [(pw['x'] + math.cos(a) * 0.12 * (1 if j != 1 else 0.0) + (math.cos(a) * 0.12 if j == 1 else 0) * 0, yy + 0.24 + math.sin(a) * 0.12, z + math.cos(a) * 0.12 * (j == 1)) for a in [2 * math.pi * t / 24 for t in range(25)]]
                pts = [(pw['x'] + math.cos(a) * 0.12 * [1, 0, 0.7][j], yy + 0.24 + math.sin(a) * 0.12 * [1, 1, 0.3][j], z + math.cos(a) * 0.12 * [0, 1, 0.7][j]) for a in [2 * math.pi * t / 24 for t in range(25)]]
                tube('Bronze', pts, 0.006, seg=4)
        else:
            lathe('Bronze', pw['x'], yy, z, [(0.0, 0.0), (0.08, 0.0), (0.16, 0.08), (0.17, 0.1)], seg=16)
    # the closet's double doors on the east wall, a hat hung on the knob
    zc, xw = 5.2, X1 - T / 2
    frame_casing(xw, zc, 1, 0, 1.3, FLOOR_Y, 2.35, 0.04, face_out=-1)
    for s, zz in ((1, zc - 0.6), (-1, zc + 0.6)):
        transformed(lambda: leaf_geom('panel', 0.6, 2.28, 0.04), (xw - 0.03, FLOOR_Y, zz), -math.pi / 2 * s)
    straw_hat(xw - 0.03, 1.5, zc - 0.2, -1, 0, 0.2, 'Iron', 0.13)
    straw_hat(xw - 0.03, 1.45, zc + 0.3, -1, 0, 0.22, 'Straw', 0.12)


def saddle(k):
    """a western saddle on top of a stand (local: horn toward +x, the stand's beam at y 0.84)"""
    y0 = 0.84
    # the saddle blanket, draped over the beam and hanging down both sides
    if k != 1:
        m = 'Blanket'
        vs, faces = [], []
        for i in range(9):
            zz = -0.42 + 0.84 * i / 8
            yy = y0 + 0.03 - max(0, abs(zz) - 0.12) * 0.9
            vs += [(-0.34, yy, zz), (0.34, yy, zz)]
        for i in range(8): faces.append((2 * i, 2 * i + 2, 2 * i + 3, 2 * i + 1))
        add_geom(m, vs, faces, smooth=True)
    # skirts: two broad leather flaps following the same drape
    vs, faces = [], []
    for i in range(9):
        zz = -0.32 + 0.64 * i / 8
        yy = y0 + 0.06 - max(0, abs(zz) - 0.1) * 0.85
        vs += [(-0.3, yy, zz), (0.28, yy, zz)]
    for i in range(8): faces.append((2 * i, 2 * i + 2, 2 * i + 3, 2 * i + 1))
    add_geom('Leather', vs, faces, smooth=True)
    # the seat: a dished saddle surface rising to the cantle at the back and the fork in front
    n = 8
    vs, faces = [], []
    for i in range(n + 1):
        u = -0.22 + 0.42 * i / n
        for j in range(n + 1):
            v = -0.17 + 0.34 * j / n
            yy = y0 + 0.12 + 1.2 * u * u * (1.6 if u < 0 else 1.0) - 1.6 * v * v + (0.06 if u > 0.12 else 0)
            vs.append((u, yy, v))
    for i in range(n):
        for j in range(n): faces.append((i * (n + 1) + j, (i + 1) * (n + 1) + j, (i + 1) * (n + 1) + j + 1, i * (n + 1) + j + 1))
    add_geom('Leather', vs, faces, smooth=True)
    # the cantle: a raised curved back; the horn on the fork
    tube('Leather', [(-0.25 + 0.04 * (1 - math.cos(a)), y0 + 0.24, math.sin(a) * 0.17) for a in [-1.3 + 2.6 * t / 10 for t in range(11)]], 0.03, seg=6)
    lathe('Leather', 0.2, y0 + 0.2, 0, [(0.05, 0.0), (0.035, 0.08), (0.035, 0.13), (0.07, 0.15), (0.06, 0.18), (0.0, 0.19)], seg=10)
    lathe('Steel', 0.2, y0 + 0.37, 0, [(0.0, 0.0), (0.03, 0.0)], seg=8)
    for s in (-1, 1):
        # fender hanging down each side, a wooden stirrup at the bottom
        add_geom('Leather', [(-0.08, y0 + 0.1, s * 0.2), (0.1, y0 + 0.1, s * 0.2), (0.12, y0 - 0.42, s * 0.3), (-0.12, y0 - 0.42, s * 0.3)], [(0, 1, 2, 3)])
        tube('Wood', [(-0.07, y0 - 0.45, s * 0.31), (-0.08, y0 - 0.6, s * 0.32), (0.08, y0 - 0.6, s * 0.32), (0.07, y0 - 0.45, s * 0.31)], 0.018, seg=5)
        # the cinch and a coiled rope on the near side
    for t in range(3):
        tube('Weave', [(0.05 + math.cos(a) * (0.1 + t * 0.012), y0 - 0.15 + math.sin(a) * (0.1 + t * 0.012), 0.33) for a in [2 * math.pi * q / 16 for q in range(17)]], 0.008, seg=3)
    tube('Weave', [(0.0, y0 + 0.02, -0.31), (0.0, y0 - 0.35, -0.3)], 0.025, seg=4)


def x_chair(green):
    """the kitchen's X-back chairs: painted sage green or natural wood, rush-coloured seat"""
    m = 'SageGreen' if green else 'NaturalWood'
    for sx in (-1, 1):
        box(m, sx * 0.2 - 0.022, 0, 0.17, sx * 0.2 + 0.022, 0.46, 0.21)              # front legs
        add_geom(m, *legs_back(sx * 0.2))                                              # back legs, up into the back posts
    box(m, -0.22, 0.43, -0.2, 0.22, 0.48, 0.22)                                       # seat frame
    box('Shade', -0.19, 0.48, -0.17, 0.19, 0.5, 0.19)                                 # woven seat
    for z in (-0.19, 0.19): box(m, -0.2, 0.18, z - 0.012, 0.2, 0.21, z + 0.012)       # stretchers
    box(m, -0.21, 0.86, -0.25, 0.21, 0.94, -0.21)                                     # top rail
    for a, b in (((-0.18, 0.52), (0.18, 0.84)), ((0.18, 0.52), (-0.18, 0.84))):      # the X
        tube(m, [(a[0], a[1], -0.225), (b[0], b[1], -0.235)], 0.014, seg=4, kind='lit' if False else 'detail')
    box(m, -0.2, 0.5, -0.24, 0.2, 0.53, -0.21)


def legs_back(x):
    vs = [(x - 0.02, 0, -0.2), (x + 0.02, 0, -0.2), (x + 0.02, 0, -0.17), (x - 0.02, 0, -0.17),
          (x - 0.02, 0.95, -0.25), (x + 0.02, 0.95, -0.25), (x + 0.02, 0.95, -0.21), (x - 0.02, 0.95, -0.21)]
    return vs, [(0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7), (4, 5, 6, 7)]


def build_office():
    dk = next(f for f in L['FURNITURE'] if f['kind'] == 'desk')
    w, d, h = dk['w'], dk['d'], dk['h']
    def desk():
        box('DarkWood', -w / 2, h - 0.05, -d / 2, w / 2, h, d / 2)
        box('Glass', -w / 2 + 0.02, h, -d / 2 + 0.02, w / 2 - 0.02, h + 0.01, d / 2 - 0.02)
        box('DarkWood', -w / 2 + 0.05, h - 0.17, -d / 2 + 0.05, w / 2 - 0.05, h - 0.05, d / 2 - 0.05)
        for sx in (-1, 1):
            for sz in (-1, 1):
                add_geom('DarkWood', *legs(sx * (w / 2 - 0.08), sz * (d / 2 - 0.08), h - 0.05, 0.035, 0.028))
        y = h + 0.01
        # laptop, printer, lamp, piles of paper, a mug: Troy's desk
        box('Steel', -0.55, y, 0.05, -0.2, y + 0.018, 0.3)
        add_geom('BlackPlastic', [(-0.55, y + 0.018, 0.05), (-0.2, y + 0.018, 0.05), (-0.2, y + 0.24, -0.02), (-0.55, y + 0.24, -0.02)], [(0, 1, 2, 3), (3, 2, 1, 0)])
        box('BlackPlastic', 0.35, y, -0.42, 0.8, y + 0.22, -0.08)
        box('Paper', 0.42, y + 0.22, -0.4, 0.73, y + 0.225, -0.15)
        lathe('Bronze', -0.75, y, -0.25, [(0.08, 0), (0.08, 0.02), (0.02, 0.05), (0.015, 0.42)], seg=12)
        lathe('Shade', -0.75, y + 0.38, -0.25, [(0.17, 0.0), (0.1, 0.22)], seg=16)
        for k in range(4):
            box('Paper', 0.0 + k * 0.12, y, 0.0 + (k % 2) * 0.1, 0.28 + k * 0.12, y + 0.02 + k * 0.012, 0.22 + (k % 2) * 0.1)
        cyl('WhitePlastic', 0.3, y, 0.3, 0.04, 0.1, seg=10)
        box('Mahogany', 0.55, y, 0.2, 0.72, y + 0.12, 0.33)
    transformed(desk, (dk['x'], FLOOR_Y, dk['z']))
    quad_floor('Oriental', dk['x'] - 1.4, dk['z'] - 1.0, dk['x'] + 1.2, dk['z'] + 1.3, FLOOR_Y + 0.006, uvs=[(0, 0), (0, 1), (1, 1), (1, 0)])
    # glass-fronted cabinet against the west wall, an expo poster inside
    cb = next(f for f in L['FURNITURE'] if f['kind'] == 'cabinet')
    def cabinet():
        W, D, Hh = cb['d'], cb['w'], cb['h']
        box('Mahogany', -W / 2, 0, -D / 2, W / 2, 0.12, D / 2)
        box('Mahogany', -W / 2, 0.12, -D / 2, -W / 2 + 0.05, Hh, D / 2)
        box('Mahogany', W / 2 - 0.05, 0.12, -D / 2, W / 2, Hh, D / 2)
        box('Mahogany', -W / 2, 0.12, -D / 2, W / 2, Hh, -D / 2 + 0.02)
        box('Mahogany', -W / 2 - 0.04, Hh, -D / 2, W / 2 + 0.04, Hh + 0.12, D / 2 + 0.04)
        for y_ in (0.7, 1.25, 1.75): box('Glass', -W / 2 + 0.05, y_, -D / 2 + 0.02, W / 2 - 0.05, y_ + 0.012, D / 2 - 0.02)
        for k in range(2):
            u0 = -W / 2 + 0.05 + k * (W - 0.1) / 2
            u1 = u0 + (W - 0.1) / 2
            box('Mahogany', u0, 0.12, D / 2 - 0.03, u0 + 0.05, Hh, D / 2)
            box('Mahogany', u1 - 0.05, 0.12, D / 2 - 0.03, u1, Hh, D / 2)
            box('Mahogany', u0, Hh - 0.08, D / 2 - 0.03, u1, Hh, D / 2)
            box('Mahogany', u0, 0.12, D / 2 - 0.03, u1, 0.25, D / 2)
            add_geom('Glass', [(u0 + 0.05, 0.25, D / 2 - 0.015), (u1 - 0.05, 0.25, D / 2 - 0.015), (u1 - 0.05, Hh - 0.08, D / 2 - 0.015), (u0 + 0.05, Hh - 0.08, D / 2 - 0.015)], [(0, 1, 2, 3), (3, 2, 1, 0)])
        for k in range(5): box(rnd.choice(['Bronze', 'Leather', 'Paper', 'WhitePlastic']), -W / 2 + 0.1 + k * 0.08, 0.71, -0.1, -W / 2 + 0.16 + k * 0.08, 0.71 + rnd.uniform(0.1, 0.3), 0.05)
    transformed(cabinet, (cb['x'], FLOOR_Y, cb['z']), math.pi / 2)
    m = mat('Pic_poster_in', rough=0.4, tex=PT['poster'])
    xx = cb['x'] - cb['w'] / 2 + 0.06
    add_geom(m, [(xx, 1.27, cb['z'] - 0.35), (xx, 1.27, cb['z'] + 0.25), (xx, 1.73, cb['z'] + 0.25), (xx, 1.73, cb['z'] - 0.35)], [(0, 1, 2, 3)], [[(0, 0), (1, 0), (1, 1), (0, 1)]])
    # three saddles on turned wooden stands, a striped blanket under one
    for k, (sx, sz, yaw) in enumerate(((5.1, -2.0, 0.6), (10.1, -3.9, -1.2), (10.2, -2.0, -2.0))):
        def stand(k=k):
            box('DarkWood', -0.25, 0, -0.2, 0.25, 0.05, 0.2)
            lathe('DarkWood', 0, 0.05, 0, [(0.07, 0), (0.05, 0.1), (0.07, 0.25), (0.04, 0.45), (0.06, 0.6), (0.045, 0.78)], seg=10)
            box('DarkWood', -0.22, 0.78, -0.08, 0.22, 0.84, 0.08)
            saddle(k)
        transformed(stand, (sx, FLOOR_Y, sz), yaw)
    # on the north wall: the window with the yellow curtains, hats, posters, the certificate
    zf = Z0 + T / 2
    win = next(w_ for w_ in DECOR_WINDOWS if w_['room'] == 'office')
    cx = win['at']
    tube('Iron', [(cx - 1.05, win['top'] + 0.18, zf + 0.12), (cx + 1.05, win['top'] + 0.18, zf + 0.12)], 0.012, seg=6)
    for s in (-1, 1):
        vs, faces = [], []
        n = 22
        for i in range(n + 1):
            u = cx + s * (0.3 + 0.75 * i / n) if s > 0 else cx - 1.05 + 0.75 * i / n
            zz = zf + 0.1 + 0.04 * math.sin(i * 1.3)
            vs += [(u, win['sill'] - 0.15, zz), (u, win['top'] + 0.17, zz)]
        for i in range(n): faces.append((2 * i, 2 * i + 2, 2 * i + 3, 2 * i + 1))
        add_geom('Curtain', vs, faces + [tuple(reversed(f)) for f in faces], smooth=True)
    ac_unit(cx - 0.2, 3.35, zf, 0, 1)
    straw_hat(cx + 1.6, 2.05, zf, 0, 1, 0.2, 'Straw', 0.11)
    straw_hat(cx + 2.0, 2.0, zf, 0, 1, 0.19, 'Straw', 0.1)
    straw_hat(cx + 2.65, 2.25, zf, 0, 1, 0.27, 'Weave', 0.03)
    pic('poster1', PT['poster'], 9.6, 1.85, Z0 + T / 2, 0, 1, 0.45, 0.65, 'BlackPlastic', 0.02, 0.01)
    pic('cert', PT['cert'], cx - 1.6, 1.9, zf, 0, 1, 0.4, 0.52, 'BlackPlastic', 0.03, 0.02)
    # a wall barometer-ish brass ornament and a sombrero on the east wall
    pic('poster2', PT['poster'], X1 - T / 2, 1.85, -7.4, -1, 0, 0.45, 0.65, 'BlackPlastic', 0.02, 0.01)
    straw_hat(X1 - T / 2, 2.6, -3.0, -1, 0, 0.32, 'Straw', 0.14)


def build_hall_and_walls():
    S = L['STAIR']
    zf = Z0 + T / 2
    # the Madonna above the bottom of the stair, the sewing-machine table tucked under it
    pic('virgin', mt('painting_virgin.jpg'), -2.6, 3.0, zf, 0, 1, 0.42, 0.58, 'Gilt', 0.06, 0.04)
    tx, tz = 1.9, zf + 0.25
    box('DarkWood', tx - 0.45, 0.74, tz - 0.22, tx + 0.45, 0.78, tz + 0.22)
    for s in (-1, 1):
        box('Iron', tx + s * 0.38 - 0.02, FLOOR_Y, tz - 0.2, tx + s * 0.38 + 0.02, 0.74, tz + 0.2)
        tube('Iron', [(tx + s * 0.38, 0.1, tz - 0.18), (tx + s * 0.3, 0.45, tz), (tx + s * 0.38, 0.72, tz + 0.18)], 0.01, seg=5)
    tube('Iron', [(tx + 0.25 + math.cos(a) * 0.2, 0.35 + math.sin(a) * 0.2, tz) for a in [2 * math.pi * k / 20 for k in range(21)]], 0.012, seg=5)
    box('Iron', tx - 0.38, 0.12, tz - 0.12, tx + 0.38, 0.16, tz + 0.12)
    box('BlackPlastic', tx - 0.25, 0.78, tz - 0.08, tx + 0.15, 0.95, tz + 0.08)       # the sewing machine
    box('BlackPlastic', tx - 0.25, 0.95, tz - 0.06, tx - 0.15, 1.08, tz + 0.06)
    box('BlackPlastic', tx - 0.25, 1.05, tz - 0.05, tx + 0.2, 1.12, tz + 0.05)
    for k in range(2):
        transformed(lambda: (box('Gilt', -0.09, 0, -0.01, 0.09, 0.22, 0.01), box('Paper', -0.07, 0.03, 0.011, 0.07, 0.19, 0.013)), (tx + 0.25 + k * 0.12, 0.78, tz - 0.05 + k * 0.04), 0.3 - k * 0.5)
    # the woman's portrait in the dining room, an air conditioner over it
    xw = -7 + IW / 2
    pic('woman', os.path.join(TEX, 'painting_portrait.jpg'), xw, 2.15, 3.0, 1, 0, 1.15, 1.55, 'DarkWood', 0.12, 0.06)
    ac_unit(xw, 3.4, 3.0, 1, 0)
    ac_unit(X1 - T / 2, 3.4, 0.4, -1, 0)
    ac_unit(-7 - IW / 2, 3.4, 4.0, -1, 0)
    # on the wall beside the office door: the gilded mirror, the cross, a round plaque
    zo = -1 + IW / 2
    ornate_mirror(5.1, 1.95, zo, 0, 1)
    cross(6.35, 2.0, zo, 0, 1)
    lathe('Gilt', 8.75, 2.0, zo, [(0.0, 0.0), (0.12, 0.0), (0.12, 0.02), (0.0, 0.03)], seg=20)
    tz_ = zo
    cross(-7 + IW / 2, 2.1, -3.2, 1, 0, 0.26)          # in the passage end of the hall
    cross(2.8, 2.6, -1 - IW / 2, 0, -1, 0.26)          # over the arches, hall side
    # the horse painting leaning in the bar room corner, the gold pedestal table beside it
    m = mat('Pic_horse', rough=0.55, tex=os.path.join(TEX, 'painting_horse.jpg'))
    hx, hz = -7 - IW / 2 - 0.02, 5.6
    lean = 0.25
    vs = [(hx - lean, FLOOR_Y + 0.03, hz - 0.45), (hx - lean, FLOOR_Y + 0.03, hz + 0.45), (hx - 0.02, FLOOR_Y + 1.38, hz + 0.45), (hx - 0.02, FLOOR_Y + 1.38, hz - 0.45)]
    add_geom(m, vs, [(0, 1, 2, 3)], [[(1, 0), (0, 0), (0, 1), (1, 1)]])
    for (z0_, z1_) in ((hz - 0.52, hz - 0.45), (hz + 0.45, hz + 0.52)):
        add_geom('BlackPlastic', [(hx - lean - 0.03, FLOOR_Y, z0_), (hx - lean - 0.03, FLOOR_Y, z1_), (hx - 0.01, FLOOR_Y + 1.44, z1_), (hx - 0.01, FLOOR_Y + 1.44, z0_)], [(0, 1, 2, 3), (3, 2, 1, 0)])
    lathe('Gilt', -7.75, FLOOR_Y, 6.25, [(0.14, 0), (0.06, 0.04), (0.035, 0.3), (0.06, 0.55), (0.17, 0.58), (0.17, 0.6), (0.0, 0.61)], seg=16)
    # the bar room's two carved barrel chairs with pink embroidered cushions, and a low table
    for (cx_, cz_, yaw) in ((-11.4, 4.3, 0.9), (-9.6, 5.3, 2.6)):
        def chair():
            lathe('Leather', 0, 0.38, 0, [(0.0, 0.0), (0.3, 0.0), (0.3, 0.06), (0.0, 0.07)], seg=16)
            for k in range(13):
                a = math.pi * 0.15 + k / 12 * math.pi * 1.7
                tube('Weave', [(math.cos(a) * 0.3, 0.0, math.sin(a) * 0.3 - 0.02), (math.cos(a) * 0.33, 0.4, math.sin(a) * 0.33), (math.cos(a) * 0.36, 0.78, math.sin(a) * 0.36)], 0.018, seg=5)
            arc = [(math.cos(a) * 0.36, 0.78, math.sin(a) * 0.36) for a in [math.pi * 0.15 + t / 20 * math.pi * 1.7 for t in range(21)]]
            tube('Weave', arc, 0.035, seg=6)
            tube('Weave', [(p[0] * 0.92, 0.4, p[2] * 0.92) for p in arc], 0.025, seg=6)
            box('Cushion', -0.2, 0.45, -0.32, 0.2, 0.75, -0.18)
        transformed(chair, (cx_, FLOOR_Y, cz_), yaw)
    transformed(lambda: iron_scroll_table(0.8, 0.5, 0.42, 'DarkWood', 0.04), (-10.4, FLOOR_Y, 5.6))
    lathe('WhitePlastic', -10.3, FLOOR_Y + 0.46, 5.6, [(0.0, 0), (0.06, 0.0), (0.07, 0.1)], seg=12)
    for k in range(5):
        tube('LeafGreen', [(-10.3, FLOOR_Y + 0.55, 5.6), (-10.3 + math.cos(k * 1.3) * 0.1, FLOOR_Y + 0.75, 5.6 + math.sin(k * 1.3) * 0.1)], 0.012, seg=4)
    # doormat by the side door
    e5 = next(e for e in ENTRIES if e['kind'] == 'door' and e['wall'] == 'W')
    quad_floor('Mat', X0 + T / 2 + 0.1, e5['z'] - 0.45, X0 + T / 2 + 0.75, e5['z'] + 0.45, FLOOR_Y + 0.008)
    # light switches by the doorways
    for p in L['PORTALS']:
        if not p['wall']: continue
        if p['nx'] == 0: switch(p['x'] + p['w'] / 2 + 0.2, 1.25, p['z'] - IW / 2, 0, -1)
        else: switch(p['x'] - IW / 2, 1.25, p['z'] + p['w'] / 2 + 0.2, -1, 0)


def photo(key, cx, cy, cz, nx, nz, w, h, frame='DarkWood'):
    if key in PT: pic(key, PT[key], cx, cy, cz, nx, nz, w, h, frame, 0.035, 0.025)


def standing_frame(key, x, y, z, yaw, w=0.16, h=0.2, frame='Gilt'):
    """a photo in a frame standing on a table, leaning back a little"""
    if key not in PT: return
    m = mat('Pic_' + key + '_s', rough=0.5, tex=PT[key])
    def fn():
        add_geom(m, [(-w / 2, 0.02, 0.012), (w / 2, 0.02, 0.012), (w / 2, h, -0.03), (-w / 2, h, -0.03)], [(0, 1, 2, 3)], [[(0, 0), (1, 0), (1, 1), (0, 1)]])
        for (a_, b_) in (((-w / 2 - 0.02, 0.0), (w / 2 + 0.02, 0.025)), ((-w / 2 - 0.02, h - 0.005), (w / 2 + 0.02, h + 0.02))):
            box(frame, a_[0], a_[1], -0.02 - 0.02 * (a_[1] > 0.1), b_[0], b_[1], 0.005 - 0.02 * (a_[1] > 0.1))
        for u in (-w / 2 - 0.02, w / 2):
            add_geom(frame, [(u, 0, 0.0), (u + 0.02, 0, 0.0), (u + 0.02, h + 0.02, -0.04), (u, h + 0.02, -0.04)], [(0, 1, 2, 3), (3, 2, 1, 0)])
        tube(frame, [(0, 0.0, -0.1), (0, h * 0.6, -0.03)], 0.005, seg=4)
    transformed(fn, (x, y, z), yaw)


def mug(x, y, z, m='Ceramic', yaw=0.0):
    def fn():
        lathe(m, 0, 0, 0, [(0.0, 0.0), (0.04, 0.0), (0.042, 0.095), (0.038, 0.095), (0.036, 0.01)], seg=12)
        tube(m, [(0.04, 0.075, 0), (0.065, 0.07, 0), (0.07, 0.045, 0), (0.06, 0.022, 0), (0.04, 0.02, 0)], 0.007, seg=5)
    transformed(fn, (x, y, z), yaw)


def bottle(x, y, z, m='Glass', h=0.28, r=0.035, cap='BlackPlastic', label=None):
    lathe(m, x, y, z, [(0.0, 0.0), (r, 0.0), (r, h * 0.62), (r * 0.36, h * 0.82), (r * 0.36, h * 0.96)], seg=10)
    cyl(cap, x, y + h * 0.96, z, r * 0.4, h * 0.06, seg=8)
    if label: cyl(label, x, y + h * 0.18, z, r * 1.02, h * 0.3, seg=10, cap=False)


def build_clutter():
    top = 0.92
    zN, xW = Z0 + T / 2, X0 + T / 2
    cN = next(f for f in L['FURNITURE'] if f['kind'] == 'counter' and f['w'] > 2)
    hx = cN['x'] - cN['w'] / 2 + 1.05
    # on the stove: the big stockpot, a frying pan, the kettle
    lathe('Steel', hx - 0.22, top + 0.03, zN + 0.48, [(0.0, 0.0), (0.15, 0.0), (0.15, 0.26), (0.155, 0.27), (0.145, 0.27), (0.14, 0.01)], seg=16)
    lathe('Steel', hx - 0.22, top + 0.3, zN + 0.48, [(0.0, 0.04), (0.15, 0.0), (0.03, 0.035), (0.02, 0.06)], seg=16)
    lathe('Iron', hx + 0.22, top + 0.03, zN + 0.48, [(0.0, 0.0), (0.12, 0.0), (0.135, 0.045), (0.128, 0.045), (0.11, 0.008)], seg=16)
    box('Iron', hx + 0.34, top + 0.06, zN + 0.46, hx + 0.6, top + 0.075, zN + 0.5)
    lathe('Talavera', hx + 0.22, top + 0.03, zN + 0.24, [(0.0, 0.0), (0.09, 0.0), (0.1, 0.1), (0.06, 0.17), (0.02, 0.19), (0.0, 0.2)], seg=12)
    tube('Talavera', [(hx + 0.3, top + 0.12, zN + 0.24), (hx + 0.38, top + 0.17, zN + 0.24)], 0.012, seg=5)
    # utensil crock of wooden spoons, a cutting board with a knife, paper towels
    lathe('Talavera', hx + 0.62, top, zN + 0.2, [(0.0, 0.0), (0.07, 0.0), (0.075, 0.17), (0.07, 0.18)], seg=12)
    for k in range(5):
        a = k * 1.25
        tube('Wood', [(hx + 0.62, top + 0.05, zN + 0.2), (hx + 0.62 + math.cos(a) * 0.05, top + 0.36, zN + 0.2 + math.sin(a) * 0.05)], 0.008, seg=4)
        sphere('Wood', hx + 0.62 + math.cos(a) * 0.052, top + 0.37, zN + 0.2 + math.sin(a) * 0.052, 0.022, seg=6, rings=4, sy=1.4)
    box('Wood', -10.5, top, zN + 0.2, -10.12, top + 0.025, zN + 0.46)
    box('Steel', -10.45, top + 0.025, zN + 0.3, -10.25, top + 0.03, zN + 0.32)
    box('BlackPlastic', -10.25, top + 0.025, zN + 0.3, -10.15, top + 0.04, zN + 0.33)
    cyl('Iron', -7.95, top, zN + 0.55, 0.06, 0.012, seg=10); cyl('Paper', -7.95, top + 0.012, zN + 0.55, 0.06, 0.26, seg=14)
    # by the sink: soap and a sponge; mugs; Valentina hot sauce, salt, jars of beans and rice
    bottle(-9.75, top, zN + 0.18, 'GreenPlastic', 0.22, 0.03, 'WhitePlastic')
    box('Yellow', -9.72, top, zN + 0.3, -9.62, top + 0.03, zN + 0.37)
    for k in range(3): mug(-8.6 + k * 0.12, top, zN + 0.55 - (k % 2) * 0.08, ['Ceramic', 'Talavera', 'RedPlastic'][k], k * 0.8)
    for k in range(2): bottle(xW + 0.22, top, -6.75 + k * 0.08, 'Sauce', 0.17, 0.028, 'Yellow', 'Yellow')
    cyl('WhitePlastic', xW + 0.2, top, -6.55, 0.025, 0.1, seg=8)
    for k, m_ in enumerate(('Beans', 'Rice', 'Beans')):
        cyl(m_, xW + 0.18, top, -7.7 + k * 0.13, 0.05, 0.13, seg=10)
        cyl('Glass', xW + 0.18, top, -7.7 + k * 0.13, 0.055, 0.16, seg=10)
        cyl('Wood', xW + 0.18, top + 0.16, -7.7 + k * 0.13, 0.057, 0.03, seg=10)
    # a stack of plates and a bowl, a bag of bread
    for k in range(5): cyl('Ceramic', xW + 0.3, top + k * 0.012, -5.9 + 0.45, 0.12, 0.01, seg=16)
    sphere('Bread', xW + 0.32, top + 0.05, -8.0 + 0.25, 0.09, seg=10, rings=6, sy=0.55)
    # on the kitchen table: a tortilla basket, limes, salt, napkins
    kt = next(f for f in L['FURNITURE'] if f['kind'] == 'ktable')
    ky = FLOOR_Y + kt['h']
    lathe('Weave', kt['x'] - 0.3, ky, kt['z'] + 0.1, [(0.0, 0.0), (0.1, 0.0), (0.12, 0.08), (0.11, 0.1), (0.0, 0.12)], seg=14)
    lathe('Talavera', kt['x'] + 0.2, ky, kt['z'] - 0.1, [(0.0, 0.0), (0.05, 0.0), (0.09, 0.05), (0.1, 0.07)], seg=14)
    for k in range(5): sphere('Lime', kt['x'] + 0.2 + math.cos(k * 1.3) * 0.04, ky + 0.06, kt['z'] - 0.1 + math.sin(k * 1.3) * 0.04, 0.028, seg=8, rings=5)
    cyl('Glass', kt['x'] + 0.45, ky, kt['z'] + 0.15, 0.022, 0.08, seg=8)
    mug(kt['x'] - 0.05, ky, kt['z'] + 0.22, 'Ceramic', 1.0)
    # the dogs' water and food bowls by the kitchen door, and the trash can
    for k, dx in enumerate((-0.3, 0.05)):
        lathe('Steel', -9.3 + dx, FLOOR_Y, -4.45, [(0.0, 0.0), (0.09, 0.0), (0.12, 0.06), (0.11, 0.065), (0.08, 0.01)], seg=14)
        if k == 0: cyl('Glass', -9.6, FLOOR_Y + 0.01, -4.45, 0.085, 0.04, seg=12)
        else: cyl('Beans', -9.25, FLOOR_Y + 0.01, -4.45, 0.085, 0.045, seg=12)
    cyl('Steel', -7.45, FLOOR_Y, -8.45, 0.16, 0.62, seg=16); cyl('BlackPlastic', -7.45, FLOOR_Y + 0.62, -8.45, 0.165, 0.03, seg=16)
    # the bar: an ice bucket, glasses, a bottle of tequila out on the counter
    bc = next(f for f in L['FURNITURE'] if f['kind'] == 'barcounter')
    by = 1.1
    cyl('Steel', bc['x'] - 0.8, by, bc['z'], 0.09, 0.2, seg=14)
    for k in range(3): cyl('Glass', bc['x'] - 0.45 + k * 0.1, by, bc['z'] + 0.05, 0.03, 0.09, seg=10)
    bottle(bc['x'] - 0.15, by, bc['z'] - 0.05, 'Glass', 0.32, 0.038, 'Bronze', 'Bronze')
    # dining table: a bowl of fruit, salt and pepper, a stack of plates at one end
    dt = next(f for f in L['FURNITURE'] if f['kind'] == 'dining')
    dy = FLOOR_Y + dt['h']
    lathe('Talavera', dt['x'], dy, dt['z'], [(0.0, 0.0), (0.08, 0.0), (0.16, 0.08), (0.17, 0.09)], seg=16)
    for k in range(7): sphere('Fruit' if k % 2 else 'Lime', dt['x'] + math.cos(k) * 0.09, dy + 0.08 + (k // 5) * 0.05, dt['z'] + math.sin(k) * 0.09, 0.045, seg=8, rings=5)
    for k, m_ in enumerate(('WhitePlastic', 'BlackPlastic')): cyl(m_, dt['x'] + 0.3 + k * 0.06, dy, dt['z'] + 0.05, 0.02, 0.09, seg=8)
    for k in range(6): cyl('Ceramic', dt['x'] + dt['w'] / 2 - 0.35, dy + k * 0.012, dt['z'], 0.13, 0.01, seg=16)
    # coffee table: magazines, the TV remote; a black backpack and a cap on the pew
    ct = next(f for f in L['FURNITURE'] if f['kind'] == 'coffee')
    cy_ = FLOOR_Y + ct['h']
    for k in range(3):
        transformed(lambda k=k: box('Magazine' if k != 1 else 'BluePlastic', -0.15, k * 0.008, -0.11, 0.15, k * 0.008 + 0.007, 0.11), (ct['x'] + 0.3, cy_, ct['z'] + 0.12), 0.2 + k * 0.3)
    box('BlackPlastic', ct['x'] - 0.45, cy_, ct['z'] - 0.2, ct['x'] - 0.27, cy_ + 0.02, ct['z'] - 0.15)
    pw = next(f for f in L['FURNITURE'] if f['kind'] == 'pew')
    sphere('BlackPlastic', pw['x'] + 0.05, FLOOR_Y + 0.62, pw['z'] - 0.6, 0.17, seg=10, rings=7, sy=1.2)
    box('BlackPlastic', pw['x'] - 0.12, FLOOR_Y + 0.46, pw['z'] - 0.78, pw['x'] + 0.18, FLOOR_Y + 0.62, pw['z'] - 0.42)
    lathe('Denim', pw['x'] + 0.05, FLOOR_Y + 0.46, pw['z'] + 0.5, [(0.0, 0.0), (0.1, 0.0), (0.1, 0.06), (0.0, 0.08)], seg=12)
    # office desk extras: a phone, a stapler, keys, a coffee, a cap
    dk = next(f for f in L['FURNITURE'] if f['kind'] == 'desk')
    oy = FLOOR_Y + dk['h'] + 0.01
    box('BlackPlastic', dk['x'] - 0.1, oy, dk['z'] + 0.2, dk['x'] - 0.03, oy + 0.008, dk['z'] + 0.34)
    box('RedPlastic', dk['x'] + 0.15, oy, dk['z'] - 0.3, dk['x'] + 0.3, oy + 0.04, dk['z'] - 0.26)
    mug(dk['x'] - 0.75, oy, dk['z'] + 0.25, 'Talavera', 0.5)
    lathe('Denim', dk['x'] + 0.75, oy, dk['z'] - 0.2, [(0.0, 0.0), (0.1, 0.0), (0.1, 0.07), (0.0, 0.09)], seg=12)
    standing_frame('photo_maria', dk['x'] - 0.65, oy, dk['z'] - 0.3, 0.4)
    # the sewing table's frames: Tere and Rafael
    standing_frame('sepia_tere', 1.75, 0.78, Z0 + T / 2 + 0.2, 0.2)
    standing_frame('photo_rafael', 2.15, 0.78, Z0 + T / 2 + 0.2, -0.3)
    # boots by the side door, a leash on a hook
    for k in range(2):
        def boot(k=k):
            box('Leather', -0.05, 0, -0.04, 0.05, 0.28, 0.06)
            box('Leather', -0.05, 0, 0.06, 0.05, 0.08, 0.22)
        transformed(boot, (X0 + T / 2 + 0.25 + k * 0.13, FLOOR_Y, -1.35), math.pi / 2 + 0.1 * k)
    tube('RedPlastic', [(X0 + T / 2 + 0.02, 1.6, -3.6), (X0 + T / 2 + 0.05, 1.1, -3.62), (X0 + T / 2 + 0.03, 0.9, -3.6)], 0.01, seg=4)
    # the grill and the cooler out by the side door, a propane tank
    gx, gz = -15.2, -5.4
    sphere('Iron', gx, 0.82, gz, 0.29, seg=16, rings=10, sy=0.9)
    lathe('Iron', gx, 0.82, gz, [(0.3, 0.0), (0.31, 0.02)], seg=16)
    for k in range(3):
        a = k * 2 * math.pi / 3
        tube('Iron', [(gx + math.cos(a) * 0.22, 0.62, gz + math.sin(a) * 0.22), (gx + math.cos(a) * 0.32, 0.0, gz + math.sin(a) * 0.32)], 0.014, seg=5)
    tube('Steel', [(gx - 0.08, 1.12, gz), (gx - 0.08, 1.18, gz), (gx + 0.08, 1.18, gz), (gx + 0.08, 1.12, gz)], 0.01, seg=5)
    box('BluePlastic', gx + 0.6, 0.0, gz - 0.25, gx + 1.2, 0.42, gz + 0.12)
    box('WhitePlastic', gx + 0.58, 0.42, gz - 0.27, gx + 1.22, 0.47, gz + 0.14)
    lathe('WhitePlastic', gx - 0.6, 0.0, gz + 0.2, [(0.0, 0.0), (0.15, 0.0), (0.16, 0.35), (0.12, 0.43), (0.04, 0.45), (0.04, 0.52)], seg=14)


def build_small_things():
    """outlets, the vases by the columns, the kitchen clock, the hall's pedestal fan"""
    # outlets low on the walls of each room
    for (x, z, nx, nz) in ((-12.85, 1.0, 1, 0), (-7.1, 5.5, -1, 0), (-6.9, 5.8, 1, 0), (10.85, -1.4, -1, 0), (8.5, 6.85, 0, -1), (-3.0, 6.85, 0, -1),
                           (4.1, -3.0, 1, 0), (10.85, -8.0, -1, 0), (6.0, -8.85, 0, 1), (-6.9, -8.2, 1, 0), (-8.0, -8.85, 0, 1), (-12.85, -3.0, 1, 0)):
        wall_box('WhitePlastic', x, 0.32, z, nx, nz, 0.07, 0.11, 0.01)
        wall_box('BlackPlastic', x, 0.34, z, nx, nz, 0.012, 0.02, 0.012)
        wall_box('BlackPlastic', x, 0.3, z, nx, nz, 0.012, 0.02, 0.012)
    # by the stone columns: a tall green glazed vase and a round white urn with dried stems
    col = L['COLONNADE']
    lathe('GreenGlaze', col['cols'][0] + 0.55, FLOOR_Y, col['z'] + 0.45, [(0.0, 0.0), (0.1, 0.0), (0.17, 0.12), (0.18, 0.3), (0.12, 0.45), (0.06, 0.52), (0.05, 0.6), (0.065, 0.62)], seg=16)
    lathe('Ceramic', col['cols'][1] - 0.6, FLOOR_Y, col['z'] + 0.5, [(0.0, 0.0), (0.12, 0.0), (0.24, 0.15), (0.26, 0.3), (0.2, 0.45), (0.1, 0.5), (0.09, 0.55)], seg=18)
    for k in range(7):
        a_ = k * 0.9
        tube('Wood', [(col['cols'][1] - 0.6, 0.5, col['z'] + 0.5), (col['cols'][1] - 0.6 + math.cos(a_) * 0.25, 1.3 + (k % 3) * 0.15, col['z'] + 0.5 + math.sin(a_) * 0.25)], 0.006, seg=4)
    # kitchen wall clock over the door
    lathe('WhitePlastic', -9.0, 2.6, -4 - IW / 2, [(0.0, 0.0), (0.17, 0.0), (0.17, 0.03)], seg=24) if False else None
    cx, cy, cz = -8.9, 2.65, -4 - IW / 2
    add_geom('WhitePlastic', [(cx + math.cos(t) * 0.16, cy + math.sin(t) * 0.16, cz - 0.03) for t in [2 * math.pi * k / 24 for k in range(24)]], [tuple(reversed(range(24)))])
    tube('Iron', [(cx + math.cos(t) * 0.17, cy + math.sin(t) * 0.17, cz - 0.02) for t in [2 * math.pi * k / 24 for k in range(25)]], 0.015, seg=5)
    box('Iron', cx - 0.005, cy, cz - 0.04, cx + 0.005, cy + 0.11, cz - 0.033)
    box('Iron', cx, cy - 0.005, cz - 0.04, cx + 0.08, cy + 0.005, cz - 0.033)
    # pedestal fan at the end of the hall, by the office doors
    fx, fz = 3.4, -3.6
    lathe('BlackPlastic', fx, FLOOR_Y, fz, [(0.0, 0.0), (0.2, 0.0), (0.2, 0.03), (0.03, 0.05)], seg=16)
    cyl('Steel', fx, FLOOR_Y + 0.05, fz, 0.015, 1.05, seg=8)
    box('BlackPlastic', fx - 0.06, 1.08, fz - 0.06, fx + 0.06, 1.2, fz + 0.1)
    tube('BlackPlastic', [(fx + math.cos(t) * 0.22, 1.18 + math.sin(t) * 0.22, fz + 0.15) for t in [2 * math.pi * k / 20 for k in range(21)]], 0.006, seg=4)
    for k in range(3):
        t = k * 2 * math.pi / 3
        add_geom('WhitePlastic', [(fx, 1.18, fz + 0.14), (fx + math.cos(t) * 0.18, 1.18 + math.sin(t) * 0.18, fz + 0.14), (fx + math.cos(t + 0.7) * 0.18, 1.18 + math.sin(t + 0.7) * 0.18, fz + 0.14)], [(0, 1, 2), (2, 1, 0)])


def condenser(x, y, z, yaw=0.0):
    """an air-conditioner condenser: white box, round fan grille on the front, pipes to the wall"""
    def fn():
        box('WhitePlastic', -0.4, 0.05, -0.15, 0.4, 0.6, 0.15)
        for k in range(4): box('Iron', -0.42 + k * 0.84 / 3, 0, -0.17, -0.38 + k * 0.84 / 3, 0.05, 0.17)
        tube('BlackPlastic', [(0.08 + math.cos(t) * 0.2, 0.33 + math.sin(t) * 0.2, 0.155) for t in [2 * math.pi * k / 20 for k in range(21)]], 0.008, seg=4)
        for k in range(5): tube('BlackPlastic', [(0.08 + math.cos(k * 1.257) * 0.04, 0.33 + math.sin(k * 1.257) * 0.04, 0.156), (0.08 + math.cos(k * 1.257) * 0.19, 0.33 + math.sin(k * 1.257) * 0.19, 0.156)], 0.006, seg=3)
        tube('Steel', [(-0.3, 0.3, -0.15), (-0.3, 0.3, -0.4), (-0.3, 1.8, -0.4)], 0.012, seg=5)
    transformed(fn, (x, y, z), yaw)


def build_outside_bits():
    """rain spouts, condensers, the gas cylinder"""
    U = L['UPPER']['y']
    # clay rain spouts out of the parapets (the gárgolas every flat roof here has)
    for x in (-10.5, 6.0, 8.5):
        cyl('Terracotta', x, U + 0.05, Z0 - T / 2 - 0.2, 0.07, 0.0, seg=8) if False else None
        tube('Terracotta', [(x, U + 0.08, Z0 - T / 2 + 0.1), (x, U + 0.06, Z0 - T / 2 - 0.45)], 0.07, seg=8)
    for z in (-6.0, -1.5, 2.5):
        tube('Terracotta', [(X1 + T / 2 - 0.1, U + 0.08, z), (X1 + T / 2 + 0.45, U + 0.06, z)], 0.07, seg=8)
    UP = L['UPPER']; W = UP['y'] + UP['h']
    for x in (-5.0, 1.5):
        tube('Terracotta', [(x, W + 0.2, UP['z0'] - 0.0), (x, W + 0.18, UP['z0'] - 0.55)], 0.06, seg=8)
    # condensers along the back wall and on the roof
    for x in (-3.5, 6.2):
        condenser(x, 0.0, Z0 - T / 2 - 0.55 if x < 2 else Z0 - T / 2 - 2.2, math.pi)
    condenser(X1 + T / 2 + 0.5, 0.0, -1.2, math.pi / 2)
    condenser(9.6, U, 0.5, -math.pi / 2)
    # the gas cylinder by the kitchen, on a little stand, with its regulator and hose
    gx, gz = -11.6, Z0 - T / 2 - 0.45
    box('Iron', gx - 0.25, 0.0, gz - 0.25, gx + 0.25, 0.08, gz + 0.25)
    lathe('WhitePlastic', gx, 0.08, gz, [(0.0, 0.0), (0.18, 0.0), (0.18, 0.95), (0.12, 1.05), (0.04, 1.08), (0.04, 1.14)], seg=16)
    tube('BlackPlastic', [(gx, 1.14, gz), (gx + 0.1, 1.2, gz + 0.1), (gx + 0.2, 1.0, gz + 0.2), (gx + 0.5, 1.5, gz + 0.32)], 0.01, seg=4)


def build_pictures():
    """family photos and pictures on the walls"""
    xW, xE = X0 + T / 2, -7 - IW / 2
    # the bar room: a gallery of the family on the west wall, the group picture over the sofa side
    for (who, z, y, w, h, fr) in (('photo_troy', 4.6, 1.75, 0.28, 0.36, 'DarkWood'), ('photo_maria', 5.1, 2.05, 0.28, 0.36, 'Gilt'), ('sepia_rafael', 5.6, 1.7, 0.32, 0.4, 'Gilt'),
                                  ('photo_rafa', 6.1, 2.0, 0.26, 0.33, 'DarkWood'), ('photo_julio', 5.15, 1.45, 0.24, 0.3, 'BlackPlastic'), ('sepia_tere', 4.55, 2.25, 0.24, 0.3, 'Gilt')):
        photo(who, xW, y, z, 1, 0, w, h, fr)
    photo('family', xE, 1.9, 1.6, -1, 0, 1.1, 0.52, 'DarkWood')
    # the hall: Rafael and Tere in their wedding sepia either side of the office doors
    photo('sepia_rafael', 4 - IW / 2, 1.8, -7.6, -1, 0, 0.38, 0.48, 'Gilt')
    photo('sepia_tere', 4 - IW / 2, 1.8, -3.4, -1, 0, 0.38, 0.48, 'Gilt')
    # the passage: the boys
    photo('photo_rafa', -8.6, 1.75, -4 + IW / 2, 0, 1, 0.3, 0.38, 'DarkWood')
    photo('photo_julio', -12.1, 1.75, -4 + IW / 2, 0, 1, 0.3, 0.38, 'DarkWood')
    photo('photo_troy', -8.3, 1.75, -1 - IW / 2, 0, -1, 0.3, 0.38, 'Gilt')
    # the office: Troy and Maria over the cabinet
    photo('photo_troy', 4 + IW / 2, 2.75, -7.6, 1, 0, 0.3, 0.38, 'BlackPlastic')
    photo('photo_maria', 4 + IW / 2, 2.75, -8.25, 1, 0, 0.3, 0.38, 'BlackPlastic')
    # the sitting room: the family again by the closet
    photo('family', X1 - T / 2, 2.1, 3.55, -1, 0, 0.8, 0.38, 'Gilt')


def build_lights():
    """the fittings: hanging iron lanterns, the chandelier in the stairwell"""
    for i, (x, y, z) in enumerate(L['HOUSE_LIGHTS']):
        if i == 0:   # chandelier: chain down the stairwell, five arms with frosted tulip shades
            top = WH + 3.4
            tube('Iron', [(x, top, z), (x, y + 0.45, z)], 0.008, seg=4)
            lathe('Iron', x, y, z, [(0.0, 0.0), (0.04, 0.02), (0.05, 0.12), (0.03, 0.25), (0.05, 0.38), (0.015, 0.45)], seg=10)
            for k in range(5):
                a = k * 2 * math.pi / 5
                ex, ez = x + math.cos(a) * 0.32, z + math.sin(a) * 0.32
                tube('Iron', [(x, y + 0.15, z), (x + math.cos(a) * 0.18, y + 0.06, z + math.sin(a) * 0.18), (ex, y + 0.12, ez), (ex, y + 0.2, ez)], 0.009, seg=5)
                lathe('GlassShade', ex, y + 0.13, ez, [(0.02, 0.0), (0.05, 0.03), (0.075, 0.12), (0.08, 0.15)], seg=10)
            continue
        # lantern: rod from the ceiling, iron frame with glass sides, a cap
        tube('Iron', [(x, WH, z), (x, y + 0.42, z)], 0.008, seg=4)
        lathe('Iron', x, y + 0.32, z, [(0.0, 0.1), (0.15, 0.0), (0.03, 0.08)], seg=6)
        lathe('GlassShade', x, y, z, [(0.08, 0.0), (0.12, 0.3)], seg=6)
        for k in range(6):
            a = k * math.pi / 3
            tube('Iron', [(x + math.cos(a) * 0.08, y, z + math.sin(a) * 0.08), (x + math.cos(a) * 0.125, y + 0.32, z + math.sin(a) * 0.125)], 0.006, seg=4)
        lathe('Iron', x, y - 0.06, z, [(0.0, 0.0), (0.09, 0.06)], seg=6)
    # lanterns on the front wall under the veranda
    zf = Z1 + T / 2
    for x in (-7.3, -2.2, 1.6, 5.3, 9.6):
        box('Iron', x - 0.02, 2.2, zf, x + 0.02, 2.24, zf + 0.25)
        lathe('GlassShade', x, 1.95, zf + 0.25, [(0.06, 0.0), (0.09, 0.26)], seg=6)
        lathe('Iron', x, 2.2, zf + 0.25, [(0.0, 0.08), (0.12, 0.0)], seg=6)


# ---------------------------------------------------------------- light bake and export
LM_SIZE = 1024 if LO else 2048


def join_static(objs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    house = bpy.context.view_layer.objects.active
    house.name = 'House'
    return house


def lightmap_uvs(o):
    """a second UV set where every face has its own patch of one shared texture"""
    me = o.data
    uv = me.uv_layers.new(name='Lightmap')
    me.uv_layers.active = uv
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active = o
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.002, area_weight=1.0, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.uv.pack_islands(margin=0.0025, rotate=True)
    bpy.ops.object.mode_set(mode='OBJECT')
    me.uv_layers.active = me.uv_layers['UVMap']


def bake_lightmap(o, path, samples):
    """sky light and bounced light (not the sun's direct light: the game draws that itself)"""
    img = bpy.data.images.new('Lightmap', LM_SIZE, LM_SIZE, float_buffer=True)
    for m in o.data.materials:
        nt = m.node_tree
        n = nt.nodes.new('ShaderNodeTexImage'); n.image = img; n.name = 'BakeTarget'
        uvn = nt.nodes.new('ShaderNodeUVMap'); uvn.uv_map = 'Lightmap'
        nt.links.new(uvn.outputs['UV'], n.inputs['Vector'])
        nt.nodes.active = n
    me = o.data
    me.uv_layers['Lightmap'].active = True
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = samples
    scene.cycles.max_bounces = 7
    scene.cycles.diffuse_bounces = 6
    scene.cycles.glossy_bounces = 1
    scene.cycles.transparent_max_bounces = 6
    scene.render.bake.use_pass_direct = True
    scene.render.bake.use_pass_indirect = True
    scene.render.bake.use_pass_color = False
    scene.render.bake.margin = 6
    scene.render.bake.target = 'IMAGE_TEXTURES'
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active = o
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'DIRECT', 'INDIRECT'}, use_clear=True, margin=6)
    # light leaves through the bake as irradiance / pi; store it compressed into 8 bits:
    # value = sqrt(E * K), the game undoes it (see client/src/world.js)
    import numpy as np, subprocess
    from PIL import Image, ImageFilter
    # clean the sampling noise with OpenImageDenoise (its own Blender session: see denoise.py)
    raw, clean = path + '.raw.exr', path + '.clean.exr'
    img.filepath_raw = raw; img.file_format = 'OPEN_EXR'; img.save()
    try:
        subprocess.run([sys.executable, os.path.join(HERE, 'denoise.py'), '--', raw, clean], check=True, capture_output=True, cwd=os.path.dirname(path))
        den = bpy.data.images.load(clean)
        a = np.array(den.pixels[:], dtype=np.float32).reshape(LM_SIZE, LM_SIZE, 4)
        print('denoised the light map')
    except Exception as e:
        print('denoise failed, using the raw bake:', e)
        a = np.array(img.pixels[:], dtype=np.float32).reshape(LM_SIZE, LM_SIZE, 4)
    a = a[::-1, :, :3]
    a = np.clip(np.sqrt(np.maximum(a, 0) * LM_SCALE), 0, 1)
    im = Image.fromarray((a * 255 + 0.5).astype(np.uint8))
    im = im.filter(ImageFilter.GaussianBlur(0.4))
    im.save(path)
    for m in o.data.materials:
        nt = m.node_tree
        for n in [n for n in nt.nodes if n.name == 'BakeTarget' or n.type == 'UVMAP']: nt.nodes.remove(n)
    print('baked', path)


LM_SCALE = 1.0 / 1.5   # 8-bit range: up to 1.5 (irradiance / pi) before it clips


def bake_world():
    """the sky at the game's strength, plus the sun lit only for bounced light"""
    d = setup_world(0.9, sun=True)
    lamp = bpy.data.lights['Sun']
    lamp.use_nodes = True
    nt = lamp.node_tree
    em = nt.nodes['Emission']
    lp = nt.nodes.new('ShaderNodeLightPath')
    gt = nt.nodes.new('ShaderNodeMath'); gt.operation = 'GREATER_THAN'; gt.inputs[1].default_value = 0.5
    mul = nt.nodes.new('ShaderNodeMath'); mul.operation = 'MULTIPLY'; mul.inputs[1].default_value = 1.0
    nt.links.new(lp.outputs['Ray Depth'], gt.inputs[0])
    nt.links.new(gt.outputs[0], mul.inputs[0])
    nt.links.new(mul.outputs[0], em.inputs['Strength'])
    return d


def export(objs, path):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_apply=True,
                              export_animations=False, export_image_format='AUTO', export_texcoords=True, export_normals=True)
    print('exported', path)


# ---------------------------------------------------------------- previews
HDR = os.path.join(ROOT, 'client/public/assets/hdri/kloofendal_48d_partly_cloudy_puresky.hdr')
VIEWS = {  # name: (eye, target, lens mm), game coords: matched to frames of the video
    'kitchen': ((-8.2, 1.55, -4.5), (-12.2, 1.2, -8.6), 16),
    'bar': ((-8.0, 1.55, 5.8), (-10.6, 1.25, -1.0), 16),
    'hall': ((-6.3, 1.6, -1.6), (4.0, 1.6, -5.0), 16),
    'dining': ((-2.0, 1.6, -5.0), (-1.0, 1.0, 6.0), 15),
    'sitting': ((5.6, 1.6, 6.3), (8.5, 1.3, -2.0), 15),
    'office': ((5.0, 1.6, -1.6), (10.5, 1.2, -8.5), 15),
    'outside': ((9.0, 6.5, 24.0), (-1.0, 2.5, 0.0), 24),
    'veranda': ((9.0, 1.7, 10.5), (-8.0, 1.8, 8.0), 18),
    'gallery': ((3.2, 5.95, -5.9), (-5.5, 4.0, -8.0), 16),
    'bedroom': ((-1.6, 5.9, -4.8), (-5.0, 4.6, -1.0), 16),
    'roof': ((10.2, 5.9, 3.0), (3.5, 5.2, -7.5), 18),
    'back': ((14.0, 4.0, -22.0), (3.0, 3.0, -8.0), 24),
}


def setup_world(strength=0.9, sun=True):
    w = bpy.data.worlds.new('Sky'); scene.world = w; w.use_nodes = True
    nt = w.node_tree
    env = nt.nodes.new('ShaderNodeTexEnvironment'); env.image = bpy.data.images.load(HDR)
    bg = nt.nodes['Background']; bg.inputs['Strength'].default_value = strength
    nt.links.new(env.outputs['Color'], bg.inputs['Color'])
    # the sun: the same direction the game finds in this sky (brightest texel), as a lamp
    px = env.image.pixels[:]
    W_, H_ = env.image.size
    best, bi = -1, 0
    for i in range(0, len(px), 4 * 7):
        l = px[i] + px[i + 1] + px[i + 2]
        if l > best: best, bi = l, i // 4
    u, v = (bi % W_ + 0.5) / W_, (bi // W_ + 0.5) / H_
    # Blender equirect: u = atan2(dir.y, -dir.x)/(2pi) + 0.5, v = atan2(dir.z, hypot(x,y))/pi + 0.5
    phi = (u - 0.5) * 2 * math.pi; th = (v - 0.5) * math.pi
    d = Vector((-math.cos(phi) * math.cos(th), math.sin(phi) * math.cos(th), math.sin(th)))
    print('sun direction (blender)', tuple(round(c, 3) for c in d))
    if sun:
        lamp = bpy.data.lights.new('Sun', 'SUN'); lamp.energy = 3.2; lamp.angle = math.radians(1.5)
        lamp.color = (1.0, 0.94, 0.86)
        o = bpy.data.objects.new('Sun', lamp); scene.collection.objects.link(o)
        o.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
    return d


PROP_DIR = os.environ.get('RD_PROPS', '')   # uncompressed copies of the game's furniture models
PROP_FILES = {'diningChair': 'diningchair.glb', 'caneRocker': 'rocker.glb', 'xchair': 'xchair.glb', 'pot': 'pot.glb', 'fan': 'fan.glb'}


def import_props():
    """place the game's own furniture models (for previews and the light bake only; not exported)"""
    if not PROP_DIR or not os.path.isdir(PROP_DIR): print('no furniture models (set RD_PROPS)'); return []
    coll = bpy.data.collections.new('Props'); scene.collection.children.link(coll)
    src = {}
    for key, f in PROP_FILES.items():
        path = os.path.join(PROP_DIR, f)
        if not os.path.exists(path): continue
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=path)
        new = [o for o in bpy.data.objects if o not in before and o.type == 'MESH']
        for o in new: o.hide_render = True; o.hide_viewport = True
        bpy.context.view_layer.update()
        pts = [o.matrix_world @ Vector(c) for o in new for c in o.bound_box]
        mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
        mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
        src[key] = (new, mn, mx)
    placed = []
    def put(key, x, y, z, yaw, size, by_width=False, hang=False):
        if key not in src: return
        new, mn, mx = src[key]
        dims = mx - mn
        k = size / (max(dims.x, dims.y) if by_width else dims.z)
        centre = Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mx.z if hang else mn.z))
        M = Matrix.Translation(V(x, y, z)) @ Matrix.Rotation(yaw, 4, 'Z') @ Matrix.Scale(k, 4) @ Matrix.Translation(-centre)
        for o in new:
            c = o.copy(); c.hide_render = False; c.hide_viewport = False
            c.matrix_world = M @ o.matrix_world
            coll.objects.link(c); placed.append(c)
    for item in L['HOUSE_PROPS']:
        key, x, z, yaw, h = item[:5]
        put(key, x, FLOOR_Y, z, yaw, h)
    for f in L['HOUSE_FANS']:
        put('fan', f[0], (f[2] if len(f) > 2 else WH) - 0.02, f[1], 0.3, 1.3, by_width=True, hang=True)
    return placed


def render_previews(names=None):
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 48
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 6
    scene.render.resolution_x, scene.render.resolution_y = 960, 540
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.exposure = 0.6
    for name, (eye, tgt, lens) in VIEWS.items():
        if names and name not in names: continue
        cam = bpy.data.cameras.new(name); cam.lens = lens
        o = bpy.data.objects.new('cam_' + name, cam); scene.collection.objects.link(o)
        o.location = V(*eye)
        o.rotation_euler = (V(*tgt) - V(*eye)).to_track_quat('-Z', 'Y').to_euler()
        scene.camera = o
        scene.view_settings.exposure = 0.6 if name in ('outside', 'veranda') else 2.6
        scene.render.filepath = os.path.join(OUT, f'preview_{name}.png')
        bpy.ops.render.render(write_still=True)
        print('rendered', scene.render.filepath)


if __name__ == '__main__':
    build_shell()
    build_floors()
    build_ceilings()
    build_arches()
    build_stair()
    build_entries()
    build_interior_doors()
    build_exterior()
    build_veranda()
    build_kitchen()
    build_bar()
    build_dining()
    with detail():
        build_sitting()
        build_office()
        build_hall_and_walls()
        build_clutter()
        build_small_things()
        build_outside_bits()
        build_pictures()
        build_lights()
    static, details = finish_objects(split=True)
    dyn = build_dynamic()
    print('lit objects', len(static), 'detail', len(details), 'dynamic', len(dyn), 'faces', sum(len(o.data.polygons) for o in static + details + dyn))
    house = join_static(static)
    house_detail = join_static(details); house_detail.name = 'HouseDetail'
    house.name = 'House'
    lightmap_uvs(house)
    name = 'house.lo' if LO else 'house'
    raw = os.path.join(OUT, f'_{name}.raw.glb')
    export([house, house_detail] + dyn, raw)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, f'_{name}.blend'))
    props = import_props() if (PREVIEW or BAKE) else []
    if BAKE:
        bake_world()
        bake_lightmap(house, os.path.join(OUT, f'{name}_light.png'), int(os.environ.get('RD_BAKE_SAMPLES', '128')))
    if PREVIEW:
        if not BAKE: setup_world()
        render_previews(ONLY.split(',') if ONLY else None)
