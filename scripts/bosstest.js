// Headless test of the special rounds. Usage: node scripts/bosstest.js
//   round 10: only locals spawn, they reach and hurt a player in the yard, bullets hit them
//   round 20: Rafael spawns, walks to the player, throws bottles, can't be insta-killed,
//             never gets inside the house, and dies when his health runs out
import { Room } from '../server/game.js';
import { COW_TYPES, LOCALS_WAVE, BOSS_WAVE, insideHouse, heightAt } from '../shared/world.js';

function run(wave, px, pz, secs, each) {
  const room = new Room('test', () => {}); clearInterval(room.interval);
  const events = [];
  const p = room.addPlayer(1, 'Tester', (s) => { const m = JSON.parse(s); if (m.t !== 'snap') events.push(m); });
  room.wave = wave - 1; room.timer = 0;
  p.x = px; p.z = pz;
  for (let i = 0; i < 20 * secs; i++) {
    p.hp = 100; p.downed = false; p.dead = false;   // keep the tester standing
    room.step();
    if (each && each(room, p, events) === false) break;
  }
  return { room, p, events };
}

// ---- round 10
{
  const types = new Set(); let shot = 0, killed = 0;
  const { room, events } = run(LOCALS_WAVE, 0, 20, 150, (room, p) => {
    for (const c of room.cows.values()) {
      types.add(c.type);
      // shoot the nearest one in the chest once it's close
      if (c.state !== 'dead' && Math.hypot(c.x - p.x, c.z - p.z) < 12 && room.time - p.lastShot > 0.2) {
        const o = [p.x, heightAt(p.x, p.z) + 1.6, p.z], tgt = [c.x, heightAt(c.x, c.z) + c.y + 1.25, c.z];
        const d = tgt.map((v, i) => v - o[i]);
        const before = c.hp;
        room.onShoot(p, { w: 'rifle', o, d });
        if (c.hp < before) shot++;
        if (c.state === 'dead') killed++;
      }
    }
  });
  const wave = events.find(e => e.t === 'wave');
  console.log('round 10:', { kind: wave.kind, count: wave.count, types: [...types], hurtPlayer: events.filter(e => e.t === 'hurt').length, shotsThatHit: shot, killed, phase: room.phase, wave: room.wave });
}

// ---- round 20, player out in the yard
{
  let boss = null, minDist = Infinity, everInside = false, instaTried = false, hpAfterInsta = null;
  const { room, events } = run(BOSS_WAVE, 0, 24, 240, (room, p) => {
    boss = boss || [...room.cows.values()].find(c => c.type === 'rafael');
    if (!boss) return;
    if (boss.state !== 'dead') { minDist = Math.min(minDist, Math.hypot(boss.x - p.x, boss.z - p.z)); if (insideHouse(boss.x, boss.z)) everInside = true; }
    if (!instaTried && room.time > 20) { // insta-kill must not one-shot him
      instaTried = true; room.instakill = 5;
      room.damageCow(p, boss, 30, false, [boss.x, 2, boss.z], [0, 0, 1]);
      hpAfterInsta = boss.hp; room.instakill = 0;
    }
    if (room.time > 60 && boss.state !== 'dead') room.damageCow(p, boss, 400, true, [boss.x, 4, boss.z], [0, 0, 1]);
  });
  console.log('round 20 (yard):', {
    kind: events.find(e => e.t === 'wave').kind, bossMaxHp: boss?.maxHp, hpAfterInstaKillShot: hpAfterInsta,
    closest: +minDist.toFixed(1), bottles: events.filter(e => e.t === 'bottle').length, smashes: events.filter(e => e.t === 'smash').length,
    hurts: events.filter(e => e.t === 'hurt').length, everInside, bossDead: boss?.state === 'dead' || !room.cows.has(boss?.id),
  });
}

// ---- round 20, player hiding in the house: he must not get in, but bottles still land
{
  let boss = null, everInside = false, atEntry = false;
  const { events } = run(BOSS_WAVE, -6, 0, 150, (room) => {
    boss = boss || [...room.cows.values()].find(c => c.type === 'rafael');
    if (!boss) return;
    if (insideHouse(boss.x, boss.z)) everInside = true;
    if (boss.entry != null) atEntry = true;
  });
  console.log('round 20 (hiding indoors):', { everInside, reachedAnOpening: atEntry, bottles: events.filter(e => e.t === 'bottle').length, hurts: events.filter(e => e.t === 'hurt').length, reach: COW_TYPES.rafael.reach });
}

// ---- which rounds get what: only round 10 has locals alone, only round 20 has Rafael,
// and from 21 on it is cows again
{
  const room = new Room('mix', () => {}); clearInterval(room.interval);
  room.addPlayer(1, 'Tester', () => {});
  const out = {};
  for (const w of [9, 10, 11, 19, 20, 21, 30, 40]) {
    room.wave = w - 1; room.startWave();
    const n = {}; for (const t of room.toSpawn) n[t] = (n[t] || 0) + 1;
    out[w] = n;
  }
  console.log('wave make-up:', out);
}
