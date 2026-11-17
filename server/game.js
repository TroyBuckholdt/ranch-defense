// Authoritative game simulation for one room: cows, waves, boards, health, revives, scoring.
//
// Cow behaviour (open world):
//   - Every cow hunts the nearest living player, following a distance field that routes
//     around trees, buildings, the yard wall and the sea.
//   - Open doors/windows (no boards left) are part of the route: cows climb through them.
//   - If the player is sealed inside, cows go to the nearest door/window, tear the boards
//     off (swiping at anyone standing right behind it), then climb in.
//   - Players can walk through doors whatever the boards (the client handles that).
import {
  MAP_HALF, SOLIDS, ENTRIES, MAX_BOARDS, PLAYER_SPAWNS, COW_TYPES, WEAPONS, START_WEAPONS, START_POINTS, WALL_BUYS, BUY_RANGE,
  MELEE, GRENADE, POWERUP_TYPES, POWERUP_CHANCE, POWERUP_TIME, REPAIR_TIME, REPAIR_RANGE,
  resolveCircle, raySolids, raySphere, cowHitSpheres, insideHouse, heightAt, shoreZ, solidsNear, playerPassable, DOG_TYPES, DOG_LEASH, BLANKET, PORTALS, indoorWaypoint,
  groundHeight, levelOf, UPPER, STAIRS, inPond, roundTwist, GOLD, BLOAT, STAMPEDE, COW_TYPE_LIST, LOCALS_WAVE, BOSS_WAVE, BOTTLE,
  VEHICLES, VEHICLE_SEATS, ENTER_RANGE, DRIVE, vehicleLocal, vehicleWorld, vehicleGap, pushOutOfVehicle,
  POWER, PERKS, PERK_MACHINES, MAX_PERKS, BOX, PAP, TRAP, USE_RANGE, stationSpot, weaponStats, maxHealth,
} from '../shared/world.js';

const TICK = 1 / 20;
const INTERMISSION = 15;
const FIRST_WAVE_DELAY = +process.env.RD_FIRST_WAVE_DELAY || 10; // (override to look around in peace when testing)
const GAMEOVER_TIME = 9;
const BLEEDOUT = 30;
const REVIVE_TIME = 3;
const VAULT_TIME = 1.1;
const MAX_ALIVE_COWS = 40;
const MAX_ALIVE_PEOPLE = 18;   // people are heavier to draw than cows
const START_SCORE = +process.env.RD_START_POINTS || START_POINTS; // (for testing the machines)
const START_WAVE = Math.max(1, parseInt(process.env.RD_START_WAVE || '1', 10) || 1); // for testing later rounds

// ---- Path grid ------------------------------------------------------------
// Two layers: the whole map at ground level on a 1 m grid, and the upper floor and the flat
// roof on a finer 0.5 m grid (indoors is tight). The two stairs join them.
const CELL = 1;
const GRID = Math.ceil((MAP_HALF * 2) / CELL);
const N = GRID * GRID;
const toCell = (v) => Math.max(0, Math.min(GRID - 1, Math.floor((v + MAP_HALF) / CELL)));
const cellOf = (x, z) => toCell(z) * GRID + toCell(x);
const NEIGH = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
const L1 = { x0: -16, z0: -13, cs: 0.5, w: 60, d: 44 };   // x -16..14, z -13..9
const N1 = L1.w * L1.d, NT = N + N1;
const cell1 = (x, z) => {
  const cx = Math.floor((x - L1.x0) / L1.cs), cz = Math.floor((z - L1.z0) / L1.cs);
  return cx < 0 || cz < 0 || cx >= L1.w || cz >= L1.d ? -1 : N + cz * L1.w + cx;
};
const nodeOf = (x, z, y = 0) => { if (levelOf(y)) { const c = cell1(x, z); if (c >= 0) return c; } return cellOf(x, z); };
const nodeCentre = (i) => i < N
  ? [((i % GRID) + 0.5) * CELL - MAP_HALF, (((i / GRID) | 0) + 0.5) * CELL - MAP_HALF]
  : [L1.x0 + (((i - N) % L1.w) + 0.5) * L1.cs, L1.z0 + ((((i - N) / L1.w) | 0) + 0.5) * L1.cs];
// the stairs: walking a flight joins its foot (ground layer) to its head (upper layer)
const stairAt = (x, z) => STAIRS.find(st => x > st.x0 - 0.05 && x < st.x1 + 0.05 && z > st.z0 && z < st.z1) || null;
const LINKS = new Map();   // node -> [[node, cost]]
for (const st of STAIRS) {
  st.footNode = cellOf(...st.foot); st.headNode = cell1(...st.head);
  const cost = Math.round((st.x1 - st.x0 + 1.3) * 12);
  for (const [a, b] of [[st.footNode, st.headNode], [st.headNode, st.footNode]]) { if (!LINKS.has(a)) LINKS.set(a, []); LINKS.get(a).push([b, cost]); }
}

const baseBlocked = new Uint8Array(NT);
(() => {
  // ground layer: everything standing on the ground (not the floors and walls upstairs)
  const inflate = 0.6; // roughly a cow's collision radius
  for (const b of SOLIDS) {
    if (b.h <= 0.4 || b.nav === false || (b.y0 || 0) >= 1.6) continue;
    const x0 = toCell(b.x - b.w / 2 - inflate), x1 = toCell(b.x + b.w / 2 + inflate);
    const z0 = toCell(b.z - b.d / 2 - inflate), z1 = toCell(b.z + b.d / 2 + inflate);
    for (let gz = z0; gz <= z1; gz++) for (let gx = x0; gx <= x1; gx++) baseBlocked[gz * GRID + gx] = 1;
  }
  // the sea
  for (let gz = 0; gz < GRID; gz++) for (let gx = 0; gx < GRID; gx++) {
    const x = (gx + 0.5) * CELL - MAP_HALF, z = (gz + 0.5) * CELL - MAP_HALF;
    if (z > shoreZ(x) - 1 || inPond(x, z)) baseBlocked[gz * GRID + gx] = 1;   // and the pond
  }
  // upper layer: open only where there's floor at the upper level, minus what stands on it
  const U = UPPER.y;
  for (let i = N; i < NT; i++) {
    const [x, z] = nodeCentre(i);
    baseBlocked[i] = solidsNear(x, z, 0.5).some(b => Math.abs(b.h - U) < 0.06 && Math.abs(x - b.x) < b.w / 2 && Math.abs(z - b.z) < b.d / 2) ? 0 : 1;
  }
  const inf1 = 0.3;
  for (const b of SOLIDS) {
    if ((b.y0 || 0) >= U + 1.6 || b.h <= U + 0.4 || b.nav === false) continue;
    if (b.x + b.w / 2 < L1.x0 || b.x - b.w / 2 > L1.x0 + L1.w * L1.cs || b.z + b.d / 2 < L1.z0 || b.z - b.d / 2 > L1.z0 + L1.d * L1.cs) continue;
    for (let x = b.x - b.w / 2 - inf1; x < b.x + b.w / 2 + inf1 + L1.cs; x += L1.cs) for (let z = b.z - b.d / 2 - inf1; z < b.z + b.d / 2 + inf1 + L1.cs; z += L1.cs) {
      const c = cell1(Math.min(x, b.x + b.w / 2 + inf1), Math.min(z, b.z + b.d / 2 + inf1));
      if (c >= 0) baseBlocked[c] = 1;
    }
  }
  // the doorways and arches between rooms: a corridor straight through each one
  for (const p of PORTALS) for (let t = -1.4; t <= 1.4; t += 0.2) {
    if (p.level) for (const l of [-0.2, 0.2]) { const c = cell1(p.x + p.nx * t + p.nz * l, p.z + p.nz * t + p.nx * l); if (c >= 0) baseBlocked[c] = 0; }
    else baseBlocked[cellOf(p.x + p.nx * t, p.z + p.nz * t)] = 0;
  }
  // and the ends of the stairs (the foot of the inside one is tucked in a corner)
  for (const st of STAIRS) {
    for (let t = 0; t <= 2.6; t += 0.25) baseBlocked[cellOf(st.foot[0] - t * 0.3, st.foot[1] + (st === STAIRS[0] ? t : -t))] = 0;
    baseBlocked[st.footNode] = 0;
    for (let t = 0; t <= 0.6; t += 0.2) { const c = cell1(st.head[0] + t, st.head[1]); if (c >= 0) baseBlocked[c] = 0; }
  }
})();

// a corridor through each door/window, open only when it has no boards
const entryCells = ENTRIES.map(e => {
  const cells = new Set();
  for (let t = -1.0; t <= 1.0; t += 0.2) {
    if (e.level) for (const l of [-0.2, 0.2]) { const c = cell1(e.x + e.nx * t + e.nz * l, e.z + e.nz * t + e.nx * l); if (c >= 0) cells.add(c); }
    else cells.add(cellOf(e.x + e.nx * t, e.z + e.nz * t));
  }
  return [...cells];
});

// Dial's algorithm (bucketed Dijkstra) with integer costs in tenths of a metre.
// Searches out to `maxDist` metres only; cows always spawn well inside that.
const blockedBuf = new Uint8Array(NT);
const DX = [1, -1, 0, 0, 1, 1, -1, -1], DZ = [0, 0, 1, -1, 1, -1, 1, -1], DC = [10, 10, 10, 10, 14, 14, 14, 14], DC1 = [5, 5, 5, 5, 7, 7, 7, 7];
const NB = 256; // bucket ring size > the dearest edge (a whole flight of stairs)
const bucketQ = Array.from({ length: NB }, () => []);

// a source at a point; on a stair, both its ends (each by how far along the flight it is)
function sourceNodes(x, z, y, c0 = 0) {
  const st = stairAt(x, z);
  if (st) { const k = (x - st.x0) / (st.x1 - st.x0); return [[st.footNode, c0 + k * 8], [st.headNode, c0 + (1 - k) * 8]]; }
  return [[nodeOf(x, z, y), c0]];
}

