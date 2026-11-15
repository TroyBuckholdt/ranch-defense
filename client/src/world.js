// Builds the visible ranch from the shared layout. Collision lives in shared/world.js;
// this file only decides what things look like.
//
// Look is matched to the real ranch photos: a white stucco hacienda with a clay tile
// roof, a long veranda with white columns and an iron railing, ochre tile floors with
// a black-and-white border, a fountain in the front garden, palms, and blue pipe
// cattle pens out in the pasture.
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import {
  HOUSE, HOUSE_WALLS, ENTRIES, FURNITURE, STRUCTURES, HAY_BALES, TREES, FENCE_SEGMENTS,
  FENCE_HEIGHT, MAX_BOARDS, MAP_HALF, SOLIDS, VERANDA, HEDGES, PENS,
} from '../../shared/world.js';
import * as T from './textures.js';

const std = (opts) => new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, ...opts });

function box(w, h, d, mat, x = 0, y = 0, z = 0, parent) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  parent?.add(m);
  return m;
}

// Box with UVs scaled to world size so textures don't stretch.
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

// Shared materials (created once)
let M;
function mats() {
  if (M) return M;
  M = {
    stucco: std({ map: T.stucco(), roughness: 0.95 }),
    stuccoIn: std({ map: T.stucco(), color: 0xf2ece0, roughness: 0.95 }),
    dado: std({ color: 0xc9b48a, roughness: 0.9 }),
    terracotta: std({ map: T.terracotta(), roughness: 0.75 }),
    ochre: std({ map: T.ochreTile(), roughness: 0.45 }),
    border: std({ map: T.tileBorder(), roughness: 0.45 }),
    roof: std({ map: T.clayRoof(), roughness: 0.85, side: THREE.DoubleSide }),
    ceiling: std({ map: T.beamCeiling(), roughness: 0.9 }),
    darkWood: std({ map: T.darkWood(), roughness: 0.6 }),
    iron: std({ color: 0x141416, roughness: 0.45, metalness: 0.7 }),
    bluePipe: std({ color: 0x2c4f9a, roughness: 0.5, metalness: 0.5 }),
    plank: std({ map: T.plank(), roughness: 0.9 }),
    leaf: std({ map: T.foliage(), color: 0x7aa060, roughness: 1, flatShading: true }),
    hedge: std({ map: T.foliage(), color: 0x6a9a50, roughness: 1, flatShading: true }),
    flower: std({ color: 0xd8341f, roughness: 0.8, emissive: 0x200000 }),
    water: new THREE.MeshStandardMaterial({ color: 0x24494a, roughness: 0.04, metalness: 0.4 }),
  };
  return M;
}

export function buildWorld(renderer, Q = { shadows: 2048, grass: 26000 }) {
  const scene = new THREE.Scene();
  const updaters = [];
  mats();

  // ---------- Sky, sun, fog: tropical sunset ----------
  const sky = new Sky();
  sky.scale.setScalar(4000);
  const su = sky.material.uniforms;
  su.turbidity.value = 6;
  su.rayleigh.value = 1.6;
  su.mieCoefficient.value = 0.005;
  su.mieDirectionalG.value = 0.86;
  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(85), THREE.MathUtils.degToRad(-120));
  su.sunPosition.value.copy(sunDir);
  scene.add(sky);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(sky.clone());
  scene.environment = pmrem.fromScene(envScene, 0.04).texture;
  scene.environmentIntensity = 0.55;

  scene.fog = new THREE.FogExp2(0x9a8a80, 0.0068);

  const sun = new THREE.DirectionalLight(0xffb070, 3.0);
  sun.position.copy(sunDir).multiplyScalar(120);
  sun.castShadow = Q.shadows > 0;
  sun.shadow.mapSize.set(Q.shadows || 512, Q.shadows || 512);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -60; sc.right = sc.top = 60; sc.near = 1; sc.far = 300;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);
  scene.add(new THREE.HemisphereLight(0x9ab0d0, 0x4a4028, 0.7));

  // ---------- Ground ----------
  const ground = flat(600, 600, std({ map: T.lushGrass(), roughness: 1 }), 0, 0, 0);
  scene.add(ground);
  // brick path from the veranda steps to the fountain, and around it
  scene.add(flat(2.6, 8, M.terracotta, 0, 0.012, 13.6, 1.2));
  scene.add(flat(6, 6, M.terracotta, 0, 0.011, 19, 1.2));
  scene.add(buildHills());

  // ---------- The house ----------
  const house = buildHouse(updaters);
  scene.add(house.group);
  scene.add(buildVeranda());

  // ---------- Outbuildings and garden ----------
  for (const s of STRUCTURES) {
    const m = buildStructure(s, updaters);
    if (m) scene.add(m);
  }
  for (const b of HAY_BALES) scene.add(hayBale(b));
  scene.add(buildGardenWall());
  scene.add(buildHedges());
  for (const p of PENS) scene.add(buildPen(p));
  const trees = buildTrees();
  scene.add(trees.group);
  updaters.push(trees.update);
  const grass = buildGrass(Q.grass);
  scene.add(grass.mesh);
  updaters.push(grass.update);
  const dust = buildDust();
  scene.add(dust.points);
  updaters.push(dust.update);

  return {
    scene, sun, boards: house.boards,
    update(dt, t, camPos) { for (const u of updaters) u(dt, t, camPos); },
  };
}

