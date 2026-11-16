// First-person weapons: a model per gun, sway, bob, recoil, reload, aim-down-sights,
// weapon switching, machete swing and grenade throw.
// The guns and gloved arms are generated 3D models (fal: Nano Banana Pro photo -> Rodin);
// simple placeholder guns show until they finish loading. The arms and gun live in their
// own scene, drawn on top of the world (see ViewmodelPass) and lit by their own lights.
import * as THREE from 'three';
import { gltfLoader } from './gltf.js';
import * as T from './textures.js';

// Real-world fit for each generated model: overall length (m), where the trigger hand sits
// and where the support hand holds (fractions of the length from the butt), the sight line
// height above the bore, the aim-down-sights distance, and the hip position.
const GUN_FIT = {
  rifle:    { len: 0.93, grip: 0.43, fore: 0.68, sight: 0.058, adsZ: -0.24, hip: [0.14, -0.1, -0.33], splitMag: true },
  revolver: { len: 0.30, grip: 0.16, fore: null, sight: 0.034, adsZ: -0.36, hip: [0.13, -0.085, -0.38], flip: true },
  shotgun:  { len: 1.04, grip: 0.34, fore: 0.68, sight: 0.03, adsZ: -0.24, hip: [0.14, -0.095, -0.32] },
  hunting:  { len: 1.12, grip: 0.33, fore: 0.62, sight: 0.075, scope: true, adsZ: -0.2, hip: [0.14, -0.1, -0.32] },
  lmg:      { len: 1.12, grip: 0.31, fore: 0.6, sight: 0.075, adsZ: -0.26, hip: [0.15, -0.11, -0.34] },
};
// Arms: where each hand grips (gun space: origin at the trigger on the bore line, -Z toward
// the muzzle, +X the gun's right side), which way the forearm runs back toward the elbow,
// and which way the model's "up" (thumb for the trigger hand, palm for the support hand) faces.
export const HAND_FIT = {
  // arm: direction from the hand back toward the wrist; bend: how far the forearm then drops (rad)
  right: { at: [0.018, -0.085, 0.045], arm: [0.12, -0.12, 1], up: [-0.15, 1, 0], bend: 1.0, len: 0.38, palm: 0.13, wrist: 0.36 },
  left: { at: [-0.012, -0.075, 0], arm: [-0.12, -0.05, 1], up: [0.85, 1, 0], bend: 0.55, len: 0.42, palm: 0.15, wrist: 0.36 },
  revolverLeft: { at: [-0.03, -0.1, 0.045], arm: [-0.3, -0.25, 0.92], up: [0.8, 1, 0], bend: 0.6 },
};
const loader = gltfLoader();

const metal = new THREE.MeshStandardMaterial({ color: 0x4a4e54, roughness: 0.35, metalness: 0.8 });
const metal2 = new THREE.MeshStandardMaterial({ color: 0x5a5e64, roughness: 0.45, metalness: 0.7 });
const blued = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.3, metalness: 0.9 });
const wood = new THREE.MeshStandardMaterial({ color: 0xb07a4a, roughness: 0.5, map: T.floorWood() });
const darkWood = new THREE.MeshStandardMaterial({ color: 0x6a3e22, roughness: 0.45, map: T.floorWood() });
const polymer = new THREE.MeshStandardMaterial({ color: 0x2f3a2a, roughness: 0.7 });
const glass = new THREE.MeshStandardMaterial({ color: 0x0a1a20, roughness: 0.05, metalness: 0.9, emissive: 0x05121a });
const steel = new THREE.MeshStandardMaterial({ color: 0xb8bcc0, roughness: 0.25, metalness: 0.95 });
const skin = new THREE.MeshStandardMaterial({ color: 0xb98a6a, roughness: 0.8 });
const glove = new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.9 });
const sleeve = new THREE.MeshStandardMaterial({ color: 0x4a5a3a, roughness: 0.95 });

function part(geo, mat, x, y, z, parent, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  parent.add(m);
  return m;
}
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const tube = (r1, r2, l, s = 12) => new THREE.CylinderGeometry(r1, r2, l, s);
const HALF = Math.PI / 2;