function buildField(sources, boards, maxDist = 130) {
  blockedBuf.set(baseBlocked);
  ENTRIES.forEach((e, i) => { const open = boards[i] === 0; for (const c of entryCells[i]) blockedBuf[c] = open ? 0 : 1; });
  const dist = new Float32Array(NT).fill(Infinity);
  const di = new Int32Array(NT).fill(0x7fffffff);
  const limit = maxDist * 10;
  let pending = 0;
  for (const [x, z, c0 = 0, y = 0] of sources) {
    for (const [i, c] of sourceNodes(x, z, y, c0)) {
      const d = Math.round(c * 10);
      if (d < di[i]) { di[i] = d; bucketQ[d % NB].push(i); pending++; }
    }
  }
  for (let cur = 0; pending > 0 && cur <= limit; cur++) {
    const bucket = bucketQ[cur % NB];
    while (bucket.length) {
      const i = bucket.pop(); pending--;
      if (di[i] !== cur) continue; // stale entry
      dist[i] = cur / 10;
      const relax = (n, cost) => { const nd = cur + cost; if (nd < di[n]) { di[n] = nd; bucketQ[nd % NB].push(n); pending++; } };
      if (i < N) {
        const cx = i % GRID, cz = (i / GRID) | 0;
        for (let k = 0; k < 8; k++) {
          const nx = cx + DX[k], nz = cz + DZ[k];
          if (nx < 0 || nz < 0 || nx >= GRID || nz >= GRID) continue;
          const n = nz * GRID + nx;
          if (blockedBuf[n]) continue;
          if (k >= 4 && (blockedBuf[cz * GRID + nx] || blockedBuf[nz * GRID + cx])) continue;
          relax(n, DC[k]);
        }
      } else {
        const j = i - N, cx = j % L1.w, cz = (j / L1.w) | 0;
        for (let k = 0; k < 8; k++) {
          const nx = cx + DX[k], nz = cz + DZ[k];
          if (nx < 0 || nz < 0 || nx >= L1.w || nz >= L1.d) continue;
          const n = N + nz * L1.w + nx;
          if (blockedBuf[n]) continue;
          if (k >= 4 && (blockedBuf[N + cz * L1.w + nx] || blockedBuf[N + nz * L1.w + cx])) continue;
          relax(n, DC1[k]);
        }
      }
      const links = LINKS.get(i);
      if (links) for (const [n, cost] of links) relax(n, cost);
    }
  }
  for (const b of bucketQ) b.length = 0;
  return dist;
}

const toward = (x, z, tx, tz) => { const vx = tx - x, vz = tz - z, l = Math.hypot(vx, vz) || 1; return [vx / l, vz / l]; };

// Which way to walk to go downhill in a field, from a point at height y. On a stair: up or
// down it, whichever end is nearer the goal; at the foot or head of one: onto it if that's
// the way.
function fieldDir(dist, x, z, y = 0) {
  const st = stairAt(x, z);
  if (st) {
    const up = dist[st.headNode] < dist[st.footNode];
    return toward(x, z, up ? st.head[0] : st.foot[0] - 0.4, st.zm);
  }
  const i = nodeOf(x, z, y);
  let best = dist[i], bn = -1;
  const upper = i >= N;
  const [cx, cz] = upper ? [(i - N) % L1.w, ((i - N) / L1.w) | 0] : [i % GRID, (i / GRID) | 0];
  for (const [dx, dz] of NEIGH) {
    const nx = cx + dx, nz = cz + dz;
    if (upper ? (nx < 0 || nz < 0 || nx >= L1.w || nz >= L1.d) : (nx < 0 || nz < 0 || nx >= GRID || nz >= GRID)) continue;
    const n = upper ? N + nz * L1.w + nx : nz * GRID + nx;
    if (dist[n] < best) { best = dist[n]; bn = n; }
  }
  for (const st2 of STAIRS) {   // the stair from here beats the floor around it
    const end = upper ? st2.headNode : st2.footNode, other = upper ? st2.footNode : st2.headNode;
    if (Math.hypot(...nodeCentre(end).map((v, k) => v - [x, z][k])) < 1.2 && dist[other] + 4 < best) {
      return toward(x, z, upper ? st2.x1 - 0.3 : st2.x0 + 0.3, st2.zm);
    }
  }
  if (bn < 0) return null;
  return toward(x, z, ...nodeCentre(bn));
}

// true if nothing solid (taller than a step) sits on the straight line between two points
function clearLine(x0, z0, x1, z1, pad = 0.5, y = 0) {
  const len = Math.hypot(x1 - x0, z1 - z0), n = Math.ceil(len / 0.5);
  for (let i = 1; i < n; i++) {
    const x = x0 + (x1 - x0) * i / n, z = z0 + (z1 - z0) * i / n;
    for (const b of solidsNear(x, z, 1)) {
      if (b.h > y + 0.4 && (b.y0 || 0) < y + 1.0 && Math.abs(x - b.x) < b.w / 2 + pad && Math.abs(z - b.z) < b.d / 2 + pad) return false;
    }
  }
  return true;
}

const isOpenLand = (x, z) => !baseBlocked[cellOf(x, z)] && z < shoreZ(x) - 6 && !(insideHouse(x, z) || stairAt(x, z));

// ---- Room ----

export class Room {
  constructor(code, onEmpty) {
    this.code = code;
    this.onEmpty = onEmpty;
    this.players = new Map();
    this.cows = new Map();
    this.nextCowId = 1;
    this.time = 0;
    this.reset();
    this.interval = setInterval(() => this.step(), TICK * 1000);
  }

  reset() {
    this.wave = START_WAVE - 1;
    this.phase = 'intermission';
    this.timer = FIRST_WAVE_DELAY;
    this.toSpawn = [];
    this.twist = ''; this.blasts = []; this.stampedeDir = 0;
    this.spawnTimer = 0;
    this.cows.clear();
    this.nades = []; this.powerups = []; this.bottles = []; this.instakill = 0; this.doublePts = 0;
    this.power = false; this.fireSale = 0; this.shells = [];
    this.box = { spot: 0, state: 'idle', t: 0, weapon: null, by: 0, uses: 0, paid: 0 };
    this.pap = { state: 'idle', t: 0, by: 0, weapon: null };
    this.trap = { on: 0, cool: 0, by: 0 };
    this.vehicles = VEHICLES.map(d => ({ id: d.id, def: d, x: d.x, z: d.z, yaw: d.yaw, speed: 0, steer: 0, seats: [0, 0, 0, 0] }));
    for (const p of this.players.values()) { p.veh = 0; p.seat = 0; }
    this.boards = ENTRIES.map(() => MAX_BOARDS);
    this.vaulting = ENTRIES.map(() => 0);
    this.dogs = DOG_TYPES.map((d, i) => ({ id: i + 1, kind: d.kind, x: -4 + i * 3, z: 9, yaw: 0, hp: d.hp, state: 0, downT: 0, biteCd: 0, target: null, wander: Math.random() * 6 }));
    this.nades = [];
    this.powerups = [];
    this.nextPowerId = 1;
    this.instakill = 0;
    this.doublePts = 0;
    this.playerField = null; this.playerAge = 99;
    this.entryField = null; this.entryAge = 99;
    let i = 0;
    for (const p of this.players.values()) this.respawn(p, i++);
  }

  respawn(p, idx = this.players.size) {
    this.leaveVehicle(p, false);
    const [sx, sz] = PLAYER_SPAWNS[idx % PLAYER_SPAWNS.length];
    Object.assign(p, {
      x: sx, y: 0, z: sz, yaw: Math.PI, pitch: 0,
      hp: maxHealth(p.perks), downed: false, dead: false, bleed: 0, revive: 0, lastHurt: -99, repairT: 0, selfRevive: false,
    });
  }

  addPlayer(id, name, send, char = 'p1') {
    const p = { id, name, send, char, score: START_SCORE, kills: 0, using: false, lastShot: 0, lastMelee: 0, weapons: [...START_WEAPONS], cur: 0, grenades: GRENADE.perWave, perks: [], upg: [] };
    this.respawn(p);
    if (this.phase === 'wave' && [...this.players.values()].some(o => !o.dead && !o.downed)) {
      p.dead = true; p.hp = 0;
    }
    this.players.set(id, p);
    this.broadcastEvent({ t: 'chat', k: '{0} joined the ranch', a: [name], msg: `${name} joined the ranch` });
    return p;
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.leaveVehicle(p, false);
    this.players.delete(id);
    this.broadcastEvent({ t: 'chat', k: '{0} left the ranch', a: [p.name], msg: `${p.name} left` });
    if (this.players.size === 0) {
      clearInterval(this.interval);
      this.onEmpty(this.code);
    }
  }

  // ---- messages from a client ----
  onState(p, m) {
    if (p.downed || p.dead) { p.using = false; return; }
    const nx = +m.p?.[0], ny = +m.p?.[1], nz = +m.p?.[2];
    if (![nx, ny, nz].every(Number.isFinite)) return;
    p.yaw = +m.yaw || 0;
    if (p.veh) { // riding: the truck carries them (and the driver's client steers the truck)
      p.pitch = +m.pitch || 0; p.using = false;
      const v = this.vehicles.find(o => o.id === p.veh);
      if (v && p.seat === 0 && Array.isArray(m.v)) {
        const [vx, vz, vyaw, vsp, vst] = m.v.map(Number);
        if ([vx, vz, vyaw, vsp].every(Number.isFinite) && Math.hypot(vx - v.x, vz - v.z) < 5) {
          v.x = vx; v.z = vz; v.yaw = vyaw; v.speed = Math.max(-DRIVE.reverse - 2, Math.min(DRIVE.max + 2, vsp)); v.steer = Math.max(-1, Math.min(1, vst || 0));
        }
      }
      return;
    }
    if (Math.hypot(nx - p.x, nz - p.z) < 6) { p.x = nx; p.y = ny; p.z = nz; }
    p.pitch = +m.pitch || 0;
    p.using = !!m.use;
  }

