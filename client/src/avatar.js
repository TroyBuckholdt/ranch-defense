// Other players as seen by you: a rancher with a hat, a rifle and a name tag.
// Later this can be replaced with characters made from photos of the real players.
import * as THREE from 'three';
import { nameTag } from './textures.js';

const SHIRTS = [0x8a2b2b, 0x2b4a8a, 0x3a6a3a, 0x8a6a2b, 0x5a3a7a, 0x2b7a7a, 0x7a4a2b, 0x6a6a6a];
const std = (c, extra = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, ...extra });

export class Avatar {
  constructor(id, name, scene) {
    this.scene = scene;
    const shirt = std(SHIRTS[id % SHIRTS.length]);
    const jeans = std(0x2a3448);
    const skin = std(0xc89878);
    const leather = std(0x5a3a22);
    const g = new THREE.Group();

    const hips = new THREE.Group(); hips.position.y = 0.95; g.add(hips);
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.45, 4, 10), shirt);
    torso.position.y = 0.38; hips.add(torso);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 10), skin);
    head.position.y = 0.85; hips.add(head);
    // cowboy hat
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.025, 20), leather);
    brim.position.y = 0.96; hips.add(brim);
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.16, 14), leather);
    crown.position.y = 1.04; hips.add(crown);

    // arms hold the rifle forward
    const armGeo = new THREE.CapsuleGeometry(0.06, 0.45, 3, 6).rotateX(Math.PI / 2);
    const armL = new THREE.Mesh(armGeo, shirt); armL.position.set(-0.18, 0.55, 0.25); armL.rotation.y = 0.35;
    const armR = new THREE.Mesh(armGeo, shirt); armR.position.set(0.16, 0.55, 0.15); armR.rotation.y = 0.1;
    hips.add(armL, armR);
    const gun = new THREE.Group(); gun.position.set(0.05, 0.6, 0.35); hips.add(gun);
    gun.add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.75), std(0x1c1c1c, { metalness: 0.6, roughness: 0.4 })));
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.3), std(0x6a4024)); stock.position.z = -0.45; gun.add(stock);
    this.muzzle = new THREE.Object3D(); this.muzzle.position.z = 0.42; gun.add(this.muzzle);

    const legGeo = new THREE.CapsuleGeometry(0.085, 0.7, 3, 6).translate(0, -0.45, 0);
    this.legL = new THREE.Mesh(legGeo, jeans); this.legL.position.set(-0.11, 0, 0);
    this.legR = new THREE.Mesh(legGeo, jeans); this.legR.position.set(0.11, 0, 0);
    hips.add(this.legL, this.legR);

    const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: nameTag(name), depthTest: false, transparent: true }));
    tag.scale.set(1.4, 0.35, 1); tag.position.y = 2.35; tag.renderOrder = 10;
    g.add(tag);
    this.tag = tag;

    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    this.group = g; this.hips = hips; this.gun = gun;
    this.phase = 0; this.last = null; this.speed = 0;
    scene.add(g);
  }

  apply(s, dt) {
    const g = this.group;
    if (this.last) {
      const v = Math.hypot(s.x - this.last[0], s.z - this.last[1]) / Math.max(dt, 1e-3);
      this.speed += (Math.min(v, 9) - this.speed) * Math.min(1, dt * 10);
    }
    this.last = [s.x, s.z];
    g.position.set(s.x, s.y, s.z);
    g.rotation.y = s.yaw + Math.PI; // camera yaw faces -Z; the model faces +Z
    g.visible = !s.dd;
    if (s.dn) { // downed: lying on the floor
      this.hips.rotation.x = -1.4; this.hips.position.y = 0.25;
      this.legL.rotation.x = this.legR.rotation.x = 0;
      return;
    }
    this.hips.rotation.x = 0; this.hips.position.y = 0.95;
    this.phase += dt * this.speed * 2.2;
    const sw = Math.min(1, this.speed / 3) * 0.7;
    this.legL.rotation.x = Math.sin(this.phase) * sw;
    this.legR.rotation.x = -Math.sin(this.phase) * sw;
    this.gun.rotation.x = -s.pitch * 0.8;
  }

  muzzleWorld(v) { return this.muzzle.getWorldPosition(v); }

  dispose() {
    this.scene.remove(this.group);
    this.tag.material.map.dispose();
  }
}
