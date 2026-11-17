// The two pickups. `Driving` is the driver's own simulation (their client decides where the
// truck goes and tells the server, the same way players move themselves); `VehicleView`
// draws a truck for everyone: sitting on the terrain, wheels spinning and steering.
import * as THREE from 'three';
import { DRIVE, ROAD_HALF, VEHICLE_SEATS, heightAt, shoreZ, roadDist, resolveCircle, vehicleWorld, YARD, SAND_WIDTH, inPond, junglePatch } from '../../shared/world.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const BODY = [1.85, 0, -1.85];   // collision circles along the truck
const BODY_R = 1.05;

// how fast the ground under (x, z) lets a truck go
export function surfaceSpeed(x, z) {
  if (z > shoreZ(x) + 1 || inPond(x, z)) return DRIVE.maxWet;                 // in the surf / the pond
  if (roadDist(x, z) < ROAD_HALF + 0.5) return DRIVE.max;                        // the road
  if (x > YARD.minX - 6 && x < YARD.maxX + 6 && z > YARD.minZ - 6 && z < YARD.maxZ + 6) return DRIVE.max * 0.8; // lawn
  if (z > shoreZ(x) - SAND_WIDTH) return DRIVE.max * 0.75;                       // beach sand
  return junglePatch(x, z) < 0.5 ? DRIVE.max * 0.7 : DRIVE.maxOff;              // pasture / jungle floor
}

export class Driving {
  constructor(v) { this.x = v.x; this.z = v.z; this.yaw = v.yaw; this.speed = 0; this.steer = 0; this.bump = 0; }

  // input: throttle -1..1 (negative brakes, then reverses), steer -1..1 (+ = left), handbrake
  step(dt, { throttle = 0, steer = 0, handbrake = false }) {
    const top = surfaceSpeed(this.x, this.z);
    let sp = this.speed;
    if (handbrake) sp -= Math.sign(sp) * Math.min(Math.abs(sp), DRIVE.brake * 1.3 * dt);
    else if (throttle > 0) sp += (sp < 0 ? DRIVE.brake : DRIVE.accel * Math.max(0, 1 - sp / top)) * throttle * dt;
    else if (throttle < 0) sp += (sp > 0.3 ? DRIVE.brake : DRIVE.accel * 0.7 * Math.max(0, 1 + sp / DRIVE.reverse)) * throttle * dt;
    else sp -= Math.sign(sp) * Math.min(Math.abs(sp), 2.2 * dt);                // coasting
    if (sp > top) sp -= Math.min(sp - top, 9 * dt);                             // soft ground drags it down
    sp -= sp * 0.08 * dt;
    // steering eases in, and has less lock the faster you go
    const lock = DRIVE.steer / (1 + Math.abs(sp) * 0.085);
    this.steer += (clamp(steer, -1, 1) - this.steer) * Math.min(1, dt * 6);
    this.yaw += (sp / DRIVE.wheelbase) * Math.tan(this.steer * lock) * dt;
    const fs = Math.sin(this.yaw), fc = Math.cos(this.yaw);
    let x = this.x + fs * sp * dt, z = this.z + fc * sp * dt;

    // collide: three circles along the body against the map's solids
    let hit = 0;
    for (let iter = 0; iter < 2; iter++) {
      for (const off of BODY) {
        const cx = x + fs * off, cz = z + fc * off;
        const [rx, rz] = resolveCircle(cx, cz, BODY_R, 0, 0.4);
        const dx = rx - cx, dz = rz - cz;
        if (dx * dx + dz * dz < 1e-8) continue;
        x += dx; z += dz;
        const along = (dx * fs + dz * fc) * Math.sign(sp || 1); // negative = pushed back against travel
        if (along < -1e-4) hit = Math.max(hit, Math.min(1, -along / Math.max(1e-3, Math.abs(sp) * dt)));
        // a knock on the nose or tail swings the truck round a little
        this.yaw += clamp((dx * fc - dz * fs) * off * 0.05, -0.04, 0.04);
      }
    }
    if (hit > 0.2) { this.bump = Math.max(this.bump, Math.abs(sp) * hit); sp *= 1 - 0.9 * hit; }
    this.x = x; this.z = z; this.speed = sp;
    const b = this.bump; this.bump = 0;
    return b; // how hard it hit something this step (m/s), for sound and shake
  }
}

