// Builds the visible ranch from the shared layout. Collision lives in shared/world.js;
// this file only decides what things look like.
//
// Realism sources:
//  - Sky + lighting: a real HDR sky photo (Poly Haven, CC0) for background and reflections.
//  - Surfaces: photo-scanned PBR materials (Poly Haven, CC0): stucco, clay roof tiles,
//    terracotta, wood, sand, grass, jungle floor, bark.
//  - The ranch's own footage: interior floor tiles + patterned border, Brahman hide.
//  - Models (Poly Haven, CC0): rocking chairs, sofa, dining table, crates, potted plants,
//    ferns and shrubs (simplified for the jungle).
import * as THREE from 'three';
import { tr } from './i18n.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { gltfLoader, texURL, isLowDetail } from './gltf.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  HOUSE, HB, UPPER, HOUSE_PROPS, HOUSE_FANS, HOUSE_LIGHTS, ENTRIES, STRUCTURES, HAY_BALES, TREES, UNDERGROWTH, FENCE_SEGMENTS,
  FENCE_HEIGHT, YARD, MAX_BOARDS, VERANDA, HEDGES, PENS, WALL_BUYS, WEAPONS, heightAt, shoreZ, SAND_WIDTH, trailDist, solidsNear, ROAD, ROAD_HALF, roadDist, VEHICLES as TRUCKS, STATIONS, stationBox,
} from '../../shared/world.js';
import * as T from './textures.js';

const A = '/assets/';
const std = (opts) => new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, ...opts });

function box(w, h, d, mat, x = 0, y = 0, z = 0, parent) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  parent?.add(m);
  return m;
}

// Box with UVs in world units (one texture repeat per `scale` metres) so nothing stretches.
function worldBox(w, h, d, mat, scale = 2) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv, n = g.attributes.normal;
  for (let i = 0; i < uv.count; i++) {
    const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i));
    const [su, sv] = nx > 0.5 ? [d, h] : ny > 0.5 ? [w, d] : [w, h];
    uv.setXY(i, uv.getX(i) * su / scale, uv.getY(i) * sv / scale);
  }
  const m = new THREE.Mesh(g, mat);
  m.castShadow = m.receiveShadow = true;
  return m;
}

function flat(w, d, mat, x, y, z, repeat) {
  const g = new THREE.PlaneGeometry(w, d);
  if (repeat) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / repeat, uv.getY(i) * d / repeat); }
  const m = new THREE.Mesh(g, mat);
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y, z);
  m.receiveShadow = true;
  return m;
}

// ---------------------------------------------------------------- asset loading
const texLoader = new THREE.TextureLoader();
function loadTex(file, srgb = true) {
  const t = texLoader.load(texURL(file));
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
// Poly Haven PBR set: _diff (color), _nor (OpenGL normal), _arm (AO/rough/metal)
function pbr(name, opts = {}) {
  return new THREE.MeshStandardMaterial({
    map: loadTex(`${name}_diff.jpg`),
    normalMap: loadTex(`${name}_nor.jpg`, false),
    roughnessMap: loadTex(`${name}_arm.jpg`, false),
    aoMap: loadTex(`${name}_arm.jpg`, false),
    roughness: 1, metalness: 0, ...opts,
  });
}

async function loadModel(path) {
  const gltf = await gltfLoader().loadAsync(A + 'models/' + path);
  gltf.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return gltf.scene;
}
// first mesh's geometry+material, baked to its world transform, for instancing
function meshOf(scene) {
  scene.updateMatrixWorld(true);
  const meshes = [];
  scene.traverse(o => { if (o.isMesh) meshes.push(o); });
  return meshes.map(m => { const g = m.geometry.clone(); g.applyMatrix4(m.matrixWorld); return { geometry: g, material: m.material }; });
}
// uniformly scale a model to `w` wide (its longest horizontal side), feet on the floor
function fitModel(model, w, rotateToX = true) {
  const b = new THREE.Box3().setFromObject(model);
  const size = b.getSize(new THREE.Vector3());
  const holder = new THREE.Group();
  const longAlongZ = size.z > size.x;
  model.position.sub(new THREE.Vector3((b.min.x + b.max.x) / 2, b.min.y, (b.min.z + b.max.z) / 2));
  holder.add(model);
  if (rotateToX && longAlongZ) holder.rotation.y = Math.PI / 2;
  holder.scale.setScalar(w / Math.max(size.x, size.z));
  return holder;
}

// real heights, and the turn that points each model's nose toward the front garden (+Z)
const VEHICLE_FIT = {
  f150: { length: 5.75, yaw: 0, tint: [0.6, 0.61, 0.64] },  // Carbonized Gray
  chevy: { length: 5.84, yaw: 0 },
  boat: { length: 8.2, yaw: 0 },                               // Cobalt 232 on its trailer, tongue toward the front
};

// scale a generated model to its real height, centred, feet on the floor, front facing +Z
function fitReal(model, height, tint) {
  const m = model.clone();
  const b = new THREE.Box3().setFromObject(m);
  const size = b.getSize(new THREE.Vector3());
  m.position.sub(new THREE.Vector3((b.min.x + b.max.x) / 2, b.min.y, (b.min.z + b.max.z) / 2));
  const holder = new THREE.Group();
  holder.add(m);
  holder.scale.setScalar(height / size.y);
  m.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = o.receiveShadow = true;
    if (tint && !o.material.userData.tinted) { o.material.color.multiply(new THREE.Color(...tint)); o.material.userData.tinted = true; }
  });
  return holder;
}

// A table with a draped cloth (veranda)
function clothTable(w, d, h, clothMat) {
  const g = new THREE.Group();
  const cloth = worldBox(w + 0.12, 0.32, d + 0.12, clothMat, 1.2); cloth.position.y = h - 0.15; g.add(cloth);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.05, h - 0.3, 0.05, M.darkWoodTable, sx * (w / 2 - 0.08), (h - 0.3) / 2, sz * (d / 2 - 0.08), g);
  return g;
}

let M;
function mats() {
  if (M) return M;
  M = {
    stucco: pbr('white_stucco', { color: 0xf6f1e6 }),
    stuccoIn: pbr('white_stucco', { color: 0xfaf6ee }),
    terracotta: pbr('terracotta_floor_tiles', { color: 0xe6b8a0 }),
    roof: pbr('clay_roof_tiles_02', { side: THREE.DoubleSide }),
    darkWood: pbr('dark_wood', { color: 0x8a6a58 }),
    planks: pbr('weathered_planks', { color: 0xd8c0a0 }),
    bark: pbr('bark_brown_02', { color: 0xb0a898 }),
    palmBark: pbr('palm_bark'),
    coconut: std({ color: 0x4a5a22, roughness: 0.55 }),
    sand: pbr('coast_sand_01'),
    floor: new THREE.MeshStandardMaterial({ map: loadTex('ranch_floor.jpg'), roughness: 0.32, metalness: 0 }),
    border: new THREE.MeshStandardMaterial({ map: loadTex('ranch_border.jpg'), roughness: 0.32 }),
    dado: std({ color: 0xcdb48a, roughness: 0.6 }),
    darkWoodTable: pbr('dark_wood', { color: 0x4a2c20, roughness: 0.45 }),
    marble: new THREE.MeshStandardMaterial({ map: T.marble(), roughness: 0.12, metalness: 0.0 }),
    iron: std({ color: 0x141416, roughness: 0.45, metalness: 0.7 }),
    bluePipe: std({ color: 0x2c4f9a, roughness: 0.45, metalness: 0.5 }),
    hedge: std({ map: T.foliage(), color: 0x6a9a50, roughness: 1 }),
    flower: std({ color: 0xd8341f, roughness: 0.8 }),
    water: new THREE.MeshStandardMaterial({ color: 0x2a6f72, roughness: 0.04, metalness: 0.0, transparent: true, opacity: 0.86, normalMap: T.waterNormals(), normalScale: new THREE.Vector2(0.35, 0.35), envMapIntensity: 1.3 }),
  };
  for (const m of [M.stucco, M.stuccoIn, M.terracotta, M.roof, M.darkWood, M.planks, M.bark, M.palmBark, M.sand]) {
    for (const k of ['map', 'normalMap', 'roughnessMap', 'aoMap']) m[k] && m[k].repeat.set(1, 1);
  }
  return M;
}

