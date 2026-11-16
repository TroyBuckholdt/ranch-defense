// The ranch dogs: two big red-brown dogs and the little fluffy golden one, generated
// from the ranch's own video (fal/Rodin) and rigged in Blender. They fight on your side.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { heightAt, DOG_TYPES } from '../../shared/world.js';
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
    if (src) {
      const m = SkeletonUtils.clone(src);
      m.traverse(o => {
        if (o.isMesh) { o.material = o.material.clone(); if (id === 2) o.material.color.setRGB(0.82, 0.74, 0.7); }
        if (o.isBone) this.bones[o.name] = { bone: o, rest: o.quaternion.clone() };
      });
      this.body.add(m);
    } else { // placeholder if the model didn't load
      const b = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.5, 4, 8).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: kind ? 0xd8b070 : 0x8a4a28 }));
      b.position.y = 0.45; this.body.add(b);
    }
    // name tag (Jack, Mateo...) floating over the dog
    const name = DOG_TYPES[id - 1]?.name;
    if (name) {
      const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: nameTag(name, '#ffd27a'), depthTest: false, transparent: true }));
      tag.scale.set(1.0, 0.25, 1); tag.position.y = kind === 1 ? 0.95 : 1.35; tag.renderOrder = 10;
      this.root.add(tag);
      this.tag = tag;
    }
    scene.add(this.root);
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
    this.set('neck', neck, 0, head);
    this.set('head', 0.05);
    // happy tail when idle, stiff and high when hunting
    const wag = state === 0 ? Math.sin(t * 14 + this.id) * 0.6 : state === 2 ? Math.sin(t * 6) * 0.15 : Math.sin(t * 8) * 0.25;
    this.set('tail', state === 0 ? -0.2 : -0.6, 0, wag);
  }

  dispose() { this.scene.remove(this.root); }
}
