// The house's rooms: can everyone get around inside? Usage: node scripts/housetest.js
//  - a cow let loose in each room reaches a player standing in every other room
//  - Pepper runs in from the veranda to her blanket in the office
//  - the fighting dogs follow a player from the veranda into the kitchen and the office
//  - a player can walk through every inside doorway and arch (same collision as the client)
import { Room } from '../server/game.js';
import { ROOMS, PORTALS, BLANKET, DOG_TYPES, COW_TYPES, ENTRIES, STAIRS, UPPER, resolveCircle, groundHeight, playerPassable, roomAt, insideHouse } from '../shared/world.js';

const SPOT = { kitchen: [-9.8, -5.2], passage: [-11, -2.5], bar: [-10, 3], hall: [-2, -4.5], office: [6.5, -4], great: [-1, 5.6], sitting: [8.5, 5.6] };
let fails = 0;
const fresh = () => {
  const room = new Room('h', () => {}); clearInterval(room.interval);
  const p = room.addPlayer(1, 'T', () => {});
  room.hurtPlayer = () => {};
  room.phase = 'wave'; room.toSpawn = []; room.timer = 9999;
  room.dogs.forEach(d => { d.x = 60; d.z = 60; d.hp = 1e9; }); // out of the way unless a test wants them
  return { room, p };
};

// cows: room to room
const rows = [];
for (const [from, a] of Object.entries(SPOT)) for (const [to, b] of Object.entries(SPOT)) {
  if (from === to) continue;
  for (const type of ['walker', 'bull']) {
    const { room, p } = fresh();
    p.x = b[0]; p.z = b[1];
    room.cows.set(1, { id: 1, type, x: a[0], y: 0, z: a[1], yaw: 0, hp: 1e9, maxHp: 1e9, state: 'walk', entry: null, tearT: 1, vaultT: 0, attackCd: 9, stagger: 0, speedMul: 1, deadAt: 0, throwCd: 5, tauntCd: 99 });
    let t = null;
    for (let i = 0; i < 20 * 40; i++) {
      p.x = b[0]; p.z = b[1];
      room.step();
      const c = room.cows.get(1);
      if (Math.hypot(c.x - p.x, c.z - p.z) < COW_TYPES[type].reach + 0.1) { t = i / 20; break; }
    }
    if (t === null) { fails++; const c = room.cows.get(1); rows.push(`FAIL ${type} ${from} -> ${to}: stuck at ${c.x.toFixed(1)},${c.z.toFixed(1)} (${ROOMS[roomAt(c.x, c.z)]?.id})`); }
    else if (t > 12) rows.push(`slow ${type} ${from} -> ${to}: ${t}s`);
  }
}
console.log(`cows room to room: ${Object.keys(SPOT).length * (Object.keys(SPOT).length - 1) * 2} runs`, rows.length ? '\n  ' + rows.join('\n  ') : 'all reached the player');

// Pepper
{
  const { room, p } = fresh();
  p.x = 0; p.z = 10;
  room.phase = 'wave';
  const pep = room.dogs.find(d => DOG_TYPES[d.id - 1].hider);
  pep.x = -2; pep.z = 11; pep.hidden = false;
  room.cows.set(1, { id: 1, type: 'walker', x: 0, y: 0, z: 40, yaw: 0, hp: 1e9, maxHp: 1e9, state: 'walk', entry: null, tearT: 1, vaultT: 0, attackCd: 9, stagger: 0, speedMul: 0.01, deadAt: 0, throwCd: 5, tauntCd: 99 });
  let t = null;
  for (let i = 0; i < 20 * 40 && t === null; i++) { room.step(); if (pep.hidden) t = i / 20; }
  if (t === null) fails++;
  console.log('Pepper to her blanket in the office:', t === null ? `FAIL, stuck at ${pep.x.toFixed(1)},${pep.z.toFixed(1)}` : `${t}s`);
}

// the fighting dogs follow the player indoors
for (const [label, at] of [['kitchen', SPOT.kitchen], ['office', SPOT.office], ['bar room', SPOT.bar]]) {
  const { room, p } = fresh();
  room.phase = 'intermission';
  p.x = at[0]; p.z = at[1];
  const dogs = room.dogs.filter(d => !DOG_TYPES[d.id - 1].hider);
  dogs.forEach((d, i) => { d.x = -3 + i; d.z = 12; });
  const reached = {};
  for (let i = 0; i < 20 * 30; i++) {
    room.step();
    for (const d of dogs) if (!reached[d.id] && Math.hypot(d.x - p.x, d.z - p.z) < 6 && roomAt(d.x, d.z) === roomAt(p.x, p.z)) reached[d.id] = i / 20;
  }
  const res = dogs.map(d => `${DOG_TYPES[d.id - 1].name} ${reached[d.id] != null ? reached[d.id] + 's' : 'NO (at ' + d.x.toFixed(1) + ',' + d.z.toFixed(1) + ')'}`);
  if (dogs.some(d => reached[d.id] == null)) fails++;
  console.log(`dogs follow into the ${label}:`, res.join(', '));
}