// ---------------------------------------------------------------- build
export async function buildWorld(renderer, Q = { shadows: 2048, grass: 26000 }, onProgress = () => {}) {
  const scene = new THREE.Scene();
  const updaters = [];
  mats();

  // ---------- Real sky photo for background + image-based lighting ----------
  onProgress('Loading the sky...');
  const hdr = await new HDRLoader().loadAsync(A + (isLowDetail() ? 'hdri/kloofendal_lo.hdr' : 'hdri/kloofendal_48d_partly_cloudy_puresky.hdr'));
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  scene.background = hdr;
  scene.backgroundIntensity = 0.9;
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromEquirectangular(hdr).texture;
  scene.environmentIntensity = 0.9;
  const sunDir = brightestDirection(hdr);

  installFog(sunDir.raw);
  scene.fog = new THREE.FogExp2(0xb9c4cc, 0.0034);

  const sun = new THREE.DirectionalLight(0xfff0dc, 3.2);
  sun.castShadow = Q.shadows > 0;
  sun.shadow.mapSize.set(Q.shadows || 512, Q.shadows || 512);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -55; sc.right = sc.top = 55; sc.near = 1; sc.far = 400;
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);
  // keep the shadow box centred on the camera, snapped to texels to stop shimmering
  const texel = 110 / (Q.shadows || 512);
  updaters.push((dt, t, cam) => {
    if (!cam) return;
    const cx = Math.round(cam.x / texel) * texel, cz = Math.round(cam.z / texel) * texel;
    sun.target.position.set(cx, 0, cz);
    sun.position.set(cx + sunDir.x * 200, sunDir.y * 200, cz + sunDir.z * 200);
  });

  // ---------- Terrain, sea ----------
  onProgress('Shaping the land...');
  scene.add(buildTerrain());
  const sea = buildSea();
  scene.add(sea.group);
  updaters.push(sea.update);
  scene.add(flat(2.6, 8, M.terracotta, 0, 0.03, 13.6, 1.2));
  scene.add(flat(6, 6, M.terracotta, 0, 0.025, 19, 1.2));

  // ---------- Hacienda + grounds ----------
  onProgress('Building the hacienda...');
  const models = await loadAllModels();
  const house = await buildHouse(updaters, models, Q);
  scene.add(house.group);
  scene.add(buildVeranda(models));
  for (const s of STRUCTURES) { const m = buildStructure(s, updaters, models); if (m) scene.add(m); }
  for (const b of HAY_BALES) scene.add(hayBale(b));
  scene.add(buildGardenWall());
  scene.add(buildHedges(models));
  for (const p of PENS) scene.add(buildPen(p));
  for (const b of WALL_BUYS) scene.add(buildBuySign(b));

  // ---------- Jungle ----------
  onProgress('Growing the jungle...');
  const veg = buildVegetation(models, Q);
  scene.add(veg.group);
  updaters.push(veg.update);
  const grass = buildGrass(Q.grass);
  scene.add(grass.mesh);
  updaters.push(grass.update);

  if (Q.msaa > 0) {
    scene.traverse((o) => {
      if (!o.material) return;
      for (const m of [].concat(o.material)) if (m.alphaTest > 0) { m.alphaToCoverage = true; m.needsUpdate = true; }
    });
  }

  // the two pickups are driven around, so main.js owns them: hand over a fitted model each
  const trucks = TRUCKS.map(def => {
    const v = VEHICLE_FIT[def.kind];
    const sz = new THREE.Box3().setFromObject(models[def.kind]).getSize(new THREE.Vector3());
    const m = fitReal(models[def.kind], v.length * sz.y / Math.max(sz.x, sz.z), v.tint);
    m.rotation.y = v.yaw;
    return { def, model: m };
  });

  return {
    trucks, machineModel: models.machines,
    scene, sun, sunDir: sunDir.raw, lightDir: sunDir.clone(), boards: house.boards, grilles: house.grilles, leaves: house.leaves,
    update(dt, t, camPos) { for (const u of updaters) u(dt, t, camPos); },
  };
}

// Atmosphere: distance haze plus low-lying tropical mist that thins with height, tinted
// warm when looking toward the sun. Replaces three's fog chunks for every material, so
// it must run before anything compiles.
let SUN_GLSL = 'vec3(0.4, 0.8, 0.4)';
function installFog(sun) {
  const f = (v) => v.toFixed(4);
  SUN_GLSL = `vec3(${f(sun.x)}, ${f(sun.y)}, ${f(sun.z)})`;
  THREE.ShaderChunk.fog_pars_vertex = '#ifdef USE_FOG\n varying float vFogDepth;\n varying vec3 vFogRay;\n#endif';
  THREE.ShaderChunk.fog_vertex = '#ifdef USE_FOG\n vFogDepth = - mvPosition.z;\n vFogRay = (vec4(mvPosition.xyz, 0.0) * viewMatrix).xyz;\n#endif';
  THREE.ShaderChunk.fog_pars_fragment = `#ifdef USE_FOG
uniform vec3 fogColor; varying float vFogDepth; varying vec3 vFogRay;
#ifdef FOG_EXP2
uniform float fogDensity;
#else
uniform float fogNear; uniform float fogFar;
#endif
#endif`;
  THREE.ShaderChunk.fog_fragment = `#ifdef USE_FOG
{
  float fDist = length(vFogRay);
  vec3 fDir = vFogRay / max(fDist, 1e-4);
#ifdef FOG_EXP2
  float haze = fogDensity * fogDensity * fDist * fDist;
  const float MIST_A = 0.0019, MIST_B = 0.11;
  float k = MIST_B * fDir.y * fDist;
  float mist = MIST_A * exp(-MIST_B * cameraPosition.y) * fDist * (abs(k) > 0.001 ? (1.0 - exp(-k)) / k : 1.0);
  float fogFactor = 1.0 - exp(-(haze + mist));
#else
  float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
#endif
  float toSun = pow(max(dot(fDir, vec3(${f(sun.x)}, ${f(sun.y)}, ${f(sun.z)})), 0.0), 6.0);
  vec3 fCol = fogColor * mix(vec3(1.0), vec3(1.4, 1.18, 0.86), toSun);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fCol, fogFactor);
}
#endif`;

  // Indoors the sky can't see you: cut sky/ambient light inside the house (and partly under
  // the veranda roof) to a dim, warm bounce, the way baked lighting would. Sun patches
  // through doors and windows then read properly against the darker room.
  const f2 = (v) => v.toFixed(2), WH = f2(HOUSE.wallH + 0.25);
  THREE.ShaderChunk.lights_fragment_maps = THREE.ShaderChunk.lights_fragment_maps.split('// RD-INDOOR')[0] + `// RD-INDOOR
#ifdef USE_FOG
{
  vec3 wpI = cameraPosition + vFogRay;
  float inHouse = step(${f2(HB.x0)}, wpI.x) * step(wpI.x, ${f2(HB.x1)}) * step(${f2(HB.z0)}, wpI.z) * step(wpI.z, ${f2(HB.z1)}) * step(wpI.y, ${WH});
  float inPorch = step(${f2(HB.x0 - 0.4)}, wpI.x) * step(wpI.x, ${f2(HB.x1 + 0.4)}) * step(${f2(HB.z1)}, wpI.z) * step(wpI.z, ${f2(HB.z1 + 4.9)}) * step(wpI.y, ${WH});
  float inUp = step(${f2(UPPER.x0)}, wpI.x) * step(wpI.x, ${f2(UPPER.x1)}) * step(${f2(UPPER.z0)}, wpI.z) * step(wpI.z, ${f2(UPPER.loggiaZ)}) * step(${f2(UPPER.y - 0.1)}, wpI.y) * step(wpI.y, ${f2(UPPER.y + UPPER.h)});
  float occI = 1.0 - inHouse * 0.6 - inPorch * 0.4 - inUp * 0.5;
  vec3 warmI = mix(vec3(1.0), vec3(1.1, 0.97, 0.84), 1.0 - occI);
#ifdef RD_BAKED
  // the house's own surfaces: the light map already holds the sky and the bounced light.
  // Indoors it's lifted the way eyes adjust coming in out of the sun (the real rooms read
  // bright and white), with a little fill so ceilings don't go black.
#if defined( RE_IndirectDiffuse )
  iblIrradiance *= 0.0;
  float insideB = clamp(inHouse + inUp, 0.0, 1.0);
  irradiance = irradiance * (1.0 + insideB * 3.2) + insideB * vec3(0.22, 0.21, 0.19);
#endif
#if defined( RE_IndirectSpecular ) && defined( USE_LIGHTMAP )
  radiance *= clamp(dot(lightMapIrradiance, vec3(0.3, 0.59, 0.11)) * 0.5, 0.04, 1.0);
#endif
#else
#if defined( RE_IndirectDiffuse )
  iblIrradiance *= occI * warmI;
  irradiance *= mix(1.0, occI, 0.85) * warmI;
#endif
#if defined( RE_IndirectSpecular )
  radiance *= occI * 0.7 + 0.3;
#endif
#endif
#ifndef USE_SHADOWMAP
  reflectedLight.directDiffuse *= mix(1.0, 0.3, inHouse);
  reflectedLight.directSpecular *= mix(1.0, 0.3, inHouse);
#endif
}
#endif
`;
}

// Find the sun in the HDR photo so the shadow-casting light matches it.
// (three's equirect lookup: u = atan(z, x)/2pi + 0.5, v = asin(y)/pi + 0.5; rows are flipped)
function brightestDirection(tex) {
  const { data, width, height } = tex.image;
  const stride = data.length / (width * height);
  const f = data instanceof Uint16Array ? THREE.DataUtils.fromHalfFloat : (h) => h;
  let best = -1, bx = 0, by = 0;
  for (let y = 0; y < height / 2; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * stride;
    const v = f(data[i]) + f(data[i + 1]) + f(data[i + 2]);
    if (v > best) { best = v; bx = x; by = y; }
  }
  const u = (bx + 0.5) / width, v = 1 - (by + 0.5) / height;
  const ang = (u - 0.5) * Math.PI * 2, lat = (v - 0.5) * Math.PI;
  const dir = new THREE.Vector3(Math.cos(ang) * Math.cos(lat), Math.sin(lat), Math.sin(ang) * Math.cos(lat));
  const raw = dir.clone().normalize();
  if (dir.y < 0.35) { dir.y = 0.35; } // keep shadows from getting absurdly long
  dir.normalize();
  dir.raw = raw; // where the sun actually is in the sky photo (for light shafts / flare)
  return dir;
}

async function loadAllModels() {
  const names = {
    pot: 'potted_plant_02/potted_plant_02_lod.glb', fern: 'fern_02/fern_02_lod.glb',
    shrub: 'shrub_04/shrub_04_lod.glb',
    // the house itself (tools/blender/make_house.py) and the furniture generated from the family photos
    house: 'house/house.glb',
    caneRocker: 'house/rocker.glb', fan: 'house/fan.glb', diningChair: 'house/diningchair.glb', xchair: 'house/xchair.glb',
    f150: 'vehicles/f150.glb', chevy: 'vehicles/chevy.glb', boat: 'vehicles/boat.glb',
    trees: 'trees/trees.glb',   // tools/blender/make_trees.py
    machines: 'machines/machines.glb',   // tools/blender/make_machines.py
  };
  const out = {};
  await Promise.all(Object.entries(names).map(async ([k, p]) => { out[k] = await loadModel(p); }));
  return out;
}

