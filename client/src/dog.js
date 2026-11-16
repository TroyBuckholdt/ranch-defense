// The ranch dogs: two big red-brown dogs, the little fluffy golden one and Pepper (the big
// model in a black coat, who only ever runs and hides under her blanket), generated
// from the ranch's own video (fal/Rodin) and rigged in Blender. They fight on your side.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { heightAt, DOG_TYPES, BLANKET } from '../../shared/world.js';
import { nameTag } from './textures.js';

const ASSETS = {};
export async function loadDogAssets() {
  const loader = new GLTFLoader();
  await Promise.all(['bigdog', 'littledog'].map(async (n) => {
    try {
      const g = await loader.loadAsync(`/assets/models/dogs/${n}.glb`);
      g.scene.traverse(o => {
        if (!o.isMesh) return;
        o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
        o.material.roughness = 0.8; o.material.metalness = 0;
      });
      ASSETS[n] = g.scene;
    } catch (e) { console.warn('dog model failed to load', n, e); }
  }));
}

const qTmp = new THREE.Quaternion(), eTmp = new THREE.Euler();
const smooth01 = (k) => k * k * (3 - 2 * k);

// Pepper's blanket: a cream waffle-knit throw (like the one on her armchair) lying on the
// living-room floor. When she crawls under it, it rises into a dog-shaped lump that
// breathes and trembles.
function knitTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#b9ad98'; g.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 16) for (let x = 0; x < 256; x += 16) {
    const ox = (y / 16) % 2 ? 8 : 0;
    const gr = g.createRadialGradient(x + ox + 7, y + 6, 1, x + ox + 8, y + 8, 9);
    gr.addColorStop(0, '#ece4d4'); gr.addColorStop(0.6, '#d3c8b4'); gr.addColorStop(1, '#9d917c');
    g.fillStyle = gr; g.beginPath(); g.ellipse(x + ox + 8, y + 8, 7.5, 6.5, 0, 0, 7); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(7, 8);
  return t;
}

class Blanket {
  constructor(scene) {
    const W = 1.35, D = 1.7;
    this.geo = new THREE.PlaneGeometry(W, D, 22, 26).rotateX(-Math.PI / 2);
    const pos = this.geo.attributes.position;
    this.base = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      // rumpled: soft folds, and a corner flipped up
      const y = 0.012 + 0.04 * Math.max(0, Math.sin(x * 7 + z * 2.3)) * Math.sin(z * 3.1 + 1) ** 2
        + (x > W / 2 - 0.35 && z > D / 2 - 0.4 ? (x - W / 2 + 0.35) * (z - D / 2 + 0.4) * 0.9 : 0);
      this.base[i * 3] = x; this.base[i * 3 + 1] = y; this.base[i * 3 + 2] = z;
    }
    this.mesh = new THREE.Mesh(this.geo, new THREE.MeshStandardMaterial({ map: knitTexture(), roughness: 1, side: THREE.DoubleSide }));
    this.mesh.position.set(BLANKET.x, heightAt(BLANKET.x, BLANKET.z) + 0.045, BLANKET.z);
    this.mesh.rotation.y = BLANKET.yaw;
    this.mesh.castShadow = this.mesh.receiveShadow = true;
    scene.add(this.mesh);
    this.k = -1;
    this.update(0, 0);
  }
  // k: how far the dog is under it (0..1)
  update(k, t) {
    if (k === 0 && this.k === 0) return;
    this.k = k;
    const pos = this.geo.attributes.position, b = this.base;
    const breathe = 1 + 0.035 * Math.sin(t * 3.1), shiver = 0.004 * Math.sin(t * 37) * k;
    for (let i = 0; i < pos.count; i++) {
      const x = b[i * 3], z = b[i * 3 + 2];
      // a long rounded lump for her curled-up body, a smaller one for her head at the front
      const bodyL = Math.exp(-(((x / 0.3) ** 2 + ((z + 0.08) / 0.48) ** 2) ** 1.4)) * 0.42 * breathe;
      const headL = Math.exp(-((((x - 0.05) / 0.16) ** 2 + ((z - 0.5) / 0.17) ** 2) ** 1.4)) * 0.26;
      const h = Math.max(bodyL, headL);
      // the cloth over her is taken up by the lump, so the edges draw in around it
      const pull = 1 - k * 0.16 * Math.exp(-(x * x + z * z) / 0.9);
      pos.setXYZ(i, x * pull, b[i * 3 + 1] + k * (h + shiver * h * 3), z * pull);
    }
    pos.needsUpdate = true;
    this.geo.computeVertexNormals();
  }
}

