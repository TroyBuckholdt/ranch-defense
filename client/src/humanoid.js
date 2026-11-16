// Enemies that are people rather than cattle. They share the cows' server state
// ([x, z, yaw, state(0 walk,1 attack,2 dead,3 tear,4 vault), y, type, hp%]) and the same
// view interface as CowView, so main.js treats them alike.
//
//   local  - round 10: locals in white cotton, straw hats and bandanas, swinging machetes
//   rafael - round 20 boss: Rafael, three times the height of a cow and very drunk. He sways,
//            lurches, clubs you with a bottle of Grey Goose, and throws the empties.
//
// Bodies reuse the rigged people models: legs come from the walk/run clips, the weapon arm
// is posed in code. Locals get their clothes recoloured in the shader so nobody mistakes
// them for the family.
import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { loadCharacter } from './avatar.js';
import { nameTag } from './textures.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { COW_TYPES, heightAt } from '../../shared/world.js';

const LOCAL_BODIES = ['p6', 'p2'];
const BOSS_BODY = 'p4';
const BOSS_HEIGHT = 1.76;

// The gear (straw hat, bandana, machete, bottle) is modelled in Blender:
// tools/blender/make_props.py -> props.glb. The code-built shapes below are the fallback.
let PROPS = null, propsLoading = null;
function loadProps() {
  propsLoading = propsLoading || new GLTFLoader().loadAsync('/assets/models/props/props.glb').then(g => {
    const out = {};
    g.scene.traverse(o => { if (['Hat', 'Bandana', 'Machete', 'Bottle'].includes(o.name)) out[o.name] = o; });
    for (const o of Object.values(out)) { o.position.set(0, 0, 0); o.traverse(m => { if (m.isMesh) { m.castShadow = true; m.material.envMapIntensity = 0.6; } }); }
    PROPS = out;
  }).catch(e => console.warn('props failed to load; using simple ones', e));
  return propsLoading;
}
const propClone = (name) => (PROPS?.[name] ? PROPS[name].clone(true) : null);
const BANDANA_TINTS = [0xb01c1c, 0x1f46a0, 0x9a6418, 0x2e2e2e, 0x1d6a3a];

export function preloadHumans(types = ['local', 'rafael']) {
  loadProps();
  const ids = new Set();
  if (types.includes('local')) LOCAL_BODIES.forEach(b => ids.add(b));
  if (types.includes('rafael')) ids.add(BOSS_BODY);
  return Promise.all([...ids].map(loadCharacter)).catch(() => {});
}

const STRAW = new THREE.MeshStandardMaterial({ color: 0xcdb27a, roughness: 0.9 });
const STRAW_BAND = new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.8 });
const STEEL = new THREE.MeshStandardMaterial({ color: 0xb8bcc0, roughness: 0.32, metalness: 0.9 });
const GRIP = new THREE.MeshStandardMaterial({ color: 0x2a1c12, roughness: 0.7 });
const GLASS = new THREE.MeshStandardMaterial({ color: 0x3f6a2c, roughness: 0.12, metalness: 0.1, transparent: true, opacity: 0.82 });
const LABEL = new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.7 });
const BANDANAS = [0xa01818, 0x1c3f8a, 0x8a5a14, 0x2a2a2a].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, side: THREE.DoubleSide }));
const CLOTHS = [[0.9, 0.88, 0.82], [0.86, 0.82, 0.72], [0.8, 0.84, 0.88], [0.92, 0.9, 0.86]];

function strawHat() {
  const g = new THREE.Group();
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.29, 0.015, 20), STRAW);
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.115, 0.11, 16), STRAW); crown.position.y = 0.06;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.117, 0.119, 0.03, 16), STRAW_BAND); band.position.y = 0.022;
  g.add(brim, crown, band);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}
function machete() {
  const g = new THREE.Group();
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.52, 0.06), STEEL); blade.position.set(0, 0.36, 0.008);
  const tip = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.09, 0.045), STEEL); tip.position.set(0, 0.655, 0.0); tip.rotation.x = -0.25;
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.14, 0.034), GRIP); grip.position.y = 0.03;
  g.add(blade, tip, grip);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}
