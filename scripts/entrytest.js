// Which doors/windows do cows reach? Players are invulnerable here so the wave plays out.
import { Room } from '../server/game.js';
const hits = {};
for (let run = 0; run < 3; run++) {
  const room = new Room('t', () => {}); clearInterval(room.interval);
  const p = room.addPlayer(1, 'T', () => {});
  room.hurtPlayer = () => {};
  for (let i = 0; i < 20 * 150; i++) {
    room.step();
    for (const c of room.cows.values()) if (c.state === 'tear') hits[c.entry] = (hits[c.entry] || 0) + 1;
  }
}
console.log('tear ticks per entry (0=front door,1-2 front windows):', hits);