export class DogView {
  constructor(id, kind, scene) {
    this.scene = scene;
    this.id = id;
    this.kind = kind;
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    const src = ASSETS[kind === 1 ? 'littledog' : 'bigdog'];
    this.bones = {};
    const def = DOG_TYPES[id - 1];
    if (src) {
      const m = SkeletonUtils.clone(src);
      m.traverse(o => {
        if (o.isMesh) {
          o.material = o.material.clone();
          if (def?.coat) o.material.color.setRGB(...def.coat);
          if (def?.sleek) o.material.roughness = 0.5; // Pepper's short glossy black coat
        }
        if (o.isBone) this.bones[o.name] = { bone: o, rest: o.quaternion.clone() };
      });
      if (def?.scale) m.scale.multiplyScalar(def.scale);
      this.body.add(m);
    } else { // placeholder if the model didn't load
      const b = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.5, 4, 8).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: def?.sleek ? 0x1c1a1a : kind ? 0xd8b070 : 0x8a4a28 }));
      b.position.y = 0.45; this.body.add(b);
    }
    // name tag (Jack, Mateo, Pepper...) floating over the dog
    const name = def?.name;
    if (name) {
      const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: nameTag(name, '#ffd27a'), depthTest: false, transparent: true }));
      tag.scale.set(1.0, 0.25, 1); tag.position.y = kind === 1 ? 0.95 : 1.35; tag.renderOrder = 10;
      this.root.add(tag);
      this.tag = tag;
    }
    scene.add(this.root);
    this.hider = !!def?.hider;
    if (this.hider) { this.blanket = new Blanket(scene); this.hideK = 0; }
    this.phase = Math.random() * 6;
    this.last = null; this.speed = 0; this.downT = 0;
  }

  set(name, x = 0, y = 0, z = 0) {
    const b = this.bones[name];
    if (b) b.bone.quaternion.copy(b.rest).multiply(qTmp.setFromEuler(eTmp.set(x, y, z)));
  }

  apply(s, dt, t) {
    const [x, z, yaw, state] = s;
    if (this.last) {
      const v = Math.hypot(x - this.last[0], z - this.last[1]) / Math.max(dt, 1e-3);
      this.speed += (Math.min(v, 10) - this.speed) * Math.min(1, dt * 8);
    }
    this.last = [x, z];
    this.root.position.set(x, heightAt(x, z), z);
    this.root.rotation.y = yaw;
    const body = this.body;

    if (this.hider) {
      // under the blanket: crawl in head first, then only the trembling lump is left
      const target = state === 4 ? 1 : 0;
      this.hideK += (target - this.hideK) * Math.min(1, dt * 2.5);
      const k = this.hideK;
      this.blanket.update(smooth01(k), t);
      if (this.tag) this.tag.position.y = 1.35 - 0.45 * k;
      if (k > 0.02) {
        body.visible = k < 0.75;
        body.position.set(0, -0.3 * k, -0.25 * k);
        body.rotation.set(0.15 * k, 0, 0);
        for (const l of ['FL', 'FR', 'BL', 'BR']) { this.set(`leg_${l}_up`, l[0] === 'F' ? -0.9 * k : 0.9 * k); this.set(`leg_${l}_lo`, (l[0] === 'F' ? 1.2 : -1.2) * k); }
        this.set('neck', 0.5 * k); this.set('head', 0.2 * k); this.set('tail', -0.85, 0, 0);
        if (state === 4) return;
      }
      body.visible = true;
    }

    if (state === 3) { // knocked down: lying on its side, breathing hard
      this.downT = Math.min(1, this.downT + dt * 3);
      body.rotation.set(0, 0, 1.4 * this.downT);
      body.position.y = -0.05;
      this.set('neck', 0.2); this.set('tail', 0, 0, 0);
      return;
    }
    this.downT = 0;
    body.rotation.set(0, 0, 0);

    const moving = Math.min(1, this.speed / 2);
    const gallop = this.speed > 4;
    this.phase += dt * (3 + this.speed * (this.kind ? 2.6 : 1.9));
    const p = this.phase;
    const swing = (gallop ? 0.9 : 0.5) * moving;
    // galloping: front pair and back pair move together; trotting: diagonal pairs
    const off = gallop ? { FL: 0, FR: 0.4, BL: Math.PI, BR: Math.PI + 0.4 } : { FL: 0, FR: Math.PI, BL: Math.PI, BR: 0 };
    for (const l of ['FL', 'FR', 'BL', 'BR']) {
      const lp = p + off[l];
      this.set(`leg_${l}_up`, -Math.sin(lp) * swing);
      this.set(`leg_${l}_lo`, Math.max(0, Math.cos(lp)) * 0.9 * moving);
    }
    body.position.y = (gallop ? Math.abs(Math.sin(p)) * 0.08 : Math.abs(Math.sin(p * 2)) * 0.02) * moving;
    body.rotation.x = gallop ? Math.sin(p) * 0.08 : 0;

    let neck = -0.1 + Math.sin(t * 1.3 + this.id) * 0.05, head = 0;
    if (state === 2) { // biting: lunge and shake
      const a = (t * 3 + this.id) % 1;
      neck = 0.35 + Math.sin(a * Math.PI) * 0.4;
      head = Math.sin(t * 30) * 0.15;
      body.rotation.x = -0.12;
      body.position.y = 0.02;
    }
    if (this.hider) { // scared: head low, ears back, tail tucked between her legs
      this.set('neck', 0.3 + Math.sin(t * 9) * 0.05, 0, Math.sin(t * 4.3) * 0.15);
      this.set('head', 0.15);
      this.set('tail', -0.85, 0, Math.sin(t * 20) * 0.05);
      return;
    }
    this.set('neck', neck, 0, head);
    this.set('head', 0.05);
    // happy tail when idle, stiff and high when hunting
    const wag = state === 0 ? Math.sin(t * 14 + this.id) * 0.6 : state === 2 ? Math.sin(t * 6) * 0.15 : Math.sin(t * 8) * 0.25;
    this.set('tail', state === 0 ? -0.2 : -0.6, 0, wag);
  }

  dispose() {
    this.scene.remove(this.root);
    if (this.blanket) { this.scene.remove(this.blanket.mesh); this.blanket.geo.dispose(); }
  }
}