export function bottleMesh() {
  const made = propClone('Bottle');
  if (made) return made;
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.17, 10), GLASS); body.position.y = 0.085;
  const sh = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.036, 0.05, 10), GLASS); sh.position.y = 0.195;
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.014, 0.07, 8), GLASS); neck.position.y = 0.255;
  const label = new THREE.Mesh(new THREE.CylinderGeometry(0.0368, 0.0368, 0.07, 10), LABEL); label.position.y = 0.09;
  g.add(body, sh, neck, label);
  return g;
}

// Clothes recolour for the locals: everything below the neck that isn't skin becomes cotton,
// with leather sandals; skin is warmed a little and hair darkened. `y` is the bind-pose height.
function localMaterial(src, bounds, cloth) {
  const m = src.clone();
  const h = bounds.max.y - bounds.min.y;
  const u = {
    uNeck: { value: bounds.min.y + h * 0.845 }, uFeet: { value: bounds.min.y + h * 0.04 }, uHip: { value: bounds.min.y + h * 0.52 },
    uCloth: { value: new THREE.Color(...cloth) },
  };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vBindY;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBindY = position.y;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vBindY; uniform float uNeck, uFeet, uHip; uniform vec3 uCloth;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          vec3 c0 = diffuseColor.rgb;
          float lum = dot(c0, vec3(0.3, 0.59, 0.11));
          float skin = smoothstep(0.015, 0.07, c0.r - c0.b) * smoothstep(0.0, 0.03, c0.r - c0.g) * smoothstep(0.04, 0.12, lum);
          vec3 skinC = c0 * vec3(0.8, 0.66, 0.56);
          vec3 cloth = uCloth * (0.78 + 0.22 * clamp(lum * 5.0, 0.0, 1.0)) * (vBindY < uHip ? vec3(0.96, 0.94, 0.9) : vec3(1.0));
          vec3 body = vBindY < uFeet ? vec3(0.09, 0.055, 0.035) : mix(cloth, skinC, skin);
          vec3 head = mix(c0 * 0.4, skinC, skin);
          diffuseColor.rgb = mix(body, head, smoothstep(uNeck - 0.012, uNeck + 0.012, vBindY));
        }`);
  };
  m.customProgramCacheKey = () => 'local-cloth';
  return m;
}

// the boss's face is flushed
function bossMaterial(src, bounds) {
  const m = src.clone();
  const h = bounds.max.y - bounds.min.y;
  const u = { uNeck: { value: bounds.min.y + h * 0.845 } };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vBindY;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBindY = position.y;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vBindY; uniform float uNeck;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          vec3 c0 = diffuseColor.rgb;
          float skin = smoothstep(0.015, 0.07, c0.r - c0.b) * smoothstep(0.0, 0.03, c0.r - c0.g);
          diffuseColor.rgb = mix(c0, c0 * vec3(1.22, 0.8, 0.76), skin * smoothstep(uNeck - 0.01, uNeck + 0.02, vBindY) * 0.8);
        }`);
  };
  m.customProgramCacheKey = () => 'boss-flush';
  return m;
}

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _v = new THREE.Vector3(), _d = new THREE.Vector3(), _d2 = new THREE.Vector3(), _s = new THREE.Vector3();
function aimBone(bone, dirWorld) {
  bone.updateWorldMatrix(true, false);
  const wq = bone.getWorldQuaternion(_q);
  const cur = _v.set(0, 1, 0).applyQuaternion(wq).normalize();
  const target = _q2.setFromUnitVectors(cur, dirWorld).multiply(wq);
  bone.quaternion.copy(bone.parent.getWorldQuaternion(_q3).invert().multiply(target));
}
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mix3 = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

