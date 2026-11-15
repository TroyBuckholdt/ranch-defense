import { Room } from '../server/game.js';
const room = new Room('t', () => {}); clearInterval(room.interval);
const p = room.addPlayer(1, 'T', () => {});
room.step();
const f = room.playerField;
const G = 400, H = 200;
let out = '';
for (let z = -4; z <= 7; z++) {
  let row = `z${String(z).padStart(3)} `;
  for (let x = -11; x <= 2; x++) { const d = f[(z + H) * G + (x + H)]; row += (d === Infinity ? '  ##' : String(Math.round(d)).padStart(4)); }
  out += row + '\n';
}
console.log('x from -11 to 2 →\n' + out);
