// Zombie Brahman model + animation (matched to the white Brahman herd on the ranch). Built from primitives for now; designed so a rigged
// GLB cow (from a 3D store or generated from photos of the real cows) can replace
// `buildCowModel` later without touching the rest of the game.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { COW_TYPES, heightAt } from '../../shared/world.js';
import * as T from './textures.js';

let shared = null;
function materials() {
  if (shared) return shared;
  shared = {
    hide: new THREE.MeshStandardMaterial({ map: T.brahmanHide(), roughness: 0.8 }),
    darkHide: new THREE.MeshStandardMaterial({ map: T.brahmanHide(), color: 0xa8a49a, roughness: 0.85 }),
    flesh: new THREE.MeshStandardMaterial({ color: 0x5a0a0a, roughness: 0.4, metalness: 0.1 }),
    bone: new THREE.MeshStandardMaterial({ color: 0xd8ccb0, roughness: 0.6 }),
    hoof: new THREE.MeshStandardMaterial({ color: 0x1a1612, roughness: 0.6 }),
    nose: new THREE.MeshStandardMaterial({ color: 0x5a3a3a, roughness: 0.5 }),
    eye: new THREE.MeshBasicMaterial({ color: new THREE.Color(16, 1.0, 0.2) }), // far above 1 so bloom catches it
    bull: new THREE.MeshStandardMaterial({ map: T.brahmanHide(), color: 0x8a8680, roughness: 0.8 }),
    switchHair: new THREE.MeshStandardMaterial({ color: 0x1c1a18, roughness: 1 }),
  };
  return shared;
}

const G = {};
function geos() {
  if (G.body) return G;
  G.body = new THREE.CapsuleGeometry(0.58, 1.3, 6, 14).rotateX(Math.PI / 2);
  G.belly = new THREE.SphereGeometry(0.6, 14, 10);
  G.neck = new THREE.CylinderGeometry(0.28, 0.42, 0.7, 10);
  G.head = new THREE.BoxGeometry(0.36, 0.4, 0.68);
  G.snout = new THREE.BoxGeometry(0.32, 0.28, 0.2);
  G.hump = new THREE.SphereGeometry(0.42, 14, 10);
  G.dewlap = new THREE.SphereGeometry(0.4, 10, 8);
  G.longEar = new THREE.BoxGeometry(0.11, 0.04, 0.42).translate(0, 0, 0.19);
  G.switch = new THREE.ConeGeometry(0.07, 0.3, 6);
  G.jaw = new THREE.BoxGeometry(0.34, 0.1, 0.42);
  G.horn = new THREE.ConeGeometry(0.06, 0.38, 8);
  G.ear = new THREE.BoxGeometry(0.24, 0.06, 0.13);
  G.eye = new THREE.SphereGeometry(0.055, 8, 6);
  G.upperLeg = new THREE.CylinderGeometry(0.13, 0.1, 0.5, 8).translate(0, -0.25, 0);
  G.lowerLeg = new THREE.CylinderGeometry(0.09, 0.08, 0.42, 8).translate(0, -0.21, 0);
  G.hoof = new THREE.CylinderGeometry(0.1, 0.11, 0.1, 8);
  G.tail = new THREE.CylinderGeometry(0.03, 0.02, 0.7, 5).translate(0, -0.35, 0);
  G.rib = new THREE.TorusGeometry(0.42, 0.025, 4, 10, Math.PI * 0.9);
  G.wound = new THREE.SphereGeometry(0.2, 8, 6);
  return G;
}

