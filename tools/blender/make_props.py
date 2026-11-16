# Models the gear the people-enemies carry and wear, and exports it as one small GLB.
#
#   blender -b --python tools/blender/make_props.py -- client/public/assets/models/props/props.glb
#   (or, with the `bpy` pip module:  python3 tools/blender/make_props.py -- out.glb)
#
# Objects (metres; glTF +Y is up, so "up" below is Blender +Z):
#   Hat      woven palm sombrero. Origin: centre of the head opening.
#   Bandana  paliacate worn over the nose and mouth, knotted behind. Origin: centre of the head at mouth height.
#   Machete  blade up, cutting edge toward glTF +Z. Origin: middle of the grip.
#   Bottle   beer bottle standing on its base. Origin: centre of the base.
import bpy, bmesh, sys, math, os, struct, zlib
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
DST = argv[0] if argv else 'props.glb'
TMP = os.path.join(os.path.dirname(os.path.abspath(DST)), '_props_tmp')
os.makedirs(TMP, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)


# ---- tiny PNG writer + procedural textures (no numpy needed inside Blender) --------
def write_png(path, w, h, px):  # px: bytes, RGB
    raw = b''.join(b'\x00' + px[y * w * 3:(y + 1) * w * 3] for y in range(h))
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))


def hash01(a, b):
    n = (a * 374761393 + b * 668265263) & 0xffffffff
    n = ((n ^ (n >> 13)) * 1274126177) & 0xffffffff
    return ((n ^ (n >> 16)) & 0xffff) / 65535.0


def straw_png(path, w=256, h=256):
    # plaited palm: a herringbone of over-under strands, each a slightly different straw tone
    px = bytearray(w * h * 3)
    for y in range(h):
        for x in range(w):
            sx, sy = x / 8.0, y / 8.0
            col, row = int(sx), int(sy)
            over = (col + row) % 2 == 0
            f = (sx - col) if over else (sy - row)             # across the strand
            ridge = 1.0 - abs(f - 0.5) * 1.5                   # rounded strand
            tone = 0.78 + 0.22 * hash01(col if over else col + 97, row if not over else row + 31)
            fibre = 0.94 + 0.06 * hash01(x * 3 if over else y * 3, 7)
            k = (0.55 + 0.45 * ridge) * tone * fibre
            i = (y * w + x) * 3
            px[i], px[i + 1], px[i + 2] = int(min(255, 232 * k)), int(min(255, 204 * k)), int(min(255, 142 * k))
    write_png(path, w, h, bytes(px))


