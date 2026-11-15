// Zombie Brahman model + animation (matched to the white Brahman herd on the ranch). Built from primitives for now; designed so a rigged
// GLB cow (from a 3D store or generated from photos of the real cows) can replace
// `buildCowModel` later without touching the rest of the game.
import * as THREE from 'three';
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

// One cow on screen. `apply` takes the interpolated server state each frame.
export class CowView {
  constructor(id, type, scene) {
    this.id = id;
    this.type = type;
    this.m = buildCowModel(type);
    this.scene = scene;
    scene.add(this.m.root);
    this.phase = Math.random() * 10;
    this.limp = 0.6 + Math.random() * 0.8;   // every zombie lurches differently
    this.tilt = (Math.random() - 0.5) * 0.6;
    this.deathT = 0;
    this.flash = 0;
    this.lastPos = null;
    this.speed = 0;
    this.state = 0;
    this.deathSide = Math.random() < 0.5 ? -1 : 1;
    // individual material so hit flashes don't light up every cow
    this.mat = this.m.hideMat.clone();
    this.m.root.traverse(o => { if (o.isMesh && o.material === this.m.hideMat) o.material = this.mat; });
  }

  apply(s, dt, t) {
    const { root, body, neckPivot, head, jaw, legs, tail } = this.m;
    const [x, z, yaw, state, y] = s;
    if (this.lastPos) {
      const d = Math.hypot(x - this.lastPos[0], z - this.lastPos[1]) / Math.max(dt, 1e-3);
      this.speed += (Math.min(d, 8) - this.speed) * Math.min(1, dt * 8);
    }
    this.lastPos = [x, z];
    root.position.set(x, (y || 0) + heightAt(x, z), z);
    root.rotation.y = yaw;
    this.state = state;

    // hit flash
    this.flash = Math.max(0, this.flash - dt * 6);
    this.mat.emissive.setRGB(this.flash * 0.8, 0, 0);

    if (state === 2) { // dead: topple onto its side, then sink into the ground
      this.deathT += dt;
      const k = Math.min(1, this.deathT / 0.55);
      const ease = 1 - (1 - k) ** 3;
      body.rotation.z = this.deathSide * ease * 1.45;
      body.position.y = -ease * 0.45 * COW_TYPES[this.type].scale + (this.deathT > 4 ? -(this.deathT - 4) * 0.6 : 0);
      for (const l of legs) { l.hip.rotation.x *= 0.9; l.knee.rotation.x = -0.6 * ease; }
      neckPivot.rotation.x = 0.6 * ease;
      return;
    }

    const runner = this.type === 'runner';
    const gait = runner ? 2.2 : 1.5;
    this.phase += dt * (1.5 + this.speed * gait);
    const p = this.phase;
    const moving = Math.min(1, this.speed / 1.5);

    // legs: diagonal pairs, with a dragging limp on one rear leg
    const swing = (runner ? 0.75 : 0.5) * moving;
    const off = [0, Math.PI, Math.PI, 0];
    legs.forEach((l, i) => {
      const lp = p + off[i];
      const limp = i === 3 ? this.limp : 1;
      l.hip.rotation.x = Math.sin(lp) * swing * limp;
      l.knee.rotation.x = Math.max(0, -Math.cos(lp)) * 0.7 * moving * limp;
    });

    // body lurch + sway
    body.position.y = Math.abs(Math.sin(p)) * 0.07 * moving;
    body.rotation.z = this.tilt * 0.3 + Math.sin(p * 0.5) * 0.08;
    body.rotation.x = 0;
    tail.rotation.z = Math.sin(t * 3 + this.id) * 0.4;

    // head: lolling zombie head, twitches now and then
    const twitch = Math.sin(t * 17 + this.id * 3) > 0.97 ? Math.sin(t * 60) * 0.25 : 0;
    neckPivot.rotation.set(-0.15 + Math.sin(p * 0.5) * 0.12, Math.sin(t * 0.7 + this.id) * 0.25, this.tilt + twitch);
    jaw.rotation.x = 0.15 + Math.abs(Math.sin(t * 4 + this.id)) * 0.25;

    if (state === 1) { // attack: violent headbutt / bite
      const a = (t * 2.2 + this.id) % 1;
      const thrust = a < 0.25 ? a / 0.25 : Math.max(0, 1 - (a - 0.25) / 0.4);
      neckPivot.rotation.x = -0.1 + thrust * 0.7;
      head.position.z = 0.55 + thrust * 0.25;
      body.rotation.x = -thrust * 0.12;
      jaw.rotation.x = 0.2 + thrust * 0.5;
    } else if (state === 3) { // tearing at boards: rear up and paw/bite at the opening
      const a = Math.sin(t * 7 + this.id);
      body.rotation.x = -0.35 - a * 0.12;
      body.position.y = 0.25;
      legs[0].hip.rotation.x = -1.0 + Math.sin(t * 9 + this.id) * 0.6;
      legs[1].hip.rotation.x = -1.0 + Math.sin(t * 9 + this.id + 2) * 0.6;
      neckPivot.rotation.x = 0.2 + a * 0.4;
      jaw.rotation.x = 0.5 + Math.abs(a) * 0.4;
      head.position.z = 0.55;
    } else if (state === 4) { // vaulting in: pitch forward over the sill
      body.rotation.x = -0.5 + Math.sin(t * 6) * 0.1;
      legs[0].hip.rotation.x = legs[1].hip.rotation.x = -1.2;
      legs[2].hip.rotation.x = legs[3].hip.rotation.x = 0.8;
      head.position.z = 0.55;
    } else {
      head.position.z = 0.55;
    }
  }

  hit() { this.flash = 1; }

  dispose() {
    this.scene.remove(this.m.root);
    this.mat.dispose();
  }
}