// ---------- House ----------
function buildHouse(updaters) {
  const group = new THREE.Group();
  const { wallH, t } = HOUSE;
  const HX = HOUSE.w / 2, HZ = HOUSE.d / 2;

  // ochre tile floor with the patterned border running around each room
  group.add(flat(HOUSE.w, HOUSE.d, M.ochre, 0, 0.02, 0, 1.0));
  const bw = 0.32, inset = 0.55;
  const rooms = [[-HX, -3], [-3, HX]];
  for (const [x0, x1] of rooms) {
    const cx = (x0 + x1) / 2, w = x1 - x0 - inset * 2, d = HOUSE.d - inset * 2;
    for (const s of [-1, 1]) {
      const strip = flat(w, bw, M.border, cx, 0.025, s * (d / 2), 0);
      strip.geometry.attributes.uv.array.forEach((v, i, a) => { if (i % 2 === 0) a[i] = v * w / 1.2; });
      group.add(strip);
      const side = flat(d, bw, M.border, cx + s * (w / 2), 0.025, 0, 0);
      side.rotation.z = Math.PI / 2;
      side.geometry.attributes.uv.array.forEach((v, i, a) => { if (i % 2 === 0) a[i] = v * d / 1.2; });
      group.add(side);
    }
  }
  box(HOUSE.w + 0.5, 0.35, HOUSE.d + 0.5, std({ color: 0xbcb4a4, roughness: 1 }), 0, -0.15, 0, group).castShadow = false;

  // walls: stucco outside, painted stucco inside with a low ochre dado band
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
    // base band inside (painted skirting) and outside (darker plinth)
    box(alongX ? wpiece.w : 0.02, 0.18, alongX ? 0.02 : wpiece.d, M.dado, wpiece.x - nx * (half + 0.01), 0.09, wpiece.z - nz * (half + 0.01), group);
    box(alongX ? wpiece.w : 0.03, 0.45, alongX ? 0.03 : wpiece.d, std({ color: 0x9a8a78, roughness: 1 }), wpiece.x + nx * (half + 0.015), 0.22, wpiece.z + nz * (half + 0.015), group);
  }

  // doors/windows: sill + header + dark wood frame, open shutters/doors, and the boards
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
    for (const s of [-1, 1]) { // jambs
      const px = e.x + (alongX ? s * (W / 2 + 0.05) : 0), pz = e.z + (alongX ? 0 : s * (W / 2 + 0.05));
      box(alongX ? 0.1 : t + 0.06, e.top - e.sill, alongX ? t + 0.06 : 0.1, M.darkWood, px, (e.top + e.sill) / 2, pz, group);
    }
    box(alongX ? W + 0.3 : t + 0.06, 0.12, alongX ? t + 0.06 : W + 0.3, M.darkWood, e.x, e.top + 0.06, e.z, group);

    // shutter / door leaves swung fully open, flat against the outside wall
    const leafH = e.top - e.sill - 0.05, leafW = W / 2;
    const outZ = alongX ? e.nz : -e.nx; // local +z faces outward after the leaf's rotation
    for (const sd of [-1, 1]) {
      const leaf = new THREE.Group();
      const panel = worldBox(leafW, leafH, 0.05, M.darkWood, 1);
      panel.position.x = sd * leafW / 2;
      leaf.add(panel);
      const nPanels = e.kind === 'door' ? 3 : 2;
      for (let k = 0; k < nPanels; k++) {
        leaf.add(box(leafW * 0.7, leafH / (nPanels + 1.2), 0.03, M.darkWood, sd * leafW / 2, -leafH / 2 + leafH * (k + 0.55) / nPanels, outZ * 0.035));
      }
      const off = t / 2 + 0.035;
      leaf.position.set(e.x + (alongX ? sd * W / 2 : 0) + e.nx * off, e.sill + leafH / 2 + 0.02, e.z + (alongX ? 0 : sd * W / 2) + e.nz * off);
      leaf.rotation.y = alongX ? 0 : -Math.PI / 2;
      leaf.traverse(o => { if (o.isMesh) o.castShadow = true; });
      group.add(leaf);
    }

    // boards nailed across the inside of the opening
    const list = [];
    const span = e.top - e.sill;
    for (let i = 0; i < MAX_BOARDS; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(W + 0.45, 0.2, 0.05), M.plank);
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

  // ceiling: dark beams over terracotta, like the real veranda
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(HOUSE.w, HOUSE.d), M.ceiling);
  ceil.rotation.x = Math.PI / 2; ceil.position.y = wallH - 0.01;
  group.add(ceil);
  for (let x = -HX + 0.8; x < HX; x += 1.4) box(0.14, 0.2, HOUSE.d, M.darkWood, x, wallH - 0.11, 0, group);

  // clay tile gable roof (ridge runs east-west)
  const over = 0.8, rise = HOUSE.roofH - wallH, run = HZ + over;
  const ang = Math.atan2(rise, HZ);
  const slopeLen = run / Math.cos(ang);
  const eaveY = wallH - over * Math.tan(ang);
  for (const s of [-1, 1]) {
    const g = new THREE.PlaneGeometry(HOUSE.w + over * 2, slopeLen);
    g.attributes.uv.array.forEach((v, i, a) => { a[i] = v * (i % 2 === 0 ? (HOUSE.w + over * 2) / 2.2 : slopeLen / 2.2); });
    const plane = new THREE.Mesh(g, M.roof);
    plane.rotation.x = s > 0 ? ang - Math.PI / 2 : Math.PI / 2 - ang;
    plane.position.set(0, (HOUSE.roofH + eaveY) / 2, s * run / 2);
    plane.castShadow = plane.receiveShadow = true;
    group.add(plane);
  }
  box(HOUSE.w + over * 2, 0.22, 0.3, M.roof, 0, HOUSE.roofH + 0.05, 0, group); // ridge cap
  const tri = new THREE.Shape();
  tri.moveTo(-HZ, 0); tri.lineTo(HZ, 0); tri.lineTo(0, rise); tri.lineTo(-HZ, 0);
  for (const s of [-1, 1]) {
    for (const flip of [0, Math.PI]) {
      const g = new THREE.Mesh(new THREE.ShapeGeometry(tri), M.stucco);
      g.position.set(s * HX, wallH, 0);
      g.rotation.y = s * Math.PI / 2 + flip;
      g.castShadow = true;
      group.add(g);
    }
  }

  for (const f of FURNITURE) group.add(furniture(f));

  // ceiling fans with a warm light under each, flickering when the power wavers
  for (const [x, z] of [[-7, -0.5], [4.5, -0.5], [-0.5, 4.2]]) {
    const fan = new THREE.Group();
    fan.position.set(x, wallH - 0.55, z);
    box(0.03, 0.4, 0.03, M.iron, 0, 0.3, 0, fan);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.1, 0.14, 12), M.darkWood);
    fan.add(hub);
    const blades = new THREE.Group(); fan.add(blades);
    for (let i = 0; i < 5; i++) {
      const b = box(0.62, 0.015, 0.14, M.darkWood, 0, 0.0, 0);
      b.position.set(Math.cos(i * 1.2566) * 0.4, 0.02, Math.sin(i * 1.2566) * 0.4);
      b.rotation.y = -i * 1.2566;
      blades.add(b);
    }
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffe0b0 }));
    bulb.position.y = -0.14; fan.add(bulb);
    const light = new THREE.PointLight(0xffb870, 8, 13, 1.6);
    light.position.y = -0.3; fan.add(light);
    group.add(fan);
    const seed = x * 13.1 + z;
    updaters.push((dt, time) => {
      blades.rotation.y += dt * 4.5;
      const f = Math.sin(time * 23 + seed) * Math.sin(time * 7.3 + seed * 2) > 0.93 ? 0.15 : 1;
      light.intensity = 8 * f * (0.93 + Math.sin(time * 3 + seed) * 0.07);
      bulb.material.color.setScalar(f > 0.5 ? 1 : 0.3);
    });
  }

  return { group, boards };
}

