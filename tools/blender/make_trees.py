# Builds the jungle's trees: two broadleaf trees with real limbs and leafy, uneven crowns,
# and two coconut palms with arching fronds (and coconuts). One GLB, instanced by the game.
#
#   blender -b --python tools/blender/make_trees.py -- client/public/assets/models/trees/trees.glb [preview.png]
#   (or with the `bpy` pip module: python3 tools/blender/make_trees.py -- out.glb [preview.png])
#
# Needs Pillow for the leaf and frond textures. Objects (metres, trunk base at the origin):
#   Broad_Trunk / Broad_Leaves     about 7 m tall
#   Giant_Trunk / Giant_Leaves     about 11 m tall, wide crown, buttressed foot
#   PalmA_Trunk / PalmA_Fronds / PalmA_Nuts, PalmB_...   10 m coconut palms, different leans
# Leaf cards carry "puffy" normals (pointing out from the middle of the crown) so a crown
# shades like one soft mass instead of a pile of flat cards.
import bpy, bmesh, sys, math, os, random
from mathutils import Vector, Matrix, Quaternion
from PIL import Image, ImageDraw, ImageFilter

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
DST = argv[0] if argv else 'trees.glb'
PREVIEW = argv[1] if len(argv) > 1 else None
TMP = os.path.join(os.path.dirname(os.path.abspath(DST)), '_trees_tmp')
os.makedirs(TMP, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
rnd = random.Random(7)


# ---------------------------------------------------------------- textures
def leaf_png(path, size=512, n=70, seed=3):
    """A spray of broad tropical leaves on twigs, radiating from the bottom centre."""
    r = random.Random(seed); S = size * 2
    im = Image.new('RGBA', (S, S), (60, 90, 30, 0)); d = ImageDraw.Draw(im)
    root = (S * 0.5, S * 0.93)
    twigs = []
    for i in range(9):
        a = math.radians(-90 + (i - 4) * 19 + r.uniform(-6, 6)); L = S * r.uniform(0.45, 0.8)
        pts = [root]
        for k in range(1, 7):
            t = k / 6; bend = math.sin(t * 2.5 + i) * 0.06
            pts.append((root[0] + math.cos(a + bend) * L * t, root[1] + math.sin(a + bend) * L * t))
        twigs.append(pts)
        d.line(pts, fill=(70, 52, 34, 255), width=max(3, int(S * 0.006)))
    leaves = []
    for i in range(n):
        tw = r.choice(twigs); k = r.uniform(0.25, 1.0)
        j = min(len(tw) - 2, int(k * (len(tw) - 1))); f = k * (len(tw) - 1) - j
        x = tw[j][0] + (tw[j + 1][0] - tw[j][0]) * f; y = tw[j][1] + (tw[j + 1][1] - tw[j][1]) * f
        base = math.atan2(tw[j + 1][1] - tw[j][1], tw[j + 1][0] - tw[j][0])
        a = base + r.choice((-1, 1)) * r.uniform(0.35, 1.15)
        leaves.append((y, x, y, a, S * r.uniform(0.11, 0.19), r.uniform(0, 1)))
    leaves.sort(reverse=True)   # ones nearer the tips are drawn last, on top
    for _, x, y, a, L, tone in leaves:
        W = L * r.uniform(0.3, 0.42)
        ca, sa = math.cos(a), math.sin(a)
        def pt(u, v): return (x + ca * u * L - sa * v * W, y + sa * u * L + ca * v * W)
        N = 12
        up = [pt(i / N, math.sin(math.pi * (i / N) ** 0.8) * 0.5 * (1 - 0.35 * i / N)) for i in range(N + 1)]
        dn = [pt(i / N, -math.sin(math.pi * (i / N) ** 0.8) * 0.5 * (1 - 0.35 * i / N)) for i in range(N + 1)]
        g = 0.55 + 0.5 * tone
        dark = (int(28 * g), int(74 * g), int(22 * g), 255); lite = (int(52 * g), int(108 * g), int(30 * g), 255)
        mid = [pt(i / N, 0) for i in range(N + 1)]
        d.polygon(up + mid[::-1], fill=lite)          # the half that catches the light
        d.polygon(dn + mid[::-1], fill=dark)
        d.line(mid, fill=(int(96 * g), int(140 * g), int(56 * g), 255), width=max(2, int(S * 0.0035)))
        for i in range(2, N - 1, 2):                   # side veins
            d.line([mid[i], up[min(N, i + 2)]], fill=(int(44 * g), int(96 * g), int(28 * g), 255), width=1)
            d.line([mid[i], dn[min(N, i + 2)]], fill=(int(24 * g), int(64 * g), int(20 * g), 255), width=1)
    im = im.resize((size, size), Image.LANCZOS)
    # bleed the leaf colour into the transparent surround so filtered edges don't go grey
    rgb = im.convert('RGB').filter(ImageFilter.GaussianBlur(6)); a = im.split()[3]
    out = Image.composite(im.convert('RGB'), rgb, a.point(lambda v: 255 if v > 8 else 0)); out.putalpha(a)
    out.save(path)


def frond_png(path, w=1024, h=384):
    """A coconut frond lying along +x: yellowish rib, long thin leaflets sweeping toward the tip."""
    r = random.Random(11); S = 2
    im = Image.new('RGBA', (w * S, h * S), (50, 96, 30, 0)); d = ImageDraw.Draw(im)
    cy = h * S / 2
    n = 120
    for i in range(n):
        t = i / (n - 1)
        x = (0.07 + 0.9 * t) * w * S
        L = h * S * 0.49 * (0.45 + 0.55 * math.sin(math.pi * (0.1 + 0.9 * t) ** 0.7)) * (1 - 0.75 * max(0, t - 0.82) / 0.18) * r.uniform(0.9, 1.0)
        sweep = math.radians(58 - 26 * t)
        for side in (-1, 1):
            g = r.uniform(0.75, 1.15)
            tipx = x + math.cos(sweep) * L; tipy = cy + side * math.sin(sweep) * L
            wd = max(3.0, w * S * 0.0125)
            nx, ny = -math.sin(sweep) * wd, math.cos(sweep) * wd * side
            col = (int(34 * g), int(92 * g), int(26 * g), 255) if side < 0 else (int(26 * g), int(74 * g), int(22 * g), 255)
            d.polygon([(x - nx * 0.5, cy - ny * 0.5), (x + nx * 0.5, cy + ny * 0.5), (tipx, tipy)], fill=col)
            if r.random() < 0.12:   # a few leaflets are torn or yellowing
                d.polygon([(x - nx * 0.5, cy - ny * 0.5), (x + nx * 0.5, cy + ny * 0.5), (tipx, tipy)], fill=(int(120 * g), int(118 * g), int(40 * g), 255))
    d.polygon([(0, cy - 10 * S), (w * S * 0.98, cy - 1), (w * S * 0.98, cy + 1), (0, cy + 10 * S)], fill=(112, 128, 52, 255))
    im = im.resize((w, h), Image.LANCZOS)
    rgb = im.convert('RGB').filter(ImageFilter.GaussianBlur(5)); a = im.split()[3]
    out = Image.composite(im.convert('RGB'), rgb, a.point(lambda v: 255 if v > 8 else 0)); out.putalpha(a)
    out.save(path)


leaf_png(os.path.join(TMP, 'leaves.png'))
frond_png(os.path.join(TMP, 'frond.png'))


def material(name, color=(1, 1, 1), rough=0.85, tex=None, clip=False):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1); b.inputs['Roughness'].default_value = rough
    if tex:
        t = m.node_tree.nodes.new('ShaderNodeTexImage'); t.image = bpy.data.images.load(os.path.join(TMP, tex))
        m.node_tree.links.new(t.outputs['Color'], b.inputs['Base Color'])
        if clip:
            m.node_tree.links.new(t.outputs['Alpha'], b.inputs['Alpha'])
            try: m.surface_render_method = 'DITHERED'
            except Exception: pass
            m.blend_method = 'CLIP'; m.alpha_threshold = 0.5
    m.use_backface_culling = False
    return m