export function buildCowModel(type) {
  const M = materials(), g = geos();
  const s = COW_TYPES[type].scale;
  const hideMat = type === 'bull' ? M.bull : type === 'runner' ? M.darkHide : M.hide;
  const root = new THREE.Group();         // positioned at the cow's feet
  const body = new THREE.Group();         // pitches/rolls for lurching, rearing, dying
  root.add(body);
  body.scale.setScalar(s);

  const torso = new THREE.Mesh(g.body, hideMat);
  torso.position.set(0, 1.05, 0);
  body.add(torso);
  const belly = new THREE.Mesh(g.belly, hideMat);
  belly.position.set(0, 0.92, -0.1); belly.scale.set(1, 0.85, 1.4);
  body.add(belly);
  // Brahman hump over the shoulders and loose dewlap under the neck
  const hump = new THREE.Mesh(g.hump, type === 'bull' ? M.bull : hideMat);
  hump.position.set(0, 1.55, 0.5); hump.scale.set(0.85, type === 'bull' ? 1.2 : 0.85, 1.05);
  body.add(hump);
  const dewlap = new THREE.Mesh(g.dewlap, hideMat);
  dewlap.position.set(0, 0.92, 0.95); dewlap.scale.set(0.32, 0.85, 0.8);
  body.add(dewlap);

  // exposed ribs + gore on one flank: these are zombies after all
  const ribs = new THREE.Group();
  ribs.position.set(0.42, 1.08, -0.2);
  ribs.rotation.set(0, Math.PI / 2, Math.PI / 2);
  for (let i = 0; i < 4; i++) {
    const r = new THREE.Mesh(g.rib, M.bone);
    r.position.z = 0; r.position.x = (i - 1.5) * 0.17; r.rotation.y = Math.PI / 2; r.scale.setScalar(0.6);
    ribs.add(r);
  }
  const gore = new THREE.Mesh(g.wound, M.flesh);
  gore.scale.set(0.5, 1.4, 2.2); gore.position.set(0.48, 1.05, -0.2);
  body.add(gore, ribs);
  const gore2 = new THREE.Mesh(g.wound, M.flesh);
  gore2.scale.set(1.2, 0.6, 1); gore2.position.set(-0.3, 1.55, 0.5);
  body.add(gore2);

  // neck + head on a pivot so the head can loll, bite and headbutt
  const neckPivot = new THREE.Group();
  neckPivot.position.set(0, 1.25, 0.75);
  body.add(neckPivot);
  const neck = new THREE.Mesh(g.neck, hideMat);
  neck.rotation.x = 1.0; neck.position.set(0, 0.05, 0.2);
  neckPivot.add(neck);
  const head = new THREE.Group();
  head.position.set(0, 0.12, 0.55);
  neckPivot.add(head);
  const skull = new THREE.Mesh(g.head, hideMat);
  head.add(skull);
  const snout = new THREE.Mesh(g.snout, M.nose);
  snout.position.set(0, -0.08, 0.38);
  head.add(snout);
  const jaw = new THREE.Mesh(g.jaw, M.flesh);
  jaw.position.set(0, -0.26, 0.3);
  head.add(jaw);
  for (const sx of [-1, 1]) {
    const horn = new THREE.Mesh(g.horn, M.bone);
    horn.position.set(sx * 0.17, 0.24, -0.22);
    horn.rotation.set(-0.5, 0, -sx * (type === 'bull' ? 0.5 : 0.25));
    horn.scale.set(type === 'bull' ? 1.8 : 1, type === 'bull' ? 1.3 : 0.6, type === 'bull' ? 1.8 : 1);
    head.add(horn);
    // long droopy Brahman ears hanging down the sides of the head
    const ear = new THREE.Mesh(g.longEar, hideMat);
    ear.position.set(sx * 0.2, 0.1, -0.18);
    ear.rotation.set(1.25, sx * 0.35, sx * 0.25);
    head.add(ear);
    const eye = new THREE.Mesh(g.eye, M.eye);
    eye.position.set(sx * 0.2, 0.06, 0.17);
    head.add(eye);
  }

  // legs: hip pivot -> upper -> knee pivot -> lower -> hoof
  const legs = [];
  for (const [lx, lz] of [[-0.3, 0.6], [0.3, 0.6], [-0.3, -0.65], [0.3, -0.65]]) {
    const hip = new THREE.Group();
    hip.position.set(lx, 0.95, lz);
    const upper = new THREE.Mesh(g.upperLeg, hideMat);
    hip.add(upper);
    const knee = new THREE.Group();
    knee.position.y = -0.5;
    hip.add(knee);
    const lower = new THREE.Mesh(g.lowerLeg, hideMat);
    knee.add(lower);
    const hoof = new THREE.Mesh(g.hoof, M.hoof);
    hoof.position.y = -0.44;
    knee.add(hoof);
    body.add(hip);
    legs.push({ hip, knee });
  }

  const tail = new THREE.Mesh(g.tail, hideMat);
  tail.position.set(0, 1.35, -1.25); tail.rotation.x = 0.3;
  const sw = new THREE.Mesh(g.switch, M.switchHair);
  sw.position.y = -0.75; sw.rotation.x = Math.PI;
  tail.add(sw);
  body.add(tail);

  root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
  return { root, body, neckPivot, head, jaw, legs, tail, hideMat };
}

