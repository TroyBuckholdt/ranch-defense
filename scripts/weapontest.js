// Server-side checks for buying, shooting with different guns, melee, grenades and power-ups.
import { Room } from '../server/game.js';
import { WALL_BUYS } from '../shared/world.js';
const room = new Room('t', () => {}); clearInterval(room.interval);
const got = [];
const p = room.addPlayer(1, 'T', s => { const m = JSON.parse(s); if (m.t !== 'snap') got.push(m); });
room.hurtPlayer = () => {};
const st = WALL_BUYS[0];
p.x = st.x - st.nx * 1; p.z = st.z;
console.log('start', p.score, p.weapons);
room.onBuy(p, { s: 0 }); console.log('after buy shotgun', p.score, p.weapons, got.at(-1).t);
room.onBuy(p, { s: 0 }); console.log('ammo rebuy', p.score, got.at(-1).t, got.at(-1).ammo);
room.onBuy(p, { s: 1 }); console.log('too far for hunting', got.at(-1).t);
for (let i = 0; i < 20 * 40; i++) room.step();
const c = [...room.cows.values()].find(c => c.state !== 'dead');
if (c) {
  const hp0 = c.hp;
  p.x = c.x - 3; p.z = c.z; p.y = 0; room.time += 1;
  const dirs = Array.from({ length: 9 }, () => [1, (1.1 - 1.6) / 3 + (Math.random() - 0.5) * 0.05, (Math.random() - 0.5) * 0.05]);
  room.onShoot(p, { w: 'shotgun', o: [p.x, 1.6, p.z], ds: dirs });
  console.log('shotgun hp', hp0, '->', c.hp, c.state);
  room.time += 1; room.onShoot(p, { w: 'lmg', o: [p.x, 1.6, p.z], d: [1, -0.1, 0] }); console.log('unowned lmg ignored hp', c.hp);
  p.x = c.x - 1.5; p.yaw = Math.PI / 2; room.time += 1; room.onMelee(p, {}); console.log('machete hp', c.hp, c.state);
  room.onNade(p, { o: [p.x, 1.5, p.z], v: [2, 2, 0] }); console.log('grenades left', p.grenades, 'live', room.nades.length);
  for (let i = 0; i < 60; i++) room.step();
  console.log('boom event', got.some(m => m.t === 'boom'));
}
room.dropPowerup(p.x, p.z); for (let i = 0; i < 3; i++) room.step();
console.log('powerup picked', got.filter(m => m.t === 'powerup').map(m => m.type));
