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
  [[2, 44], [5, 62], [-3, 80], [4, 98], [16, 112], [13, 130], [7, 146], [8, 162]],          // south gate -> beach (now the road)
  [[54, -1], [66, -4], [80, 10], [86, 34], [74, 58], [60, 80], [40, 100], [16, 112]],       // east gate -> pens -> joins
  [[-50, -1], [-66, 8], [-80, 30], [-92, 56], [-86, 86], [-70, 112], [-62, 136], [-58, 160]], // west gate -> beach
  [[2, -46], [-6, -66], [8, -88], [30, -104], [58, -100], [80, -76], [86, -50]],             // north loop
];
// The road: a white caliche track wide enough for the trucks, from the driveway in front of
// the house, out of the south gate and through the jungle to the beach. No trees grow on it.
export const ROAD = [[14.5, 23], [10, 33], [3.5, 41], [2, 47], [5, 62], [-3, 80], [4, 98], [16, 112], [13, 130], [7, 146], [8, 158], [9, 170]];
export const ROAD_HALF = 3.3;      // half the width of the driven surface
export function roadDist(x, z) {
  if (z < 15 || Math.abs(x) > 40) return 99;
  let best = 99;
  for (let i = 0; i < ROAD.length - 1; i++) best = Math.min(best, segDist(x, z, ROAD[i][0], ROAD[i][1], ROAD[i + 1][0], ROAD[i + 1][1]));
  return best;
}
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
  const rd = roadDist(x, z);
  if (rd < ROAD_HALF + 2.5) return 0.2 * (1 - smooth(ROAD_HALF, ROAD_HALF + 2.5, rd)); // graded flat, with a soft shoulder
  const d = trailDist(x, z);
  return d < 3 ? 0.18 * (1 - d / 3) : 0;
}

// ---- The house -------------------------------------------------------------

// Re-traced from the family's walk-through video of the real house (November 2026):
//   - west wing: the kitchen (brick hood, brick-arched counters) and, across a passage with
//     the side door at its end, the bar room (mahogany and black-marble bar, glass double doors)
//   - along the back: the stair hall with its long tiled corridor, and Troy's office
//   - across the front: one big room, the long dining table at the west end and the cane
//     rocking chairs at the east end, with a stone column and arches between them, a row of
//     stone columns and arches onto the hall, and French doors out to the veranda.
// The Blender model (tools/blender/make_house.py) is built from these same numbers
// (`node scripts/houselayout.js` dumps them), so walls and collision always line up.
export const HOUSE = { x: -1, z: -1, w: 24, d: 16, wallH: 4.0, t: 0.3, iw: 0.2 };
const HX = HOUSE.w / 2, HZ = HOUSE.d / 2;
// outside faces of the walls' centre lines: x -13..11, z -9..7 (the front, with the veranda, is +z)
export const HB = { x0: HOUSE.x - HX, x1: HOUSE.x + HX, z0: HOUSE.z - HZ, z1: HOUSE.z + HZ };

// Doors and windows in the outside walls that the cows come through. `at` is the position
// along the wall (x for N/S walls, z for E/W). The 'window's are the house's tall French
// doors (a low ledge keeps the cows' climb-in).
const ENTRY_DEFS = [
  { kind: 'door', wall: 'S', at: 0, room: 'great' },          // 0 front door
  { kind: 'window', wall: 'S', at: -4.5, room: 'great' },     // 1 dining room
  { kind: 'window', wall: 'S', at: 3, room: 'great' },        // 2 dining room
  { kind: 'window', wall: 'S', at: 7.5, room: 'great' },      // 3 sitting room
  { kind: 'window', wall: 'S', at: -10, room: 'bar' },        // 4 bar room
  { kind: 'door', wall: 'W', at: -2.5, room: 'passage' },     // 5 side door at the end of the passage
  { kind: 'window', wall: 'W', at: 3, room: 'bar' },          // 6 bar room
  { kind: 'window', wall: 'E', at: 2, room: 'great' },        // 7 sitting room
  { kind: 'window', wall: 'E', at: -5.5, room: 'office' },    // 8 office
  // 9 upstairs: the door at the east end of the gallery, out onto the flat roof (the outside
  // stair runs down from there to the yard). Players come and go; cows tear its boards off.
  { kind: 'door', wall: 'E', at: -6.5, room: 'gallery', level: 1, line: 4 },
];
// Glazed windows (with grilles) that nothing climbs through: over the kitchen counters, and
// the office window with the yellow curtains. The wall stays solid behind the glass.
export const WINDOWS = [
  { wall: 'N', at: -9.2, sill: 1.05, top: 2.55, width: 1.5, room: 'kitchen' },   // over the sink
  { wall: 'W', at: -6.6, sill: 1.05, top: 2.55, width: 1.5, room: 'kitchen' },   // beside the hood
  { wall: 'N', at: 7.5, sill: 0.95, top: 2.55, width: 1.6, room: 'office' },
];

// The upper floor: its level, wall height, and the walls' centre lines (the loggia runs along
// the front of it, out to z = loggiaZ).
export const UPPER = { y: HOUSE.wallH + 0.3, h: 3.1, x0: -7, x1: 4, z0: -9, z1: -0.6, loggiaZ: 1.0 };

export const ENTRIES = ENTRY_DEFS.map((e, id) => {
  const width = e.kind === 'door' ? 1.5 : 1.7;
  const n = { N: [0, -1], S: [0, 1], W: [-1, 0], E: [1, 0] }[e.wall]; // outward normal
  const along = e.wall === 'N' || e.wall === 'S';
  const x = along ? e.at : e.line ?? (n[0] > 0 ? HB.x1 : HB.x0);
  const z = along ? e.line ?? (n[1] > 0 ? HB.z1 : HB.z0) : e.at;
  const y = e.level ? UPPER.y : 0, wt = e.level ? 0.25 : HOUSE.t, top = e.level ? UPPER.h : HOUSE.wallH;
  return {
    id, ...e, level: e.level || 0, y, width, x, z, nx: n[0], nz: n[1],
    sill: e.sill ?? (e.kind === 'door' ? 0 : 0.4),   // (sill and top are above the floor at y)
    top: e.level ? 2.3 : 2.85,
    out: [x + n[0] * 2.1, z + n[1] * 2.1],   // where a cow stands to tear boards
    in: [x - n[0] * 2.1, z - n[1] * 2.1],    // where a cow lands after climbing in
    // solid box filling the opening (blocks walking, not bullets)
    box: along
      ? { x, z, w: width, d: wt, h: y + top, y0: y || undefined }
      : { x, z, w: wt, d: width, h: y + top, y0: y || undefined },
  };
});