BARK = material('Bark', (0.3, 0.24, 0.18), 0.95)
PALM_BARK = material('PalmBark', (0.42, 0.36, 0.28), 0.95)
LEAF = material('Leaves', tex='leaves.png', clip=True)
FROND = material('Frond', tex='frond.png', clip=True)
NUT = material('Coconut', (0.2, 0.26, 0.08), 0.6)


def finish(name, bm, mat, smooth=True, normals=None):
    me = bpy.data.meshes.new(name); bm.normal_update(); bm.to_mesh(me); bm.free()
    me.materials.append(mat)
    for p in me.polygons: p.use_smooth = smooth
    if normals:
        me.normals_split_custom_set_from_vertices([normals(v.co) for v in me.vertices])
    ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob)
    return ob


def tube(bm, path, radii, sides=8, v_scale=0.5, flare=None):
    """Sweep a ring along `path` (list of Vector). Returns the ring of verts at the end."""
    uvl = bm.loops.layers.uv.verify()
    rings, dist = [], 0.0
    for i, p in enumerate(path):
        t = (path[min(i + 1, len(path) - 1)] - path[max(i - 1, 0)]).normalized()
        side = t.cross(Vector((0, 0, 1)))
        if side.length < 1e-3: side = Vector((1, 0, 0))
        side.normalize(); up = side.cross(t)
        if i: dist += (p - path[i - 1]).length
        ring = []
        for s in range(sides):
            a = 2 * math.pi * s / sides
            rr = radii[i] * (flare(a, i) if flare else 1.0)
            ring.append(bm.verts.new(p + (side * math.cos(a) + up * math.sin(a)) * rr))
        rings.append((ring, dist))
    for i in range(len(rings) - 1):
        (a, da), (b, db) = rings[i], rings[i + 1]
        for s in range(sides):
            s2 = (s + 1) % sides
            f = bm.faces.new((a[s], a[s2], b[s2], b[s]))
            for l, (u, v) in zip(f.loops, ((s / sides, da), ((s + 1) / sides, da), ((s + 1) / sides, db), (s / sides, db))):
                l[uvl].uv = (u * 2.0, v * v_scale)
    return rings[-1][0]