// ---------------------------------------------------------------- terrain
function buildTerrain() {
  const W = 540, D = 540, cz = 40, seg = 270;
  const g = new THREE.PlaneGeometry(W, D, seg, seg);
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0, cz);
  const pos = g.attributes.position, uv = g.attributes.uv;
  const splat = new Float32Array(pos.count * 4);
  const road = new Float32Array(pos.count);
  const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, heightAt(x, z));
    uv.setXY(i, x / 3, z / 3);
    const sz = shoreZ(x);
    const sand = smooth(sz - SAND_WIDTH - 2, sz - SAND_WIDTH + 5, z);
    const r = Math.hypot(x, z * 1.1);
    const trail = r > 45 ? 1 - smooth(1.2, 3.4, trailDist(x, z)) : 0;
    const jungle = smooth(72, 96, r);
    const rest = (1 - trail) * (1 - sand);
    splat[i * 4] = rest * (1 - jungle);      // grass
    splat[i * 4 + 1] = rest * jungle;        // jungle floor
    splat[i * 4 + 2] = (1 - trail) * sand;   // sand
    splat[i * 4 + 3] = trail;                // dirt trail
    road[i] = 1 - smooth(ROAD_HALF + 1.5, ROAD_HALF + 6, roadDist(x, z)); // where the shader should look for the road
  }
  g.setAttribute('splat', new THREE.BufferAttribute(splat, 4));
  g.setAttribute('road', new THREE.BufferAttribute(road, 1));
  g.computeVertexNormals();

  const tex = (n, srgb = true) => loadTex(n, srgb);
  const mat = new THREE.MeshStandardMaterial({
    map: tex('leafy_grass_diff.jpg'), normalMap: tex('forest_leaves_02_nor.jpg', false),
    normalScale: new THREE.Vector2(0.8, 0.8), roughness: 1, color: 0xffffff,
  });
  const uni = {
    tJungle: { value: tex('forest_leaves_02_diff.jpg') }, tSand: { value: tex('coast_sand_01_diff.jpg') },
    tTrail: { value: tex('brown_mud_leaves_01_diff.jpg') }, tMacro: { value: T.macroNoise() },
    uRoad: { value: ROAD.map(p => new THREE.Vector2(p[0], p[1])) },
  };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uni);
    sh.vertexShader = 'attribute vec4 splat;\nattribute float road;\nvarying float vRoad;\nvarying vec4 vSplat;\nvarying vec2 vWXZ;\nvarying float vWY;\n' + sh.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      vSplat = splat; vRoad = road;
      vec4 wp4 = modelMatrix * vec4(transformed, 1.0);
      vWXZ = wp4.xz; vWY = wp4.y;`);
    sh.fragmentShader = `uniform sampler2D tJungle, tSand, tTrail, tMacro;\nuniform vec2 uRoad[${ROAD.length}];\nvarying float vRoad;\n` + 'varying vec4 vSplat;\nvarying vec2 vWXZ;\nvarying float vWY;\n' + sh.fragmentShader.replace('#include <roughnessmap_fragment>', `
      #include <roughnessmap_fragment>
      roughnessFactor = mix(roughnessFactor, 0.22, (1.0 - smoothstep(0.0, 0.45, vWY)) * vSplat.z);`).replace('#include <map_fragment>', `
      vec2 tuv = vWXZ / 3.0;
      // each layer gets its own tint: pasture, dark leaf litter under the trees, pale sand
      vec4 cg = texture2D(map, tuv) * vec4(0.40, 0.56, 0.20, 1.0);
      // inside the yard fence: a mowed, watered lawn with faint mowing stripes
      float yd = max(max(${YARD.minX.toFixed(1)} - vWXZ.x, vWXZ.x - ${YARD.maxX.toFixed(1)}), max(${YARD.minZ.toFixed(1)} - vWXZ.y, vWXZ.y - ${YARD.maxZ.toFixed(1)}));
      float lawn = 1.0 - smoothstep(-3.0, 2.0, yd);
      float stripe = smoothstep(0.35, 0.65, abs(fract(vWXZ.x / 7.0) - 0.5) * 2.0);
      cg.rgb = mix(cg.rgb, texture2D(map, tuv * 1.7).rgb * vec3(0.30, 0.52, 0.16) * mix(0.93, 1.07, stripe), lawn);
      vec4 cj = texture2D(tJungle, tuv * 0.8) * vec4(0.44, 0.42, 0.27, 1.0);
      vec4 cs = texture2D(tSand, tuv * 0.9) * vec4(1.02, 0.96, 0.84, 1.0);
      vec4 ct = texture2D(tTrail, tuv) * vec4(0.62, 0.55, 0.42, 1.0);
      vec4 col = cg * vSplat.x + cj * vSplat.y + cs * vSplat.z + ct * vSplat.w;
      float macro = texture2D(tMacro, vWXZ / 70.0).r;
      col.rgb *= mix(0.78, 1.18, macro);
      // the road: pale crushed limestone, two darker wheel tracks, weeds down the middle,
      // a ragged edge where the verge grows in
      if (vRoad > 0.01) {
        float rd = 99.0;
        for (int i = 0; i < ${ROAD.length - 1}; i++) {
          vec2 a = uRoad[i], ab = uRoad[i + 1] - a;
          float t = clamp(dot(vWXZ - a, ab) / dot(ab, ab), 0.0, 1.0);
          rd = min(rd, distance(vWXZ, a + ab * t));
        }
        float fine = texture2D(tMacro, vWXZ / 9.0).r, mid = texture2D(tMacro, vWXZ / 27.0 + 0.37).r;
        float edge = 1.0 - smoothstep(${(ROAD_HALF - 0.9).toFixed(2)}, ${(ROAD_HALF + 0.25).toFixed(2)}, rd + (mid - 0.5) * 1.3);
        vec3 stone = texture2D(tSand, tuv * 1.6).rgb * vec3(1.16, 1.12, 1.03) * mix(0.86, 1.08, fine);
        float rut = (1.0 - smoothstep(0.1, 0.55, abs(rd - 0.92))) * 0.7;
        stone *= mix(1.0, 0.8, rut);
        float weeds = (1.0 - smoothstep(0.12, 0.5, rd)) * smoothstep(0.42, 0.6, mid) * 0.75;
        stone = mix(stone, cg.rgb * 0.85, weeds);
        col.rgb = mix(col.rgb, stone * 0.9, edge);
      }
      // sand darkens where the swash keeps it wet, and more so under the water
      float wet = 1.0 - smoothstep(0.0, 0.45, vWY);
      col.rgb *= mix(1.0, 0.6, wet * vSplat.z);
      diffuseColor *= col;`);
  };
  const m = new THREE.Mesh(g, mat);
  m.receiveShadow = true;
  return m;
}

// The ocean: a grid that is fine at the shoreline and coarse out at sea, long swells in the
// vertex shader (fading out in the shallows), three layers of scrolling normal detail sampled
// in world space so the tiling never lines up, depth-based colour and opacity, and foam plus a
// creeping swash where it meets the sand.
function buildSea() {
  const group = new THREE.Group();
  const xs = [];
  for (let x = -720; x < -260; x += 20) xs.push(x);
  for (let x = -260; x < 260; x += 3) xs.push(x);
  for (let x = 260; x <= 720; x += 20) xs.push(x);
  const zs = [];
  for (let z = 138, dz = 0.8; z < 980; z += dz) { zs.push(z); if (z > 236) dz = Math.min(dz * 1.08, 30); }
  const nx = xs.length, nz = zs.length;
  const pos = new Float32Array(nx * nz * 3), col = new Float32Array(nx * nz * 3), dep = new Float32Array(nx * nz), seaK = new Float32Array(nx * nz);
  const shallow = new THREE.Color(0x5cc4b4), mid = new THREE.Color(0x238a96), deep = new THREE.Color(0x123f63), c = new THREE.Color();
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i, x = xs[i], z = zs[j];
    const d = z > 300 ? 4 + (z - 300) * 0.05 : Math.max(-2, -heightAt(x, z));
    pos.set([x, 0, z], k * 3);
    dep[k] = d;
    const sz = shoreZ(x);
    seaK[k] = Math.max(0, Math.min(1, (z - (sz - 9)) / 6)); // 0 in lagoons behind the beach
    if (d < 2.5) c.copy(shallow).lerp(mid, Math.max(0, d) / 2.5); else c.copy(mid).lerp(deep, Math.min(1, (d - 2.5) / 12));
    col.set([c.r, c.g, c.b], k * 3);
  }
  const idx = [];
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, cc = a + nx, d = cc + 1;
    idx.push(a, cc, b, b, cc, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aDepth', new THREE.BufferAttribute(dep, 1));
  g.setAttribute('aSea', new THREE.BufferAttribute(seaK, 1));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nx * nz * 3).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setIndex(idx);
  g.computeBoundingSphere();

  const nTex = loadTex('waternormals.jpg', false);
  nTex.wrapS = nTex.wrapT = THREE.RepeatWrapping;
  const uni = { uTime: { value: 0 }, uNormalTex: { value: nTex } };
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.05, metalness: 0, transparent: true, envMapIntensity: 1.15 });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uni);
    sh.vertexShader = `attribute float aDepth; attribute float aSea;