function furniture(f) {
  const g = new THREE.Group();
  g.position.set(f.x, 0, f.z);
  const wood = M.darkWood;
  switch (f.kind) {
    case 'couch': { // colonial wooden settee with patterned cushions
      const cush = std({ color: 0x3a5a52, roughness: 1 });
      box(f.w, 0.08, f.d, wood, 0, 0.42, 0, g);
      box(f.w - 0.1, 0.12, f.d - 0.15, cush, 0, 0.52, 0.05, g);
      box(f.w, 0.55, 0.08, wood, 0, 0.8, -f.d / 2 + 0.05, g);
      for (const sx of [-1, 1]) { box(0.08, 0.35, f.d, wood, sx * (f.w / 2 - 0.04), 0.62, 0, g); for (const sz of [-1, 1]) box(0.07, 0.42, 0.07, wood, sx * (f.w / 2 - 0.06), 0.21, sz * (f.d / 2 - 0.06), g); }
      break;
    }
    case 'table': { // heavy dining table + leather chairs (one knocked over)
      box(f.w, 0.08, f.d, wood, 0, f.h, 0, g);
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(0.1, f.h, 0.1, wood, sx * (f.w / 2 - 0.1), f.h / 2, sz * (f.d / 2 - 0.1), g);
      const leather = std({ color: 0x8a3a22, roughness: 0.7 });
      for (const [cx, cz, ry, over] of [[-0.6, -0.95, 0, 0], [0.6, -0.95, 0, 0], [-0.6, 0.95, Math.PI, 0], [0.7, 1.4, 0.4, 1]]) {
        const ch = new THREE.Group(); ch.position.set(cx, 0, cz); ch.rotation.y = ry;
        box(0.45, 0.06, 0.45, leather, 0, 0.47, 0, ch);
        box(0.45, 0.55, 0.05, wood, 0, 0.77, -0.2, ch);
        for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(0.05, 0.47, 0.05, wood, lx * 0.19, 0.235, lz * 0.19, ch);
        if (over) { ch.rotation.x = -1.4; ch.position.y = 0.25; }
        g.add(ch);
      }
      break;
    }
    case 'island': case 'counter': case 'stove': {
      box(f.w, f.h - 0.05, f.d, f.kind === 'stove' ? std({ color: 0xd8d4c8 }) : wood, 0, (f.h - 0.05) / 2, 0, g);
      box(f.w + 0.05, 0.05, f.d + 0.05, f.kind === 'stove' ? std({ color: 0x222222, roughness: 0.4 }) : std({ map: T.tileBorder(), roughness: 0.3 }), 0, f.h - 0.02, 0, g);
      break;
    }
    case 'fridge':
      box(f.w, f.h, f.d, std({ color: 0xd8d4c8, roughness: 0.35, metalness: 0.2 }), 0, f.h / 2, 0, g);
      break;
    case 'bookshelf': { // glass-front cabinet
      box(f.w, f.h, f.d, wood, 0, f.h / 2, 0, g);
      box(0.02, f.h - 0.3, f.d - 0.2, new THREE.MeshStandardMaterial({ color: 0x223338, roughness: 0.05, metalness: 0.7 }), f.w / 2 + 0.01, f.h / 2 + 0.05, 0, g);
      break;
    }
    case 'crate': { // wrought-iron side table with a tile top
      box(f.w, 0.06, f.d, std({ map: T.tileBorder() }), 0, f.h, 0, g);
      for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(0.04, f.h, 0.04, M.iron, lx * (f.w / 2 - 0.08), f.h / 2, lz * (f.d / 2 - 0.08), g);
      box(f.w - 0.1, 0.03, f.d - 0.1, M.iron, 0, 0.2, 0, g);
      break;
    }
  }
  g.traverse(o => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
  return g;
}

function buildVeranda() {
  const g = new THREE.Group();
  const HZ = HOUSE.d / 2, HX = HOUSE.w / 2;
  const v = STRUCTURES.find(s => s.kind === 'veranda');
  const deck = worldBox(v.w, v.h, v.d, M.terracotta, 1.2);
  deck.position.set(v.x, v.h / 2, v.z);
  g.add(deck);
  // steps down to the garden path
  box(2.8, 0.12, 0.5, M.terracotta, 0, 0.06, VERANDA.z + 0.45, g);

  // columns: white, square, with a simple capital and bracket
  const colH = 3.05;
  for (const c of VERANDA.columns) {
    const col = worldBox(0.4, colH, 0.4, M.stucco, 2.4);
    col.position.set(c.x, colH / 2, c.z);
    g.add(col);
    box(0.55, 0.15, 0.55, M.stucco, c.x, colH - 0.08, c.z, g);
    box(0.55, 0.12, 0.55, M.stucco, c.x, 0.3, c.z, g);
  }
  // iron railing: top rail, bottom rail, turned balusters (instanced)
  const balusterGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.82, 6);
  const positions = [];
  for (const r of VERANDA.rails) {
    box(r.w, 0.06, 0.08, M.iron, r.x, r.h, r.z, g);
    box(r.w, 0.04, 0.05, M.iron, r.x, 0.32, r.z, g);
    for (let x = r.x - r.w / 2 + 0.15; x < r.x + r.w / 2; x += 0.16) positions.push([x, r.z]);
  }
  const bal = new THREE.InstancedMesh(balusterGeo, M.iron, positions.length);
  const m4 = new THREE.Matrix4();
  positions.forEach(([x, z], i) => bal.setMatrixAt(i, m4.makeTranslation(x, 0.62, z)));
  bal.castShadow = true;
  g.add(bal);
  // a twisted knob halfway up each baluster
  const knobs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.045, 8, 6), M.iron, positions.length);
  positions.forEach(([x, z], i) => knobs.setMatrixAt(i, m4.makeTranslation(x, 0.62, z)));
  g.add(knobs);

  // veranda roof: clay tiles outside, beamed terracotta underneath
  const depth = VERANDA.z - HZ + 0.6, drop = 0.3, roofTop = HOUSE.wallH + 0.25;
  const slope = Math.atan2(drop, depth);
  const len = Math.hypot(depth, drop);
  for (const [mat, yOff, flip] of [[M.roof, 0.04, 1], [M.ceiling, -0.02, -1]]) {
    const pg = new THREE.PlaneGeometry(HOUSE.w + 1.2, len);
    if (mat === M.roof) pg.attributes.uv.array.forEach((val, i, a) => { a[i] = val * (i % 2 === 0 ? (HOUSE.w + 1.2) / 2.2 : len / 2.2); });
    const p = new THREE.Mesh(pg, mat);
    p.rotation.x = flip > 0 ? -Math.PI / 2 + slope : Math.PI / 2 + slope;
    p.position.set(0, roofTop - drop / 2 + yOff, HZ + depth / 2);
    p.castShadow = flip > 0; p.receiveShadow = true;
    g.add(p);
  }
  for (let x = -HX; x <= HX; x += 1.1) { // exposed rafters
    const r = box(0.1, 0.14, len, M.darkWood, x, roofTop - 0.1 - drop / 2, HZ + depth / 2, g);
    r.rotation.x = slope;
  }
  box(HOUSE.w + 0.4, 0.3, 0.3, M.darkWood, 0, colH + 0.13, VERANDA.z, g); // beam over the columns

  // rocking chairs and potted plants on the veranda
  for (const [x, z, ry] of [[-8.5, 8.6, 0.3], [-5, 8.4, -0.2], [8.8, 8.6, -0.4]]) g.add(rockingChair(x, z, ry));
  for (const [x, z] of [[-2.2, 11], [2.2, 11], [-10.6, 10.6], [10.6, 10.6]]) g.add(pottedPlant(x, z));
  return g;
}

