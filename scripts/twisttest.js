// Headless test of the round twists (roundTwist in shared/world.js). Usage: node scripts/twisttest.js
//   gold:     the golden cow spawns, runs away from a player who walks at her, pays everyone
//             and drops a power-up when shot; another round, left alone, she gets away
//   stampede: every cow is a runner and they all come from one side
//   bomb:     a dead bloated cow bursts: the cows next to it die too, a player next to it is hurt
//   fog:      the snapshot carries the twist while the round lasts
import { Room } from '../server/game.js';
import { roundTwist, GOLD, BLOAT, heightAt } from '../shared/world.js';

let failed = 0;
const check = (ok, what) => { console.log(ok ? '  ok  ' : '  FAIL', what); if (!ok) failed++; };

function room(wave, px = 0, pz = 24) {
  const r = new Room('test', () => {}); clearInterval(r.interval);
  const events = [];
  let snap = null;
  const p = r.addPlayer(1, 'Tester', (s) => { const m = JSON.parse(s); if (m.t === 'snap') snap = m; else events.push(m); });
  r.wave = wave - 1; r.timer = 0;
  p.x = px; p.z = pz;
  return { r, p, events, snap: () => snap };
}
const steps = (r, p, secs, each) => {
  for (let i = 0; i < 20 * secs; i++) {
    p.hp = 100; p.downed = false; p.dead = false;
    r.step();
    if (each && each() === false) break;
  }
};

console.log('schedule:', Array.from({ length: 30 }, (_, i) => i + 1).filter(n => roundTwist(n)).map(n => `${n}:${roundTwist(n)}`).join(' '));
check(roundTwist(4) === 'gold' && roundTwist(7) === 'stampede' && roundTwist(12) === 'bomb' && roundTwist(16) === 'fog', 'twists land on rounds 4, 7, 12, 16');
check(!roundTwist(5) && !roundTwist(10) && !roundTwist(20) && !roundTwist(2), 'none on bull, locals, Rafael or early rounds');

// ---- gold: chase her, then shoot her
{
  const { r, p, events } = room(4);
  let gold = null, d0 = null, d1 = null;
  steps(r, p, 40, () => {
    gold = gold || [...r.cows.values()].find(c => c.type === 'gold');
    if (!gold) return;
    if (d0 == null) { p.x = gold.x + 12; p.z = gold.z; d0 = Math.hypot(gold.x - p.x, gold.z - p.z); }   // walk up close
    if (r.time - gold.born > 8) { d1 = Math.hypot(gold.x - p.x, gold.z - p.z); return false; }
  });
  check(!!gold, 'the golden cow spawns in round 4');
  check(events.some(e => e.t === 'wave' && e.twist === 'gold') && events.some(e => e.t === 'gold' && e.k === 'loose'), 'the round is announced, and that she is loose');
  check(d1 > d0 + 10, `she runs away from a player 12 m off (now ${d1?.toFixed(1)} m)`);
  const before = p.score, pus = r.powerups.length;
  r.damageCow(p, gold, 99999, false, [gold.x, 1, gold.z], [0, 0, 1]);
  check(p.score - before >= GOLD.reward + GOLD.killerBonus, `catching her pays (${p.score - before} points)`);
  check(r.powerups.length === pus + 1, 'and drops a power-up');
  check(events.some(e => e.t === 'gold' && e.k === 'caught'), 'and says so');
}
{
  const { r, p, events } = room(14);
  let gold = null;
  steps(r, p, GOLD.escape + 30, () => {
    p.x = 0; p.z = -3;   // indoors, nowhere near her
    gold = gold || [...r.cows.values()].find(c => c.type === 'gold');
    if (events.some(e => e.t === 'gold' && e.k === 'gone')) return false;
  });
  check(events.some(e => e.t === 'gold' && e.k === 'gone'), 'left alone, she gets away');
  check(!gold || gold.state === 'dead', 'and is gone from the round');
}

// ---- stampede
{
  const { r, p, events } = room(7);
  const types = new Set(), angles = [];
  const seen = new Set();
  steps(r, p, 25, () => {
    for (const c of r.cows.values()) if (!seen.has(c.id)) { seen.add(c.id); types.add(c.type); angles.push(Math.atan2(c.z - p.z, c.x - p.x)); }
  });
  const w = events.find(e => e.t === 'wave');
  check(w.twist === 'stampede', 'round 7 is a stampede');
  check(types.size === 1 && types.has('runner'), `all runners (${[...types]})`);
  // how bunched are the spawn bearings? (mean resultant length: 1 = all one direction)
  const R = Math.hypot(angles.reduce((a, t) => a + Math.cos(t), 0), angles.reduce((a, t) => a + Math.sin(t), 0)) / angles.length;
  check(angles.length > 15 && R > 0.75, `${angles.length} came out quickly, from one side (bunching ${R.toFixed(2)})`);
}

// ---- bomb
{
  const { r, p, events } = room(12, 30, 25);
  steps(r, p, 12);
  const live = [...r.cows.values()].filter(c => c.state !== 'dead');
  check(live.length >= 3 && live.every(c => c.bomb || c.type === 'bull'), `bloated cows (${live.length} out)`);
  // pile three together next to the player and kill one
  const [a, b, c] = live;
  for (const [cow, dx] of [[a, 0], [b, 1.5], [c, 2.5]]) { cow.x = p.x + 2 + dx; cow.z = p.z; cow.y = 0; cow.stagger = 5; }
  const hp0 = 100; p.hp = hp0;
  r.damageCow(p, a, 99999, false, [a.x, 1, a.z], [0, 0, 1]);
  for (let i = 0; i < 20; i++) r.step();
  check(events.some(e => e.t === 'boom' && e.gas), 'a dead bloated cow bursts');
  check(b.state === 'dead' || b.hp < b.maxHp - BLOAT.cowDamage * 0.4, 'the cow beside it is blown up too');
  check(events.some(e => e.t === 'hurt' && e.dmg > 5), 'and the player beside it gets hurt');
}

// ---- fog
{
  const { r, p, snap } = room(16);
  steps(r, p, 3);
  check(snap()?.tw === 'fog', 'round 16 carries the fog twist in the snapshot');
}

console.log(failed ? `${failed} FAILED` : 'twists OK');
process.exit(failed ? 1 : 0);