uniform float uTime;
varying float vDepth; varying float vSea; varying vec3 vWPos; varying vec3 vWNormal;
` + sh.vertexShader.replace('#include <beginnormal_vertex>', `
  // three swells; their amplitude dies away in the shallows
  float amp = 0.04 + 0.34 * smoothstep(0.4, 5.0, aDepth);
  vec2 wp = position.xz;
  vec2 k1 = vec2(0.018, 0.105), k2 = vec2(-0.052, 0.071), k3 = vec2(0.13, 0.047);
  float p1 = dot(wp, k1) - uTime * 1.05, p2 = dot(wp, k2) - uTime * 0.85 + 1.3, p3 = dot(wp, k3) - uTime * 1.6 + 2.1;
  float dhx = amp * (0.55 * cos(p1) * k1.x + 0.3 * cos(p2) * k2.x + 0.15 * cos(p3) * k3.x);
  float dhz = amp * (0.55 * cos(p1) * k1.y + 0.3 * cos(p2) * k2.y + 0.15 * cos(p3) * k3.y);
  vec3 objectNormal = normalize(vec3(-dhx, 1.0, -dhz));
  vWNormal = objectNormal;`).replace('#include <begin_vertex>', `
  vec3 transformed = vec3(position);
  transformed.y += amp * (0.55 * sin(p1) + 0.3 * sin(p2) + 0.15 * sin(p3));
  // swash: the water's edge creeps up and back down the beach
  transformed.y += 0.07 * sin(uTime * 0.55 + position.x * 0.03) * (1.0 - smoothstep(0.0, 2.0, aDepth)) * aSea;
  vDepth = aDepth; vSea = aSea;
  vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    sh.fragmentShader = `uniform float uTime; uniform sampler2D uNormalTex;
varying float vDepth; varying float vSea; varying vec3 vWPos; varying vec3 vWNormal;
` + sh.fragmentShader.replace('#include <normal_fragment_maps>', `
  {
    vec2 q = vWPos.xz;
    vec3 n1 = texture2D(uNormalTex, q * 0.045 + vec2(uTime * 0.012, uTime * 0.008)).xyz * 2.0 - 1.0;
    vec3 n2 = texture2D(uNormalTex, q * 0.013 + vec2(-uTime * 0.005, uTime * 0.009)).xyz * 2.0 - 1.0;
    vec3 n3 = texture2D(uNormalTex, q * 0.0031 + vec2(uTime * 0.0015, -uTime * 0.0011)).xyz * 2.0 - 1.0;
    float dist = length(vWPos - cameraPosition);
    float strength = mix(0.55, 0.18, smoothstep(20.0, 400.0, dist));
    vec2 slope = (n1.xy * 0.55 + n2.xy * 0.6 + n3.xy * 0.7) * strength;
    vec3 Nw = normalize(vWNormal + vec3(slope.x, 0.0, slope.y));
    normal = normalize((viewMatrix * vec4(Nw, 0.0)).xyz);
  }`).replace('#include <color_fragment>', `
  #include <color_fragment>
  float swash = 0.07 * sin(uTime * 0.55 + vWPos.x * 0.03);
  float edge = vDepth + swash * 3.0;
  float foamTex = texture2D(uNormalTex, vWPos.xz * 0.21 + vec2(0.0, uTime * 0.03)).r * texture2D(uNormalTex, vWPos.xz * 0.07 - uTime * 0.01).g;
  float foam = (1.0 - smoothstep(0.02, 0.55, edge)) * smoothstep(0.12, 0.38, foamTex);
  foam += (1.0 - smoothstep(0.0, 0.12, edge)) * 0.6;
  foam = clamp(foam, 0.0, 1.0) * vSea;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.95, 0.94), foam);
  diffuseColor.a = max(mix(0.28, 0.93, smoothstep(0.0, 2.8, vDepth)), foam * 0.95);`).replace('#include <roughnessmap_fragment>', `
  #include <roughnessmap_fragment>
  roughnessFactor = mix(roughnessFactor, 0.85, foam);`);
  };
  const sea = new THREE.Mesh(g, mat);
  sea.receiveShadow = true;
  sea.frustumCulled = false;
  group.add(sea);

  return {
    group,
    update(dt, t) { uni.uTime.value = t; },
  };
}

// ---------------------------------------------------------------- house
// The house is a Blender model (tools/blender/make_house.py, built by build_house.sh) traced
// from the family's walk-through video and generated from the same floor plan as the collision
// in shared/world.js. Its big surfaces carry a baked light map: the sky's light through the
// doors and windows and the sun's light bounced round the rooms (the sun's own light and
// shadows are drawn live). Here the game adds what moves or is shared: the boards over the
// doors and windows, the glazed leaves and grilles the cows break open, the furniture models
// (instanced), the spinning fans and the lights.
const LIGHTMAP_GAIN = 1.5 * Math.PI * 1.9;   // undo the bake's 8-bit packing (see make_house.py), plus a lift for the eye
async function buildHouse(updaters, models, Q) {
  const group = new THREE.Group();
  const house = models.house;
  group.add(house);
  const lm = await new Promise((res) => texLoader.load(`${A}models/house/${isLowDetail() ? 'house.lo' : 'house'}_light.webp`, res, undefined, () => res(null)));
  if (lm) { lm.flipY = false; lm.channel = 1; lm.colorSpace = THREE.SRGBColorSpace; }
  const baked = new Map();
  const under = (o, name) => { for (let p = o; p; p = p.parent) if (p.name === name) return true; return false; };
  house.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = o.receiveShadow = true;
    const m = o.material;
    if (m.transparent) { m.depthWrite = false; o.castShadow = false; }
    if (lm && under(o, 'House')) {
      if (!baked.has(m)) {
        const b = m.clone();
        b.lightMap = lm; b.lightMapIntensity = LIGHTMAP_GAIN;
        b.defines = { ...(b.defines || {}), RD_BAKED: '' };
        baked.set(m, b);
      }
      o.material = baked.get(m);
    }
  });

  // the French doors the cows come through: glazed leaves (shut until the last board goes,
  // then they swing in) and the grille outside
  const leaves = [], grilles = [];
  for (const e of ENTRIES) {
    grilles[e.id] = house.getObjectByName(`Grille_${e.id}`) || null;
    const pair = ['L', 'R'].map((s) => house.getObjectByName(`Leaf_${e.id}_${s}`)).filter(Boolean);
    if (!pair.length) continue;
    const ent = { nodes: pair, open: false, k: 0, dir: [] };
    for (const n of pair) { // which way round opens it into the room
      const c = new THREE.Box3().setFromObject(n).getCenter(new THREE.Vector3());
      const tx = c.x - n.position.x, tz = c.z - n.position.z;
      ent.dir.push(Math.sign(tz * -e.nx - tx * -e.nz) || 1);
    }
    leaves[e.id] = ent;
  }
  updaters.push((dt) => {
    for (const ent of leaves) {
      if (!ent) continue;
      const goal = ent.open ? 1 : 0;
      if (ent.k === goal) continue;
      ent.k = ent.open ? Math.min(1, ent.k + dt * 2.5) : Math.max(0, ent.k - dt * 1.5);
      const a = (1 - Math.pow(1 - ent.k, 3)) * 1.75;   // bursts open, slows as it swings
      ent.nodes.forEach((n, i) => { n.rotation.y = ent.dir[i] * a; });
    }
  });

  // boards over every door and window, nailed on the inside
  const boards = [];
  const { t } = HOUSE;
  for (const e of ENTRIES) {
    const alongX = e.nx === 0, W = e.width;
    const list = [];
    const span = e.top - e.sill;
    const boardH = Math.min(0.32, (span / MAX_BOARDS) * 0.62);
    for (let i = 0; i < MAX_BOARDS; i++) {
      const g = new THREE.BoxGeometry(W + 0.45, boardH, 0.05);
      const uv = g.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * 1.2 + i * 0.37, uv.getY(k) * 0.15 + i * 0.13);
      const b = new THREE.Mesh(g, M.planks);
      const y = e.y + e.sill + span * ((i + 0.5) / MAX_BOARDS);
      const tilt = Math.sin(e.id * 7.1 + i * 3.3) * 0.22;
      const wt = e.level ? 0.25 : t;
      b.position.set(e.x - e.nx * (wt / 2 + 0.06), y, e.z - e.nz * (wt / 2 + 0.06));
      b.rotation.set(0, alongX ? 0 : Math.PI / 2, tilt);
      b.castShadow = true;
      group.add(b);
      list.push(b);
    }
    boards.push(list);
  }

  group.add(placeProps(models));

  // the bronze ceiling fans, each with a warm bulb that flickers when the power wavers, and
  // the hanging lanterns and the stairwell chandelier
  const lights = Q.shadows > 0 ? 7 : 3;
  HOUSE_FANS.forEach(([x, z, ceil = HOUSE.wallH], i) => {
    const fan = new THREE.Group();
    const model = fitModel(models.fan.clone(), 1.3, false);
    const fh = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3()).y;
    model.position.y = -fh;
    model.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; } });
    fan.add(model);
    fan.position.set(x, ceil - 0.02, z);
    group.add(fan);
    let light = null;
    if (i < lights - 2) { light = new THREE.PointLight(0xffc890, 5, 11, 1.6); light.position.y = -fh - 0.05; fan.add(light); }
    const seed = x * 13.1 + z;
    updaters.push((dt, time) => {
      model.rotation.y += dt * 4.5;
      if (light) light.intensity = (Math.sin(time * 23 + seed) * Math.sin(time * 7.3 + seed * 2) > 0.93 ? 0.15 : 1) * 5;
    });
  });
  HOUSE_LIGHTS.slice(0, 2).forEach(([x, y, z]) => {
    const l = new THREE.PointLight(0xffd29a, 4, 9, 1.6); l.position.set(x, y + 0.1, z); group.add(l);
  });
  return { group, boards, grilles, leaves };
}