// Rooms (inside the wall centre lines) and the doorways between them. Doorway centres sit on
// half metres so the cows' 1 m path grid runs straight through the middle of each one.
export const ROOMS = [
  { id: 'kitchen', x0: -13, x1: -7, z0: -9, z1: -4 },
  { id: 'passage', x0: -13, x1: -7, z0: -4, z1: -1 },
  { id: 'bar', x0: -13, x1: -7, z0: -1, z1: 7 },
  { id: 'hall', x0: -7, x1: 4, z0: -9, z1: -1 },
  { id: 'office', x0: 4, x1: 11, z0: -9, z1: -1 },
  { id: 'great', x0: -7, x1: 11, z0: -1, z1: 7 },
  // upstairs: the gallery round the stairwell, two bedrooms off it
  { id: 'gallery', level: 1, x0: -7, x1: 4, z0: -9, z1: -5.4 },
  { id: 'bed1', level: 1, x0: -7, x1: -1, z0: -5.4, z1: -0.6 },
  { id: 'bed2', level: 1, x0: -1, x1: 4, z0: -5.4, z1: -0.6 },
];
// Interior walls: a line along x (at z) or along z (at x), with doorways [centre, width, kind].
// The passage opens into the hall full width (`open`).
const IWALL_DEFS = [
  { z: -4, x0: -13, x1: -7, doors: [[-10.5, 1.5, 'door']] },               // kitchen | passage (door with a transom)
  { z: -1, x0: -13, x1: -7, doors: [[-10.5, 1.5, 'glass']] },              // passage | bar room (glass double doors, facing the kitchen door)
  { x: -7, z0: -9, z1: -4, doors: [] },                                     // kitchen | hall
  { x: -7, z0: -4, z1: -1, doors: [[-2.5, 2.8, 'open']] },                 // passage | hall
  { x: -7, z0: -1, z1: 7, doors: [] },                                      // bar room | big room
  { x: 4, z0: -9, z1: -1, doors: [[-5.5, 1.6, 'double']] },                // hall | office (double doors at the end of the hall)
  { z: -1, x0: 4, x1: 11, doors: [[7.5, 1.5, 'glass']] },                  // office | sitting room (glass door)
  { z: -5.4, x0: -7, x1: 4, doors: [[-4.5, 1.5, 'door'], [1.5, 1.5, 'door']], level: 1 },   // gallery | bedrooms
  { x: -1, z0: -5.4, z1: -0.6, doors: [], level: 1 },                       // between the bedrooms
];
// The stone colonnade between the hall and the big room (open arches, square columns), and
// the column holding the two arches between the dining and sitting ends.
export const COLONNADE = { z: -1, x0: -7, x1: 4, cols: [-3.5, 0.5], size: 0.6, spring: 2.9 };
export const ARCH_COL = { x: 4.5, z: 3.0, size: 0.6, spring: 2.9 };
export const PORTALS = [];   // { a, b, x, z, nx, nz, w, kind }: crossing from room a to b along (nx, nz)
const roomIdx = (id) => ROOMS.findIndex(r => r.id === id);
// the floor a height is on: upstairs from a little below the upper floor
export const levelOf = (y = 0) => (y > HOUSE.wallH - 0.8 ? 1 : 0);
const roomOfPoint = (x, z, y = 0) => { const lv = levelOf(y); return ROOMS.findIndex(r => (r.level || 0) === lv && x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1); };

// Wall pieces between the openings: outside walls ('wall') and interior partitions ('iwall').
export const HOUSE_WALLS = (() => {
  const walls = [];
  const t = HOUSE.t, h = HOUSE.wallH;
  for (const wall of ['N', 'S', 'W', 'E']) {
    const along = wall === 'N' || wall === 'S';
    const lo = (along ? HB.x0 : HB.z0) - t / 2, hi = (along ? HB.x1 : HB.z1) + t / 2;
    const openings = ENTRIES.filter(e => e.wall === wall && !e.level).map(e => [e.at - e.width / 2, e.at + e.width / 2]).sort((a, b) => a[0] - b[0]);
    let cur = lo;
    const pieces = [];
    for (const [a, b] of openings) { if (a > cur) pieces.push([cur, a]); cur = b; }
    if (cur < hi) pieces.push([cur, hi]);
    for (const [a, b] of pieces) {
      const mid = (a + b) / 2, size = b - a;
      if (wall === 'N') walls.push({ kind: 'wall', side: 'N', x: mid, z: HB.z0, w: size, d: t, h });
      if (wall === 'S') walls.push({ kind: 'wall', side: 'S', x: mid, z: HB.z1, w: size, d: t, h });
      if (wall === 'W') walls.push({ kind: 'wall', side: 'W', x: HB.x0, z: mid, w: t, d: size, h });
      if (wall === 'E') walls.push({ kind: 'wall', side: 'E', x: HB.x1, z: mid, w: t, d: size, h });
    }
  }
  const iw = HOUSE.iw;
  for (const def of IWALL_DEFS) {
    const lv = def.level || 0, y0 = lv ? UPPER.y : 0, wh = lv ? UPPER.y + UPPER.h : h, fy = lv ? UPPER.y : 0;
    const alongX = def.z !== undefined;
    // run interior walls into the outside walls' inner faces so there are no slits
    const lo = alongX ? def.x0 : def.z0, hi = alongX ? def.x1 : def.z1;
    let cur = lo;
    const pieces = [];
    for (const [c, w, kind] of [...def.doors].sort((a, b) => a[0] - b[0])) {
      pieces.push([cur, c - w / 2]);
      cur = c + w / 2;
      const [x, z] = alongX ? [c, def.z] : [def.x, c];
      const nx = alongX ? 0 : 1, nz = alongX ? 1 : 0;
      const a = roomOfPoint(x - nx * 0.5, z - nz * 0.5, fy), b = roomOfPoint(x + nx * 0.5, z + nz * 0.5, fy);
      PORTALS.push({ a, b, x, z, nx, nz, w, kind, level: lv, y: fy, wall: kind !== 'open', top: fy + (kind === 'open' ? HOUSE.wallH : kind === 'door' ? 2.2 : 2.45), ceil: wh });
    }
    pieces.push([cur, hi]);
    for (const [a, b] of pieces) {
      if (b - a < 0.01) continue;
      const mid = (a + b) / 2, size = b - a;
      walls.push(alongX ? { kind: 'iwall', x: mid, z: def.z, w: size, d: iw, h: wh, y0: lv ? y0 : undefined, level: lv } : { kind: 'iwall', x: def.x, z: mid, w: iw, d: size, h: wh, y0: lv ? y0 : undefined, level: lv });
    }
  }
  // the colonnade's arches are open: one portal per arch for routing
  const c = COLONNADE, edges = [c.x0 + iw / 2, ...c.cols.flatMap(x => [x - c.size / 2, x + c.size / 2]), c.x1 - iw / 2];
  for (let i = 0; i < edges.length; i += 2) {
    const x = Math.round((edges[i] + edges[i + 1]) / 2 - 0.5) + 0.5;
    PORTALS.push({ a: roomIdx('hall'), b: roomIdx('great'), x, z: c.z, nx: 0, nz: 1, w: edges[i + 1] - edges[i], kind: 'arch', wall: false, level: 0, y: 0 });
  }
  return walls;
})();

