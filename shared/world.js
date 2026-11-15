// Shared map layout. Used by the server (cow pathing, bullet blocking) and the
// client (rendering + player collision), so both always agree on where things are.
//
// Coordinates: metres. X = east, Z = south, Y = up. The ranch house is centred on 0,0.
// Every solid thing is an axis-aligned box: { x, z } centre, w (x size), d (z size), h (height).
// When the real ranch scan arrives, this file is what gets re-traced to match it.
//
// The game: players are holed up inside the ranch house. Zombie cows come across the
// property, tear the boards off the doors and windows, climb in and go for the players.
// Players hold E at a window to nail boards back up.

export const MAP_HALF = 90;        // playable area is -90..90 on X and Z
export const SPAWN_EDGE = 64;      // cows stagger out of the tree line around the yard
export const MAX_BOARDS = 6;

// ---- The house -------------------------------------------------------------

export const HOUSE = { x: 0, z: 0, w: 22, d: 14, wallH: 3.4, t: 0.3, roofH: 7.6 };
const HX = HOUSE.w / 2, HZ = HOUSE.d / 2;

// Doors and windows. `at` is the position along the wall (x for N/S walls, z for E/W).
const ENTRY_DEFS = [
  { kind: 'door', wall: 'S', at: 0 },
  { kind: 'window', wall: 'S', at: -7 },
  { kind: 'window', wall: 'S', at: 7 },
  { kind: 'door', wall: 'N', at: 6 },
  { kind: 'window', wall: 'N', at: -6 },
  { kind: 'window', wall: 'W', at: -3 },
  { kind: 'window', wall: 'W', at: 3.5 },
  { kind: 'window', wall: 'E', at: -3 },
  { kind: 'window', wall: 'E', at: 3 },
];

export const ENTRIES = ENTRY_DEFS.map((e, id) => {
  const width = e.kind === 'door' ? 1.5 : 1.7;
  const n = { N: [0, -1], S: [0, 1], W: [-1, 0], E: [1, 0] }[e.wall]; // outward normal
  const along = e.wall === 'N' || e.wall === 'S';
  const x = along ? e.at : n[0] * HX;
  const z = along ? n[1] * HZ : e.at;
  return {
    id, ...e, width, x, z, nx: n[0], nz: n[1],
    sill: e.kind === 'door' ? 0 : 0.95,
    top: e.kind === 'door' ? 2.45 : 2.3,
    out: [x + n[0] * 2.1, z + n[1] * 2.1],   // where a cow stands to tear boards
    in: [x - n[0] * 2.1, z - n[1] * 2.1],    // where a cow lands after climbing in
    // solid box filling the opening (blocks walking, not bullets)
    box: along
      ? { x, z, w: width, d: HOUSE.t, h: HOUSE.wallH }
      : { x, z, w: HOUSE.t, d: width, h: HOUSE.wallH },
  };
});

// Exterior wall pieces between the openings, plus interior partitions.
export const HOUSE_WALLS = (() => {
  const walls = [];
  const t = HOUSE.t, h = HOUSE.wallH;
  for (const wall of ['N', 'S', 'W', 'E']) {
    const along = wall === 'N' || wall === 'S';
    const len = along ? HOUSE.w + t : HOUSE.d + t;
    const openings = ENTRIES.filter(e => e.wall === wall).map(e => [e.at - e.width / 2, e.at + e.width / 2]).sort((a, b) => a[0] - b[0]);
    let cur = -len / 2;
    const pieces = [];
    for (const [a, b] of openings) { if (a > cur) pieces.push([cur, a]); cur = b; }
    if (cur < len / 2) pieces.push([cur, len / 2]);
    for (const [a, b] of pieces) {
      const mid = (a + b) / 2, size = b - a;
      if (wall === 'N') walls.push({ kind: 'wall', x: mid, z: -HZ, w: size, d: t, h });
      if (wall === 'S') walls.push({ kind: 'wall', x: mid, z: HZ, w: size, d: t, h });
      if (wall === 'W') walls.push({ kind: 'wall', x: -HX, z: mid, w: t, d: size, h });
      if (wall === 'E') walls.push({ kind: 'wall', x: HX, z: mid, w: t, d: size, h });
    }
  }
  // interior partition between living room (west) and kitchen (east), with a wide doorway
  walls.push({ kind: 'iwall', x: -3, z: (-HZ + -2.1) / 2, w: 0.2, d: HZ - 2.1, h });
  walls.push({ kind: 'iwall', x: -3, z: (HZ + 2.1) / 2, w: 0.2, d: HZ - 2.1, h });
  return walls;
})();

