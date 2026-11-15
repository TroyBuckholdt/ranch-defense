import { Room } from '../server/game.js';
import { insideHouse } from '../shared/world.js';
const room = new Room('t', () => {}); clearInterval(room.interval);
const p = room.addPlayer(1, 'T', () => {});
room.hurtPlayer = () => {};
let traced = null, log = [];
for (let i = 0; i < 20 * 110; i++) {
  room.step();
  if (!traced) for (const c of room.cows.values()) if (insideHouse(c.x, c.z) && c.state !== 'vault') { traced = c; break; }
  if (traced && i % 10 === 0) log.push(`${room.time.toFixed(1)} ${traced.state} ${traced.x.toFixed(1)},${traced.z.toFixed(1)} entry=${traced.entry}`);
  if (log.length > 30) break;
}
console.log(log.join('\n'));
