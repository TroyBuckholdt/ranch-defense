// Other players as seen by you: the real people from the ranch photos, generated as 3D
// characters (fal: Nano Banana Pro -> Rodin -> Meshy rigging, Mixamo skeleton).
// Legs come from the walk/run animation clips; the upper body is posed in code to hold
// the rifle and aim wherever that player is looking.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { nameTag } from './textures.js';

export const CHARACTERS = [
  { id: 'p1', label: 'Troy', height: 1.83 },
  { id: 'p2', label: 'Blue shirt', height: 1.62 },
  { id: 'p3', label: 'White top', height: 1.63 },
  { id: 'p4', label: 'Rafael', height: 1.76 },
  { id: 'p5', label: 'Red cap', height: 1.66 },
  { id: 'p6', label: 'Rafa', height: 1.82 },
  { id: 'p7', label: 'Julio', height: 1.76 },
  { id: 'p8', label: 'Terresa', height: 1.65 },
];

const A = '/assets/models/people/';
const loader = new GLTFLoader();
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
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _v = new THREE.Vector3(), _d = new THREE.Vector3();

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

export class Avatar {
  constructor(id, name, scene, charId = 'p1') {
    this.scene = scene;
    this.group = new THREE.Group();   // world position + facing
    this.body = new THREE.Group();    // for the downed pose
    this.group.add(this.body);
    scene.add(this.group);
    this.speed = 0; this.last = null; this.ready = false; this.pitch = 0;

    // rifle held at the chest, pitched with the player's aim
    this.gunPivot = new THREE.Group();
    this.body.add(this.gunPivot);
    const gun = new THREE.Group();
    gun.add(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, 0.7), GUN_MAT));
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.28), WOOD_MAT); stock.position.z = -0.45; gun.add(stock);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.14, 0.06), GUN_MAT); mag.position.set(0, -0.1, 0.05); gun.add(mag);
    gun.traverse(o => { if (o.isMesh) o.castShadow = true; });
    this.gunPivot.add(gun);
    this.gun = gun;
    this.muzzle = new THREE.Object3D(); this.muzzle.position.z = 0.4; gun.add(this.muzzle);

    const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: nameTag(name), depthTest: false, transparent: true }));
    tag.scale.set(1.4, 0.35, 1); tag.position.y = 2.15; tag.renderOrder = 10;
    this.group.add(tag);
    this.tag = tag;

    loadCharacter(charId).then(asset => this.attach(asset)).catch(e => console.warn('character failed to load', charId, e));
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
    // shoulder height for the rifle
    const sh = this.bones.RightShoulder;
    this.model.updateMatrixWorld(true);
    const shY = sh ? sh.getWorldPosition(new THREE.Vector3()).y - this.group.position.y : 1.4;
    this.gunPivot.position.set(-0.12, shY - 0.12, 0.05);
    this.ready = true;
  }

  apply(s, dt) {
    const g = this.group;
    if (this.last) {
      const v = Math.hypot(s.x - this.last[0], s.z - this.last[1]) / Math.max(dt, 1e-3);
      this.speed += (Math.min(v, 9) - this.speed) * Math.min(1, dt * 8);
    }
    this.last = [s.x, s.z];
    g.position.set(s.x, s.y, s.z);
    g.rotation.y = s.yaw + Math.PI; // camera yaw faces -Z; models face +Z
    g.visible = !s.dd;
    this.pitch += ((s.pitch || 0) - this.pitch) * Math.min(1, dt * 12);

    if (s.dn) { // downed: lying on the floor
      this.body.rotation.x = -1.45; this.body.position.y = 0.25;
      if (this.mixer) { this.walk?.setEffectiveWeight(0); this.run?.setEffectiveWeight(0); this.mixer.update(dt); }
      this.gunPivot.visible = false;
      return;
    }
    this.body.rotation.x = 0; this.body.position.y = 0;
    this.gunPivot.visible = true;
    this.gunPivot.rotation.x = -this.pitch;
    if (!this.ready) return;

    // legs: blend walk -> run by speed
    const sp = this.speed;
    const runK = THREE.MathUtils.smoothstep(sp, 3.8, 6.0);
    const moveK = THREE.MathUtils.smoothstep(sp, 0.2, 1.2);
    this.walk?.setEffectiveWeight(moveK * (1 - runK)); this.walk?.setEffectiveTimeScale(Math.max(0.6, sp / 1.5));
    this.run?.setEffectiveWeight(moveK * runK); this.run?.setEffectiveTimeScale(Math.max(0.8, sp / 5));
    this.mixer.update(dt);

    // upper body: shoulder the rifle and aim with the player's pitch
    const b = this.bones;
    g.updateMatrixWorld(true);
    const gq = g.getWorldQuaternion(new THREE.Quaternion());
    const pitchQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -this.pitch);
    const dir = (x, y, z) => _d.set(x, y, z).normalize().applyQuaternion(pitchQ).applyQuaternion(gq).clone();
    // model space: +Z forward, -X is the character's right, +Y up
    if (b.Spine1) aimBone(b.Spine1, dir(0, 1, -this.pitch * 0.3));
    if (b.RightArm) aimBone(b.RightArm, dir(-0.25, -0.75, 0.35));
    if (b.RightForeArm) aimBone(b.RightForeArm, dir(0.25, 0.3, 0.9));
    if (b.LeftArm) aimBone(b.LeftArm, dir(0.2, -0.55, 0.65));
    if (b.LeftForeArm) aimBone(b.LeftForeArm, dir(-0.35, 0.2, 0.9));
    if (b.Head) aimBone(b.Head, dir(0, 1, 0.1 - this.pitch * 0.4));
  }

  muzzleWorld(v) { return this.muzzle.getWorldPosition(v); }

  dispose() {
    this.scene.remove(this.group);
    this.tag.material.map.dispose();
  }
}