// The furniture the house shares with other places (dining chairs, cane rockers, bentwood
// chairs, potted plants), placed from shared/world.js HOUSE_PROPS, one instanced mesh per part.
function placeProps(models) {
  const g = new THREE.Group();
  const byModel = {};
  for (const p of HOUSE_PROPS) (byModel[p[0]] ||= []).push(p);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  for (const [key, list] of Object.entries(byModel)) {
    const src = models[key];
    if (!src) continue;
    const b = new THREE.Box3().setFromObject(src), size = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
    for (const part of meshOf(src)) {
      const mesh = new THREE.InstancedMesh(part.geometry, part.material, list.length);
      list.forEach(([, x, z, yaw, h, tint], i) => {
        const k = (key === 'pot' ? h / Math.max(size.x, size.z) : h / size.y);
        m4.compose(new THREE.Vector3(x, 0.04, z), q.setFromAxisAngle(up, yaw), new THREE.Vector3(k, k, k));
        m4.multiply(new THREE.Matrix4().makeTranslation(-c.x, -b.min.y, -c.z));
        mesh.setMatrixAt(i, m4);
        if (tint) mesh.setColorAt(i, new THREE.Color(...tint));
        else if (list.some(l => l[5])) mesh.setColorAt(i, new THREE.Color(1, 1, 1));
      });
      mesh.castShadow = mesh.receiveShadow = true;
      g.add(mesh);
    }
  }
  return g;
}

// The veranda's furniture (the veranda itself is part of the house model): cane rockers,
// the tables with their cloths and the X-back chairs, potted plants, and the path's
// compass-rose medallion.
function buildVeranda(models) {
  const g = new THREE.Group();
  const front = HB.z1, vy = 0.25;
  for (const [x, z, ry] of [[-10.6, front + 1.7, 0.35], [8.6, front + 1.8, -0.35], [-9.4, front + 2.6, 0.1]]) {
    const r = fitReal(models.caneRocker, 1.05);
    r.position.set(x, vy, z); r.rotation.y = ry;
    g.add(r);
  }
  const sq = worldBox(3.4, 0.03, 3.4, M.terracotta, 1.2); sq.position.set(0, 0.035, 15.2); g.add(sq);
  const med = new THREE.Mesh(new THREE.CircleGeometry(1.35, 48), new THREE.MeshStandardMaterial({ map: T.compass(), roughness: 0.6 }));
  med.rotation.x = -Math.PI / 2; med.position.set(0, 0.052, 15.2); med.receiveShadow = true; g.add(med);
  const tA = clothTable(2.0, 0.9, 0.76, std({ map: T.linen(), roughness: 0.95 })); tA.position.set(-5.6, vy, front + 2.1); g.add(tA);
  const tB = clothTable(1.2, 0.9, 0.76, std({ map: T.leafCloth(), roughness: 0.9 })); tB.position.set(5.6, vy, front + 2.1); g.add(tB);
  for (const [x, dz, ry] of [[-6.2, 1.25, 0], [-5.0, 1.25, 0], [-6.2, 2.95, Math.PI], [-5.0, 2.95, Math.PI], [5.6, 1.25, 0], [5.6, 2.95, Math.PI], [6.55, 2.1, -Math.PI / 2]]) {
    const c = fitReal(models.xchair, 0.9, [0.72, 0.62, 0.55]);
    c.position.set(x, vy, front + dz); c.rotation.y = ry;
    g.add(c);
  }
  for (const [x, dz] of [[-2.9, 4.1], [2.9, 4.1], [-12.4, 3.8], [10.4, 3.8]]) {
    const p = fitModel(models.pot.clone(), 0.9, false);
    p.position.set(x, vy, front + dz);
    g.add(p);
  }
  return g;
}

// Wall-buy station: a chalk sign with the gun's name and price, lit by a small lamp.
function buildBuySign(b) {
  const g = new THREE.Group();
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.55), new THREE.MeshStandardMaterial({ map: T.buySign(tr(WEAPONS[b.weapon].name), b.cost), roughness: 0.8, emissive: 0xffffff, emissiveIntensity: 0.12, emissiveMap: T.buySign(tr(WEAPONS[b.weapon].name), b.cost) }));
  sign.position.set(0, 1.55, 0);
  g.add(sign);
  const lamp = new THREE.PointLight(0xffd8a0, 2.5, 4, 2);
  lamp.position.set(0, 2.1, 0.35);
  g.add(lamp);
  g.position.set(b.x, b.x > 20 || b.x < -20 ? heightAt(b.x, b.z) : 0, b.z);
  g.rotation.y = Math.atan2(b.nx, b.nz);
  return g;
}

// ---------------------------------------------------------------- outbuildings
function whiteBuilding(s, roofRise, doors = 2) {
  const g = new THREE.Group();
  g.position.set(s.x, 0, s.z);
  const wallH = s.h - roofRise;
  const walls = worldBox(s.w, wallH, s.d, M.stucco, 2.4); walls.position.y = wallH / 2; g.add(walls);
  const along = s.d >= s.w;
  const L = (along ? s.d : s.w) + 1.2, W = (along ? s.w : s.d) + 1.2;
  const ang = Math.atan2(roofRise, W / 2), slopeLen = (W / 2) / Math.cos(ang);
  for (const sd of [-1, 1]) {
    const pg = new THREE.PlaneGeometry(L, slopeLen);
    pg.attributes.uv.array.forEach((v, i, a) => { a[i] = v * (i % 2 === 0 ? L / 2.5 : slopeLen / 2.5); });
    const p = new THREE.Mesh(pg, M.roof);
    p.rotation.set(sd > 0 ? ang - Math.PI / 2 : Math.PI / 2 - ang, 0, 0);
    p.position.set(0, wallH + roofRise / 2, sd * W / 4);
    p.castShadow = true;
    const holder = new THREE.Group(); holder.add(p);
    if (along) holder.rotation.y = Math.PI / 2;
    g.add(holder);
  }
  const tri = new THREE.Shape(); const hw = W / 2 - 0.6;
  tri.moveTo(-hw, 0); tri.lineTo(hw, 0); tri.lineTo(0, roofRise * hw / (W / 2)); tri.lineTo(-hw, 0);
  for (const sd of [-1, 1]) for (const flip of [0, Math.PI]) {
    const tg = new THREE.ShapeGeometry(tri); tg.attributes.uv.array.forEach((v, i, a) => { a[i] = v / 2.4; });
    const m = new THREE.Mesh(tg, M.stucco);
    m.position.set(along ? 0 : sd * s.w / 2, wallH, along ? sd * s.d / 2 : 0);
    m.rotation.y = (along ? 0 : Math.PI / 2) + flip;
    g.add(m);
  }
  const long = along ? s.d : s.w;
  for (let i = 0; i < doors + 2; i++) {
    const p = -long / 2 + (long * (i + 0.5)) / (doors + 2);
    const isDoor = i % 2 === 1;
    for (const sd of [-1, 1]) {
      const h = isDoor ? 2.3 : 1.2, y = isDoor ? 1.15 : 1.6;
      box(along ? 0.05 : 1.2, h, along ? 1.2 : 0.05, M.darkWood, along ? sd * (s.w / 2 + 0.02) : p, y, along ? p : sd * (s.d / 2 + 0.02), g);
    }
  }
  return g;
}

function buildStructure(s, updaters, models) {
  let g;
  switch (s.kind) {
    case 'veranda': return null;
    case 'windmill': g = windmill(s, updaters); break;
    case 'carport': g = carport(s); break;
    // the family's vehicles (generated from photos of the same models)
    case 'boat': {
      g = new THREE.Group(); g.position.set(s.x, heightAt(s.x, s.z), s.z);
      const v = VEHICLE_FIT[s.kind];
      const sz = new THREE.Box3().setFromObject(models[s.kind]).getSize(new THREE.Vector3());
      const m = fitReal(models[s.kind], v.length * sz.y / Math.max(sz.x, sz.z), v.tint);
      m.rotation.y = v.yaw;
      g.add(m);
      break;
    }
    case 'bunkhouse': g = whiteBuilding(s, 2.4, 2); break;
    case 'feedstore': g = whiteBuilding(s, 1.4, 1); break;
    case 'fountain': {
      g = new THREE.Group(); g.position.set(s.x, 0, s.z);
      // hexagonal basin with a band of blue glazed tile, like the real one
      const R = Math.min(s.w, s.d) / 2;
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(R, R + 0.06, s.h, 6, 1, true), M.stucco); rim.position.y = s.h / 2; rim.castShadow = rim.receiveShadow = true; g.add(rim);
      const tileM = std({ color: 0x1d5aa8, roughness: 0.12, metalness: 0.0 });
      const band = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.015, R + 0.015, 0.22, 6, 1, true), tileM); band.position.y = s.h - 0.2; g.add(band);
      const cap = new THREE.Mesh(new THREE.RingGeometry(R - 0.28, R + 0.06, 6, 1), M.stucco); cap.rotation.x = -Math.PI / 2; cap.position.y = s.h + 0.001; cap.receiveShadow = true; g.add(cap);
      const inner = new THREE.Mesh(new THREE.CylinderGeometry(R - 0.28, R - 0.28, s.h - 0.1, 6, 1, true), tileM); inner.position.y = s.h / 2; inner.material = tileM; inner.geometry.scale(1, 1, 1); g.add(inner);
      inner.material.side = THREE.DoubleSide;
      const pool = new THREE.Mesh(new THREE.CircleGeometry(R - 0.28, 6), M.water); pool.rotation.x = -Math.PI / 2; pool.position.y = s.h - 0.14; g.add(pool);
      const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.3, 1.3, 16), M.stucco); ped.position.y = 1.0; g.add(ped);
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.25, 0.25, 20), M.stucco); bowl.position.y = 1.6; g.add(bowl);
      const drop = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.06, 0.7, 8, 1, true), new THREE.MeshStandardMaterial({ color: 0xbfe0e8, transparent: true, opacity: 0.45, roughness: 0.05 }));
      drop.position.y = 1.35; g.add(drop);
      updaters.push((dt, t) => { drop.scale.x = drop.scale.z = 1 + Math.sin(t * 20) * 0.15; });
      break;
    }
    case 'tank': {
      g = new THREE.Group(); g.position.set(s.x, 0, s.z);
      const m = std({ map: T.metal(), color: 0xa8b0b4, roughness: 0.35, metalness: 0.7 });
      const c = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.3, 3, 32), m); c.position.y = 4.4; g.add(c);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(2.4, 0.9, 32), m); cone.position.y = 6.3; g.add(cone);
      for (const [lx, lz] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) box(0.15, 2.9, 0.15, M.bluePipe, lx, 1.45, lz, g);
      break;
    }
    case 'trough': {
      g = new THREE.Group(); g.position.set(s.x, 0, s.z);
      box(s.w, s.h, s.d, M.stucco, 0, s.h / 2, 0, g);
      g.add(flat(s.w - 0.2, s.d - 0.2, M.water, 0, s.h - 0.1, 0));
      break;
    }
    case 'woodpile': {
      g = new THREE.Group(); g.position.set(s.x, 0, s.z);
      for (let row = 0; row < 3; row++) for (let i = 0; i < 6 - row; i++) {
        const l = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, s.d, 10), M.bark);
        l.rotation.x = Math.PI / 2; l.position.set(-s.w / 2 + 0.35 + i * 0.6 + row * 0.3, 0.22 + row * 0.4, 0);
        g.add(l);
      }
      break;
    }
    default: return null;
  }
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