// The stair: one long flight up the back wall of the hall, rising east from the passage end
// to a landing upstairs, white plaster with a solid balustrade, a round skylight over it.
// You can walk up it (each step is a box you stand on); so can the cows.
export const STAIR = { x0: -5.6, x1: 1.6, z0: HB.z0 + HOUSE.t / 2, z1: -7.45, landingX: 3.0, rise: UPPER.y, steps: 24 };
// The outside stair: from the flat roof over the office, down the back wall to the yard
// (solid masonry with a low wall up its open side), rising east like the inside one.
export const EXT_STAIR = { x0: 2.6, x1: 9.6, z0: -10.75, z1: HB.z0 - HOUSE.t / 2, landingX: 11.15, rise: UPPER.y, steps: 23 };
// For walking and the cows' routes: each flight, its foot and its head (level 0 and 1).
export const STAIRS = [STAIR, EXT_STAIR].map((s) => {
  const zm = (s.z0 + s.z1) / 2;
  return { ...s, zm, run: (s.x1 - s.x0) / s.steps, riseStep: s.rise / (s.steps + 1), foot: [s.x0 - 0.7, zm], head: [s.x1 + 0.6, zm] };
});

// Furniture that blocks movement (traced from the video). Small pieces such as the cane
// rockers, chairs and iron side tables are decoration only, so they never trap cows.
// `nav: false` keeps a piece out of the cows' path grid (they just slide round it).
export const FURNITURE = [
  // kitchen: brick-arched counters with granite tops along the back and west walls
  { kind: 'counter', x: -10.25, z: -8.5, w: 5.2, d: 0.7, h: 0.92 },
  { kind: 'counter', x: -12.5, z: -6.95, w: 0.7, d: 2.4, h: 0.92 },
  { kind: 'ktable', x: -10.0, z: -6.45, w: 1.3, d: 0.8, h: 0.78, nav: false },
  // bar room: the bar along the passage wall (back cabinet with the mirror, counter in front)
  { kind: 'barback', x: -8.35, z: -0.68, w: 2.4, d: 0.45, h: 2.75 },
  { kind: 'barcounter', x: -8.35, z: 0.05, w: 2.4, d: 0.65, h: 1.1 },
  // the long dining table (twenty carved chairs) and the strips of chairs down each side
  { kind: 'dining', x: -1.75, z: 3.0, w: 6.0, d: 1.1, h: 0.78 },
  { kind: 'chairs', x: -1.75, z: 2.15, w: 6.0, d: 0.6, h: 0.5 },
  { kind: 'chairs', x: -1.75, z: 3.85, w: 6.0, d: 0.6, h: 0.5 },
  // sitting room: the dark coffee table on its iron base and the long slatted pew
  { kind: 'coffee', x: 7.7, z: 3.7, w: 1.3, d: 0.75, h: 0.46, nav: false },
  { kind: 'pew', x: 5.85, z: 3.7, w: 0.6, d: 2.3, h: 0.9 },
  // office: the desk and the glass-fronted cabinet
  { kind: 'desk', x: 9.0, z: -7.2, w: 1.9, d: 0.9, h: 0.76, nav: false },
  { kind: 'cabinet', x: 4.38, z: -7.9, w: 0.45, d: 1.5, h: 2.3 },
  // outside the side door: the kettle grill and the cooler
  { kind: 'grill', x: -15.2, z: -5.4, w: 0.7, d: 0.7, h: 1.1 },
  { kind: 'cooler', x: -14.3, z: -5.47, w: 0.64, d: 0.41, h: 0.47 },
];
// Upstairs furniture (heights above the upper floor).
export const UPPER_FURNITURE = [
  { kind: 'bed', x: -4.0, z: -1.95, w: 1.7, d: 2.1, h: 0.62 },          // the big carved bed
  { kind: 'wardrobe', x: -6.55, z: -3.6, w: 0.6, d: 1.6, h: 2.1 },
  { kind: 'dresser', x: -2.2, z: -5.05, w: 1.3, d: 0.5, h: 0.85 },
  { kind: 'bed', x: 0.25, z: -1.95, w: 1.0, d: 2.0, h: 0.55 },          // two singles in the second room
  { kind: 'bed', x: 2.75, z: -1.95, w: 1.0, d: 2.0, h: 0.55 },
  { kind: 'wardrobe', x: 3.55, z: -4.5, w: 0.55, d: 1.4, h: 2.0 },
  { kind: 'chest', x: -6.3, z: -6.6, w: 0.5, d: 1.0, h: 0.5 },          // a carved chest in the gallery
];