def bend_path(start, direction, length, steps, sag=0.0, wobble=0.0, r=rnd):
    pts, p, d = [start.copy()], start.copy(), direction.normalized()
    for i in range(steps):
        d = (d + Vector((r.uniform(-1, 1), r.uniform(-1, 1), r.uniform(-0.4, 0.6))) * wobble + Vector((0, 0, -sag))).normalized()
        p = p + d * (length / steps); pts.append(p.copy())
    return pts


def leaf_card(bm, centre, size, yaw, tilt, roll, uvl):
    """Two crossed quads carrying the leaf-spray texture, attached at the bottom-middle."""
    for k in range(2):
        m = Matrix.Rotation(yaw + k * math.pi / 2, 4, 'Z') @ Matrix.Rotation(tilt, 4, 'X') @ Matrix.Rotation(roll, 4, 'Y')
        q = [Vector((-size / 2, 0, -size * 0.08)), Vector((size / 2, 0, -size * 0.08)), Vector((size / 2, 0, size * 0.92)), Vector((-size / 2, 0, size * 0.92))]
        vs = [bm.verts.new(centre + m @ v) for v in q]
        f = bm.faces.new(vs)
        for l, uv in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))): l[uvl].uv = uv


def broadleaf(name, height, crown_r, trunk_r, limbs, seed, buttress=False, cards=120):
    r = random.Random(seed)
    tb = bmesh.new(); lb = bmesh.new(); uvl = lb.loops.layers.uv.verify()
    fork = height * (0.42 if not buttress else 0.36)
    trunk = bend_path(Vector((0, 0, -0.25)), Vector((r.uniform(-0.08, 0.08), r.uniform(-0.08, 0.08), 1)), fork + 0.25, 6, wobble=0.035, r=r)
    radii = [trunk_r * (1.0 - 0.3 * i / 6) for i in range(7)]
    flare = (lambda a, i: 1 + (0.9 if buttress else 0.35) * max(0, 1 - i / 2.2) ** 2 * (1 + (0.55 * math.cos(a * (5 if buttress else 3)) if buttress else 0.15 * math.cos(a * 3))))
    tube(tb, trunk, radii, sides=10, flare=flare)
    top = trunk[-1]
    crown_c = Vector((0, 0, fork + (height - fork) * 0.52))
    tips = []
    for i in range(limbs):
        a = 2 * math.pi * i / limbs + r.uniform(-0.35, 0.35)
        elev = r.uniform(0.55, 1.05)
        d = Vector((math.cos(a) * math.cos(elev), math.sin(a) * math.cos(elev), math.sin(elev)))
        L = (height - fork) * r.uniform(0.62, 0.85)
        limb = bend_path(top - Vector((0, 0, 0.15)), d, L, 5, sag=0.03, wobble=0.12, r=r)
        lr = radii[-1] * r.uniform(0.5, 0.65)
        tube(tb, limb, [lr * (1 - 0.7 * k / 5) for k in range(6)], sides=6)
        for j in range(2 + (1 if buttress else 0)):
            k = r.choice((2, 3, 4)); base = limb[k]
            sd = (limb[k + 1] - limb[k]).normalized() + Vector((r.uniform(-0.9, 0.9), r.uniform(-0.9, 0.9), r.uniform(0.0, 0.5)))
            sub = bend_path(base, sd, L * r.uniform(0.35, 0.55), 3, sag=0.05, wobble=0.15, r=r)
            tube(tb, sub, [lr * 0.4 * (1 - 0.75 * q / 3) for q in range(4)], sides=5)
            tips += sub[1:]
        tips += limb[2:]
    # leaves: sprays along the outer branches, then fill out the crown's shell so it reads full
    per = max(1, cards // 2 // max(1, len(tips)))
    for p in tips:
        for _ in range(per):
            out = (p - crown_c); out.z *= 0.6
            yaw = math.atan2(out.y, out.x) + r.uniform(-0.9, 0.9)
            leaf_card(lb, p + Vector((r.uniform(-0.3, 0.3), r.uniform(-0.3, 0.3), r.uniform(-0.2, 0.2))), crown_r * r.uniform(0.5, 0.75), yaw, r.uniform(-0.9, 0.5), r.uniform(-0.4, 0.4), uvl)
    for _ in range(cards // 2):
        th = r.uniform(0, 2 * math.pi); ph = math.acos(r.uniform(-0.35, 1.0))
        rr = crown_r * r.uniform(0.62, 1.0) * (1 + 0.22 * math.sin(th * 3 + seed) * math.sin(ph * 2))
        p = crown_c + Vector((math.sin(ph) * math.cos(th) * rr, math.sin(ph) * math.sin(th) * rr, math.cos(ph) * rr * 0.62))
        leaf_card(lb, p, crown_r * r.uniform(0.5, 0.8), th + r.uniform(-1, 1), r.uniform(-1.1, 0.3), r.uniform(-0.5, 0.5), uvl)
    t_ob = finish(name + '_Trunk', tb, BARK)
    puffy = lambda co: ((co - crown_c + Vector((0, 0, crown_r * 0.35))).normalized())
    l_ob = finish(name + '_Leaves', lb, LEAF, normals=puffy)
    return [t_ob, l_ob]


def palm(name, height, lean, lean_dir, seed, fronds=28):
    r = random.Random(seed)
    tb = bmesh.new(); fb = bmesh.new(); nb = bmesh.new(); uvl = fb.loops.layers.uv.verify()
    # the stem leans out and then lifts back toward the light
    ld = Vector((math.cos(lean_dir), math.sin(lean_dir), 0))
    path = []
    N = 14
    for i in range(N + 1):
        t = i / N
        path.append(ld * (lean * height * (t ** 1.6) * (1 - 0.25 * t)) + Vector((0, 0, -0.2 + (height + 0.2) * t)))
    radii = [0.2 * (1.55 - 0.55 * min(1, i / 2.0)) * (1 - 0.32 * i / N) * (1 + 0.035 * math.sin(i * 2.4)) for i in range(N + 1)]
    tube(tb, path, radii, sides=9, v_scale=1.6)
    top = path[-1]; axis = (path[-1] - path[-2]).normalized()
    # crown shaft (the green bulge the fronds sprout from)
    tube(tb, [top - axis * 0.1, top + axis * 0.5], [radii[-1] * 1.25, radii[-1] * 0.5], sides=8)
    centre = top + axis * 0.3
    for i in range(fronds):
        t = i / (fronds - 1)
        yaw = i * 2.399963 + r.uniform(-0.2, 0.2)                 # golden angle: no two overlap
        elev = math.radians(68 - 96 * t ** 0.85 + r.uniform(-6, 6))  # young ones stand up, old ones hang
        L = r.uniform(4.6, 5.4) * (0.8 + 0.25 * math.sin(math.pi * min(1, t * 1.2)))
        Wd = 2.1
        d = Vector((math.cos(yaw) * math.cos(elev), math.sin(yaw) * math.cos(elev), math.sin(elev)))
        side = d.cross(Vector((0, 0, 1))).normalized(); p = centre.copy()
        SEG = 9; rows = []
        droop = 0.085 + 0.05 * t
        for s in range(SEG + 1):
            u = s / SEG
            up = side.cross(d).normalized()
            fold = 0.2 * Wd                                     # leaflets hang down either side of the rib
            taper = 1.0   # (the texture carries the frond's outline)
            rows.append((p + side * (Wd / 2) * taper - up * fold * taper, p.copy(), p - side * (Wd / 2) * taper - up * fold * taper, u))
            d = (d + Vector((0, 0, -droop * (0.4 + u * 1.6)))).normalized()
            p = p + d * (L / SEG)
        vs = [[fb.verts.new(a), fb.verts.new(b), fb.verts.new(c)] for a, b, c, _ in rows]
        for s in range(SEG):
            u0, u1 = rows[s][3], rows[s + 1][3]
            for k, (v0, v1) in enumerate(((1.0, 0.5), (0.5, 0.0))):
                f = fb.faces.new((vs[s][k], vs[s][k + 1], vs[s + 1][k + 1], vs[s + 1][k]))
                for l, uv in zip(f.loops, ((u0, v0), (u0, v1), (u1, v1), (u1, v0))): l[uvl].uv = uv
    for i in range(6):   # coconuts tucked under the crown
        a = i * 1.05 + r.uniform(-0.2, 0.2)
        c = top - axis * 0.18 + Vector((math.cos(a) * 0.3, math.sin(a) * 0.3, r.uniform(-0.12, 0.05)))
        bmesh.ops.create_icosphere(nb, subdivisions=1, radius=r.uniform(0.12, 0.15), matrix=Matrix.Translation(c) @ Matrix.Diagonal((1, 1, 1.2, 1)))
    return [finish(name + '_Trunk', tb, PALM_BARK), finish(name + '_Fronds', fb, FROND), finish(name + '_Nuts', nb, NUT)]


objs = []
objs += broadleaf('Broad', 7.0, 3.0, 0.3, 4, seed=5, cards=110)
objs += broadleaf('Giant', 11.0, 5.0, 0.55, 5, seed=9, buttress=True, cards=170)
objs += palm('PalmA', 10.0, 0.16, 0.6, seed=21)
objs += palm('PalmB', 10.0, 0.30, 3.9, seed=22, fronds=24)

for o in objs: o.select_set(True)
bpy.ops.export_scene.gltf(filepath=DST, export_format='GLB', use_selection=True, export_yup=True, export_apply=True,
                          export_animations=False, export_image_format='AUTO', export_normals=True)
print('wrote', DST, os.path.getsize(DST), 'bytes;', {o.name: len(o.data.polygons) for o in objs})

if PREVIEW:
    for i, base in enumerate(('Broad', 'Giant', 'PalmA', 'PalmB')):
        for o in objs:
            if o.name.startswith(base + '_'): o.location.x = (i - 1.5) * 10.5
    sc = bpy.context.scene
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
    cam.location = (0, -34, 5.5); cam.data.lens = 34
    cam.rotation_euler = (Vector((0, 0, 5.5)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sc.collection.objects.link(sun); sun.rotation_euler = (0.9, 0.15, 0.7); sun.data.energy = 4.5
    w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
    w.node_tree.nodes['Background'].inputs[0].default_value = (0.5, 0.62, 0.8, 1); w.node_tree.nodes['Background'].inputs[1].default_value = 1.1
    sc.render.engine = 'CYCLES'; sc.cycles.samples = 24; sc.render.resolution_x, sc.render.resolution_y = 1200, 560; sc.render.filepath = PREVIEW
    bpy.ops.render.render(write_still=True)

for f in os.listdir(TMP): os.remove(os.path.join(TMP, f))
os.rmdir(TMP)