def wood_png(path, w=64, h=128):
    px = bytearray(w * h * 3)
    for y in range(h):
        for x in range(w):
            g = 0.5 + 0.5 * math.sin(x * 0.9 + math.sin(y * 0.11) * 3 + hash01(x // 3, 5) * 6)
            k = 0.62 + 0.3 * g + 0.08 * hash01(x, y)
            i = (y * w + x) * 3
            px[i], px[i + 1], px[i + 2] = int(86 * k), int(52 * k), int(30 * k)
    write_png(path, w, h, bytes(px))


def paisley_png(path, w=128, h=128):
    # paliacate: plain ground with rows of small pale motifs and a border band (tinted in game)
    px = bytearray(w * h * 3)
    for y in range(h):
        for x in range(w):
            u, v = (x % 32) - 16, (y % 32) - 16
            if (y // 32) % 2: u = ((x + 16) % 32) - 16
            d = math.hypot(u, v * 1.3)
            motif = 1.0 if (5.5 < d < 7.5 or d < 2.2) else 0.0
            band = 1.0 if (y % 128) > 112 and (y % 4) < 2 else 0.0
            k = max(motif, band)
            weave = 0.92 + 0.08 * hash01(x, y)
            c = (0.62 + 0.38 * k) * weave
            i = (y * w + x) * 3
            px[i] = px[i + 1] = px[i + 2] = int(255 * c)
    write_png(path, w, h, bytes(px))


straw_png(os.path.join(TMP, 'straw.png'))
wood_png(os.path.join(TMP, 'wood.png'))
paisley_png(os.path.join(TMP, 'paisley.png'))


def material(name, color=(1, 1, 1), rough=0.8, metal=0.0, tex=None, alpha=1.0, two_sided=False):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if tex:
        t = m.node_tree.nodes.new('ShaderNodeTexImage')
        t.image = bpy.data.images.load(os.path.join(TMP, tex))
        m.node_tree.links.new(t.outputs['Color'], b.inputs['Base Color'])
    if alpha < 1:
        b.inputs['Alpha'].default_value = alpha
        try: m.surface_render_method = 'BLENDED'
        except Exception: m.blend_method = 'BLEND'
    m.use_backface_culling = not two_sided
    return m


def new_object(name, bm, mats, smooth=True):
    me = bpy.data.meshes.new(name)
    bm.normal_update()
    bm.to_mesh(me); bm.free()
    for m in mats: me.materials.append(m)
    if smooth:
        for p in me.polygons: p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def lathe(bm, profile, seg=28, mat=0, uv=None, v_scale=1.0, squash=1.0, wobble=None):
    """Spin a (radius, height) profile about Z. UV: u around, v along the profile length."""
    uvl = bm.loops.layers.uv.verify()
    lens = [0.0]
    for i in range(1, len(profile)):
        lens.append(lens[-1] + math.dist(profile[i - 1], profile[i]))
    rings = []
    for (r, z) in profile:
        ring = []
        for s in range(seg):
            a = 2 * math.pi * s / seg
            dz = wobble(a, r) if wobble else 0.0
            ring.append(bm.verts.new((math.cos(a) * r, math.sin(a) * r * squash, z + dz)))
        rings.append(ring)
    for i in range(len(rings) - 1):
        for s in range(seg):
            s2 = (s + 1) % seg
            f = bm.faces.new((rings[i][s], rings[i][s2], rings[i + 1][s2], rings[i + 1][s]))
            f.material_index = mat
            us = (s / seg, (s + 1) / seg, (s + 1) / seg, s / seg)
            vs = (lens[i], lens[i], lens[i + 1], lens[i + 1])
            for l, u_, v_ in zip(f.loops, us, vs):
                l[uvl].uv = (u_ * (uv or 1.0), v_ * v_scale)
    return rings


def cap(bm, ring, z, mat=0, flip=False):
    c = bm.verts.new((0, 0, z))
    n = len(ring)
    for s in range(n):
        a, b = ring[s], ring[(s + 1) % n]
        f = bm.faces.new((c, b, a) if flip else (c, a, b))
        f.material_index = mat


# ---- Hat: palm sombrero -----------------------------------------------------------
STRAW = material('Straw', tex='straw.png', rough=0.92, two_sided=True)
BAND = material('HatBand', color=(0.06, 0.04, 0.03), rough=0.75)
bm = bmesh.new()
# crown: slightly tapered, rounded shoulder, shallow dent on top; head is a touch longer than wide
crown = [(0.094, 0.0), (0.093, 0.035), (0.089, 0.075), (0.080, 0.098), (0.060, 0.112), (0.030, 0.108), (0.0005, 0.100)]
lathe(bm, crown, seg=32, uv=6.0, v_scale=14.0, squash=1.12)
# brim: dips a little, then curls up at the rim; rides lower front and back than at the sides
dip = lambda a, r: -0.018 * (r - 0.094) / 0.2 * (1 - 0.0) + 0.03 * ((r - 0.094) / 0.2) ** 2.2 * (0.55 + 0.45 * abs(math.cos(a)))
top = [(0.094, 0.0), (0.13, -0.002), (0.18, -0.004), (0.235, 0.0), (0.275, 0.012), (0.292, 0.026)]
lathe(bm, top, seg=32, uv=14.0, v_scale=14.0, squash=1.08, wobble=dip)
under = [(r, z - 0.006) for (r, z) in reversed(top)]
lathe(bm, under, seg=32, uv=14.0, v_scale=14.0, squash=1.08, wobble=dip)
band = [(0.0965, 0.004), (0.0958, 0.034)]
lathe(bm, band, seg=32, mat=1, squash=1.12)
hat = new_object('Hat', bm, [STRAW, BAND])

# ---- Bandana ----------------------------------------------------------------------
CLOTH = material('Bandana', tex='paisley.png', rough=0.9, two_sided=True)
bm = bmesh.new()
uvl = bm.loops.layers.uv.verify()
SEG, ROWS = 24, 6
grid = []
for j in range(ROWS + 1):
    row = []
    t = j / ROWS                                   # 0 top (bridge of the nose) .. 1 hanging hem
    for s in range(SEG + 1):
        a = -math.pi + 2 * math.pi * s / SEG       # 0 = front (-Y in Blender is the face side)
        front = max(0.0, math.cos(a))
        # wraps the face; the front hangs to a point below the chin, the back is a narrow tie
        drop = 0.045 + 0.085 * front ** 1.6
        r = 0.094 + 0.012 * front * (1 - abs(t - 0.35)) - 0.004 * (1 - front) + 0.006 * t * front
        z = 0.03 - t * drop - 0.012 * (1 - front) * (1 - t)
        fold = 0.0035 * math.sin(a * 9 + t * 4) * t
        row.append(bm.verts.new((math.sin(a) * (r + fold), -math.cos(a) * (r + fold) * 1.1, z)))
    grid.append(row)
for j in range(ROWS):
    for s in range(SEG):
        f = bm.faces.new((grid[j][s], grid[j + 1][s], grid[j + 1][s + 1], grid[j][s + 1]))
        for l, (du, dv) in zip(f.loops, ((0, 0), (0, 1), (1, 1), (1, 0))):
            l[uvl].uv = ((s + du) / SEG * 4.0, 1.0 - (j + dv) / ROWS)
# knot + two tails at the back of the head
bmesh.ops.create_icosphere(bm, subdivisions=1, radius=0.016, matrix=__import__('mathutils').Matrix.Translation((0, 0.103, 0.012)))
for sx in (-1, 1):
    a0 = bm.verts.new((sx * 0.006, 0.108, 0.006)); a1 = bm.verts.new((sx * 0.03, 0.112, 0.004))
    b0 = bm.verts.new((sx * 0.035, 0.118, -0.07)); b1 = bm.verts.new((sx * 0.062, 0.114, -0.055))
    f = bm.faces.new((a0, a1, b1, b0) if sx > 0 else (a1, a0, b0, b1))
    for l, uv in zip(f.loops, ((0, 0), (0.3, 0), (0.3, 0.6), (0, 0.6))): l[uvl].uv = uv
bandana = new_object('Bandana', bm, [CLOTH])

# ---- Machete ----------------------------------------------------------------------
STEEL = material('Steel', color=(0.62, 0.64, 0.66), rough=0.34, metal=1.0)
EDGE = material('SteelEdge', color=(0.86, 0.87, 0.88), rough=0.18, metal=1.0)
WOOD = material('Grip', tex='wood.png', rough=0.62)
BRASS = material('Brass', color=(0.72, 0.55, 0.22), rough=0.4, metal=1.0)
bm = bmesh.new()
uvl = bm.loops.layers.uv.verify()
# blade outline in the (edge, length) plane: spine is straight, the belly swells toward the
# tip and sweeps up to a point. x: + = cutting-edge side, z: along the blade from the guard.
N = 14
spine, belly = [], []
for i in range(N + 1):
    t = i / N
    z = 0.075 + t * 0.52
    w = 0.036 + 0.034 * math.sin(min(1.0, t * 1.15) * math.pi * 0.62) ** 1.3
    tip = max(0.0, (t - 0.8) / 0.2)
    spine.append((-0.014 - 0.004 * t + 0.03 * tip ** 2, z))
    belly.append((-0.014 + w - (w + 0.0) * tip ** 1.6 * 0.96 + 0.03 * tip ** 2, z - 0.0 * tip))
TH = 0.0016
def blade_side(sign, flip):
    vs_spine = [bm.verts.new((sign * TH, -x, z)) for (x, z) in spine]        # Blender -Y = glTF +Z = edge side
    vs_mid = [bm.verts.new((sign * TH, -(sx + (bx - sx) * 0.72), z)) for (sx, _), (bx, z) in zip(spine, belly)]
    vs_edge = [bm.verts.new((0.0, -x, z)) for (x, z) in belly]
    for i in range(N):
        for (a, b, m) in ((vs_spine, vs_mid, 0), (vs_mid, vs_edge, 1)):
            q = (a[i], b[i], b[i + 1], a[i + 1])
            f = bm.faces.new(q[::-1] if flip else q); f.material_index = m
    return vs_spine, vs_edge
sL, eL = blade_side(-1, False)
sR, eR = blade_side(1, True)
for i in range(N):   # spine strip
    f = bm.faces.new((sL[i], sL[i + 1], sR[i + 1], sR[i])); f.material_index = 0
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
blade_faces = set(bm.faces)
# grip: two wooden scales with a swelled belly and a hooked pommel
GN = 8
def grip_ring(t):
    z = -0.07 + t * 0.145
    hook = max(0.0, 1 - t * 4)
    wy = 0.017 + 0.005 * math.sin(t * math.pi) + 0.006 * hook
    off = -0.004 + 0.012 * hook            # pommel hooks toward the edge side
    return [bm.verts.new((math.cos(a) * 0.0105, -(off + math.sin(a) * wy), z)) for a in [k * math.pi / 5 for k in range(10)]]
rings = [grip_ring(i / GN) for i in range(GN + 1)]
for i in range(GN):
    for k in range(10):
        k2 = (k + 1) % 10
        f = bm.faces.new((rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k])); f.material_index = 2
        for l, uv in zip(f.loops, ((k / 10, i / GN), ((k + 1) / 10, i / GN), ((k + 1) / 10, (i + 1) / GN), (k / 10, (i + 1) / GN))): l[uvl].uv = uv
for ring, flip in ((rings[0], True), (rings[-1], False)):
    c = bm.verts.new(sum((v.co for v in ring), Vector()) / len(ring))
    for k in range(10):
        a, b = ring[k], ring[(k + 1) % 10]
        f = bm.faces.new((c, b, a) if flip else (c, a, b)); f.material_index = 2
# three brass rivets through the scales
for z in (-0.04, 0.0, 0.04):
    for sx in (-1, 1):
        ret = bmesh.ops.create_circle(bm, cap_ends=True, radius=0.0035, segments=8,
                                      matrix=__import__('mathutils').Matrix.Translation((sx * 0.0112, 0.003, z)) @ __import__('mathutils').Matrix.Rotation(math.pi / 2, 4, 'Y'))
        for v in ret['verts']:
            for f in v.link_faces: f.material_index = 3
machete = new_object('Machete', bm, [STEEL, EDGE, WOOD, BRASS], smooth=False)
for p in machete.data.polygons: p.use_smooth = p.material_index == 2

# ---- Bottle: Rafael's Grey Goose (frosted glass, blue cap), held by the neck like a club --
def goose_label_png(path, w=512, h=512):
    # needs Pillow (present when run through the bpy pip module); plain frosted glass otherwise
    try:
        from PIL import Image, ImageDraw, ImageFont, ImageFilter
    except Exception:
        write_png(path, 4, 4, bytes([214, 226, 236] * 16)); return
    im = Image.new('RGB', (w, h), (214, 226, 236))
    d = ImageDraw.Draw(im)
    for y in range(h):                                   # frost: paler toward the shoulder
        k = y / h
        d.line([(0, y), (w, y)], fill=(int(226 - 26 * k), int(234 - 20 * k), int(242 - 12 * k)))
    # blue mountains along the bottom of the front panel, and the flying geese above them
    cx = w // 2
    pts = [(cx - 150, h - 60)]
    for i, (dx, dy) in enumerate([(-110, 120), (-70, 80), (-30, 150), (10, 95), (50, 135), (95, 85), (150, 60)]):
        pts.append((cx + dx, h - 60 - dy))
    pts.append((cx + 150, h - 60))
    d.polygon(pts, fill=(52, 92, 150))
    d.polygon([(cx - 30, h - 210), (cx - 48, h - 170), (cx - 12, h - 176)], fill=(236, 242, 248))
    d.rectangle([cx - 160, h - 62, cx + 160, h - 44], fill=(28, 58, 110))
    for gx, gy, sz in [(-60, 150, 26), (-10, 120, 32), (48, 146, 24), (86, 110, 20)]:
        x, y = cx + gx, gy
        d.line([(x - sz, y - sz * 0.35), (x, y), (x + sz, y - sz * 0.5)], fill=(40, 60, 96), width=5)
        d.line([(x, y), (x + sz * 0.5, y + sz * 0.12)], fill=(40, 60, 96), width=4)
    def font(size, bold=True):
        for f in ('/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf'):
            try: return ImageFont.truetype(f, size)
            except Exception: pass
        return ImageFont.load_default()
    for text, y, size, col in (('GREY', 176, 40, (24, 46, 92)), ('GOOSE', 218, 40, (24, 46, 92)), ('VODKA', 268, 20, (40, 70, 120))):
        f = font(size); tw = d.textlength(text, font=f)
        d.text((cx - tw / 2, y), text, font=f, fill=col)
    im = im.filter(ImageFilter.GaussianBlur(0.6))
    im.save(path)


goose_label_png(os.path.join(TMP, 'goose.png'))
GLASS = material('FrostedGlass', tex='goose.png', rough=0.42, alpha=0.94)
BLUE = material('BottleCap', color=(0.06, 0.16, 0.42), rough=0.35, metal=0.6)
bm = bmesh.new()
H = 0.33
# straight body carries the label artwork (v runs 0..1 up the body)
lathe(bm, [(0.039, 0.008), (0.039, 0.196)], seg=24, v_scale=1 / 0.188)
plain = [(0.0005, 0.004), (0.033, 0.0), (0.039, 0.008)]
for prof in (plain, [(0.039, 0.196), (0.037, 0.214), (0.029, 0.236), (0.0185, 0.254), (0.0155, 0.27), (0.015, 0.3)]):
    for ring in lathe(bm, prof, seg=24, v_scale=0.0):
        pass
lathe(bm, [(0.0172, 0.296), (0.0172, 0.326), (0.014, 0.33), (0.0005, 0.3305)], seg=24, mat=1)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
# origin at the middle of the neck, body pointing up, so it sits in the fist like a club
for v in bm.verts: v.co.z = 0.278 - v.co.z; v.co.y = -v.co.y    # a half turn, not a mirror: the label still reads
bottle = new_object('Bottle', bm, [GLASS, BLUE])

# ---- export -----------------------------------------------------------------------
for ob in (hat, bandana, machete, bottle):
    ob.select_set(True)
bpy.ops.export_scene.gltf(filepath=DST, export_format='GLB', use_selection=True, export_yup=True,
                          export_apply=True, export_image_format='AUTO', export_animations=False)
for f in os.listdir(TMP): os.remove(os.path.join(TMP, f))
os.rmdir(TMP)
print('wrote', DST, os.path.getsize(DST), 'bytes;', {o.name: len(o.data.polygons) for o in (hat, bandana, machete, bottle)})