// Furniture: low cover inside. Low pieces can be jumped onto.
export const FURNITURE = [
  { kind: 'couch', x: -7.5, z: 1.4, w: 3.2, d: 1.1, h: 0.85 },
  { kind: 'table', x: -7.2, z: -1.6, w: 2.2, d: 1.2, h: 0.78 },
  { kind: 'island', x: 4.5, z: -0.5, w: 3.2, d: 1.2, h: 0.95 },
  { kind: 'counter', x: 0.6, z: -6.2, w: 3, d: 0.75, h: 0.95 },
  { kind: 'stove', x: 2.6, z: -6.2, w: 1.0, d: 0.75, h: 0.95 },
  { kind: 'fridge', x: 10.1, z: -5.9, w: 1.1, d: 0.9, h: 2.0 },
  { kind: 'bookshelf', x: -10.4, z: 0.2, w: 0.5, d: 2.2, h: 2.1 },
  { kind: 'crate', x: -9.8, z: 5.8, w: 1.2, d: 1.2, h: 1.0 },
  { kind: 'crate', x: 9.8, z: 5.9, w: 1.0, d: 1.0, h: 0.8 },
];

// ---- The rest of the property (seen through the windows) --------------------

const FENCE = { minX: -48, maxX: 52, minZ: -44, maxZ: 42, h: 1.35, t: 0.35, gate: 10 };

function fenceSegments() {
  const segs = [];
  const { minX, maxX, minZ, maxZ, gate } = FENCE;
  const midX = (minX + maxX) / 2, midZ = (minZ + maxZ) / 2;
  for (const z of [minZ, maxZ]) {
    segs.push({ x1: minX, x2: midX - gate / 2, z });
    segs.push({ x1: midX + gate / 2, x2: maxX, z });
  }
  for (const x of [minX, maxX]) {
    segs.push({ z1: minZ, z2: midZ - gate / 2, x });
    segs.push({ z1: midZ + gate / 2, z2: maxZ, x });
  }
  return segs;
}
export const FENCE_SEGMENTS = fenceSegments();
export const FENCE_HEIGHT = FENCE.h;

export const STRUCTURES = [
  // long front veranda (terracotta floor, white columns, iron railing) like the real house
  { id: 'veranda', kind: 'veranda', x: 0, z: HZ + 2.25, w: HOUSE.w + 0.6, d: 4.5, h: 0.25 },
  { id: 'fountain', kind: 'fountain', x: 0, z: 19, w: 3.4, d: 3.4, h: 0.9 },
  { id: 'bunkhouse', kind: 'bunkhouse', x: 31, z: -14, w: 10, d: 20, h: 6.5 },
  { id: 'feedstore', kind: 'feedstore', x: -30, z: 22, w: 8, d: 6, h: 4.5 },
  { id: 'tank', kind: 'tank', x: -12, z: -30, w: 5, d: 5, h: 6 },
  { id: 'truck', kind: 'truck', x: 16, z: 22, w: 2.3, d: 5.4, h: 1.9 },
  { id: 'trough', kind: 'trough', x: 40, z: 18, w: 1.4, d: 5, h: 0.8 },
  { id: 'woodpile', kind: 'woodpile', x: -22, z: -12, w: 4, d: 1.6, h: 1.4 },
];

// Veranda railing (wrought iron balusters) with a gap at the front steps, plus columns.
export const VERANDA = (() => {
  const z = HZ + 4.5, h = 1.0, gap = 2.6;
  const rails = [
    { kind: 'railing', x: (-HX - gap) / 2, z, w: HX - gap, d: 0.2, h },
    { kind: 'railing', x: (HX + gap) / 2, z, w: HX - gap, d: 0.2, h },
  ];
  const columns = [-HX, -6.5, -gap, gap, 6.5, HX].map(x => ({ kind: 'column', x, z, w: 0.45, d: 0.45, h: HOUSE.wallH }));
  return { z, rails, columns };
})();

// Decoration only (no collision): flowering hedges and the blue pipe cattle pens.
export const HEDGES = [
  { x: -2.4, z1: 12.5, z2: 17 }, { x: 2.4, z1: 12.5, z2: 17 },
  { x: -9, z1: 12.5, z2: 13.2, along: 'x', x1: -11, x2: -3.5 }, { x: 9, z1: 12.5, z2: 13.2, along: 'x', x1: 3.5, x2: 11 },
];
export const PENS = [{ x: 72, z: -6, w: 14, d: 22 }, { x: -74, z: -20, w: 12, d: 16 }];

