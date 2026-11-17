// Pepper the thief: she leaves her blanket for a power-up, carries it home, and gives it
// all back when someone visits; touching her on the way takes it off her.
process.env.RD_PEPPER_STEALS = '1';
const { Room } = await import('../server/game.js');
const { BLANKET } = await import('../shared/world.js');
const fail = (m) => { console.error('FAIL', m); process.exit(1); };
const room = new Room('t', () => {}); clearInterval(room.interval);
const ev = [];
const p = room.addPlayer(1, 'Troy', s => ev.push(s));
room.timer = 1e9;                       // no cows
p.x = 30; p.z = 30;                     // out of the way
const pep = room.dogs.find(d => d.kind === 'big' && room.constructor && d.id === 4) || room.dogs[3];
const run = (secs, until) => { for (let i = 0; i < 20 * secs; i++) { room.step(); if (until?.()) return i / 20; } return null; };
if (run(40, () => pep.hidden) === null) fail('Pepper never hid');
room.dropPowerup(0, 14, 'double');     // on the front lawn
if (run(12, () => pep.thief) === null) fail('she ignored it');
const got = run(30, () => pep.thief?.has);
if (got === null) fail(`never reached it, at ${pep.x.toFixed(1)},${pep.z.toFixed(1)}`);
const home = run(40, () => pep.hidden);
if (home === null) fail(`never got home, at ${pep.x.toFixed(1)},${pep.z.toFixed(1)}`);
if (room.powerups.length || pep.stash?.[0] !== 'double') fail('loot not stashed');
console.log(`grabbed it after ${got}s, home ${home}s later`);
// visit the blanket: it all comes back and is picked up
p.x = BLANKET.x - 0.8; p.z = BLANKET.z + 0.8; p.y = 0;
run(1);
if (pep.stash.length || room.doublePts <= 0) fail('stash not returned: ' + JSON.stringify([pep.stash, room.doublePts, room.powerups]));
// second theft (after her rest): catch her on the way home
p.x = 30; p.z = 30; pep.nextSteal = 0; room.instakill = 0;
room.dropPowerup(0, 14, 'instakill');
if (run(40, () => pep.thief?.has) === null) fail('second theft did not happen');
p.x = pep.x + 0.5; p.z = pep.z;
run(0.5);
if (room.instakill <= 0) fail('touching her did not take it back');
if (run(40, () => pep.hidden) === null) fail('she did not go home after being caught');
const all = ev.join('');
for (const k of ['stash', 'Pepper']) if (!all.includes(k)) fail('no feed line with ' + k);
console.log('pepper test passed');
process.exit(0);
