// Headless test of the cow AI. Usage: node scripts/simtest.js [x z]  (player position)
import { Room } from '../server/game.js';
const [px, pz] = process.argv.slice(2).map(Number);
const room = new Room('test', () => {}); clearInterval(room.interval);
const events = [];
const p = room.addPlayer(1, 'Tester', (s) => { const m = JSON.parse(s); if (m.t !== 'snap') events.push(m); });
if (Number.isFinite(px)) { p.x = px; p.z = pz; }
const first = {};
const note = (k, v) => { if (!first[k]) first[k] = v; };
let maxStep = 0;
for (let i = 0; i < 20 * 120; i++) {
  const t0 = performance.now(); room.step(); maxStep = Math.max(maxStep, performance.now() - t0);
  const t = room.time.toFixed(1);
  for (const c of room.cows.values()) {
    if (c.state === 'tear') note('tear', `${t}s entry ${c.entry}`);
    if (c.state === 'vault') note('vault', `${t}s entry ${c.entry}`);
    const d = Math.hypot(c.x - p.x, c.z - p.z);
    if (d < 10) note('within10m', `${t}s`);
  }
  if (events.some(e => e.t === 'hurt')) note('hurt', `${t}s`);
  if (room.phase === 'gameover') { note('gameover', `${t}s wave ${room.wave}`); break; }
}
console.log(`player at ${p.x},${p.z}:`, first, `slowest tick ${maxStep.toFixed(1)}ms`);
