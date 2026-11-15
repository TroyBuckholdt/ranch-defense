// Authoritative game simulation for one room: cows, waves, boards, health, revives, scoring.
//
// Cow behaviour:
//   outside -> walk to the nearest door/window (open ones preferred)
//           -> tear boards off it, swiping at anyone standing right inside
//           -> once it's bare, climb in
//   inside  -> hunt the nearest player
import {
  MAP_HALF, SPAWN_EDGE, SOLIDS, ENTRIES, MAX_BOARDS, PLAYER_SPAWNS, COW_TYPES, WEAPON,
  REPAIR_TIME, REPAIR_RANGE, resolveCircle, raySolids, raySphere, cowHitSpheres, insideHouse,
} from '../shared/world.js';

const TICK = 1 / 20;
const INTERMISSION = 14;
const FIRST_WAVE_DELAY = 8;
const GAMEOVER_TIME = 9;
const BLEEDOUT = 30;
const REVIVE_TIME = 3;
const VAULT_TIME = 1.1;
const MAX_ALIVE_COWS = 40;

// ---- Path grid: blocked cells, then distance fields toward targets ----
const CELL = 1;
const GRID = Math.ceil((MAP_HALF * 2) / CELL);
const blocked = new Uint8Array(GRID * GRID);
(() => {
  const inflate = 0.9;
  for (const b of SOLIDS) {
    if (b.h <= 0.4) continue; // steppable (porch)
    const x0 = Math.floor((b.x - b.w / 2 - inflate + MAP_HALF) / CELL);
    const x1 = Math.floor((b.x + b.w / 2 + inflate + MAP_HALF) / CELL);
    const z0 = Math.floor((b.z - b.d / 2 - inflate + MAP_HALF) / CELL);
    const z1 = Math.floor((b.z + b.d / 2 + inflate + MAP_HALF) / CELL);
    for (let gz = Math.max(0, z0); gz <= Math.min(GRID - 1, z1); gz++)
      for (let gx = Math.max(0, x0); gx <= Math.min(GRID - 1, x1); gx++) blocked[gz * GRID + gx] = 1;
  }
})();
const toCell = (v) => Math.max(0, Math.min(GRID - 1, Math.floor((v + MAP_HALF) / CELL)));
const NEIGH = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];

// sources: [[x, z, startCost], ...]. Label-correcting search (handles uneven start costs).
function buildField(sources) {
  const dist = new Float32Array(GRID * GRID).fill(Infinity);
  const queue = [];
  for (const [x, z, c0 = 0] of sources) {
    const i = toCell(z) * GRID + toCell(x);
    if (c0 < dist[i]) { dist[i] = c0; queue.push(i); }
  }
  let head = 0;
  while (head < queue.length) {
    const i = queue[head++];
    const cx = i % GRID, cz = (i / GRID) | 0;
    for (const [dx, dz, c] of NEIGH) {
      const nx = cx + dx, nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= GRID || nz >= GRID) continue;
      const n = nz * GRID + nx;
      if (blocked[n]) continue;
      if (dx && dz && (blocked[cz * GRID + nx] || blocked[nz * GRID + cx])) continue;
      const nd = dist[i] + c;
      if (nd < dist[n] - 1e-3) { dist[n] = nd; queue.push(n); }
    }
  }
  return dist;
}