  // ---- the trucks ----
  onVehicle(p, m) {
    if (m.a === 'out') { this.leaveVehicle(p, true); return; }
    if (p.downed || p.dead || p.veh) return;
    const v = this.vehicles.find(o => o.id === (m.id | 0));
    if (!v || vehicleGap(v, v.def, p.x, p.z) > ENTER_RANGE + 0.6) return;
    const seat = v.seats.indexOf(0);       // first free seat: the wheel if nobody has it
    if (seat < 0) return;
    v.seats[seat] = p.id; p.veh = v.id; p.seat = seat;
    this.seatPlayer(v, p);
  }

  seatPlayer(v, p) {
    const [l, f, h] = VEHICLE_SEATS[p.seat];
    [p.x, p.z] = vehicleWorld(v, l, f);
    p.y = heightAt(p.x, p.z) + h;
  }

  leaveVehicle(p, stepOut) {
    if (!p.veh || !this.vehicles) { p.veh = 0; return; }
    const v = this.vehicles.find(o => o.id === p.veh);
    p.veh = 0;
    if (!v) return;
    const seat = v.seats.indexOf(p.id);
    if (seat >= 0) v.seats[seat] = 0;
    if (seat === 0) { v.speed = 0; v.steer = 0; }
    if (!stepOut) return;
    // step out on their own side, clear of the bodywork and of any wall
    const [l, f] = VEHICLE_SEATS[Math.max(0, seat)];
    const side = Math.sign(l) * (v.def.w / 2 + 0.85);
    let [x, z] = vehicleWorld(v, side, seat >= 2 ? -v.def.l / 2 - 0.85 : f);
    [x, z] = resolveCircle(x, z, 0.4, 0, 0.45, playerPassable);
    p.x = x; p.z = z; p.y = heightAt(x, z);
  }

  // Riders move with their truck. A moving truck bowls cows over (and loses speed doing it);
  // nothing alive is allowed to end up standing inside one.
  updateVehicles(dt) {
    for (const v of this.vehicles) {
      for (let i = 0; i < v.seats.length; i++) {
        const p = v.seats[i] && this.players.get(v.seats[i]);
        if (!p || p.downed || p.dead) { if (p) this.leaveVehicle(p, true); else v.seats[i] = 0; continue; }
        this.seatPlayer(v, p);
      }
      const driver = this.players.get(v.seats[0]);
      if (!driver) v.speed = 0;
      const sp = Math.abs(v.speed), fs = Math.sin(v.yaw) * Math.sign(v.speed || 1), fc = Math.cos(v.yaw) * Math.sign(v.speed || 1);
      for (const c of this.cows.values()) {
        if (c.state === 'dead' || c.state === 'vault') continue;
        const def = COW_TYPES[c.type], r = Math.min(1, def.radius) * 0.6;
        if (Math.abs(c.x - v.x) > 6 || Math.abs(c.z - v.z) > 6) continue;
        const out = pushOutOfVehicle(v, v.def, c.x, c.z, r);
        if (!out) continue;
        if (driver && sp > 2.5 && this.time > (c.ramAt || 0)) {
          c.ramAt = this.time + 0.7;
          // anything short of a bull dies under the wheels at more than a crawl; bulls and
          // Rafael take a heavy hit and stop the truck
          const dmg = def.heavy ? sp * (def.boss ? 45 : 70) : sp > 4.5 ? c.hp + 1 : sp * 40;
          this.damageCow(driver, c, dmg, false, [c.x, 1, c.z], [fs, 0.2, fc]);
          this.sendTo(driver, { t: 'ram', k: def.boss ? 0 : def.heavy ? 0.35 : c.state === 'dead' ? 0.9 : 0.8 });
          if (!def.heavy) { out[0] += fs * 1.2; out[1] += fc * 1.2; }
        }
        const [nx, nz] = resolveCircle(out[0], out[1], r, c.y, 0.45);
        if (insideHouse(nx, nz, c.y) === insideHouse(c.x, c.z, c.y)) { c.x = nx; c.z = nz; }
      }
    }
  }

  stats(p, id) { return weaponStats(id, p.upg.includes(id), p.perks); }

  // within reach of a machine's front?
  near(p, m) { const [x, z] = stationSpot(m); return Math.hypot(p.x - x, p.z - z) < USE_RANGE + 0.6; }
  deny(p, why, cost = 0) { this.sendTo(p, { t: 'denied', why, cost }); }
  pay(p, cost) { if (p.score < cost) { this.deny(p, 'points', cost); return false; } p.score -= cost; return true; }

  // ---- the generator ----
  onPower(p) {
    if (p.downed || p.dead || this.power || !this.near(p, POWER)) return;
    this.power = true;
    this.broadcastEvent({ t: 'power', by: p.name });
  }

  // ---- perk machines ----
  onPerk(p, m) {
    const mc = PERK_MACHINES[m.i | 0];
    if (!mc || p.downed || p.dead || !this.near(p, mc)) return;
    const def = PERKS[mc.perk];
    if (!this.power) return this.deny(p, 'power');
    if (p.perks.includes(mc.perk)) return this.deny(p, 'have');
    if (p.perks.length >= MAX_PERKS) return this.deny(p, 'full');
    if (!this.pay(p, def.cost)) return;
    p.perks.push(mc.perk);
    if (mc.perk === 'jugg') p.hp = maxHealth(p.perks);
    this.sendTo(p, { t: 'perk', perk: mc.perk });
    this.broadcastEvent({ t: 'drink', id: p.id, perk: mc.perk }, p.id);
  }

  // ---- the mystery box ----
  onBox(p, m) {
    const b = this.box, spot = BOX.spots[b.spot];
    if (p.downed || p.dead || !this.near(p, spot)) return;
    if (b.state === 'ready' && b.by === p.id) { // take the gun
      this.giveWeapon(p, b.weapon, m.slot);
      this.sendTo(p, { t: 'bought', w: b.weapon, weapons: p.weapons, ammo: false, box: true });
      b.state = 'idle'; b.weapon = null; b.by = 0;
      return;
    }
    if (b.state !== 'idle') return;
    const cost = this.fireSale > 0 ? BOX.fireSaleCost : BOX.cost;
    if (!this.pay(p, cost)) return;
    b.uses++; b.paid = cost; b.by = p.id; b.state = 'rolling'; b.t = BOX.roll;
    if (this.fireSale <= 0 && b.uses > BOX.minUses && Math.random() < BOX.moveChance) b.weapon = 'teddy';
    else { // a gun you don't already have, weighted
      const pool = Object.entries(BOX.pool).filter(([id]) => !p.weapons.includes(id));
      let r = Math.random() * pool.reduce((a, [, wt]) => a + wt, 0);
      b.weapon = pool.find(([, wt]) => (r -= wt) < 0)?.[0] || pool[0][0];
    }
    this.broadcastEvent({ t: 'box', s: 'roll', by: p.id });
  }

  giveWeapon(p, id, slot) {
    if (p.weapons.includes(id)) return;
    if (p.weapons.length < 2) p.weapons.push(id);
    else p.weapons[Math.max(0, Math.min(1, slot | 0))] = id;
    p.upg = p.upg.filter(w => p.weapons.includes(w)); // a gun you put down loses its upgrade
    p.cur = p.weapons.indexOf(id);
  }

  updateBox(dt) {
    const b = this.box;
    if (b.state === 'idle') return;
    b.t -= dt;
    if (b.t > 0) return;
    if (b.state === 'rolling' && b.weapon === 'teddy') { // the toy cow: money back, and it moves
      const p = this.players.get(b.by);
      if (p) p.score += b.paid;
      b.state = 'moving'; b.t = 3.5;
      this.broadcastEvent({ t: 'box', s: 'teddy', by: b.by });
    } else if (b.state === 'rolling') { b.state = 'ready'; b.t = BOX.take; }
    else if (b.state === 'moving') {
      const others = BOX.spots.map((_, i) => i).filter(i => i !== b.spot);
      b.spot = others[Math.floor(Math.random() * others.length)];
      b.uses = 0; b.state = 'idle'; b.weapon = null; b.by = 0;
      this.broadcastEvent({ t: 'box', s: 'moved', spot: b.spot });
    } else { b.state = 'idle'; b.weapon = null; b.by = 0; }   // nobody took it
  }

  // ---- El Taller: upgrade the gun in your hands ----
  onPap(p, m) {
    const w = m.w, pp = this.pap;
    if (p.downed || p.dead || !this.near(p, PAP) || !p.weapons.includes(w)) return;
    if (!this.power) return this.deny(p, 'power');
    if (pp.state !== 'idle') return this.deny(p, 'busy');
    if (p.upg.includes(w)) return this.deny(p, 'done');
    if (!this.pay(p, PAP.cost)) return;
    Object.assign(pp, { state: 'working', t: PAP.time, by: p.id, weapon: w });
    this.broadcastEvent({ t: 'pap', s: 'start', by: p.id, w });
  }

  updatePap(dt) {
    const pp = this.pap;
    if (pp.state !== 'working' || (pp.t -= dt) > 0) return;
    const p = this.players.get(pp.by);
    if (p && p.weapons.includes(pp.weapon) && !p.upg.includes(pp.weapon)) {
      p.upg.push(pp.weapon);
      this.broadcastEvent({ t: 'pap', s: 'done', by: p.id, w: pp.weapon });
    }
    pp.state = 'idle'; pp.by = 0; pp.weapon = null;
  }

  // ---- the electric fence ----
  onTrap(p) {
    const tr = this.trap;
    if (p.downed || p.dead || !this.near(p, TRAP)) return;
    if (tr.on > 0 || tr.cool > 0) return this.deny(p, 'busy');
    if (!this.pay(p, TRAP.cost)) return;
    tr.on = TRAP.time; tr.by = p.id;
    this.broadcastEvent({ t: 'trap', on: true, by: p.name });
  }

  updateTrap(dt) {
    const tr = this.trap, z = TRAP.zone;
    if (tr.on <= 0) { tr.cool = Math.max(0, tr.cool - dt); return; }
    tr.on -= dt;
    if (tr.on <= 0) { tr.cool = TRAP.cooldown; this.broadcastEvent({ t: 'trap', on: false }); }
    for (const c of this.cows.values()) {
      if (c.state === 'dead' || Math.abs(c.x - z.x) > z.w / 2 || Math.abs(c.z - z.z) > z.d / 2) continue;
      const def = COW_TYPES[c.type];
      c.hp -= TRAP.damage * dt * (def.boss ? 0.25 : 1);
      if (!def.heavy) c.stagger = 0.15;
      if (c.hp > 0) continue;
      this.killCow(c);
      const by = this.players.get(tr.by);
      if (by) by.kills += 1;
      this.broadcastEvent({ t: 'hit', cow: c.id, p: [c.x, 1, c.z], d: [0, 1, 0], head: false, kill: true, by: 0 });
    }
  }