function hands(g, frontZ, rearZ = 0.12) {
  part(box(0.07, 0.07, 0.11), glove, 0.005, -0.08, frontZ, g, 0.2);
  part(tube(0.045, 0.055, 0.32, 8), sleeve, 0.06, -0.14, frontZ + 0.13, g, 1.2, 0, 0.5);
  part(box(0.07, 0.08, 0.1), glove, 0.03, -0.12, rearZ, g);
  part(tube(0.05, 0.06, 0.32, 8), sleeve, 0.09, -0.18, rearZ + 0.15, g, 1.0, 0, 0.3);
}

// Each builder returns { group, muzzle z, eject, mag mesh, ads offset }
const BUILDERS = {
  rifle() {
    const g = new THREE.Group();
    part(box(0.07, 0.1, 0.42), metal, 0, 0, 0, g);
    part(tube(0.014, 0.016, 0.55), metal2, 0, 0.015, -0.48, g, HALF);
    part(box(0.075, 0.075, 0.32), wood, 0, -0.005, -0.36, g);
    part(box(0.06, 0.12, 0.34), wood, 0, -0.035, 0.36, g, -0.12);
    part(box(0.05, 0.13, 0.06), wood, 0, -0.1, 0.12, g, 0.35);
    const mag = part(box(0.045, 0.16, 0.08), metal2, 0, -0.12, -0.06, g, 0.15);
    part(tube(0.024, 0.024, 0.3, 14), metal, 0, 0.085, -0.02, g, HALF);
    for (const z of [-0.17, 0.13]) part(tube(0.032, 0.026, 0.05, 14), metal, 0, 0.085, z, g, HALF);
    part(new THREE.CircleGeometry(0.026, 16), glass, 0, 0.085, 0.157, g);
    hands(g, -0.33);
    return { g, muzzle: -0.78, mag, ads: new THREE.Vector3(0, -0.085, -0.25) };
  },
  revolver() {
    const g = new THREE.Group();
    part(box(0.04, 0.07, 0.12), blued, 0, 0.02, -0.05, g);
    part(tube(0.012, 0.012, 0.2), blued, 0, 0.035, -0.2, g, HALF);
    const mag = part(tube(0.032, 0.032, 0.06, 6), steel, 0, 0.015, -0.06, g, HALF);
    part(box(0.035, 0.11, 0.05), darkWood, 0, -0.05, 0.03, g, 0.35);
    part(box(0.006, 0.02, 0.02), blued, 0, 0.065, -0.29, g);
    part(box(0.07, 0.07, 0.1), glove, 0.005, -0.06, 0.05, g);
    part(tube(0.05, 0.06, 0.3, 8), sleeve, 0.04, -0.11, 0.2, g, 1.1);
    part(box(0.06, 0.06, 0.09), glove, -0.04, -0.07, 0.03, g, 0, 0, 0.4);
    return { g, muzzle: -0.31, mag, ads: new THREE.Vector3(0, -0.07, -0.32) };
  },
  shotgun() {
    const g = new THREE.Group();
    part(box(0.065, 0.09, 0.3), blued, 0, 0, 0, g);
    part(tube(0.02, 0.02, 0.7), blued, 0, 0.02, -0.5, g, HALF);
    part(tube(0.016, 0.016, 0.55), metal2, 0, -0.025, -0.42, g, HALF);
    const mag = part(box(0.07, 0.07, 0.2), darkWood, 0, -0.03, -0.42, g); // pump slides on reload
    part(box(0.06, 0.13, 0.36), darkWood, 0, -0.045, 0.3, g, -0.15);
    part(box(0.05, 0.12, 0.06), darkWood, 0, -0.09, 0.1, g, 0.4);
    hands(g, -0.42, 0.1);
    return { g, muzzle: -0.86, mag, ads: new THREE.Vector3(0, -0.075, -0.22) };
  },
  hunting() {
    const g = new THREE.Group();
    part(box(0.06, 0.08, 0.4), blued, 0, 0, 0, g);
    part(tube(0.013, 0.017, 0.75), blued, 0, 0.012, -0.58, g, HALF);
    part(box(0.07, 0.07, 0.5), darkWood, 0, -0.03, -0.3, g);
    part(box(0.06, 0.13, 0.4), darkWood, 0, -0.05, 0.38, g, -0.1);
    part(box(0.05, 0.12, 0.06), darkWood, 0, -0.09, 0.12, g, 0.35);
    part(tube(0.006, 0.006, 0.06), steel, 0.05, 0.02, 0.05, g, 0, 0, HALF); // bolt handle
    const mag = part(box(0.04, 0.05, 0.08), blued, 0, -0.07, -0.02, g);
    part(tube(0.028, 0.028, 0.36, 16), blued, 0, 0.09, -0.02, g, HALF);
    for (const z of [-0.22, 0.17]) part(tube(0.04, 0.03, 0.07, 16), blued, 0, 0.09, z, g, HALF);
    part(new THREE.CircleGeometry(0.03, 16), glass, 0, 0.09, 0.205, g);
    hands(g, -0.36);
    return { g, muzzle: -0.96, mag, ads: new THREE.Vector3(0, -0.092, -0.17), scope: true };
  },
  lmg() {
    const g = new THREE.Group();
    part(box(0.09, 0.12, 0.48), polymer, 0, 0, 0, g);
    part(tube(0.02, 0.022, 0.6), blued, 0, 0.02, -0.55, g, HALF);
    part(box(0.085, 0.085, 0.3), polymer, 0, 0, -0.38, g);
    part(box(0.07, 0.13, 0.32), polymer, 0, -0.04, 0.38, g, -0.1);
    part(box(0.05, 0.13, 0.06), polymer, 0, -0.11, 0.14, g, 0.35);
    const mag = part(box(0.13, 0.12, 0.12), metal2, 0.04, -0.12, -0.05, g); // ammo box
    part(box(0.03, 0.04, 0.09), metal, 0, 0.08, -0.05, g);
    for (const s of [-1, 1]) part(tube(0.006, 0.006, 0.2), metal, s * 0.04, -0.12, -0.72, g, 0, 0, s * 0.35); // bipod
    hands(g, -0.36);
    return { g, muzzle: -0.86, mag, ads: new THREE.Vector3(0, -0.105, -0.26) };
  },
};

