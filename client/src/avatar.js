// Other players as seen by you: the real people from the ranch photos, generated as 3D
// characters (fal: Nano Banana Pro -> Rodin -> Meshy rigging, Mixamo skeleton).
// Legs come from the walk/run animation clips; the upper body is posed in code to hold
// the rifle and aim wherever that player is looking.
import * as THREE from 'three';
import { gltfLoader } from './gltf.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { nameTag } from './textures.js';

export const CHARACTERS = [
  { id: 'p1', label: 'Troy', height: 1.83 },
  { id: 'p2', label: 'Maria', height: 1.62 },
  { id: 'p4', label: 'Rafael', height: 1.76 },
  { id: 'p6', label: 'Rafa', height: 1.82 },
  { id: 'p7', label: 'Julio', height: 1.76 },
  { id: 'p8', label: 'Tere', height: 1.65 },
];

const A = '/assets/models/people/';
const loader = gltfLoader();
const cache = new Map(); // id -> Promise<{scene, walk, run, height}>

export function loadCharacter(id) {
  if (!cache.has(id)) {
    cache.set(id, (async () => {
      const def = CHARACTERS.find(c => c.id === id) || CHARACTERS[0];
      const [body, walk, run] = await Promise.all([
        loader.loadAsync(`${A}${def.id}.glb`),
        loader.loadAsync(`${A}${def.id}_walk.glb`),
        loader.loadAsync(`${A}${def.id}_run.glb`),
      ]);
      body.scene.traverse(o => {
        if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; o.material.roughness = 0.75; o.material.metalness = 0; }
      });
      // normalise to the person's real height, feet on the ground
      const box = new THREE.Box3().setFromObject(body.scene);
      const h = box.max.y - box.min.y;
      return { scene: body.scene, walk: inPlace(walk.animations[0]), run: inPlace(run.animations[0]), scale: def.height / h, minY: box.min.y };
    })());
  }
  return cache.get(id);
}

// Keep the clip "in place": strip the forward travel from the hips so the server
// position drives movement, but keep the up-down bob.
function inPlace(clip) {
  if (!clip) return clip;
  clip = clip.clone();
  for (const t of clip.tracks) {
    if (!t.name.endsWith('.position')) continue;
    const v = t.values, x0 = v[0], z0 = v[2];
    for (let i = 0; i < v.length; i += 3) { v[i] = x0; v[i + 2] = z0; }
  }
  return clip;
}

const GUN_MAT = new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.4, metalness: 0.7 });
const WOOD_MAT = new THREE.MeshStandardMaterial({ color: 0x6a4024, roughness: 0.6 });
const HUSK_MAT = new THREE.MeshStandardMaterial({ color: 0x5b4a2c, roughness: 0.9 });
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _v = new THREE.Vector3(), _d = new THREE.Vector3();
const _S = new THREE.Vector3(), _T = new THREE.Vector3(), _E = new THREE.Vector3(), _n = new THREE.Vector3(), _p = new THREE.Vector3();
const _gq = new THREE.Quaternion(), _aq = new THREE.Quaternion(), _butt = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0), XAXIS = new THREE.Vector3(1, 0, 0);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// Rotate a bone so it points (its +Y axis) along a world-space direction.
function aimBone(bone, dirWorld) {
  bone.updateWorldMatrix(true, false);
  const wq = bone.getWorldQuaternion(_q);
  const cur = _v.set(0, 1, 0).applyQuaternion(wq).normalize();
  const delta = _q2.setFromUnitVectors(cur, dirWorld);
  const target = delta.multiply(wq);
  const parentQ = bone.parent.getWorldQuaternion(_q3).invert();
  bone.quaternion.copy(parentQ.multiply(target));
}

// Turn a bone about a world-space axis (on top of whatever pose it has).
function turnBone(bone, axisWorld, angle) {
  bone.updateWorldMatrix(true, false);
  const wq = bone.getWorldQuaternion(_q);
  const target = _q2.setFromAxisAngle(axisWorld, angle).multiply(wq);
  const parentQ = bone.parent.getWorldQuaternion(_q3).invert();
  bone.quaternion.copy(parentQ.multiply(target));
}