function rockingChair(x, z, ry) {
  const g = new THREE.Group();
  g.position.set(x, 0.25, z); g.rotation.y = ry;
  const cane = std({ color: 0xc8b088, roughness: 0.9 });
  box(0.55, 0.05, 0.55, cane, 0, 0.42, 0, g);
  const back = box(0.55, 0.7, 0.05, cane, 0, 0.8, -0.27, g); back.rotation.x = -0.25;
  for (const sx of [-1, 1]) {
    const rocker = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.025, 4, 16, 0.8), M.darkWood);
    rocker.rotation.set(0, Math.PI / 2, Math.PI / 2 + 0.4 + Math.PI);
    rocker.position.set(sx * 0.26, 0.9, 0.05);
    g.add(rocker);
    box(0.04, 0.5, 0.04, M.darkWood, sx * 0.26, 0.2, 0.2, g);
    box(0.04, 0.9, 0.04, M.darkWood, sx * 0.26, 0.45, -0.25, g);
    box(0.05, 0.04, 0.55, M.darkWood, sx * 0.27, 0.62, 0, g);
  }
  return g;
}

function pottedPlant(x, z) {
  const g = new THREE.Group();
  g.position.set(x, 0.25, z);
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.2, 0.45, 12), M.terracotta);
  pot.position.y = 0.22; pot.castShadow = true; g.add(pot);
  for (let i = 0; i < 7; i++) {
    const leaf = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 0.8), new THREE.MeshStandardMaterial({ color: 0x3d6a2a, side: THREE.DoubleSide, roughness: 0.8 }));
    leaf.position.set(Math.cos(i) * 0.12, 0.75, Math.sin(i) * 0.12);
    leaf.rotation.set(Math.cos(i * 2) * 0.5, i, Math.sin(i * 2) * 0.5);
    leaf.castShadow = true;
    g.add(leaf);
  }
  return g;
}

