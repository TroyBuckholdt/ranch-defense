// The Zombies machinery as you see it: the generator, five perk coolers, the mystery box
// (with its beam of light and the gun that spins up out of it), El Taller's press, and the
// electric fence across the south gate. Models come from tools/blender/make_machines.py;
// everything here follows the room's snapshot.
import * as THREE from 'three';
import { POWER, PERKS, PERK_MACHINES, BOX, PAP, TRAP, WEAPONS, heightAt } from '../../shared/world.js';
import { tr } from './i18n.js';

const SPIN = ['rifle', 'revolver', 'shotgun', 'hunting', 'lmg', 'coconut'];
const ease = (k) => k * k * (3 - 2 * k);

// (flipY false for textures going on the Blender models, which use glTF's texture orientation)
function canvasTex(w, h, draw, flipY = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.flipY = flipY;
  return t;
}
function wrap(g, text, x, y, maxW, lh) {
  const words = text.split(' '); let line = '';
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (g.measureText(t).width > maxW && line) { g.fillText(line, x, y); y += lh; line = w; } else line = t;
  }
  g.fillText(line, x, y);
  return y;
}

// The front of a perk cooler: the drink, its name, what it does, the price.
function perkFront(id) {
  const def = PERKS[id];
  return canvasTex(256, 384, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#111'); gr.addColorStop(0.5, def.color); gr.addColorStop(1, '#0a0a0a');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    // rows of bottles behind the glass
    for (let r = 0; r < 3; r++) for (let i = 0; i < 4; i++) {
      const x = 34 + i * 62, y = 30 + r * 70;
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x - 4, y + 44, 44, 6);
      g.fillStyle = def.color; g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(x + 14, y); g.lineTo(x + 22, y); g.lineTo(x + 22, y + 10); g.lineTo(x + 30, y + 18);
      g.lineTo(x + 30, y + 46); g.lineTo(x + 6, y + 46); g.lineTo(x + 6, y + 18); g.lineTo(x + 14, y + 10); g.closePath();
      g.fill(); g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.85)'; g.fillRect(x + 8, y + 26, 20, 9);
    }
    g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(0, 236, w, 148);
    g.textAlign = 'center'; g.fillStyle = '#fff';
    g.font = 'bold 34px Impact, Arial Narrow, sans-serif';
    const y = wrap(g, tr(def.name), w / 2, 276, w - 24, 34);
    g.font = '17px Arial, sans-serif'; g.fillStyle = '#e8e8e8';
    wrap(g, tr(def.desc), w / 2, y + 28, w - 30, 19);
    g.font = 'bold 30px Impact, Arial Narrow, sans-serif'; g.fillStyle = '#c8ff4d';
    g.fillText('$' + def.cost, w / 2, h - 14);
  }, false);
}
function perkSign(id) {
  const def = PERKS[id];
  return canvasTex(512, 200, (g, w, h) => {
    g.fillStyle = def.color; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(0, 0, w, h * 0.45);
    g.strokeStyle = '#fff'; g.lineWidth = 8; g.strokeRect(10, 10, w - 20, h - 20);
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = 'bold 76px Impact, Arial Narrow, sans-serif';
    g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = 8;
    g.fillText(tr(def.name), w / 2, h / 2 + 4, w - 50);
  }, false);
}
function beamTex() {
  return canvasTex(64, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, 'rgba(120,200,255,0)'); gr.addColorStop(0.75, 'rgba(150,215,255,0.5)'); gr.addColorStop(1, 'rgba(200,235,255,0.9)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    const s = g.createLinearGradient(0, 0, w, 0);
    s.addColorStop(0, 'rgba(0,0,0,1)'); s.addColorStop(0.5, 'rgba(0,0,0,0)'); s.addColorStop(1, 'rgba(0,0,0,1)');
    g.globalCompositeOperation = 'destination-out'; g.fillStyle = s; g.fillRect(0, 0, w, h);
  });
}
// a little stuffed toy cow: what the box gives you when it's about to move
function toyCow() {
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xf0ece4, roughness: 0.95 });
  const black = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.95 });
  const pink = new THREE.MeshStandardMaterial({ color: 0xe8a0a0, roughness: 0.9 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), white); body.scale.set(1, 0.8, 1.35); g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 10), white); head.position.set(0, 0.1, 0.27); g.add(head);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 8), pink); nose.scale.set(1.2, 0.8, 0.8); nose.position.set(0, 0.06, 0.38); g.add(nose);
  for (const [x, z, r] of [[0.1, 0.05, 0.08], [-0.12, -0.1, 0.07], [0.05, -0.18, 0.06]]) { const s = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), black); s.position.set(x, 0.12, z); s.scale.y = 0.4; g.add(s); }
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.045, 0.16, 8), white); l.position.set(sx * 0.11, -0.17, sz * 0.15); g.add(l); }
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), black); ear.scale.set(1.6, 0.5, 1); ear.position.set(sx * 0.13, 0.18, 0.25); g.add(ear);
  }
  return g;
}