  // ---- coconuts in flight ----
  updateShells(dt) {
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const sh = this.shells[i];
      let hit = false;
      for (let k = 0; k < 2 && !hit; k++) {   // two substeps: they are quick
        const h = dt / 2;
        sh.vy -= sh.g * h;
        const o = [sh.x, sh.y, sh.z], step = [sh.vx * h, sh.vy * h, sh.vz * h], len = Math.hypot(...step);
        const dir = step.map(v => v / len);
        const wall = raySolids(o, dir, len);
        if (wall < len) { sh.x += dir[0] * wall; sh.y += dir[1] * wall; sh.z += dir[2] * wall; hit = true; break; }
        sh.x += step[0]; sh.y += step[1]; sh.z += step[2];
        if (sh.y < heightAt(sh.x, sh.z) + 0.1) hit = true;
        for (const c of this.cows.values()) {
          if (hit || c.state === 'dead' || Math.abs(c.x - sh.x) > 8 || Math.abs(c.z - sh.z) > 8) continue;
          for (const sp of cowHitSpheres(c.type, c.x, c.z, c.yaw, c.y + heightAt(c.x, c.z))) {
            if (Math.hypot(sp.x - sh.x, sp.y - sh.y, sp.z - sh.z) < sp.r + 0.2) { hit = true; break; }
          }
        }
      }
      sh.t -= dt;
      if (!hit && sh.t > 0) continue;
      this.shells.splice(i, 1);
      const owner = this.players.get(sh.owner);
      for (const c of this.cows.values()) {
        if (c.state === 'dead') continue;
        const dist = Math.hypot(c.x - sh.x, c.z - sh.z);
        if (dist < sh.r) this.damageCow(owner, c, sh.dmg * (1 - (dist / sh.r) * 0.6), false, [c.x, 1, c.z], [c.x - sh.x, 0.4, c.z - sh.z]);
      }
      this.broadcastEvent({ t: 'boom', p: [sh.x, sh.y, sh.z], coco: true });
    }
  }

  award(p, n) { p.score += n * (this.doublePts > 0 ? 2 : 1); }

  // a shot from weapon m.w; shotguns send several pellet directions in m.ds
  onShoot(p, m) {
    if (p.downed || p.dead || (p.veh && p.seat === 0)) return; // hands on the wheel
    if (!WEAPONS[m.w] || !p.weapons.includes(m.w)) return;
    const w = this.stats(p, m.w);
    if (this.time - p.lastShot < w.fireInterval * 0.8) return;
    p.lastShot = this.time;
    p.cur = p.weapons.indexOf(m.w);
    if (!Array.isArray(m.o)) return;
    const o = m.o.slice(0, 3).map(Number);
    if (!o.every(Number.isFinite) || Math.hypot(o[0] - p.x, o[2] - p.z) > 3) return;
    const dirs = (Array.isArray(m.ds) ? m.ds : [m.d]).slice(0, w.pellets).filter(Array.isArray);
    this.broadcastEvent({ t: 'fx', id: p.id, w: m.w, o, d: dirs[0] }, p.id);
    if (w.projectile) { // a coconut, lobbed: it bursts on whatever it hits
      const d = (dirs[0] || []).slice(0, 3).map(Number);
      const l = Math.hypot(...d);
      if (!d.every(Number.isFinite) || !l) return;
      const v = w.projectile.speed / l;
      this.shells.push({ id: this.nextPowerId++, x: o[0], y: o[1], z: o[2], vx: d[0] * v, vy: d[1] * v, vz: d[2] * v, t: 3, owner: p.id, dmg: w.damage, r: w.projectile.radius, g: w.projectile.gravity });
      return;
    }
    for (const d0 of dirs) {
      const dn = d0.slice(0, 3).map(Number);
      if (!dn.every(Number.isFinite)) continue;
      const l = Math.hypot(...dn) || 1;
      this.hitscan(p, o, dn.map(v => v / l), w);
    }
  }

  hitscan(p, o, d, w) {
    const wallDist = raySolids(o, d, w.range);
    let best = null;
    for (const c of this.cows.values()) {
      if (c.state === 'dead') continue;
      const ox = c.x - o[0], oz = c.z - o[2];
      if (ox * d[0] + oz * d[2] < -3 || ox * ox + oz * oz > w.range * w.range) continue;
      for (const sp of cowHitSpheres(c.type, c.x, c.z, c.yaw, c.y + heightAt(c.x, c.z))) {
        const t = raySphere(o, d, sp.x, sp.y, sp.z, sp.r);
        if (t >= 0 && t < wallDist && (!best || t < best.t)) best = { t, c, head: !!sp.head };
      }
    }
    if (!best) return;
    const { c, head, t } = best;
    const falloff = w.pellets > 1 ? Math.max(0.35, 1 - t / w.range) : 1;
    this.damageCow(p, c, w.damage * falloff * (head ? w.headMult : 1), head, [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t], d);
  }

  damageCow(p, c, dmg, head, hit, d) {
    if (c.state === 'dead') return;
    if (p) c.lastHitBy = p.id;
    c.hp -= this.instakill > 0 ? (COW_TYPES[c.type].boss ? dmg * 3 : c.hp) : dmg;
    if (p) this.award(p, 10);
    let kill = false;
    if (c.hp <= 0) {
      kill = true;
      this.killCow(c);
      if (COW_TYPES[c.type].boss) this.taunt(c, 'death');
      if (p) { p.kills += 1; this.award(p, COW_TYPES[c.type].score + (head ? 50 : 0)); }
      if (COW_TYPES[c.type].flee) {
        // the golden cow: everyone gets paid, the one who got her gets more, and a power-up drops
        for (const q of this.players.values()) this.award(q, GOLD.reward);
        if (p) this.award(p, GOLD.killerBonus);
        this.dropPowerup(c.x, c.z, ['firesale', 'maxammo', 'double', 'instakill'][Math.floor(Math.random() * 4)]);
        this.broadcastEvent({ t: 'gold', k: 'caught', by: p ? p.name : '' });
      } else if (Math.random() < POWERUP_CHANCE) this.dropPowerup(c.x, c.z);
    } else if (!COW_TYPES[c.type].heavy && c.state !== 'vault') {
      c.stagger = 0.22;
    } else if (COW_TYPES[c.type].boss && c.tauntCd < 3 && (head || dmg > 150) && Math.random() < 0.5) {
      this.taunt(c, 'hurt');
    }
    this.broadcastEvent({ t: 'hit', cow: c.id, p: hit, d, head, kill, by: p ? p.id : 0 });
  }

  onMelee(p, m) {
    if (p.downed || p.dead || this.time - p.lastMelee < MELEE.interval) return;
    p.lastMelee = this.time;
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    let best = null, bd = MELEE.range;
    for (const c of this.cows.values()) {
      if (c.state === 'dead') continue;
      const dx = c.x - p.x, dz = c.z - p.z, dist = Math.hypot(dx, dz) - COW_TYPES[c.type].radius * 0.6;
      if (dist < bd && (dx * fx + dz * fz) / (Math.hypot(dx, dz) || 1) > 0.4) { bd = dist; best = c; }
    }
    this.broadcastEvent({ t: 'swing', id: p.id }, p.id);
    if (best) this.damageCow(p, best, MELEE.damage, false, [best.x, p.y + 1.2, best.z], [fx, 0, fz]);
  }

  onNade(p, m) {
    if (p.downed || p.dead || p.grenades <= 0) return;
    const o = (m.o || []).slice(0, 3).map(Number), v = (m.v || []).slice(0, 3).map(Number);
    if (![...o, ...v].every(Number.isFinite) || Math.hypot(o[0] - p.x, o[2] - p.z) > 3) return;
    const vl = Math.hypot(...v), k = vl > 22 ? 22 / vl : 1;
    p.grenades -= 1;
    this.nades.push({ id: this.nextPowerId++, x: o[0], y: o[1], z: o[2], vx: v[0] * k, vy: v[1] * k, vz: v[2] * k, t: GRENADE.fuse, owner: p.id });
  }

  onBuy(p, m) {
    if (p.downed || p.dead) return;
    const st = WALL_BUYS[m.s | 0];
    if (!st || Math.hypot(p.x - st.x, p.z - st.z) > BUY_RANGE + 0.5) return;
    const owned = p.weapons.includes(st.weapon);
    const cost = owned ? Math.round(st.cost / 2) : st.cost;
    if (p.score < cost) { this.sendTo(p, { t: 'buyfail', cost }); return; }
    p.score -= cost;
    if (!owned) this.giveWeapon(p, st.weapon, m.slot);
    this.sendTo(p, { t: 'bought', w: st.weapon, weapons: p.weapons, ammo: owned });
  }

  dropPowerup(x, z, type = POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)]) {
    this.powerups.push({ id: this.nextPowerId++, type, x, z, t: 25 });
  }

  updateExtras(dt, alive) {
    this.instakill = Math.max(0, this.instakill - dt);
    this.doublePts = Math.max(0, this.doublePts - dt);
    this.fireSale = Math.max(0, this.fireSale - dt);
    for (let i = this.powerups.length - 1; i >= 0; i--) {
      const pu = this.powerups[i];
      pu.t -= dt;
      const taker = alive.find(p => Math.hypot(p.x - pu.x, p.z - pu.z) < 1.8);
      if (!taker && pu.t > 0) continue;
      this.powerups.splice(i, 1);
      if (!taker) continue;
      if (pu.type === 'instakill') this.instakill = POWERUP_TIME;
      if (pu.type === 'double') this.doublePts = POWERUP_TIME;
      if (pu.type === 'nuke') {
        for (const c of this.cows.values()) if (c.state !== 'dead') {
          if (COW_TYPES[c.type].boss) this.damageCow(null, c, c.maxHp * 0.2, false, [c.x, 3, c.z], [0, 1, 0]); else this.killCow(c);
        }
        for (const p of this.players.values()) this.award(p, 400);
      }
      if (pu.type === 'maxammo') for (const p of this.players.values()) p.grenades = Math.min(GRENADE.max, p.grenades + 1);
      if (pu.type === 'carpenter') { // every barricade back up, and points for it
        this.boards = this.boards.map(() => MAX_BOARDS);
        this.entryAge = this.playerAge = 99;
        for (const p of this.players.values()) this.award(p, 200);
      }
      if (pu.type === 'firesale') this.fireSale = POWERUP_TIME; // the box costs 10 and stays put
      this.broadcastEvent({ t: 'powerup', type: pu.type, by: taker.name });
    }
    for (let i = this.nades.length - 1; i >= 0; i--) {
      const n = this.nades[i];
      n.t -= dt;
      n.vy -= 18 * dt;
      let nx = n.x + n.vx * dt, ny = n.y + n.vy * dt, nz = n.z + n.vz * dt;
      const g = heightAt(nx, nz);
      if (ny < g + 0.08) { ny = g + 0.08; n.vy = Math.abs(n.vy) * 0.35; n.vx *= 0.6; n.vz *= 0.6; }
      const [rx, rz] = resolveCircle(nx, nz, 0.08, ny, 0.1);
      if (rx !== nx || rz !== nz) { n.vx *= -0.4; n.vz *= -0.4; }
      n.x = rx; n.y = ny; n.z = rz;
      if (n.t > 0) continue;
      this.nades.splice(i, 1);
      const owner = this.players.get(n.owner);
      for (const c of this.cows.values()) {
        if (c.state === 'dead') continue;
        const dist = Math.hypot(c.x - n.x, c.z - n.z);
        if (dist < GRENADE.radius) this.damageCow(owner, c, GRENADE.damage * (1 - dist / GRENADE.radius * 0.7), false, [c.x, 1, c.z], [c.x - n.x, 0.3, c.z - n.z]);
      }
      this.broadcastEvent({ t: 'boom', p: [n.x, n.y, n.z] });
    }
  }

  // Rafael never shuts up. The client holds the lines; we pick which kind and which one so
  // everyone in the room hears the same thing.
  taunt(c, kind) {
    c.tauntCd = 4.5 + Math.random() * 3.5;
    this.broadcastEvent({ t: 'taunt', cow: c.id, k: kind, i: Math.floor(Math.random() * 1000) });
  }

  bossTaunt(c, dt) {
    c.tauntCd -= dt;
    if (c.tauntCd > 0) return;
    this.taunt(c, c.tauntKind || 'rant');
    c.tauntKind = null;
  }

  // Rafael throws his empty at whoever he's after when they're out of arm's reach, indoors
  // or up on something. It lands where they were standing, so keep moving.
  bossThrow(c, target, td, dt) {
    c.throwCd -= dt;
    if (c.throwCd > 0 || td < BOTTLE.minDist || td > BOTTLE.maxDist || c.stagger > 0) return;
    c.throwCd = BOTTLE.every * (0.8 + Math.random() * 0.5);
    const time = 1.0 + td / 28;
    const to = [target.x + (Math.random() - 0.5) * 1.5, target.z + (Math.random() - 0.5) * 1.5];
    this.bottles.push({ x: to[0], z: to[1], t: time });
    this.broadcastEvent({ t: 'bottle', cow: c.id, to, time: Math.round(time * 100) / 100 });
    if (Math.random() < 0.6) this.taunt(c, 'throw');
  }

  updateBottles(dt) {
    for (let i = this.bottles.length - 1; i >= 0; i--) {
      const b = this.bottles[i];
      b.t -= dt;
      if (b.t > 0) continue;
      this.bottles.splice(i, 1);
      for (const p of this.players.values()) {
        const d = Math.hypot(p.x - b.x, p.z - b.z);
        if (d < BOTTLE.radius) this.hurtPlayer(p, Math.round(BOTTLE.damage * (1 - 0.6 * d / BOTTLE.radius)), b);
      }
      this.broadcastEvent({ t: 'smash', p: [Math.round(b.x * 100) / 100, Math.round(b.z * 100) / 100] });
    }
  }

  killCow(c, by = null) {
    c.hp = 0;
    c.state = 'dead';
    c.deadAt = this.time;
    if (c.bomb) { c.bomb = false; this.blasts.push({ x: c.x, y: c.y, z: c.z, t: BLOAT.delay, by: by || c.lastHitBy || null }); }
    if (c.entry != null && this.vaulting[c.entry] === c.id) this.vaulting[c.entry] = 0;
  }

  // ---- simulation ----
  step() {
    const dt = TICK;
    this.time += dt;
    const players = [...this.players.values()];
    const alive = players.filter(p => !p.downed && !p.dead);

    if (this.phase === 'intermission') {
      this.timer -= dt;
      if (this.timer <= 0 && players.length) this.startWave();
    } else if (this.phase === 'wave') {
      // (someone getting back up on their own still counts)
      if (players.length && !players.some(p => !p.dead && (!p.downed || p.selfRevive))) {
        this.phase = 'gameover';
        this.timer = GAMEOVER_TIME;
        this.broadcastEvent({ t: 'gameover', wave: this.wave });
      } else if (this.toSpawn.length === 0 && [...this.cows.values()].every(c => c.state === 'dead')) {
        this.phase = 'intermission';
        this.timer = INTERMISSION;
        let i = 0;
        for (const p of players) if (p.dead || p.downed) this.respawn(p, i++);
        for (const d of this.dogs) { d.hp = DOG_TYPES[d.id - 1].hp; if (d.state === 3) d.state = 0; }
        for (const p of players) p.grenades = Math.min(GRENADE.max, p.grenades + GRENADE.perWave);
        this.broadcastEvent({ t: 'waveclear', wave: this.wave });
      }
    } else if (this.phase === 'gameover') {
      this.timer -= dt;
      if (this.timer <= 0) {
        for (const p of players) { p.score = START_SCORE; p.kills = 0; p.weapons = [...START_WEAPONS]; p.cur = 0; p.grenades = GRENADE.perWave; p.perks = []; p.upg = []; }
        this.reset();
        this.broadcastEvent({ t: 'restart' });
      }
    }

    this.spawnCows(dt, alive);
    this.updatePlayers(dt, players, alive);
    this.updateCows(dt, alive);
    this.updateDogs(dt, alive);
    this.updateVehicles(dt);
    this.updateExtras(dt, alive);
    this.updateBox(dt); this.updatePap(dt); this.updateTrap(dt); this.updateShells(dt);
    this.updateBottles(dt);
    this.updateBlasts(dt);
    this.broadcastSnapshot();
  }

  startWave() {
    this.wave += 1;
    this.phase = 'wave';
    const n = this.wave;
    const pc = Math.max(1, this.players.size);
    const count = Math.round((6 + n * 3) * (1 + 0.45 * (pc - 1)));
    let list = [], kind = '';
    const herd = (k, localChance) => {
      for (let i = 0; i < k; i++) {
        const runnerChance = n < 3 ? 0 : Math.min(0.45, 0.1 + n * 0.03);
        list.push(Math.random() < localChance ? 'local' : Math.random() < runnerChance ? 'runner' : 'walker');
      }
    };
    if (n === BOSS_WAVE) {
      // Rafael comes out of the jungle first, with a smaller mixed crowd around him
      kind = 'boss';
      herd(Math.round(count * 0.45), 0.35);
      list.splice(1, 0, 'rafael');
    } else if (n === LOCALS_WAVE) {
      kind = 'locals';
      herd(Math.round(count * 0.75), 1);
    } else {
      herd(count, 0);
      if (n % 5 === 0) for (let i = 0; i < 1 + Math.floor(n / 10); i++) list.splice(Math.floor(list.length / 2), 0, 'bull');
    }
    const twist = kind ? '' : roundTwist(n);
    this.twist = twist;
    this.blasts = [];
    if (twist === 'stampede') {
      // the whole herd at once, from one side, all runners
      list = list.map(() => 'runner');
      for (let i = 0; i < Math.round(list.length * 0.25); i++) list.push('runner');
      this.stampedeDir = Math.random() * Math.PI * 2;
    }
    if (twist === 'gold') list.splice(Math.min(3, list.length), 0, 'gold');
    this.toSpawn = list;
    this.spawnTimer = 2;
    this.broadcastEvent({ t: 'wave', wave: n, count: list.length, kind, twist });
  }

  // Cows stagger out of the jungle 45-75 m from a random player, never right on top of anyone.
  findSpawn(alive) {
    for (let tries = 0; tries < 40; tries++) {
      const anchor = alive[Math.floor(Math.random() * alive.length)];
      // a stampede comes from one side; if that side is the sea, it swings round as it retries
      const a = this.twist === 'stampede' ? this.stampedeDir + (Math.random() - 0.5) * STAMPEDE.spread + tries * 0.15 : Math.random() * Math.PI * 2;
      const r = 45 + Math.random() * 30;
      const x = anchor.x + Math.cos(a) * r, z = anchor.z + Math.sin(a) * r;
      if (Math.abs(x) > MAP_HALF - 3 || Math.abs(z) > MAP_HALF - 3) continue;
      if (!isOpenLand(x, z) || insideHouse(x, z)) continue;
      if (alive.some(p => Math.hypot(p.x - x, p.z - z) < 38)) continue;
      return [x, z];
    }
    return null;
  }

  spawnCows(dt, alive) {
    if (this.phase !== 'wave' || !this.toSpawn.length || !alive.length) return;
    this.spawnTimer -= dt;
    const living = [...this.cows.values()].filter(c => c.state !== 'dead').length;
    if (this.spawnTimer > 0 || living >= MAX_ALIVE_COWS) return;
    if (COW_TYPES[this.toSpawn[0]].human && [...this.cows.values()].filter(c => c.state !== 'dead' && COW_TYPES[c.type].human).length >= MAX_ALIVE_PEOPLE) return;
    const spot = this.findSpawn(alive);
    if (!spot) return;
    this.spawnTimer = this.twist === 'stampede' ? STAMPEDE.every : Math.max(0.35, 1.6 - this.wave * 0.1);
    const type = this.toSpawn.shift();
    const [x, z] = spot;
    const def = COW_TYPES[type];
    // the boss doesn't scale with the round number, only with how many are fighting him
    let hp = def.boss ? Math.round(def.hp * (1 + 0.4 * (this.players.size - 1)))
      : def.flee ? Math.round(def.hp * (1 + 0.25 * (this.players.size - 1)))
      : Math.round(def.hp * (1 + (this.wave - 1) * 0.09));
    if (this.twist === 'stampede') hp = Math.round(hp * STAMPEDE.hp);
    const id = this.nextCowId++;
    this.cows.set(id, {
      id, type, x, y: 0, z, yaw: Math.random() * 6.28, hp, maxHp: hp, state: 'walk',
      entry: null, tearT: def.tear, vaultT: 0,
      attackCd: 0, stagger: 0, speedMul: (0.85 + Math.random() * 0.3) * (this.twist === 'stampede' ? STAMPEDE.speed : 1), deadAt: 0, throwCd: 5, tauntCd: 1.5, tauntKind: 'spawn',
      bomb: this.twist === 'bomb' && !def.heavy && !def.human && !def.flee, born: this.time,
    });
    if (def.flee) this.broadcastEvent({ t: 'gold', k: 'loose' });
  }

  updatePlayers(dt, players, alive) {
    for (const p of players) {
      if (p.downed) {
        p.bleed -= dt;
        const helper = p.selfRevive ? null : alive.find(a => a.using && Math.hypot(a.x - p.x, a.z - p.z) < 2.6);
        if (p.selfRevive) { // Second Wind, alone: back up on your own in four seconds
          p.revive += dt * REVIVE_TIME / 4;
          if (p.revive >= REVIVE_TIME) {
            p.downed = false; p.selfRevive = false; p.hp = 50; p.revive = 0; p.lastHurt = this.time;
            this.broadcastEvent({ t: 'chat', k: '{0} got back up', a: [p.name], msg: `${p.name} got back up` });
          }
        } else if (helper) {
          helper.reviving = true;
          p.revive += dt * (helper.perks.includes('revive') ? 2 : 1);
          if (p.revive >= REVIVE_TIME) {
            p.downed = false; p.hp = 50; p.revive = 0; p.lastHurt = this.time;
            this.award(helper, 150);
            this.broadcastEvent({ t: 'chat', k: '{0} revived {1}', a: [helper.name, p.name], msg: `${helper.name} revived ${p.name}` });
          }
        } else {
          p.revive = Math.max(0, p.revive - dt * 2);
        }
        if (p.bleed <= 0 && p.downed && !p.selfRevive) {
          p.downed = false; p.dead = true;
          this.broadcastEvent({ t: 'chat', k: '{0} bled out', a: [p.name], msg: `${p.name} bled out` });
        }
      } else if (!p.dead && p.hp < maxHealth(p.perks) && this.time - p.lastHurt > 4) {
        p.hp = Math.min(maxHealth(p.perks), p.hp + 25 * dt * (p.perks.includes('jugg') ? 2 : 1));
      }
    }
    for (const p of alive) {
      const busyReviving = p.reviving;
      p.reviving = false;
      if (!p.using || busyReviving) { p.repairT = 0; continue; }
      const e = this.nearestRepairable(p);
      if (!e) { p.repairT = 0; continue; }
      p.repairT += dt;
      if (p.repairT >= REPAIR_TIME) {
        p.repairT = 0;
        this.boards[e.id] += 1;
        this.award(p, 10);
        this.entryAge = this.playerAge = 99;
        this.broadcastEvent({ t: 'board', e: e.id, n: this.boards[e.id], add: 1, by: p.id });
      }
    }
  }

  nearestRepairable(p) {
    let best = null, bd = REPAIR_RANGE;
    for (const e of ENTRIES) {
      if (this.boards[e.id] >= MAX_BOARDS || this.vaulting[e.id]) continue;
      const d = Math.hypot(p.x - (e.x - e.nx * 0.8), p.z - (e.z - e.nz * 0.8));
      if (d < bd && Math.abs((p.y || 0) - e.y) < 1.5) { bd = d; best = e; }
    }
    return best;
  }

  updateCows(dt, alive) {
    this.playerAge += dt;
    this.entryAge += dt;
    if (alive.length && (this.playerAge > 0.6 || !this.playerField)) {
      this.playerField = buildField(alive.map(p => [p.x, p.z, 0, p.y || 0]), this.boards);
      this.playerAge = 0;
    }
    else if (this.entryAge > 1.2 || !this.entryField) {
      this.entryField = buildField(ENTRIES.map(e => [e.out[0], e.out[1], this.boards[e.id] * 2.5, e.y]), this.boards, 110);
      this.entryAge = 0;
    }

    const cows = [...this.cows.values()];
    for (const c of cows) {
      if (c.state === 'dead') {
        if (this.time - c.deadAt > 8) this.cows.delete(c.id);
        continue;
      }
      const def = COW_TYPES[c.type];
      c.attackCd -= dt;
      if (c.state === 'vault') { this.updateVault(c, dt); continue; }
      if (c.stagger > 0) { c.stagger -= dt; continue; }

      let target = null, td = Infinity, best = Infinity;
      for (const p of alive) {   // nearest player, counting a floor between as a long way round
        const d = Math.hypot(p.x - c.x, p.z - c.z), k = d + Math.abs((p.y || 0) - c.y) * 2;
        if (k < best) { best = k; td = d; target = p; }
      }
      if (!target) { c.state = 'walk'; continue; }
      if (def.flee) { this.fleeCow(c, target, td, cows, dt); continue; }
      if (def.boss) { this.bossThrow(c, target, td, dt); this.bossTaunt(c, dt); }
      const ty = target.y || 0, sameFloor = levelOf(c.y) === levelOf(ty);
      const cIn = insideHouse(c.x, c.z, c.y), tIn = insideHouse(target.x, target.z, ty);

      // a dog snapping at its legs gets the horns first
      const pest = levelOf(c.y) === 0 && this.dogs.find(d => d.state !== 3 && !DOG_TYPES[d.id - 1].hider && Math.hypot(d.x - c.x, d.z - c.z) < def.reach * 0.8 && insideHouse(d.x, d.z) === insideHouse(c.x, c.z));
      if (pest && Math.random() < 0.5) {
        c.state = 'attack';
        c.yaw = turnToward(c.yaw, Math.atan2(pest.x - c.x, pest.z - c.z), dt * 8);
        if (c.attackCd <= 0) { c.attackCd = 1.2; this.hurtDog(pest, def.damage); }
        continue;
      }

      // attack: same side of the walls, or reaching through the opening it's at
      const throughOpening = c.entry != null && Math.hypot(target.x - ENTRIES[c.entry].x, target.z - ENTRIES[c.entry].z) < 1.6 && Math.abs(ty - ENTRIES[c.entry].y) < 1.5;
      const standingHigh = ty - c.y > 1.9 * def.scale || c.y - ty > 1.2;
      if (td < def.reach && !standingHigh && (cIn === tIn || throughOpening)) {
        c.state = 'attack';
        c.yaw = turnToward(c.yaw, Math.atan2(target.x - c.x, target.z - c.z), dt * 8);
        if (c.attackCd <= 0) {
          c.attackCd = def.boss ? 2.0 : c.type === 'bull' ? 1.6 : def.human ? 0.9 : 1.1;
          this.hurtPlayer(target, def.damage, c);
        }
        continue;
      }

      // on opposite sides of the walls: use an open door/window, or make one
      if (cIn !== tIn) {
        // standing at an opening on my side?
        if (c.entry == null) {
          for (const e of ENTRIES) {
            const spot = cIn ? e.in : e.out;
            if (Math.hypot(spot[0] - c.x, spot[1] - c.z) < 1.6 && Math.abs(c.y - e.y) < 1.2) { c.entry = e.id; c.tearT = def.tear; break; }
          }
        }
        if (c.entry != null) { this.workEntry(c, cIn, cows, dt); continue; }
        const routed = this.playerField[nodeOf(c.x, c.z, c.y)] < Infinity || !!stairAt(c.x, c.z);
        const field = routed ? this.playerField : cIn ? this.entryField : this.entryField;
        let dir = field && fieldDir(field, c.x, c.z, c.y);
        if (!dir) { // inside with no open route: head for the nearest door/window on this floor
          const mine = ENTRIES.filter(e => e.level === levelOf(c.y));
          const e = (mine.length ? mine : ENTRIES).reduce((a, b) => (Math.hypot(b.in[0] - c.x, b.in[1] - c.z) < Math.hypot(a.in[0] - c.x, a.in[1] - c.z) ? b : a));
          const spot = cIn ? indoorWaypoint(c.x, c.z, e.in[0], e.in[1], c.y) : e.out, l = Math.hypot(spot[0] - c.x, spot[1] - c.z) || 1;
          dir = [(spot[0] - c.x) / l, (spot[1] - c.z) / l];
        }
        c.state = 'walk';
        this.moveCow(c, dir, cows, dt);
        continue;
      }

      // same side: chase
      c.entry = null;
      c.state = 'walk';
      const direct = td < 5 && sameFloor && !stairAt(c.x, c.z) && clearLine(c.x, c.z, target.x, target.z, 0.5, c.y);
      let dir = direct ? [(target.x - c.x) / td, (target.z - c.z) / td] : fieldDir(this.playerField, c.x, c.z, c.y);
      if (!dir) dir = [(target.x - c.x) / td, (target.z - c.z) / td];
      this.moveCow(c, dir, cows, dt);
    }
  }

  // At a door/window, on side `cIn`: tear boards until it's open, then climb through.
  workEntry(c, cIn, cows, dt) {
    const def = COW_TYPES[c.type];
    const e = ENTRIES[c.entry];
    const spot = cIn ? e.in : e.out;
    const dSpot = Math.hypot(spot[0] - c.x, spot[1] - c.z);
    if (dSpot > 0.4) this.moveCow(c, [(spot[0] - c.x) / dSpot, (spot[1] - c.z) / dSpot], cows, dt, 0.6);
    const face = cIn ? 1 : -1;
    c.yaw = turnToward(c.yaw, Math.atan2(face * e.nx, face * e.nz), dt * 6);
    if (this.boards[e.id] > 0) {
      c.state = 'tear';
      c.tearT -= dt;
      if (c.tearT <= 0) {
        c.tearT = def.tear * (0.8 + Math.random() * 0.4);
        const n = def.heavy ? this.boards[e.id] : 1;
        this.boards[e.id] -= n;
        this.entryAge = this.playerAge = 99;
        this.broadcastEvent({ t: 'board', e: e.id, n: this.boards[e.id], add: -n });
      }
    } else if (!def.boss && !this.vaulting[e.id] && dSpot < 1.3) {
      c.state = 'vault';
      c.vaultT = 0;
      c.vaultFrom = [c.x, c.z];
      c.vaultTo = cIn ? e.out : e.in;
      this.vaulting[e.id] = c.id;
    } else {
      c.state = 'tear';
    }
  }

  updateVault(c, dt) {
    const e = ENTRIES[c.entry];
    c.vaultT += dt / (VAULT_TIME * (c.type === 'runner' || c.type === 'local' ? 0.7 : 1));
    const k = Math.min(1, c.vaultT);
    c.x = c.vaultFrom[0] + (c.vaultTo[0] - c.vaultFrom[0]) * k;
    c.z = c.vaultFrom[1] + (c.vaultTo[1] - c.vaultFrom[1]) * k;
    c.y = e.y + Math.sin(k * Math.PI) * (e.sill + 0.35);
    c.yaw = Math.atan2(c.vaultTo[0] - c.vaultFrom[0], c.vaultTo[1] - c.vaultFrom[1]);
    if (k >= 1) {
      c.y = e.y;
      c.state = 'walk';
      this.vaulting[e.id] = 0;
      c.entry = null;
    }
  }

  // The golden cow: away from the nearest player, steering off the walls, the sea and the map
  // edge, ambling when nobody's close. After GOLD.escape seconds she's gone.
  fleeCow(c, target, td, cows, dt) {
    if (this.time - c.born > GOLD.escape) {
      this.killCow(c);
      c.deadAt = this.time - 7.5;   // vanish, no carcass
      this.broadcastEvent({ t: 'gold', k: 'gone' });
      return;
    }
    if (td > 40) { // grazing: wander slowly
      c.state = 'walk';
      c.wander = (c.wander ?? c.yaw) + (Math.random() - 0.5) * dt * 1.5;
      this.moveCow(c, [Math.sin(c.wander), Math.cos(c.wander)], cows, dt, 0.25);
      return;
    }
    let best = null, bestK = -Infinity;
    const away = Math.atan2(c.x - target.x, c.z - target.z);
    for (let i = -7; i <= 7; i++) {   // try headings either side of straight away (wide enough to run along a wall)
      const a = away + i * 0.35, fx = Math.sin(a), fz = Math.cos(a);
      const lx = c.x + fx * 6, lz = c.z + fz * 6;
      let k = -Math.abs(i) * 0.4;
      if (Math.abs(lx) > MAP_HALF - 12 || Math.abs(lz) > MAP_HALF - 12 || lz > shoreZ(lx) - 8) k -= 10;
      if (inPond(lx, lz) || insideHouse(lx, lz) || !clearLine(c.x, c.z, lx, lz, 0.7, 0)) k -= 6;
      for (const p of this.players.values()) if (!p.dead && Math.hypot(p.x - lx, p.z - lz) < 8) k -= 4;
      if (k > bestK) { bestK = k; best = [fx, fz]; }
    }
    c.state = 'walk';
    this.moveCow(c, best, cows, dt, td < 15 ? 1 : 0.7);
  }

  // bloated cows burst a moment after they die: players nearby get hurt, cows nearby take a
  // big hit (and may burst in turn)
  updateBlasts(dt) {
    for (let i = this.blasts.length - 1; i >= 0; i--) {
      const b = this.blasts[i];
      b.t -= dt;
      if (b.t > 0) continue;
      this.blasts.splice(i, 1);
      const by = b.by != null ? this.players.get(b.by) || null : null;
      for (const c of this.cows.values()) {
        if (c.state === 'dead') continue;
        const d = Math.hypot(c.x - b.x, c.z - b.z);
        if (d < BLOAT.radius && Math.abs(c.y - b.y) < 2) this.damageCow(by, c, BLOAT.cowDamage * (1 - d / BLOAT.radius * 0.5), false, [c.x, 1, c.z], [c.x - b.x, 0.3, c.z - b.z]);
      }
      for (const p of this.players.values()) {
        const d = Math.hypot(p.x - b.x, p.z - b.z);
        if (d < BLOAT.playerRadius && Math.abs((p.y || 0) - b.y) < 2) this.hurtPlayer(p, BLOAT.playerDamage * (1 - d / BLOAT.playerRadius * 0.6), b);
      }
      this.broadcastEvent({ t: 'boom', p: [b.x, b.y + 0.8, b.z], gas: true });
    }
  }

  moveCow(c, dir, cows, dt, speedMul = 1) {
    const def = COW_TYPES[c.type];
    const cIn = insideHouse(c.x, c.z, c.y);
    let sx = 0, sz = 0;
    for (const o of cows) {
      if (o === c || o.state === 'dead' || o.state === 'vault' || Math.abs(o.y - c.y) > 1.5) continue;
      const dx = c.x - o.x, dz = c.z - o.z;
      if (Math.abs(dx) > 3 || Math.abs(dz) > 3) continue;
      const d2 = dx * dx + dz * dz;
      const minD = (def.radius + COW_TYPES[o.type].radius) * 0.9;
      if (d2 < minD * minD && d2 > 1e-6) { const d = Math.sqrt(d2); sx += (dx / d) * (minD - d); sz += (dz / d) * (minD - d); }
    }
    let speed = def.speed * c.speedMul * speedMul * (cIn ? 0.85 : 1);
    if (def.boss) { // drunk: he lurches, and weaves either side of where he means to go
      const a = Math.sin(this.time * 0.8 + c.id) * 0.55 + Math.sin(this.time * 2.1 + c.id * 3) * 0.2;
      const cs = Math.cos(a), sn = Math.sin(a);
      dir = [dir[0] * cs - dir[1] * sn, dir[0] * sn + dir[1] * cs];
      speed *= 0.75 + 0.45 * Math.sin(this.time * 1.7 + c.id * 2);
    }
    const r = Math.min(cIn ? 0.6 : 0.85, def.radius * 0.7);
    const stepTo = (dx, dz) => resolveCircle(c.x + dx * speed * dt + sx * 0.4, c.z + dz * speed * dt + sz * 0.4, r, c.y, 0.45);
    const turn = (a) => { const cs = Math.cos(a), sn = Math.sin(a); return [dir[0] * cs - dir[1] * sn, dir[0] * sn + dir[1] * cs]; };
    // walked head-on into a table or a chair: walk round it for a moment, keeping to one side
    c.sideT = Math.max(0, (c.sideT || 0) - dt);
    let [nx, nz] = c.sideT > 0 ? stepTo(...turn(c.side * 1.15)) : stepTo(dir[0], dir[1]);
    if (Math.hypot(nx - c.x, nz - c.z) < speed * dt * 0.3) {
      c.side = c.side || (c.id % 2 ? 1 : -1);
      round: for (const s of [c.side, -c.side]) for (const a of [1.15, 1.6]) {
        const [tx, tz] = stepTo(...turn(s * a));
        if (Math.hypot(tx - c.x, tz - c.z) > speed * dt * 0.5) { nx = tx; nz = tz; c.side = s; c.sideT = 0.7; break round; }
      }
    }
    const ny = groundHeight(nx, nz, r * 0.5, c.y, 0.5);
    if (insideHouse(nx, nz, ny) !== cIn && !stairAt(nx, nz) && !stairAt(c.x, c.z)) return; // walls only get crossed by vaulting
    c.x = nx; c.z = nz; c.y = ny;
    c.yaw = turnToward(c.yaw, Math.atan2(dir[0], dir[1]), dt * (c.type === 'runner' || c.type === 'local' ? 9 : def.boss ? 2.5 : 5));
  }

  // ---- the ranch dogs: follow the players, charge and bite zombie cows ----
  updateDogs(dt, alive) {
    for (const d of this.dogs) {
      const def = DOG_TYPES[d.id - 1];
      d.biteCd -= dt;
      if (def.hider) { this.hideDog(d, def, dt); continue; }
      if (d.state === 3) { // knocked down
        d.downT -= dt;
        if (d.downT <= 0) { d.state = 0; d.hp = def.hp * 0.6; }
        continue;
      }
      const dIn = insideHouse(d.x, d.z);
      const owner = alive.reduce((a, p) => (!a || Math.hypot(p.x - d.x, p.z - d.z) < Math.hypot(a.x - d.x, a.z - d.z) ? p : a), null);
      // closest living cow near the players; ones on this side of the walls come first
      let prey = null, best = Infinity, pd = Infinity;
      for (const c of this.cows.values()) {
        if (c.state === 'dead' || c.state === 'vault' || levelOf(c.y) || stairAt(c.x, c.z)) continue;   // dogs stay downstairs
        const dd = Math.hypot(c.x - d.x, c.z - d.z);
        if (dd > def.sight) continue;
        if (owner && Math.hypot(c.x - owner.x, c.z - owner.z) > DOG_LEASH) continue;
        const cost = dd + (insideHouse(c.x, c.z) !== dIn ? 8 : 0);
        if (cost < best) { best = cost; prey = c; pd = dd; }
      }
      let goal = null, speed = def.speed;
      if (prey) {
        const reach = def.bite + COW_TYPES[prey.type].radius;
        if (pd < reach && insideHouse(prey.x, prey.z) === dIn) {
          d.state = 2;
          d.yaw = turnToward(d.yaw, Math.atan2(prey.x - d.x, prey.z - d.z), dt * 10);
          if (d.biteCd <= 0) {
            d.biteCd = def.biteEvery;
            prey.hp -= def.damage;
            if (!COW_TYPES[prey.type].heavy) prey.stagger = 0.3;
            this.broadcastEvent({ t: 'dogbite', dog: d.id, cow: prey.id, p: [prey.x, 0.9, prey.z] });
            if (prey.hp <= 0) this.killCow(prey);
          }
          continue;
        }
        goal = this.dogRoute(d, prey.x, prey.z);
        if (Math.random() < dt * 0.6) this.broadcastEvent({ t: 'bark', dog: d.id });
      } else if (owner) {
        // with the owner upstairs, wait at the foot of the stair they went up
        const [ox, oz] = levelOf(owner.y || 0) || stairAt(owner.x, owner.z)
          ? (insideHouse(owner.x, owner.z, owner.y || 0) || stairAt(owner.x, owner.z) === STAIRS[0] ? STAIRS[0].foot : STAIRS[1].foot) : [owner.x, owner.z];
        const od = Math.hypot(ox - d.x, oz - d.z);
        if (od > 5) { goal = this.dogRoute(d, ox, oz); speed = od > 12 ? def.speed : def.speed * 0.55; }
        else { // mill about near the owner
          d.wander += dt * 0.4;
          goal = this.dogRoute(d, ox + Math.cos(d.wander + d.id * 2) * 3, oz + Math.sin(d.wander + d.id * 2) * 3);
          speed = def.speed * 0.25;
        }
      }
      if (!goal) { d.state = 0; continue; }
      const gx = goal[0] - d.x, gz = goal[1] - d.z, gl = Math.hypot(gx, gz);
      if (gl < 0.3) { d.state = 0; continue; }
      d.state = speed > def.speed * 0.4 ? 1 : 0;
      let nx = d.x + (gx / gl) * speed * dt, nz = d.z + (gz / gl) * speed * dt;
      [nx, nz] = resolveCircle(nx, nz, def.radius, 0, 0.4, playerPassable);
      d.x = nx; d.z = nz;
      d.yaw = turnToward(d.yaw, Math.atan2(gx, gz), dt * 9);
    }
  }

  // Pepper doesn't fight: she bolts into the house, through to Troy's office, and crawls
  // under her blanket behind the desk (state 4), where she stays.
  hideDog(d, def, dt) {
    if (d.hidden) { d.state = 4; d.x = BLANKET.x; d.z = BLANKET.z; d.yaw = BLANKET.yaw; return; }
    const goal = this.dogRoute(d, BLANKET.x, BLANKET.z);
    const gx = goal[0] - d.x, gz = goal[1] - d.z, gl = Math.hypot(gx, gz);
    if (Math.hypot(BLANKET.x - d.x, BLANKET.z - d.z) < 0.35) { d.hidden = true; d.state = 4; return; }
    d.state = 1;
    if (gl < 1e-3) return;
    let nx = d.x + (gx / gl) * def.speed * dt, nz = d.z + (gz / gl) * def.speed * dt;
    [nx, nz] = resolveCircle(nx, nz, def.radius, 0, 0.4, playerPassable);
    d.x = nx; d.z = nz;
    d.yaw = turnToward(d.yaw, Math.atan2(gx, gz), dt * 9);
  }

  // Dogs have no pathfinding: when the goal is on the other side of the walls they go
  // out (or in) through the nearest door, then head straight for it.
  dogRoute(d, gx, gz) {
    const dIn = insideHouse(d.x, d.z);
    // finish going through a door before chasing again, or a diagonal line back past the
    // doorway would pull the dog straight back through it
    if (d.via != null && d.viaStage === 1) {
      const door = ENTRIES[d.via], far = d.viaOut ? door.out : door.in;
      if (Math.hypot(d.x - far[0], d.z - far[1]) > 0.8) return far;
      d.via = null;
    }
    if (dIn === insideHouse(gx, gz)) { d.via = null; return dIn ? indoorWaypoint(d.x, d.z, gx, gz) : [gx, gz]; }
    let door = d.via != null ? ENTRIES[d.via] : null;
    if (!door) {
      let best = Infinity;
      for (const e of ENTRIES) {
        if (e.kind !== 'door' || e.level) continue;   // (the upstairs door is up on the roof)
        const k = Math.hypot(e.x - d.x, e.z - d.z) + Math.hypot(e.x - gx, e.z - gz);
        if (k < best) { best = k; door = e; }
      }
      d.via = door.id; d.viaStage = 0;
    }
    const near = dIn ? door.in : door.out, far = dIn ? door.out : door.in;
    if (d.viaStage === 0 && Math.hypot(d.x - near[0], d.z - near[1]) < 0.8) { d.viaStage = 1; d.viaOut = dIn; }
    if (d.viaStage === 0 && dIn) return indoorWaypoint(d.x, d.z, near[0], near[1]); // find the way to the door first
    return d.viaStage === 0 ? near : far;
  }

  hurtDog(d, dmg) {
    d.hp -= dmg;
    this.broadcastEvent({ t: 'dogyelp', dog: d.id });
    if (d.hp <= 0 && d.state !== 3) {
      d.state = 3; d.downT = 20;
      const name = DOG_TYPES.find((t, i) => i === d.id - 1)?.name || 'The little dog';
      this.broadcastEvent({ t: 'chat', k: '{0} got knocked down by a cow! Back up in 20 seconds', a: [name], msg: `${name} got knocked down by a cow! Back up in 20 seconds` });
    }
  }

  hurtPlayer(p, dmg, cow) {
    if (p.downed || p.dead) return;
    p.hp -= dmg;
    p.lastHurt = this.time;
    this.sendTo(p, { t: 'hurt', dmg, from: [cow.x, cow.z] });
    if (p.hp <= 0) {
      p.hp = 0;
      const others = [...this.players.values()].filter(o => o !== p && !o.dead && !o.downed);
      this.leaveVehicle(p, true);
      const secondWind = p.perks.includes('revive');
      p.perks = []; // going down costs you every perk
      if (!others.length && secondWind) {
        p.downed = true; p.selfRevive = true; p.bleed = BLEEDOUT; p.revive = 0;
        this.sendTo(p, { t: 'perks', perks: [] });
        return;
      }
      this.sendTo(p, { t: 'perks', perks: [] });
      if (others.length) {
        p.downed = true; p.bleed = BLEEDOUT; p.revive = 0;
        this.broadcastEvent({ t: 'chat', k: '{0} is down! Hold E next to them to revive', a: [p.name], msg: `${p.name} is down! Hold E next to them to revive` });
      } else {
        p.dead = true;
      }
    }
  }

  // ---- networking ----
  broadcastEvent(ev, exceptId) {
    const s = JSON.stringify(ev);
    for (const p of this.players.values()) if (p.id !== exceptId) p.send(s);
  }

  sendTo(p, ev) { p.send(JSON.stringify(ev)); }

  broadcastSnapshot() {
    const r = (v) => Math.round(v * 100) / 100;
    const STATE = { walk: 0, attack: 1, dead: 2, tear: 3, vault: 4 };
    const snap = {
      t: 'snap',
      ts: Math.round(this.time * 1000),
      phase: this.phase,
      wave: this.wave,
      tw: this.phase === 'wave' ? this.twist : '',
      timer: Math.max(0, Math.ceil(this.timer)),
      left: this.toSpawn.length + [...this.cows.values()].filter(c => c.state !== 'dead').length,
      boards: this.boards,
      pu: this.powerups.map(u => [u.id, u.type, r(u.x), r(u.z)]),
      nd: this.nades.map(n => [n.id, r(n.x), r(n.y), r(n.z)]),
      ik: Math.ceil(this.instakill), dp: Math.ceil(this.doublePts),
      pw: this.power ? 1 : 0, fs: Math.ceil(this.fireSale),
      bx: [this.box.spot, ['idle', 'rolling', 'ready', 'moving'].indexOf(this.box.state), this.box.weapon, r(this.box.t), this.box.by],
      pp: [this.pap.state === 'working' ? 1 : 0, r(this.pap.t), this.pap.by, this.pap.weapon],
      tr: [Math.ceil(this.trap.on), Math.ceil(this.trap.cool)],
      sh: this.shells.map(c => [c.id, r(c.x), r(c.y), r(c.z)]),
      veh: this.vehicles.map(v => [v.id, r(v.x), r(v.z), r(v.yaw), r(v.speed), r(v.steer), ...v.seats]),
      dogs: this.dogs.map(d => [d.id, d.kind === 'little' ? 1 : 0, r(d.x), r(d.z), r(d.yaw), d.state]),
      players: [...this.players.values()].map(p => ({
        id: p.id, n: p.name, c: p.char, x: r(p.x), y: r(p.y), z: r(p.z), yaw: r(p.yaw), pitch: r(p.pitch),
        hp: Math.round(p.hp), dn: p.downed ? 1 : 0, sr: p.selfRevive ? 1 : 0, dd: p.dead ? 1 : 0,
        rv: Math.round((p.revive / REVIVE_TIME) * 100), bl: Math.ceil(p.bleed), s: p.score, k: p.kills,
        rp: Math.round((p.repairT / REPAIR_TIME) * 100), rd: p.veh ? p.seat + 1 : 0, pk: p.perks, up: p.upg, mh: maxHealth(p.perks), w: p.weapons, cw: p.weapons[p.cur] || p.weapons[0], g: p.grenades,
      })),
      cows: [...this.cows.values()].map(c => [
        c.id, COW_TYPE_LIST.indexOf(c.type), r(c.x), r(c.z), r(c.yaw),
        Math.round((c.hp / c.maxHp) * 100), STATE[c.state], r(c.y),
      ]),
    };
    const s = JSON.stringify(snap);
    for (const p of this.players.values()) p.send(s);
  }
}

function turnToward(a, b, maxStep) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + Math.max(-maxStep, Math.min(maxStep, d));
}

// for the headless tests
export const _nav = { buildField, fieldDir, nodeOf, cellOf, cell1, baseBlocked, N, LINKS, stairAt };