// Finds the wheels in a truck model that tools/blender/split_wheels.py has cut apart.
function findWheels(model) {
  const wheels = [];
  model.updateMatrixWorld(true);
  model.traverse(o => { if (/^Wheel_/.test(o.name)) wheels.push(o); });
  const zs = wheels.map(w => w.getWorldPosition(new THREE.Vector3()));
  return wheels.map((w, i) => { w.rotation.order = 'YXZ'; return { node: w, front: zs[i].z > 0, radius: Math.max(0.3, zs[i].y) }; });
}

export class VehicleView {
  constructor(def, model, scene) {
    this.def = def; this.scene = scene;
    this.root = new THREE.Group();       // position, yaw, terrain pitch/roll
    this.body = new THREE.Group();       // suspension: squat, dive, lean
    this.root.rotation.order = 'YXZ';
    this.root.add(this.body); this.body.add(model);
    scene.add(this.root);
    this.wheels = findWheels(model);
    this.spin = 0; this.lastSpeed = 0; this.lean = 0; this.dive = 0; this.y = null;
    // brake / reverse lights and headlights are painted on the model; one soft glow for night-ish shade
    this.x = def.x; this.z = def.z; this.yaw = def.yaw; this.speed = 0;
  }

  // s: { x, z, yaw, speed, steer }
  apply(s, dt) {
    this.x = s.x; this.z = s.z; this.yaw = s.yaw; this.speed = s.speed;
    const { l, w } = this.def;
    const at = (left, fwd) => { const [x, z] = vehicleWorld(s, left, fwd); return Math.max(heightAt(x, z), -0.35); };
    const ax = l * 0.32, tx = w * 0.42;
    const fl = at(tx, ax), fr = at(-tx, ax), rl = at(tx, -ax), rr = at(-tx, -ax);
    const y = (fl + fr + rl + rr) / 4;
    const pitch = Math.atan2((rl + rr) / 2 - (fl + fr) / 2, ax * 2);
    const roll = Math.atan2((fr + rr) / 2 - (fl + rl) / 2, tx * 2);     // + = right side high
    const k = this.y == null ? 1 : Math.min(1, dt * 12);
    this.y = this.y == null ? y : this.y + (y - this.y) * k;
    this.root.position.set(s.x, this.y, s.z);
    const r = this.root.rotation;
    r.y = s.yaw; r.x += (pitch - r.x) * k; r.z += (roll - r.z) * k;
    // suspension: nose dips under braking, body leans out of a turn
    const acc = dt > 0 ? (s.speed - this.lastSpeed) / dt : 0;
    this.lastSpeed = s.speed;
    this.dive += (clamp(-acc * 0.004, -0.035, 0.05) - this.dive) * Math.min(1, dt * 5);
    this.lean += (clamp(-(s.steer || 0) * Math.abs(s.speed) * 0.006, -0.06, 0.06) - this.lean) * Math.min(1, dt * 5);
    this.body.rotation.set(this.dive, 0, this.lean);
    for (const wh of this.wheels) {
      wh.spin = (wh.spin || 0) + (s.speed * dt) / wh.radius;
      wh.node.rotation.set(wh.spin, wh.front ? (s.steer || 0) * DRIVE.steer * 0.9 : 0, 0);
    }
  }

  seatWorld(seat, out) {
    const [left, fwd, h] = VEHICLE_SEATS[seat];
    const [x, z] = vehicleWorld(this, left, fwd);
    return out.set(x, (this.y ?? heightAt(x, z)) + h, z);
  }

  dispose() { this.scene.remove(this.root); }
}