// players walk through every doorway (both ways)
for (const pt of PORTALS) {
  for (const s of [-1, 1]) {
    let x = pt.x - pt.nx * s * 1.5, z = pt.z - pt.nz * s * 1.5;
    for (let i = 0; i < 60; i++) {
      x += pt.nx * s * 0.08 + (pt.x - x) * pt.nz * pt.nz * 0.1; z += pt.nz * s * 0.08 + (pt.z - z) * pt.nx * pt.nx * 0.1;
      [x, z] = resolveCircle(x, z, 0.38, 0, 0.45, playerPassable);
    }
    const crossed = (x - pt.x) * pt.nx * s + (z - pt.z) * pt.nz * s > 1.0;
    if (!crossed) { fails++; console.log(`FAIL player through ${ROOMS[pt.a].id}/${ROOMS[pt.b].id} doorway at ${pt.x},${pt.z}`); }
  }
}
console.log('players through every doorway: checked', PORTALS.length * 2);

// a player's whole round trip: up the inside stair, through the gallery, out of the upstairs
// door, across the roof, down the outside stair, back round to the front door
{
  const route = [[-6.4, -5.5], [-6.3, -8.15], [1.0, -8.15], [2.4, -8.1], [2.4, -6.5], [3.5, -6.5], [6.5, -6.5], [10.2, -8.0], [10.3, -9.95], [9.4, -9.95], [1.5, -9.95], [0.5, -12], [-16, -12], [-16, 9], [0, 9.5], [0, 5]];
  let x = -3.5, z = -4.5, y = 0, i = 0, maxY = 0, t = 0;
  const log = [];
  while (i < route.length && t < 120) {
    const [gx, gz] = route[i];
    const d = Math.hypot(gx - x, gz - z);
    if (d < 0.35) { log.push(`${gx},${gz}@y${y.toFixed(1)}`); i++; continue; }
    const sp = Math.min(d, 4.4 / 30);
    let nx = x + (gx - x) / d * sp, nz = z + (gz - z) / d * sp, ny = y - 0.3 / 30;
    [nx, nz] = resolveCircle(nx, nz, 0.38, ny, 0.45, playerPassable);
    const g = groundHeight(nx, nz, 0.38, y, 0.6);
    if (ny <= g) ny = g;
    x = nx; z = nz; y = ny; maxY = Math.max(maxY, y); t += 1 / 30;
  }
  const ok = i === route.length;
  if (!ok) fails++;
  console.log(`player round trip upstairs and out: ${ok ? 'made it' : 'STUCK'} in ${t.toFixed(1)}s, highest ${maxY.toFixed(2)} m${ok ? '' : ` at ${x.toFixed(2)},${z.toFixed(2)} y ${y.toFixed(2)} heading for ${route[i]}`}`);
}

// cows follow players upstairs: up the inside stair, and up the outside one onto the roof,
// and in through the upstairs door once its boards are gone
for (const [label, from, at, open] of [
  ['hall -> bedroom (inside stair)', [-2, 0, -4.5], [-4, -3.4], false],
  ['yard -> roof terrace (outside stair)', [-3, 0, -16], [8.5, -4], false],
  ['roof -> gallery (upstairs door, boards off)', [8, UPPER.y, -3], [-2, -6.4], true],
  ['upstairs bedroom -> ground floor', [0.5, UPPER.y, -3.5], [-1, 5.6], false],
]) {
  for (const type of ['walker', 'runner']) {
    const { room, p } = fresh();
    if (open) room.boards[ENTRIES.find(e => e.level === 1).id] = 0;
    p.x = at[0]; p.z = at[1]; p.y = label.endsWith('ground floor') ? 0 : UPPER.y;
    room.cows.set(1, { id: 1, type, x: from[0], y: from[1], z: from[2], yaw: 0, hp: 1e9, maxHp: 1e9, state: 'walk', entry: null, tearT: 1, vaultT: 0, attackCd: 9, stagger: 0, speedMul: 1, deadAt: 0, throwCd: 5, tauntCd: 99 });
    let tm = null;
    for (let i = 0; i < 20 * 60; i++) {
      p.x = at[0]; p.z = at[1];
      room.step();
      const c = room.cows.get(1);
      if (Math.hypot(c.x - p.x, c.z - p.z) < COW_TYPES[type].reach + 0.1 && Math.abs(c.y - p.y) < 1.2) { tm = i / 20; break; }
    }
    const c = room.cows.get(1);
    if (tm === null) fails++;
    console.log(`cow ${type} ${label}: ${tm === null ? `FAIL, at ${c.x.toFixed(1)},${c.z.toFixed(1)} y ${c.y.toFixed(1)} (${c.state})` : tm + 's'}`);
  }
}
console.log(fails ? `${fails} FAILED` : 'house OK');
process.exit(fails ? 1 : 0);
