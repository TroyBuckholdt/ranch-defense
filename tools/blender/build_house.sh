#!/usr/bin/env bash
# Builds the ranch house model and its light maps into client/public/assets/models/house/.
#
#   tools/blender/build_house.sh            # full quality (the bake takes a while on a CPU)
#   RD_BAKE_SAMPLES=16 tools/blender/build_house.sh   # quick look
#
# Needs: Blender as a Python module (pip install bpy), node (gltf-transform via npx).
# Steps: dump the floor plan from shared/world.js, paint the textures, build + bake in
# Blender (full and phone versions), compress (Draco + WebP), light maps to WebP.
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT=client/public/assets/models/house
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
SAMPLES=${RD_BAKE_SAMPLES:-128}

node scripts/houselayout.js > tools/blender/house_layout.json
python3 tools/blender/make_house_textures.py > /dev/null

# the game's furniture models, uncompressed (the Blender importer can't read Draco), so the
# bake gets their shadows: the versions from before they were compressed
mkdir -p "$TMP/props"
for f in diningchair rocker xchair fan; do git show "bc0bbc3:client/public/assets/models/house/$f.glb" > "$TMP/props/$f.glb"; done
git show 369ed6c:client/public/assets/models/potted_plant_02/potted_plant_02_lod.glb > "$TMP/props/pot.glb"

for v in hi lo; do
  flag=""; name=house; size=1024; ls=$SAMPLES
  if [ "$v" = lo ]; then flag=--lo; name=house.lo; size=512; ls=$(( SAMPLES / 2 )); fi
  (cd "$TMP" && RD_PROPS="$TMP/props" RD_BAKE_SAMPLES=$ls python3 "$OLDPWD/tools/blender/make_house.py" -- "$TMP/$v" --bake $flag)
  npx --yes @gltf-transform/cli optimize "$TMP/$v/_$name.raw.glb" "$OUT/$name.glb" --compress draco --texture-compress webp \
    --texture-size $size --prune-attributes false --palette false --join false --flatten false --instance false --simplify false
  python3 -c "from PIL import Image; Image.open('$TMP/$v/${name}_light.png').save('$OUT/${name}_light.webp', quality=90, method=6)"
done
ls -la "$OUT"/house*