// Turn a hand so its fingers (the bone's +Y) run along `fingers` and its palm (the bone-space
// direction `palmLocal`) faces `palm`, both world directions.
const _a1 = new THREE.Vector3(), _a2 = new THREE.Vector3(), _a3 = new THREE.Vector3(), _mA = new THREE.Matrix4(), _mB = new THREE.Matrix4();
function setHand(bone, fingers, palm, palmLocal) {
  _a1.set(0, 1, 0); _a2.copy(palmLocal).addScaledVector(_a1, -palmLocal.y).normalize(); _a3.crossVectors(_a1, _a2);
  _mA.makeBasis(_a1, _a2, _a3);
  _a1.copy(fingers).normalize(); _a2.copy(palm).addScaledVector(_a1, -palm.dot(_a1)).normalize(); _a3.crossVectors(_a1, _a2);
  _mB.makeBasis(_a1, _a2, _a3).multiply(_mA.transpose());
  bone.parent.updateWorldMatrix(true, false);
  bone.quaternion.copy(bone.parent.getWorldQuaternion(_q3).invert().multiply(_q.setFromRotationMatrix(_mB)));
}

// Two-bone reach: bend `upper` and `lower` so the wrist (or ankle) lands on `target` (world),
// with the elbow or knee pushed toward `pole` (world direction).
function reach(upper, lower, l1, l2, target, pole) {
  upper.updateWorldMatrix(true, false);
  _S.setFromMatrixPosition(upper.matrixWorld);
  _n.copy(target).sub(_S);
  const dist = Math.min(Math.max(_n.length(), Math.abs(l1 - l2) + 0.02), (l1 + l2) * 0.995);
  _n.normalize();
  const a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  _p.copy(pole).addScaledVector(_n, -pole.dot(_n)).normalize();
  _E.copy(_S).addScaledVector(_n, a).addScaledVector(_p, h);
  _T.copy(_S).addScaledVector(_n, dist);
  aimBone(upper, _d.copy(_E).sub(_S).normalize());
  aimBone(lower, _d.copy(_T).sub(_E).normalize());
}

