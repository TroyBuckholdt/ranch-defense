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
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  HOUSE, HOUSE_WALLS, ENTRIES, FURNITURE, STRUCTURES, HAY_BALES, TREES, UNDERGROWTH, FENCE_SEGMENTS,
  FENCE_HEIGHT, MAX_BOARDS, VERANDA, HEDGES, PENS, heightAt, shoreZ, SAND_WIDTH, trailDist, solidsNear,
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
  const t = texLoader.load(A + 'tex/' + file);
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
  const gltf = await new GLTFLoader().loadAsync(A + 'models/' + path);
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
    sand: pbr('coast_sand_01'),
    floor: new THREE.MeshStandardMaterial({ map: loadTex('ranch_floor.jpg'), roughness: 0.32, metalness: 0 }),
    border: new THREE.MeshStandardMaterial({ map: loadTex('ranch_border.jpg'), roughness: 0.32 }),
    dado: std({ color: 0xcdb48a, roughness: 0.6 }),
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
  const hdr = await new HDRLoader().loadAsync(A + 'hdri/kloofendal_48d_partly_cloudy_puresky.hdr');
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  scene.background = hdr;
  scene.backgroundIntensity = 0.9;
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromEquirectangular(hdr).texture;
  scene.environmentIntensity = 0.9;
  const sunDir = brightestDirection(hdr);

  scene.fog = new THREE.FogExp2(0xb9c4cc, 0.0062);

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
  for (const s of STRUCTURES) { const m = buildStructure(s, updaters); if (m) scene.add(m); }
  for (const b of HAY_BALES) scene.add(hayBale(b));
  scene.add(buildGardenWall());
  scene.add(buildHedges(models));
  for (const p of PENS) scene.add(buildPen(p));

  // ---------- Jungle ----------
  onProgress('Growing the jungle...');
  const veg = buildVegetation(models, Q);
  scene.add(veg.group);
  updaters.push(veg.update);
  const grass = buildGrass(Q.grass);
  scene.add(grass.mesh);
  updaters.push(grass.update);

  return {
    scene, sun, boards: house.boards,
    update(dt, t, camPos) { for (const u of updaters) u(dt, t, camPos); },
  };
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
  if (dir.y < 0.35) { dir.y = 0.35; } // keep shadows from getting absurdly long
  return dir.normalize();
}

