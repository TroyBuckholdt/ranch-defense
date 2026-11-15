// First-person rifle: model, sway, bob, recoil, reload and aim-down-sights.
import * as THREE from 'three';
import * as T from './textures.js';

const metal = new THREE.MeshStandardMaterial({ color: 0x4a4e54, roughness: 0.35, metalness: 0.8 });
const metal2 = new THREE.MeshStandardMaterial({ color: 0x5a5e64, roughness: 0.45, metalness: 0.7 });
const wood = new THREE.MeshStandardMaterial({ color: 0xb07a4a, roughness: 0.5, map: T.floorWood() });
const glass = new THREE.MeshStandardMaterial({ color: 0x0a1a20, roughness: 0.05, metalness: 0.9, emissive: 0x05121a });
const skin = new THREE.MeshStandardMaterial({ color: 0xb98a6a, roughness: 0.8 });
const glove = new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.9 });
const sleeve = new THREE.MeshStandardMaterial({ color: 0x4a5a3a, roughness: 0.95 });

function part(geo, mat, x, y, z, parent) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

export class Weapon {
  constructor(camera) {
    this.root = new THREE.Group();       // follows camera
    this.pivot = new THREE.Group();      // sway / recoil / reload offsets
    this.root.add(this.pivot);
    camera.add(this.root);

    const g = new THREE.Group();
    this.gun = g;
    this.pivot.add(g);
    // receiver, barrel, handguard, stock, grip, scope, magazine
    part(new THREE.BoxGeometry(0.07, 0.1, 0.42), metal, 0, 0, 0, g);
    const barrel = part(new THREE.CylinderGeometry(0.014, 0.016, 0.55, 12), metal2, 0, 0.015, -0.48, g); barrel.rotation.x = Math.PI / 2;
    part(new THREE.BoxGeometry(0.075, 0.075, 0.32), wood, 0, -0.005, -0.36, g);
    const stock = part(new THREE.BoxGeometry(0.06, 0.12, 0.34), wood, 0, -0.035, 0.36, g); stock.rotation.x = -0.12;
    const grip = part(new THREE.BoxGeometry(0.05, 0.13, 0.06), wood, 0, -0.1, 0.12, g); grip.rotation.x = 0.35;
    const mag = part(new THREE.BoxGeometry(0.045, 0.16, 0.08), metal2, 0, -0.12, -0.06, g); mag.rotation.x = 0.15;
    this.mag = mag; this.magHome = mag.position.clone();
    const tube = part(new THREE.CylinderGeometry(0.024, 0.024, 0.3, 14), metal, 0, 0.085, -0.02, g); tube.rotation.x = Math.PI / 2;
    for (const z of [-0.17, 0.13]) {
      const bell = part(new THREE.CylinderGeometry(0.032, 0.026, 0.05, 14), metal, 0, 0.085, z, g); bell.rotation.x = Math.PI / 2;
    }
    const lens = part(new THREE.CircleGeometry(0.026, 16), glass, 0, 0.085, 0.157, g);
    lens.rotation.y = 0;
    part(new THREE.BoxGeometry(0.02, 0.03, 0.04), metal, 0, 0.055, -0.05, g);
    part(new THREE.BoxGeometry(0.02, 0.03, 0.04), metal, 0, 0.055, 0.08, g);
    // gloved hands + sleeves
    const hand = part(new THREE.BoxGeometry(0.07, 0.07, 0.11), glove, 0.005, -0.08, -0.33, g);
    hand.rotation.x = 0.2;
    part(new THREE.CylinderGeometry(0.045, 0.055, 0.32, 8), sleeve, 0.06, -0.14, -0.2, g).rotation.set(1.2, 0, 0.5);
    part(new THREE.BoxGeometry(0.07, 0.08, 0.1), glove, 0.03, -0.12, 0.13, g);
    part(new THREE.CylinderGeometry(0.05, 0.06, 0.32, 8), sleeve, 0.09, -0.18, 0.28, g).rotation.set(1.0, 0, 0.3);
    part(new THREE.BoxGeometry(0.012, 0.02, 0.012), skin, 0.03, -0.06, 0.08, g);

    g.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });

    this.muzzle = new THREE.Object3D();
    this.muzzle.position.set(0, 0.015, -0.78);
    g.add(this.muzzle);
    this.ejectPort = new THREE.Object3D();
    this.ejectPort.position.set(0.04, 0.03, -0.02);
    g.add(this.ejectPort);

    // muzzle flash: crossed additive planes + a real light
    const flashMat = new THREE.MeshBasicMaterial({ map: T.flare(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: new THREE.Color(8, 6, 4) });
    this.flash = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.32), flashMat);
      p.rotation.set(i === 0 ? 0 : Math.PI / 2, i === 2 ? Math.PI / 2 : 0, 0);
      this.flash.add(p);
    }
    const side = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.5), flashMat);
    side.rotation.x = Math.PI / 2; side.position.z = -0.18;
    this.flash.add(side);
    this.flash.position.copy(this.muzzle.position);
    this.flash.visible = false;
    g.add(this.flash);
    this.flashLight = new THREE.PointLight(0xffaa55, 0, 9, 2);
    this.flashLight.position.set(0, 0, -0.9);
    this.root.add(this.flashLight);

    this.hip = new THREE.Vector3(0.17, -0.17, -0.38);
    this.ads = new THREE.Vector3(0, -0.085, -0.25);
    this.root.position.copy(this.hip);

    this.recoil = 0; this.recoilYaw = 0;
    this.sway = new THREE.Vector2();
    this.bob = 0;
    this.flashT = 0;
    this.reloadT = 0; this.reloadDur = 1;
    this.aim = 0;
  }

  kick() {
    this.recoil = Math.min(1.4, this.recoil + 0.55);
    this.recoilYaw = (Math.random() - 0.5) * 0.6;
    this.flashT = 0.045;
    this.flash.rotation.z = Math.random() * Math.PI;
    this.flash.scale.setScalar(0.8 + Math.random() * 0.5);
  }

  startReload(dur) { this.reloadT = dur; this.reloadDur = dur; }

  update(dt, { aiming, moveSpeed, sprinting, lookDX, lookDY, time, grounded }) {
    this.aim += ((aiming ? 1 : 0) - this.aim) * Math.min(1, dt * 14);
    const a = this.aim;
    // sway lags behind mouse movement
    this.sway.x += (-lookDX * 0.0006 - this.sway.x) * Math.min(1, dt * 10);
    this.sway.y += (lookDY * 0.0006 - this.sway.y) * Math.min(1, dt * 10);
    this.sway.clampScalar(-0.04, 0.04);

    // walk bob
    this.bob += dt * (sprinting ? 13 : 9) * Math.min(1, moveSpeed / 4);
    const bobAmt = (grounded ? Math.min(1, moveSpeed / 4) : 0) * (1 - a * 0.85) * (sprinting ? 1.8 : 1);
    const bx = Math.sin(this.bob) * 0.012 * bobAmt, by = -Math.abs(Math.cos(this.bob)) * 0.012 * bobAmt;
    const breathe = Math.sin(time * 1.6) * 0.003 * (1 - a * 0.7);

    this.recoil = Math.max(0, this.recoil - dt * 9 * (0.5 + this.recoil));
    this.recoilYaw *= Math.max(0, 1 - dt * 12);

    this.root.position.lerpVectors(this.hip, this.ads, a);
    this.root.position.x += bx + this.sway.x * (1 - a * 0.7);
    this.root.position.y += by + breathe + this.sway.y * (1 - a * 0.7);
    this.root.position.z += this.recoil * 0.06;

    // sprint: tilt the gun down and across
    const sp = sprinting && !aiming ? 1 : 0;
    this.sprintK = (this.sprintK || 0) + (sp - (this.sprintK || 0)) * Math.min(1, dt * 8);
    const sk = this.sprintK;

    // reload: dip, roll, mag drops and returns
    let rx = 0, rz = 0;
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      const k = 1 - Math.max(0, this.reloadT) / this.reloadDur;
      const env = Math.sin(Math.min(1, k) * Math.PI);
      rx = -env * 0.5; rz = env * 0.7;
      const magOut = k > 0.2 && k < 0.65 ? Math.sin(((k - 0.2) / 0.45) * Math.PI) : 0;
      this.mag.position.set(this.magHome.x, this.magHome.y - magOut * 0.25, this.magHome.z);
    } else {
      this.mag.position.copy(this.magHome);
    }
    this.pivot.rotation.set(this.recoil * 0.09 + rx - sk * 0.5, this.recoilYaw * 0.05 + sk * 0.6, rz + sk * 0.3);

    this.flashT -= dt;
    this.flash.visible = this.flashT > 0;
    this.flashLight.intensity = this.flashT > 0 ? 30 : 0;
  }

  muzzleWorld(v) { return this.muzzle.getWorldPosition(v); }
  ejectWorld(v) { return this.ejectPort.getWorldPosition(v); }
}
