# Models the Zombies-style machines and the coconut cannon.
#
#   python3 tools/blender/make_machines.py -- machines.glb coconut.glb [preview.png]
#   (or: blender -b --python tools/blender/make_machines.py -- ...)
#
# machines.glb (metres; glTF +Z is the front, +Y up, origin on the floor at the centre):
#   PerkBody   drinks cooler cabinet, 1.0 x 0.8 x 2.0 m. Material "PerkPaint" is recoloured per perk.
#   PerkFront  the front panel (UV 0..1), textured in game with that perk's label
#   PerkSign   the light box on top (UV 0..1), textured in game with the perk's name
#   BoxBase    the mystery box: a beat-up wooden crate, 1.4 x 0.7 x 0.55 m
#   BoxLid     its lid. Origin on the back hinge, so rotating about X opens it.
#   PapBase    "El Taller", the upgrade press: bench, columns and crossbeam, 1.6 x 1.1 x 2.3 m
#   PapRam     the press head. Origin at its top; it slides down the columns.
#   GenBase    the diesel generator that powers the machines, 1.7 x 0.9 x 1.2 m
#   GenLever   its big switch handle. Origin on the pivot; rotate about X to throw it.
#   TrapBox    the fence-trap switch box on a post, 0.4 x 0.25 x 1.6 m (uses a second GenLever)
# coconut.glb: the coconut cannon, a homemade PVC launcher, muzzle toward -Z, about 0.95 m.
import bpy, bmesh, sys, math, os
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
DST, GUN = argv[0], argv[1]
PREVIEW = argv[2] if len(argv) > 2 else None
TMP = os.path.join(os.path.dirname(os.path.abspath(DST)), '_machines_tmp')
os.makedirs(TMP, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)

from PIL import Image, ImageDraw, ImageFont, ImageFilter
import random
rnd = random.Random(4)


def font(size):
    for f in ('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf'):
        try: return ImageFont.truetype(f, size)
        except Exception: pass
    return ImageFont.load_default()


