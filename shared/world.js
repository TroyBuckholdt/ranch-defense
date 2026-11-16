// Shared map layout. Used by the server (cow pathing, bullet blocking) and the
// client (rendering + player collision), so both always agree on where things are.
//
// Coordinates: metres. X = east, Z = south, Y = up. The ranch house is centred on 0,0.
// Every solid thing is an axis-aligned box: { x, z } centre, w (x size), d (z size), h (height).
// When the real ranch scan arrives, this file is what gets re-traced to match it.
//
// The game: the hacienda is your base. Zombie Brahmans roam the pasture and jungle and
// hunt the players wherever they are. If everyone is inside, they tear the boards off
// the doors and windows and climb in. Players can walk out through the doors (cows
// can't until the boards are gone), down the jungle trails to the beach.

export const MAP_HALF = 200;       // playable area is -200..200 on X and Z (south ends at the sea)
export const MAX_BOARDS = 6;

// ---- Terrain ---------------------------------------------------------------
// Flat yard around the house, rolling jungle hills, then dunes down to the beach.
function hash2(ix, iz) {
  let h = (ix * 374761393 + iz * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const smooth = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

// z of the waterline for a given x (wavy coast)
export function shoreZ(x) { return 168 + Math.sin(x / 40) * 8 + Math.sin(x / 13 + 1) * 2; }
export const SAND_WIDTH = 24;

export function heightAt(x, z) {
  const hills = vnoise(x / 55, z / 55) * 6 + vnoise(x / 17 + 9, z / 17) * 1.4;
  const yard = smooth(68, 100, Math.hypot(x, z * 1.1));
  let h = hills * yard;
  const sz = shoreZ(x);
  const beachH = (sz - z) * 0.07;                  // gentle slope into the sea
  const t = smooth(sz - SAND_WIDTH - 22, sz - SAND_WIDTH + 2, z);
  h = h * (1 - t) + beachH * t;
  // trails are worn a little into the ground
  return Math.max(-4, h - trailWear(x, z));
}
export const WATER_Y = 0;

// ---- Trails ----------------------------------------------------------------
// Dirt trails from the yard gates through the jungle to the beach and the pens.
export const TRAILS = [
  [[2, 44], [6, 62], [-4, 80], [4, 98], [18, 112], [14, 130], [6, 146], [8, 162]],          // south gate -> beach
  [[54, -1], [66, -4], [80, 10], [86, 34], [74, 58], [60, 80], [40, 100], [18, 112]],       // east gate -> pens -> joins
  [[-50, -1], [-66, 8], [-80, 30], [-92, 56], [-86, 86], [-70, 112], [-62, 136], [-58, 160]], // west gate -> beach
  [[2, -46], [-6, -66], [8, -88], [30, -104], [58, -100], [80, -76], [86, -50]],             // north loop
];
function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2)) : 0;
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}
export function trailDist(x, z) {
  let best = Infinity;
  for (const tr of TRAILS) for (let i = 0; i < tr.length - 1; i++) {
    const a = tr[i], b = tr[i + 1];
    if (Math.min(a[0], b[0]) - best > x || Math.max(a[0], b[0]) + best < x) continue;
    best = Math.min(best, segDist(x, z, a[0], a[1], b[0], b[1]));
  }
  return best;
}
function trailWear(x, z) {
  if (Math.hypot(x, z) < 50) return 0;
  const d = trailDist(x, z);
  return d < 3 ? 0.18 * (1 - d / 3) : 0;
}

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
    // tall French windows and doors like the real house (a low ledge keeps the cows' climb-in)
    sill: e.kind === 'door' ? 0 : 0.4,
    top: 2.85,
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
// Furniture that blocks movement (copied from the real house photos). Small pieces such as
// the cane rockers and iron side tables are decoration only, so they never trap cows.
export const FURNITURE = [
  // living room (west): carved colonial bench and the bar cabinet against the partition
  { kind: 'bench', x: -8.6, z: -6.3, w: 1.75, d: 0.7, h: 0.95 },
  { kind: 'bar', x: -3.38, z: -4.7, w: 0.52, d: 1.6, h: 2.2 },
  // dining room (east): long dark table with ten carved high-back chairs
  { kind: 'dining', x: 4.2, z: 3.4, w: 3.7, d: 2.0, h: 0.78 },
  // kitchen along the back wall
  { kind: 'island', x: 4.5, z: -0.5, w: 3.2, d: 1.2, h: 0.95 },
  { kind: 'counter', x: 0.6, z: -6.2, w: 3, d: 0.75, h: 0.95 },
  { kind: 'stove', x: 2.6, z: -6.2, w: 1.0, d: 0.75, h: 0.95 },
  { kind: 'fridge', x: 10.1, z: -5.9, w: 1.1, d: 0.9, h: 2.0 },
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
  // parked like the drone photo: the grey F-150 Tremor in the carport, the boat on its trailer
  // in front of it beside the house, and the white Chevy on the lawn
  { id: 'f150', kind: 'f150', x: 17.5, z: -0.4, w: 2.2, d: 5.9, h: 2.0 },
  { id: 'boat', kind: 'boat', x: 15.7, z: 8.1, w: 2.6, d: 8.2, h: 2.7 },
  { id: 'chevy', kind: 'chevy', x: 15.7, z: 16.2, w: 2.2, d: 5.9, h: 1.9 },
  { id: 'trough', kind: 'trough', x: 40, z: 18, w: 1.4, d: 5, h: 0.8 },
  { id: 'woodpile', kind: 'woodpile', x: -22, z: -12, w: 4, d: 1.6, h: 1.4 },
  // from the drone photo: the steel farm windmill behind the house and the tiled carport
  { id: 'windmill', kind: 'windmill', x: 15, z: -13, w: 2.4, d: 2.4, h: 11 },
  { id: 'carport', kind: 'carport', x: 17.5, z: 0, w: 6, d: 6.5, h: 3.2, open: true },
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

// (the real ranch has no hay bales around the house, so there are none)
export const HAY_BALES = [];

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
// Trees: open pasture near the house, dense jungle beyond, palms along the beach.
// Undergrowth (ferns/shrubs) has no collision and is listed separately.
export const TREES = [];
export const UNDERGROWTH = [];
(() => {
  const r = rng(1337);
  const yardWall = (x, z) => x > FENCE.minX - 6 && x < FENCE.maxX + 6 && z > FENCE.minZ - 6 && z < FENCE.maxZ + 6;
  const inPen = (x, z) => PENS.some(p => Math.abs(x - p.x) < p.w / 2 + 4 && Math.abs(z - p.z) < p.d / 2 + 4);
  for (let gx = -MAP_HALF + 3; gx < MAP_HALF - 3; gx += 6) {
    for (let gz = -MAP_HALF + 3; gz < MAP_HALF; gz += 6) {
      const x = gx + (r() - 0.5) * 5, z = gz + (r() - 0.5) * 5;
      const roll = r(), kindRoll = r(), sc = 0.75 + r() * 0.6, under = r();
      const sz = shoreZ(x);
      if (z > sz - 3) continue;                       // sea / wet sand
      if (yardWall(x, z) || inPen(x, z)) continue;
      const td = trailDist(x, z);
      if (td < 4.5) continue;
      const beach = z > sz - SAND_WIDTH;
      const pasture = Math.hypot(x, z * 1.1) < 85;
      let p = beach ? 0.18 : pasture ? 0.05 : 0.62;
      if (td < 9) p *= 0.6;
      if (roll < p) {
        const kind = beach ? 'palm' : kindRoll < 0.38 ? 'palm' : kindRoll < 0.9 ? 'broad' : 'giant';
        TREES.push({ x, z, s: kind === 'giant' ? sc * 1.5 : sc, kind });
      }
      // undergrowth: dense in the jungle, lining the trails
      if (!beach && !pasture && under < 0.75) UNDERGROWTH.push({ x: x + 2.5, z: z - 2, s: 0.7 + r() * 0.8, kind: r() < 0.5 ? 'fern' : 'shrub', rot: r() * 6.28 });
      if (!beach && !pasture && td < 7 && td > 2.6) UNDERGROWTH.push({ x: x - 2, z: z + 2.5, s: 0.6 + r() * 0.6, kind: 'fern', rot: r() * 6.28 });
    }
  }
  // palms in the front garden, like the photos
  for (const [x, z, s] of [[-7, 17, 1.2], [7.5, 15.5, 1.1], [-14, 10, 1.3], [13, 9, 1.15], [-4, 24, 1.0]]) TREES.push({ x, z, s, kind: 'palm' });
  // big shade trees around the lawn and royal palms down the west side, after the drone photo
  for (const [x, z, kind, s] of [
    [-6, -20, 'giant', 1.3], [7, -25, 'broad', 1.3], [-21, -25, 'giant', 1.4], [22, -30, 'giant', 1.5],
    [-35, -14, 'broad', 1.3], [38, -34, 'giant', 1.4], [31, 12, 'giant', 1.6], [-34, 33, 'giant', 1.4],
    [20, 30, 'broad', 1.2], [-40, 0, 'broad', 1.3], [44, 0, 'broad', 1.3], [2, -36, 'broad', 1.2],
    [-18, 2, 'palm', 1.35], [-19, -6, 'palm', 1.25],
  ]) TREES.push({ x, z, s, kind });
})();

// All solid boxes. `shoot: true` means bullets pass through (open doors/windows).
export const SOLIDS = (() => {
  const out = [...HOUSE_WALLS, ...FURNITURE, ...STRUCTURES.filter(s => !s.open), ...HAY_BALES];
  // open structures (the carport) only block at their posts
  for (const s of STRUCTURES.filter(s => s.open)) for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    out.push({ kind: 'post', x: s.x + sx * (s.w / 2 - 0.2), z: s.z + sz * (s.d / 2 - 0.2), w: 0.4, d: 0.4, h: s.h });
  }
  for (const e of ENTRIES) out.push({ kind: 'entry', entry: e.id, shoot: true, ...e.box });
  for (const s of FENCE_SEGMENTS) {
    if (s.x1 !== undefined) out.push({ kind: 'fence', x: (s.x1 + s.x2) / 2, z: s.z, w: s.x2 - s.x1, d: FENCE.t, h: FENCE.h });
    else out.push({ kind: 'fence', x: s.x, z: (s.z1 + s.z2) / 2, w: FENCE.t, d: s.z2 - s.z1, h: FENCE.h });
  }
  for (const t of TREES) { const w = (t.kind === 'palm' ? 0.55 : t.kind === 'giant' ? 1.6 : 0.9) * t.s; out.push({ kind: 'trunk', x: t.x, z: t.z, w, d: w, h: 40 }); }
  out.push(...VERANDA.rails, ...VERANDA.columns);
  return out;
})();

