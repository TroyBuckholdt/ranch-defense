# Cuts the four wheels off a one-piece generated truck so the game can spin and steer them.
#
#   blender -b --python tools/blender/split_wheels.py -- in.glb out.glb [preview.png]
#   (or with the `bpy` pip module: python3 tools/blender/split_wheels.py -- in.glb out.glb)
#
# The input must be an uncompressed GLB (Blender's pip module can't read Draco); compress
# the result afterwards. Output nodes: Body, Wheel_FL, Wheel_FR, Wheel_RL, Wheel_RR, each
# wheel with its origin on its axle, plus dark WheelWell discs that close the holes left
# in the arches. The model keeps its original size and axes (length along Blender Y).
import bpy, bmesh, sys, math
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, DST = argv[0], argv[1]
PREVIEW = argv[2] if len(argv) > 2 else None

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
bpy.ops.object.select_all(action='DESELECT')
for o in meshes: o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1: bpy.ops.object.join()
body = bpy.context.view_layer.objects.active
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
body.name = 'Body'

co = [v.co.copy() for v in body.data.vertices]
xs, ys, zs = [c.x for c in co], [c.y for c in co], [c.z for c in co]
xmax = max(abs(min(xs)), abs(max(xs))); zmin = min(zs); length = max(ys) - min(ys)
R = 0.0745 * length                      # a pickup's tyre is about 15% of its length across
zc = zmin + R
wheels = []
for sx in (-1, 1):
    for sy in (-1, 1):
        # where this corner's tyre touches the ground
        patch = sorted(c.y for c in co if c.z < zmin + 0.012 * length and c.x * sx > 0.5 * xmax and c.y * sy > 0)
        yc = patch[len(patch) // 2]
        wheels.append((sx, sy, yc))

bm = bmesh.new(); bm.from_mesh(body.data)
tag = bm.faces.layers.int.new('wheel')
inner = {}
for f in bm.faces:
    for i, (sx, sy, yc) in enumerate(wheels):
        if all(v.co.x * sx > 0.58 * xmax and (v.co.y - yc) ** 2 + (v.co.z - zc) ** 2 < (R * 1.035) ** 2 for v in f.verts):
            f[tag] = i + 1
            inner[i] = min(inner.get(i, 9), min(abs(v.co.x) for v in f.verts))
            break
counts = [sum(1 for f in bm.faces if f[tag] == i + 1) for i in range(4)]
objs = []
for i, (sx, sy, yc) in enumerate(wheels):
    faces = [f for f in bm.faces if f[tag] == i + 1]
    part = bmesh.new()
    vmap = {}
    uvl = bm.loops.layers.uv.active; puv = part.loops.layers.uv.new(uvl.name)
    xin = inner[i]; xmid = sx * (xin + xmax) / 2
    origin = Vector((xmid, yc, zc))
    for f in faces:
        vs = []
        for v in f.verts:
            if v.index not in vmap: vmap[v.index] = part.verts.new(v.co - origin)
            vs.append(vmap[v.index])
        try: nf = part.faces.new(vs)
        except ValueError: continue
        nf.smooth = f.smooth
        for l, nl in zip(f.loops, nf.loops): nl[puv].uv = l[uvl].uv
    me = bpy.data.meshes.new('wheel'); part.to_mesh(me); part.free()
    me.materials.append(body.data.materials[0])
    name = 'Wheel_' + ('F' if sy * (1 if True else 1) > 0 else 'R') + ('L' if sx > 0 else 'R')
    ob = bpy.data.objects.new(name, me); ob.location = origin
    bpy.context.scene.collection.objects.link(ob); objs.append(ob)
    # a dark disc just inboard of the tyre closes the hole left in the arch
    wm = bpy.data.materials.get('WheelWell') or bpy.data.materials.new('WheelWell')
    wm.use_nodes = True; b = wm.node_tree.nodes['Principled BSDF']; b.inputs['Base Color'].default_value = (0.012, 0.012, 0.014, 1); b.inputs['Roughness'].default_value = 0.95
    well = bmesh.new()
    bmesh.ops.create_circle(well, cap_ends=True, radius=R * 1.12, segments=20)
    bmesh.ops.rotate(well, verts=well.verts, cent=(0, 0, 0), matrix=__import__('mathutils').Matrix.Rotation(math.pi / 2 * sx, 3, 'Y'))
    wme = bpy.data.meshes.new('well'); well.to_mesh(wme); well.free(); wme.materials.append(wm)
    wob = bpy.data.objects.new('WheelWell_' + name[-2:], wme); wob.location = Vector((sx * (xin - 0.004 * length), yc, zc + R * 0.08))
    bpy.context.scene.collection.objects.link(wob); objs.append(wob)
bmesh.ops.delete(bm, geom=[f for f in bm.faces if f[tag]], context='FACES')
bm.faces.layers.int.remove(tag)
bm.to_mesh(body.data); bm.free()
print('wheel radius', round(R, 4), 'axle height', round(zc - zmin, 4), 'faces per wheel', counts, 'wheels', [(o.name, [round(v, 3) for v in o.location]) for o in objs if o.name.startswith('Wheel_')])

for o in bpy.context.scene.objects: o.select_set(o.type == 'MESH')
bpy.ops.export_scene.gltf(filepath=DST, export_format='GLB', use_selection=True, export_yup=True, export_animations=False, export_image_format='AUTO')

if PREVIEW:   # pull the wheels out a little and turn the fronts so the split is visible
    for o in objs:
        if o.name.startswith('Wheel_F'): o.rotation_euler = (0.6, 0, 0.45)
    sc = bpy.context.scene
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
    cam.location = (2.1 * length * 0.5, 1.5 * length * 0.5, 0.45 * length * 0.5); cam.data.lens = 50
    d = Vector((0, 0, -0.08 * length)) - cam.location; cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sc.collection.objects.link(sun); sun.rotation_euler = (0.8, 0.1, 1.9); sun.data.energy = 4
    w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True; w.node_tree.nodes['Background'].inputs[0].default_value = (0.6, 0.65, 0.75, 1)
    sc.render.engine = 'CYCLES'; sc.cycles.samples = 16; sc.render.resolution_x, sc.render.resolution_y = 900, 520; sc.render.filepath = PREVIEW
    bpy.ops.render.render(write_still=True)