// What each gun looks like from across the yard. The gun's own frame: origin at the butt
// (in the shoulder), +Z along the barrel, +Y up. `grip` / `fore` are where the hands go.
const box = (w, h, d, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); return m; };
const tube = (r, len, mat, y, z, r2 = r) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r2, r, len, 10), mat); m.rotation.x = Math.PI / 2; m.position.set(0, y, z); return m; };
function stockAt(parts, len = 0.3) {   // a wooden butt that drops toward the shoulder, and a pistol grip
  const st = box(0.042, 0.11, len, WOOD_MAT, 0, -0.035, len / 2); st.rotation.x = -0.1; parts.push(st);
  const gr = box(0.04, 0.12, 0.05, WOOD_MAT, 0, -0.085, len + 0.04); gr.rotation.x = 0.3; parts.push(gr);
}
const GUNS = {
  rifle: () => {
    const p = []; stockAt(p);
    const mag = box(0.03, 0.17, 0.065, GUN_MAT, 0, -0.11, 0.47); mag.rotation.x = 0.18;
    p.push(box(0.05, 0.075, 0.26, GUN_MAT, 0, 0.005, 0.42), box(0.046, 0.055, 0.24, WOOD_MAT, 0, -0.005, 0.66), tube(0.013, 0.36, GUN_MAT, 0.012, 0.9),
      mag, box(0.012, 0.03, 0.012, GUN_MAT, 0, 0.05, 1.02), box(0.02, 0.025, 0.05, GUN_MAT, 0, 0.05, 0.36));
    return { parts: p, len: 1.08, grip: 0.34, fore: 0.66 };
  },
  shotgun: () => {
    const p = []; stockAt(p, 0.32);
    p.push(box(0.05, 0.075, 0.22, GUN_MAT, 0, 0.005, 0.42), tube(0.016, 0.62, GUN_MAT, 0.02, 0.84), tube(0.015, 0.5, GUN_MAT, -0.018, 0.78), tube(0.027, 0.2, WOOD_MAT, -0.018, 0.7));
    return { parts: p, len: 1.15, grip: 0.36, fore: 0.7 };
  },
  hunting: () => {
    const p = []; stockAt(p, 0.34);
    p.push(box(0.046, 0.06, 0.5, WOOD_MAT, 0, -0.005, 0.56), tube(0.012, 0.62, GUN_MAT, 0.022, 0.9), tube(0.022, 0.3, GUN_MAT, 0.085, 0.5), tube(0.03, 0.06, GUN_MAT, 0.085, 0.68), box(0.015, 0.03, 0.02, GUN_MAT, 0, 0.055, 0.5));
    return { parts: p, len: 1.21, grip: 0.38, fore: 0.7 };
  },
  lmg: () => {
    const p = []; stockAt(p, 0.3);
    const legL = box(0.012, 0.16, 0.012, GUN_MAT, 0.05, -0.08, 0.98), legR = box(0.012, 0.16, 0.012, GUN_MAT, -0.05, -0.08, 0.98);
    legL.rotation.z = 0.3; legR.rotation.z = -0.3;
    p.push(box(0.065, 0.1, 0.36, GUN_MAT, 0, 0.005, 0.46), box(0.13, 0.13, 0.11, GUN_MAT, 0.02, -0.11, 0.5), tube(0.03, 0.26, GUN_MAT, 0.01, 0.76), tube(0.015, 0.3, GUN_MAT, 0.01, 1.02),
      box(0.02, 0.05, 0.3, GUN_MAT, 0, 0.075, 0.5), legL, legR);
    return { parts: p, len: 1.17, grip: 0.34, fore: 0.72 };
  },
  coconut: () => {
    const p = []; stockAt(p, 0.26);
    p.push(tube(0.07, 0.62, GUN_MAT, 0.02, 0.62), tube(0.085, 0.07, GUN_MAT, 0.02, 0.93), box(0.04, 0.1, 0.05, WOOD_MAT, 0, -0.08, 0.68));
    const nut = new THREE.Mesh(new THREE.SphereGeometry(0.062, 10, 8), HUSK_MAT); nut.position.set(0, 0.02, 0.93); p.push(nut);
    return { parts: p, len: 0.97, grip: 0.3, fore: 0.68 };
  },
  // the revolver is held out in both hands; its frame starts at the back of the grip
  revolver: () => {
    const p = [];
    const gr = box(0.036, 0.12, 0.045, WOOD_MAT, 0, -0.06, 0.02); gr.rotation.x = 0.25; p.push(gr);
    p.push(box(0.034, 0.05, 0.1, GUN_MAT, 0, 0.02, 0.06), tube(0.026, 0.05, GUN_MAT, 0.02, 0.085), tube(0.011, 0.16, GUN_MAT, 0.03, 0.19), box(0.008, 0.02, 0.01, GUN_MAT, 0, 0.05, 0.26));
    return { parts: p, len: 0.27, pistol: true };
  },
};
function buildGun(id) {
  const def = (GUNS[id] || GUNS.rifle)();
  const g = new THREE.Group();
  for (const m of def.parts) { m.castShadow = true; g.add(m); }
  def.group = g;
  return def;
}

const PALM = 0.085;       // wrist to the middle of the palm
const SEAT_HIP = 1.0;    // how high a rider's hips sit above the ground in the cab (the trucks ride tall)
// The heading of the truck a rider is in, if the game's truck views are around to ask.
function nearestTruckYaw(x, z) {
  const views = globalThis.__rd?.truckViews;
  if (!views) return null;
  let best = null, bd = 3.5;
  for (const v of views.values()) { const d = Math.hypot(v.x - x, v.z - z); if (d < bd) { bd = d; best = v.yaw; } }
  return best;
}

