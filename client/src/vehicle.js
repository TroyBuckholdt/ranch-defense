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

  // First person in the cab. The truck models are hollow shells with nothing inside, so for
  // a rider up front the model is swapped for a cab built here (dash, pillars, doors, roof,
  // wheel, seats) with a hood ahead and the bed behind in the truck's own colour.
  setCabin(on) {
    if (on === !!this.cabinOn) return;
    this.cabinOn = on;
    if (on && !this.cabin) { this.cabin = buildCabin(this.def); this.body.add(this.cabin); }
    if (this.cabin) this.cabin.visible = on;
    this.model.visible = !on;
  }

  dispose() { this.scene.remove(this.root); }
}

const PAINT = { f150: 0x8a9096, chevy: 0xe9e9e6 };
// How the cab is laid out (metres above the ground / forward of the truck's middle). The
// pickups ride tall: floor at 0.75, windows from 1.36 to the roof.
export const CAB = { floor: 0.75, sill: 1.36, eye: 1.63, back: -1.1, glass: 1.42 };

// The cab, in the truck's own frame: x to the left, z forward, y up from the ground.
function buildCabin(def) {
  const g = new THREE.Group();
  const hw = def.w / 2 - 0.1, top = def.h - 0.06;
  const { floor, sill, back, glass } = CAB;
  // (a little self-glow on the trim: the cab is in its own shade and would otherwise go black)
  const std = (color, roughness, metalness = 0, glow = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness, emissive: color, emissiveIntensity: glow });
  const trim = std(0x2b2d31, 0.8, 0, 0.35), soft = std(0x41444a, 0.95, 0, 0.3), liner = std(0xa3a39d, 1, 0, 0.3), cloth = std(0x5a4d40, 1, 0, 0.25);
  const chrome = std(0xc4c7ca, 0.25, 0.85), paint = std(PAINT[def.kind] || 0x8a9096, 0.35, 0.6), black = std(0x15161a, 0.6);
  const box = (mat, w, h, d, x, y, z, rx = 0, rz = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z); m.rotation.set(rx, 0, rz); g.add(m); return m;
  };
  const beam = (mat, t, a, b) => {                      // a bar from a to b
    const m = new THREE.Mesh(new THREE.BoxGeometry(t, 1, t), mat);
    m.position.copy(a).add(b).multiplyScalar(0.5); m.scale.y = a.distanceTo(b);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()); g.add(m); return m;
  };
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const header = 0.72;                                  // where the windshield meets the roof
  // outside: hood, wipers, mirrors, and the bed behind
  box(paint, def.w - 0.12, 0.3, 1.5, 0, sill - 0.2, glass + 0.78, 0.035);
  box(paint, 0.5, 0.035, 1.1, 0, sill - 0.035, glass + 0.75, 0.035);   // hood bulge
  box(black, def.w - 0.3, 0.03, 0.12, 0, sill - 0.02, glass + 0.06);     // cowl
  for (const s of [1, -1]) {
    box(black, 0.2, 0.15, 0.08, s * (hw + 0.26), sill + 0.14, glass - 0.32);              // door mirror
    box(chrome, 0.17, 0.12, 0.01, s * (hw + 0.26), sill + 0.14, glass - 0.365);
    box(black, 0.14, 0.04, 0.05, s * (hw + 0.12), sill + 0.1, glass - 0.32);
    box(paint, 0.09, sill - 0.82, 1.85, s * (hw + 0.02), (sill + 0.82) / 2, back - 0.98);  // bed side
    box(black, 0.11, 0.03, 1.85, s * (hw + 0.02), sill + 0.01, back - 0.98);               // bed rail cap
  }
  box(paint, hw * 2, sill - 0.82, 0.08, 0, (sill + 0.82) / 2, back - 1.9);                 // tailgate
  box(black, hw * 2, 0.04, 1.85, 0, 0.84, back - 0.98);                                    // bed floor
  // inside
  box(soft, hw * 2, 0.05, glass - back, 0, floor, (glass + back) / 2);                     // floor
  box(trim, hw * 2, 0.5, 0.42, 0, sill - 0.29, glass - 0.3);                               // dashboard
  box(soft, hw * 2, 0.05, 0.5, 0, sill - 0.02, glass - 0.22, 0.1);                         // dash top
  box(trim, 0.5, 0.1, 0.22, 0.45, sill + 0.03, glass - 0.4);                               // instrument hood
  const face = glass - 0.515;
  box(black, 0.36, 0.2, 0.02, 0, sill - 0.19, face);                                       // radio
  box(chrome, 0.3, 0.012, 0.025, 0, sill - 0.1, face);
  for (const x of [-0.12, 0, 0.12]) box(chrome, 0.045, 0.045, 0.03, x, sill - 0.33, face); // heater knobs
  box(black, 0.44, 0.012, 0.025, -0.45, sill - 0.2, face);                                 // glovebox seam
  box(chrome, 0.08, 0.02, 0.03, -0.45, sill - 0.24, face);
  for (const x of [-0.84, -0.24, 0.24, 0.84]) box(black, 0.15, 0.065, 0.025, x, sill - 0.09, face); // vents
  box(liner, hw * 2, 0.05, header - back, 0, top, (header + back) / 2);                    // roof lining
  box(trim, hw * 2, 0.08, 0.1, 0, top - 0.04, header);                                     // windshield header
  box(trim, hw * 2, 0.08, 0.1, 0, top - 0.04, back + 0.04);                                // rear header
  box(trim, hw * 2, sill - floor, 0.08, 0, (sill + floor) / 2, back);                      // back wall
  box(trim, 0.3, 0.3, 1.0, 0, floor + 0.17, 0.4);                                          // centre console
  box(trim, 0.03, 0.16, 0.03, 0, floor + 0.36, 0.62); box(black, 0.05, 0.05, 0.05, 0, floor + 0.45, 0.62); // shifter
  box(cloth, hw * 2 - 0.12, 0.14, 0.5, 0, floor + 0.2, back + 0.36);                       // rear bench
  box(cloth, hw * 2 - 0.12, 0.6, 0.13, 0, floor + 0.52, back + 0.12, -0.1);
  for (const s of [1, -1]) {
    box(trim, 0.09, sill - floor, glass - back, s * (hw + 0.02), (sill + floor) / 2, (glass + back) / 2); // doors
    box(soft, 0.13, 0.05, 0.6, s * (hw - 0.07), sill - 0.16, 0.45);                        // armrest
    box(chrome, 0.02, 0.03, 0.13, s * (hw - 0.03), sill - 0.07, 0.85);                     // door handle
    box(trim, 0.09, top - sill, 0.14, s * (hw + 0.02), (top + sill) / 2, -0.05);           // B pillar
    box(trim, 0.09, top - sill, 0.12, s * (hw + 0.02), (top + sill) / 2, back + 0.04);     // C pillar
    box(trim, 0.09, 0.06, header - back, s * (hw + 0.02), top - 0.05, (header + back) / 2); // roof rail
    beam(trim, 0.1, V(s * (hw + 0.02), sill, glass), V(s * (hw - 0.01), top - 0.02, header)); // A pillar
    box(cloth, 0.54, 0.13, 0.52, s * 0.45, floor + 0.21, 0.42);                            // seat
    // seat backs stop below eye level (no headrests), so looking back shows the rear window and the bed
    box(cloth, 0.54, 0.48, 0.13, s * 0.45, floor + 0.43, 0.08, -0.14);
    box(soft, 0.36, 0.012, 0.15, s * 0.45, top - 0.035, header - 0.14);                    // sun visor
    beam(black, 0.018, V(s * 0.1, sill - 0.01, glass + 0.04), V(s * 0.62, sill + 0.03, glass + 0.0)); // wiper
  }
  // steering wheel and column on the left
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.022, 8, 24), black);
  wheel.position.set(0.45, sill - 0.07, glass - 0.62); wheel.rotation.x = -0.42; g.add(wheel);
  box(black, 0.34, 0.035, 0.03, 0.45, sill - 0.07, glass - 0.62, -0.42);
  box(black, 0.07, 0.07, 0.12, 0.45, sill - 0.09, glass - 0.57, -0.42);
  // rear-view mirror, with a pine-tree air freshener hanging off it
  box(black, 0.22, 0.06, 0.03, 0, top - 0.1, header + 0.1);
  box(chrome, 0.2, 0.045, 0.005, 0, top - 0.1, header + 0.083);
  box(black, 0.02, 0.05, 0.02, 0, top - 0.05, header + 0.1);
  const pine = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.09, 3), std(0x2f8f3a, 0.9));
  pine.scale.z = 0.15; pine.position.set(0.02, top - 0.25, header + 0.09); g.add(pine);
  box(black, 0.004, 0.07, 0.004, 0.02, top - 0.17, header + 0.09);
  g.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; } });
  g.visible = false;
  return g;
}
