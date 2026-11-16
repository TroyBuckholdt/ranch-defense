// Headless test of the trucks. Usage: node scripts/drivetest.js
//   1. an autopilot drives each truck from where it is parked, out of the gate and down the
//      road to the beach, using the same simulation the driver's browser runs
//   2. server rules: getting in, the truck following the driver's reports, riders carried
//      along, running cows over, getting out
import { Room } from '../server/game.js';
import { Driving } from '../client/src/vehicle.js';
import { VEHICLES, ROAD, ROAD_HALF, roadDist, heightAt, shoreZ, vehicleGap, SOLIDS } from '../shared/world.js';

function autopilot(def, route) {
  const d = new Driving(def);
  let wp = 0, t = 0, worst = 0, bumps = 0, top = 0, offRoad = 0;
  const dt = 1 / 60;
  while (t < 180 && wp < route.length) {
    const [tx, tz] = route[wp];
    if (Math.hypot(tx - d.x, tz - d.z) < 5) { wp++; continue; }
    let err = Math.atan2(tx - d.x, tz - d.z) - d.yaw;
    err = Math.atan2(Math.sin(err), Math.cos(err));
    const backing = Math.abs(err) > 1.9 && Math.abs(d.speed) < 2;            // pointing away: back out and swing round
    const throttle = backing ? -1 : Math.abs(err) > 0.6 && d.speed > 6 ? -0.4 : d.speed > 13 ? 0 : 1;
    const b = d.step(dt, { throttle, steer: Math.max(-1, Math.min(1, (backing ? -err : err) * 2.2)) });
    if (b > 1) { bumps++; worst = Math.max(worst, b); }
    top = Math.max(top, d.speed);
    if (wp > 2 && roadDist(d.x, d.z) > ROAD_HALF) offRoad += dt;
    t += dt;
  }
  return { reachedBeach: wp >= route.length, seconds: +t.toFixed(1), topSpeed: +top.toFixed(1), bumps, worstBump: +worst.toFixed(1), secondsOffRoad: +offRoad.toFixed(1), end: [+d.x.toFixed(1), +d.z.toFixed(1)], shore: +shoreZ(d.x).toFixed(1) };
}
const beach = ROAD.slice(1);
console.log('chevy -> beach:', autopilot(VEHICLES[1], beach));
// the F-150 pulls forward out of the carport past the boat, then joins the driveway
console.log('f150  -> beach:', autopilot(VEHICLES[0], [[18.3, 8], [18.5, 16], [16, 26], ...beach]));
console.log('road: steepest step', Math.max(...ROAD.slice(1).map((p, i) => Math.abs(heightAt(p[0], p[1]) - heightAt(ROAD[i][0], ROAD[i][1])) / Math.hypot(p[0] - ROAD[i][0], p[1] - ROAD[i][1]))).toFixed(2),
  '| solids within the road:', SOLIDS.filter(b => b.h > 0.4 && roadDist(b.x, b.z) < ROAD_HALF + Math.max(b.w, b.d) / 2 && b.kind !== 'fence').map(b => b.kind));

// ---- server rules
{
  const room = new Room('drive', () => {}); clearInterval(room.interval);
  const ev = [];
  const a = room.addPlayer(1, 'Driver', (s) => { const m = JSON.parse(s); if (m.t !== 'snap') ev.push(m); });
  const b = room.addPlayer(2, 'Rider', () => {});
  const v = room.vehicles[1];
  room.onVehicle(a, { a: 'in', id: v.id });
  const tooFar = !a.veh;                                   // still indoors: must be refused
  a.x = v.x + 1.8; a.z = v.z; b.x = v.x - 1.8; b.z = v.z;
  room.onVehicle(a, { a: 'in', id: v.id }); room.onVehicle(b, { a: 'in', id: v.id });
  const seats = [...v.seats];
  // drive 30 m south at 12 m/s, with a cow standing in the way
  room.phase = 'wave'; room.wave = 1;
  room.cows.set(99, { id: 99, type: 'walker', x: v.x + Math.sin(v.yaw) * 14, y: 0, z: v.z + Math.cos(v.yaw) * 14, yaw: 0, hp: 100, maxHp: 100, state: 'walk', entry: null, tearT: 1, vaultT: 0, attackCd: 9, stagger: 0, speedMul: 0, deadAt: 0 });
  const x0 = v.x, z0 = v.z, yaw = v.yaw;
  for (let i = 1; i <= 50; i++) {
    const dist = i * 0.6;
    room.onState(a, { p: [0, 0, 0], yaw: 0, pitch: 0, v: [x0 + Math.sin(yaw) * dist, z0 + Math.cos(yaw) * dist, yaw, 12, 0] });
    a.hp = b.hp = 100; room.step();
  }
  const cow = room.cows.get(99);
  const moved = Math.hypot(v.x - x0, v.z - z0);
  const riderCarried = Math.hypot(b.x - v.x, b.z - v.z) < 2.5;
  room.onState(a, { p: [0, 0, 0], yaw: 0, pitch: 0, v: [v.x + 80, v.z, yaw, 12, 0] });   // a teleport must be ignored
  const jumpRefused = Math.hypot(v.x - x0, v.z - z0) - moved < 1;
  room.onVehicle(a, { a: 'out' }); room.step();
  console.log('server:', {
    refusedFromIndoors: tooFar, seats, truckMoved: +moved.toFixed(1), riderCarried, cowRunOver: !cow || cow.state === 'dead', ramEvents: ev.filter(e => e.t === 'ram').length,
    jumpRefused, driverOutBesideTruck: !a.veh && vehicleGap(v, v.def, a.x, a.z) < 1.5 && vehicleGap(v, v.def, a.x, a.z) > 0.3, seatsAfter: [...v.seats], stoppedWhenDriverLeft: v.speed === 0,
  });
}
