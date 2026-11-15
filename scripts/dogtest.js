// Do the dogs actually fight? Player stands on the veranda, invulnerable.
import { Room } from '../server/game.js';
const room = new Room('t', () => {}); clearInterval(room.interval);
const ev = {};
const p = room.addPlayer(1, 'T', (s) => { const m = JSON.parse(s); if (m.t !== 'snap') ev[m.t] = (ev[m.t] || 0) + 1; });
p.x = 0; p.z = 12;
room.hurtPlayer = () => {};
let kills = 0;
const before = new Set();
for (let i = 0; i < 20 * 90; i++) {
  room.step();
  for (const c of room.cows.values()) if (c.state === 'dead' && !before.has(c.id)) { before.add(c.id); kills++; }
}
console.log('events', ev, 'cows killed (by dogs, no shooting):', kills, 'dog states', room.dogs.map(d => `${d.kind}:${d.state} hp${Math.round(d.hp)}`).join(' '));