// Steps, floors and walls of the upper level. Boxes with a `y0` start above the ground: you
// walk under them downstairs and on them (or into them) upstairs.
export const UPPER_SOLIDS = (() => {
  const out = [], U = UPPER.y, t = HOUSE.t, S = STAIR;
  const B = { x0: HB.x0 - t / 2, x1: HB.x1 + t / 2, z0: HB.z0 - t / 2, z1: HB.z1 + t / 2 };
  const rect = (kind, x0, z0, x1, z1, y0, h, extra = {}) => out.push({ kind, x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0, y0: y0 || undefined, h, ...extra });
  // the flights: a box per step, a low wall up the open side; the landing at the top
  for (const st of STAIRS) {
    const side = st === STAIRS[0] ? [st.z1, st.z1 + 0.12] : [st.z0 - 0.12, st.z0];
    for (let i = 0; i < st.steps; i++) {
      const xa = st.x0 + i * st.run, xb = xa + st.run, top = (i + 1) * st.riseStep;
      rect('step', xa, st.z0, xb, st.z1, 0, top);
      rect('stairwall', xa, side[0], xb, side[1], 0, top + 0.95);
    }
    rect('step', st.x1, st.z0, st.landingX, st.z1, 0, U);
  }
  const E = STAIRS[1];
  rect('stairwall', E.x1, E.z0 - 0.12, E.landingX + 0.12, E.z0, 0, U + 0.95);   // round the outside landing
  rect('stairwall', E.landingX, E.z0 - 0.12, E.landingX + 0.12, E.z1, 0, U + 0.95);
  // the roof over the ground floor is the floor upstairs, with the stairwell left open
  const hole = { x0: S.x0 - 0.05, x1: S.x1, z0: S.z0, z1: -7.25 };
  rect('slab', B.x0, B.z0, hole.x0, B.z1, HOUSE.wallH, U);
  rect('slab', hole.x1, B.z0, B.x1, B.z1, HOUSE.wallH, U);
  rect('slab', hole.x0, hole.z1, hole.x1, B.z1, HOUSE.wallH, U);
  rect('slab', hole.x0, B.z0, hole.x1, hole.z0, HOUSE.wallH, U);
  // up on the roof you can't walk on the tiled slopes (front and west wing), and a parapet
  // runs round the flat part, open where the outside stair comes up
  rect('roofslope', B.x0, B.z1 - 3.15, B.x1, B.z1 + 0.3, U, U + 1.3);
  rect('roofslope', B.x0, B.z0, UPPER.x0 - 0.12, B.z1 - 3.15, U, U + 1.3);
  rect('parapet', UPPER.x1 + 0.12, B.z0, E.x1, B.z0 + 0.22, U, U + 0.78);
  rect('parapet', E.landingX - 0.3, B.z0, B.x1, B.z0 + 0.22, U, U + 0.78);
  rect('parapet', B.x1 - 0.22, B.z0, B.x1, B.z1 - 3.15, U, U + 0.78);
  // the upper storey's outside walls (the door onto the roof is entry 9), the wall between
  // the bedrooms and the loggia, the loggia's balustrade and its corner piers
  const W = UPPER.y + UPPER.h, uw = 0.25;
  rect('uwall', UPPER.x0 - uw / 2, UPPER.z0 - uw / 2, UPPER.x1 + uw / 2, UPPER.z0 + uw / 2, U, W);
  rect('uwall', UPPER.x0 - uw / 2, UPPER.z0, UPPER.x0 + uw / 2, UPPER.loggiaZ, U, W);
  const door = ENTRIES.find(e => e.level === 1);
  rect('uwall', UPPER.x1 - uw / 2, UPPER.z0, UPPER.x1 + uw / 2, door.z - door.width / 2, U, W);
  rect('uwall', UPPER.x1 - uw / 2, door.z + door.width / 2, UPPER.x1 + uw / 2, UPPER.z1, U, W);
  rect('uwall', UPPER.x0, UPPER.z1 - 0.1, UPPER.x1, UPPER.z1 + 0.1, U, W);
  rect('balustrade', UPPER.x0, UPPER.loggiaZ - 0.4, UPPER.x1 + uw / 2, UPPER.loggiaZ, U, U + 0.95);
  rect('uwall', UPPER.x1 - 0.2, UPPER.loggiaZ - 0.4, UPPER.x1 + uw / 2, UPPER.loggiaZ, U, W);
  // the railing round the stairwell upstairs
  rect('rail', hole.x0, hole.z1 - 0.03, hole.x1, hole.z1 + 0.03, U, U + 1.0);
  rect('rail', hole.x0 - 0.06, hole.z0, hole.x0, hole.z1, U, U + 1.0);
  // upstairs furniture: the beds, wardrobes, the bench on the loggia
  for (const f of UPPER_FURNITURE) rect(f.kind, f.x - f.w / 2, f.z - f.d / 2, f.x + f.w / 2, f.z + f.d / 2, U, U + f.h, f.nav === false ? { nav: false } : {});
  return out;
})();

// Which room a point is in (index into ROOMS), or -1 outside. Pass y for upstairs.
export const roomAt = roomOfPoint;

// Next point to head for when walking from (x, z) to (gx, gz), both inside the house and on
// the same floor: straight there in the same room, otherwise through the doorways (shortest
// chain of them).
export function indoorWaypoint(x, z, gx, gz, y = 0) {
  const ra = roomOfPoint(x, z, y), rb = roomOfPoint(gx, gz, y);
  if (ra < 0 || rb < 0 || ra === rb) return [gx, gz];
  // Dijkstra over doorways; the first doorway on the best route decides the next step
  const n = PORTALS.length, dist = new Array(n).fill(Infinity), first = new Array(n).fill(-1), side = new Array(n).fill(-1), done = new Array(n).fill(false);
  for (let i = 0; i < n; i++) {
    const p = PORTALS[i];
    if (p.a === ra || p.b === ra) { dist[i] = Math.hypot(p.x - x, p.z - z); first[i] = i; side[i] = p.a === ra ? p.b : p.a; }
  }
  let best = Infinity, bestFirst = -1;
  for (;;) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
    if (u < 0) break;
    done[u] = true;
    const pu = PORTALS[u], room = side[u];
    if (room === rb) { const t = dist[u] + Math.hypot(gx - pu.x, gz - pu.z); if (t < best) { best = t; bestFirst = first[u]; } continue; }
    for (let v = 0; v < n; v++) {
      const pv = PORTALS[v];
      if (done[v] || v === u || (pv.a !== room && pv.b !== room)) continue;
      const d = dist[u] + Math.hypot(pv.x - pu.x, pv.z - pu.z);
      if (d < dist[v]) { dist[v] = d; first[v] = first[u]; side[v] = pv.a === room ? pv.b : pv.a; }
    }
  }
  if (bestFirst < 0) return [gx, gz];
  const p = PORTALS[bestFirst];
  // line up square in front of the doorway, then go through it
  const s = Math.sign((x - p.x) * p.nx + (z - p.z) * p.nz) || -1;
  const near = [p.x + p.nx * s * 0.7, p.z + p.nz * s * 0.7], far = [p.x - p.nx * s * 1.0, p.z - p.nz * s * 1.0];
  const lateral = Math.abs((x - p.x) * p.nz - (z - p.z) * p.nx);
  const depth = Math.abs((x - p.x) * p.nx + (z - p.z) * p.nz);
  return lateral < Math.max(0.25, p.w / 2 - 0.45) && depth < 1.0 ? far : near;
}

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
// the mowed lawn inside the yard fence (the pasture beyond it grows long)
export const YARD = { minX: FENCE.minX, maxX: FENCE.maxX, minZ: FENCE.minZ, maxZ: FENCE.maxZ };