// ---------------------------------------------------------------------------
// The real model: a Brahman generated from the ranch's own cattle photo (fal/Rodin),
// rigged in Blender (tools/blender/rig_quadruped.py). Zombie rot, wounds and blood are
// painted onto its hide here, and glowing eyes ride on the head bone.
let ASSET = null;
export async function loadCowAsset() {
  try {
    const gltf = await new GLTFLoader().loadAsync('/assets/models/brahman/brahman.glb');
    const meta = await (await fetch('/assets/models/brahman/brahman.json')).json();
    gltf.scene.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
      const m = o.material;
      if (m.map?.image) m.map = T.zombify(m.map.image);
      m.roughness = 0.82; m.metalness = 0;
    });
    ASSET = { scene: gltf.scene, meta };
  } catch (e) {
    console.warn('Brahman model failed to load; using the simple cow.', e);
  }
}

const TINT = { walker: 0xd6d2c6, runner: 0xbdb8ac, bull: 0x7e7a74 };
const qTmp = new THREE.Quaternion(), eTmp = new THREE.Euler();

class BrahmanRig {
  constructor(type) {
    const M = materials();
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    this.model = SkeletonUtils.clone(ASSET.scene);
    this.model.scale.setScalar(COW_TYPES[type].scale);
    this.body.add(this.model);
    this.mats = [];
    this.model.traverse(o => {
      if (o.isMesh) {
        o.material = o.material.clone();
        o.material.color.set(TINT[type]);
        this.mats.push(o.material);
      }
    });
    this.bones = {};
    this.model.traverse(o => { if (o.isBone) this.bones[o.name] = { bone: o, rest: o.quaternion.clone() }; });
    // glowing eyes, placed in the head bone's space
    const head = this.bones.head?.bone;
    if (head) {
      this.model.updateMatrixWorld(true);
      const meta = ASSET.meta;
      const hx = meta.head[0], hy = meta.head[1] + 0.05, hz = meta.head[2] + 0.08;
      for (const sx of [-1, 1]) {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), M.eye);
        const wp = this.model.localToWorld(new THREE.Vector3(hx + sx * 0.13, hy, hz));
        head.add(eye);
        eye.position.copy(head.worldToLocal(wp));
        eye.scale.setScalar(1 / COW_TYPES[type].scale);
      }
    }
  }
  set(name, x = 0, y = 0, z = 0) {
    const b = this.bones[name];
    if (!b) return;
    b.bone.quaternion.copy(b.rest).multiply(qTmp.setFromEuler(eTmp.set(x, y, z)));
  }
}

// The old primitive cow, kept as a fallback if the model can't load.
class SimpleRig {
  constructor(type) {
    const m = buildCowModel(type);
    Object.assign(this, { root: m.root, body: m.body, m });
    this.mats = [m.hideMat.clone()];
    m.root.traverse(o => { if (o.isMesh && o.material === m.hideMat) o.material = this.mats[0]; });
    m.body.scale.setScalar(COW_TYPES[type].scale);
  }
  set(name, x = 0, y = 0, z = 0) {
    const { m } = this;
    const legIdx = { FL: 0, FR: 1, BL: 2, BR: 3 };
    const lm = name.match(/^leg_(\w\w)_(up|lo)$/);
    if (lm) { const l = m.legs[legIdx[lm[1]]]; (lm[2] === 'up' ? l.hip : l.knee).rotation.x = lm[2] === 'up' ? -x : x; return; }
    if (name === 'neck') m.neckPivot.rotation.set(x, y, z);
    if (name === 'head') m.jaw.rotation.x = 0.15 + Math.max(0, x);
    if (name === 'tail') m.tail.rotation.z = z;
  }
}

// One cow on screen. `apply` takes the interpolated server state each frame.
export class CowView {
  constructor(id, type, scene) {
    this.id = id;
    this.type = type;
    this.rig = ASSET ? new BrahmanRig(type) : new SimpleRig(type);
    this.root = this.rig.root;
    this.body = this.rig.body;
    this.scene = scene;
    scene.add(this.root);
    this.phase = Math.random() * 10;
    this.limp = 0.6 + Math.random() * 0.8;
    this.tilt = (Math.random() - 0.5) * 0.5;
    this.deathT = 0;
    this.flash = 0;
    this.lastPos = null;
    this.speed = 0;
    this.deathSide = Math.random() < 0.5 ? -1 : 1;
  }

