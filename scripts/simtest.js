// Headless sanity test of the server simulation: one idle player inside the house.
import { Room } from '../server/game.js';
const room = new Room('test', () => {});
clearInterval(room.interval);
const events = [];
const p = room.addPlayer(1, 'Tester', (s) => { const m = JSON.parse(s); if (m.t !== 'snap') events.push(m); });
let firstTear = null, firstVault = null, firstInside = null, firstHurt = null;
for (let i = 0; i < 20 * 120; i++) {
  room.step();
  const t = room.time.toFixed(1);
  for (const c of room.cows.values()) {
    if (c.state === 'tear' && !firstTear) firstTear = `${t}s cow${c.id} tearing entry ${c.entry}`;
    if (c.state === 'vault' && !firstVault) firstVault = `${t}s cow${c.id} climbing through entry ${c.entry}`;
    if (c.inside && !firstInside) firstInside = `${t}s cow${c.id} inside at ${c.x.toFixed(1)},${c.z.toFixed(1)}`;
  }
  if (!firstHurt && events.some(e => e.t === 'hurt')) firstHurt = `${t}s player hurt`;
  if (room.phase === 'gameover') { console.log(`${t}s GAME OVER on wave ${room.wave}`); break; }
}
console.log({ firstTear, firstVault, firstInside, firstHurt, boards: room.boards.join(','), wave: room.wave, cows: room.cows.size, phase: room.phase });
const stuck = [...room.cows.values()].filter(c => !c.inside && c.entry == null && c.state === 'walk');
console.log('cows still walking outside:', stuck.map(c => `${c.x.toFixed(0)},${c.z.toFixed(0)}`).join(' '));
console.log('player', p.x, p.z, 'alive?', !p.dead && !p.downed);
for (const c of room.cows.values()) console.log(c.id, c.type, c.state, 'inside', c.inside, 'entry', c.entry, c.x.toFixed(2), c.z.toFixed(2));