export const STRUCTURES = [
  // long front veranda (terracotta floor, white columns, iron railing) like the real house
  { id: 'veranda', kind: 'veranda', x: HOUSE.x, z: HB.z1 + 2.25, w: HOUSE.w + 0.6, d: 4.5, h: 0.25 },
  { id: 'fountain', kind: 'fountain', x: 0, z: 19, w: 3.4, d: 3.4, h: 0.9 },
  { id: 'bunkhouse', kind: 'bunkhouse', x: 31, z: -14, w: 10, d: 20, h: 6.5 },
  { id: 'feedstore', kind: 'feedstore', x: -30, z: 22, w: 8, d: 6, h: 4.5 },
  { id: 'tank', kind: 'tank', x: -12, z: -30, w: 5, d: 5, h: 6 },
  // parked like the drone photo: the boat on its trailer beside the house (the trucks that
  // park by it can be driven: see VEHICLES below)
  // (the boat sits a little toward the house so the F-150 can pull straight out past it)
  { id: 'boat', kind: 'boat', x: 14.6, z: 8.1, w: 2.6, d: 8.2, h: 2.7 },
  { id: 'trough', kind: 'trough', x: 40, z: 18, w: 1.4, d: 5, h: 0.8 },
  { id: 'woodpile', kind: 'woodpile', x: -22, z: -12, w: 4, d: 1.6, h: 1.4 },
  // from the drone photo: the steel farm windmill behind the house and the tiled carport
  { id: 'windmill', kind: 'windmill', x: 15, z: -13, w: 2.4, d: 2.4, h: 11 },
  { id: 'carport', kind: 'carport', x: 17.5, z: 0, w: 6, d: 6.5, h: 3.2, open: true },
];

// ---- The trucks ---------------------------------------------------------------
// Both pickups can be driven (hold nothing: walk up, press E). They are not part of SOLIDS;
// each side checks against where they currently are. A truck at (x, z) with `yaw` points
// along (sin yaw, cos yaw), like the cows; "left" is (cos yaw, -sin yaw), the driver's side.
export const VEHICLES = [
  { id: 1, kind: 'f150', name: 'F-150', x: 17.5, z: -0.4, yaw: 0, w: 2.1, l: 5.8, h: 1.95 },   // in the carport
  { id: 2, kind: 'chevy', name: 'Chevy', x: 17.2, z: 17.5, yaw: 0.35, w: 2.1, l: 5.8, h: 1.9 }, // on the lawn, nose toward the gate
];
// seats: [left, forward, height the rider's feet are held at]. 0 drives, 1 rides up front,
// 2 and 3 stand in the bed (and can shoot from there).
export const VEHICLE_SEATS = [[0.45, 0.45, 0.1], [-0.45, 0.45, 0.1], [0.45, -1.9, 0.85], [-0.45, -1.9, 0.85]];
export const ENTER_RANGE = 1.9;    // how close to the bodywork you must be to get in
export const DRIVE = { max: 19, maxOff: 9, maxWet: 3.5, reverse: 6.5, accel: 7.5, brake: 17, wheelbase: 3.7, steer: 0.62 };

// (x, z) in a truck's own frame: [left, forward]
export function vehicleLocal(v, x, z) {
  const s = Math.sin(v.yaw), c = Math.cos(v.yaw), dx = x - v.x, dz = z - v.z;
  return [dx * c - dz * s, dx * s + dz * c];
}
export function vehicleWorld(v, left, fwd) {
  const s = Math.sin(v.yaw), c = Math.cos(v.yaw);
  return [v.x + left * c + fwd * s, v.z - left * s + fwd * c];
}
// distance from a point to the truck's bodywork (0 if inside its footprint)
export function vehicleGap(v, def, x, z) {
  const [l, f] = vehicleLocal(v, x, z);
  return Math.hypot(Math.max(0, Math.abs(l) - def.w / 2), Math.max(0, Math.abs(f) - def.l / 2));
}
// push a circle out of the truck's footprint; returns the new [x, z], or null if it wasn't touching
export function pushOutOfVehicle(v, def, x, z, r) {
  const [l, f] = vehicleLocal(v, x, z);
  const hl = def.w / 2 + r, hf = def.l / 2 + r;
  if (Math.abs(l) >= hl || Math.abs(f) >= hf) return null;
  const pl = hl - Math.abs(l), pf = hf - Math.abs(f);
  return pl < pf ? vehicleWorld(v, Math.sign(l || 1) * hl, f) : vehicleWorld(v, l, Math.sign(f || 1) * hf);
}

// Veranda railing (wrought iron balusters) with a gap at the front steps, plus columns.
export const VERANDA = (() => {
  const z = HB.z1 + 4.5, h = 1.0, gap = 2.6;
  const rails = [
    { kind: 'railing', x: (HB.x0 - gap) / 2, z, w: -gap - HB.x0, d: 0.2, h },
    { kind: 'railing', x: (HB.x1 + gap) / 2, z, w: HB.x1 - gap, d: 0.2, h },
  ];
  const columns = [HB.x0, -8, -gap, gap, 7, HB.x1].map(x => ({ kind: 'column', x, z, w: 0.45, d: 0.45, h: HOUSE.wallH }));
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
      const td = trailDist(x, z), rd = roadDist(x, z);
      if (td < 4.5 || rd < ROAD_HALF + 3.2) continue;
      const beach = z > sz - SAND_WIDTH;
      const pasture = Math.hypot(x, z * 1.1) < 85;
      let p = beach ? 0.18 : pasture ? 0.05 : 0.62;
      if (td < 9) p *= 0.6;
      if (roll < p) {
        const kind = beach ? 'palm' : kindRoll < 0.38 ? 'palm' : kindRoll < 0.9 ? 'broad' : 'giant';
        TREES.push({ x, z, s: kind === 'giant' ? sc * 1.5 : sc, kind });
      }
      // undergrowth: dense in the jungle, lining the trails
      if (!beach && !pasture && under < 0.75 && roadDist(x + 2.5, z - 2) > ROAD_HALF + 1) UNDERGROWTH.push({ x: x + 2.5, z: z - 2, s: 0.7 + r() * 0.8, kind: r() < 0.5 ? 'fern' : 'shrub', rot: r() * 6.28 });
      if (!beach && !pasture && td < 7 && td > 2.6 && roadDist(x - 2, z + 2.5) > ROAD_HALF + 1) UNDERGROWTH.push({ x: x - 2, z: z + 2.5, s: 0.6 + r() * 0.6, kind: 'fern', rot: r() * 6.28 });
    }
  }
  // palms in the front garden, like the photos
  for (const [x, z, s] of [[-7, 17, 1.2], [7.5, 15.5, 1.1], [-15.6, 10, 1.3], [13, 9, 1.15], [-4, 24, 1.0]]) TREES.push({ x, z, s, kind: 'palm' });
  // big shade trees around the lawn and royal palms down the west side, after the drone photo
  for (const [x, z, kind, s] of [
    [-6, -20, 'giant', 1.3], [7, -25, 'broad', 1.3], [-21, -25, 'giant', 1.4], [22, -30, 'giant', 1.5],
    [-35, -14, 'broad', 1.3], [38, -34, 'giant', 1.4], [31, 12, 'giant', 1.6], [-34, 33, 'giant', 1.4],
    [20, 30, 'broad', 1.2], [-40, 0, 'broad', 1.3], [44, 0, 'broad', 1.3], [2, -36, 'broad', 1.2],
    [-18, 2, 'palm', 1.35], [-19, -6, 'palm', 1.25],
  ]) TREES.push({ x, z, s, kind });
})();

