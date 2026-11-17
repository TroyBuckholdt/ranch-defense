// Players on both staircases: up and down at several frame rates and speeds, never airborne on the way down.
import { LocalPlayer } from '../client/src/player.js';
import { STAIRS, UPPER } from '../shared/world.js';
let bad = 0;
for (const [i, st] of STAIRS.entries()) for (const dt of [1 / 144, 1 / 60, 1 / 30, 0.05]) for (const [name, keys, mul] of [['walk', { KeyW: true }, 1], ['sprint', { KeyW: true, ShiftLeft: true }, 1], ['mustang', { KeyW: true, ShiftLeft: true }, 1.25], ['stick', { axisY: -0.5, axisX: 0.01 }, 1]]) {
  const stats = (p, done) => { let t = 0, air = 0, n = 0, jerk = 0, prev = null; while (t < 10 && !done(p)) { p.update(dt, keys, { canMove: true, speedMul: mul }); t += dt; n++; if (!p.grounded) air++; const eye = p.pos.y + p.stepLift; if (prev !== null) jerk = Math.max(jerk, Math.abs(eye - prev) / dt); prev = eye; } return { t, air: air / n, jerk }; };
  const p = new LocalPlayer(); p.teleport(st.foot[0], 0, st.zm); p.yaw = -Math.PI / 2;
  const u = stats(p, q => q.pos.x > st.x1 + 0.3);
  const q = new LocalPlayer(); q.teleport(st.head[0], UPPER.y, st.zm); q.yaw = Math.PI / 2;
  const d = stats(q, r => r.pos.x < st.x0 - 0.3);
  const ok = p.pos.y > UPPER.y - 0.05 && q.pos.y < 0.05 && d.air < 0.05;
  if (!ok) bad++;
  console.log(`stair ${i} dt ${dt.toFixed(4)} ${name.padEnd(7)} up ${u.t.toFixed(1)}s eye speed max ${u.jerk.toFixed(1)} m/s | down ${d.t.toFixed(1)}s airborne ${(d.air * 100).toFixed(0)}% eye max ${d.jerk.toFixed(1)} m/s ${ok ? '' : 'FAIL'}`);
}
// jumping and falling off the roof still work
const j = new LocalPlayer(); j.teleport(20, 0, 20); let top = 0; j.update(1 / 60, { Space: true }, { canMove: true }); for (let n = 0; n < 60; n++) { j.update(1 / 60, {}, { canMove: true }); top = Math.max(top, j.pos.y); }
console.log('jump height', top.toFixed(2), 'lands', j.pos.y.toFixed(2)); if (top < 0.8) bad++;
console.log(bad ? 'FAILED ' + bad : 'stairs ok');
process.exit(bad ? 1 : 0);
