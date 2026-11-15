import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import {
  ENTRIES, MAX_BOARDS, COW_TYPE_LIST, WEAPON, REPAIR_RANGE, raySolids, raySphere, cowHitSpheres, insideHouse, heightAt,
} from '../../shared/world.js';
import { buildWorld } from './world.js';
import { CowView, loadCowAsset } from './cow.js';
import { DogView, loadDogAssets } from './dog.js';
import { Avatar } from './avatar.js';
import { Weapon } from './weapon.js';
import { FX } from './fx.js';
import { Audio } from './audio.js';
import { Net } from './net.js';
import { LocalPlayer } from './player.js';
import { setAnisotropy } from './textures.js';

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- quality
const PRESETS = {
  high: { pr: 1.5, shadows: 4096, msaa: 4, bloom: true, ao: true, grass: 30000 },
  medium: { pr: 1, shadows: 2048, msaa: 2, bloom: true, ao: false, grass: 14000 },
  low: { pr: 0.75, shadows: 0, msaa: 0, bloom: false, ao: false, grass: 4000 },
};
let qName = new URLSearchParams(location.search).get('q');
try { qName = qName || localStorage.getItem('rd-quality'); } catch {}
if (!PRESETS[qName]) qName = (navigator.hardwareConcurrency || 4) >= 8 ? 'high' : 'medium';
const Q = PRESETS[qName];
$('quality').value = qName;
$('quality').onchange = (e) => {
  try { localStorage.setItem('rd-quality', e.target.value); } catch {}
  const u = new URL(location.href); u.searchParams.set('q', e.target.value); location.href = u.toString();
};

// ---------------------------------------------------------------- renderer
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, Q.pr));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.shadowMap.enabled = Q.shadows > 0;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
$('game').appendChild(renderer.domElement);
setAnisotropy(Math.min(8, renderer.capabilities.getMaxAnisotropy()));

$('play').disabled = true;
$('menu-status').textContent = 'Waking the herd...';
await Promise.all([loadCowAsset(), loadDogAssets()]);
const world = await buildWorld(renderer, Q, (msg) => { $('menu-status').textContent = msg; });
$('menu-status').textContent = '';
$('play').disabled = false;
const scene = world.scene;
const camera = new THREE.PerspectiveCamera(74, innerWidth / innerHeight, 0.03, 1500);
scene.add(camera);

// flashlight (kept in the scene always; toggled by intensity to avoid shader recompiles)
const flashlight = new THREE.SpotLight(0xfff1dc, 0, 40, 0.42, 0.45, 1.4);
flashlight.position.set(0.2, -0.15, 0);
camera.add(flashlight);
flashlight.target.position.set(0, -0.1, -5);
camera.add(flashlight.target);
let flashlightOn = false;

