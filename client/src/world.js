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
  HOUSE, HOUSE_WALLS, ENTRIES, FURNITURE, STRUCTURES, HAY_BALES, TREES, UNDERGROWTH, FENCE_SEGMENTS,
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

// Wrought iron: curling scrolls as tubes, merged into one mesh.
function ironTable(w, d, h, topMat) {
  const g = new THREE.Group();
  const tubes = [];
  const tube = (pts, r = 0.011) => tubes.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), Math.max(16, pts.length * 6), r, 6, false));
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const spiral = (cx, cy, r0, r1, a0, turns, n, toWorld) => {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, a = a0 + t * turns * Math.PI * 2, r = r0 + (r1 - r0) * t;
      pts.push(toWorld(cx + Math.cos(a) * r, cy + Math.sin(a) * r));
    }
    return pts;
  };
  const hw = w / 2 - 0.04, hd = d / 2 - 0.04;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    // S-curved leg ending in an outward curl at the foot
    const pts = [V(sx * hw, h - 0.03, sz * hd), V(sx * (hw + 0.035), h * 0.62, sz * (hd + 0.035)), V(sx * (hw - 0.02), h * 0.28, sz * (hd - 0.02)), V(sx * (hw + 0.01), 0.07, sz * (hd + 0.01))];
    const foot = spiral(0, 0.05, 0.045, 0.012, Math.PI, 1.3, 14, (u, v) => V(sx * (hw + 0.01 + u * 0.7), v, sz * (hd + 0.01 + u * 0.7)));
    tube([...pts, ...foot.slice(1)]);
  }
  // apron scrolls on each side, mirrored from the middle
  for (const [len, place] of [[w, (u, v, side) => V(u, v, side * hd)], [d, (u, v, side) => V(side * hw, v, u)]]) {
    for (const side of [-1, 1]) for (const m of [-1, 1]) {
      const L = len / 2 - 0.1;
      tube(spiral(m * L * 0.62, h - 0.09, 0.05, 0.012, m > 0 ? Math.PI / 2 : Math.PI / 2, m * 1.25, 20, (u, v) => place(u, v, side)), 0.008);
      tube([place(0, h - 0.035, side), place(m * L * 0.3, h - 0.06, side), place(m * L * 0.62, h - 0.04, side)], 0.008);
    }
  }
  // low cross stretcher with a centre ring
  tube([V(-hw, 0.2, -hd), V(-hw * 0.4, 0.15, -hd * 0.4), V(0, 0.17, 0), V(hw * 0.4, 0.15, hd * 0.4), V(hw, 0.2, hd)], 0.009);
  tube([V(-hw, 0.2, hd), V(-hw * 0.4, 0.15, hd * 0.4), V(0, 0.17, 0), V(hw * 0.4, 0.15, -hd * 0.4), V(hw, 0.2, -hd)], 0.009);
  const iron = new THREE.Mesh(mergeGeometries(tubes), M.iron);
  iron.castShadow = iron.receiveShadow = true;
  g.add(iron);
  const top = box(w, 0.035, d, topMat, 0, h + 0.0175, 0, g);
  top.geometry.attributes.uv.array.forEach((v, i, a) => { a[i] = v * 0.6; });
  return g;
}

// A long dark-wood dining table with lathe-turned legs.
function diningTable(w, d, h) {
  const g = new THREE.Group();
  const top = worldBox(w, 0.06, d, M.darkWoodTable, 1.5); top.position.y = h - 0.03; g.add(top);
  for (const [x, z, len] of [[0, d / 2 - 0.06, w - 0.25], [0, -d / 2 + 0.06, w - 0.25]]) box(len, 0.1, 0.03, M.darkWoodTable, x, h - 0.11, z, g);
  for (const x of [w / 2 - 0.06, -w / 2 + 0.06]) box(0.03, 0.1, d - 0.25, M.darkWoodTable, x, h - 0.11, 0, g);
  const prof = [[0, 0], [0.045, 0], [0.045, 0.06], [0.035, 0.09], [0.05, 0.2], [0.03, 0.32], [0.042, 0.42], [0.026, 0.52], [0.034, 0.6], [0.04, 0.62], [0.04, h - 0.16], [0, h - 0.16]].map(([a, b]) => new THREE.Vector2(a, b));
  const legG = new THREE.LatheGeometry(prof, 14);
  const legs = w > 2.6 ? [-w / 2 + 0.12, 0, w / 2 - 0.12] : [-w / 2 + 0.12, w / 2 - 0.12];
  for (const x of legs) for (const z of [d / 2 - 0.12, -d / 2 + 0.12]) {
    const l = new THREE.Mesh(legG, M.darkWoodTable); l.position.set(x, 0, z); l.castShadow = l.receiveShadow = true; g.add(l);
  }
  return g;
}