def crate_png(path, w=512, h=256):
    im = Image.new('RGB', (w, h)); d = ImageDraw.Draw(im)
    rows = 4
    for i in range(rows):
        base = rnd.randint(118, 150)
        for y in range(i * h // rows, (i + 1) * h // rows):
            for x in range(0, w, 2):
                g = base + int(18 * math.sin(x * 0.045 + y * 0.6 + i * 3) + rnd.uniform(-8, 8))
                d.line([(x, y), (x + 1, y)], fill=(g, int(g * 0.72), int(g * 0.45)))
        d.line([(0, (i + 1) * h // rows - 1), (w, (i + 1) * h // rows - 1)], fill=(40, 26, 14), width=3)
    for x in (18, w - 22):                                 # nail heads
        for i in range(rows):
            d.ellipse([x - 4, i * h // rows + 20, x + 4, i * h // rows + 28], fill=(60, 60, 64))
    f = font(int(h * 0.62))                                # painted question marks, worn
    for cx in (w * 0.28, w * 0.72):
        d.text((cx, h * 0.5), '?', font=f, fill=(232, 222, 190), anchor='mm')
    im = im.filter(ImageFilter.GaussianBlur(0.7))
    px = im.load()
    for _ in range(9000):                                  # scuffs in the paint
        x, y = rnd.randrange(w), rnd.randrange(h)
        r, g, b = px[x, y]
        if r > 200: px[x, y] = (r - 90, g - 100, b - 110)
    im.save(path)


def hazard_png(path, w=256, h=64):
    im = Image.new('RGB', (w, h), (230, 190, 30)); d = ImageDraw.Draw(im)
    for x in range(-h, w + h, 40):
        d.polygon([(x, h), (x + 20, h), (x + 20 + h, 0), (x + h, 0)], fill=(25, 25, 25))
    im.save(path)


crate_png(os.path.join(TMP, 'crate.png'))
# a plain white placeholder: the game paints each perk's label over it (and without a
# texture the compressor would strip the texture coordinates the label needs)
Image.new('RGB', (4, 4), (255, 255, 255)).save(os.path.join(TMP, 'white.png'))
hazard_png(os.path.join(TMP, 'hazard.png'))


def material(name, color=(1, 1, 1), rough=0.6, metal=0.0, tex=None, emit=None):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Roughness'].default_value = rough; b.inputs['Metallic'].default_value = metal
    if tex:
        t = m.node_tree.nodes.new('ShaderNodeTexImage'); t.image = bpy.data.images.load(os.path.join(TMP, tex))
        m.node_tree.links.new(t.outputs['Color'], b.inputs['Base Color'])
    if emit:
        b.inputs['Emission Color'].default_value = (*emit, 1); b.inputs['Emission Strength'].default_value = 1.0
    return m


PAINT = material('PerkPaint', (0.7, 0.1, 0.1), 0.35, 0.2)
CHROME = material('Chrome', (0.85, 0.86, 0.88), 0.15, 1.0)
DARK = material('Dark', (0.03, 0.03, 0.035), 0.6)
PANEL = material('PerkPanel', (1, 1, 1), 0.25, tex='white.png')
SIGN = material('PerkSignFace', (1, 1, 1), 0.3, tex='white.png', emit=(1, 1, 1))
CRATE = material('Crate', tex='crate.png', rough=0.85)
IRON = material('Iron', (0.16, 0.16, 0.17), 0.55, 0.9)
STEEL = material('PressSteel', (0.42, 0.44, 0.47), 0.4, 0.85)
PAPPAINT = material('PapPaint', (0.22, 0.12, 0.4), 0.4, 0.3)
HAZARD = material('Hazard', tex='hazard.png', rough=0.6)


def new_obj(name, bm, mats, smooth=False):
    me = bpy.data.meshes.new(name); bm.normal_update(); bm.to_mesh(me); bm.free()
    for m in mats: me.materials.append(m)
    for p in me.polygons: p.use_smooth = smooth
    ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob)
    return ob


def cube(bm, cx, cy, cz, sx, sy, sz, mat=0, bevel=0.0, uv=None):
    """Axis-aligned box centred on (cx, cy, cz). Front is -Y. uv: (u0, v0, u1, v1) for the -Y face."""
    before = set(bm.faces)
    r = bmesh.ops.create_cube(bm, size=1.0, matrix=Matrix.Translation((cx, cy, cz)) @ Matrix.Diagonal((sx, sy, sz, 1)))
    vs = r['verts']
    faces = list({f for v in vs for f in v.link_faces})
    for f in faces: f.material_index = mat
    if bevel > 0:
        edges = list({e for v in vs for e in v.link_edges})
        bmesh.ops.bevel(bm, geom=edges, offset=bevel, segments=2, affect='EDGES')
    bm.normal_update()   # face normals pick the projection below
    uvl = bm.loops.layers.uv.verify()
    faces = [f for f in bm.faces if f not in before]   # only this box's own faces
    for f in faces:
        n = f.normal
        for l in f.loops:
            co = l.vert.co
            if abs(n.y) > 0.7: u, v = (co.x - cx) / sx + 0.5, (co.z - cz) / sz + 0.5
            elif abs(n.x) > 0.7: u, v = (co.y - cy) / sy + 0.5, (co.z - cz) / sz + 0.5
            else: u, v = (co.x - cx) / sx + 0.5, (co.y - cy) / sy + 0.5
            if uv and n.y < -0.7: u, v = uv[0] + u * (uv[2] - uv[0]), uv[1] + v * (uv[3] - uv[1])
            l[uvl].uv = (u, v)
    return r


def cyl(bm, p0, p1, r0, r1=None, seg=16, mat=0):
    r1 = r0 if r1 is None else r1
    d = Vector(p1) - Vector(p0); L = d.length
    rot = d.to_track_quat('Z', 'Y').to_matrix().to_4x4()
    m = Matrix.Translation(Vector(p0) + d / 2) @ rot
    r = bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r0, radius2=r1, depth=L, matrix=m)
    for v in r['verts']:
        for f in v.link_faces: f.material_index = mat
    return r


# ---------------------------------------------------------------- perk machine
W, D, H = 1.0, 0.8, 2.0
bm = bmesh.new()
cube(bm, 0, 0, H / 2 + 0.06, W, D, H - 0.12, 0, bevel=0.035)          # cabinet
cube(bm, 0, 0, 0.03, W - 0.06, D - 0.06, 0.06, 1)                      # chrome kick plate
for sx in (-1, 1):
    cube(bm, sx * (W / 2 + 0.006), 0, H * 0.5, 0.02, D * 0.7, H * 0.82, 1)   # side trims
    for k in range(6):
        cube(bm, sx * (W / 2 + 0.004), D * 0.2, 0.35 + k * 0.05, 0.012, D * 0.3, 0.02, 2)  # vents
cube(bm, 0, -D / 2 - 0.01, 0.42, W * 0.62, 0.04, 0.2, 2)               # dispenser opening
cube(bm, 0, -D / 2 - 0.035, 0.32, W * 0.66, 0.06, 0.03, 1)             # its chrome lip
cube(bm, W * 0.34, -D / 2 - 0.02, 0.98, 0.08, 0.04, 0.16, 1)            # coin box
cube(bm, W * 0.34, -D / 2 - 0.045, 1.01, 0.02, 0.012, 0.06, 2)          # slot
cube(bm, 0, 0, H + 0.03, W * 0.98, D * 0.8, 0.07, 1)                    # roof cap
body = new_obj('PerkBody', bm, [PAINT, CHROME, DARK])
bm = bmesh.new()
cube(bm, -0.06, -D / 2 - 0.012, 1.24, W * 0.68, 0.02, 0.98, 0, uv=(0, 0, 1, 1))
cube(bm, -0.06, -D / 2 - 0.004, 1.24, W * 0.72, 0.008, 1.02, 1)         # chrome frame, behind the panel
front = new_obj('PerkFront', bm, [PANEL, CHROME])
bm = bmesh.new()
cube(bm, 0, -0.02, H + 0.25, W * 0.96, 0.18, 0.4, 0, uv=(0, 0, 1, 1), bevel=0.02)
cube(bm, 0, 0.02, H + 0.08, W * 0.5, 0.1, 0.06, 1)                       # bracket
sign = new_obj('PerkSign', bm, [SIGN, CHROME])

# ---------------------------------------------------------------- mystery box
BW, BD, BH = 1.4, 0.7, 0.55
bm = bmesh.new()
cube(bm, 0, 0, BH / 2, BW, BD, BH, 0, uv=(0, 0, 1, 1))
for x in (-BW / 2 + 0.03, BW / 2 - 0.03):                              # iron corner straps
    for y in (-BD / 2 + 0.02, BD / 2 - 0.02):
        cube(bm, x, y, BH / 2, 0.07, 0.045, BH + 0.004, 1)
cube(bm, 0, -BD / 2 - 0.012, BH - 0.05, 0.12, 0.03, 0.08, 1)           # hasp
box_base = new_obj('BoxBase', bm, [CRATE, IRON])
bm = bmesh.new()
cube(bm, 0, -BD / 2, 0.04, BW + 0.04, BD + 0.04, 0.08, 0, uv=(0, 0.75, 1, 1))
for x in (-BW / 2 + 0.03, BW / 2 - 0.03):
    cube(bm, x, -BD / 2, 0.04, 0.07, BD + 0.05, 0.086, 1)
lid = new_obj('BoxLid', bm, [CRATE, IRON])
lid.location = (0, BD / 2, BH)                                            # hinge along the back edge

# ---------------------------------------------------------------- the upgrade press
bm = bmesh.new()
cube(bm, 0, 0, 0.45, 1.6, 1.0, 0.9, 0, bevel=0.03)                       # cabinet base
cube(bm, 0, 0, 0.93, 1.66, 1.06, 0.06, 1)                                 # steel table top
cube(bm, 0, -0.51, 0.12, 1.5, 0.02, 0.12, 3, uv=(0, 0, 1, 1))             # hazard strip
cube(bm, 0, -0.1, 1.04, 0.5, 0.36, 0.16, 2)                               # anvil block
for sx in (-1, 1):
    cyl(bm, (sx * 0.6, 0.15, 0.96), (sx * 0.6, 0.15, 2.2), 0.06, seg=14, mat=1)   # columns
cube(bm, 0, 0.15, 2.22, 1.5, 0.3, 0.22, 0, bevel=0.02)                    # crossbeam
cube(bm, 0, 0.15, 2.36, 0.3, 0.2, 0.1, 2)                                 # motor
cube(bm, 0.62, -0.42, 1.12, 0.18, 0.08, 0.24, 2)                          # control box
pap = new_obj('PapBase', bm, [PAPPAINT, STEEL, IRON, HAZARD])
bm = bmesh.new()
cyl(bm, (0, 0, -0.35), (0, 0, 0.0), 0.07, seg=14, mat=0)                  # piston rod
cube(bm, 0, 0, -0.45, 0.62, 0.42, 0.2, 1, bevel=0.015)                    # press head
cube(bm, 0, 0, -0.56, 0.5, 0.34, 0.04, 0)                                 # die face
ram = new_obj('PapRam', bm, [STEEL, PAPPAINT])
ram.location = (0, -0.1, 2.11)

# ---------------------------------------------------------------- generator + trap switch
GENPAINT = material('GenPaint', (0.2, 0.36, 0.2), 0.5, 0.25)
RED = material('LeverRed', (0.75, 0.06, 0.04), 0.35)
bm = bmesh.new()
cube(bm, 0, 0, 0.08, 1.7, 0.9, 0.16, 1)                                   # skid
cube(bm, -0.25, 0, 0.62, 1.1, 0.8, 0.9, 0, bevel=0.03)                     # engine housing
for k in range(9):
    cube(bm, -0.79, 0, 0.35 + k * 0.06, 0.03, 0.62, 0.025, 2)              # radiator grille
cyl(bm, (0.55, -0.05, 0.4), (0.55, -0.05, 0.95), 0.2, seg=16, mat=0)      # fuel tank (upright drum)
cube(bm, 0.5, -0.42, 0.7, 0.36, 0.06, 0.4, 2)                              # control panel
for i, x in enumerate((0.4, 0.5, 0.6)):
    cyl(bm, (x, -0.455, 0.8), (x, -0.47, 0.8), 0.028, seg=10, mat=1)       # gauges
cyl(bm, (-0.5, 0.25, 1.05), (-0.5, 0.25, 1.55), 0.045, seg=10, mat=2)      # exhaust stack
cyl(bm, (-0.5, 0.25, 1.55), (-0.5, 0.25, 1.62), 0.06, 0.045, seg=10, mat=2)
gen = new_obj('GenBase', bm, [GENPAINT, CHROME, DARK])
bm = bmesh.new()
cyl(bm, (-0.05, 0, 0), (0.05, 0, 0), 0.03, seg=10, mat=1)                  # pivot boss
cyl(bm, (0, 0, 0), (0, 0, 0.32), 0.016, seg=8, mat=1)                      # arm
cyl(bm, (-0.06, 0, 0.32), (0.06, 0, 0.32), 0.026, seg=10, mat=0)           # handle
lever = new_obj('GenLever', bm, [RED, CHROME], smooth=True)
lever.location = (0.5, -0.47, 0.6)
bm = bmesh.new()
cyl(bm, (0, 0.06, 0), (0, 0.06, 1.25), 0.05, seg=8, mat=1)                 # post
cube(bm, 0, 0, 1.25, 0.4, 0.22, 0.5, 0, bevel=0.015)                       # switch box
cube(bm, 0, -0.115, 1.42, 0.3, 0.012, 0.08, 2, uv=(0, 0, 1, 1))            # warning plate
trap = new_obj('TrapBox', bm, [GENPAINT, IRON, HAZARD])

for o in (body, front, sign, box_base, lid, pap, ram, gen, lever, trap): o.select_set(True)
bpy.ops.export_scene.gltf(filepath=DST, export_format='GLB', use_selection=True, export_yup=True, export_apply=True, export_animations=False, export_image_format='AUTO')
print('wrote', DST, os.path.getsize(DST))

# ---------------------------------------------------------------- coconut cannon
# Built along Blender -Y (glTF +Z) with the muzzle at +Y, i.e. glTF -Z.
bpy.ops.object.select_all(action='DESELECT')
PVC = material('PVC', (0.9, 0.89, 0.84), 0.45)
CAP = material('PVCGrey', (0.32, 0.33, 0.34), 0.5)
TAPE = material('DuctTape', (0.62, 0.63, 0.65), 0.35, 0.6)
GRIP = material('GripTape', (0.08, 0.08, 0.08), 0.8)
bm = bmesh.new()
cyl(bm, (0, 0.05, 0), (0, 0.62, 0), 0.046, seg=20, mat=0)               # barrel
cyl(bm, (0, 0.6, 0), (0, 0.635, 0), 0.052, seg=20, mat=1)               # muzzle collar
cyl(bm, (0, -0.02, 0), (0, 0.06, 0), 0.075, 0.046, seg=20, mat=1)        # reducer
cyl(bm, (0, -0.3, 0), (0, -0.02, 0), 0.075, seg=20, mat=0)              # combustion chamber
cyl(bm, (0, -0.335, 0), (0, -0.3, 0), 0.081, seg=20, mat=1)             # end cap
for y in (0.25, 0.45):
    cyl(bm, (0, y - 0.025, 0), (0, y + 0.025, 0), 0.0485, seg=20, mat=2)  # tape bands
cyl(bm, (0, -0.17, 0), (0, -0.13, 0), 0.0775, seg=20, mat=2)
cyl(bm, (0.0, -0.1, 0.076), (0.0, -0.1, 0.1), 0.012, seg=10, mat=1)      # igniter button on top
# pistol grip and a front handle, both under the gun
for (y, h) in ((-0.06, 0.15), (0.32, 0.12)):
    gm = Matrix.Translation((0, y, -0.075 - h / 2)) @ Matrix.Rotation(-0.25, 4, 'X') @ Matrix.Diagonal((0.034, 0.05, h, 1))
    r = bmesh.ops.create_cube(bm, size=1.0, matrix=gm)
    for v in r['verts']:
        for f in v.link_faces: f.material_index = 3
cube(bm, 0, 0.13, -0.065, 0.02, 0.38, 0.02, 1)                            # rail joining them
gun = new_obj('CoconutCannon', bm, [PVC, CAP, TAPE, GRIP], smooth=True)
gun.select_set(True)
bpy.ops.export_scene.gltf(filepath=GUN, export_format='GLB', use_selection=True, export_yup=True, export_apply=True, export_animations=False)
print('wrote', GUN, os.path.getsize(GUN))

if PREVIEW:
    gun.location = (2.2, -0.4, 1.2); gun.rotation_euler = (0, 0, 2.4); gun.scale = (1.6, 1.6, 1.6)
    gen.location = (3.6, 1.5, 0); lever.location = (4.1, 1.03, 0.6); trap.location = (-4, 1, 0)
    for o, x in ((body, -2.4), (front, -2.4), (sign, -2.4), (box_base, -0.6), (lid, -0.6), (pap, 1.4), (ram, 1.4)):
        o.location.x = x
    lid.rotation_euler = (-1.2, 0, 0); ram.location.z = 1.8
    sc = bpy.context.scene
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
    cam.location = (0.2, -8.2, 2.4); cam.data.lens = 32
    cam.rotation_euler = (Vector((0, 0, 1.1)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sc.collection.objects.link(sun); sun.rotation_euler = (0.9, 0.2, -0.5); sun.data.energy = 4
    w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True; w.node_tree.nodes['Background'].inputs[0].default_value = (0.55, 0.6, 0.7, 1)
    sc.render.engine = 'CYCLES'; sc.cycles.samples = 20; sc.render.resolution_x, sc.render.resolution_y = 1100, 560; sc.render.filepath = PREVIEW
    bpy.ops.render.render(write_still=True)

for f in os.listdir(TMP): os.remove(os.path.join(TMP, f))
os.rmdir(TMP)