// ---- Zombies machinery ---------------------------------------------------------
// Everything you walk up to and press E at. (x, z) is where it stands on the floor;
// (nx, nz) is the way its front faces, and the player stands in front of it.
// Perks and the upgrade press stay dead until someone throws the generator's switch.
export const POWER = { x: -20.5, z: -16, nx: 1, nz: 0, w: 1.7, d: 0.9 };

// Perks: each player can hold four; going down loses them all.
export const PERKS = {
  jugg:   { name: 'BULL HIDE',      cost: 2500, color: '#c3271c', desc: 'Two and a half times the health' },
  revive: { name: 'SECOND WIND',    cost: 1500, color: '#2f86d4', desc: 'Revive twice as fast. Alone, it gets you back up once' },
  speed:  { name: 'QUICK HANDS',    cost: 3000, color: '#35a843', desc: 'Reload twice as fast' },
  double: { name: 'DOUBLE TEQUILA', cost: 2000, color: '#e4b51e', desc: 'Shoot a third faster and hit a quarter harder' },
  stamin: { name: 'MUSTANG',        cost: 2000, color: '#c0641c', desc: 'Run faster and sprint longer' },
};
export const PERK_LIST = Object.keys(PERKS);
export const MAX_PERKS = 4;
export const PERK_MACHINES = [
  { perk: 'jugg',   x: -7.5,  z: -5.0,  nx: -1, nz: 0 },    // kitchen, in the corner by the door
  { perk: 'revive', x: 10.45, z: 0.4,   nx: -1, nz: 0 },    // sitting room, east wall by the French doors
  { perk: 'speed',  x: 25.45, z: -18,   nx: -1, nz: 0 },    // against the bunkhouse
  { perk: 'double', x: -31,   z: 25.45, nx: 0, nz: 1 },     // in front of the feed store
  { perk: 'stamin', x: -12,   z: -27.0, nx: 0, nz: 1 },     // under the water tank
].map(m => ({ ...m, w: 1.0, d: 0.8 }));

// The mystery box: a random gun for 950. It sits in one spot until it has been used a few
// times, then may come up with a stuffed toy cow instead: your points back, and it moves.
export const BOX = {
  cost: 950, fireSaleCost: 10, roll: 4.2, take: 12, minUses: 5, moveChance: 0.22,
  spots: [
    { x: -11, z: 20, nx: 0, nz: -1 },       // front lawn
    { x: -6, z: -15.6, nx: 0, nz: 1 },      // behind the house
    { x: 38, z: 6, nx: -1, nz: 0 },         // east lawn
    { x: 15.5, z: 157, nx: -1, nz: 0 },     // down on the beach, by the road
  ].map(m => ({ ...m, w: 1.4, d: 0.7 })),
  // weight of each gun in the box (the coconut cannon only ever comes out of it)
  pool: { shotgun: 3, hunting: 3, lmg: 2, rifle: 1, revolver: 1, coconut: 1 },
};
// "El Taller": pay to have the gun in your hands rebuilt: double damage, bigger magazine,
// twice the spare ammo, and a new name.
export const PAP = {
  x: 31, z: -3.4, nx: 0, nz: 1, w: 1.6, d: 1.1, cost: 5000, time: 3.5,
  names: { rifle: 'EL PATRÓN', revolver: 'EL JEFE', shotgun: 'LA MATAVACAS', hunting: 'OJO DE HALCÓN', lmg: 'LA MERA BESTIA', coconut: 'COCO LOCO' },
};
// The electric fence: a switch beside the south gate that electrifies the gateway for a
// while. Anything that walks into it is fried. Players are safe.
export const TRAP = {
  cost: 1000, time: 25, cooldown: 45, damage: 400,  // damage per second
  x: 12.5, z: 39.6, nx: -1, nz: 0, w: 0.4, d: 0.3,   // the switch, just inside the fence
  zone: { x: 2, z: 42, w: 10.4, d: 3.4 },            // the gateway
};
export const USE_RANGE = 1.9;   // how near the front of a machine you must stand

export const STATIONS = [
  { kind: 'power', ...POWER },
  ...PERK_MACHINES.map((m, i) => ({ kind: 'perk', i, ...m })),
  ...BOX.spots.map((m, i) => ({ kind: 'box', i, ...m })),
  { kind: 'pap', ...PAP },
  { kind: 'trap', ...TRAP },
];
// where a player stands to use a station, and the box it occupies on the floor
export const stationSpot = (m) => [m.x + m.nx * (m.d / 2 + 0.7), m.z + m.nz * (m.d / 2 + 0.7)];
export const stationBox = (m) => (m.nx ? { x: m.x, z: m.z, w: m.d, d: m.w } : { x: m.x, z: m.z, w: m.w, d: m.d });

// Effective stats of a gun: upgraded at El Taller, and with the holder's perks.
export function weaponStats(id, upgraded = false, perks = []) {
  const w = WEAPONS[id];
  if (!w) return null;
  const s = { ...w };
  if (upgraded) {
    s.damage *= 2; s.mag = Math.ceil(w.mag * 1.5); s.reserve = w.reserve * 2; s.fireInterval *= 0.9;
    s.name = PAP.names[id] || w.name; s.upgraded = true;
    if (w.projectile) s.projectile = { ...w.projectile, radius: w.projectile.radius * 1.3 };
  }
  if (perks.includes('double')) { s.fireInterval *= 0.75; s.damage *= 1.25; }
  if (perks.includes('speed')) s.reload *= 0.5;
  return s;
}
export const maxHealth = (perks = []) => (perks.includes('jugg') ? 250 : 100);