export class Avatar {
  constructor(id, name, scene, charId = 'p1') {
    this.scene = scene;
    this.group = new THREE.Group();   // world position + facing
    this.body = new THREE.Group();    // for the downed pose
    this.group.add(this.body);
    scene.add(this.group);
    this.speed = 0; this.last = null; this.ready = false; this.pitch = 0;
    this.sit = 0; this.look = 0; this.heading = null;

    // the gun: placed each frame with its butt in the shoulder and both hands brought to it
    this.gunPivot = new THREE.Group();
    this.body.add(this.gunPivot);
    this.muzzle = new THREE.Object3D();
    this.gunPivot.add(this.muzzle);
    this.setGun('rifle');
    this.gunPivot.position.set(-0.14, 1.35, 0.08);

    const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: nameTag(name), depthTest: false, transparent: true }));
    tag.scale.set(1.4, 0.35, 1); tag.position.y = 2.15; tag.renderOrder = 10;
    this.group.add(tag);
    this.tag = tag;

    loadCharacter(charId).then(asset => this.attach(asset)).catch(e => console.warn('character failed to load', charId, e));
  }

  // Swap the gun model for the one this player is holding (weapon id from the snapshot).
  setGun(id) {
    if (!id || id === this.gunId) return;
    if (this.gun) { this.gunPivot.remove(this.gun); this.gun.traverse(o => o.geometry?.dispose()); }
    this.gunId = id;
    this.gunDef = buildGun(id);
    this.gun = this.gunDef.group;
    this.gunPivot.add(this.gun);
    this.muzzle.position.set(0, 0.02, this.gunDef.len);
  }

  attach(asset) {
    const m = SkeletonUtils.clone(asset.scene);
    m.scale.setScalar(asset.scale);
    m.position.y = -asset.minY * asset.scale;
    this.body.add(m);
    this.model = m;
    this.height = asset.scale * 1; // model already normalised
    this.bones = {};
    m.traverse(o => {
      if (!o.isBone) return;
      const key = o.name.replace(/^mixamorig[:_]?/, '');
      this.bones[key] = o;
    });
    this.mixer = new THREE.AnimationMixer(m);
    this.walk = asset.walk && this.mixer.clipAction(asset.walk);
    this.run = asset.run && this.mixer.clipAction(asset.run);
    for (const a of [this.walk, this.run]) if (a) { a.play(); a.setEffectiveWeight(0); }
    // limb lengths (world metres) for the reach maths, and the rest pose of everything posed in code
    this.group.updateMatrixWorld(true);
    const b = this.bones, P = (o) => o.getWorldPosition(new THREE.Vector3());
    const len = (a, c, d) => (b[a] && b[c] ? P(b[a]).distanceTo(P(b[c])) : d);
    this.len = {
      ra1: len('RightArm', 'RightForeArm', 0.27), ra2: len('RightForeArm', 'RightHand', 0.25),
      la1: len('LeftArm', 'LeftForeArm', 0.27), la2: len('LeftForeArm', 'LeftHand', 0.25),
      rl1: len('RightUpLeg', 'RightLeg', 0.42), rl2: len('RightLeg', 'RightFoot', 0.42),
      ll1: len('LeftUpLeg', 'LeftLeg', 0.42), ll2: len('LeftLeg', 'LeftFoot', 0.42),
    };
    // which way each palm faces in bone space: at rest the arms hang with the palms to the thighs
    const palm = (k, x) => (b[k] ? new THREE.Vector3(x, 0, 0).applyQuaternion(this.group.getWorldQuaternion(new THREE.Quaternion())).applyQuaternion(b[k].getWorldQuaternion(new THREE.Quaternion()).invert()) : new THREE.Vector3(0, 0, 1));
    this.palmR = palm('RightHand', 1); this.palmL = palm('LeftHand', -1);
    this.hipY = b.RightUpLeg ? P(b.RightUpLeg).y - this.group.position.y : 0.9;
    this.rest = [];
    for (const k of ['Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'RightShoulder', 'LeftShoulder', 'RightArm', 'RightForeArm', 'RightHand', 'LeftArm', 'LeftForeArm', 'LeftHand'])
      if (b[k]) this.rest.push([b[k], b[k].quaternion.clone()]);
    this.ready = true;
  }

  // s: the player's snapshot. truckYaw (optional): heading of the truck they are riding in.
  apply(s, dt, truckYaw) {
    const g = this.group;
    if (this.last) {
      const v = Math.hypot(s.x - this.last[0], s.z - this.last[1]) / Math.max(dt, 1e-3);
      this.speed += (Math.min(v, 9) - this.speed) * Math.min(1, dt * 8);
      // which way the truck is carrying a rider, when nobody tells us
      if (s.rd && v > 1.5 && v < 40) {
        const h = Math.atan2(s.x - this.last[0], s.z - this.last[1]);
        if (this.heading == null || Math.abs(wrap(h - this.heading)) < 1.6) this.heading = h;
      }
    }
    this.last = [s.x, s.z];
    if (s.rd) this.speed = 0; // riding in a truck: carried, not walking
    const seated = s.rd === 1 || s.rd === 2;
    this.sit += ((seated ? 1 : 0) - this.sit) * Math.min(1, dt * 10);
    const sit = this.sit;
    // sat in the cab, the body faces the way the truck does; only the chest, head and gun
    // turn to follow the player's look
    const lookYaw = s.yaw + Math.PI; // camera yaw faces -Z; models face +Z
    let bodyYaw = lookYaw, turn = 0;
    if (seated) {
      if (truckYaw == null) truckYaw = nearestTruckYaw(s.x, s.z);
      if (truckYaw == null) truckYaw = this.heading ?? (this.heading = lookYaw);
      bodyYaw = truckYaw; turn = THREE.MathUtils.clamp(wrap(lookYaw - truckYaw), -1.9, 1.9);
    } else if (!s.rd) this.heading = null;
    this.look += (turn - this.look) * Math.min(1, dt * 12);
    turn = this.look;
    g.position.set(s.x, s.y, s.z);
    g.rotation.y = bodyYaw;
    g.visible = !s.dd;
    this.pitch += ((s.pitch || 0) - this.pitch) * Math.min(1, dt * 12);
    if (s.cw) this.setGun(s.cw);

    if (s.dn) { // downed: lying on the floor
      this.body.rotation.x = -1.45; this.body.position.y = 0.25;
      if (this.mixer) { this.walk?.setEffectiveWeight(0); this.run?.setEffectiveWeight(0); this.mixer.update(dt); }
      this.gunPivot.visible = false;
      return;
    }
    // sat on the bench: hips at seat height (a cab rider's snapshot y is 0.1 m above the ground)
    this.body.rotation.x = 0; this.body.position.y = sit * (SEAT_HIP - 0.1 - (this.hipY || 0.9));
    this.gunPivot.visible = true;
    if (!this.ready) { this.gunPivot.rotation.set(-this.pitch, 0, 0); return; }

    // legs: blend walk -> run by speed
    const sp = this.speed;
    const runK = THREE.MathUtils.smoothstep(sp, 3.8, 6.0);
    const moveK = THREE.MathUtils.smoothstep(sp, 0.2, 1.2);
    this.walk?.setEffectiveWeight(moveK * (1 - runK)); this.walk?.setEffectiveTimeScale(Math.max(0.6, sp / 1.5));
    this.run?.setEffectiveWeight(moveK * runK); this.run?.setEffectiveTimeScale(Math.max(0.8, sp / 5));
    this.mixer.update(dt);

    const b = this.bones, L = this.len, def = this.gunDef, pistol = !!def.pistol;
    for (const [bone, q] of this.rest) bone.quaternion.copy(q);
    g.updateMatrixWorld(true);
    const gq = g.getWorldQuaternion(_gq);
    // the aim: the look direction (turned in the seat), pitched. Model space: +Z forward,
    // -X is the character's right, +Y up
    const aq = _aq.copy(gq).multiply(_q.setFromAxisAngle(UP, turn)).multiply(_q2.setFromAxisAngle(XAXIS, -this.pitch));
    const dir = (x, y, z) => new THREE.Vector3(x, y, z).normalize().applyQuaternion(aq);
    const fwd = dir(0, 0, 1), up = dir(0, 1, 0), right = dir(-1, 0, 0);

    // seated: thighs forward along the bench, shins down to the floor
    if (sit > 0.01 && b.RightUpLeg && b.LeftUpLeg && b.RightLeg && b.LeftLeg) {
      const body = (x, y, z) => new THREE.Vector3(x, y, z).applyQuaternion(gq);
      for (const [side, U, Lo, F, l1, l2] of [[-1, b.RightUpLeg, b.RightLeg, b.RightFoot, L.rl1, L.rl2], [1, b.LeftUpLeg, b.LeftLeg, b.LeftFoot, L.ll1, L.ll2]]) {
        U.updateWorldMatrix(true, false);
        const hip = new THREE.Vector3().setFromMatrixPosition(U.matrixWorld);
        const stand = hip.clone().addScaledVector(UP, -(l1 + l2) * 0.99);
        const foot = hip.clone().add(body(side * 0.07, 0, l1 * 0.95 + 0.12)).addScaledVector(UP, -l2 * 0.9);
        reach(U, Lo, l1, l2, stand.lerp(foot, sit), body(side * 0.15, 0.7, 1).normalize());
        if (F && sit > 0.5) aimBone(F, body(0, -0.6, 0.8).normalize());   // boots flat on the floor
      }
    }

    // chest: bladed to the gun side for a long gun, turned to follow the look when seated,
    // leaning with the pitch
    const blade = pistol ? 0 : -0.5;
    if (b.Spine) turnBone(b.Spine, UP, turn * 0.5 + blade * 0.6);
    if (b.Spine1) { turnBone(b.Spine1, UP, turn * 0.5 + blade * 0.4); turnBone(b.Spine1, right, this.pitch * 0.3); }
    // head: back round to the front and down onto the sights
    if (b.Neck) turnBone(b.Neck, UP, -blade * 0.5);
    if (b.Head) { turnBone(b.Head, UP, -blade * 0.5); turnBone(b.Head, right, this.pitch * 0.55); if (!pistol) { turnBone(b.Head, right, -0.1); turnBone(b.Head, fwd, -0.14); } }

    // where the gun is: butt in the right shoulder pocket (the revolver held out in front)
    const RA = b.RightArm, LA = b.LeftArm;
    if (!RA || !LA || !b.RightForeArm || !b.LeftForeArm) { this.gunPivot.rotation.set(-this.pitch, 0, 0); return; }
    RA.updateWorldMatrix(true, false); LA.updateWorldMatrix(true, false);
    const rs = new THREE.Vector3().setFromMatrixPosition(RA.matrixWorld), ls = new THREE.Vector3().setFromMatrixPosition(LA.matrixWorld);
    // hands: the trigger hand flat on the right of the grip, fingers forward; the other one
    // cupped under the fore-end (or wrapped round the trigger hand on the revolver). The wrist
    // sits a palm's length behind where the hand closes.
    let rAt, lAt, rF, rN, lF, lN;
    if (pistol) {
      _butt.copy(rs).lerp(ls, 0.5).addScaledVector(fwd, (L.ra1 + L.ra2) * 0.84).addScaledVector(up, 0.1);
      rAt = _butt.clone().addScaledVector(up, -0.05).addScaledVector(right, 0.022); rF = dir(0.1, 0.12, 1); rN = dir(1, 0, 0);
      lAt = _butt.clone().addScaledVector(up, -0.07).addScaledVector(right, -0.03); lF = dir(-0.35, 0.2, 1); lN = dir(-1, 0.25, 0);
    } else {
      _butt.copy(rs).addScaledVector(right, -0.05).addScaledVector(up, 0.1).addScaledVector(fwd, 0.03);
      rAt = _butt.clone().addScaledVector(fwd, def.grip).addScaledVector(up, -0.08).addScaledVector(right, 0.03); rF = dir(0.12, 0.35, 1); rN = dir(1, 0, 0);
      const foreZ = Math.min(def.fore, (L.la1 + L.la2) * 0.95 + 0.15);
      lAt = _butt.clone().addScaledVector(fwd, foreZ).addScaledVector(up, -0.045); lF = dir(-0.75, 0.15, 0.65); lN = dir(0, 1, 0);
    }
    const rT = rAt.addScaledVector(rF, -PALM), lT = lAt.addScaledVector(lF, -PALM);
    // elbows: the trigger arm's out and down, the support arm's under the gun
    reach(RA, b.RightForeArm, L.ra1, L.ra2, rT, dir(-0.75, -0.65, -0.1));
    reach(LA, b.LeftForeArm, L.la1, L.la2, lT, dir(0.45, -0.9, 0));
    if (b.RightHand) setHand(b.RightHand, rF, rN, this.palmR);
    if (b.LeftHand) setHand(b.LeftHand, lF, lN, this.palmL);

    // put the gun there (the pivot lives in the body group)
    this.body.updateWorldMatrix(true, false);
    this.gunPivot.position.copy(this.body.worldToLocal(_v.copy(_butt)));
    this.gunPivot.quaternion.copy(this.body.getWorldQuaternion(_q).invert().multiply(aq));
  }

  muzzleWorld(v) { return this.muzzle.getWorldPosition(v); }

  dispose() {
    this.scene.remove(this.group);
    this.tag.material.map.dispose();
  }
}
