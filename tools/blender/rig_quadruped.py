# Rig an AI-generated quadruped (e.g. the Brahman from fal/Rodin) for the game.
#
#   blender -b --python tools/blender/rig_quadruped.py -- in.glb out.glb [length_m]
#
# What it does, with no human in the loop:
#   1. imports the mesh, joins it, finds which way is "forward" (the end with the
#      longest overhang past the legs is the head), and normalises size/orientation
#      (feet on the ground, facing -Y in Blender = +Z in glTF/three.js)
#   2. finds the four legs by clustering the low vertices, builds a skeleton
#      (spine, neck, head, tail, upper/lower leg x4) to fit them
#   3. skins the mesh with region-based weights (robust on messy AI meshes, where
#      Blender's automatic "bone heat" weighting often fails)
#   4. shrinks textures to 1024 px and exports a skinned GLB + a JSON with key points
#      (head, eyes) so the game can line up hitboxes and glowing eyes.
import bpy, bmesh, sys, json, math
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, DST = argv[0], argv[1]
TARGET_LEN = float(argv[2]) if len(argv) > 2 else 2.7   # nose to rump, metres

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)

# ---- 1. one mesh, transforms applied --------------------------------------
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
bpy.ops.object.select_all(action='DESELECT')
for o in meshes: o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1: bpy.ops.object.join()
obj = bpy.context.view_layer.objects.active
for o in list(bpy.context.scene.objects):  # drop empties left by the importer
    if o is not obj and o.type != 'MESH':
        bpy.data.objects.remove(o, do_unlink=True)
obj.parent = None
bpy.ops.object.select_all(action='DESELECT'); obj.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

def verts():
    return [obj.matrix_world @ v.co for v in obj.data.vertices]

def bounds(vs):
    mn = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
    mx = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
    return mn, mx

def transform(fn):
    for v in obj.data.vertices: v.co = fn(v.co)
    obj.data.update()

# long axis -> Y
mn, mx = bounds(verts())
if (mx.x - mn.x) > (mx.y - mn.y):
    transform(lambda c: Vector((c.y, -c.x, c.z)))
mn, mx = bounds(verts())
H = mx.z - mn.z

# legs: low vertices. Head end = the end that overhangs the legs the most.
low = [v for v in verts() if v.z < mn.z + 0.22 * H]
lmn, lmx = bounds(low)
# count the stuff hanging past the legs at each end: a head is chunky, a tail is thin
allv = verts()
mass_neg = sum(1 for v in allv if v.y < lmn.y)
mass_pos = sum(1 for v in allv if v.y > lmx.y)
print(f'overhang mass: -Y {mass_neg}  +Y {mass_pos}')
if mass_pos > mass_neg:   # head is at +Y: turn around so it faces -Y
    transform(lambda c: Vector((-c.x, -c.y, c.z)))

# normalise: feet at z=0, centred between the legs, scaled to TARGET_LEN
mn, mx = bounds(verts())
low = [v for v in verts() if v.z < mn.z + 0.22 * (mx.z - mn.z)]
lmn, lmx = bounds(low)
cx, cy = (lmn.x + lmx.x) / 2, (lmn.y + lmx.y) / 2
s = TARGET_LEN / (mx.y - mn.y)
transform(lambda c: Vector(((c.x - cx) * s, (c.y - cy) * s, (c.z - mn.z) * s)))
mn, mx = bounds(verts())
H, L, W = mx.z - mn.z, mx.y - mn.y, mx.x - mn.x
print(f'normalised: length {L:.2f} height {H:.2f} width {W:.2f}')

# ---- 2. find the legs and key points ---------------------------------------
low = [v for v in verts() if v.z < 0.25 * H]
legs = {}
for name, sx, sy in [('FL', -1, -1), ('FR', 1, -1), ('BL', -1, 1), ('BR', 1, 1)]:
    pts = [v for v in low if (v.x * sx >= 0) and (v.y * sy >= 0)]
    if not pts:  # fallback: guess from the body footprint
        pts = [Vector((sx * W * 0.2, sy * L * 0.25, 0))]
    legs[name] = Vector((sum(p.x for p in pts) / len(pts), sum(p.y for p in pts) / len(pts), 0))
front_y = (legs['FL'].y + legs['FR'].y) / 2
back_y = (legs['BL'].y + legs['BR'].y) / 2
nose = min(verts(), key=lambda v: v.y)
head_pts = [v for v in verts() if v.y < nose.y + 0.16 * L]
head_c = sum(head_pts, Vector()) / len(head_pts)
# eyes: the widest points of the head region, a little behind the nose and above centre
eye_pts = [v for v in verts() if nose.y + 0.08 * L < v.y < nose.y + 0.16 * L and v.z > head_c.z]
eye_l = min(eye_pts, key=lambda v: v.x) if eye_pts else head_c
eye_r = max(eye_pts, key=lambda v: v.x) if eye_pts else head_c
# the body's rear (thick part) vs. the tail (thin part hanging behind it)
body_rear = max((v.y for v in verts() if abs(v.x) > 0.22 * W and v.z > 0.3 * H), default=mx.y)
rump_y = body_rear
back_top = max((v for v in verts() if abs(v.y - back_y) < 0.1 * L), key=lambda v: v.z).z
withers = max((v for v in verts() if abs(v.y - front_y) < 0.12 * L), key=lambda v: v.z).z
hip_z = 0.6 * H
knee_z = 0.3 * H