// Players start inside the living room / kitchen.
export const PLAYER_SPAWNS = [[-6, 4.5], [0, 3.5], [-1, 0], [6, 2.5], [-8, -1], [2, 4.5], [8, 1], [-5, -5]];

export function insideHouse(x, z) {
  return Math.abs(x - HOUSE.x) < HX && Math.abs(z - HOUSE.z) < HZ;
}

// Players can walk through the doors (the boards only stop cows).
export const playerPassable = (b) => b.kind === 'entry' && ENTRIES[b.entry].kind === 'door';

// ---- Spatial buckets so collision stays fast with thousands of trunks ----------
const BUCKET = 8;
const buckets = new Map();
for (const b of SOLIDS) {
  const x0 = Math.floor((b.x - b.w / 2) / BUCKET), x1 = Math.floor((b.x + b.w / 2) / BUCKET);
  const z0 = Math.floor((b.z - b.d / 2) / BUCKET), z1 = Math.floor((b.z + b.d / 2) / BUCKET);
  for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
    const k = i * 100003 + j;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(b);
  }
}
const _near = [];
export function solidsNear(x, z, r) {
  _near.length = 0;
  const x0 = Math.floor((x - r) / BUCKET), x1 = Math.floor((x + r) / BUCKET);
  const z0 = Math.floor((z - r) / BUCKET), z1 = Math.floor((z + r) / BUCKET);
  for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
    const list = buckets.get(i * 100003 + j);
    if (list) for (const b of list) if (!_near.includes(b)) _near.push(b);
  }
  return _near;
}