export const HAY_BALES = [
  [18, 12], [20.2, 12], [19.1, 13.8], [-18, 18], [-16, 20.2], [32, 24], [34.2, 24], [12, -26],
].map(([x, z], i) => ({ id: 'hay' + i, kind: 'hay', x, z, w: 1.9, d: 1.7, h: 1.6 }));

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
export const TREES = (() => {
  const r = rng(1337);
  const out = [];
  let tries = 0;
  while (out.length < 90 && tries++ < 4000) {
    const x = (r() * 2 - 1) * (MAP_HALF - 4);
    const z = (r() * 2 - 1) * (MAP_HALF - 4);
    if (x > FENCE.minX - 8 && x < FENCE.maxX + 8 && z > FENCE.minZ - 8 && z < FENCE.maxZ + 8) continue;
    if (Math.abs(z - (FENCE.minZ + FENCE.maxZ) / 2) < 10 || Math.abs(x - (FENCE.minX + FENCE.maxX) / 2) < 10) continue;
    if (out.some(t => (t.x - x) ** 2 + (t.z - z) ** 2 < 36)) continue;
    out.push({ x, z, s: 0.8 + r() * 0.7, kind: r() < 0.55 ? 'palm' : 'ceiba' });
  }
  // palms in the front garden
  for (const [x, z, sc] of [[-7, 17, 1.2], [7.5, 15.5, 1.1], [-14, 10, 1.3], [13, 9, 1.15], [-4, 24, 1.0]]) out.push({ x, z, s: sc, kind: 'palm' });
  return out;
})();

// All solid boxes. `shoot: true` means bullets pass through (open doors/windows).
export const SOLIDS = (() => {
  const out = [...HOUSE_WALLS, ...FURNITURE, ...STRUCTURES, ...HAY_BALES];
  for (const e of ENTRIES) out.push({ kind: 'entry', entry: e.id, shoot: true, ...e.box });
  for (const s of FENCE_SEGMENTS) {
    if (s.x1 !== undefined) out.push({ kind: 'fence', x: (s.x1 + s.x2) / 2, z: s.z, w: s.x2 - s.x1, d: FENCE.t, h: FENCE.h });
    else out.push({ kind: 'fence', x: s.x, z: (s.z1 + s.z2) / 2, w: FENCE.t, d: s.z2 - s.z1, h: FENCE.h });
  }
  for (const t of TREES) out.push({ kind: 'trunk', x: t.x, z: t.z, w: (t.kind === 'palm' ? 0.6 : 1.1) * t.s, d: (t.kind === 'palm' ? 0.6 : 1.1) * t.s, h: 30 });
  out.push(...VERANDA.rails, ...VERANDA.columns);
  return out;
})();

// Players start inside the living room / kitchen.
export const PLAYER_SPAWNS = [[-6, 4.5], [0, 3.5], [-1, 0], [6, 2.5], [-8, -1], [2, 4.5], [8, 1], [-5, -5]];

export function insideHouse(x, z) {
  return Math.abs(x - HOUSE.x) < HX && Math.abs(z - HOUSE.z) < HZ;
}

// ---- Shared maths helpers -------------------------------------------------

// Push a circle (x,z,r) out of every solid taller than `feetY + step`.
export function resolveCircle(x, z, r, feetY = 0, step = 0.4) {
  for (let iter = 0; iter < 3; iter++) {
    let moved = false;
    for (const b of SOLIDS) {
      if (b.h <= feetY + step) continue;
      const hx = b.w / 2, hz = b.d / 2;
      if (Math.abs(x - b.x) > hx + r || Math.abs(z - b.z) > hz + r) continue;
      const cx = Math.max(b.x - hx, Math.min(x, b.x + hx));
      const cz = Math.max(b.z - hz, Math.min(z, b.z + hz));
      const dx = x - cx, dz = z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        x = cx + (dx / d) * r;
        z = cz + (dz / d) * r;
      } else {
        const px = hx + r - Math.abs(x - b.x), pz = hz + r - Math.abs(z - b.z);
        if (px < pz) x += Math.sign(x - b.x || 1) * px; else z += Math.sign(z - b.z || 1) * pz;
      }
      moved = true;
    }
    if (!moved) break;
  }
  const lim = MAP_HALF - r;
  return [Math.max(-lim, Math.min(lim, x)), Math.max(-lim, Math.min(lim, z))];
}