function hayBale(b) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, b.w, 24), std({ map: T.hay(), roughness: 1 }));
  m.rotation.z = Math.PI / 2;
  m.position.set(b.x, 0.8, b.z);
  m.castShadow = m.receiveShadow = true;
  return m;
}

function buildGardenWall() {
  const group = new THREE.Group();
  for (const s of FENCE_SEGMENTS) {
    const alongX = s.x1 !== undefined;
    const a = alongX ? s.x1 : s.z1, b = alongX ? s.x2 : s.z2, len = b - a, mid = (a + b) / 2;
    const w = worldBox(alongX ? len : 0.3, FENCE_HEIGHT - 0.1, alongX ? 0.3 : len, M.stucco, 2.4);
    w.position.set(alongX ? mid : s.x, (FENCE_HEIGHT - 0.1) / 2, alongX ? s.z : mid);
    group.add(w);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, len, 10, 1), M.stucco);
    cap.rotation.set(alongX ? 0 : Math.PI / 2, 0, alongX ? Math.PI / 2 : 0);
    cap.position.set(alongX ? mid : s.x, FENCE_HEIGHT - 0.1, alongX ? s.z : mid);
    cap.scale.set(1, 1, 0.6);
    cap.castShadow = true;
    group.add(cap);
    for (const end of [a, b]) box(0.5, FENCE_HEIGHT + 0.5, 0.5, M.stucco, alongX ? end : s.x, (FENCE_HEIGHT + 0.5) / 2, alongX ? s.z : end, group);
    // the real wall's stepped "mission" parapets: raised sections every few metres
    const n = Math.floor(len / 6.5);
    for (let i = 0; i < n; i++) {
      const c = a + (len / n) * (i + 0.5);
      for (const [pw, ph, py] of [[2.4, 0.28, FENCE_HEIGHT + 0.04], [1.5, 0.26, FENCE_HEIGHT + 0.31], [0.7, 0.2, FENCE_HEIGHT + 0.54]]) {
        const st = worldBox(alongX ? pw : 0.34, ph, alongX ? 0.34 : pw, M.stucco, 2.4);
        st.position.set(alongX ? c : s.x, py, alongX ? s.z : c);
        group.add(st);
      }
    }
  }
  return group;
}

function buildHedges(models) {
  const group = new THREE.Group();
  const spots = [];
  for (const h of HEDGES) {
    if (h.along === 'x') for (let x = h.x1; x <= h.x2; x += 0.45) spots.push([x, (h.z1 + h.z2) / 2]);
    else for (let z = h.z1; z <= h.z2; z += 0.45) spots.push([h.x, z]);
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3(), e = new THREE.Euler();
  for (const { geometry, material } of meshOf(models.shrub)) {
    material.side = THREE.DoubleSide;
    const mesh = new THREE.InstancedMesh(geometry, material, spots.length * 2);
    spots.forEach(([x, z], i) => {
      for (let k = 0; k < 2; k++) {
        q.setFromEuler(e.set(0, i * 2.3 + k * 1.7, 0));
        mesh.setMatrixAt(i * 2 + k, m4.compose(v.set(x + (k - 0.5) * 0.2, 0, z), q, s.set(3.2, 3.6 + (i % 3) * 0.4, 3.2)));
      }
    });
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }
  const flowers = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.018, 1), M.flower, spots.length * 14);
  let k = 0;
  spots.forEach(([x, z], i) => {
    for (let j = 0; j < 14; j++) {
      const a = i * 3.7 + j * 1.9, el = 0.35 + (j % 4) * 0.25, rr = 0.32 + (j % 3) * 0.06;
      flowers.setMatrixAt(k++, m4.compose(v.set(x + Math.cos(a) * rr * Math.cos(el), 0.2 + Math.sin(el) * 0.55, z + Math.sin(a) * rr * Math.cos(el)), q.identity(), s.setScalar(1)));
    }
  });
  group.add(flowers);
  return group;
}

function buildPen(p) {
  const g = new THREE.Group();
  g.position.set(p.x, heightAt(p.x, p.z), p.z);
  g.add(flat(p.w + 2, p.d + 2, M.sand, 0, 0.05, 0, 3));
  const posts = [];
  for (const [ax, az, bx, bz] of [[-1, -1, 1, -1], [1, -1, 1, 1], [1, 1, -1, 1], [-1, 1, -1, -1]]) {
    const x0 = ax * p.w / 2, z0 = az * p.d / 2, x1 = bx * p.w / 2, z1 = bz * p.d / 2;
    const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(len / 2.5));
    for (let i = 0; i < n; i++) posts.push([x0 + (x1 - x0) * i / n, z0 + (z1 - z0) * i / n]);
    for (const y of [0.45, 0.85, 1.25, 1.6]) {
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, len, 8), M.bluePipe);
      rail.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
      rail.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(x1 - x0, 0, z1 - z0).normalize());
      g.add(rail);
    }
  }
  for (const [x, z] of posts) { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.8, 8), M.bluePipe); m.position.set(x, 0.9, z); g.add(m); }
  for (const [x, z] of [[-p.w / 2 + 0.3, -p.d / 2 + 0.3], [p.w / 2 - 0.3, -p.d / 2 + 0.3], [-p.w / 2 + 0.3, -p.d / 2 + 6], [p.w / 2 - 0.3, -p.d / 2 + 6]]) box(0.15, 3.4, 0.15, M.bluePipe, x, 1.7, z, g);
  box(p.w + 1, 0.08, 7, std({ map: T.metal(), color: 0xb04a30, metalness: 0.5, roughness: 0.5 }), 0, 3.45, -p.d / 2 + 3.2, g).rotation.x = 0.08;
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}



// The steel farm windmill from the drone photo: tapered four-leg lattice tower, platform,
// an 18-blade wheel that turns in the breeze and a tail vane.
function windmill(s, updaters) {
  const g = new THREE.Group(); g.position.set(s.x, heightAt(s.x, s.z), s.z);
  const steel = std({ map: T.metal(), color: 0xb4b8bc, roughness: 0.45, metalness: 0.8 });
  const H = 10, b0 = 1.15, b1 = 0.28, parts = [];
  const up = new THREE.Vector3(0, 1, 0), qq = new THREE.Quaternion(), mm = new THREE.Matrix4(), one = new THREE.Vector3(1, 1, 1);
  const leg = (x0, z0, x1, z1, y0, y1, r) => {
    const a = new THREE.Vector3(x0, y0, z0), b = new THREE.Vector3(x1, y1, z1), dir = b.clone().sub(a), len = dir.length();
    const c = new THREE.CylinderGeometry(r, r, len, 6); c.translate(0, len / 2, 0);
    c.applyMatrix4(mm.compose(a, qq.setFromUnitVectors(up, dir.normalize()), one));
    parts.push(c);
  };
  const half = (y) => b0 + (b1 - b0) * (y / H);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) leg(sx * b0, sz * b0, sx * b1, sz * b1, 0, H, 0.045);
  for (let y = 1.2; y < H; y += 1.6) {
    const h0 = half(y), y2 = Math.min(H, y + 1.6), h1 = half(y2);
    for (const [ax, az, bx, bz] of [[-1, -1, 1, -1], [1, -1, 1, 1], [1, 1, -1, 1], [-1, 1, -1, -1]]) {
      leg(ax * h0, az * h0, bx * h0, bz * h0, y, y, 0.022);              // girt
      leg(ax * h0, az * h0, bx * h1, bz * h1, y, y2, 0.014);            // diagonal brace
    }
  }
  const tower = new THREE.Mesh(mergeGeometries(parts), steel); tower.castShadow = tower.receiveShadow = true; g.add(tower);
  box(1.1, 0.06, 1.1, steel, 0, H + 0.03, 0, g);
  const head = new THREE.Group(); head.position.y = H + 0.35; g.add(head);
  box(0.25, 0.3, 0.9, steel, 0, 0, 0, head);
  // the wheel: 18 curved sheet-metal blades on two rings
  const wheel = new THREE.Group(); wheel.position.z = 0.55; head.add(wheel);
  const bladeG = new THREE.PlaneGeometry(0.28, 1.25); bladeG.translate(0, 1.15, 0);
  const bp = []; for (let i = 0; i < 18; i++) { const b = bladeG.clone(); b.rotateY(0.45); b.rotateZ(i * Math.PI * 2 / 18); bp.push(b); }
  const blades = new THREE.Mesh(mergeGeometries(bp), std({ map: T.metal(), color: 0xc8ccd0, roughness: 0.4, metalness: 0.7, side: THREE.DoubleSide }));
  blades.castShadow = true; wheel.add(blades);
  for (const rr of [0.6, 1.75]) { const ring = new THREE.Mesh(new THREE.TorusGeometry(rr, 0.02, 6, 32), steel); wheel.add(ring); }
  wheel.add(new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.2, 12).rotateX(Math.PI / 2), steel));
  // tail vane
  box(0.04, 0.04, 2.2, steel, 0, 0, -1.2, head);
  const vane = box(0.02, 0.9, 1.3, std({ color: 0xd8d8d0, roughness: 0.5, metalness: 0.4 }), 0, 0.1, -2.2, head);
  vane.castShadow = true;
  head.rotation.y = 0.6;
  updaters.push((dt, t) => { wheel.rotation.z -= dt * (1.6 + Math.sin(t * 0.3) * 0.6); head.rotation.y = 0.6 + Math.sin(t * 0.11) * 0.15; });
  return g;
}