async function loadAllModels() {
  const names = {
    rocker: 'Rockingchair_01/Rockingchair_01_1k.gltf', sofa: 'painted_wooden_sofa/painted_wooden_sofa_1k.gltf',
    table: 'dining_table/dining_table_1k.gltf', crate: 'wooden_crate_01/wooden_crate_01_1k.gltf',
    pot: 'potted_plant_02/potted_plant_02_lod.glb', fern: 'fern_02/fern_02_lod.glb',
    shrub: 'shrub_04/shrub_04_lod.glb', sapling: 'shrub_02/shrub_02_lod.glb',
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
  }
  g.setAttribute('splat', new THREE.BufferAttribute(splat, 4));
  g.computeVertexNormals();

  const tex = (n, srgb = true) => loadTex(n, srgb);
  const mat = new THREE.MeshStandardMaterial({
    map: tex('leafy_grass_diff.jpg'), normalMap: tex('forest_leaves_02_nor.jpg', false),
    normalScale: new THREE.Vector2(0.8, 0.8), roughness: 1, color: 0xc8dca0,
  });
  const uni = {
    tJungle: { value: tex('forest_leaves_02_diff.jpg') }, tSand: { value: tex('coast_sand_01_diff.jpg') },
    tTrail: { value: tex('brown_mud_leaves_01_diff.jpg') }, tMacro: { value: T.macroNoise() },
  };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uni);
    sh.vertexShader = 'attribute vec4 splat;\nvarying vec4 vSplat;\nvarying vec2 vWXZ;\n' + sh.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      vSplat = splat;
      vWXZ = (modelMatrix * vec4(transformed, 1.0)).xz;`);
    sh.fragmentShader = 'uniform sampler2D tJungle, tSand, tTrail, tMacro;\nvarying vec4 vSplat;\nvarying vec2 vWXZ;\n' + sh.fragmentShader.replace('#include <map_fragment>', `
      vec2 tuv = vWXZ / 3.0;
      vec4 cg = texture2D(map, tuv) * vec4(0.82, 1.0, 0.62, 1.0);
      vec4 cj = texture2D(tJungle, tuv * 0.8) * vec4(0.8, 0.85, 0.7, 1.0);
      vec4 cs = texture2D(tSand, tuv * 0.9) * vec4(1.08, 1.02, 0.92, 1.0);
      vec4 ct = texture2D(tTrail, tuv);
      vec4 col = cg * vSplat.x + cj * vSplat.y + cs * vSplat.z + ct * vSplat.w;
      float macro = texture2D(tMacro, vWXZ / 70.0).r;
      col.rgb *= mix(0.78, 1.18, macro);
      diffuseColor *= col;`);
  };
  const m = new THREE.Mesh(g, mat);
  m.receiveShadow = true;
  return m;
}

function buildSea() {
  const group = new THREE.Group();
  const g = new THREE.PlaneGeometry(1400, 800, 140, 80);
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0.0, 520);
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const shallow = new THREE.Color(0x4fb3a8), deep = new THREE.Color(0x1b4a6a), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const depth = Math.max(0, -heightAt(pos.getX(i), pos.getZ(i)));
    c.copy(shallow).lerp(deep, Math.min(1, depth / 3));
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = M.water.clone();
  mat.vertexColors = true;
  mat.normalMap.repeat.set(80, 50);
  const sea = new THREE.Mesh(g, mat);
  sea.receiveShadow = true;
  group.add(sea);

  // foam where the waves meet the sand
  const pts = [];
  for (let x = -270; x <= 270; x += 2) pts.push(x);
  const fg = new THREE.BufferGeometry();
  const fp = [], fuv = [];
  for (const [i, x] of pts.entries()) {
    const z = shoreZ(x);
    fp.push(x, 0.04, z - 2.5, x, 0.04, z + 2.5);
    fuv.push(i * 0.15, 0, i * 0.15, 1);
  }
  const idx = [];
  for (let i = 0; i < pts.length - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  fg.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3));
  fg.setAttribute('uv', new THREE.Float32BufferAttribute(fuv, 2));
  fg.setIndex(idx);
  const foamMat = new THREE.MeshBasicMaterial({ map: T.smoke(), color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false });
  foamMat.map.wrapS = THREE.RepeatWrapping;
  const foam = new THREE.Mesh(fg, foamMat);
  group.add(foam);

  return {
    group,
    update(dt, t) {
      mat.normalMap.offset.set(t * 0.004, t * 0.006);
      foam.position.z = Math.sin(t * 0.5) * 1.6 - 0.8;
      foamMat.opacity = 0.35 + Math.sin(t * 0.5 + 1.5) * 0.2;
    },
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

  const boards = [];
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

    // shutters / door leaves swung fully open against the outside wall
    const leafH = e.top - e.sill - 0.05, leafW = W / 2;
    const outZ = alongX ? e.nz : -e.nx;
    for (const sd of [-1, 1]) {
      const leaf = new THREE.Group();
      const panel = worldBox(leafW, leafH, 0.05, M.darkWood, 1);
      panel.position.x = sd * leafW / 2;
      leaf.add(panel);
      const nPanels = e.kind === 'door' ? 3 : 2;
      for (let k = 0; k < nPanels; k++) leaf.add(box(leafW * 0.7, leafH / (nPanels + 1.2), 0.03, M.darkWood, sd * leafW / 2, -leafH / 2 + leafH * (k + 0.55) / nPanels, outZ * 0.035));
      const off = t / 2 + 0.035;
      leaf.position.set(e.x + (alongX ? sd * W / 2 : 0) + e.nx * off, e.sill + leafH / 2 + 0.02, e.z + (alongX ? 0 : sd * W / 2) + e.nz * off);
      leaf.rotation.y = alongX ? 0 : -Math.PI / 2;
      leaf.traverse(o => { if (o.isMesh) o.castShadow = true; });
      group.add(leaf);
    }

    const list = [];
    const span = e.top - e.sill;
    for (let i = 0; i < MAX_BOARDS; i++) {
      const g = new THREE.BoxGeometry(W + 0.45, 0.2, 0.05);
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

  // ceiling: dark beams over terracotta, like the veranda photo
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(HOUSE.w, HOUSE.d), M.terracotta);
  ceil.geometry.attributes.uv.array.forEach((v, i, a) => { a[i] = v * (i % 2 === 0 ? HOUSE.w : HOUSE.d) / 1.5; });
  ceil.rotation.x = Math.PI / 2; ceil.position.y = wallH - 0.01;
  group.add(ceil);
  for (let x = -HX + 0.8; x < HX; x += 1.4) box(0.14, 0.2, HOUSE.d, M.darkWood, x, wallH - 0.11, 0, group);

  // clay tile roof
  const over = 0.8, rise = HOUSE.roofH - wallH, run = HZ + over;
  const ang = Math.atan2(rise, HZ);
  const slopeLen = run / Math.cos(ang);
  const eaveY = wallH - over * Math.tan(ang);
  for (const s of [-1, 1]) {
    const g = new THREE.PlaneGeometry(HOUSE.w + over * 2, slopeLen);
    g.attributes.uv.array.forEach((v, i, a) => { a[i] = v * (i % 2 === 0 ? (HOUSE.w + over * 2) / 2.5 : slopeLen / 2.5); });
    const plane = new THREE.Mesh(g, M.roof);
    plane.rotation.x = s > 0 ? ang - Math.PI / 2 : Math.PI / 2 - ang;
    plane.position.set(0, (HOUSE.roofH + eaveY) / 2, s * run / 2);
    plane.castShadow = plane.receiveShadow = true;
    group.add(plane);
  }
  const ridge = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, HOUSE.w + over * 2, 10), M.roof);
  ridge.rotation.z = Math.PI / 2; ridge.position.y = HOUSE.roofH + 0.02; ridge.castShadow = true;
  group.add(ridge);
  const tri = new THREE.Shape();
  tri.moveTo(-HZ, 0); tri.lineTo(HZ, 0); tri.lineTo(0, rise); tri.lineTo(-HZ, 0);
  for (const s of [-1, 1]) for (const flip of [0, Math.PI]) {
    const tg = new THREE.ShapeGeometry(tri);
    tg.attributes.uv.array.forEach((v, i, a) => { a[i] = v / 2.4; });
    const g = new THREE.Mesh(tg, M.stucco);
    g.position.set(s * HX, wallH, 0);
    g.rotation.y = s * Math.PI / 2 + flip;
    g.castShadow = true;
    group.add(g);
  }

  for (const f of FURNITURE) group.add(furniture(f, models));

  // ceiling fans with warm bulbs that flicker when the power wavers
  for (const [x, z] of [[-7, -0.5], [4.5, -0.5], [-0.5, 4.2]]) {
    const fan = new THREE.Group();
    fan.position.set(x, wallH - 0.55, z);
    box(0.03, 0.4, 0.03, M.iron, 0, 0.3, 0, fan);
    fan.add(new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.1, 0.14, 12), M.darkWood));
    const blades = new THREE.Group(); fan.add(blades);
    for (let i = 0; i < 5; i++) {
      const b = box(0.62, 0.015, 0.14, M.darkWood, 0, 0, 0);
      b.position.set(Math.cos(i * 1.2566) * 0.4, 0.02, Math.sin(i * 1.2566) * 0.4);
      b.rotation.y = -i * 1.2566;
      blades.add(b);
    }
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffe0b0 }));
    bulb.position.y = -0.14; fan.add(bulb);
    const light = new THREE.PointLight(0xffc890, 6, 12, 1.6);
    light.position.y = -0.3; fan.add(light);
    group.add(fan);
    const seed = x * 13.1 + z;
    updaters.push((dt, time) => {
      blades.rotation.y += dt * 4.5;
      const f = Math.sin(time * 23 + seed) * Math.sin(time * 7.3 + seed * 2) > 0.93 ? 0.15 : 1;
      light.intensity = 6 * f;
      bulb.material.color.setScalar(f > 0.5 ? 1 : 0.3);
    });
  }
  return { group, boards };
}

function furniture(f, models) {
  const g = new THREE.Group();
  g.position.set(f.x, 0.04, f.z);
  const place = (model, w) => { const m = fitModel(model.clone(), w, f.w >= f.d); g.add(m); return m; };
  switch (f.kind) {
    case 'couch': place(models.sofa, Math.max(f.w, f.d)).rotation.y += Math.PI; break;
    case 'table': place(models.table, Math.max(f.w, f.d)); break;
    case 'crate': place(models.crate, Math.max(f.w, f.d) * 0.9); break;
    case 'island': case 'counter': case 'stove': {
      box(f.w, f.h - 0.05, f.d, f.kind === 'stove' ? std({ color: 0xd8d4c8 }) : M.darkWood, 0, (f.h - 0.05) / 2, 0, g);
      box(f.w + 0.05, 0.05, f.d + 0.05, f.kind === 'stove' ? std({ color: 0x222222, roughness: 0.4 }) : M.border, 0, f.h - 0.02, 0, g);
      break;
    }
    case 'fridge':
      box(f.w, f.h, f.d, std({ color: 0xd8d4c8, roughness: 0.3, metalness: 0.3 }), 0, f.h / 2, 0, g);
      break;
    case 'bookshelf': {
      box(f.w, f.h, f.d, M.darkWood, 0, f.h / 2, 0, g);
      const glass = new THREE.MeshStandardMaterial({ color: 0x223338, roughness: 0.04, metalness: 0.7 });
      if (f.w > f.d) box(f.w - 0.2, f.h - 0.3, 0.02, glass, 0, f.h / 2 + 0.05, f.d / 2 + 0.01, g);
      else box(0.02, f.h - 0.3, f.d - 0.2, glass, f.w / 2 + 0.01, f.h / 2 + 0.05, 0, g);
      break;
    }
  }
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
  box(2.8, 0.12, 0.5, M.terracotta, 0, 0.06, VERANDA.z + 0.45, g);

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

  for (const [x, z, ry] of [[-8.5, 8.8, 0.3], [-5, 8.6, -0.2], [8.8, 8.8, -0.4]]) {
    const r = fitModel(models.rocker.clone(), 0.75, false);
    r.position.set(x, 0.25, z); r.rotation.y = Math.PI + ry;
    g.add(r);
  }
  for (const [x, z] of [[-2.2, 11], [2.2, 11], [-10.6, 10.6], [10.6, 10.6]]) {
    const p = fitModel(models.pot.clone(), 0.9, false);
    p.position.set(x, 0.25, z);
    g.add(p);
  }
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

function buildStructure(s, updaters) {
  let g;
  switch (s.kind) {
    case 'veranda': return null;
    case 'bunkhouse': g = whiteBuilding(s, 2.4, 2); break;
    case 'feedstore': g = whiteBuilding(s, 1.4, 1); break;
    case 'fountain': {
      g = new THREE.Group(); g.position.set(s.x, 0, s.z);
      const rim = worldBox(s.w, s.h, s.d, M.stucco, 1.5); rim.position.y = s.h / 2; g.add(rim);
      g.add(flat(s.w - 0.4, s.d - 0.4, M.water, 0, s.h - 0.12, 0));
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
    case 'truck': {
      g = new THREE.Group(); g.position.set(s.x, 0, s.z);
      const paint = new THREE.MeshPhysicalMaterial({ color: 0xe8e6e0, roughness: 0.3, metalness: 0.3, clearcoat: 1, clearcoatRoughness: 0.15 });
      const dark = std({ color: 0x1a1c1e, roughness: 0.6 });
      box(2.2, 0.8, 5.2, paint, 0, 0.95, 0, g);
      box(2.1, 0.95, 2.1, paint, 0, 1.8, -0.5, g);
      box(2.12, 0.55, 1.6, new THREE.MeshStandardMaterial({ color: 0x111820, roughness: 0.05, metalness: 0.9 }), 0, 1.9, -0.5, g);
      box(2.25, 0.25, 0.2, dark, 0, 0.7, -2.65, g);
      for (const [wx, wz] of [[-1.05, -1.6], [1.05, -1.6], [-1.05, 1.7], [1.05, 1.7]]) {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.3, 20), dark);
        w.rotation.z = Math.PI / 2; w.position.set(wx, 0.45, wz); g.add(w);
      }
      g.rotation.y = 0.25;
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

// ---------------------------------------------------------------- vegetation
// Instances are grouped into 40 m chunks so the GPU can skip whole patches that are
// off-screen, and distant chunks are hidden (the haze covers the pop).
class ChunkedInstances {
  constructor(geometry, material, transforms, { chunk = 40, maxDist = 160, shadows = true } = {}) {
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

  // palms: bent trunk segments + drooping fronds
  const palms = TREES.filter(t => t.kind === 'palm');
  const segGeo = new THREE.CylinderGeometry(0.17, 0.22, 1, 10).translate(0, 0.5, 0);
  segGeo.attributes.uv.array.forEach((v, i, a) => { if (i % 2 === 1) a[i] = v * 1.5; });
  const SEG = 6, segT = [], frondT = [];
  palms.forEach((t, i) => {
    const h = (8 + (i % 5)) * t.s, segH = h / SEG, lean = 0.05 + (i % 4) * 0.035, dir = i * 2.4;
    const p = new THREE.Vector3(t.x, gy(t.x, t.z), t.z);
    for (let j = 0; j < SEG; j++) {
      const tilt = lean * (j + 1);
      const rx = Math.cos(dir) * tilt, rz = Math.sin(dir) * tilt;
      segT.push({ x: p.x, y: p.y, z: p.z, rx, rz, sx: t.s * (1 - j * 0.07), sy: segH, sz: t.s * (1 - j * 0.07) });
      p.add(new THREE.Vector3(0, segH, 0).applyEuler(new THREE.Euler(rx, 0, rz)));
    }
    for (let j = 0; j < 12; j++) frondT.push({ x: p.x, y: p.y, z: p.z, ry: (j / 12) * Math.PI * 2 + i, rz: -0.3 + (j % 3) * 0.25, s: t.s });
  });
  add([{ geometry: segGeo, material: M.palmBark }], segT, { maxDist: 220 });
  const fg = new THREE.PlaneGeometry(1, 0.55, 8, 1);
  const fpos = fg.attributes.position;
  for (let i = 0; i < fpos.count; i++) { const x = fpos.getX(i) + 0.5; fpos.setXYZ(i, x * 4.2, -x * x * 1.9, fpos.getY(i) * 1.2); }
  fg.computeVertexNormals();
  add([{ geometry: fg, material: new THREE.MeshStandardMaterial({ map: T.frond(), alphaTest: 0.45, roughness: 0.75 }) }], frondT.map(f => ({ ...f, rx: 0, ry: f.ry, rz: f.rz })), { maxDist: 220 });

  // broadleaf jungle trees: bark trunk + canopy built from the sapling model scaled up
  const broad = TREES.filter(t => t.kind !== 'palm');
  const trunkGeo = new THREE.CylinderGeometry(0.28, 0.5, 1, 10).translate(0, 0.5, 0);
  trunkGeo.attributes.uv.array.forEach((v, i, a) => { if (i % 2 === 1) a[i] = v * 3; });
  const trunkT = [], canopyT = [];
  broad.forEach((t, i) => {
    const giant = t.kind === 'giant', h = (giant ? 9 : 5.5) * t.s, y = gy(t.x, t.z);
    trunkT.push({ x: t.x, y, z: t.z, sx: t.s * (giant ? 1.8 : 1), sy: h * 0.72, sz: t.s * (giant ? 1.8 : 1), ry: i });
    const n = giant ? 6 : 4;
    for (let j = 0; j < n; j++) {
      const a = j * 2.1 + i, r = j === 0 ? 0 : 1.6 * t.s * (giant ? 1.6 : 1);
      canopyT.push({ x: t.x + Math.cos(a) * r, y: y + h * (0.42 + (j % 2) * 0.12), z: t.z + Math.sin(a) * r, ry: a, s: t.s * (giant ? 4.6 : 3.4) });
    }
  });
  add([{ geometry: trunkGeo, material: M.bark }], trunkT, { maxDist: 200 });
  add(meshOf(models.sapling), canopyT, { maxDist: 200, shadows: !lowQ });

  // undergrowth: ferns and shrubs from the real models
  const ferns = UNDERGROWTH.filter(u => u.kind === 'fern').map(u => ({ x: u.x, y: gy(u.x, u.z), z: u.z, ry: u.rot, s: u.s * 2.6 }));
  const shrubs = UNDERGROWTH.filter(u => u.kind === 'shrub').map(u => ({ x: u.x, y: gy(u.x, u.z), z: u.z, ry: u.rot, sx: u.s * 4.5, sy: u.s * 5.5, sz: u.s * 4.5 }));
  add(meshOf(models.fern), ferns, { maxDist: lowQ ? 50 : 80, shadows: false });
  add(meshOf(models.shrub), shrubs, { maxDist: lowQ ? 50 : 80, shadows: false });

  return { group, update: (dt, t, cam) => { if (cam) for (const s of sets) s.update(cam); } };
}

// Grass blades in the pasture around the house.
function buildGrass(COUNT) {
  const geo = new THREE.PlaneGeometry(0.035, 0.42, 1, 3);
  geo.translate(0, 0.21, 0);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) { const y = pos.getY(i) / 0.42; pos.setX(i, pos.getX(i) * (1 - y * 0.85)); pos.setZ(i, y * y * 0.06); }
  const mat = new THREE.MeshStandardMaterial({ color: 0x86a650, roughness: 0.85, side: THREE.DoubleSide });
  const uniforms = { uTime: { value: 0 } };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uniforms.uTime;
    sh.vertexShader = 'uniform float uTime;\nvarying float vGrassH;\n' + sh.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      vGrassH = position.y / 0.42;
      vec4 wp = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
      float sway = sin(uTime * 1.7 + wp.x * 0.35 + wp.z * 0.2) * 0.5 + sin(uTime * 3.1 + wp.x * 0.9) * 0.2;
      transformed.x += sway * position.y * position.y * 0.6;`);
    sh.fragmentShader = 'varying float vGrassH;\n' + sh.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      diffuseColor.rgb *= mix(0.4, 1.1, vGrassH);`);
  };
  const mesh = new THREE.InstancedMesh(geo, mat, COUNT);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3();
  const color = new THREE.Color();
  let seed = 99;
  const r = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  let n = 0, tries = 0;
  while (n < COUNT && tries++ < COUNT * 5) {
    const rad = 9 + Math.pow(r(), 2.2) * 75, a = r() * Math.PI * 2; // densest near the house
    const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
    if (Math.abs(x) < HOUSE.w / 2 + 0.6 && z > -HOUSE.d / 2 - 0.6 && z < VERANDA.z + 0.8) continue;
    if (Math.abs(x) < 1.6 && z > 9 && z < 22.5) continue;
    if (Math.abs(x) < 3.2 && Math.abs(z - 19) < 3.2) continue;
    if (trailDist(x, z) < 2.5 && Math.hypot(x, z) > 45) continue;
    if (PENS.some(p => Math.abs(x - p.x) < p.w / 2 + 1 && Math.abs(z - p.z) < p.d / 2 + 1)) continue;
    if (solidsNear(x, z, 1).some(b => b.h > 0.3 && Math.abs(x - b.x) < b.w / 2 + 0.2 && Math.abs(z - b.z) < b.d / 2 + 0.2)) continue;
    q.setFromAxisAngle(v.set(0, 1, 0), r() * Math.PI);
    mesh.setMatrixAt(n, m4.compose(v.set(x, heightAt(x, z) - 0.02, z), q, s.set(0.8 + r() * 0.6, 0.6 + r() * 0.9, 1)));
    mesh.setColorAt(n, color.setHSL(0.2 + r() * 0.06, 0.35 + r() * 0.2, 0.3 + r() * 0.14));
    n++;
  }
  mesh.count = n;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return { mesh, update: (dt, t) => { uniforms.uTime.value = t; } };
}

