// Do the dogs actually fight? Two runs with an invulnerable player and no shooting:
// on the veranda, and inside the house (dogs must go out through a door to reach cows
// tearing at the windows). Reports bites per dog, kills, and whether each dog crossed
// the walls.
import { Room } from '../server/game.js';
import { insideHouse, DOG_TYPES } from '../shared/world.js';

for (const [label, px, pz] of [['veranda', 0, 12], ['inside the house', -6, 4.5]]) {
  const room = new Room('t', () => {}); clearInterval(room.interval);
  const ev = {}, bites = {}, chats = [];
  const p = room.addPlayer(1, 'T', (s) => {
    const m = JSON.parse(s);
    if (m.t === 'snap') return;
    ev[m.t] = (ev[m.t] || 0) + 1;
    if (m.t === 'dogbite') bites[m.dog] = (bites[m.dog] || 0) + 1;
    if (m.t === 'chat' && /dog|Jack|Mateo/.test(m.msg)) chats.push(m.msg);
  });
  p.x = px; p.z = pz;
  room.hurtPlayer = () => {};
  const crossed = {}, sides = {};
  for (const d of room.dogs) sides[d.id] = insideHouse(d.x, d.z);
  let kills = 0;
  const dead = new Set();
  for (let i = 0; i < 20 * 120; i++) {
    room.step();
    if (i < 3) { p.x = px; p.z = pz; }
    for (const d of room.dogs) {
      const s = insideHouse(d.x, d.z);
      if (s !== sides[d.id]) { crossed[d.id] = (crossed[d.id] || 0) + 1; sides[d.id] = s; }
    }
    for (const c of room.cows.values()) if (c.state === 'dead' && !dead.has(c.id)) { dead.add(c.id); kills++; }
  }
  const name = (id) => DOG_TYPES[id - 1].name;
  console.log(`\n== player ${label} ==`);
  console.log('bites:', Object.fromEntries(room.dogs.map(d => [name(d.id), bites[d.id] || 0])));
  console.log('crossed the walls (times):', Object.fromEntries(room.dogs.map(d => [name(d.id), crossed[d.id] || 0])));
  console.log('cows killed with no shooting:', kills, '| reached wave', room.wave, '| dogs knocked down announcements:', chats.length, chats[0] || '');
}