# ---- 3. skeleton -----------------------------------------------------------
arm_data = bpy.data.armatures.new('Rig')
arm = bpy.data.objects.new('Rig', arm_data)
bpy.context.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')
eb = arm_data.edit_bones

def bone(name, head, tail, parent=None):
    b = eb.new(name); b.head = head; b.tail = tail
    if parent: b.parent = eb[parent]; b.use_connect = False
    return b

bone('root', Vector((0, 0, 0)), Vector((0, 0, 0.3)))
bone('spine', Vector((0, back_y, hip_z)), Vector((0, front_y, hip_z + 0.05 * H)), 'root')
neck_base = Vector((0, front_y - 0.04 * L, min(withers, 0.85 * H) - 0.12 * H))
head_base = Vector((0, head_c.y + 0.07 * L, head_c.z + 0.04 * H))
bone('neck', neck_base, head_base, 'spine')
bone('head', head_base, Vector((0, nose.y, nose.z)), 'neck')
tail_tip = max(verts(), key=lambda v: v.y)
bone('tail', Vector((0, rump_y - 0.02 * L, max(0.6 * H, tail_tip.z + 0.05))), Vector((0, tail_tip.y, tail_tip.z)), 'spine')
for n, p in legs.items():
    parent = 'spine'
    bone(f'leg_{n}_up', Vector((p.x, p.y, hip_z)), Vector((p.x, p.y, knee_z)), parent)
    bone(f'leg_{n}_lo', Vector((p.x, p.y, knee_z)), Vector((p.x, p.y, 0.02)), f'leg_{n}_up')
bpy.ops.object.mode_set(mode='OBJECT')

# ---- 4. weights -----------------------------------------------------------
for b in arm_data.bones: obj.vertex_groups.new(name=b.name)
G = {g.name: g for g in obj.vertex_groups}
smooth = lambda e0, e1, x: max(0.0, min(1.0, (x - e0) / (e1 - e0)))
leg_r = max(0.1 * W, 0.12)
for v in obj.data.vertices:
    c = v.co
    w = {}
    # legs
    near = min(legs.items(), key=lambda kv: (kv[1].x - c.x) ** 2 + (kv[1].y - c.y) ** 2)
    dist = math.hypot(near[1].x - c.x, near[1].y - c.y)
    leg_k = (1 - smooth(0.42 * H, 0.56 * H, c.z)) * (1 - smooth(leg_r * 1.4, leg_r * 2.4, dist))
    if leg_k > 0:
        lo = 1 - smooth(knee_z - 0.06 * H, knee_z + 0.06 * H, c.z)
        w[f'leg_{near[0]}_lo'] = leg_k * lo
        w[f'leg_{near[0]}_up'] = leg_k * (1 - lo)
    rest = 1 - leg_k
    # head / neck in front of the shoulders
    t = smooth(front_y - 0.02 * L, nose.y, c.y) if c.y < front_y else 0
    if t > 0 and rest > 0:
        head_k = smooth(0.55, 0.72, t)
        neck_k = (1 - head_k) * smooth(0.0, 0.2, t)
        w['head'] = rest * head_k
        w['neck'] = rest * neck_k
        rest *= (1 - head_k - neck_k)
    # tail: thin part hanging behind the rump
    if c.y > rump_y - 0.04 * L and abs(c.x) < 0.15 * W and rest > 0:
        tk = smooth(rump_y - 0.04 * L, rump_y + 0.01 * L, c.y)
        w['tail'] = rest * tk
        rest *= (1 - tk)
    if rest > 0: w['spine'] = w.get('spine', 0) + rest
    for name, val in w.items():
        if val > 0.001: G[name].add([v.index], val, 'REPLACE')

mod = obj.modifiers.new('Armature', 'ARMATURE'); mod.object = arm
obj.parent = arm
obj.name = 'Body'

# ---- 5. textures down to 1024, export ----------------------------------------
for img in bpy.data.images:
    if img.size[0] > 1024: img.scale(1024, 1024)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(
    filepath=DST, export_format='GLB', use_selection=True, export_skins=True,
    export_animations=False, export_image_format='JPEG', export_jpeg_quality=85,
    export_yup=True, export_apply=False)

# key points in glTF/three.js space (x, y-up, z-forward): blender (x, y, z) -> (x, z, -y)
to3 = lambda v: [round(v.x, 3), round(v.z, 3), round(-v.y, 3)]
meta = {
    'length': round(L, 3), 'height': round(H, 3), 'width': round(W, 3),
    'nose': to3(nose), 'head': to3(head_c), 'eyeL': to3(eye_l), 'eyeR': to3(eye_r),
    'withers': round(withers, 3), 'back': round(back_top, 3),
    'legs': {k: to3(v) for k, v in legs.items()},
}
json.dump(meta, open(DST.replace('.glb', '.json'), 'w'), indent=1)
print('META', json.dumps(meta))
