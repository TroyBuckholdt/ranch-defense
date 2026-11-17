// The jokes: feed quips, spoken lines and the end-of-game awards (shared/banter.js).
import { Room } from '../server/game.js';
import { BANTER_ES, awards, newStats } from '../shared/banter.js';
const fail = (m) => { console.error('FAIL', m); process.exit(1); };
const room = new Room('t', () => {}); clearInterval(room.interval);
const ev = [];
const a = room.addPlayer(1, 'Troy', s => ev.push(JSON.parse(s)), 'p1');
const b = room.addPlayer(2, 'Rafael', () => {}, 'p4');
const chats = () => ev.flatMap(m => m.t === 'events' ? m.list : m.events || [m]).filter(m => m.t === 'chat');
const all = () => JSON.stringify(ev);
if (!all().includes('joined the ranch') && !all().includes('showed up') && !all().includes('Allegedly')) fail('no join line');
// every line the server can send has Spanish
for (const [en, es] of Object.entries(BANTER_ES)) if (!es || es === en) fail('no Spanish for: ' + en);
// Rafael goes down to a cow, Troy revives him
room.phase = 'wave';
for (let i = 0; i < 3; i++) {
  ev.length = 0;
  room.hurtPlayer(b, 999, { x: 0, z: 0, type: 'walker' });
  if (!b.downed) fail('not downed');
  const s = all();
  if (!s.includes('is down!')) fail('the revive instruction is gone');
  if ((s.match(/"t":"chat"/g) || []).length < 2) fail('no joke after going down: ' + s);
  a.x = b.x; a.z = b.z; a.using = true;
  for (let n = 0; n < 20 * 8 && b.downed; n++) room.updatePlayers(0.05, [a, b], [a]);
  if (b.downed) fail('not revived');
}
if (b.st.downs !== 3 || a.st.revives !== 3) fail('stats: ' + JSON.stringify([a.st, b.st]));
if (!/again|habit/.test(all())) fail('third revive should say "again": ' + all());
// awards
a.kills = 40; a.st.heads = 9; a.st.shots = 100; a.st.hits = 80; b.st.shots = 60; b.st.hits = 6; b.st.toys = 1; b.st.ram = 4;
const aw = awards([a, b]);
const who = (k) => aw.find(x => x.k === k)?.n;
if (who('Top Rancher') !== 'Troy' || who('Sharpshooter') !== 'Troy' || who('Guardian Angel') !== 'Troy') fail('Troy awards ' + JSON.stringify(aw));
if (who('Floor Inspector') !== 'Rafael' || who('Road Rage') !== 'Rafael' || who('Spray and Pray') !== 'Rafael') fail('Rafael awards ' + JSON.stringify(aw));
if (aw.find(x => x.k === 'Spray and Pray').v !== 10) fail('accuracy');
if (awards([{ name: 'x', kills: 0, st: newStats() }]).length) fail('nobody earned anything, but awards were given');
console.log(aw.map(x => `${x.k}: ${x.n} (${x.d.replace('{0}', x.v)})`).join('\n'));
console.log('banter test passed');
process.exit(0);
