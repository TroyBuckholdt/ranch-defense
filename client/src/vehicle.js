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
    this.model = model;
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

  // First person in the cab. The truck models are hollow shells with nothing inside, so a
  // rider up front gets a cab built here (dash, pillars, doors, roof, wheel, seats) and the
  // shell stops drawing its inside faces: out of the windows you see the real hood and bed.
  setCabin(on) {
    if (on === !!this.cabinOn) return;
    this.cabinOn = on;
    if (on && !this.cabin) { this.cabin = buildCabin(this.def); this.body.add(this.cabin); }
    if (this.cabin) this.cabin.visible = on;
    this.model.traverse(o => {
      if (!o.isMesh) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (m.userData.side0 === undefined) m.userData.side0 = m.side;
        m.side = on ? THREE.FrontSide : m.userData.side0;
        m.needsUpdate = true;
      }
    });
  }

  dispose() { this.scene.remove(this.root); }
}

// The cab, in the truck's own frame: x to the left, z forward, y up from the ground.
function buildCabin(def) {
  const g = new THREE.Group();
  const hw = def.w / 2 - 0.1, top = def.h - 0.07;
  const trim = new THREE.MeshStandardMaterial({ color: 0x24262a, roughness: 0.85 });
  const soft = new THREE.MeshStandardMaterial({ color: 0x3a3d43, roughness: 0.95 });
  const liner = new THREE.MeshStandardMaterial({ color: 0x8d8f8c, roughness: 1 });
  const cloth = new THREE.MeshStandardMaterial({ color: 0x4a4038, roughness: 1 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xb9bcc0, roughness: 0.3, metalness: 0.8 });
  const box = (mat, w, h, d, x, y, z, rx = 0, rz = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z); m.rotation.set(rx, 0, rz); g.add(m); return m;
  };
  const sill = 1.2;                                    // bottom of the windows
  box(soft, hw * 2, 0.05, 2.1, 0, 0.42, 0.5);          // floor
  box(trim, hw * 2, 0.5, 0.55, 0, sill - 0.27, 1.27);  // dashboard
  box(soft, hw * 2, 0.05, 0.42, 0, sill - 0.01, 1.42, 0.12); // dash top, sloping to the glass
  box(trim, 0.5, 0.11, 0.2, 0.45, sill + 0.04, 1.08);  // instrument hood
  box(trim, 0.34, 0.22, 0.05, 0, sill - 0.2, 0.99);    // radio
  box(chrome, 0.26, 0.012, 0.052, 0, sill - 0.13, 0.99);
  box(trim, 0.42, 0.02, 0.052, -0.45, sill - 0.24, 0.995); // glovebox seam
  for (const x of [-0.82, -0.2, 0.2, 0.82]) box(soft, 0.16, 0.07, 0.052, x, sill - 0.08, 0.995); // vents
  box(liner, hw * 2, 0.05, 1.75, 0, top, 0.33);        // roof lining
  box(trim, hw * 2, 0.09, 0.1, 0, top - 0.04, 1.16);   // windshield header
  box(trim, hw * 2, 0.09, 0.1, 0, top - 0.04, -0.5);   // rear header
  box(trim, hw * 2, 0.8, 0.08, 0, sill - 0.4, -0.52);  // back wall, under the rear window
  box(trim, 0.3, 0.3, 1.0, 0, 0.6, 0.35);              // centre console
  box(chrome, 0.07, 0.07, 0.07, 0, 0.82, 0.55);        // shifter knob
  box(trim, 0.03, 0.16, 0.03, 0, 0.75, 0.55);
  for (const s of [1, -1]) {
    box(trim, 0.09, sill - 0.42, 2.0, s * (hw + 0.02), (sill + 0.42) / 2, 0.49);    // door
    box(soft, 0.14, 0.05, 0.7, s * (hw - 0.07), sill - 0.22, 0.35);                 // armrest
    box(chrome, 0.02, 0.03, 0.14, s * (hw - 0.03), sill - 0.1, 0.75);               // door handle
    box(trim, 0.09, top - sill, 0.13, s * (hw + 0.02), (top + sill) / 2, -0.47);    // B pillar
    box(trim, 0.09, 0.07, 1.7, s * (hw + 0.02), top - 0.05, 0.33);                  // roof rail
    // A pillar: from the corner of the dash up and back to the roof
    const a = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1, 0.1), trim);
    const lo = new THREE.Vector3(s * (hw + 0.02), sill, 1.6), hi = new THREE.Vector3(s * hw, top - 0.02, 1.16);
    a.position.copy(lo).add(hi).multiplyScalar(0.5); a.scale.y = lo.distanceTo(hi);
    a.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), hi.clone().sub(lo).normalize()); g.add(a);
    box(cloth, 0.56, 0.14, 0.56, s * 0.45, 0.62, 0.2);                              // seat
    box(cloth, 0.56, 0.72, 0.14, s * 0.45, 1.02, -0.22, -0.12);                     // seat back
    box(cloth, 0.26, 0.2, 0.1, s * 0.45, 1.5, -0.3);                                // headrest
    box(soft, 0.34, 0.012, 0.16, s * 0.45, top - 0.035, 1.02);                      // sun visor
  }
  // steering wheel and column on the left
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.022, 8, 24), trim);
  wheel.position.set(0.45, sill - 0.06, 0.9); wheel.rotation.x = -0.45; g.add(wheel);
  box(trim, 0.34, 0.035, 0.03, 0.45, sill - 0.06, 0.9, -0.45);
  box(trim, 0.07, 0.07, 0.32, 0.45, sill - 0.11, 1.03, -0.45);
  // rear-view mirror, with a pine-tree air freshener hanging off it
  box(trim, 0.26, 0.075, 0.03, 0, top - 0.2, 1.1);
  box(chrome, 0.24, 0.06, 0.005, 0, top - 0.2, 1.083);
  box(trim, 0.02, 0.12, 0.02, 0, top - 0.11, 1.12);
  const pine = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.11, 3), new THREE.MeshStandardMaterial({ color: 0x2f8f3a, roughness: 0.9 }));
  pine.scale.z = 0.15; pine.position.set(0.02, top - 0.36, 1.08); g.add(pine);
  box(trim, 0.004, 0.1, 0.004, 0.02, top - 0.27, 1.08);
  g.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; } });
  g.visible = false;
  return g;
}