// keep things on land: inside the map and not out past the surf
export function clampToMap(x, z, r = 0) {
  const lim = MAP_HALF - r;
  x = Math.max(-lim, Math.min(lim, x));
  z = Math.max(-lim, Math.min(shoreZ(x) + 10, z));
  return [x, z];
}

// ---- Shared maths helpers -------------------------------------------------

// Push a circle (x,z,r) out of every solid taller than `feetY + step`.
// Box heights are measured from the flat yard (y = 0); everything solid sits there.
export function resolveCircle(x, z, r, feetY = 0, step = 0.4, skip = null) {
  for (let iter = 0; iter < 3; iter++) {
    let moved = false;
    for (const b of solidsNear(x, z, r + 1)) {
      if (b.h <= feetY + step || (skip && skip(b))) continue;
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
  return clampToMap(x, z, r);
}

// Height of the walkable surface under a circle: terrain, or the top of furniture/bales/truck.
export function groundHeight(x, z, r, feetY, step = 0.4) {
  let g = heightAt(x, z);
  for (const b of solidsNear(x, z, r + 1)) {
    if (b.h > feetY + step || b.h <= g) continue;
    if (Math.abs(x - b.x) < b.w / 2 + r * 0.5 && Math.abs(z - b.z) < b.d / 2 + r * 0.5) g = b.h;
  }
  return g;
}

// Ray vs everything bullets can't pass through (boxes + terrain). Returns hit distance.
export function raySolids(o, d, maxDist = 300) {
  let best = maxDist;
  // walk the ray through buckets so long shots stay cheap
  const step = BUCKET * 0.75, seen = new Set();
  for (let t = 0; t < best + step; t += step) {
    const px = o[0] + d[0] * t, pz = o[2] + d[2] * t;
    for (const b of solidsNear(px, pz, BUCKET)) {
      if (b.shoot || seen.has(b)) continue;
      seen.add(b);
      const hit = rayBox(o, d, b.x - b.w / 2, 0, b.z - b.d / 2, b.x + b.w / 2, b.h, b.z + b.d / 2);
      if (hit >= 0 && hit < best) best = hit;
    }
  }
  for (const e of ENTRIES) { // window sills and lintels
    const hw = e.width / 2, ht = HOUSE.t / 2;
    const [wx, wz] = e.nx === 0 ? [hw, ht] : [ht, hw];
    if (e.sill > 0) {
      const t = rayBox(o, d, e.x - wx, 0, e.z - wz, e.x + wx, e.sill, e.z + wz);
      if (t >= 0 && t < best) best = t;
    }
    const t = rayBox(o, d, e.x - wx, e.top, e.z - wz, e.x + wx, HOUSE.wallH, e.z + wz);
    if (t >= 0 && t < best) best = t;
  }
  if (d[1] > 0 && insideHouse(o[0], o[2])) {
    const t = (HOUSE.wallH - o[1]) / d[1];
    if (t >= 0 && t < best) best = t;
  }
  // terrain: march, then refine
  let prev = 0;
  for (let t = 0.5; t < best; t += 1) {
    const y = o[1] + d[1] * t;
    if (y < heightAt(o[0] + d[0] * t, o[2] + d[2] * t)) {
      let lo = prev, hi = t;
      for (let k = 0; k < 6; k++) { const m = (lo + hi) / 2; if (o[1] + d[1] * m < heightAt(o[0] + d[0] * m, o[2] + d[2] * m)) hi = m; else lo = m; }
      return hi;
    }
    if (y > 12 && d[1] >= 0) break; // above any hill and climbing
    prev = t;
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

// The ranch dogs fight on your side: two big red-brown dogs (Jack, Mateo), the little
// fluffy one (Taco) and Pepper, a sleek black lab mix. They go after any cow near the
// players, through the doors if the cow is on the other side of the walls.
// `coat` tints the shared dog model on the client ([r, g, b] multiplier, optional).
export const DOG_TYPES = [
  { kind: 'big', name: 'Jack', hp: 90, speed: 7.5, sight: 30, bite: 1.0, damage: 7, biteEvery: 0.9, radius: 0.4 },
  { kind: 'big', name: 'Mateo', hp: 90, speed: 7.2, sight: 30, bite: 1.0, damage: 7, biteEvery: 0.95, radius: 0.4, coat: [0.82, 0.74, 0.7] },
  { kind: 'little', name: 'Taco', hp: 45, speed: 8.0, sight: 24, bite: 0.7, damage: 3, biteEvery: 0.6, radius: 0.28 },
  { kind: 'big', name: 'Pepper', hp: 90, speed: 7.8, sight: 30, bite: 1.0, damage: 7, biteEvery: 0.85, radius: 0.38, coat: [0.075, 0.11, 0.16], sleek: true, scale: 0.92 },
];
export const DOG_LEASH = 32; // dogs only chase cows this close to a player

// Hit spheres for a cow at (x,z) facing yaw. Index 0 is the head.
// `rear` lifts the front end (used while climbing through a window).
// Hit spheres for a cow at (x,z) facing yaw, matched to the Brahman model
// (2.7 m nose to rump, head ~1.55 m forward, back ~1.55 m high). Index 0 is the head.
export function cowHitSpheres(type, x, z, yaw, y = 0) {
  const s = COW_TYPES[type].scale;
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  const at = (f, h, r, head) => ({ x: x + fx * f * s, y: y + h * s, z: z + fz * f * s, r: r * s, head });
  return [
    at(1.58, 1.42, 0.3, true),
    at(0.9, 1.2, 0.48),
    at(0.25, 1.15, 0.5),
    at(-0.4, 1.12, 0.5),
    at(0.1, 0.45, 0.45),
  ];
}

// ---- Weapons (CoD Zombies style: start with a rifle + revolver, buy more off the walls) ----
export const WEAPONS = {
  rifle:    { name: 'RANCH RIFLE',   damage: 30,  headMult: 3.5, fireInterval: 0.095, auto: true,  mag: 30, reserve: 210, reload: 2.1, pellets: 1, hip: 0.03,  ads: 0.003, range: 250, zoom: 52 },
  revolver: { name: 'REVOLVER',      damage: 70,  headMult: 3.0, fireInterval: 0.28,  auto: false, mag: 6,  reserve: 60,  reload: 2.3, pellets: 1, hip: 0.02,  ads: 0.002, range: 200, zoom: 60 },
  shotgun:  { name: 'PUMP SHOTGUN',  damage: 24,  headMult: 2.0, fireInterval: 0.75,  auto: false, mag: 6,  reserve: 42,  reload: 3.0, pellets: 9, hip: 0.09,  ads: 0.06,  range: 60,  zoom: 62 },
  hunting:  { name: 'HUNTING RIFLE', damage: 220, headMult: 3.0, fireInterval: 1.1,   auto: false, mag: 5,  reserve: 35,  reload: 2.9, pellets: 1, hip: 0.05,  ads: 0.0,   range: 400, zoom: 28 },
  lmg:      { name: 'LA BESTIA LMG', damage: 42,  headMult: 3.0, fireInterval: 0.075, auto: true,  mag: 75, reserve: 300, reload: 4.5, pellets: 1, hip: 0.045, ads: 0.008, range: 300, zoom: 50 },
};
export const WEAPON = WEAPONS.rifle; // kept for older code paths
export const START_WEAPONS = ['rifle', 'revolver'];
export const START_POINTS = 500;

// Wall-buy stations: walk up, hold E. Buying a gun you already own refills its ammo for half.
export const WALL_BUYS = [
  { weapon: 'shotgun', cost: 500,  x: -3.35, z: 4.6,  nx: -1, nz: 0 },   // living room, on the partition wall
  { weapon: 'hunting', cost: 1000, x: 25.7,  z: -10,  nx: -1, nz: 0 },   // outside the bunkhouse
  { weapon: 'lmg',     cost: 2000, x: -25.7, z: 22,   nx: 1,  nz: 0 },   // outside the feed store
];
export const BUY_RANGE = 2.2;

export const MELEE = { damage: 150, range: 2.4, interval: 0.55 };
export const GRENADE = { fuse: 2.2, radius: 7, damage: 480, perWave: 2, max: 4 };
export const POWERUP_TYPES = ['maxammo', 'instakill', 'double', 'nuke'];
export const POWERUP_CHANCE = 0.045;
export const POWERUP_TIME = 30;
export const REPAIR_TIME = 0.7;
export const REPAIR_RANGE = 2.4;