// All solid boxes. `shoot: true` means bullets pass through (open doors/windows).
export const SOLIDS = (() => {
  const out = [...HOUSE_WALLS, ...FURNITURE, ...UPPER_SOLIDS, ...STRUCTURES.filter(s => !s.open), ...HAY_BALES];
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
  // (heights are from y = 0, so add the ground under the beach box)
  for (const m of STATIONS) if (m.kind !== 'trap') out.push({ kind: 'machine', ...stationBox(m), h: Math.max(0, heightAt(m.x, m.z)) + (m.kind === 'box' ? 0.9 : 2.0) });
  return out;
})();

// Solid parts above head height that only bullets care about: [x0, y0, z0, x1, y1, z1].
const RAY_BOXES = (() => {
  const out = [], wh = HOUSE.wallH;
  for (const p of PORTALS) {
    const hw = p.w / 2 + 0.05, ht = (p.wall ? HOUSE.iw : COLONNADE.size) / 2;
    const [wx, wz] = p.nx === 0 ? [hw, ht] : [ht, hw];
    out.push([p.x - wx, p.wall ? p.top : COLONNADE.spring + 0.45, p.z - wz, p.x + wx, p.ceil ?? wh, p.z + wz]);
  }
  for (const [z0, z1] of [[HOUSE.z - HZ, ARCH_COL.z], [ARCH_COL.z, HOUSE.z + HZ]]) out.push([ARCH_COL.x - 0.3, ARCH_COL.spring + 0.45, z0, ARCH_COL.x + 0.3, wh, z1]);
  return out;
})();

// Players start inside the big room and the hall.
export const PLAYER_SPAWNS = [[-1.5, 5.6], [1.5, 5.5], [-4, 5.6], [-1, 0.6], [2.5, 0.6], [-3.5, -5], [8, 5.8], [-10, 3]];