function machete() {
  const g = new THREE.Group();
  part(box(0.03, 0.12, 0.035), darkWood, 0, 0, 0, g);
  const blade = new THREE.Shape();
  blade.moveTo(-0.018, 0); blade.lineTo(0.022, 0); blade.lineTo(0.03, 0.42); blade.quadraticCurveTo(0.01, 0.5, -0.018, 0.46); blade.lineTo(-0.018, 0);
  const bm = new THREE.Mesh(new THREE.ExtrudeGeometry(blade, { depth: 0.004, bevelEnabled: false }), steel);
  bm.position.set(0, 0.06, -0.002);
  g.add(bm);
  part(box(0.07, 0.07, 0.1), glove, 0, -0.01, 0.02, g);
  part(tube(0.05, 0.06, 0.32, 8), sleeve, 0, -0.06, 0.2, g, 1.2);
  return g;
}

function singleMesh(scene) {
  let mesh = null;
  scene.updateMatrixWorld(true);
  scene.traverse(o => { if (o.isMesh && !mesh) mesh = o; });
  const geo = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
  return { geo, mat: mesh.material };
}

// Size of the cross-section at one end of the Z axis.
function endSlice(geo, atMax, frac = 0.035) {
  const p = geo.attributes.position, bb = geo.boundingBox, L = bb.max.z - bb.min.z;
  let y0 = Infinity, y1 = -Infinity, x0 = Infinity, x1 = -Infinity;
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i);
    if (atMax ? z < bb.max.z - L * frac : z > bb.min.z + L * frac) continue;
    const y = p.getY(i), x = p.getX(i);
    if (y < y0) y0 = y; if (y > y1) y1 = y; if (x < x0) x0 = x; if (x > x1) x1 = x;
  }
  return { area: (y1 - y0) * (x1 - x0), cy: (y0 + y1) / 2, cx: (x0 + x1) / 2, top: y1 };
}