// ---------- Outbuildings ----------
function whiteBuilding(s, roofRise, doors = 2) {
  const g = new THREE.Group();
  g.position.set(s.x, 0, s.z);
  const wallH = s.h - roofRise;
  const walls = worldBox(s.w, wallH, s.d, M.stucco, 2.4); walls.position.y = wallH / 2; g.add(walls);
  // hip-ish roof: a prism along the long side
  const along = s.d >= s.w;
  const L = (along ? s.d : s.w) + 1.2, W = (along ? s.w : s.d) + 1.2;
  const ang = Math.atan2(roofRise, W / 2), slopeLen = (W / 2) / Math.cos(ang);
  for (const sd of [-1, 1]) {
    const pg = new THREE.PlaneGeometry(L, slopeLen);
    pg.attributes.uv.array.forEach((v, i, a) => { a[i] = v * (i % 2 === 0 ? L / 2.2 : slopeLen / 2.2); });
    const p = new THREE.Mesh(pg, M.roof);
    p.rotation.set(sd > 0 ? ang - Math.PI / 2 : Math.PI / 2 - ang, 0, 0);
    p.position.set(0, wallH + roofRise / 2, sd * W / 4);
    const holder = new THREE.Group(); holder.add(p);
    if (along) holder.rotation.y = Math.PI / 2;
    p.castShadow = true;
    g.add(holder);
  }
  // gable infill
  const tri = new THREE.Shape(); tri.moveTo(-W / 2 + 0.6, 0); tri.lineTo(W / 2 - 0.6, 0); tri.lineTo(0, roofRise * (W / 2 - 0.6) / (W / 2)); tri.lineTo(-W / 2 + 0.6, 0);
  for (const sd of [-1, 1]) for (const flip of [0, Math.PI]) {
    const m = new THREE.Mesh(new THREE.ShapeGeometry(tri), M.stucco);
    m.position.set(along ? 0 : sd * s.w / 2, wallH, along ? sd * s.d / 2 : 0);
    m.rotation.y = (along ? 0 : Math.PI / 2) + flip;
    g.add(m);
  }
  // dark wood doors + shuttered windows on the long sides
  const long = along ? s.d : s.w;
  for (let i = 0; i < doors + 2; i++) {
    const p = -long / 2 + (long * (i + 0.5)) / (doors + 2);
    const isDoor = i % 2 === 1;
    for (const sd of [-1, 1]) {
      const h = isDoor ? 2.3 : 1.2, y = isDoor ? 1.15 : 1.6;
      const px = along ? sd * (s.w / 2 + 0.02) : p, pz = along ? p : sd * (s.d / 2 + 0.02);
      box(along ? 0.05 : 1.2, h, along ? 1.2 : 0.05, M.darkWood, px, y, pz, g);
    }
  }
  return g;
}