export function insideHouse(x, z, y = 0) {
  if (levelOf(y)) return x > UPPER.x0 && x < UPPER.x1 && z > UPPER.z0 && z < UPPER.z1;
  return x > HB.x0 && x < HB.x1 && z > HB.z0 && z < HB.z1;
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
// (a box starting above head height, like the ceiling or the upstairs walls when you're
// downstairs, doesn't get in the way)
export const HEADROOM = 1.0;
export function resolveCircle(x, z, r, feetY = 0, step = 0.4, skip = null) {
  for (let iter = 0; iter < 3; iter++) {
    let moved = false;
    for (const b of solidsNear(x, z, r + 1)) {
      if (b.h <= feetY + step || (b.y0 !== undefined && b.y0 >= feetY + HEADROOM) || (skip && skip(b))) continue;
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
      const hit = rayBox(o, d, b.x - b.w / 2, b.y0 || 0, b.z - b.d / 2, b.x + b.w / 2, b.h, b.z + b.d / 2);
      if (hit >= 0 && hit < best) best = hit;
    }
  }
  for (const e of ENTRIES) { // window sills and lintels
    const hw = e.width / 2, ht = HOUSE.t / 2;
    const [wx, wz] = e.nx === 0 ? [hw, ht] : [ht, hw];
    if (e.sill > 0) {
      const t = rayBox(o, d, e.x - wx, e.y, e.z - wz, e.x + wx, e.y + e.sill, e.z + wz);
      if (t >= 0 && t < best) best = t;
    }
    const t = rayBox(o, d, e.x - wx, e.y + e.top, e.z - wz, e.x + wx, e.level ? UPPER.y + UPPER.h : HOUSE.wallH, e.z + wz);
    if (t >= 0 && t < best) best = t;
  }
  if (Math.abs(o[0] - HOUSE.x) < HX + 30 && Math.abs(o[2] - HOUSE.z) < HZ + 30) {
    for (const b of RAY_BOXES) { // walls over the inside doorways and arches, the stair flight
      const t = rayBox(o, d, b[0], b[1], b[2], b[3], b[4], b[5]);
      if (t >= 0 && t < best) best = t;
    }
  }
  if (d[1] > 0 && insideHouse(o[0], o[2], o[1])) {   // the ceilings
    const t = ((levelOf(o[1]) ? UPPER.y + UPPER.h : HOUSE.wallH) - o[1]) / d[1];
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

// `human` types are people, not cattle: the machete-swinging locals who replace the herd on
// round 10, and the round 20 boss, a giant drunk Rafael (three times the height of a cow).
// `hs` scales their hit spheres; `boss` types shrug off insta-kills and can't fit indoors.
export const COW_TYPES = {
  walker: { hp: 100, speed: 3.0, scale: 1.0, radius: 0.8, damage: 14, reach: 2.2, score: 60, tear: 1.5 },
  runner: { hp: 60, speed: 6.0, scale: 0.85, radius: 0.7, damage: 9, reach: 2.0, score: 80, tear: 1.0 },
  bull: { hp: 900, speed: 3.4, scale: 1.55, radius: 1.2, damage: 38, reach: 3.0, score: 500, tear: 0.35, heavy: true },
  local: { hp: 120, speed: 4.3, scale: 1.0, radius: 0.45, damage: 18, reach: 1.9, score: 90, tear: 0.9, human: true, hs: 0.95 },
  rafael: { hp: 9000, speed: 3.3, scale: 2.7, radius: 1.5, damage: 50, reach: 4.4, score: 5000, tear: 0.5, human: true, hs: 2.7, heavy: true, boss: true },
};
export const COW_TYPE_LIST = ['walker', 'runner', 'bull', 'local', 'rafael'];
export const LOCALS_WAVE = 10;   // the locals attack instead of the herd
export const BOSS_WAVE = 20;     // Rafael. After that it's back to the herd, bigger every round
// Rafael lobs his empties: they land where you were standing when he threw
export const BOTTLE = { every: 3.2, minDist: 6, maxDist: 55, radius: 3.2, damage: 32 };

// The ranch dogs: two big red-brown dogs (Jack, Mateo) and the little fluffy one (Taco)
// fight on your side, going after any cow near the players, through the doors if the
// cow is on the other side of the walls. Pepper, a sleek black lab mix, wants nothing
// to do with any of it: she runs into the house and hides under her blanket (`hider`).
// `coat` tints the shared dog model on the client ([r, g, b] multiplier, optional).
export const DOG_TYPES = [
  { kind: 'big', name: 'Jack', hp: 90, speed: 7.5, sight: 30, bite: 1.0, damage: 7, biteEvery: 0.9, radius: 0.4 },
  { kind: 'big', name: 'Mateo', hp: 90, speed: 7.2, sight: 30, bite: 1.0, damage: 7, biteEvery: 0.95, radius: 0.4, coat: [0.82, 0.74, 0.7] },
  { kind: 'little', name: 'Taco', hp: 45, speed: 8.0, sight: 24, bite: 0.7, damage: 3, biteEvery: 0.6, radius: 0.28 },
  { kind: 'big', name: 'Pepper', hp: 90, speed: 7.8, sight: 30, bite: 1.0, damage: 7, biteEvery: 0.85, radius: 0.38, coat: [0.075, 0.11, 0.16], sleek: true, scale: 0.92, hider: true },
];
// Pepper's blanket: in the corner of Troy's office, behind the desk.
export const BLANKET = { x: 10.35, z: -8.35, yaw: Math.PI * 0.75 };

// Furniture the game draws from its own models (decoration: no collision beyond FURNITURE).
// The Blender light bake loads them too, so their shadows land on the floor.
// [model, x, z, yaw (0 faces +z), height, tint?]
export const HOUSE_PROPS = (() => {
  const out = [];
  const dt = FURNITURE.find(f => f.kind === 'dining');
  for (let i = 0; i < 9; i++) {      // twenty carved chairs round the long table
    const x = dt.x - dt.w / 2 + 0.35 + i * (dt.w - 0.7) / 8;
    out.push(['diningChair', x, dt.z - dt.d / 2 - 0.3, 0, 1.18], ['diningChair', x, dt.z + dt.d / 2 + 0.3, Math.PI, 1.18]);
  }
  out.push(['diningChair', dt.x - dt.w / 2 - 0.36, dt.z, Math.PI / 2, 1.22], ['diningChair', dt.x + dt.w / 2 + 0.36, dt.z, -Math.PI / 2, 1.22]);
  const ct = FURNITURE.find(f => f.kind === 'coffee');   // six cane rockers round the coffee table
  for (const [dx, dz, yaw] of [[-0.65, -1.35, 0.25], [0.65, -1.35, -0.25], [1.75, -0.45, -Math.PI / 2 + 0.25], [1.75, 0.7, -Math.PI / 2 - 0.2], [0.0, 1.55, Math.PI + 0.1], [1.2, 1.5, Math.PI + 0.35]]) out.push(['caneRocker', ct.x + dx, ct.z + dz, yaw, 1.05]);
  const kt = FURNITURE.find(f => f.kind === 'ktable');   // kitchen chairs, green and natural, like the real ones
  for (const [dx, dz, yaw, tint] of [[-0.35, -0.65, 0, [0.5, 0.68, 0.56]], [0.35, -0.65, 0, [1.05, 0.95, 0.8]], [-0.35, 0.65, Math.PI, [1.05, 0.95, 0.8]], [0.35, 0.65, Math.PI, [0.5, 0.68, 0.56]], [-0.95, 0.05, Math.PI / 2, [0.5, 0.68, 0.56]]]) out.push(['xchair', kt.x + dx, kt.z + dz, yaw, 0.92, tint]);
  const dk = FURNITURE.find(f => f.kind === 'desk');     // bentwood chairs at Troy's desk
  out.push(['xchair', dk.x - 0.4, dk.z + 0.75, Math.PI, 0.92, [0.95, 0.85, 0.7]], ['xchair', dk.x + 0.55, dk.z + 0.8, Math.PI + 0.35, 0.92, [0.95, 0.85, 0.7]]);
  out.push(['pot', -12.3, 6.3, 0, 1.0], ['pot', 10.3, 6.35, 0, 1.0], ['pot', -7.6, 6.3, 0, 0.85], ['pot', 3.9, -1.6, 0, 0.9]);
  return out;
})();
// Ceiling fans (they spin, with a warm light under each) and the hanging iron lanterns and
// the stairwell chandelier (lights only: the fittings are in the house model).
// ([x, z, ceiling height]; downstairs the ceiling is HOUSE.wallH)
export const HOUSE_FANS = [[-3.6, 3.0], [0.1, 3.0], [7.7, 3.6], [-10, 3.2], [7.8, -5.0], [-10, -6.4], [-4.0, -2.6, 7.4], [1.5, -2.8, 7.4]];
export const HOUSE_LIGHTS = [[-1.5, 2.3, -8.3], [-4.5, 2.95, -3.0], [1.5, 2.95, -3.0], [-10, 2.95, -2.5], [6.3, 2.95, 0.1]];

export const DOG_LEASH = 32; // dogs only chase cows this close to a player

// Hit spheres for a cow at (x,z) facing yaw. Index 0 is the head.
// `rear` lifts the front end (used while climbing through a window).
// Hit spheres for a cow at (x,z) facing yaw, matched to the Brahman model
// (2.7 m nose to rump, head ~1.55 m forward, back ~1.55 m high). Index 0 is the head.
export function cowHitSpheres(type, x, z, yaw, y = 0) {
  const def = COW_TYPES[type];
  if (def.human) { // a standing person: head, chest, belly, hips, thighs, shins
    const k = def.hs;
    const up = (h, r, head) => ({ x, y: y + h * k, z, r: r * k, head });
    return [up(1.6, 0.15, true), up(1.3, 0.25), up(1.02, 0.24), up(0.76, 0.22), up(0.46, 0.19), up(0.18, 0.16)];
  }
  const s = def.scale;
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
  // the wonder weapon (mystery box only): lobs coconuts that burst on impact
  coconut:  { name: 'COCONUT CANNON', damage: 650, headMult: 1.0, fireInterval: 0.85, auto: false, mag: 3, reserve: 24, reload: 2.6, pellets: 1, hip: 0.02, ads: 0.004, range: 120, zoom: 62, projectile: { speed: 40, gravity: 9, radius: 5.5 } },
};
export const WEAPON = WEAPONS.rifle; // kept for older code paths
export const START_WEAPONS = ['rifle', 'revolver'];
export const START_POINTS = 500;

// Wall-buy stations: walk up, hold E. Buying a gun you already own refills its ammo for half.
export const WALL_BUYS = [
  { weapon: 'shotgun', cost: 500,  x: -7.25, z: 4.0,  nx: -1, nz: 0 },   // bar room, on the wall to the big room
  { weapon: 'hunting', cost: 1000, x: 25.7,  z: -10,  nx: -1, nz: 0 },   // outside the bunkhouse
  { weapon: 'lmg',     cost: 2000, x: -25.7, z: 22,   nx: 1,  nz: 0 },   // outside the feed store
];
export const BUY_RANGE = 2.2;

export const MELEE = { damage: 150, range: 2.4, interval: 0.55 };
export const GRENADE = { fuse: 2.2, radius: 7, damage: 480, perWave: 2, max: 4 };
export const POWERUP_TYPES = ['maxammo', 'instakill', 'double', 'nuke', 'carpenter', 'firesale'];
export const POWERUP_CHANCE = 0.045;
export const POWERUP_TIME = 30;
export const REPAIR_TIME = 0.7;
export const REPAIR_RANGE = 2.4;
