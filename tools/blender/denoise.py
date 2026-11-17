"""Denoise a baked light map with Blender's OpenImageDenoise (compositor Denoise node).

    python3 tools/blender/denoise.py -- in.exr out.exr

Runs as its own Blender session: an empty scene whose compositor reads the image, denoises
it and writes the result (float EXR in, float EXR out).
"""
import bpy, sys

argv = sys.argv[sys.argv.index('--') + 1:]
src, dst = argv[0], argv[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
img = bpy.data.images.load(src)
w, h = img.size
sc.render.engine = 'CYCLES'
sc.cycles.samples = 1
sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = w, h, 100
sc.render.use_compositing = True
try: sc.render.compositor_device = 'CPU'
except Exception: pass
sc.view_settings.view_transform = 'Standard'
sc.render.image_settings.file_format = 'OPEN_EXR'
sc.render.image_settings.color_depth = '32'
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
sc.collection.objects.link(cam)
sc.camera = cam
tree = bpy.data.node_groups.new('Denoise', 'CompositorNodeTree')
tree.interface.new_socket('Image', in_out='OUTPUT', socket_type='NodeSocketColor')
sc.compositing_node_group = tree
inp = tree.nodes.new('CompositorNodeImage'); inp.image = img
dn = tree.nodes.new('CompositorNodeDenoise')
try: dn.prefilter = 'NONE'
except Exception: pass
out = tree.nodes.new('NodeGroupOutput')
tree.links.new(inp.outputs['Image'], dn.inputs['Image'])
tree.links.new(dn.outputs['Image'], out.inputs[0])
sc.render.filepath = dst
bpy.ops.render.render(write_still=True)
print('denoised', dst)