// The carport beside the house: white square posts and a red clay-tile hip roof on dark beams.
function carport(s) {
  const g = new THREE.Group(); g.position.set(s.x, 0, s.z);
  const H = s.h - 0.4;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const p = worldBox(0.38, H, 0.38, M.stucco, 2); p.position.set(sx * (s.w / 2 - 0.2), H / 2, sz * (s.d / 2 - 0.2)); g.add(p);
    box(0.5, 0.12, 0.5, M.stucco, sx * (s.w / 2 - 0.2), H - 0.06, sz * (s.d / 2 - 0.2), g);
  }
  for (const sz of [-1, 1]) box(s.w + 0.2, 0.22, 0.18, M.darkWood, 0, H + 0.1, sz * (s.d / 2 - 0.2), g);
  for (let x = -s.w / 2 + 0.3; x <= s.w / 2 - 0.3; x += 0.9) box(0.1, 0.16, s.d + 0.4, M.darkWood, x, H + 0.28, 0, g);
  // gable roof like the photo: ridge running front-to-back, white gable ends
  const ov = 0.45, w = s.w / 2 + ov, d = s.d / 2 + ov, rise = 1.15, y0 = H + 0.36;
  for (const sx of [-1, 1]) {
    const geo = new THREE.BufferGeometry();
    const q = [[sx * w, y0, -d], [sx * w, y0, d], [0, y0 + rise, d], [0, y0 + rise, -d]];
    geo.setAttribute('position', new THREE.Float32BufferAttribute(q.flat(), 3));
    const sl = Math.hypot(w, rise) / 2.2;
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, (2 * d) / 2.2, 0, (2 * d) / 2.2, sl, 0, sl], 2));
    geo.setIndex(sx > 0 ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3]); geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, M.roof); m.castShadow = m.receiveShadow = true; g.add(m);
    box(0.12, 0.16, s.d + ov * 2, M.darkWood, sx * w, y0 - 0.05, 0, g);
  }
  for (const sz of [-1, 1]) {
    const tri = new THREE.Shape(); tri.moveTo(-s.w / 2, 0); tri.lineTo(s.w / 2, 0); tri.lineTo(0, rise * (s.w / 2) / w); tri.lineTo(-s.w / 2, 0);
    const tg = new THREE.ExtrudeGeometry(tri, { depth: 0.15, bevelEnabled: false });
    const gm = new THREE.Mesh(tg, M.stucco); gm.position.set(0, y0, sz * (s.d / 2 - 0.2) - 0.075); gm.castShadow = gm.receiveShadow = true; g.add(gm);
  }
  // brick-red paved driveway out the front
  const drive = worldBox(s.w + 0.4, 0.04, 6.5, M.terracotta, 1.4); drive.position.set(0, 0.02, s.d / 2 + 3.25); g.add(drive);
  const slab = worldBox(s.w + 0.6, 0.06, s.d + 0.6, std({ color: 0xb8b2a6, roughness: 0.9 }), 2); slab.position.y = 0.03; g.add(slab);
  return g;
}

// ---------------------------------------------------------------- vegetation
// Living foliage: matte leaves, wind sway (stronger higher up), per-leaf flutter, and light
// glowing through the leaves when you look toward the sun.
const FOLIAGE_TIME = { value: 0 };
function foliage(m, { sway = 0.03, flutter = 0.006, tint = null, glow = 0.9, h = 'max(position.y, 0.0)', edgeFade = false, puffy = false } = {}) {
  // leaves are matte: the source roughness maps made them mirror the pale sky (silvery trees)
  m.roughnessMap = null; m.metalnessMap = null;
  m.roughness = 0.92;
  m.metalness = 0;
  m.envMapIntensity = 0.6;
  if (tint) m.color.multiply(new THREE.Color(...tint));
  m.customProgramCacheKey = () => `foliage-${sway}-${flutter}-${glow}-${h}-${edgeFade}-${puffy}`;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uFolTime = FOLIAGE_TIME;
    sh.vertexShader = 'uniform float uFolTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      {
        vec3 ip = vec3(0.0);
#ifdef USE_INSTANCING
        ip = instanceMatrix[3].xyz;
#endif
        float ph = ip.x * 0.21 + ip.z * 0.17;
        float hh = ${h};
        transformed.x += sin(uFolTime * 1.2 + ph + hh * 0.8) * ${sway.toFixed(4)} * hh;
        transformed.z += cos(uFolTime * 0.9 + ph * 1.3) * ${(sway * 0.7).toFixed(4)} * hh;
        transformed += objectNormal * sin(uFolTime * 7.0 + dot(position, vec3(13.1, 7.7, 9.3))) * ${flutter.toFixed(4)};
      }`);
    // crown cards carry normals that point out of the crown: keep them on the back faces too,
    // so the whole crown shades as one soft mass
    if (puffy) sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('gl_FrontFacing ? 1.0 : - 1.0', '1.0'));
    if (edgeFade) sh.fragmentShader = sh.fragmentShader.replace('#include <alphatest_fragment>', `
      // thin the leaves out toward the silhouette so crowns read as ragged foliage, not blobs
      diffuseColor.a *= smoothstep(0.08, 0.5, abs(dot(normalize(vNormal), normalize(vViewPosition))));
      #include <alphatest_fragment>`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
#ifdef USE_FOG
      {
        float bl = pow(max(dot(normalize(vFogRay), ${SUN_GLSL}), 0.0), 4.0);
        totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.95, 0.55) * bl * ${glow.toFixed(3)};
      }
#endif`);
  };
  return m;
}

// Instances are grouped into 40 m chunks so the GPU can skip whole patches that are
// off-screen, and distant chunks are hidden (the haze covers the pop).
class ChunkedInstances {
  constructor(geometry, material, transforms, { chunk = 64, maxDist = 160, shadows = true } = {}) {
    this.group = new THREE.Group();
    this.maxDist = maxDist;
    const cells = new Map();
    for (const t of transforms) {
      const k = `${Math.floor(t.x / chunk)},${Math.floor(t.z / chunk)}`;
      if (!cells.has(k)) cells.set(k, []);
      cells.get(k).push(t);
    }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3(), e = new THREE.Euler();
    this.chunks = [];
    for (const list of cells.values()) {
      const mesh = new THREE.InstancedMesh(geometry, material, list.length);
      list.forEach((t, i) => {
        q.setFromEuler(e.set(t.rx || 0, t.ry || 0, t.rz || 0));
        mesh.setMatrixAt(i, m4.compose(v.set(t.x, t.y, t.z), q, s.set(t.sx ?? t.s, t.sy ?? t.s, t.sz ?? t.s)));
      });
      mesh.computeBoundingSphere();
      mesh.castShadow = shadows;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.chunks.push({ mesh, c: mesh.boundingSphere.center.clone() });
    }
  }
  update(cam) {
    for (const ch of this.chunks) ch.mesh.visible = Math.hypot(ch.c.x - cam.x, ch.c.z - cam.z) < this.maxDist;
  }
}

function buildVegetation(models, Q) {
  const group = new THREE.Group();
  const sets = [];
  const lowQ = !Q.shadows;
  const add = (geoMats, transforms, opts) => {
    for (const { geometry, material } of geoMats) {
      material.side = THREE.DoubleSide;
      const ci = new ChunkedInstances(geometry, material, transforms, opts);
      group.add(ci.group);
      sets.push(ci);
    }
  };
  const gy = (x, z) => heightAt(x, z) - 0.05;

  // Trees are modelled in Blender (tools/blender/make_trees.py): two broadleaf trees with
  // real limbs and uneven leafy crowns, two coconut palms with arching fronds. Each part is
  // instanced across the map.
  const part = (name) => {
    const o = models.trees.getObjectByName(name);
    o.updateWorldMatrix(true, false);
    const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld);
    return { geometry: g, map: o.material.map };
  };
  const leafMat = (map, opts) => foliage(new THREE.MeshStandardMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9 }), opts);
  const trees = (kind, trunkMat, leafOpts, list, nuts) => {
    const trunk = part(kind + '_Trunk'), leaves = part(kind + (nuts ? '_Fronds' : '_Leaves'));
    add([{ geometry: trunk.geometry, material: trunkMat }], list, { maxDist: 220 });
    add([{ geometry: leaves.geometry, material: leafMat(leaves.map, leafOpts) }], list, { maxDist: 220, shadows: !lowQ });
    if (nuts) add([{ geometry: part(kind + '_Nuts').geometry, material: M.coconut }], list, { maxDist: 90, shadows: false });
  };

  // coconut palms: 10 m models, two leans
  const palms = TREES.filter(t => t.kind === 'palm');
  const palmAt = (t, i) => ({ x: t.x, y: gy(t.x, t.z), z: t.z, ry: i * 2.4, s: ((8 + (i % 5)) * t.s) / 10 });
  const frondOpts = { sway: 0.012, flutter: 0.012, h: 'max(position.y - 7.0, 0.0) * 2.0' };
  trees('PalmA', M.palmBark, frondOpts, palms.map(palmAt).filter((p, i) => i % 2 === 0), true);
  trees('PalmB', M.palmBark, frondOpts, palms.map(palmAt).filter((p, i) => i % 2 === 1), true);

  // broadleaf jungle trees: the 7 m tree, and the 11 m buttressed giant
  const broadAt = (k) => (t, i) => ({ x: t.x, y: gy(t.x, t.z), z: t.z, ry: i * 1.7, sx: t.s * k * (0.92 + (i % 4) * 0.06), sy: t.s * k * (0.9 + (i % 3) * 0.09), sz: t.s * k * (0.92 + ((i + 2) % 4) * 0.06) });
  const leafOpts = { sway: 0.006, flutter: 0.014, h: 'max(position.y - 2.0, 0.0)', puffy: true };
  trees('Broad', M.bark, leafOpts, TREES.filter(t => t.kind === 'broad').map(broadAt(0.95)));
  trees('Giant', M.bark, leafOpts, TREES.filter(t => t.kind === 'giant').map(broadAt(0.82)));

  // undergrowth: ferns and shrubs from the real models
  const ferns = UNDERGROWTH.filter(u => u.kind === 'fern').map(u => ({ x: u.x, y: gy(u.x, u.z), z: u.z, ry: u.rot, s: u.s * 2.6 }));
  const shrubs = UNDERGROWTH.filter(u => u.kind === 'shrub').map(u => ({ x: u.x, y: gy(u.x, u.z), z: u.z, ry: u.rot, sx: u.s * 4.5, sy: u.s * 5.5, sz: u.s * 4.5 }));
  const fernM = meshOf(models.fern), shrubM = meshOf(models.shrub);
  for (const c of fernM) foliage(c.material, { sway: 0.06, flutter: 0.004 });
  for (const c of shrubM) foliage(c.material, { sway: 0.04, flutter: 0.005 });
  add(fernM, ferns, { maxDist: lowQ ? 50 : 80, shadows: false });
  add(shrubM, shrubs, { maxDist: lowQ ? 50 : 80, shadows: false });

  return { group, update: (dt, t, cam) => { FOLIAGE_TIME.value = t; if (cam) for (const s of sets) s.update(cam); } };
}