function buildStructure(s, updaters) {
  let g;
  switch (s.kind) {
    case 'veranda': return null; // built with the house
    case 'bunkhouse': g = whiteBuilding(s, 2.4, 2); break;
    case 'feedstore': g = whiteBuilding(s, 1.4, 1); break;
    case 'fountain': {
      g = new THREE.Group(); g.position.set(s.x, 0, s.z);
      const rim = worldBox(s.w, s.h, s.d, M.stucco, 1.5); rim.position.y = s.h / 2; g.add(rim);
      const water = flat(s.w - 0.4, s.d - 0.4, M.water, 0, s.h - 0.12, 0);
      g.add(water);
      const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.3, 1.3, 12), M.stucco); ped.position.y = 1.0; g.add(ped);
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.25, 0.25, 16), M.stucco); bowl.position.y = 1.6; g.add(bowl);
      // a thin animated trickle
      const drop = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.06, 0.7, 8, 1, true), new THREE.MeshStandardMaterial({ color: 0xbfe0e8, transparent: true, opacity: 0.45, roughness: 0.1 }));
      drop.position.y = 1.35; g.add(drop);
      updaters.push((dt, t) => { drop.scale.x = drop.scale.z = 1 + Math.sin(t * 20) * 0.15; });
      break;
    }
    case 'tank': {
      g = new THREE.Group(); g.position.set(s.x, 0, s.z);
      const m = std({ map: T.metal(), color: 0x9aa4a8, roughness: 0.4, metalness: 0.6 });
      const c = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.3, 3, 24), m); c.position.y = 4.4; g.add(c);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(2.4, 0.9, 24), m); cone.position.y = 6.3; g.add(cone);
      for (const [lx, lz] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) box(0.15, 2.9, 0.15, M.bluePipe, lx, 1.45, lz, g);
      break;
    }
    case 'truck': {
      g = new THREE.Group(); g.position.set(s.x, 0, s.z);
      const paint = std({ color: 0xe8e6e0, roughness: 0.35, metalness: 0.4 });
      const dark = std({ color: 0x1a1c1e, roughness: 0.6 });
      box(2.2, 0.8, 5.2, paint, 0, 0.95, 0, g);
      box(2.1, 0.95, 2.1, paint, 0, 1.8, -0.5, g);
      box(2.12, 0.55, 1.6, new THREE.MeshStandardMaterial({ color: 0x111820, roughness: 0.1, metalness: 0.8 }), 0, 1.9, -0.5, g);
      box(2.25, 0.25, 0.2, dark, 0, 0.7, -2.65, g);
      for (const [wx, wz] of [[-1.05, -1.6], [1.05, -1.6], [-1.05, 1.7], [1.05, 1.7]]) {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.3, 16), dark);
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
      const logMat = std({ map: T.bark() });
      for (let row = 0; row < 3; row++) for (let i = 0; i < 6 - row; i++) {
        const l = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, s.d, 8), logMat);
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
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, b.w, 20), std({ map: T.hay(), roughness: 1 }));
  m.rotation.z = Math.PI / 2;
  m.position.set(b.x, 0.8, b.z);
  m.castShadow = m.receiveShadow = true;
  return m;
}

// Low white garden wall with a rounded cap (traced from the yard wall in the photos).
function buildGardenWall() {
  const group = new THREE.Group();
  const capMat = std({ color: 0xf4f0e8, roughness: 0.9 });
  for (const s of FENCE_SEGMENTS) {
    const alongX = s.x1 !== undefined;
    const a = alongX ? s.x1 : s.z1, b = alongX ? s.x2 : s.z2, len = b - a, mid = (a + b) / 2;
    const w = worldBox(alongX ? len : 0.3, FENCE_HEIGHT - 0.1, alongX ? 0.3 : len, M.stucco, 2.4);
    w.position.set(alongX ? mid : s.x, (FENCE_HEIGHT - 0.1) / 2, alongX ? s.z : mid);
    group.add(w);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, len, 8, 1), capMat);
    cap.rotation.set(alongX ? 0 : Math.PI / 2, 0, alongX ? Math.PI / 2 : 0);
    cap.position.set(alongX ? mid : s.x, FENCE_HEIGHT - 0.1, alongX ? s.z : mid);
    cap.scale.set(1, 1, 0.6);
    cap.castShadow = true;
    group.add(cap);
    // gate pillars at the open ends
    for (const end of [a, b]) {
      const p = box(0.5, FENCE_HEIGHT + 0.5, 0.5, M.stucco, alongX ? end : s.x, (FENCE_HEIGHT + 0.5) / 2, alongX ? s.z : end, group);
      p.castShadow = true;
    }
  }
  return group;
}

// Clipped hedges dotted with red ixora flowers.
function buildHedges() {
  const group = new THREE.Group();
  const blobs = [];
  for (const h of HEDGES) {
    if (h.along === 'x') for (let x = h.x1; x <= h.x2; x += 0.55) blobs.push([x, (h.z1 + h.z2) / 2]);
    else for (let z = h.z1; z <= h.z2; z += 0.55) blobs.push([h.x, z]);
  }
  const geo = new THREE.IcosahedronGeometry(0.45, 1);
  const mesh = new THREE.InstancedMesh(geo, M.hedge, blobs.length);
  const flowers = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.07, 0), M.flower, blobs.length * 6);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3();
  let k = 0;
  blobs.forEach(([x, z], i) => {
    mesh.setMatrixAt(i, m4.compose(v.set(x, 0.4, z), q.identity(), s.set(1, 0.85 + Math.sin(i) * 0.1, 1)));
    for (let j = 0; j < 6; j++) {
      const a = i * 3.7 + j * 1.9, el = 0.3 + (j % 3) * 0.35;
      flowers.setMatrixAt(k++, m4.compose(v.set(x + Math.cos(a) * 0.4 * Math.cos(el), 0.4 + Math.sin(el) * 0.38, z + Math.sin(a) * 0.4 * Math.cos(el)), q, s.setScalar(1)));
    }
  });
  mesh.castShadow = mesh.receiveShadow = true;
  group.add(mesh, flowers);
  return group;
}