export class Machines {
  constructor(scene, model, weapon) {
    this.scene = scene; this.weapon = weapon;
    const part = (name) => {
      const o = model.getObjectByName(name);
      if (!o) return new THREE.Group();
      const c = o.clone(true);
      c.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; m.material = m.material.clone(); } });
      return c;
    };
    const place = (m, g) => {
      g.position.set(m.x, Math.max(0, heightAt(m.x, m.z)), m.z);
      g.rotation.y = Math.atan2(m.nx, m.nz);
      scene.add(g);
      return g;
    };
    const glowing = []; // materials that light up when the power comes on
    this.glowing = glowing;

    // generator
    this.gen = place(POWER, new THREE.Group());
    this.gen.add(part('GenBase'));
    this.genLever = part('GenLever'); this.gen.add(this.genLever);
    this.genExhaust = new THREE.Vector3(-0.5, 1.65, 0.25);

    // perk coolers
    this.perks = PERK_MACHINES.map(m => {
      const g = place(m, new THREE.Group());
      const body = part('PerkBody'), front = part('PerkFront'), sign = part('PerkSign');
      body.traverse(o => { if (o.isMesh && o.material.name === 'PerkPaint') o.material.color.set(PERKS[m.perk].color).multiplyScalar(0.85); });
      const ft = perkFront(m.perk), st = perkSign(m.perk);
      front.traverse(o => { if (o.isMesh && o.material.name === 'PerkPanel') { o.material.map = ft; o.material.emissive = new THREE.Color(1, 1, 1); o.material.emissiveMap = ft; o.material.emissiveIntensity = 0.04; glowing.push([o.material, 0.04, 0.55]); } });
      sign.traverse(o => { if (o.isMesh && o.material.name === 'PerkSignFace') { o.material.map = st; o.material.emissive = new THREE.Color(1, 1, 1); o.material.emissiveMap = st; o.material.emissiveIntensity = 0.02; glowing.push([o.material, 0.02, 1.6]); } });
      g.add(body, front, sign);
      return g;
    });

    // El Taller
    this.pap = place(PAP, new THREE.Group());
    const papBase = part('PapBase');
    papBase.traverse(o => { if (o.isMesh && o.material.name === 'PapPaint') { o.material.emissive = new THREE.Color(0x6a2cff); o.material.emissiveIntensity = 0; glowing.push([o.material, 0, 0.35]); } });
    this.pap.add(papBase);
    this.ram = part('PapRam'); this.ramY = this.ram.position.y; this.pap.add(this.ram);
    this.papGun = new THREE.Group(); this.papGun.position.set(0, 1.2, 0.1); // lying on the anvil this.pap.add(this.papGun);

    // mystery box
    this.box = new THREE.Group(); scene.add(this.box);
    this.boxInner = new THREE.Group(); this.box.add(this.boxInner);
    this.boxInner.add(part('BoxBase'));
    this.lid = part('BoxLid'); this.boxInner.add(this.lid);
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.75, 40, 20, 1, true).translate(0, 20, 0),
      new THREE.MeshBasicMaterial({ map: beamTex(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    this.beam.material.map.rotation = Math.PI; this.beam.material.map.center.set(0.5, 0.5);
    this.box.add(this.beam);
    this.prize = new THREE.Group(); this.prize.position.y = 0.75; this.box.add(this.prize);
    this.prizeId = null; this.spinT = 0;
    this.toy = toyCow();
    this.boxSpot = -1; this.boxLift = 0;

    // fence trap: the switch by the gate, wires across the gateway, and sparks when it's live
    const sw = place(TRAP, new THREE.Group());
    sw.add(part('TrapBox'));
    this.trapLever = part('GenLever'); this.trapLever.position.set(0, 1.28, -0.12); this.trapLever.scale.setScalar(0.7); sw.add(this.trapLever);
    const z = TRAP.zone, wireMat = new THREE.LineBasicMaterial({ color: 0x9aa0a6 });
    const wires = [];
    for (const h of [0.35, 0.8, 1.25]) wires.push(new THREE.Vector3(z.x - z.w / 2, h, z.z), new THREE.Vector3(z.x + z.w / 2, h, z.z));
    scene.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(wires), wireMat));
    this.arcGeo = new THREE.BufferGeometry();
    this.arcGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3 * 2 * 60), 3));
    this.arcs = new THREE.LineSegments(this.arcGeo, new THREE.LineBasicMaterial({ color: new THREE.Color(3, 4, 8), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.arcs.frustumCulled = false; this.arcs.visible = false;
    scene.add(this.arcs);

    this.powerK = 0;
  }

  // a copy of a gun for the world (the box prize, the gun on the press)
  gunModel(id) {
    if (id === 'teddy') return this.toy;
    const m = this.weapon.worldGun?.(id);
    if (m) { m.scale.multiplyScalar(1.15); return m; }
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: canvasTex(256, 64, (g, w, h) => { g.fillStyle = '#fff'; g.font = 'bold 34px Impact, sans-serif'; g.textAlign = 'center'; g.fillText(tr(WEAPONS[id]?.name || id), w / 2, 44); }), transparent: true }));
    s.scale.set(1.2, 0.3, 1);
    return s;
  }
  setPrize(id) {
    if (id === this.prizeId) return;
    this.prize.clear();
    this.prizeId = id;
    if (id) this.prize.add(this.gunModel(id));
  }

  // s: the latest room snapshot; fx: particles (for sparks and exhaust)
  update(s, dt, t, fx) {
    s = s || { pw: 0, bx: [0, 0, null, 0, 0], pp: [0, 0, 0, null], tr: [0, 0] }; // (the menu, before joining)
    const on = !!s.pw;
    this.powerK += ((on ? 1 : 0) - this.powerK) * Math.min(1, dt * 2.5);
    const flicker = this.powerK > 0.05 && this.powerK < 0.95 ? (Math.random() < 0.5 ? 0.3 : 1) : 1;
    for (const [m, off, lit] of this.glowing) m.emissiveIntensity = off + (lit - off) * this.powerK * flicker;
    this.genLever.rotation.x += ((on ? 1.1 : -0.6) - this.genLever.rotation.x) * Math.min(1, dt * 10);
    if (on) {
      this.gen.children[0].position.x = Math.sin(t * 60) * 0.003; // engine shudder
      if (Math.random() < dt * 2.5) { const p = this.genExhaust.clone().applyMatrix4(this.gen.matrixWorld); fx.puff(p, 0x3a3a38, 1.2, 1.8); }
    }

    // --- the box: [spot, state 0 idle 1 rolling 2 ready 3 moving, weapon, t, by]
    const [spot, st, weapon, bt] = s.bx || [0, 0, null, 0, 0];
    const sp = BOX.spots[spot];
    if (spot !== this.boxSpot) {
      this.boxSpot = spot;
      this.box.position.set(sp.x, Math.max(0, heightAt(sp.x, sp.z)), sp.z);
      this.box.rotation.y = Math.atan2(sp.nx, sp.nz);
      this.boxLift = 0;
    }
    const open = st === 1 || st === 2 ? 1 : 0;
    this.lid.rotation.x += ((open ? -1.25 : 0) - this.lid.rotation.x) * Math.min(1, dt * 7);
    const lift = st === 3 ? Math.min(1, (3.5 - bt) / 3) : 0;           // floats away when it moves
    this.boxLift += (lift - this.boxLift) * Math.min(1, dt * 4);
    this.boxInner.position.y = this.boxLift * 4;
    this.boxInner.rotation.y = this.boxLift * 6;
    this.boxInner.visible = this.boxLift < 0.97;
    this.beam.visible = st !== 3;
    this.beam.material.opacity = st === 0 ? 0.55 + Math.sin(t * 2) * 0.1 : 0.9;
    if (st === 1) {   // rolling: guns flick past, slowing down, rising out of the box
      const k = 1 - bt / BOX.roll;
      this.spinT -= dt;
      if (this.spinT <= 0) { this.spinT = 0.07 + k * k * 0.35; this.setPrize(SPIN[Math.floor(Math.random() * SPIN.length)]); }
      this.prize.position.y = 0.5 + ease(Math.min(1, k * 1.4)) * 0.55;
    } else if (st === 2) {
      this.setPrize(weapon);
      this.prize.position.y = 1.05 + Math.sin(t * 3) * 0.04;
    } else if (st === 3 && weapon === 'teddy' && bt > 2.6) {
      this.setPrize('teddy');
    } else this.setPrize(null);
    this.prize.rotation.y = st === 2 ? Math.sin(t * 1.5) * 0.5 + Math.PI / 2 : Math.PI / 2;

    // --- El Taller: [working, t, by, weapon]
    const [working, pt, , pw] = s.pp || [0, 0, 0, null];
    const pk = working ? 1 - pt / PAP.time : 0;
    const press = working ? Math.max(0, Math.sin(pk * Math.PI * 5)) ** 0.5 : 0;  // five heavy strokes
    this.ram.position.y = this.ramY - press * 0.75;
    if (working && press > 0.97 && !this.struck) { this.struck = true; this.onStrike?.(this.pap.position); const p = new THREE.Vector3(0, 1.15, -0.1).applyMatrix4(this.pap.matrixWorld); fx.spawn(18, p, { spread: 2.5, up: 1.5, speed: 4, life: 0.5, size: 0.02, color: 0xffb040, grav: 9, bounce: 0.3 }); }
    if (press < 0.8) this.struck = false;
    if (working && pw !== this.papGunId) { this.papGun.clear(); this.papGun.add(this.gunModel(pw)); this.papGun.rotation.y = Math.PI / 2; }
    if (!working && this.papGunId) this.papGun.clear();
    this.papGunId = working ? pw : null;

    // --- the fence: [seconds left on, cooldown]
    const live = (s.tr?.[0] || 0) > 0;
    this.trapLever.rotation.x += ((live ? 1.1 : -0.6) - this.trapLever.rotation.x) * Math.min(1, dt * 10);
    this.arcs.visible = live;
    if (live) {   // jagged arcs between the wires, redrawn every frame
      const a = this.arcGeo.attributes.position.array, z = TRAP.zone;
      let i = 0;
      for (let n = 0; n < 10; n++) {
        let x = z.x + (Math.random() - 0.5) * z.w, y = [0.35, 0.8][Math.floor(Math.random() * 2)], zz = z.z;
        for (let k = 0; k < 6; k++) {
          const nx = x + (Math.random() - 0.5) * 0.4, ny = y + 0.075 + (Math.random() - 0.3) * 0.1, nz = zz + (Math.random() - 0.5) * 0.25;
          a[i++] = x; a[i++] = y; a[i++] = zz; a[i++] = nx; a[i++] = ny; a[i++] = nz;
          x = nx; y = ny; zz = nz;
        }
      }
      this.arcGeo.attributes.position.needsUpdate = true;
      this.arcs.material.opacity = 0.6 + Math.random() * 0.4;
    }
  }
}