// Grass blades in the pasture around the house.
// A tuft of curved, leaning blades (one instance = 7 blades). Normals point mostly up so the
// grass is lit like a lawn rather than like flat cards.
function grassTuft() {
  const P = [], N = [], U = [], I = [];
  let seed = 7;
  const r = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const SEG = 3;
  for (let b = 0; b < 7; b++) {
    const ang = r() * Math.PI * 2, lean = 0.12 + r() * 0.4, h = 0.24 + r() * 0.32, w = 0.02 + r() * 0.014;
    const ox = (r() - 0.5) * 0.14, oz = (r() - 0.5) * 0.14;
    const dx = Math.cos(ang), dz = Math.sin(ang), px = -dz, pz = dx;
    const base = P.length / 3;
    for (let k = 0; k <= SEG; k++) {
      const t = k / SEG, bend = lean * t * t * h, ww = (w * (1 - t * 0.92)) / 2;
      for (const sg of [-1, 1]) {
        P.push(ox + dx * bend + px * ww * sg, t * h, oz + dz * bend + pz * ww * sg);
        const nl = Math.hypot(dx * 0.35, 1, dz * 0.35);
        N.push((dx * 0.35) / nl, 1 / nl, (dz * 0.35) / nl);
        U.push((sg + 1) / 2, t);
      }
    }
    for (let k = 0; k < SEG; k++) { const a = base + k * 2; I.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  g.setIndex(I);
  return g;
}

// Dense pasture grass that travels with the player: the terrain height and a grass mask are
// baked into a texture, and every tuft keeps a fixed spot in the world, wrapping from behind
// the camera to ahead of it at the faded edge of the patch (so nothing slides or pops).
function buildGrass(COUNT) {
  const X0 = -270, Z0 = -230, N = 541;
  const data = new Uint16Array(N * N * 4);
  const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const H = THREE.DataUtils.toHalfFloat;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = X0 + i, z = Z0 + j, k = (j * N + i) * 4;
    const sz = shoreZ(x), r = Math.hypot(x, z * 1.1);
    let d = (1 - smooth(sz - SAND_WIDTH - 2, sz - SAND_WIDTH + 5, z)) * (1 - smooth(72, 96, r) * 0.8);
    if (d > 0 && r > 45) d *= smooth(1.4, 3.2, trailDist(x, z));
    if (d > 0) d *= smooth(ROAD_HALF - 0.6, ROAD_HALF + 0.8, roadDist(x, z));
    if (x > HB.x0 - 0.6 && x < HB.x1 + 0.6 && z > HB.z0 - 0.6 && z < VERANDA.z + 0.8) d = 0;
    else if (Math.abs(x) < 1.6 && z > 9 && z < 22.5) d = 0;
    else if (Math.abs(x) < 2.4 && Math.abs(z - 19) < 2.4) d = 0;
    else if (PENS.some(p => Math.abs(x - p.x) < p.w / 2 + 0.6 && Math.abs(z - p.z) < p.d / 2 + 0.6)) d = 0;
    else if (STRUCTURES.some(st => st.kind !== 'veranda' && Math.abs(x - st.x) < st.w / 2 + 0.4 && Math.abs(z - st.z) < st.d / 2 + 0.4)) d = 0;
    else if (Math.abs(x) < 1.8 && z > 12.8 && z < 16.4) d = 0;
    else if (STATIONS.some(m => { const b = stationBox(m); return Math.abs(x - b.x) < b.w / 2 + 0.3 && Math.abs(z - b.z) < b.d / 2 + 0.3; })) d = 0;
    else if (d > 0 && solidsNear(x, z, 1).some(b => b.h > 0.3 && Math.abs(x - b.x) < b.w / 2 + 0.15 && Math.abs(z - b.z) < b.d / 2 + 0.15)) d = 0;
    const yd = Math.max(YARD.minX - x, x - YARD.maxX, YARD.minZ - z, z - YARD.maxZ);
    data[k] = H(heightAt(x, z)); data[k + 1] = H(d); data[k + 2] = H(1 - smooth(-3, 2, yd)); data[k + 3] = H(1);
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;

  const R = Math.max(16, Math.min(34, Math.sqrt(COUNT / (Math.PI * 9)))), T = R * 2;
  const tuft = grassTuft();
  const geo = new THREE.InstancedBufferGeometry();
  for (const k of ['position', 'normal', 'uv']) geo.setAttribute(k, tuft.attributes[k]);
  geo.setIndex(tuft.index);
  const off = new Float32Array(COUNT * 2), rnd = new Float32Array(COUNT * 3);
  let seed = 99;
  const rr = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < COUNT; i++) { off[i * 2] = rr() * T; off[i * 2 + 1] = rr() * T; rnd.set([rr(), rr(), rr()], i * 3); }
  geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(off, 2));
  geo.setAttribute('aRand', new THREE.InstancedBufferAttribute(rnd, 3));
  geo.instanceCount = COUNT;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);

  const mat = new THREE.MeshStandardMaterial({ color: 0x6f9440, roughness: 0.85, side: THREE.DoubleSide });
  const uniforms = { uTime: { value: 0 }, uTerrain: { value: tex } };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = `uniform float uTime; uniform sampler2D uTerrain;
attribute vec2 aOffset; attribute vec3 aRand;
varying float vGrassH; varying vec3 vGrassC; varying float vLawn;
` + sh.vertexShader.replace('#include <begin_vertex>', `
      // nearest repetition of this tuft's world spot to the camera
      vec2 wxz = aOffset + ${T.toFixed(2)} * floor((cameraPosition.xz - aOffset) / ${T.toFixed(2)} + 0.5);
      vec4 tv = texture2D(uTerrain, (wxz - vec2(${X0}.0, ${Z0}.0) + 0.5) / ${N}.0);
      float dcam = distance(wxz, cameraPosition.xz);
      float sc = step(aRand.x, tv.g) * (1.0 - smoothstep(${(R * 0.62).toFixed(1)}, ${R.toFixed(1)}, dcam)) * (0.7 + aRand.y * 0.7);
      float ang = aRand.z * 6.2832; float ca = cos(ang), sa = sin(ang);
      vec3 transformed = position * sc;
      // the yard is mowed short; the pasture beyond the fence grows long
      transformed.y *= (0.75 + aRand.x * 0.7) * mix(1.0, 0.3, tv.b);
      transformed.xz *= mix(1.0, 1.35, tv.b);
      transformed.xz = vec2(ca * transformed.x - sa * transformed.z, sa * transformed.x + ca * transformed.z);
      float sway = sin(uTime * 1.7 + wxz.x * 0.35 + wxz.y * 0.2) * 0.5 + sin(uTime * 3.1 + wxz.x * 0.9) * 0.2;
      transformed.x += sway * transformed.y * transformed.y * 0.9;
      transformed.z += sway * transformed.y * transformed.y * 0.3;
      transformed += vec3(wxz.x, tv.r - 0.02, wxz.y);
      vGrassH = uv.y; vLawn = tv.b;
      vGrassC = mix(vec3(0.58, 0.78, 0.34), vec3(0.86, 0.86, 0.46), aRand.y * aRand.y * 0.7) * (0.75 + aRand.z * 0.4);
      vGrassC = mix(vGrassC, vec3(0.5, 0.8, 0.34) * (0.8 + aRand.z * 0.3), tv.b);`);
    sh.fragmentShader = 'varying float vGrassH; varying vec3 vGrassC; varying float vLawn;\n' + sh.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      diffuseColor.rgb *= vGrassC * mix(mix(0.5, 0.72, vLawn), 1.1, vGrassH);
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.25, 1.12, 0.7), smoothstep(0.7, 1.0, vGrassH) * 0.5);`);
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.userData.noAO = true; // its placement lives in the shader; keep it out of override-material passes
  return { mesh, update: (dt, t) => { uniforms.uTime.value = t; } };
}

