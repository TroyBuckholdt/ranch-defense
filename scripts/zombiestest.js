// Headless test of the Zombies mechanics. Usage: node scripts/zombiestest.js
// power switch, perks (and losing them), Second Wind solo, the mystery box (roll, take,
// toy cow + move, fire sale), El Taller upgrades, the electric fence, the coconut cannon,
// and the Carpenter power-up.
import { Room } from '../server/game.js';
import { POWER, PERK_MACHINES, BOX, PAP, TRAP, stationSpot, weaponStats, maxHealth, MAX_BOARDS } from '../shared/world.js';

const room = new Room('z', () => {}); clearInterval(room.interval);
const ev = [];
const p = room.addPlayer(1, 'Tester', (s) => { const m = JSON.parse(s); if (m.t !== 'snap') ev.push(m); });
const goTo = (m) => { [p.x, p.z] = stationSpot(m); };
const out = {};
const tick = (n = 1) => { for (let i = 0; i < n; i++) room.step(); };
room.phase = 'intermission'; room.timer = 9999;

// ---- perks need power
p.score = 100000;
goTo(PERK_MACHINES[0]); room.onPerk(p, { i: 0 });
out.perkBeforePower = ev.filter(e => e.t === 'denied').map(e => e.why).join() + ' / perks ' + p.perks.length;
goTo(POWER); room.onPower(p);
out.powerOn = room.power;
for (let i = 0; i < PERK_MACHINES.length; i++) { goTo(PERK_MACHINES[i]); room.onPerk(p, { i }); }
out.perksBought = p.perks.join(',') + ` (max 4; fifth refused: ${ev.some(e => e.why === 'full')})`;
out.juggHealth = `${p.hp}/${maxHealth(p.perks)}`;
out.scoreSpent = 100000 - p.score;

// ---- going down alone with Second Wind: back up, perks gone, no game over
room.phase = 'wave'; room.toSpawn = ['walker'];
room.hurtPlayer(p, 9999, { x: 0, z: 0 });
out.downWithSecondWind = { downed: p.downed, selfRevive: p.selfRevive, perksLeft: p.perks.length };
let over = false;
for (let i = 0; i < 20 * 5; i++) { tick(); if (room.phase === 'gameover') over = true; }
out.gotBackUp = { downed: p.downed, hp: p.hp, gameOver: over };
room.cows.clear(); room.toSpawn = []; room.phase = 'intermission'; room.timer = 9999;

// ---- mystery box
p.score = 10000; p.weapons = ['rifle', 'revolver']; p.upg = [];
goTo(BOX.spots[room.box.spot]);
room.onBox(p, {});
const rolled = room.box.weapon;
tick(20 * 4.5);
out.boxRoll = { paid: 10000 - p.score, rolled, stateAfterRoll: room.box.state, notOwnedAlready: !['rifle', 'revolver'].includes(rolled) };
room.onBox(p, { slot: 1 });
out.boxTake = { weapons: p.weapons.join(','), boxIdle: room.box.state === 'idle' };
// force the toy cow
room.box.uses = 99; const mr = Math.random; Math.random = () => 0.0;
const before = p.score, spot0 = room.box.spot;
room.onBox(p, {}); Math.random = mr;
tick(20 * 9);
out.teddy = { weapon: ev.some(e => e.t === 'box' && e.s === 'teddy'), refunded: p.score === before, moved: room.box.spot !== spot0 };
// fire sale
room.fireSale = 30; goTo(BOX.spots[room.box.spot]);
const b2 = p.score; room.onBox(p, {}); out.fireSaleCost = b2 - p.score;
tick(20 * 17); room.fireSale = 0;

// ---- El Taller
p.score = 10000; p.weapons = ['rifle', 'revolver']; p.upg = [];
goTo(PAP); room.onPap(p, { w: 'rifle' });
tick(20 * 4);
const s0 = weaponStats('rifle'), s1 = weaponStats('rifle', true);
out.upgrade = { upgraded: p.upg.join(','), cost: 10000 - p.score, damage: `${s0.damage} -> ${s1.damage}`, mag: `${s0.mag} -> ${s1.mag}`, name: s1.name };
room.onPap(p, { w: 'rifle' }); out.upgradeTwiceRefused = ev.some(e => e.t === 'denied' && e.why === 'done');

// ---- electric fence: a cow standing in the gateway
const cow = (id, x, z, type = 'walker') => room.cows.set(id, { id, type, x, y: 0, z, yaw: 0, hp: 300, maxHp: 300, state: 'walk', entry: null, tearT: 1, vaultT: 0, attackCd: 9, stagger: 0, speedMul: 0, deadAt: 0 });
room.phase = 'wave'; room.toSpawn = ['walker'];
p.x = 0; p.z = 0; cow(501, TRAP.zone.x, TRAP.zone.z);
goTo(TRAP); room.onTrap(p, {});
tick(20 * 1.5);
out.trap = { on: room.trap.on > 0, cowKilled: room.cows.get(501)?.state === 'dead' };

// ---- coconut cannon: fired straight at a cow 15 m away
room.cows.clear(); cow(601, 0, 35); cow(602, 2.5, 36);
p.weapons = ['coconut', 'revolver']; p.cur = 0; p.lastShot = -9; p.x = 0; p.z = 20; p.y = 0;
room.onShoot(p, { w: 'coconut', o: [0, 1.4, 20.5], d: [0, 0.03, 1] });
tick(20 * 2);
out.coconut = { boom: ev.some(e => e.t === 'boom' && e.coco), killed: [601, 602].filter(id => room.cows.get(id)?.state === 'dead').length };

// ---- carpenter
room.boards = room.boards.map(() => 0);
room.powerups.push({ id: 9999, type: 'carpenter', x: p.x, z: p.z, t: 25 });
tick(2);
out.carpenter = room.boards.every(b => b === MAX_BOARDS);

console.log(JSON.stringify(out, null, 1));