// Blue steel-pipe cattle pens on sand with an open red-roof shelter.
function buildPen(p) {
  const g = new THREE.Group();
  g.position.set(p.x, 0, p.z);
  g.add(flat(p.w + 2, p.d + 2, std({ map: T.sand(), roughness: 1 }), 0, 0.015, 0, 3));
  const posts = [];
  const per = (len) => Math.max(1, Math.round(len / 2.5));
  for (const [ax, az, bx, bz] of [[-1, -1, 1, -1], [1, -1, 1, 1], [1, 1, -1, 1], [-1, 1, -1, -1]]) {
    const x0 = ax * p.w / 2, z0 = az * p.d / 2, x1 = bx * p.w / 2, z1 = bz * p.d / 2;
    const n = per(Math.hypot(x1 - x0, z1 - z0));
    for (let i = 0; i < n; i++) posts.push([x0 + (x1 - x0) * i / n, z0 + (z1 - z0) * i / n]);
    for (const y of [0.45, 0.85, 1.25, 1.6]) {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, len, 6), M.bluePipe);
      rail.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
      rail.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(x1 - x0, 0, z1 - z0).normalize());
      g.add(rail);
    }
  }
  for (const [x, z] of posts) { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.8, 8), M.bluePipe); m.position.set(x, 0.9, z); g.add(m); }
  // open shelter
  for (const [x, z] of [[-p.w / 2 + 0.3, -p.d / 2 + 0.3], [p.w / 2 - 0.3, -p.d / 2 + 0.3], [-p.w / 2 + 0.3, -p.d / 2 + 6], [p.w / 2 - 0.3, -p.d / 2 + 6]]) box(0.15, 3.4, 0.15, M.bluePipe, x, 1.7, z, g);
  const r = box(p.w + 1, 0.08, 7, std({ map: T.metal(), color: 0xb04a30, metalness: 0.5, roughness: 0.5 }), 0, 3.45, -p.d / 2 + 3.2, g);
  r.rotation.x = 0.08;
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}

// Palms (curved ringed trunks, drooping fronds) and broad tropical canopy trees.
function buildTrees() {
  const group = new THREE.Group();
  const palms = TREES.filter(t => t.kind === 'palm'), broad = TREES.filter(t => t.kind !== 'palm');
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3(), e = new THREE.Euler();

  // palm trunks: 5 stacked segments leaning progressively
  const segGeo = new THREE.CylinderGeometry(0.17, 0.22, 1, 8).translate(0, 0.5, 0);
  const trunkMat = std({ map: T.palmBark(), roughness: 1 });
  const SEG = 5;
  const trunks = new THREE.InstancedMesh(segGeo, trunkMat, palms.length * SEG);
  const crowns = [];
  let k = 0;
  palms.forEach((t, i) => {
    const h = (8 + (i % 5)) * t.s, segH = h / SEG;
    const lean = 0.06 + (i % 3) * 0.04, dir = i * 2.4;
    const p = new THREE.Vector3(t.x, 0, t.z);
    for (let j = 0; j < SEG; j++) {
      const tilt = lean * (j + 1);
      q.setFromEuler(e.set(Math.cos(dir) * tilt, 0, Math.sin(dir) * tilt));
      trunks.setMatrixAt(k++, m4.compose(p, q, s.set(t.s * (1 - j * 0.08), segH, t.s * (1 - j * 0.08))));
      p.add(new THREE.Vector3(0, segH, 0).applyQuaternion(q));
    }
    crowns.push({ p: p.clone(), s: t.s, seed: i });
  });
  trunks.castShadow = true;
  group.add(trunks);

  // fronds: an arched strip of quads with the frond texture
  const fg = new THREE.PlaneGeometry(1, 0.5, 6, 1);
  const pos = fg.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + 0.5; // 0..1 along the frond
    pos.setXYZ(i, x * 3.6, -x * x * 1.6, pos.getY(i) * 1.1);
  }
  fg.computeVertexNormals();
  const frondMat = new THREE.MeshStandardMaterial({ map: T.frond(), alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.9 });
  const NF = 11;
  const fronds = new THREE.InstancedMesh(fg, frondMat, crowns.length * NF);
  const frondBase = [];
  k = 0;
  crowns.forEach(c => {
    for (let j = 0; j < NF; j++) {
      const yaw = (j / NF) * Math.PI * 2 + c.seed, pitch = -0.25 + (j % 3) * 0.22;
      frondBase.push({ c, yaw, pitch });
      q.setFromEuler(e.set(0, yaw, pitch, 'YXZ'));
      fronds.setMatrixAt(k++, m4.compose(c.p, q, s.setScalar(c.s)));
    }
  });
  fronds.castShadow = true;
  group.add(fronds);

  // broad trees: thick trunk + wide flattened canopy clusters
  const btrunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.35, 0.6, 1, 8), std({ map: T.bark(), color: 0x9a9a90 }), broad.length);
  const canopy = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), M.leaf, broad.length * 5);
  k = 0;
  broad.forEach((t, i) => {
    const h = 5.5 * t.s;
    btrunks.setMatrixAt(i, m4.compose(v.set(t.x, h / 2, t.z), q.identity(), s.set(t.s, h, t.s)));
    for (let j = 0; j < 5; j++) {
      const a = j * 1.3 + i, r = j === 0 ? 0 : 2.6 * t.s;
      q.setFromEuler(e.set(0, a, 0));
      canopy.setMatrixAt(k++, m4.compose(v.set(t.x + Math.cos(a) * r, h + 0.8 * t.s + (j === 0 ? 0.6 : 0), t.z + Math.sin(a) * r), q, s.set(3.2 * t.s, 1.3 * t.s, 3.2 * t.s)));
    }
  });
  btrunks.castShadow = canopy.castShadow = true;
  group.add(btrunks, canopy);

  // gentle wind on the fronds
  let acc = 0;
  const update = (dt, t) => {
    acc += dt;
    if (acc < 1 / 20) return; // 20 Hz is plenty for sway
    acc = 0;
    frondBase.forEach((f, i) => {
      const sway = Math.sin(t * 1.3 + f.c.seed + f.yaw) * 0.06;
      q.setFromEuler(e.set(0, f.yaw + sway * 0.5, f.pitch + sway, 'YXZ'));
      fronds.setMatrixAt(i, m4.compose(f.c.p, q, s.setScalar(f.c.s)));
    });
    fronds.instanceMatrix.needsUpdate = true;
  };
  return { group, update };
}