// The magazine is whatever hangs well below the receiver ahead of the trigger: split it out
// so it can drop out on reloads.
function splitMagazine(geo) {
  const p = geo.attributes.position;
  let za = Infinity, zb = -Infinity;
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) < -0.1 && p.getZ(i) < -0.02) { const z = p.getZ(i); if (z < za) za = z; if (z > zb) zb = z; }
  }
  if (!(zb > za) || zb - za > 0.25) return null;
  za -= 0.012; zb += 0.012;
  const g = geo.index ? geo.toNonIndexed() : geo;
  const pos = g.attributes.position, n = pos.count / 3;
  const inMag = new Uint8Array(n);
  for (let t = 0; t < n; t++) {
    let cy = 0, cz = 0;
    for (let k = 0; k < 3; k++) { cy += pos.getY(t * 3 + k); cz += pos.getZ(t * 3 + k); }
    cy /= 3; cz /= 3;
    inMag[t] = cy < -0.042 && cz > za && cz < zb ? 1 : 0;
  }
  const pick = (want) => {
    const out = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(g.attributes)) {
      const sz = attr.itemSize, src = attr.array, arr = new src.constructor(src.length);
      let w = 0;
      for (let t = 0; t < n; t++) if (inMag[t] === want) { arr.set(src.subarray(t * 3 * sz, (t + 1) * 3 * sz), w); w += 3 * sz; }
      out.setAttribute(name, new THREE.BufferAttribute(arr.slice(0, w), sz, attr.normalized));
    }
    out.computeBoundingSphere();
    return out;
  };
  return { mag: pick(1), rest: pick(0) };
}