// Framed painting (front faces +Z)
function painting(file, w, h, frameMat, liner) {
  const g = new THREE.Group();
  const canvasM = new THREE.MeshStandardMaterial({ map: loadTex(file), roughness: 0.55 });
  canvasM.map.wrapS = canvasM.map.wrapT = THREE.ClampToEdgeWrapping;
  const c = new THREE.Mesh(new THREE.PlaneGeometry(w, h), canvasM); c.position.z = 0.02; g.add(c);
  const fw = 0.11, fd = 0.06;
  for (const [bw, bh, x, y] of [[w + fw * 2, fw, 0, h / 2 + fw / 2], [w + fw * 2, fw, 0, -h / 2 - fw / 2], [fw, h, -w / 2 - fw / 2, 0], [fw, h, w / 2 + fw / 2, 0]]) box(bw, bh, fd, frameMat, x, y, fd / 2, g);
  if (liner) for (const [bw, bh, x, y] of [[w, 0.025, 0, h / 2 - 0.012], [w, 0.025, 0, -h / 2 + 0.012], [0.025, h, -w / 2 + 0.012, 0], [0.025, h, w / 2 - 0.012, 0]]) box(bw, bh, 0.012, liner, x, y, 0.026, g);
  return g;
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
  const house = buildHouse(updaters, models);
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
    scene, sun, sunDir: sunDir.raw, lightDir: sunDir.clone(), boards: house.boards, grilles: house.grilles,
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
  const HX = (HOUSE.w / 2).toFixed(2), HZ = (HOUSE.d / 2).toFixed(2), WH = (HOUSE.wallH + 0.25).toFixed(2);
  THREE.ShaderChunk.lights_fragment_maps = THREE.ShaderChunk.lights_fragment_maps.split('// RD-INDOOR')[0] + `// RD-INDOOR
#ifdef USE_FOG
{
  vec3 wpI = cameraPosition + vFogRay;
  float inHouse = step(abs(wpI.x), ${HX}) * step(abs(wpI.z), ${HZ}) * step(wpI.y, ${WH});
  float inPorch = step(abs(wpI.x), ${HX} + 0.4) * step(${HZ}, wpI.z) * step(wpI.z, ${HZ} + 4.9) * step(wpI.y, ${WH});
  float inLog = step(${LOGGIA.x0.toFixed(2)}, wpI.x) * step(wpI.x, ${LOGGIA.x1.toFixed(2)}) * step(${LOGGIA.z0.toFixed(2)} - 0.1, wpI.z) * step(wpI.z, ${(LOGGIA.z1 - 0.25).toFixed(2)}) * step(${(HOUSE.wallH + 0.3).toFixed(2)}, wpI.y) * step(wpI.y, ${(HOUSE.wallH + 3.2).toFixed(2)});
  float occI = 1.0 - inHouse * 0.74 - inPorch * 0.42 - inLog * 0.5;
  vec3 warmI = mix(vec3(1.0), vec3(1.1, 0.97, 0.84), 1.0 - occI);
#if defined( RE_IndirectDiffuse )
  iblIrradiance *= occI * warmI;
  irradiance *= mix(1.0, occI, 0.85) * warmI;
#endif
#if defined( RE_IndirectSpecular )
  radiance *= occI * 0.7 + 0.3;
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
    // the real house's furniture, generated from the family photos
    bench: 'house/bench.glb', caneRocker: 'house/rocker.glb', fan: 'house/fan.glb',
    diningChair: 'house/diningchair.glb', bar: 'house/bar.glb', xchair: 'house/xchair.glb',
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
function buildHouse(updaters, models) {
  const group = new THREE.Group();
  const { wallH, t } = HOUSE;
  const HX = HOUSE.w / 2, HZ = HOUSE.d / 2;

  // the real ochre tile floor, with its patterned border around each room
  group.add(flat(HOUSE.w, HOUSE.d, M.floor, 0, 0.04, 0, 2.0));
  const bw = 0.36, inset = 0.5;
  for (const [x0, x1] of [[-HX, -3], [-3, HX]]) {
    const cx = (x0 + x1) / 2, w = x1 - x0 - inset * 2, d = HOUSE.d - inset * 2;
    for (const s of [-1, 1]) {
      group.add(stripe(w, bw, cx, s * (d / 2), false));
      group.add(stripe(d, bw, cx + s * (w / 2), 0, true));
    }
  }
  function stripe(len, wid, x, z, alongZ) {
    const g = new THREE.PlaneGeometry(len, wid);
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * len / 0.9);
    const m = new THREE.Mesh(g, M.border);
    m.rotation.set(-Math.PI / 2, 0, alongZ ? Math.PI / 2 : 0);
    m.position.set(x, 0.045, z);
    m.receiveShadow = true;
    return m;
  }
  const found = box(HOUSE.w + 0.5, 0.35, HOUSE.d + 0.5, std({ color: 0xbcb4a4, roughness: 1 }), 0, -0.16, 0, group);
  found.castShadow = false;

  for (const wpiece of HOUSE_WALLS) {
    if (wpiece.kind === 'iwall') {
      const m = worldBox(wpiece.w, wpiece.h, wpiece.d, M.stuccoIn, 2.4);
      m.position.set(wpiece.x, wpiece.h / 2, wpiece.z);
      group.add(m);
      continue;
    }
    const alongX = wpiece.d === t;
    const nx = alongX ? 0 : Math.sign(wpiece.x), nz = alongX ? Math.sign(wpiece.z) : 0;
    const half = t / 2;
    for (const [mat, off] of [[M.stucco, half / 2], [M.stuccoIn, -half / 2]]) {
      const m = worldBox(alongX ? wpiece.w : half, wpiece.h, alongX ? half : wpiece.d, mat, 2.4);
      m.position.set(wpiece.x + nx * off, wpiece.h / 2, wpiece.z + nz * off);
      group.add(m);
    }
    box(alongX ? wpiece.w : 0.02, 0.16, alongX ? 0.02 : wpiece.d, M.dado, wpiece.x - nx * (half + 0.01), 0.12, wpiece.z - nz * (half + 0.01), group);
    box(alongX ? wpiece.w : 0.03, 0.45, alongX ? 0.03 : wpiece.d, std({ color: 0xa89a88, roughness: 1 }), wpiece.x + nx * (half + 0.015), 0.22, wpiece.z + nz * (half + 0.015), group);
  }

  // the wide arched opening between the living and dining rooms, like the photo
  {
    const w = 4.2, y0 = 2.55, rise = 0.55;
    const sh = new THREE.Shape();
    sh.moveTo(-w / 2, y0); sh.lineTo(-w / 2, wallH); sh.lineTo(w / 2, wallH); sh.lineTo(w / 2, y0);
    sh.quadraticCurveTo(0, y0 + rise * 2, -w / 2, y0);
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.2, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 1, curveSegments: 28 });
    g.translate(0, 0, -0.1);
    { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 2.4, uv.getY(i) / 2.4); }
    const arch = new THREE.Mesh(g, M.stuccoIn);
    arch.rotation.y = Math.PI / 2; arch.position.set(-3, 0, 0);
    arch.castShadow = arch.receiveShadow = true;
    group.add(arch);
    for (const sz of [-1, 1]) { // plaster pilasters framing the opening
      const p = worldBox(0.3, y0, 0.22, M.stuccoIn, 2.4); p.position.set(-3, y0 / 2, sz * (w / 2 + 0.03)); group.add(p);
      const cap = worldBox(0.36, 0.1, 0.3, M.stuccoIn, 2.4); cap.position.set(-3, y0 + 0.02, sz * (w / 2 + 0.03)); group.add(cap);
    }
  }

  const boards = [], grilles = [];
  for (const e of ENTRIES) {
    const alongX = e.nx === 0;
    const W = e.width, sx = alongX ? W : t, sz = alongX ? t : W;
    if (e.sill > 0) {
      const sill = worldBox(sx, e.sill, sz, M.stucco, 2.4);
      sill.position.set(e.x, e.sill / 2, e.z); group.add(sill);
      box(alongX ? W + 0.2 : t + 0.12, 0.06, alongX ? t + 0.12 : W + 0.2, M.darkWood, e.x, e.sill, e.z, group);
    }
    const head = worldBox(sx, wallH - e.top, sz, M.stucco, 2.4);
    head.position.set(e.x, (wallH + e.top) / 2, e.z); group.add(head);
    for (const s of [-1, 1]) {
      const px = e.x + (alongX ? s * (W / 2 + 0.05) : 0), pz = e.z + (alongX ? 0 : s * (W / 2 + 0.05));
      box(alongX ? 0.1 : t + 0.06, e.top - e.sill, alongX ? t + 0.06 : 0.1, M.darkWood, px, (e.top + e.sill) / 2, pz, group);
    }
    box(alongX ? W + 0.3 : t + 0.06, 0.12, alongX ? t + 0.06 : W + 0.3, M.darkWood, e.x, e.top + 0.06, e.z, group);

    // like the real house: louvered dark-wood shutters (glazed leaves on the doors) folded
    // open against the inside wall, and a wrought-iron grille across each window
    const leafH = e.top - e.sill - 0.04, leafW = W / 2;
    const inOff = t / 2 + 0.028;
    for (const sd of [-1, 1]) {
      const leaf = e.kind === 'door' ? glazedLeaf(leafW, leafH) : louveredLeaf(leafW, leafH);
      const along = sd * (W / 2 + leafW / 2 + 0.02);
      leaf.position.set(e.x + (alongX ? along : 0) - e.nx * inOff, e.sill + leafH / 2 + 0.02, e.z + (alongX ? 0 : along) - e.nz * inOff);
      leaf.rotation.y = alongX ? 0 : Math.PI / 2;
      group.add(leaf);
    }
    if (e.kind !== 'door') {
      const gr = ironGrille(W, e.top - e.sill);
      gr.position.set(e.x + e.nx * (t / 2 + 0.03), e.sill, e.z + e.nz * (t / 2 + 0.03));
      gr.rotation.y = alongX ? 0 : Math.PI / 2;
      group.add(gr);
      grilles[e.id] = gr;
    }

    const list = [];
    const span = e.top - e.sill;
    const boardH = Math.min(0.32, (span / MAX_BOARDS) * 0.62);
    for (let i = 0; i < MAX_BOARDS; i++) {
      const g = new THREE.BoxGeometry(W + 0.45, boardH, 0.05);
      const uv = g.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * 1.2 + i * 0.37, uv.getY(k) * 0.15 + i * 0.13);
      const b = new THREE.Mesh(g, M.planks);
      const y = e.sill + span * ((i + 0.5) / MAX_BOARDS);
      const tilt = Math.sin(e.id * 7.1 + i * 3.3) * 0.22;
      b.position.set(e.x - e.nx * (t / 2 + 0.04), y, e.z - e.nz * (t / 2 + 0.04));
      b.rotation.set(0, alongX ? 0 : Math.PI / 2, tilt);
      b.castShadow = true;
      group.add(b);
      list.push(b);
    }
    boards.push(list);
  }

  // ceiling: smooth white plaster with a crown moulding, like the photos of the rooms
  // (ceilings get almost no direct light; a soft emissive lift stands in for the light bouncing off the floor)
  const ceilM = M.stuccoIn.clone(); ceilM.emissive = new THREE.Color(0xb3a796); ceilM.emissiveIntensity = 0.32;
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(HOUSE.w, HOUSE.d), ceilM);
  ceil.geometry.attributes.uv.array.forEach((v, i, a) => { a[i] = v * (i % 2 === 0 ? HOUSE.w : HOUSE.d) / 2.5; });
  ceil.rotation.x = Math.PI / 2; ceil.position.y = wallH - 0.01;
  ceil.receiveShadow = true;
  group.add(ceil);
  const crown = (w, d, x, z) => { const c = worldBox(w, 0.14, d, ceilM, 2); c.position.set(x, wallH - 0.08, z); group.add(c); };
  crown(HOUSE.w - 0.3, 0.12, 0, -HZ + 0.21); crown(HOUSE.w - 0.3, 0.12, 0, HZ - 0.21);
  crown(0.12, HOUSE.d - 0.3, -HX + 0.21, 0); crown(0.12, HOUSE.d - 0.3, HX - 0.21, 0);
  for (const sx of [-1, 1]) crown(0.12, HOUSE.d - 0.3, -3 + sx * 0.16, 0);

  buildHaciendaTop(group, updaters);

  for (const f of FURNITURE) group.add(furniture(f, models));
  group.add(houseDecor(models));

  // the real bronze ceiling fans, with warm bulbs that flicker when the power wavers
  for (const [x, z] of [[-7, -0.8], [4.2, 3.4], [4.5, -2.6]]) {
    const fan = new THREE.Group();
    const model = fitModel(models.fan.clone(), 1.3, false);
    const fh = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3()).y;
    model.position.y = -fh;
    model.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; } });
    fan.add(model);
    fan.position.set(x, wallH - 0.02, z);
    const light = new THREE.PointLight(0xffc890, 6, 12, 1.6);
    light.position.y = -fh - 0.05; fan.add(light);
    group.add(fan);
    const seed = x * 13.1 + z;
    updaters.push((dt, time) => {
      model.rotation.y += dt * 4.5;
      const f = Math.sin(time * 23 + seed) * Math.sin(time * 7.3 + seed * 2) > 0.93 ? 0.15 : 1;
      light.intensity = 6 * f;
    });
  }
  return { group, boards, grilles };
}

function furniture(f, models) {
  const g = new THREE.Group();
  g.position.set(f.x, 0.04, f.z);
  switch (f.kind) {
    case 'bench': g.add(fitReal(models.bench, 0.95)); break; // against the north wall, facing the room
    case 'bar': { const b = fitReal(models.bar, 2.2); b.rotation.y = -Math.PI / 2; g.add(b); break; } // on the partition, facing west
    case 'dining': {
      const tw = 3.3, td = 1.05;
      g.add(diningTable(tw, td, 0.78));
      // ten carved high-back chairs: four down each side, one at each end
      for (let i = 0; i < 4; i++) {
        const x = -tw / 2 + 0.45 + i * ((tw - 0.9) / 3);
        for (const [z, ry] of [[-td / 2 - 0.32, 0], [td / 2 + 0.32, Math.PI]]) {
          const c = fitReal(models.diningChair, 1.18); c.position.set(x, 0, z); c.rotation.y = ry; g.add(c);
        }
      }
      for (const [x, ry] of [[-tw / 2 - 0.3, Math.PI / 2], [tw / 2 + 0.3, -Math.PI / 2]]) {
        const c = fitReal(models.diningChair, 1.18); c.position.set(x, 0, 0); c.rotation.y = ry; g.add(c);
      }
      // embroidered runner like the one on the real table
      const run = new THREE.Mesh(new THREE.PlaneGeometry(tw - 0.3, 0.34), new THREE.MeshStandardMaterial({ map: T.leafCloth(), color: 0xd9a050, roughness: 0.9 }));
      run.rotation.x = -Math.PI / 2; run.position.y = 0.786; g.add(run);
      break;
    }
    case 'island': case 'counter': case 'stove': {
      box(f.w, f.h - 0.05, f.d, f.kind === 'stove' ? std({ color: 0xd8d4c8 }) : M.darkWoodTable, 0, (f.h - 0.05) / 2, 0, g);
      box(f.w + 0.05, 0.05, f.d + 0.05, f.kind === 'stove' ? std({ color: 0x222222, roughness: 0.4 }) : M.marble, 0, f.h - 0.02, 0, g);
      if (f.kind !== 'stove') {
        // raised-panel cabinet doors with brass pulls on the long sides
        const brass = std({ color: 0xb08a4a, roughness: 0.35, metalness: 0.8 });
        const n = Math.max(2, Math.round(f.w / 0.55)), dw = f.w / n;
        for (const sz of f.kind === 'island' ? [-1, 1] : [1]) for (let i = 0; i < n; i++) {
          const x = -f.w / 2 + dw * (i + 0.5), z = sz * (f.d / 2 + 0.008);
          box(dw - 0.06, f.h - 0.22, 0.016, M.darkWoodTable, x, (f.h - 0.05) / 2 - 0.02, z, g);
          box(dw - 0.2, f.h - 0.42, 0.012, M.darkWood, x, (f.h - 0.05) / 2 - 0.02, z + sz * 0.012, g);
          box(0.02, 0.12, 0.025, brass, x + (i % 2 ? -1 : 1) * (dw / 2 - 0.08), f.h - 0.32, z + sz * 0.02, g);
        }
        box(f.w + 0.02, 0.08, f.d + 0.02, std({ color: 0x1a120c, roughness: 0.8 }), 0, 0.04, 0, g); // toe kick
      }
      break;
    }
    case 'fridge':
      box(f.w, f.h, f.d, std({ color: 0xd8d4c8, roughness: 0.3, metalness: 0.3 }), 0, f.h / 2, 0, g);
      break;
  }
  g.traverse(o => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
  return g;
}

// Decoration that doesn't block movement: cane rockers, iron & marble tables, paintings.
function houseDecor(models) {
  const g = new THREE.Group();
  const at = (o, x, y, z, ry = 0) => { o.position.set(x, y, z); o.rotation.y = ry; g.add(o); return o; };
  // living room: two cane rockers facing the bench across an iron coffee table, iron side table
  at(fitReal(models.caneRocker, 1.05), -9.7, 0.04, -3.9, Math.PI + 0.35);
  at(fitReal(models.caneRocker, 1.05), -7.4, 0.04, -3.8, Math.PI - 0.35);
  at(ironTable(1.15, 0.62, 0.46, M.marble), -8.6, 0.04, -5.05);
  at(ironTable(0.55, 0.55, 0.62, M.marble), -10.2, 0.04, -6.25);
  at(ironTable(0.55, 0.55, 0.62, M.marble), -6.85, 0.04, -6.25);
  // the horse painting on the west wall, the big sepia portrait in the dining room
  const frameDark = std({ color: 0x2a1a12, roughness: 0.5 });
  at(painting('painting_horse.jpg', 0.6, 0.8, std({ color: 0x1d3a44, roughness: 0.5 }), std({ color: 0xb08a4a, roughness: 0.35, metalness: 0.6 })), -10.83, 1.75, 0.4, Math.PI / 2);
  at(painting('painting_portrait.jpg', 1.15, 1.55, frameDark), -2.88, 1.9, 4.55, Math.PI / 2);
  // rugs: the charcoal geometric one under the seating, a red runner by the bar
  const rugM = (st) => new THREE.MeshStandardMaterial({ map: T.rug(st), roughness: 0.95 });
  const r1 = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 2.5), rugM('living')); r1.rotation.x = -Math.PI / 2; r1.rotation.z = Math.PI / 2; at(r1, -8.6, 0.047, -4.7);
  const r2 = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 2.2), rugM('oriental')); r2.rotation.x = -Math.PI / 2; at(r2, -4.45, 0.047, -4.7);
  // potted plants by the windows
  for (const [x, z, sc] of [[-10.35, 6.35, 1.0], [-3.6, 6.4, 0.9], [10.35, 6.3, 1.0], [-10.4, -1.2, 0.85]]) at(fitModel(models.pot.clone(), sc, false), x, 0.04, z);
  g.traverse(o => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
  return g;
}

function buildVeranda(models) {
  const g = new THREE.Group();
  const HZ = HOUSE.d / 2, HX = HOUSE.w / 2;
  const v = STRUCTURES.find(s => s.kind === 'veranda');
  const deck = worldBox(v.w, v.h, v.d, M.terracotta, 1.6);
  deck.position.set(v.x, v.h / 2, v.z);
  g.add(deck);
  
  const colH = 3.05;
  for (const c of VERANDA.columns) {
    const col = worldBox(0.4, colH, 0.4, M.stucco, 2.4);
    col.position.set(c.x, colH / 2, c.z);
    g.add(col);
    box(0.55, 0.15, 0.55, M.stucco, c.x, colH - 0.08, c.z, g);
    box(0.55, 0.12, 0.55, M.stucco, c.x, 0.3, c.z, g);
  }
  const positions = [];
  for (const r of VERANDA.rails) {
    box(r.w, 0.06, 0.08, M.iron, r.x, r.h, r.z, g);
    box(r.w, 0.04, 0.05, M.iron, r.x, 0.32, r.z, g);
    for (let x = r.x - r.w / 2 + 0.15; x < r.x + r.w / 2; x += 0.16) positions.push([x, r.z]);
  }
  const m4 = new THREE.Matrix4();
  const bal = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.022, 0.022, 0.82, 6), M.iron, positions.length);
  positions.forEach(([x, z], i) => bal.setMatrixAt(i, m4.makeTranslation(x, 0.62, z)));
  bal.castShadow = true;
  const knobs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.042, 8, 6), M.iron, positions.length);
  positions.forEach(([x, z], i) => knobs.setMatrixAt(i, m4.makeTranslation(x, 0.62, z)));
  g.add(bal, knobs);

  const depth = VERANDA.z - HZ + 0.6, drop = 0.3, roofTop = HOUSE.wallH + 0.25;
  const slope = Math.atan2(drop, depth), len = Math.hypot(depth, drop);
  for (const [mat, yOff, up] of [[M.roof, 0.04, true], [M.terracotta, -0.02, false]]) {
    const pg = new THREE.PlaneGeometry(HOUSE.w + 1.2, len);
    pg.attributes.uv.array.forEach((val, i, a) => { a[i] = val * (i % 2 === 0 ? (HOUSE.w + 1.2) / 2.5 : len / 2.5); });
    const p = new THREE.Mesh(pg, mat);
    p.rotation.x = up ? -Math.PI / 2 + slope : Math.PI / 2 + slope;
    p.position.set(0, roofTop - drop / 2 + yOff, HZ + depth / 2);
    p.castShadow = up; p.receiveShadow = true;
    g.add(p);
  }
  for (let x = -HX; x <= HX; x += 1.1) box(0.1, 0.14, len, M.darkWood, x, roofTop - 0.1 - drop / 2, HZ + depth / 2, g).rotation.x = slope;
  box(HOUSE.w + 0.4, 0.3, 0.3, M.darkWood, 0, colH + 0.13, VERANDA.z, g);

  for (const [x, z, ry] of [[-9.6, 8.7, 0.35], [9.6, 8.8, -0.35]]) {
    const r = fitReal(models.caneRocker, 1.05);
    r.position.set(x, 0.25, z); r.rotation.y = ry;
    g.add(r);
  }
  // iron lanterns on the front wall between the openings
  for (const x of [-9.0, -3.5, 3.5, 9.0]) { const l = lantern(); l.position.set(x, 2.25, HZ + HOUSE.t / 2 + 0.03); g.add(l); }
  // curved front steps down to the path (the drone photo shows a half-round flight)
  for (const [r, h] of [[2.0, 0.09], [1.55, 0.18]]) {
    const st = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 40, 1, false, -Math.PI / 2, Math.PI), M.terracotta);
    st.position.set(0, h / 2, VERANDA.z + 0.25); st.castShadow = st.receiveShadow = true; g.add(st);
  }
  // compass-rose medallion set into a widened square of the path
  const sq = worldBox(3.4, 0.03, 3.4, M.terracotta, 1.2); sq.position.set(0, 0.035, 14.6); g.add(sq);
  const med = new THREE.Mesh(new THREE.CircleGeometry(1.35, 48), new THREE.MeshStandardMaterial({ map: T.compass(), roughness: 0.6 }));
  med.rotation.x = -Math.PI / 2; med.position.set(0, 0.052, 14.6); med.receiveShadow = true; g.add(med);
  // the long table with the white cloth (by the barred windows) and the leaf-print one
  const tA = clothTable(2.0, 0.9, 0.76, std({ map: T.linen(), roughness: 0.95 })); tA.position.set(-5.6, 0.25, 9.1); g.add(tA);
  const tB = clothTable(1.2, 0.9, 0.76, std({ map: T.leafCloth(), roughness: 0.9 })); tB.position.set(5.6, 0.25, 9.1); g.add(tB);
  for (const [x, z, ry] of [[-6.2, 8.25, 0], [-5.0, 8.25, 0], [-6.2, 9.95, Math.PI], [-5.0, 9.95, Math.PI], [5.6, 8.25, 0], [5.6, 9.95, Math.PI], [6.55, 9.1, -Math.PI / 2]]) {
    const c = fitReal(models.xchair, 0.9, [0.72, 0.62, 0.55]);
    c.position.set(x, 0.25, z); c.rotation.y = ry;
    g.add(c);
  }
  for (const [x, z] of [[-2.4, 11.2], [2.4, 11.2], [-10.6, 10.6], [10.6, 10.6]]) {
    const p = fitModel(models.pot.clone(), 0.9, false);
    p.position.set(x, 0.25, z);
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

// Porch lanterns (black iron with glowing glass) for the veranda wall
function lantern() {
  const g = new THREE.Group();
  const iron = M.iron;
  box(0.05, 0.3, 0.05, iron, 0, 0, -0.02, g);
  box(0.04, 0.04, 0.22, iron, 0, 0.12, 0.08, g);
  const glow = new THREE.MeshStandardMaterial({ color: 0xffe2b0, emissive: 0xffc070, emissiveIntensity: 2.2, roughness: 0.3 });
  box(0.16, 0.24, 0.16, glow, 0, -0.02, 0.2, g);
  for (const [x, z] of [[-0.085, 0.115], [0.085, 0.115], [-0.085, 0.285], [0.085, 0.285]]) box(0.018, 0.28, 0.018, iron, x, -0.02, z, g);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.12, 4), iron); cap.rotation.y = Math.PI / 4; cap.position.set(0, 0.16, 0.2); g.add(cap);
  return g;
}

// ---------------------------------------------------------------- doors & windows
// (all built in local space: width along X, facing +Z, centred, bottom at y = -h/2 for leaves)
function boxGeo(w, h, d, x, y, z, rx = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx) g.rotateX(rx);
  g.translate(x, y, z);
  return g;
}
function louveredLeaf(w, h) {
  const parts = [];
  const st = 0.06;
  parts.push(boxGeo(st, h, 0.045, -w / 2 + st / 2, 0, 0), boxGeo(st, h, 0.045, w / 2 - st / 2, 0, 0));
  for (const y of [-h / 2 + 0.05, h / 2 - 0.05, -h * 0.08]) parts.push(boxGeo(w - st * 2, y === -h * 0.08 ? 0.07 : 0.1, 0.045, 0, y, 0));
  for (let y = -h / 2 + 0.13; y < h / 2 - 0.12; y += 0.055) if (Math.abs(y + h * 0.08) > 0.06) parts.push(boxGeo(w - st * 2, 0.05, 0.008, 0, y, 0, 0.75));
  const m = new THREE.Mesh(mergeGeometries(parts), M.darkWood);
  m.castShadow = m.receiveShadow = true;
  return m;
}
function glazedLeaf(w, h) {
  const g = new THREE.Group();
  const parts = [];
  const st = 0.08;
  parts.push(boxGeo(st, h, 0.05, -w / 2 + st / 2, 0, 0), boxGeo(st, h, 0.05, w / 2 - st / 2, 0, 0));
  parts.push(boxGeo(w, 0.12, 0.05, 0, h / 2 - 0.06, 0), boxGeo(w, 0.22, 0.05, 0, -h / 2 + 0.11, 0), boxGeo(w, 0.03, 0.03, 0, h * 0.12, 0));
  for (let i = 1; i < 2; i++) parts.push(boxGeo(0.03, h - 0.3, 0.03, -w / 2 + st + (w - st * 2) * i / 2, 0.05, 0));
  const frame = new THREE.Mesh(mergeGeometries(parts), M.darkWood);
  frame.castShadow = frame.receiveShadow = true;
  g.add(frame);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(w - st * 2, h - 0.34), new THREE.MeshStandardMaterial({ color: 0x8fa3a8, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.35 }));
  glass.position.y = 0.05;
  g.add(glass);
  return g;
}
// Wrought-iron window grille: round bars with forged collars, flat bands top and bottom
function ironGrille(w, h) {
  const parts = [];
  const n = Math.max(5, Math.round(w / 0.12));
  for (let i = 0; i <= n; i++) {
    const x = -w / 2 + 0.04 + (w - 0.08) * i / n;
    const bar = new THREE.CylinderGeometry(0.011, 0.011, h - 0.02, 6); bar.translate(x, h / 2, 0); parts.push(bar);
    for (const y of [h * 0.33, h * 0.66]) { const c = new THREE.CylinderGeometry(0.021, 0.021, 0.07, 8); c.translate(x, y, 0); parts.push(c); }
    const tip = new THREE.ConeGeometry(0.02, 0.07, 6); tip.translate(x, h - 0.02, 0); parts.push(tip);
  }
  for (const y of [0.04, h * 0.5, h - 0.09]) parts.push(boxGeo(w, 0.03, 0.012, 0, y, 0.012));
  const m = new THREE.Mesh(mergeGeometries(parts), M.iron);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

// ---------------------------------------------------------------- hacienda upper levels
// After the drone photo: flat roof terraces with parapets and a cornice, terracotta shed roofs
// along the front (running into the veranda roof) and down the west wing, and a white upper
// storey with a three-arch loggia and balustrade looking over the garden. Visual only: the
// playable house is the ground floor.
const LOGGIA = { x0: -5, x1: 6.5, z0: 2.4, z1: 3.8 };
function shedRoof(corners, parent) {
  // corners: 4 [x,y,z] points, high edge first; UVs in world units so the tiles keep scale
  const g = new THREE.BufferGeometry();
  const [a, b, c, d] = corners;
  const across = Math.hypot(b[0] - a[0], b[2] - a[2]), down = Math.hypot(d[0] - a[0], d[1] - a[1], d[2] - a[2]);
  g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c, ...d], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, down / 2.2, across / 2.2, down / 2.2, across / 2.2, 0, 0, 0], 2));
  g.setIndex([0, 3, 1, 1, 3, 2]);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, M.roof);
  m.castShadow = m.receiveShadow = true;
  parent.add(m);
  // fascia along the low edge
  const len = Math.hypot(c[0] - d[0], c[2] - d[2]);
  const f = box(len + 0.1, 0.14, 0.12, M.darkWood, (c[0] + d[0]) / 2, (c[1] + d[1]) / 2 - 0.05, (c[2] + d[2]) / 2, parent);
  f.rotation.y = -Math.atan2(c[2] - d[2], c[0] - d[0]);
  return m;
}

function archWall(w, h, depth, arches, mat) {
  // a wall w x h with semicircular-headed openings: arches = [{cx, w, sill, h}]
  const sh = new THREE.Shape();
  sh.moveTo(-w / 2, 0); sh.lineTo(w / 2, 0); sh.lineTo(w / 2, h); sh.lineTo(-w / 2, h); sh.lineTo(-w / 2, 0);
  for (const a of arches) {
    const r = a.w / 2, spring = a.sill + a.h - r;
    const hole = new THREE.Path();
    hole.moveTo(a.cx - r, a.sill); hole.lineTo(a.cx + r, a.sill); hole.lineTo(a.cx + r, spring);
    hole.absarc(a.cx, spring, r, 0, Math.PI, false); hole.lineTo(a.cx - r, a.sill);
    sh.holes.push(hole);
  }
  const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelSize: 0.015, bevelThickness: 0.015, bevelSegments: 1, curveSegments: 16 });
  g.translate(0, 0, -depth / 2);
  const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 2, uv.getY(i) / 2);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = m.receiveShadow = true;
  return m;
}

function balustrade(x0, x1, z, y, parent) {
  const prof = [[0, 0], [0.07, 0], [0.07, 0.05], [0.045, 0.1], [0.075, 0.32], [0.04, 0.5], [0.06, 0.56], [0.06, 0.62], [0, 0.62]].map(([a, b]) => new THREE.Vector2(a, b));
  const lathe = new THREE.LatheGeometry(prof, 10);
  const n = Math.floor((x1 - x0) / 0.19);
  const inst = new THREE.InstancedMesh(lathe, M.stucco, n);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < n; i++) inst.setMatrixAt(i, m4.makeTranslation(x0 + 0.1 + i * ((x1 - x0 - 0.2) / (n - 1)), y + 0.1, z));
  inst.castShadow = inst.receiveShadow = true;
  parent.add(inst);
  const rail = worldBox(x1 - x0, 0.12, 0.24, M.stucco, 2); rail.position.set((x0 + x1) / 2, y + 0.78, z); parent.add(rail);
  const plinth = worldBox(x1 - x0, 0.1, 0.24, M.stucco, 2); plinth.position.set((x0 + x1) / 2, y + 0.05, z); parent.add(plinth);
}

function buildHaciendaTop(group) {
  const { wallH } = HOUSE, HX = HOUSE.w / 2, HZ = HOUSE.d / 2, top = wallH;
  const glass = std({ color: 0x0c1418, roughness: 0.08, metalness: 0.6 });
  const add = (m, x, y, z) => { m.position.set(x, y, z); group.add(m); return m; };

  // roof slab and a projecting cornice where the walls end
  add(worldBox(HOUSE.w + 0.3, 0.3, HOUSE.d + 0.3, M.stucco, 2), 0, top + 0.15, 0);
  for (const [w, d, x, z] of [[HOUSE.w + 0.55, 0.2, 0, -HZ - 0.1], [0.2, HOUSE.d + 0.55, HX + 0.1, 0]]) add(worldBox(w, 0.14, d, M.stucco, 2), x, top + 0.02, z);

  // terracotta shed roofs: across the front (into the veranda roof) and down the west wing
  const hiF = top + 1.35, lo = top + 0.34, zf = HZ - 3.2, xw = -HX + 4.6;
  shedRoof([[-HX - 0.3, hiF, zf], [HX + 0.3, hiF, zf], [HX + 0.3, lo, HZ + 0.3], [-HX - 0.3, lo, HZ + 0.3]], group);
  shedRoof([[xw, hiF, -HZ - 0.3], [xw, hiF, zf], [-HX - 0.3, lo, zf], [-HX - 0.3, lo, -HZ - 0.3]], group);
  // end walls closing the gaps under the high edges
  add(worldBox(HX * 2 + 0.6, hiF - top - 0.3, 0.22, M.stucco, 2), 0, (hiF + top + 0.3) / 2, zf - 0.11);

  // parapet around the open terrace (back and east sides)
  for (const [w, d, x, z] of [[HX - xw + 0.2, 0.22, (xw + HX) / 2, -HZ - 0.04], [0.22, zf + HZ, HX + 0.04, (zf - HZ) / 2]]) {
    add(worldBox(w, 0.75, d, M.stucco, 2), x, top + 0.3 + 0.375, z);
    add(worldBox(w + 0.12, 0.08, d + 0.12, M.stucco, 2), x, top + 0.3 + 0.79, z);
  }

  // upper storey
  const L = LOGGIA, uy = top + 0.3, uh = 3.1, ux = (L.x0 + L.x1) / 2, uw = L.x1 - L.x0, zb = -4.6;
  add(worldBox(uw, uh, L.z0 - zb, M.stucco, 2), ux, uy + uh / 2, (L.z0 + zb) / 2);
  // loggia: arched front wall, side walls, ceiling, balustrades, dark doors at the back
  const arches = [-1, 0, 1].map(i => ({ cx: i * 3.55, w: 2.5, sill: 0, h: 2.55 }));
  const aw = archWall(uw, uh, 0.4, arches, M.stucco);
  add(aw, ux, uy, L.z1 - 0.2);
  for (const x of [L.x0 + 0.2, L.x1 - 0.2]) add(worldBox(0.4, uh, L.z1 - L.z0, M.stucco, 2), x, uy + uh / 2, (L.z0 + L.z1) / 2);
  add(worldBox(uw, 0.25, L.z1 - L.z0, M.stucco, 2), ux, uy + uh - 0.125, (L.z0 + L.z1) / 2);
  add(flat(uw - 0.8, L.z1 - L.z0, M.terracotta, ux, uy + 0.02, (L.z0 + L.z1) / 2, 1.2));
  for (const a of arches) balustrade(ux + a.cx - a.w / 2, ux + a.cx + a.w / 2, L.z1 - 0.2, uy, group);
  for (const a of arches) {
    const door = box(1.3, 2.3, 0.06, glass, ux + a.cx, uy + 1.15, L.z0 + 0.04, group);
    for (const dx of [-0.68, 0.68]) box(0.08, 2.4, 0.1, M.darkWood, ux + a.cx + dx, uy + 1.2, L.z0 + 0.06, group);
    box(1.44, 0.08, 0.1, M.darkWood, ux + a.cx, uy + 2.38, L.z0 + 0.06, group);
    door.castShadow = false;
  }
  // upper cornice, parapet and rooftop details (water tank, white dome skylight)
  add(worldBox(uw + 0.4, 0.16, L.z1 - zb + 0.4, M.stucco, 2), ux, uy + uh + 0.02, (L.z1 + zb) / 2);
  for (const [w, d, x, z] of [[uw, 0.2, ux, zb + 0.1], [uw, 0.2, ux, L.z1 - 0.1], [0.2, L.z1 - zb, L.x0 + 0.1, (L.z1 + zb) / 2], [0.2, L.z1 - zb, L.x1 - 0.1, (L.z1 + zb) / 2]]) add(worldBox(w, 0.55, d, M.stucco, 2), x, uy + uh + 0.35, z);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1.15, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), M.stucco);
  dome.castShadow = dome.receiveShadow = true; add(dome, ux + 2.2, uy + uh + 0.1, zb + 2.6);
  add(worldBox(1.6, 1.1, 1.4, M.stucco, 2), ux - 3.1, uy + uh + 0.65, zb + 1.6);
  // windows on the upper side and back walls: dark glass in deep stucco reveals with wood frames
  const win = (x, z, rotY) => {
    const g = new THREE.Group(); g.position.set(x, uy + 1.55, z); g.rotation.y = rotY;
    box(1.0, 1.4, 0.05, glass, 0, 0, -0.02, g);
    for (const dx of [-0.52, 0.52]) box(0.07, 1.5, 0.12, M.darkWood, dx, 0, 0, g);
    for (const dy of [-0.72, 0.72]) box(1.1, 0.07, 0.12, M.darkWood, 0, dy, 0, g);
    box(0.05, 1.4, 0.06, M.darkWood, 0, 0, 0.01, g);
    box(1.25, 0.08, 0.22, M.stucco, 0, -0.78, 0.08, g);
    group.add(g);
  };
  for (const x of [-3, 0.5, 4]) win(x, zb - 0.01, Math.PI);
  for (const z of [-3, -0.3]) { win(L.x0 - 0.01, z, -Math.PI / 2); win(L.x1 + 0.01, z, Math.PI / 2); }
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
    if (Math.abs(x) < HOUSE.w / 2 + 0.6 && z > -HOUSE.d / 2 - 0.6 && z < VERANDA.z + 0.8) d = 0;
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