  apply(s, dt, t) {
    const { rig, root, body } = this;
    const [x, z, yaw, state, y] = s;
    if (this.lastPos) {
      const d = Math.hypot(x - this.lastPos[0], z - this.lastPos[1]) / Math.max(dt, 1e-3);
      this.speed += (Math.min(d, 8) - this.speed) * Math.min(1, dt * 8);
    }
    this.lastPos = [x, z];
    root.position.set(x, (y || 0) + heightAt(x, z), z);
    root.rotation.y = yaw;

    this.flash = Math.max(0, this.flash - dt * 6);
    for (const m of rig.mats) m.emissive.setRGB(this.flash * 0.6, 0, 0);

    const sc = COW_TYPES[this.type].scale;
    if (state === 2) { // dead: knees buckle, topple onto its side, then sink away
      this.deathT += dt;
      const k = Math.min(1, this.deathT / 0.6), ease = 1 - (1 - k) ** 3;
      body.rotation.set(0, 0, this.deathSide * ease * 1.5);
      body.position.y = -ease * 0.35 * sc + (this.deathT > 5 ? -(this.deathT - 5) * 0.5 : 0);
      for (const l of ['FL', 'FR', 'BL', 'BR']) { rig.set(`leg_${l}_up`, -0.25 * ease); rig.set(`leg_${l}_lo`, 0.5 * ease); }
      rig.set('neck', 0.5 * ease, 0, -this.deathSide * 0.4 * ease);
      return;
    }

    const runner = this.type === 'runner';
    this.phase += dt * (1.4 + this.speed * (runner ? 2.0 : 1.45));
    const p = this.phase, moving = Math.min(1, this.speed / 1.5);
    const swing = (runner ? 0.65 : 0.42) * moving;

    // diagonal gait, one dragging rear leg
    const legs = [['FL', 0], ['FR', Math.PI], ['BL', Math.PI], ['BR', 0]];
    for (const [l, off] of legs) {
      const limp = l === 'BR' ? this.limp : 1;
      const lp = p + off;
      rig.set(`leg_${l}_up`, -Math.sin(lp) * swing * limp);
      rig.set(`leg_${l}_lo`, Math.max(0, Math.cos(lp)) * 0.75 * moving * limp);
    }
    body.position.y = Math.abs(Math.sin(p)) * 0.05 * moving;
    body.rotation.set(0, 0, this.tilt * 0.25 + Math.sin(p * 0.5) * 0.06);
    rig.set('tail', 0, 0, Math.sin(t * 2.5 + this.id) * 0.35);

    // lolling zombie head with the odd twitch
    const twitch = Math.sin(t * 17 + this.id * 3) > 0.97 ? Math.sin(t * 60) * 0.2 : 0;
    let neckX = 0.12 + Math.sin(p * 0.5) * 0.08, neckY = Math.sin(t * 0.7 + this.id) * 0.2, neckZ = this.tilt + twitch;
    let headX = 0.1;

    if (state === 1) { // attack: violent headbutt
      const a = (t * 2.2 + this.id) % 1;
      const thrust = a < 0.25 ? a / 0.25 : Math.max(0, 1 - (a - 0.25) / 0.4);
      neckX = -0.15 + thrust * 0.75; headX = thrust * 0.3;
      body.rotation.x = -thrust * 0.08;
    } else if (state === 3) { // tearing at boards: rear up, paw and bite
      const a = Math.sin(t * 7 + this.id);
      body.rotation.x = -0.32 - a * 0.1;
      body.position.y = 0.2;
      rig.set('leg_FL_up', -1.0 + Math.sin(t * 9 + this.id) * 0.5); rig.set('leg_FL_lo', 0.9);
      rig.set('leg_FR_up', -1.0 + Math.sin(t * 9 + this.id + 2) * 0.5); rig.set('leg_FR_lo', 0.9);
      neckX = 0.3 + a * 0.3;
    } else if (state === 4) { // climbing through
      body.rotation.x = -0.45 + Math.sin(t * 6) * 0.08;
      rig.set('leg_FL_up', -1.1); rig.set('leg_FR_up', -1.1); rig.set('leg_FL_lo', 1.0); rig.set('leg_FR_lo', 1.0);
      rig.set('leg_BL_up', 0.6); rig.set('leg_BR_up', 0.6);
    } else {
      body.rotation.x = 0;
    }
    rig.set('neck', neckX, neckY, neckZ);
    rig.set('head', headX);
  }

  hit() { this.flash = 1; }

  dispose() {
    this.scene.remove(this.root);
    for (const m of this.rig.mats) m.dispose();
  }
}