function buildHills() {
  const geo = new THREE.RingGeometry(140, 420, 96, 6);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), r = Math.hypot(x, y), a = Math.atan2(y, x);
    const h = (Math.sin(a * 5) * 0.5 + Math.sin(a * 13 + 1) * 0.3 + Math.sin(a * 29 + 2) * 0.15 + 0.6) * 22 * Math.min(1, (r - 140) / 80);
    pos.setZ(i, h);
  }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, std({ color: 0x3a4a2a, roughness: 1, flatShading: true }));
  m.rotation.x = -Math.PI / 2;
  return m;
}

// Instanced grass blades that sway in the wind, kept off paths and buildings.
function buildGrass(COUNT) {
  const geo = new THREE.PlaneGeometry(0.08, 0.55, 1, 3);
  geo.translate(0, 0.275, 0);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 0.55;
    pos.setX(i, pos.getX(i) * (1 - y));
  }
  const mat = new THREE.MeshStandardMaterial({ color: 0x6d8a3a, roughness: 1, side: THREE.DoubleSide });
  const uniforms = { uTime: { value: 0 } };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uniforms.uTime;
    sh.vertexShader = 'uniform float uTime;\nvarying float vGrassH;\n' + sh.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      vGrassH = position.y / 0.55;
      vec4 wp = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
      float sway = sin(uTime * 1.7 + wp.x * 0.35 + wp.z * 0.2) * 0.5 + sin(uTime * 3.1 + wp.x * 0.9) * 0.2;
      transformed.x += sway * position.y * position.y * 0.6;
    `);
    sh.fragmentShader = 'varying float vGrassH;\n' + sh.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      diffuseColor.rgb *= mix(0.45, 1.15, vGrassH);
    `);
  };
  const mesh = new THREE.InstancedMesh(geo, mat, COUNT);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3();
  const color = new THREE.Color();
  let seed = 99;
  const r = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  let n = 0, tries = 0;
  while (n < COUNT && tries++ < COUNT * 4) {
    const rad = 9 + Math.pow(r(), 1.5) * 78, a = r() * Math.PI * 2;
    const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
    if (Math.abs(x) > MAP_HALF || Math.abs(z) > MAP_HALF) continue;
    if (Math.abs(x) < HOUSE.w / 2 + 0.6 && z > -HOUSE.d / 2 - 0.6 && z < VERANDA.z + 0.8) continue; // house + veranda
    if (Math.abs(x) < 1.6 && z > 9 && z < 22.5) continue; // brick path / fountain
    if (Math.abs(x) < 3.2 && Math.abs(z - 19) < 3.2) continue;
    if (PENS.some(p => Math.abs(x - p.x) < p.w / 2 + 1 && Math.abs(z - p.z) < p.d / 2 + 1)) continue;
    if (SOLIDS.some(b => b.h > 0.3 && Math.abs(x - b.x) < b.w / 2 + 0.2 && Math.abs(z - b.z) < b.d / 2 + 0.2)) continue;
    q.setFromAxisAngle(v.set(0, 1, 0), r() * Math.PI);
    const h = 0.7 + r() * 1.0;
    mesh.setMatrixAt(n, m4.compose(v.set(x, 0, z), q, s.set(1, h, 1)));
    mesh.setColorAt(n, color.setHSL(0.2 + r() * 0.07, 0.4 + r() * 0.2, 0.26 + r() * 0.14));
    n++;
  }
  mesh.count = n;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return { mesh, update: (dt, t) => { uniforms.uTime.value = t; } };
}

function buildDust() {
  const N = 400;
  const g = new THREE.BufferGeometry();
  const p = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { p[i * 3] = (Math.random() - 0.5) * 40; p[i * 3 + 1] = Math.random() * 6; p[i * 3 + 2] = (Math.random() - 0.5) * 40; }
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const points = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffd8a0, size: 0.05, transparent: true, opacity: 0.5, depthWrite: false }));
  points.frustumCulled = false;
  return {
    points,
    update(dt, t, cam) {
      if (!cam) return;
      const a = g.attributes.position;
      for (let i = 0; i < N; i++) {
        let x = a.getX(i) + Math.sin(t * 0.3 + i) * dt * 0.15, y = a.getY(i) + dt * 0.04, z = a.getZ(i) + dt * 0.25;
        if (y > 6) y = 0;
        if (x - cam.x > 20) x -= 40; if (x - cam.x < -20) x += 40;
        if (z - cam.z > 20) z -= 40; if (z - cam.z < -20) z += 40;
        a.setXYZ(i, x, y, z);
      }
      a.needsUpdate = true;
    },
  };
}
