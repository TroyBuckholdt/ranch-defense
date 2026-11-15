// Particles and short-lived effects: blood, dust, wood splinters, shell casings,
// tracers, blood pools and remote muzzle flashes. Everything is pooled.
import * as THREE from 'three';
import * as T from './textures.js';

const MAX = 1500;

export class FX {
  constructor(scene) {
    this.scene = scene;
    // one instanced mesh for all solid little particles
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.1 });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.setColorAt(0, new THREE.Color());
    scene.add(this.mesh);
    this.parts = [];

    // soft smoke/dust puffs (sprites)
    this.puffs = [];
    this.puffMat = new THREE.SpriteMaterial({ map: T.smoke(), transparent: true, depthWrite: false, color: 0xb0a090 });

    // tracers
    this.tracers = [];
    this.tracerMat = new THREE.LineBasicMaterial({ color: new THREE.Color(4, 3, 1.6), transparent: true });

    // blood pools on the floor
    this.pools = [];
    this.poolGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

    // remote muzzle flashes
    this.flashes = [];
    this.flashMat = new THREE.SpriteMaterial({ map: T.flare(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, color: new THREE.Color(3, 2.2, 1.4) });
    // fixed pool of lights: adding/removing lights at runtime forces shader recompiles (stutter)
    this.flashLights = [0, 1].map(() => { const l = new THREE.PointLight(0xffaa55, 0, 10, 2); scene.add(l); return l; });
    this.flashLightIdx = 0;

    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler();
    this._s = new THREE.Vector3(); this._v = new THREE.Vector3();
  }

  spawn(n, pos, opts) {
    for (let i = 0; i < n; i++) {
      if (this.parts.length >= MAX) this.parts.shift();
      const sp = opts.speed * (0.4 + Math.random() * 0.8);
      const dir = new THREE.Vector3(
        (opts.dir?.x || 0) + (Math.random() - 0.5) * opts.spread,
        (opts.dir?.y || 0) + Math.random() * opts.up,
        (opts.dir?.z || 0) + (Math.random() - 0.5) * opts.spread,
      ).normalize().multiplyScalar(sp);
      this.parts.push({
        p: pos.clone(), v: dir, life: opts.life * (0.6 + Math.random() * 0.8), age: 0,
        size: opts.size * (0.5 + Math.random()), color: new THREE.Color(opts.color).multiplyScalar(0.7 + Math.random() * 0.5),
        grav: opts.grav ?? 9.8, rot: new THREE.Vector3(Math.random() * 6, Math.random() * 6, Math.random() * 6),
        spin: opts.spin ?? 8, stretch: opts.stretch || 1, bounce: opts.bounce || 0, floor: opts.floor ?? 0,
      });
    }
  }

  blood(pos, dir, big = false) {
    const d = dir.clone().multiplyScalar(-0.4);
    this.spawn(big ? 40 : 18, pos, { dir: d, spread: 1.6, up: 0.8, speed: big ? 5 : 3.5, life: 0.9, size: 0.045, color: 0x7a0606, grav: 9, spin: 2 });
    this.spawn(big ? 18 : 8, pos, { dir: dir.clone().multiplyScalar(0.6), spread: 1, up: 0.3, speed: 4, life: 0.6, size: 0.03, color: 0x4a0202, grav: 9 });
    this.puff(pos, 0x6a0a0a, 0.6, 0.5);
    if (big || Math.random() < 0.35) this.pool(pos.x, pos.z, big ? 1.6 : 0.7);
  }

  dust(pos, normal) {
    this.spawn(10, pos, { dir: normal, spread: 1.2, up: 0.5, speed: 3, life: 0.5, size: 0.025, color: 0x8a7a64, grav: 8 });
    this.puff(pos, 0xa89880, 0.4, 0.7);
  }

  splinters(pos, normal) {
    this.spawn(26, pos, { dir: normal, spread: 1.4, up: 1.2, speed: 4.5, life: 1.2, size: 0.05, color: 0x8a6a48, grav: 9.8, stretch: 4, bounce: 0.3 });
    this.puff(pos, 0x9a8a70, 0.8, 1.2);
  }

  casing(pos, right) {
    this.spawn(1, pos, { dir: right.clone().add(new THREE.Vector3(0, 0.6, 0)), spread: 0.3, up: 0.2, speed: 3, life: 2.5, size: 0.012, color: 0xc89a3a, grav: 9.8, stretch: 2.5, bounce: 0.35, spin: 25 });
  }

  puff(pos, color, size, life) {
    const s = new THREE.Sprite(this.puffMat.clone());
    s.material.color.set(color);
    s.position.copy(pos);
    s.scale.setScalar(size * 0.4);
    this.scene.add(s);
    this.puffs.push({ s, age: 0, life, size });
  }

  tracer(from, to) {
    // only draw part of the path so it reads as a streak, not a laser
    const dir = to.clone().sub(from);
    const len = dir.length();
    if (len < 2) return;
    const start = from.clone().addScaledVector(dir, 0.08);
    const g = new THREE.BufferGeometry().setFromPoints([start, start.clone().addScaledVector(dir, Math.min(0.5, 6 / len))]);
    const l = new THREE.Line(g, this.tracerMat.clone());
    this.scene.add(l);
    this.tracers.push({ l, age: 0, from: start, dir: dir.normalize(), len, speed: 380 });
  }

  pool(x, z, size) {
    const m = new THREE.Mesh(this.poolGeo, new THREE.MeshStandardMaterial({
      map: T.blood(), transparent: true, depthWrite: false, roughness: 0.15, metalness: 0.2,
      polygonOffset: true, polygonOffsetFactor: -4,
    }));
    m.position.set(x, 0.03, z);
    m.rotation.y = Math.random() * 6;
    m.scale.setScalar(0.01);
    m.receiveShadow = true;
    this.scene.add(m);
    this.pools.push({ m, age: 0, size });
    if (this.pools.length > 60) { const o = this.pools.shift(); this.scene.remove(o.m); o.m.material.dispose(); }
  }

  muzzleFlash(pos) {
    const s = new THREE.Sprite(this.flashMat);
    s.position.copy(pos);
    s.scale.setScalar(0.5 + Math.random() * 0.3);
    this.scene.add(s);
    const light = this.flashLights[this.flashLightIdx++ % this.flashLights.length];
    light.position.copy(pos);
    light.intensity = 25;
    this.flashes.push({ s, light, age: 0 });
  }

  update(dt) {
    const m = this._m, q = this._q, e = this._e, s = this._s;
    let n = 0;
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.age += dt;
      if (p.age > p.life) { this.parts.splice(i, 1); continue; }
      p.v.y -= p.grav * dt;
      p.p.addScaledVector(p.v, dt);
      if (p.p.y < p.floor + 0.01) {
        p.p.y = p.floor + 0.01;
        if (p.bounce) { p.v.y = -p.v.y * p.bounce; p.v.x *= 0.6; p.v.z *= 0.6; } else p.v.set(0, 0, 0);
        p.spin *= 0.5;
      }
      p.rot.x += p.spin * dt; p.rot.y += p.spin * dt * 0.7;
      const k = 1 - Math.pow(p.age / p.life, 3);
      q.setFromEuler(e.set(p.rot.x, p.rot.y, p.rot.z));
      m.compose(p.p, q, s.set(p.size * k, p.size * k, p.size * k * p.stretch));
      this.mesh.setMatrixAt(n, m);
      this.mesh.setColorAt(n, p.color);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;

    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const f = this.puffs[i];
      f.age += dt;
      const k = f.age / f.life;
      if (k >= 1) { this.scene.remove(f.s); f.s.material.dispose(); this.puffs.splice(i, 1); continue; }
      f.s.scale.setScalar(f.size * (0.4 + k));
      f.s.material.opacity = 0.5 * (1 - k);
      f.s.position.y += dt * 0.3;
    }

    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.age += dt;
      const dist = t.age * t.speed;
      if (dist > t.len) { this.scene.remove(t.l); t.l.geometry.dispose(); t.l.material.dispose(); this.tracers.splice(i, 1); continue; }
      const a = t.from.clone().addScaledVector(t.dir, dist);
      const b = t.from.clone().addScaledVector(t.dir, Math.min(t.len, dist + 5));
      t.l.geometry.setFromPoints([a, b]);
    }

    for (const p of this.pools) {
      p.age += dt;
      const k = Math.min(1, p.age / 1.5);
      p.m.scale.setScalar(p.size * (1 - (1 - k) ** 2));
      if (p.age > 40) p.m.material.opacity = Math.max(0, 1 - (p.age - 40) / 10);
    }

    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.age += dt;
      if (f.age > 0.05) { this.scene.remove(f.s); f.light.intensity = 0; this.flashes.splice(i, 1); }
    }
  }

  clearPools() {
    for (const p of this.pools) { this.scene.remove(p.m); p.m.material.dispose(); }
    this.pools = [];
  }
}