function fieldDir(dist, x, z) {
  const cx = toCell(x), cz = toCell(z);
  let best = dist[cz * GRID + cx], bx = 0, bz = 0;
  for (const [dx, dz] of NEIGH) {
    const nx = cx + dx, nz = cz + dz;
    if (nx < 0 || nz < 0 || nx >= GRID || nz >= GRID) continue;
    const d = dist[nz * GRID + nx];
    if (d < best) { best = d; bx = dx; bz = dz; }
  }
  if (bx === 0 && bz === 0) return null;
  const tx = (cx + bx + 0.5) * CELL - MAP_HALF, tz = (cz + bz + 0.5) * CELL - MAP_HALF;
  const vx = tx - x, vz = tz - z, l = Math.hypot(vx, vz) || 1;
  return [vx / l, vz / l];
}

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
    this.wave = 0;
    this.phase = 'intermission';
    this.timer = FIRST_WAVE_DELAY;
    this.toSpawn = [];
    this.spawnTimer = 0;
    this.cows.clear();
    this.boards = ENTRIES.map(() => MAX_BOARDS);
    this.vaulting = ENTRIES.map(() => 0); // cow id currently climbing through
    this.outsideField = null;
    this.insideField = null;
    this.outsideAge = 99;
    this.insideAge = 99;
    let i = 0;
    for (const p of this.players.values()) this.respawn(p, i++);
  }

  respawn(p, idx = this.players.size) {
    const [sx, sz] = PLAYER_SPAWNS[idx % PLAYER_SPAWNS.length];
    Object.assign(p, {
      x: sx, y: 0, z: sz, yaw: Math.PI, pitch: 0,
      hp: 100, downed: false, dead: false, bleed: 0, revive: 0, lastHurt: -99, repairT: 0,
    });
  }

  addPlayer(id, name, send) {
    const p = { id, name, send, score: 0, kills: 0, using: false, lastShot: 0 };
    this.respawn(p);
    if (this.phase === 'wave' && [...this.players.values()].some(o => !o.dead && !o.downed)) {
      p.dead = true; p.hp = 0; // sit out until the wave ends
    }
    this.players.set(id, p);
    this.broadcastEvent({ t: 'chat', msg: `${name} joined the ranch` });
    return p;
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.players.delete(id);
    this.broadcastEvent({ t: 'chat', msg: `${p.name} left` });
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
    if (Math.hypot(nx - p.x, nz - p.z) < 6) { p.x = nx; p.y = ny; p.z = nz; }
    p.yaw = +m.yaw || 0;
    p.pitch = +m.pitch || 0;
    p.using = !!m.use;
  }

  onShoot(p, m) {
    if (p.downed || p.dead) return;
    if (this.time - p.lastShot < WEAPON.fireInterval * 0.8) return;
    p.lastShot = this.time;
    if (!Array.isArray(m.o) || !Array.isArray(m.d)) return;
    const o = m.o.slice(0, 3).map(Number), d0 = m.d.slice(0, 3).map(Number);
    if (![...o, ...d0].every(Number.isFinite)) return;
    if (Math.hypot(o[0] - p.x, o[2] - p.z) > 3) return;
    const l = Math.hypot(...d0) || 1;
    const d = d0.map(v => v / l);

    this.broadcastEvent({ t: 'fx', id: p.id, o, d }, p.id);

    const wallDist = raySolids(o, d, WEAPON.range);
    let best = null;
    for (const c of this.cows.values()) {
      if (c.state === 'dead') continue;
      const ox = c.x - o[0], oz = c.z - o[2];
      if (ox * d[0] + oz * d[2] < -3) continue;
      for (const s of cowHitSpheres(c.type, c.x, c.z, c.yaw, c.y)) {
        const t = raySphere(o, d, s.x, s.y, s.z, s.r);
        if (t >= 0 && t < wallDist && (!best || t < best.t)) best = { t, c, head: !!s.head };
      }
    }
    if (!best) return;
    const { c, head, t } = best;
    c.hp -= WEAPON.damage * (head ? WEAPON.headMult : 1);
    p.score += 10;
    const hit = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
    let kill = false;
    if (c.hp <= 0) {
      kill = true;
      this.killCow(c);
      p.kills += 1;
      p.score += COW_TYPES[c.type].score + (head ? 50 : 0);
    } else if (c.type !== 'bull' && c.state !== 'vault') {
      c.stagger = 0.22;
    }
    this.broadcastEvent({ t: 'hit', cow: c.id, p: hit, d, head, kill, by: p.id });
  }

  killCow(c) {
    c.hp = 0;
    c.state = 'dead';
    c.deadAt = this.time;
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
      if (players.length && alive.length === 0) {
        this.phase = 'gameover';
        this.timer = GAMEOVER_TIME;
        this.broadcastEvent({ t: 'gameover', wave: this.wave });
      } else if (this.toSpawn.length === 0 && [...this.cows.values()].every(c => c.state === 'dead')) {
        this.phase = 'intermission';
        this.timer = INTERMISSION;
        let i = 0;
        for (const p of players) if (p.dead || p.downed) this.respawn(p, i++);
        this.broadcastEvent({ t: 'waveclear', wave: this.wave });
      }
    } else if (this.phase === 'gameover') {
      this.timer -= dt;
      if (this.timer <= 0) {
        for (const p of players) { p.score = 0; p.kills = 0; }
        this.reset();
        this.broadcastEvent({ t: 'restart' });
      }
    }

    this.spawnCows(dt);
    this.updatePlayers(dt, players, alive);
    this.updateCows(dt, alive);
    this.broadcastSnapshot();
  }

  startWave() {
    this.wave += 1;
    this.phase = 'wave';
    const n = this.wave;
    const pc = Math.max(1, this.players.size);
    const count = Math.round((5 + n * 3) * (1 + 0.45 * (pc - 1)));
    const list = [];
    for (let i = 0; i < count; i++) {
      const runnerChance = n < 3 ? 0 : Math.min(0.45, 0.1 + n * 0.03);
      list.push(Math.random() < runnerChance ? 'runner' : 'walker');
    }
    if (n % 5 === 0) for (let i = 0; i < 1 + Math.floor(n / 10); i++) list.splice(Math.floor(list.length / 2), 0, 'bull');
    this.toSpawn = list;
    this.spawnTimer = 2;
    this.broadcastEvent({ t: 'wave', wave: n, count: list.length });
  }

  spawnCows(dt) {
    if (this.phase !== 'wave' || !this.toSpawn.length) return;
    this.spawnTimer -= dt;
    const alive = [...this.cows.values()].filter(c => c.state !== 'dead').length;
    if (this.spawnTimer > 0 || alive >= MAX_ALIVE_COWS) return;
    this.spawnTimer = Math.max(0.35, 1.6 - this.wave * 0.1);
    const type = this.toSpawn.shift();
    let x = 0, z = -SPAWN_EDGE;
    for (let tries = 0; tries < 20; tries++) {
      const side = Math.floor(Math.random() * 4), t = (Math.random() * 2 - 1) * (SPAWN_EDGE - 4);
      [x, z] = side === 0 ? [t, -SPAWN_EDGE] : side === 1 ? [t, SPAWN_EDGE] : side === 2 ? [-SPAWN_EDGE, t] : [SPAWN_EDGE, t];
      const [rx, rz] = resolveCircle(x, z, 1);
      if (Math.hypot(rx - x, rz - z) < 0.01) break;
    }
    const def = COW_TYPES[type];
    const hp = Math.round(def.hp * (1 + (this.wave - 1) * 0.09));
    const id = this.nextCowId++;
    this.cows.set(id, {
      id, type, x, y: 0, z, yaw: Math.atan2(-x, -z), hp, maxHp: hp, state: 'walk',
      inside: false, entry: null, tearT: def.tear, vaultT: 0,
      attackCd: 0, stagger: 0, speedMul: 0.85 + Math.random() * 0.3, deadAt: 0,
    });
  }

  updatePlayers(dt, players, alive) {
    for (const p of players) {
      if (p.downed) {
        p.bleed -= dt;
        const helper = alive.find(a => a.using && Math.hypot(a.x - p.x, a.z - p.z) < 2.6);
        if (helper) {
          helper.reviving = true;
          p.revive += dt;
          if (p.revive >= REVIVE_TIME) {
            p.downed = false; p.hp = 50; p.revive = 0; p.lastHurt = this.time;
            helper.score += 150;
            this.broadcastEvent({ t: 'chat', msg: `${helper.name} revived ${p.name}` });
          }
        } else {
          p.revive = Math.max(0, p.revive - dt * 2);
        }
        if (p.bleed <= 0 && p.downed) {
          p.downed = false; p.dead = true;
          this.broadcastEvent({ t: 'chat', msg: `${p.name} bled out` });
        }
      } else if (!p.dead && p.hp < 100 && this.time - p.lastHurt > 4) {
        p.hp = Math.min(100, p.hp + 25 * dt);
      }
    }

    // repairing: holding E near a damaged door/window (and not busy reviving)
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
        p.score += 10;
        this.outsideAge = 99; // re-plan cow routes
        this.broadcastEvent({ t: 'board', e: e.id, n: this.boards[e.id], add: 1, by: p.id });
      }
    }
  }

  nearestRepairable(p) {
    let best = null, bd = REPAIR_RANGE;
    for (const e of ENTRIES) {
      if (this.boards[e.id] >= MAX_BOARDS || this.vaulting[e.id]) continue;
      const d = Math.hypot(p.x - (e.x - e.nx * 0.8), p.z - (e.z - e.nz * 0.8));
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  updateCows(dt, alive) {
    // outside cows head for doors/windows; open ones are "closer" so they get swarmed
    this.outsideAge += dt;
    if (this.outsideAge > 1 || !this.outsideField) {
      this.outsideField = buildField(ENTRIES.map(e => [e.out[0], e.out[1], this.boards[e.id] * 2.5]));
      this.outsideAge = 0;
    }
    // inside cows hunt players
    this.insideAge += dt;
    if (alive.length && (this.insideAge > 0.4 || !this.insideField)) {
      this.insideField = buildField(alive.map(p => [p.x, p.z, 0]));
      this.insideAge = 0;
    }

    const cows = [...this.cows.values()];
    for (const c of cows) {
      if (c.state === 'dead') {
        if (this.time - c.deadAt > 6) this.cows.delete(c.id);
        continue;
      }
      const def = COW_TYPES[c.type];
      c.attackCd -= dt;

      if (c.state === 'vault') { this.updateVault(c, dt); continue; }
      if (c.stagger > 0) { c.stagger -= dt; continue; }

      // nearest living player (for attacks)
      let target = null, td = Infinity;
      for (const p of alive) {
        const d = Math.hypot(p.x - c.x, p.z - c.z);
        if (d < td) { td = d; target = p; }
      }

      // swipe at a player in reach. From outside, only through the door/window it's at.
      const sameSide = target && insideHouse(target.x, target.z) === c.inside;
      const throughOpening = target && !c.inside && c.entry != null &&
        Math.hypot(target.x - ENTRIES[c.entry].x, target.z - ENTRIES[c.entry].z) < 1.6;
      if (target && td < def.reach && target.y < 1.9 * def.scale && (sameSide || throughOpening)) {
        c.state = 'attack';
        c.yaw = turnToward(c.yaw, Math.atan2(target.x - c.x, target.z - c.z), dt * 8);
        if (c.attackCd <= 0) {
          c.attackCd = c.type === 'bull' ? 1.6 : 1.1;
          this.hurtPlayer(target, def.damage, c);
        }
        continue;
      }

      if (c.inside) {
        c.state = 'walk';
        if (!target) continue;
        let dir = td < 3.5 ? [(target.x - c.x) / td, (target.z - c.z) / td] : (this.insideField && fieldDir(this.insideField, c.x, c.z));
        if (!dir) dir = [(target.x - c.x) / td, (target.z - c.z) / td];
        this.moveCow(c, dir, cows, dt);
        continue;
      }

      // outside: at a door/window yet?
      if (c.entry != null) {
        const e = ENTRIES[c.entry];
        const dOut = Math.hypot(e.out[0] - c.x, e.out[1] - c.z);
        // shuffle up to the opening and face it
        if (dOut > 0.4) this.moveCow(c, [(e.out[0] - c.x) / dOut, (e.out[1] - c.z) / dOut], cows, dt, 0.6);
        c.yaw = turnToward(c.yaw, Math.atan2(-e.nx, -e.nz), dt * 6);
        if (this.boards[e.id] > 0) {
          c.state = 'tear';
          c.tearT -= dt;
          if (c.tearT <= 0) {
            c.tearT = def.tear * (0.8 + Math.random() * 0.4);
            const n = c.type === 'bull' ? this.boards[e.id] : 1;
            this.boards[e.id] -= n;
            this.outsideAge = 99;
            this.broadcastEvent({ t: 'board', e: e.id, n: this.boards[e.id], add: -n });
          }
        } else if (!this.vaulting[e.id] && dOut < 1.2) {
          c.state = 'vault';
          c.vaultT = 0;
          c.vaultFrom = [c.x, c.z];
          this.vaulting[e.id] = c.id;
        } else {
          c.state = 'tear'; // waiting its turn, still pawing at the frame
        }
        continue;
      }

      c.state = 'walk';
      // claim a door/window when close to its approach spot
      for (const e of ENTRIES) {
        if (Math.hypot(e.out[0] - c.x, e.out[1] - c.z) < 1.6) { c.entry = e.id; c.tearT = def.tear; break; }
      }
      if (c.entry != null) continue;
      const dir = (this.outsideField && fieldDir(this.outsideField, c.x, c.z)) || [-c.x / (Math.hypot(c.x, c.z) || 1), -c.z / (Math.hypot(c.x, c.z) || 1)];
      this.moveCow(c, dir, cows, dt);
    }
  }

  updateVault(c, dt) {
    const e = ENTRIES[c.entry];
    c.vaultT += dt / (VAULT_TIME * (c.type === 'runner' ? 0.7 : 1));
    const k = Math.min(1, c.vaultT);
    c.x = c.vaultFrom[0] + (e.in[0] - c.vaultFrom[0]) * k;
    c.z = c.vaultFrom[1] + (e.in[1] - c.vaultFrom[1]) * k;
    c.y = Math.sin(k * Math.PI) * (e.sill + 0.35);
    c.yaw = Math.atan2(-e.nx, -e.nz);
    if (k >= 1) {
      c.y = 0;
      c.inside = true;
      c.state = 'walk';
      this.vaulting[e.id] = 0;
      c.entry = null;
    }
  }

  moveCow(c, dir, cows, dt, speedMul = 1) {
    const def = COW_TYPES[c.type];
    let sx = 0, sz = 0;
    for (const o of cows) {
      if (o === c || o.state === 'dead' || o.state === 'vault' || o.inside !== c.inside) continue;
      const dx = c.x - o.x, dz = c.z - o.z, d2 = dx * dx + dz * dz;
      const minD = (def.radius + COW_TYPES[o.type].radius) * 0.9;
      if (d2 < minD * minD && d2 > 1e-6) { const d = Math.sqrt(d2); sx += (dx / d) * (minD - d); sz += (dz / d) * (minD - d); }
    }
    const speed = def.speed * c.speedMul * speedMul * (c.inside ? 0.85 : 1);
    let nx = c.x + dir[0] * speed * dt + sx * 0.4;
    let nz = c.z + dir[1] * speed * dt + sz * 0.4;
    [nx, nz] = resolveCircle(nx, nz, def.radius * 0.7);
    // never let separation shove an outside cow through a wall or vice versa
    if (insideHouse(nx, nz) !== c.inside) return;
    c.x = nx; c.z = nz;
    c.yaw = turnToward(c.yaw, Math.atan2(dir[0], dir[1]), dt * (c.type === 'runner' ? 9 : 5));
  }

  hurtPlayer(p, dmg, cow) {
    if (p.downed || p.dead) return;
    p.hp -= dmg;
    p.lastHurt = this.time;
    this.sendTo(p, { t: 'hurt', dmg, from: [cow.x, cow.z] });
    if (p.hp <= 0) {
      p.hp = 0;
      const others = [...this.players.values()].filter(o => o !== p && !o.dead && !o.downed);
      if (others.length) {
        p.downed = true; p.bleed = BLEEDOUT; p.revive = 0;
        this.broadcastEvent({ t: 'chat', msg: `${p.name} is down! Hold E next to them to revive` });
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
      timer: Math.max(0, Math.ceil(this.timer)),
      left: this.toSpawn.length + [...this.cows.values()].filter(c => c.state !== 'dead').length,
      boards: this.boards,
      players: [...this.players.values()].map(p => ({
        id: p.id, n: p.name, x: r(p.x), y: r(p.y), z: r(p.z), yaw: r(p.yaw), pitch: r(p.pitch),
        hp: Math.round(p.hp), dn: p.downed ? 1 : 0, dd: p.dead ? 1 : 0,
        rv: Math.round((p.revive / REVIVE_TIME) * 100), bl: Math.ceil(p.bleed), s: p.score, k: p.kills,
        rp: Math.round((p.repairT / REPAIR_TIME) * 100),
      })),
      cows: [...this.cows.values()].map(c => [
        c.id, c.type === 'walker' ? 0 : c.type === 'runner' ? 1 : 2, r(c.x), r(c.z), r(c.yaw),
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