// Height of the highest walkable surface under a circle (standing on furniture/bales/truck).
export function groundHeight(x, z, r, feetY, step = 0.4) {
  let g = 0;
  for (const b of SOLIDS) {
    if (b.h > feetY + step || b.h <= g) continue;
    if (Math.abs(x - b.x) < b.w / 2 + r * 0.5 && Math.abs(z - b.z) < b.d / 2 + r * 0.5) g = b.h;
  }
  return g;
}

// Ray vs everything bullets can't pass through. Returns distance to the first hit.
export function raySolids(o, d, maxDist = 300) {
  let best = maxDist;
  for (const b of SOLIDS) {
    if (b.shoot) continue;
    const t = rayBox(o, d, b.x - b.w / 2, 0, b.z - b.d / 2, b.x + b.w / 2, b.h, b.z + b.d / 2);
    if (t >= 0 && t < best) best = t;
  }
  // window sills and lintels
  for (const e of ENTRIES) {
    const hw = e.width / 2, ht = HOUSE.t / 2;
    const [wx, wz] = e.nx === 0 ? [hw, ht] : [ht, hw];
    if (e.sill > 0) {
      const t = rayBox(o, d, e.x - wx, 0, e.z - wz, e.x + wx, e.sill, e.z + wz);
      if (t >= 0 && t < best) best = t;
    }
    const t = rayBox(o, d, e.x - wx, e.top, e.z - wz, e.x + wx, HOUSE.wallH, e.z + wz);
    if (t >= 0 && t < best) best = t;
  }
  // ceiling of the house (only matters when shooting upward from inside)
  if (d[1] > 0 && insideHouse(o[0], o[2])) {
    const t = (HOUSE.wallH - o[1]) / d[1];
    if (t >= 0 && t < best) best = t;
  }
  if (d[1] < 0) {
    const t = -o[1] / d[1];
    if (t >= 0 && t < best) best = t;
  }
  return best;
}

export function rayBox(o, d, x0, y0, z0, x1, y1, z1) {
  let tmin = -Infinity, tmax = Infinity;
  const lo = [x0, y0, z0], hi = [x1, y1, z1];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < lo[i] || o[i] > hi[i]) return -1;
    } else {
      let t1 = (lo[i] - o[i]) / d[i], t2 = (hi[i] - o[i]) / d[i];
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return -1;
    }
  }
  if (tmax < 0) return -1;
  return tmin >= 0 ? tmin : 0;
}

export function raySphere(o, d, cx, cy, cz, r) {
  const ox = o[0] - cx, oy = o[1] - cy, oz = o[2] - cz;
  const b = ox * d[0] + oy * d[1] + oz * d[2];
  const c = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : (c < 0 ? 0 : -1);
}

// ---- Cows (shared so hitboxes match on both sides) -------------------------

export const COW_TYPES = {
  walker: { hp: 100, speed: 3.0, scale: 1.0, radius: 0.8, damage: 14, reach: 2.2, score: 60, tear: 1.5 },
  runner: { hp: 60, speed: 6.0, scale: 0.85, radius: 0.7, damage: 9, reach: 2.0, score: 80, tear: 1.0 },
  bull: { hp: 900, speed: 3.4, scale: 1.55, radius: 1.2, damage: 38, reach: 3.0, score: 500, tear: 0.35 },
};
export const COW_TYPE_LIST = ['walker', 'runner', 'bull'];

// Hit spheres for a cow at (x,z) facing yaw. Index 0 is the head.
// `rear` lifts the front end (used while climbing through a window).
export function cowHitSpheres(type, x, z, yaw, y = 0) {
  const s = COW_TYPES[type].scale;
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  return [
    { x: x + fx * 1.25 * s, y: y + 1.35 * s, z: z + fz * 1.25 * s, r: 0.42 * s, head: true },
    { x: x + fx * 0.55 * s, y: y + 1.05 * s, z: z + fz * 0.55 * s, r: 0.62 * s },
    { x: x - fx * 0.35 * s, y: y + 1.05 * s, z: z - fz * 0.35 * s, r: 0.64 * s },
    { x: x - fx * 0.95 * s, y: y + 1.0 * s, z: z - fz * 0.95 * s, r: 0.55 * s },
    { x, y: y + 0.45 * s, z, r: 0.5 * s },
  ];
}

export const WEAPON = { damage: 30, headMult: 3.5, fireInterval: 0.095, mag: 30, reload: 2.1, range: 250 };
export const REPAIR_TIME = 0.7;
export const REPAIR_RANGE = 2.4;