// Gloved forearm: hand end toward -Z, palm at the origin, forearm running back along +Z.
function prepArm(scene) {
  const { geo, mat } = singleMesh(scene);
  // the generated sleeves came out washed-out: push pale, unsaturated texels to olive drab
  mat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      {
        float mx = max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b));
        float mn = min(diffuseColor.r, min(diffuseColor.g, diffuseColor.b));
        float sat = (mx - mn) / max(mx, 1e-3);
        float k = (1.0 - smoothstep(0.3, 0.5, sat)) * smoothstep(0.12, 0.3, mx);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(dot(diffuseColor.rgb, vec3(0.33))) * vec3(0.46, 0.53, 0.32), k);
      }`);
  };
  mat.roughness = 1;
  mat.color.setScalar(0.85);
  geo.computeBoundingBox();
  if (endSlice(geo, true, 0.05).area < endSlice(geo, false, 0.05).area) geo.rotateY(Math.PI);
  geo.computeBoundingBox();
  const bb = geo.boundingBox, L = bb.max.z - bb.min.z;
  return { geo, mat, L, bb: bb.clone() };
}
// Bend the forearm down at the wrist (a one-bone skin, done once on the geometry).
function bentGeometry(arm, fit) {
  const key = fit.bend + '/' + fit.wrist;
  arm.bent ||= {};
  if (arm.bent[key]) return arm.bent[key];
  const g = arm.geo.clone(), bb = arm.bb, L = arm.L;
  const wz = bb.min.z + fit.wrist * L, yc = (bb.min.y + bb.max.y) / 2, blend = 0.07 * L;
  const p = g.attributes.position, n = g.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i);
    const w = THREE.MathUtils.smoothstep(z, wz - blend, wz + blend);
    if (w <= 0) continue;
    const a = fit.bend * w, c = Math.cos(a), sn = Math.sin(a);
    const y = p.getY(i) - yc, dz = z - wz;
    p.setY(i, yc + y * c - dz * sn); p.setZ(i, wz + y * sn + dz * c);
    if (n) { const ny = n.getY(i), nz = n.getZ(i); n.setY(i, ny * c - nz * sn); n.setZ(i, ny * sn + nz * c); }
  }
  g.computeBoundingSphere();
  return (arm.bent[key] = g);
}

function placeArm(arm, fit, at) {
  const s = fit.len / arm.L, bb = arm.bb;
  const inner = new THREE.Mesh(fit.bend ? bentGeometry(arm, fit) : arm.geo, arm.mat);
  inner.scale.setScalar(s);
  inner.position.set(-(bb.min.x + bb.max.x) / 2 * s, -(bb.min.y + bb.max.y) / 2 * s, -(bb.min.z + fit.palm * arm.L) * s);
  const g = new THREE.Group();
  g.add(inner);
  if (fit.mirror) inner.scale.x *= -1, inner.position.x *= -1;
  const z = new THREE.Vector3(...fit.arm).normalize();
  const y = new THREE.Vector3(...fit.up);
  y.addScaledVector(z, -y.dot(z)).normalize();
  const x = new THREE.Vector3().crossVectors(y, z);
  g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  g.position.set(...at);
  g.userData.fit = fit;
  return g;
}

function tuneGunMaterial(m) {
  m.envMapIntensity = 1.0;
  if (m.normalScale) m.normalScale.set(1.2, 1.2);
}

export class Weapon {
  constructor(camera, vmScene, sunDir = new THREE.Vector3(0.4, 0.8, 0.3)) {
    this.camera = camera;
    // the arms/gun are drawn with their own, narrower lens (like CoD's viewmodel FOV)
    this.vmCamera = new THREE.PerspectiveCamera(52, camera.aspect, 0.01, 20);
    this.holder = new THREE.Group();     // copies the camera transform every frame
    vmScene.add(this.holder);
    this.root = new THREE.Group();       // hip / aim position in front of the eye
    this.pivot = new THREE.Group();      // sway / recoil / reload / switch offsets
    this.root.add(this.pivot);
    this.holder.add(this.root);
    // the viewmodel's own lighting, dimmed indoors and in shade by setLight()
    this.vmScene = vmScene;
    this.vmSun = new THREE.DirectionalLight(0xfff0dc, 3.0);
    this.vmSun.position.copy(sunDir).multiplyScalar(10);
    vmScene.add(this.vmSun, this.vmSun.target);
    this.vmFill = new THREE.HemisphereLight(0xcfe0ff, 0x5a4a38, 0.35);
    vmScene.add(this.vmFill);
    this.light = 1;

    // muzzle flash (moved to whichever gun is out)
    const flashMat = new THREE.MeshBasicMaterial({ map: T.flare(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: new THREE.Color(8, 6, 4) });
    this.flash = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.32), flashMat);
      p.rotation.set(i === 0 ? 0 : HALF, i === 2 ? HALF : 0, 0);
      this.flash.add(p);
    }
    const side = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.5), flashMat);
    side.rotation.x = HALF; side.position.z = -0.18;
    this.flash.add(side);
    this.flash.visible = false;
    // muzzle flash lights the world (camera child, main scene) and the gun/arms (viewmodel scene)
    this.flashLight = new THREE.PointLight(0xffaa55, 0, 9, 2);
    this.flashLight.position.set(0.1, -0.05, -0.9);
    camera.add(this.flashLight);
    this.vmFlash = new THREE.PointLight(0xffaa55, 0, 3, 2);
    this.vmFlash.position.set(0, 0.05, -0.6);
    this.root.add(this.vmFlash);

    this.guns = {};
    for (const [id, build] of Object.entries(BUILDERS)) {
      const b = build();
      b.g.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
      b.g.visible = false;
      b.muzzleObj = new THREE.Object3D(); b.muzzleObj.position.set(0, 0.015, b.muzzle); b.g.add(b.muzzleObj);
      b.eject = new THREE.Object3D(); b.eject.position.set(0.04, 0.03, -0.02); b.g.add(b.eject);
      b.magHome = b.mag.position.clone();
      this.pivot.add(b.g);
      this.guns[id] = b;
    }
    this.blade = machete();
    this.blade.visible = false;
    this.root.add(this.blade);
    this.nade = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), new THREE.MeshStandardMaterial({ color: 0x3a4a2a, roughness: 0.6 }));
    this.nade.visible = false;
    this.root.add(this.nade);

    this.hip = new THREE.Vector3(0.17, -0.17, -0.38);
    for (const b of Object.values(this.guns)) b.hip = this.hip;
    this.root.position.copy(this.hip);
    this.recoil = 0; this.recoilYaw = 0;
    this.sway = new THREE.Vector2();
    this.bob = 0; this.flashT = 0;
    this.reloadT = 0; this.reloadDur = 1;
    this.aim = 0;
    this.switchT = 0; this.meleeT = 0; this.throwT = 0;
    this.setGun('rifle', true);
  }

  setGun(id, instant = false) {
    if (!this.guns[id]) return;
    if (this.current) this.current.g.visible = false;
    this.current = this.guns[id];
    this.current.g.visible = true;
    this.current.g.add(this.flash);
    this.flash.position.copy(this.current.muzzleObj.position);
    this.id = id;
    if (!instant) this.switchT = 0.45;
  }
  get scoped() { return !!this.current.scope; }

  kick(strength = 1) {
    this.recoil = Math.min(1.6, this.recoil + 0.55 * strength);
    this.recoilYaw = (Math.random() - 0.5) * 0.6 * strength;
    this.flashT = 0.045;
    this.flash.rotation.z = Math.random() * Math.PI;
    this.flash.scale.setScalar((0.8 + Math.random() * 0.5) * (strength > 1.5 ? 1.5 : 1));
  }

  startReload(dur) { this.reloadT = dur; this.reloadDur = dur; }
  melee() { this.meleeT = 0.45; }
  throwNade() { this.throwT = 0.5; }

  update(dt, { aiming, moveSpeed, sprinting, lookDX, lookDY, time, grounded }) {
    this.aim += ((aiming ? 1 : 0) - this.aim) * Math.min(1, dt * 14);
    const a = this.aim;
    this.sway.x += (-lookDX * 0.0006 - this.sway.x) * Math.min(1, dt * 10);
    this.sway.y += (lookDY * 0.0006 - this.sway.y) * Math.min(1, dt * 10);
    this.sway.clampScalar(-0.04, 0.04);

    this.bob += dt * (sprinting ? 13 : 9) * Math.min(1, moveSpeed / 4);
    const bobAmt = (grounded ? Math.min(1, moveSpeed / 4) : 0) * (1 - a * 0.85) * (sprinting ? 1.8 : 1);
    const bx = Math.sin(this.bob) * 0.012 * bobAmt, by = -Math.abs(Math.cos(this.bob)) * 0.012 * bobAmt;
    const breathe = Math.sin(time * 1.6) * 0.003 * (1 - a * 0.7);

    this.recoil = Math.max(0, this.recoil - dt * 9 * (0.5 + this.recoil));
    this.recoilYaw *= Math.max(0, 1 - dt * 12);

    this.holder.position.copy(this.camera.position);
    this.holder.quaternion.copy(this.camera.quaternion);
    this.vmCamera.position.copy(this.camera.position);
    this.vmCamera.quaternion.copy(this.camera.quaternion);
    if (this.vmCamera.aspect !== this.camera.aspect) { this.vmCamera.aspect = this.camera.aspect; this.vmCamera.updateProjectionMatrix(); }
    this.root.position.lerpVectors(this.current.hip, this.current.ads, a);
    this.root.position.x += bx + this.sway.x * (1 - a * 0.7);
    this.root.position.y += by + breathe + this.sway.y * (1 - a * 0.7);
    this.root.position.z += this.recoil * 0.06;

    const sp = sprinting && !aiming ? 1 : 0;
    this.sprintK = (this.sprintK || 0) + (sp - (this.sprintK || 0)) * Math.min(1, dt * 8);
    const sk = this.sprintK;

    // reload: dip, roll, mag/pump drops and returns
    let rx = 0, rz = 0, ry = 0;
    const g = this.current;
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      const k = 1 - Math.max(0, this.reloadT) / this.reloadDur;
      const env = Math.sin(Math.min(1, k) * Math.PI);
      rx = -env * 0.5; rz = env * 0.7;
      const magOut = k > 0.2 && k < 0.65 ? Math.sin(((k - 0.2) / 0.45) * Math.PI) : 0;
      if (this.id === 'shotgun') g.mag.position.set(g.magHome.x, g.magHome.y, g.magHome.z + magOut * 0.08);
      else g.mag.position.set(g.magHome.x, g.magHome.y - magOut * 0.25, g.magHome.z);
    } else g.mag.position.copy(g.magHome);

    // weapon switch: drop out of view and come back up
    if (this.switchT > 0) { this.switchT -= dt; const k = Math.sin(Math.max(0, this.switchT) / 0.45 * Math.PI); rx -= k * 0.9; }

    // machete swipe across the screen
    this.meleeT = Math.max(0, this.meleeT - dt);
    this.blade.visible = this.meleeT > 0;
    if (this.meleeT > 0) {
      const k = 1 - this.meleeT / 0.45;
      this.blade.position.set(0.25 - k * 0.55, -0.05 + Math.sin(k * Math.PI) * 0.12, -0.1 - Math.sin(k * Math.PI) * 0.15);
      this.blade.rotation.set(-0.6, 0.4, 1.2 - k * 2.6);
      rx -= 0.8;
    }
    // grenade: wind up and throw
    this.throwT = Math.max(0, this.throwT - dt);
    this.nade.visible = this.throwT > 0.25;
    if (this.throwT > 0) { const k = 1 - this.throwT / 0.5; this.nade.position.set(-0.05, -0.05 + k * 0.1, 0.05 - k * 0.3); rx -= 0.7; }

    this.pivot.rotation.set(this.recoil * 0.09 + rx - sk * 0.5, this.recoilYaw * 0.05 + sk * 0.6 + ry, rz + sk * 0.3);
    this.pivot.visible = !(this.aim > 0.9 && this.scoped); // scope view hides the gun

    this.flashT -= dt;
    this.flash.visible = this.flashT > 0;
    this.flashLight.intensity = this.flashT > 0 ? 30 : 0;
    this.vmFlash.intensity = this.flashT > 0 ? 6 : 0;
  }

  // 0 = deep shade/indoors .. 1 = full sun
  setLight(k) {
    this.light = k;
    this.vmSun.intensity = 2.3 * k * k;
    this.vmFill.intensity = 0.25 + 0.2 * k;
    this.vmScene.environmentIntensity = 0.3 + 0.45 * k;
  }

  // Swap the placeholder guns for the generated models (and add the gloved arms).
  async loadModels(base = '/assets/models/guns/') {
    const get = (n) => loader.loadAsync(base + n + '.glb').then(g => g.scene);
    const [handR, handL, ...guns] = await Promise.all([get('handR'), get('handL'), ...Object.keys(GUN_FIT).map(get)]);
    const armR = prepArm(handR), armL = prepArm(handL);
    Object.keys(GUN_FIT).forEach((id, i) => {
      try { this.fitGun(id, guns[i], armR, armL); } catch (e) { console.warn('gun model failed', id, e); }
    });
    this.setGun(this.id, true);
  }

  fitGun(id, scene, armR, armL) {
    const f = GUN_FIT[id], b = this.guns[id];
    const { geo, mat } = singleMesh(scene);
    // long axis is Z; the muzzle is the thinner end -> point it down -Z
    geo.computeBoundingBox();
    if ((endSlice(geo, true).area < endSlice(geo, false).area) !== !!f.flip) geo.rotateY(Math.PI);
    geo.computeBoundingBox();
    const L = geo.boundingBox.max.z - geo.boundingBox.min.z;
    geo.scale(f.len / L, f.len / L, f.len / L);
    geo.computeBoundingBox();
    const bb = geo.boundingBox, front = endSlice(geo, false);
    // origin: the trigger, on the bore line
    geo.translate(-(bb.min.x + bb.max.x) / 2, -front.cy, -(bb.max.z - f.grip * f.len));
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    tuneGunMaterial(mat);

    const model = new THREE.Group();
    let mag;
    if (f.splitMag) {
      const parts = splitMagazine(geo);
      if (parts) {
        model.add(new THREE.Mesh(parts.rest, mat));
        mag = new THREE.Mesh(parts.mag, mat);
        model.add(mag);
      }
    }
    if (!mag) { model.add(new THREE.Mesh(geo, mat)); mag = new THREE.Object3D(); model.add(mag); }

    // gloved arms
    const fore = f.fore != null ? -(f.fore - f.grip) * f.len : null;
    model.add(placeArm(armR, HAND_FIT.right, HAND_FIT.right.at));
    if (fore != null) model.add(placeArm(armL, HAND_FIT.left, [HAND_FIT.left.at[0], HAND_FIT.left.at[1], fore]));
    else model.add(placeArm(armL, { ...HAND_FIT.left, ...HAND_FIT.revolverLeft }, HAND_FIT.revolverLeft.at));
    model.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false; } });

    // replace the placeholder
    for (const c of [...b.g.children]) if (c !== b.muzzleObj && c !== b.eject && c !== this.flash) b.g.remove(c);
    b.g.add(model);
    b.mag = mag; b.magHome = mag.position.clone();
    b.muzzle = geo.boundingBox.min.z;
    b.muzzleObj.position.set(0, 0, b.muzzle);
    b.eject.position.set(0.03, 0.015, -0.06);
    // iron sights: line up the top of the front sight with the eye
    const sight = f.scope ? f.sight : Math.max(0.012, endSlice(geo, false, 0.06).top + 0.003);
    b.ads = new THREE.Vector3(0, -sight, f.adsZ);
    b.hip = new THREE.Vector3(...f.hip);
  }

  // the world point that appears where the viewmodel's muzzle/ejection port is drawn
  toWorld(obj, v) {
    obj.getWorldPosition(v);
    this.vmCamera.updateMatrixWorld();
    v.project(this.vmCamera);
    this.camera.updateMatrixWorld();
    return v.unproject(this.camera);
  }
  muzzleWorld(v) { return this.toWorld(this.current.muzzleObj, v); }
  ejectWorld(v) { return this.toWorld(this.current.eject, v); }
}