// post-processing: MSAA render target -> bloom -> tone map -> film grade
const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: Q.msaa });
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
if (Q.ao) {
  const ao = new GTAOPass(scene, camera, innerWidth, innerHeight);
  ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.2, scale: 1.0 });
  ao.blendIntensity = 0.85;
  composer.addPass(ao);
}
// only very bright things bloom: the sun, muzzle flashes, glowing zombie eyes
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.4, 0.35, 3.0);
if (Q.bloom) composer.addPass(bloom);
composer.addPass(new OutputPass());
const grade = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uHurt: { value: 0 }, uDown: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime, uHurt, uDown; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.299,0.587,0.114));
      c.rgb = (c.rgb - 0.5) * 1.04 + 0.5;
      c.rgb = mix(c.rgb, vec3(l) * vec3(1.0, 0.55, 0.5), uDown * 0.75);
      vec2 d = vUv - 0.5;
      float v = smoothstep(1.0, 0.35, length(d) * 1.2);
      c.rgb *= mix(0.72 - uDown * 0.4, 1.0, v);
      c.rgb = mix(c.rgb, vec3(0.5, 0.0, 0.0), uHurt * (1.0 - v) * 0.8);
      float n = fract(sin(dot(vUv * vec2(12.9898, 78.233) + fract(uTime), vec2(1.0))) * 43758.5453);
      c.rgb += (n - 0.5) * 0.025;
      gl_FragColor = c;
    }`,
});
composer.addPass(grade);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});

// ---------------------------------------------------------------- game state
const audio = new Audio();
const fx = new FX(scene);
const weapon = new Weapon(camera);
const me = new LocalPlayer();
const net = new Net(onEvent);
const cowViews = new Map();
const avatars = new Map();
const dogViews = new Map();
const flyingPlanks = [];
let view = null;            // latest interpolated world
let mySnap = null;          // my own state from the server
let playing = false;
let mag = WEAPON.mag;
let reloadT = 0;
let nextFire = 0;
let mouseDown = false, aiming = false;
let lookDX = 0, lookDY = 0;
let hurtT = 0, shake = 0;
let boardsShown = ENTRIES.map(() => MAX_BOARDS);
let lastStateSend = 0;
let mooTimer = 2, heartbeatT = 0;
const keys = {};
const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3();

// ---------------------------------------------------------------- menu
const nameInput = $('name'), roomInput = $('room');
try { nameInput.value = localStorage.getItem('rd-name') || ''; } catch {}
const urlRoom = new URLSearchParams(location.search).get('room');
if (urlRoom) roomInput.value = urlRoom;
if (matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches) $('touch-note').classList.remove('hidden');

$('play').onclick = async () => {
  const name = nameInput.value.trim() || 'Rancher';
  const room = roomInput.value.trim() || 'ranch';
  try { localStorage.setItem('rd-name', name); } catch {}
  $('play').disabled = true;
  $('menu-status').textContent = 'Connecting...';
  audio.start();
  try {
    await net.connect(name, room);
    history.replaceState(null, '', `?room=${encodeURIComponent(net.room)}`); // shareable invite link
    $('menu').classList.add('hidden');
    $('hud').classList.remove('hidden');
    playing = true;
    lockPointer();
  } catch (e) {
    $('menu-status').textContent = e.message;
    $('play').disabled = false;
  }
};
[nameInput, roomInput].forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') $('play').click(); }));

// ---------------------------------------------------------------- input
function lockPointer() { renderer.domElement.requestPointerLock?.(); }
const locked = () => document.pointerLockElement === renderer.domElement;
document.addEventListener('pointerlockchange', () => {
  $('click-to-play').classList.toggle('hidden', locked());
  if (!locked()) { mouseDown = false; aiming = false; for (const k in keys) keys[k] = false; }
});
renderer.domElement.addEventListener('mousedown', (e) => {
  if (!playing) return;
  if (!locked()) { lockPointer(); return; }
  if (e.button === 0) mouseDown = true;
  if (e.button === 2) aiming = true;
});
addEventListener('mouseup', (e) => { if (e.button === 0) mouseDown = false; if (e.button === 2) aiming = false; });
addEventListener('contextmenu', (e) => e.preventDefault());
let lockedAt = 0;
document.addEventListener('pointerlockchange', () => { lockedAt = performance.now(); });
addEventListener('mousemove', (e) => {
  if (!locked()) return;
  // Chrome sometimes reports one huge jump right after locking the pointer; ignore spikes
  if (performance.now() - lockedAt < 150 || Math.abs(e.movementX) > 250 || Math.abs(e.movementY) > 250) return;
  lookDX += e.movementX; lookDY += e.movementY;
});
addEventListener('keydown', (e) => {
  if (!playing) return;
  if (e.code === 'Tab') { e.preventDefault(); $('scoreboard').classList.add('show'); renderScoreboard(); }
  if (!locked()) return;
  keys[e.code] = true;
  if (e.code === 'KeyR') startReload();
  if (e.code === 'KeyF') { flashlightOn = !flashlightOn; audio.click(); }
});
addEventListener('keyup', (e) => {
  keys[e.code] = false;
  if (e.code === 'Tab') $('scoreboard').classList.remove('show');
});

// ---------------------------------------------------------------- weapon
function startReload() {
  if (reloadT > 0 || mag === WEAPON.mag || !alive()) return;
  reloadT = WEAPON.reload;
  weapon.startReload(WEAPON.reload);
  audio.reload();
}

const alive = () => mySnap && !mySnap.dn && !mySnap.dd;

function fire(time) {
  nextFire = time + WEAPON.fireInterval;
  mag -= 1;
  const moving = Math.min(1, me.speed / 4);
  const spread = aiming ? 0.003 + moving * 0.006 : 0.03 + moving * 0.03 + (me.grounded ? 0 : 0.04);
  const dir = new THREE.Vector3((Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread, -1).normalize()
    .applyQuaternion(camera.quaternion);
  const o = camera.getWorldPosition(new THREE.Vector3());
  net.send({ t: 'shoot', o: [o.x, o.y, o.z], d: [dir.x, dir.y, dir.z] });

  // predict the hit locally for instant feedback (server decides damage)
  const oa = [o.x, o.y, o.z], da = [dir.x, dir.y, dir.z];
  let dist = raySolids(oa, da, WEAPON.range), hitCow = null;
  if (view) for (const [id, c] of view.cows) {
    if (c[3] === 2) continue;
    for (const s of cowHitSpheres(COW_TYPE_LIST[c[5]], c[0], c[1], c[2], c[4] + heightAt(c[0], c[1]))) {
      const t = raySphere(oa, da, s.x, s.y, s.z, s.r);
      if (t >= 0 && t < dist) { dist = t; hitCow = id; }
    }
  }
  const hit = o.clone().addScaledVector(dir, dist);
  if (hitCow != null) {
    fx.blood(hit, dir);
    cowViews.get(hitCow)?.hit();
  } else if (dist < WEAPON.range - 1) {
    fx.dust(hit, dir.clone().negate());
  }
  if (Math.random() < 0.6) fx.tracer(weapon.muzzleWorld(tmpV), hit);
  fx.casing(weapon.ejectWorld(tmpV2), new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion));

  weapon.kick();
  const kick = aiming ? 0.006 : 0.011;
  me.recoil = Math.min(0.12, me.recoil + kick);   // recovers on its own
  me.pitch += kick * 0.25;                          // a little stays, so long bursts climb
  me.yaw += (Math.random() - 0.5) * kick * 0.8;
  shake = Math.min(1, shake + 0.12);
  audio.gunshot(null, insideHouse(me.pos.x, me.pos.z));
  if (mag <= 0) startReload();
}

// ---------------------------------------------------------------- server events
function onEvent(m) {
  switch (m.t) {
    case 'hit': {
      const p = new THREE.Vector3(...m.p), d = new THREE.Vector3(...m.d);
      if (m.by === net.id) {
        showHitmarker(m.kill);
        audio.hitmarker(m.kill);
        if (m.kill) fx.blood(p, d, true);
      } else {
        fx.blood(p, d, m.kill);
        cowViews.get(m.cow)?.hit();
      }
      audio.impact(m.p, m.head);
      break;
    }
    case 'fx': {
      const av = avatars.get(m.id);
      const from = av ? av.muzzleWorld(new THREE.Vector3()) : new THREE.Vector3(...m.o);
      fx.muzzleFlash(from);
      const dist = raySolids(m.o, m.d, WEAPON.range);
      fx.tracer(from, new THREE.Vector3(...m.o).addScaledVector(new THREE.Vector3(...m.d), dist));
      audio.gunshot(m.o, insideHouse(m.o[0], m.o[2]));
      break;
    }
    case 'board': {
      const e = ENTRIES[m.e];
      const pos = [e.x, 1.6, e.z];
      if (m.add < 0) {
        audio.boardTear(pos);
        for (let i = 0; i < -m.add; i++) launchPlank(m.e, m.n + i);
      } else {
        audio.hammer(pos);
      }
      break;
    }
    case 'dogbite': {
      const p = new THREE.Vector3(...m.p);
      fx.blood(p, new THREE.Vector3(0, 0.3, 0));
      cowViews.get(m.cow)?.hit();
      audio.bark(m.p, dogViews.get(m.dog)?.kind === 1, true);
      break;
    }
    case 'bark': {
      const d = view?.dogs?.get(m.dog);
      if (d) audio.bark([d[0], 0.6, d[1]], d[4] === 1);
      break;
    }
    case 'dogyelp': {
      const d = view?.dogs?.get(m.dog);
      if (d) audio.yelp([d[0], 0.6, d[1]], d[4] === 1);
      break;
    }
    case 'hurt':
      hurtT = 1; shake = 1;
      audio.hurt();
      break;
    case 'wave':
      banner(`WAVE ${m.wave}`, `${m.count} zombie cows are coming for the house`);
      audio.stinger(false);
      break;
    case 'waveclear':
      banner(`WAVE ${m.wave} SURVIVED`, 'Fix the barricades. Hold E at a window.');
      audio.stinger(true);
      mag = WEAPON.mag;
      break;
    case 'gameover':
      banner('THE HERD GOT IN', `You held the ranch for ${m.wave - 1} wave${m.wave === 2 ? '' : 's'}. Restarting...`, 8000);
      audio.stinger(false);
      break;
    case 'restart':
      fx.clearPools();
      mag = WEAPON.mag;
      break;
    case 'chat':
      feed(m.msg);
      break;
    case 'disconnected':
      feed('Lost connection to the server. Refresh to rejoin.');
      break;
  }
}

function launchPlank(entryId, idx) {
  const plank = world.boards[entryId][idx];
  if (!plank) return;
  const e = ENTRIES[entryId];
  const clone = plank.clone();
  clone.material = plank.material;
  scene.add(clone);
  plank.getWorldPosition(clone.position);
  flyingPlanks.push({
    m: clone, age: 0,
    v: new THREE.Vector3(e.nx * (3 + Math.random() * 2), 2 + Math.random() * 2, e.nz * (3 + Math.random() * 2)),
    spin: new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8),
  });
  fx.splinters(clone.position.clone(), new THREE.Vector3(-e.nx, 0.3, -e.nz));
}

// ---------------------------------------------------------------- HUD
let bannerTimer = null;
function banner(title, sub, ms = 3500) {
  const b = $('wave-banner');
  b.innerHTML = `${title}<small>${sub}</small>`;
  b.classList.add('show');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => b.classList.remove('show'), ms);
}

function feed(msg) {
  const d = document.createElement('div');
  d.textContent = msg;
  $('feed').appendChild(d);
  setTimeout(() => d.remove(), 6000);
}

let hmTimer = null;
function showHitmarker(kill) {
  const h = $('hitmarker');
  h.classList.toggle('kill', !!kill);
  h.classList.add('show');
  clearTimeout(hmTimer);
  hmTimer = setTimeout(() => h.classList.remove('show'), 60);
}

function renderScoreboard() {
  const s = net.latest;
  if (!s) return;
  const rows = [...s.players].sort((a, b) => b.s - a.s).map(p =>
    `<tr class="${p.id === net.id ? 'me' : ''}"><td>${escapeHtml(p.n)}${p.dn ? ' (down)' : p.dd ? ' (out)' : ''}</td><td>${p.k}</td><td>${p.s}</td></tr>`).join('');
  $('scoreboard').innerHTML = `<div style="margin-bottom:8px;opacity:.7">Room <b>${escapeHtml(net.room)}</b> · invite link: ${escapeHtml(location.href)}</div>
    <table><tr><th>Player</th><th>Kills</th><th>Score</th></tr>${rows}</table>`;
}
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function updateHud(dt) {
  const s = net.latest;
  if (!s || !mySnap) return;
  $('wave-num').textContent = s.wave;
  $('wave-sub').textContent = s.phase === 'intermission' ? `Next wave in ${s.timer}s`
    : s.phase === 'wave' ? `${s.left} cow${s.left === 1 ? '' : 's'} left` : 'Game over';
  $('hp-fill').style.width = `${mySnap.hp}%`;
  $('hp-fill').classList.toggle('low', mySnap.hp < 35);
  $('score').textContent = mySnap.s;
  $('ammo-mag').textContent = reloadT > 0 ? '--' : mag;
  $('ammo-mag').classList.toggle('low', mag <= 8);
  $('reload-hint').textContent = reloadT > 0 ? 'RELOADING' : mag <= 8 ? 'R  RELOAD' : '';
  const spread = aiming ? 2 : 6 + Math.min(1, me.speed / 4) * 10 + weapon.recoil * 10;
  $('crosshair').style.setProperty('--spread', `${spread}px`);
  $('crosshair').style.opacity = aiming ? 0 : 1;
  $('damage').style.opacity = Math.max(hurtT, mySnap.hp < 35 ? 0.35 + Math.sin(performance.now() / 300) * 0.1 : 0);
  if ($('scoreboard').classList.contains('show')) renderScoreboard();

  // downed / dead overlays
  const ov = $('downed-overlay');
  if (mySnap.dn) {
    ov.classList.add('show');
    ov.querySelector('.big').textContent = "YOU'RE DOWN";
    $('downed-sub').textContent = mySnap.rv > 0 ? `Being revived... ${mySnap.rv}%` : `Bleeding out in ${mySnap.bl}s. A teammate can hold E next to you to revive.`;
  } else if (mySnap.dd && s.phase !== 'gameover') {
    ov.classList.add('show');
    ov.querySelector('.big').textContent = 'SPECTATING';
    $('downed-sub').textContent = 'You come back when this wave is cleared.';
  } else ov.classList.remove('show');

  // context prompt: revive > repair
  let prompt = '';
  if (alive() && view) {
    for (const [id, p] of view.players) {
      if (id !== net.id && p.dn && Math.hypot(p.x - me.pos.x, p.z - me.pos.z) < 2.6) {
        prompt = p.rv > 0 ? `Reviving ${escapeHtml(p.n)}... ${p.rv}%` : `Hold <kbd>E</kbd> to revive ${escapeHtml(p.n)}`;
        break;
      }
    }
    if (!prompt) {
      const e = nearestRepairable();
      if (e) prompt = mySnap.rp > 0 ? `Rebuilding... ${'▮'.repeat(s.boards[e.id])}${'▯'.repeat(MAX_BOARDS - s.boards[e.id])}` : `Hold <kbd>E</kbd> to rebuild barricade`;
    }
  }
  $('revive-prompt').innerHTML = prompt;
}

function nearestRepairable() {
  const s = net.latest;
  let best = null, bd = REPAIR_RANGE;
  for (const e of ENTRIES) {
    if (s.boards[e.id] >= MAX_BOARDS) continue;
    const d = Math.hypot(me.pos.x - (e.x - e.nx * 0.8), me.pos.z - (e.z - e.nz * 0.8));
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

// ---------------------------------------------------------------- frame loop
const clock = new THREE.Timer();
let elapsed = 0;

function frame() {
  requestAnimationFrame(frame);
  clock.update();
  const dt = Math.min(0.05, clock.getDelta());
  elapsed += dt;

  if (playing) {
    view = net.sample();
    mySnap = net.latest?.playerMap.get(net.id) || null;
    stepLocal(dt);
    syncCows(dt);
    syncAvatars(dt);
    syncDogs(dt);
    syncBoards();
    ambientSounds(dt);
    updateHud(dt);
  } else {
    // menu: slow orbit around the house (or a fixed shot, for screenshots)
    const a = elapsed * 0.05;
    const shot = window.__rdShot;
    if (shot) { camera.position.set(...shot.pos); camera.lookAt(...shot.look); }
    else { camera.position.set(Math.sin(a) * 34, 9, Math.cos(a) * 34); camera.lookAt(0, 2.5, 0); }
    weapon.root.visible = false;
  }

  for (let i = flyingPlanks.length - 1; i >= 0; i--) {
    const p = flyingPlanks[i];
    p.age += dt;
    p.v.y -= 9.8 * dt;
    p.m.position.addScaledVector(p.v, dt);
    if (p.m.position.y < 0.05) { p.m.position.y = 0.05; p.v.multiplyScalar(0.3); p.spin.multiplyScalar(0.2); }
    p.m.rotation.x += p.spin.x * dt; p.m.rotation.y += p.spin.y * dt; p.m.rotation.z += p.spin.z * dt;
    if (p.age > 6) { scene.remove(p.m); flyingPlanks.splice(i, 1); }
  }

  fx.update(dt);
  world.update(dt, elapsed, camera.position);
  hurtT = Math.max(0, hurtT - dt * 2.2);
  grade.uniforms.uTime.value = elapsed;
  grade.uniforms.uHurt.value = hurtT;
  grade.uniforms.uDown.value += (((mySnap?.dn || mySnap?.dd) ? 1 : 0) - grade.uniforms.uDown.value) * Math.min(1, dt * 3);
  flashlight.intensity = flashlightOn ? 60 : 0;
  composer.render(dt);
}

function stepLocal(dt) {
  const s = mySnap;
  if (!s) return;
  const downed = !!s.dn, dead = !!s.dd;

  // the server moved us (respawn / new wave): snap to it
  if (Math.hypot(s.x - me.pos.x, s.z - me.pos.z) > 4 && !dead) me.teleport(s.x, s.y, s.z);

  const sens = 0.0022 * (aiming ? 0.6 : 1);
  if (!dead) me.look(lookDX, lookDY, sens);
  me.update(dt, keys, { aiming, downed, canMove: locked() && !dead });

  // weapon + firing
  if (reloadT > 0) { reloadT -= dt; if (reloadT <= 0) mag = WEAPON.mag; }
  const canShoot = alive() && locked() && reloadT <= 0 && !me.sprinting;
  if (mouseDown && canShoot && elapsed >= nextFire && mag > 0) fire(elapsed);
  else if (mouseDown && canShoot && mag === 0) startReload();

  // camera
  if (dead && view) {
    // spectate the first teammate still standing
    const t = [...view.players.values()].find(p => p.id !== net.id && !p.dn && !p.dd);
    if (t) {
      camera.position.set(t.x, t.y + 1.62, t.z);
      camera.rotation.set(t.pitch, t.yaw, 0, 'YXZ');
    }
    weapon.root.visible = false;
  } else {
    shake = Math.max(0, shake - dt * 4);
    const bob = me.grounded ? Math.sin(weapon.bob) * 0.03 * Math.min(1, me.speed / 4) * (1 - weapon.aim * 0.8) : 0;
    camera.position.set(me.pos.x, me.pos.y + me.eye - me.landDip + Math.abs(bob), me.pos.z);
    camera.rotation.set(
      Math.min(1.5, me.pitch + me.recoil) + (Math.random() - 0.5) * shake * 0.01,
      me.yaw + (Math.random() - 0.5) * shake * 0.01,
      downed ? 0.35 : Math.sin(weapon.bob * 0.5) * 0.004 * me.speed,
      'YXZ');
    weapon.root.visible = !downed;
  }
  const targetFov = aiming && !downed ? 52 : me.sprinting ? 80 : 74;
  camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 12);
  camera.updateProjectionMatrix();

  weapon.update(dt, { aiming: aiming && !downed, moveSpeed: me.speed, sprinting: me.sprinting, lookDX, lookDY, time: elapsed, grounded: me.grounded });
  lookDX = lookDY = 0;

  audio.setListener(camera.position, tmpV.set(0, 0, -1).applyQuaternion(camera.quaternion));

  // low health heartbeat
  heartbeatT -= dt;
  if (alive() && s.hp < 35 && heartbeatT <= 0) { audio.heartbeat(); heartbeatT = 0.9; }

  // tell the server where we are
  if (elapsed - lastStateSend > 0.05 && !dead) {
    lastStateSend = elapsed;
    net.send({ t: 'state', p: [r2(me.pos.x), r2(me.pos.y), r2(me.pos.z)], yaw: r2(me.yaw), pitch: r2(me.pitch), use: !!keys.KeyE });
  }
}
const r2 = (v) => Math.round(v * 100) / 100;

function syncCows(dt) {
  if (!view) return;
  for (const [id, c] of view.cows) {
    let v = cowViews.get(id);
    if (!v) { v = new CowView(id, COW_TYPE_LIST[c[5]], scene); cowViews.set(id, v); }
    v.apply(c, dt, elapsed);
  }
  for (const [id, v] of cowViews) if (!view.cows.has(id)) { v.dispose(); cowViews.delete(id); }
}

function syncAvatars(dt) {
  if (!view) return;
  for (const [id, p] of view.players) {
    if (id === net.id) continue;
    let a = avatars.get(id);
    if (!a) { a = new Avatar(id, p.n, scene); avatars.set(id, a); }
    a.apply(p, dt);
  }
  for (const [id, a] of avatars) if (!view.players.has(id)) { a.dispose(); avatars.delete(id); }
}

function syncDogs(dt) {
  if (!view?.dogs) return;
  for (const [id, d] of view.dogs) {
    let v = dogViews.get(id);
    if (!v) { v = new DogView(id, d[4], scene); dogViews.set(id, v); }
    v.apply(d, dt, elapsed);
  }
}

function syncBoards() {
  const s = net.latest;
  if (!s) return;
  s.boards.forEach((n, i) => {
    if (n === boardsShown[i]) return;
    const list = world.boards[i];
    list.forEach((b, k) => {
      const show = k < n;
      if (show && !b.visible) { b.scale.set(1, 1, 1); } // freshly nailed back on
      b.visible = show;
    });
    boardsShown[i] = n;
  });
}

function ambientSounds(dt) {
  if (!view) return;
  mooTimer -= dt;
  if (mooTimer <= 0) {
    mooTimer = 0.7 + Math.random() * 1.6;
    const live = [...view.cows.entries()].filter(([, c]) => c[3] !== 2);
    if (live.length) {
      const [, c] = live[Math.floor(Math.random() * live.length)];
      audio.moo([c[0], 1.4, c[1]], COW_TYPE_LIST[c[5]]);
      // cows tearing at a window also bang on it
      if (c[3] === 3 && Math.random() < 0.6) audio.bang([c[0], 1.2, c[1]]);
    }
  }
}

frame();

// expose a little for automated testing / debugging
window.__rd = { net, me, scene, camera, cowViews, renderer, CowView, DogView, weapon };