export class HumanView {
  constructor(id, type, scene, hooks = {}) {
    this.id = id; this.type = type; this.scene = scene; this.hooks = hooks;
    this.def = COW_TYPES[type];
    this.boss = !!this.def.boss;
    this.root = new THREE.Group();   // world position + facing
    this.body = new THREE.Group();   // sway, flinch, falling over
    this.root.add(this.body);
    scene.add(this.root);
    const r = Math.random;
    this.seed = r() * 100;
    this.height = this.boss ? BOSS_HEIGHT * this.def.scale : 1.58 + r() * 0.14;
    this.speed = 0; this.lastPos = null;
    this.state = 0; this.stateT = 0; this.attackT = 0; this.deathT = 0; this.flinch = 0; this.throwT = -1;
    this.fallSide = r() < 0.5 ? -1 : 1;
    this.stepPhase = 0;
    this.ready = false;
    if (this.boss) {
      const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: nameTag('RAFAEL', '#ff5a4a'), depthTest: false, transparent: true }));
      tag.scale.set(4.2, 1.05, 1); tag.position.y = this.height + 0.9; tag.renderOrder = 10;
      this.root.add(tag); this.tag = tag;
    }
    const bodyId = this.boss ? BOSS_BODY : LOCAL_BODIES[Math.floor(r() * LOCAL_BODIES.length)];
    Promise.all([loadCharacter(bodyId), loadProps()]).then(([a]) => { if (!this.gone) this.attach(a); }).catch(e => console.warn('enemy model failed to load', e));
  }

  attach(asset) {
    const m = SkeletonUtils.clone(asset.scene);
    // rescale the model to this enemy's height, feet on the ground
    const natural = new THREE.Box3().setFromObject(asset.scene);
    const s = this.height / (natural.max.y - natural.min.y);
    m.scale.setScalar(s);
    m.position.y = -asset.minY * s;
    const cloth = CLOTHS[Math.floor(Math.random() * CLOTHS.length)];
    m.traverse(o => {
      if (!o.isMesh) return;
      o.frustumCulled = false; o.castShadow = true; o.receiveShadow = true;
      o.geometry.computeBoundingBox();
      o.material = this.boss ? bossMaterial(o.material, o.geometry.boundingBox) : localMaterial(o.material, o.geometry.boundingBox, cloth);
    });
    this.body.add(m);
    this.model = m;
    this.bones = {};
    m.traverse(o => { if (o.isBone) this.bones[o.name.replace(/^mixamorig[:_]?/, '')] = o; });
    this.mixer = new THREE.AnimationMixer(m);
    this.walk = asset.walk && this.mixer.clipAction(asset.walk);
    this.run = asset.run && this.mixer.clipAction(asset.run);
    for (const a of [this.walk, this.run]) if (a) { a.play(); a.setEffectiveWeight(0); a.time = Math.random(); }

    // props ride on the bones; undo the bone's world scale so they are sized in metres
    this.root.updateMatrixWorld(true);
    const prop = (bone, obj, size) => {
      if (!bone) return null;
      bone.getWorldScale(_s);
      const holder = new THREE.Group();
      holder.scale.setScalar(size / _s.y);
      holder.add(obj); bone.add(holder);
      return holder;
    };
    const b = this.bones;
    const big = this.boss ? this.def.scale : this.height / 1.72;
    if (this.boss) {
      this.bottle = bottleMesh();
      const h = prop(b.RightHand, this.bottle, big * 1.3);
      if (h) { this.bottle.rotation.set(1.25, 0, 0); this.bottle.position.set(0, 0.07, 0.02); }
    } else {
      const hat = propClone('Hat') || strawHat();
      const hh = prop(b.Head, hat, big);
      if (hh) { hat.position.set(0, 0.125, 0.01); hat.rotation.x = -0.1; }
      // paliacate over the nose and mouth
      let ban = propClone('Bandana');
      if (ban) {
        const tint = new THREE.Color(BANDANA_TINTS[Math.floor(Math.random() * BANDANA_TINTS.length)]);
        ban.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.color.copy(tint); o.material.side = THREE.DoubleSide; } });
      } else ban = new THREE.Mesh(new THREE.CylinderGeometry(0.098, 0.088, 0.1, 14, 1, true, -1.25, 2.5), BANDANAS[Math.floor(Math.random() * BANDANAS.length)]);
      const bh = prop(b.Head, ban, big);
      if (bh) ban.position.set(0, 0.07, 0.012);
      this.machete = propClone('Machete') || machete();
      const mh = prop(b.RightHand, this.machete, big);
      if (mh) { this.machete.rotation.set(1.25, 0, 0); this.machete.position.set(0, 0.07, 0.02); }
    }
    this.ready = true;
  }

  attackPeriod() { return this.boss ? 2.0 : 0.9; }

  apply(s, dt, t) {
    dt = Math.min(dt, 0.05);
    const [x, z, yaw, state, y] = s;
    const root = this.root, body = this.body;
    if (this.lastPos && dt > 0) {
      const v = Math.hypot(x - this.lastPos[0], z - this.lastPos[1]) / dt;
      this.speed += (Math.min(v, 9) - this.speed) * Math.min(1, dt * 7);
    }
    this.lastPos = [x, z];
    root.position.set(x, (y || 0) + heightAt(x, z), z);
    root.rotation.y = yaw;
    if (state !== this.state) { this.state = state; this.stateT = 0; if (state === 1 || state === 3) this.attackT = this.attackPeriod() * 0.35; }
    this.stateT += dt;
    this.flinch = Math.max(0, this.flinch - dt * 5);
    if (this.tag) this.tag.visible = state !== 2;
    if (!this.ready) return;

    const dead = state === 2;
    const sc = this.height / 1.75;       // model-space speed
    const sp = this.speed / sc;
    const moveK = dead ? 0 : smooth(0.15, 1.0, sp);
    const runK = this.boss ? 0 : smooth(3.2, 5.2, sp);
    this.walk?.setEffectiveWeight(moveK * (1 - runK)); this.walk?.setEffectiveTimeScale(Math.max(0.5, sp / 1.5));
    this.run?.setEffectiveWeight(moveK * runK); this.run?.setEffectiveTimeScale(Math.max(0.8, sp / 4.6));
    if (!dead) this.mixer.update(dt);

    // --- whole-body motion ---
    let rx = 0, rz = 0, py = 0, pz = 0;
    if (this.boss) {
      // drunk: slow figure-of-eight sway, worse while he walks, and a lurch now and then
      const a = t * 1.15 + this.seed;
      rz = Math.sin(a) * (0.09 + 0.07 * moveK) + Math.sin(a * 2.3 + 1) * 0.03;
      rx = Math.sin(a * 0.7 + 2) * 0.06 + Math.max(0, Math.sin(a * 0.37)) ** 6 * 0.2;
      // footfalls shake the ground
      const ph = (this.stepPhase += dt * Math.max(0.4, sp) * 1.25 * moveK);
      if (Math.floor(ph) !== this.lastStep && moveK > 0.3) { this.lastStep = Math.floor(ph); this.hooks.stomp?.(root.position, false); }
    }
    if (state === 4) rx += 0.55 * Math.sin(Math.min(1, this.stateT / 0.8) * Math.PI); // ducking through a window
    rx -= this.flinch * (this.boss ? 0.05 : 0.22);

    if (dead) {
      // crumple: knees give, then down backwards (the boss goes over like a felled tree)
      this.deathT += dt;
      const d = this.deathT, T = this.boss ? 2.2 : 0.7;
      const k = Math.min(1, d / T), fall = k * k * (this.boss ? k : 1);
      rx = -1.5 * fall; rz = this.fallSide * 0.25 * fall * (1 - fall) * 2;
      py = Math.sin(fall * Math.PI) * 0.1 * sc + 0.12 * sc * fall;
      pz = -0.5 * sc * fall;
      if (k >= 1 && !this.landed) { this.landed = true; this.hooks.stomp?.(root.position, true, this.boss); }
      if (d > 5) py -= (d - 5) * 0.5 * (this.boss ? 2 : 1);
    } else this.deathT = 0;
    body.rotation.set(rx, 0, rz);
    body.position.set(0, py, pz);
    if (dead) return;

    // --- arms, posed in code over the clip ---
    const b = this.bones;
    root.updateMatrixWorld(true);
    const gq = body.getWorldQuaternion(_q3.identity()).clone();
    const dir = (v) => _d.set(v[0], v[1], v[2]).normalize().applyQuaternion(gq).clone();
    // model space: +Z forward, -X is the character's right, +Y up
    const attacking = state === 1 || state === 3;
    if (attacking) this.attackT += dt; else this.attackT = 0;
    const u = attacking ? (this.attackT / this.attackPeriod()) % 1 : 0;
    if (this.throwT >= 0) { this.throwT += dt; if (this.throwT > 0.9) { this.throwT = -1; if (this.bottle) this.bottle.visible = true; } }

    // free arm: hangs at the side when standing (the clips only move it while walking)
    const still = 1 - moveK;
    const hangL = [0.24, -0.95, 0.06 + Math.sin(t * 1.3 + this.seed) * 0.05], hangLF = [0.1, -0.9, 0.3];
    const poseLeft = (k) => {
      if (k < 0.02) return;
      if (b.LeftArm) { const q0 = b.LeftArm.quaternion.clone(); aimBone(b.LeftArm, dir(hangL)); b.LeftArm.quaternion.slerpQuaternions(q0, b.LeftArm.quaternion.clone(), k); }
      if (b.LeftForeArm) { const q0 = b.LeftForeArm.quaternion.clone(); aimBone(b.LeftForeArm, dir(hangLF)); b.LeftForeArm.quaternion.slerpQuaternions(q0, b.LeftForeArm.quaternion.clone(), k); }
    };
    poseLeft(this.boss ? Math.max(still, 0.55) : still);

    if (!this.boss) {
      // machete: carried cocked at the shoulder, chopped down hard in the attack
      const carryUp = [-0.32, -0.72, 0.28], carryFore = [-0.05, 0.82, 0.55];
      const windUp = [-0.3, 0.75, -0.25], windFore = [0.05, 0.85, -0.5];
      const hitUp = [-0.08, -0.25, 0.95], hitFore = [0.12, -0.55, 0.82];
      let up = carryUp, fore = carryFore;
      if (attacking) {
        const w = smooth(0.0, 0.42, u), h = smooth(0.42, 0.56, u), back = smooth(0.7, 1.0, u);
        up = mix3(mix3(mix3(carryUp, windUp, w), hitUp, h), carryUp, back);
        fore = mix3(mix3(mix3(carryFore, windFore, w), hitFore, h), carryFore, back);
        if (b.Spine1) aimBone(b.Spine1, dir([0.12 * (h - w * 0.5), 1, 0.35 * h - 0.12 * w]));
        const struck = u > 0.5;
        if (struck && !this.struck) this.hooks.swing?.(root.position, this.type);
        this.struck = struck;
      } else this.struck = false;
      if (b.RightArm) aimBone(b.RightArm, dir(up));
      if (b.RightForeArm) aimBone(b.RightForeArm, dir(fore));
    } else {
      // bottle arm: dangling, hoisted for a swig now and then, or winding up to throw
      const hang = [-0.28, -0.9, 0.12], hangFore = [-0.12, -0.75, 0.55];
      let up = hang, fore = hangFore;
      const swig = Math.max(0, Math.sin(t * 0.45 + this.seed)) ** 10;
      if (this.throwT >= 0) {
        const w = smooth(0, 0.3, this.throwT), h = smooth(0.3, 0.45, this.throwT), back = smooth(0.55, 0.9, this.throwT);
        up = mix3(mix3(mix3(hang, [-0.4, 0.8, -0.4], w), [-0.1, 0.25, 0.95], h), hang, back);
        fore = mix3(mix3(mix3(hangFore, [0.1, 0.9, -0.4], w), [0, 0.1, 1], h), hangFore, back);
      } else if (attacking) {
        // brings the Grey Goose down like a club
        const w = smooth(0.0, 0.4, u), h = smooth(0.42, 0.55, u), back = smooth(0.72, 1.0, u);
        up = mix3(mix3(mix3(hang, [-0.3, 0.8, -0.3], w), [-0.08, -0.3, 0.95], h), hang, back);
        fore = mix3(mix3(mix3(hangFore, [0.05, 0.85, -0.5], w), [0.1, -0.6, 0.8], h), hangFore, back);
        if (b.Spine1) aimBone(b.Spine1, dir([0.1 * (h - w * 0.5), 1, 0.45 * h - 0.15 * w]));
        const struck = u > 0.52;
        if (struck && !this.struck) this.hooks.stomp?.(root.position, true);
        this.struck = struck;
      } else {
        this.struck = false;
        up = mix3(hang, [-0.35, -0.2, 0.9], swig); fore = mix3(hangFore, [0.35, 0.9, 0.2], swig);
        if (b.Head) aimBone(b.Head, dir([Math.sin(t * 0.8 + this.seed) * 0.18, 1, 0.12 - swig * 0.5]));
      }
      if (b.RightArm) aimBone(b.RightArm, dir(up));
      if (b.RightForeArm) aimBone(b.RightForeArm, dir(fore));
    }
  }

  // the boss lets go of a bottle: returns where his hand is so the bottle can start there
  startThrow(out) {
    this.throwT = 0;
    if (this.bottle) { this.bottle.getWorldPosition(out); this.bottle.visible = false; }
    else out.copy(this.root.position).setY(this.root.position.y + this.height * 0.8);
    return out;
  }

  headWorld(out) { return out.copy(this.root.position).setY(this.root.position.y + this.height * 0.95); }

  hit() { this.flinch = 1; }

  dispose() {
    this.gone = true;
    this.scene.remove(this.root);
    this.mixer?.stopAllAction();
    if (this.tag) this.tag.material.map.dispose();
  }
}
