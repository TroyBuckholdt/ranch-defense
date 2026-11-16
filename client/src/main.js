import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { SunPass, ViewmodelPass } from './post.js';
import {
  ENTRIES, MAX_BOARDS, COW_TYPE_LIST, WEAPON, WEAPONS, START_WEAPONS, WALL_BUYS, BUY_RANGE, MELEE, REPAIR_RANGE, raySolids, raySphere, cowHitSpheres, insideHouse, heightAt, shoreZ, SAND_WIDTH,
} from '../../shared/world.js';
import { buildWorld } from './world.js';
import { CowView, loadCowAsset } from './cow.js';
import { DogView, loadDogAssets } from './dog.js';
import { Avatar, CHARACTERS, loadCharacter } from './avatar.js';
import { Weapon } from './weapon.js';
import { FX } from './fx.js';
import { Audio } from './audio.js';
import { Net } from './net.js';
import { LocalPlayer } from './player.js';
import { setAnisotropy } from './textures.js';
import * as T from './textures.js';
import { detectTouch, isPhone, TouchControls, getSensitivity, setSensitivity } from './touch.js';

const $ = (id) => document.getElementById(id);
const touchMode = detectTouch(); // phone / tablet: on-screen controls instead of pointer lock

// ---------------------------------------------------------------- quality
const PRESETS = {
  ultra: { pr: 2, shadows: 4096, msaa: 4, bloom: true, ao: true, rays: 64, grass: 60000 },
  high: { pr: 1.5, shadows: 4096, msaa: 4, bloom: true, ao: true, rays: 40, grass: 30000 },
  medium: { pr: 1, shadows: 2048, msaa: 2, bloom: true, ao: false, rays: 24, grass: 14000 },
  low: { pr: 0.75, shadows: 0, msaa: 0, bloom: false, ao: false, rays: 0, grass: 4000 },
};
let qName = new URLSearchParams(location.search).get('q');
try { qName = qName || localStorage.getItem('rd-quality'); } catch {}
if (!PRESETS[qName]) qName = touchMode ? (isPhone() ? 'low' : 'medium') : (navigator.hardwareConcurrency || 4) >= 8 ? 'high' : 'medium';
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
renderer.shadowMap.type = THREE.PCFShadowMap;
$('game').appendChild(renderer.domElement);
setAnisotropy(Math.min(8, renderer.capabilities.getMaxAnisotropy()));

$('play').disabled = true;
$('menu-status').textContent = 'Waking the herd...';
await Promise.all([loadCowAsset(renderer), loadDogAssets()]);
const world = await buildWorld(renderer, Q, (msg) => { $('menu-status').textContent = msg; });
$('menu-status').textContent = '';
$('play').disabled = false;
const scene = world.scene;
const camera = new THREE.PerspectiveCamera(74, innerWidth / innerHeight, 0.03, 1500);
scene.add(camera);
// compile the cow shader now, so the first wave doesn't hitch when the herd appears
{ const warm = new CowView(-1, 'walker', scene); renderer.compile(scene, camera); warm.dispose(); }

// flashlight (kept in the scene always; toggled by intensity to avoid shader recompiles)
const flashlight = new THREE.SpotLight(0xfff1dc, 0, 40, 0.42, 0.45, 1.4);
flashlight.position.set(0.2, -0.15, 0);
camera.add(flashlight);
flashlight.target.position.set(0, -0.1, -5);
camera.add(flashlight.target);
let flashlightOn = false;

// first-person arms + gun: their own scene, drawn over the world after AO / light shafts
const vmScene = new THREE.Scene();
vmScene.environment = scene.environment;

// post-processing: MSAA render target (with depth) -> sun shafts/flare -> AO -> viewmodel
// -> bloom -> tone map -> film grade (sharpen, fringing, grain, vignette)
const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: Q.msaa });
rt.depthTexture = new THREE.DepthTexture(innerWidth, innerHeight);
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
const sunPass = Q.rays ? new SunPass(Q.rays) : null;
if (sunPass) composer.addPass(sunPass);
let aoPass = null;
if (Q.ao) {
  const ao = aoPass = new GTAOPass(scene, camera, innerWidth, innerHeight);
  ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.2, scale: 1.0 });
  ao.blendIntensity = 0.85;
  // objects placed by custom vertex code (the travelling grass) can't go through AO's
  // override-material pass, so hide them while it renders its normals/depth
  const aoRender = ao.render.bind(ao);
  ao.render = (...args) => {
    const hidden = [];
    scene.traverse(o => { if (o.userData.noAO && o.visible) { o.visible = false; hidden.push(o); } });
    aoRender(...args);
    for (const o of hidden) o.visible = true;
  };
  composer.addPass(ao);
}
const vmPass = new ViewmodelPass(vmScene, camera);
composer.addPass(vmPass);
// only very bright things bloom: the sun, muzzle flashes, glowing zombie eyes
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.4, 0.35, 3.0);
if (Q.bloom) composer.addPass(bloom);
composer.addPass(new OutputPass());
const grade = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uHurt: { value: 0 }, uDown: { value: 0 }, uTexel: { value: new THREE.Vector2(1 / innerWidth, 1 / innerHeight) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime, uHurt, uDown; uniform vec2 uTexel; varying vec2 vUv;
    void main(){
      vec2 d0 = vUv - 0.5;
      // faint lens fringing toward the edges of the frame
      vec2 ca = d0 * dot(d0, d0) * 0.012;
      vec4 c = texture2D(tDiffuse, vUv);
      c.r = texture2D(tDiffuse, vUv + ca).r;
      c.b = texture2D(tDiffuse, vUv - ca).b;
      // contrast-adaptive sharpening: crisper texture detail without halos
      vec3 nb = texture2D(tDiffuse, vUv + vec2(uTexel.x, 0.0)).rgb + texture2D(tDiffuse, vUv - vec2(uTexel.x, 0.0)).rgb
              + texture2D(tDiffuse, vUv + vec2(0.0, uTexel.y)).rgb + texture2D(tDiffuse, vUv - vec2(0.0, uTexel.y)).rgb;
      vec3 detail = c.rgb - nb * 0.25;
      float amt = 0.45 * (1.0 - smoothstep(0.04, 0.25, length(detail)));
      c.rgb = clamp(c.rgb + detail * amt, 0.0, 1.0);
      float l = dot(c.rgb, vec3(0.299,0.587,0.114));
      c.rgb = (c.rgb - 0.5) * 1.04 + 0.5;
      // gentle split-tone: warm highlights, cool shadows
      c.rgb += mix(vec3(-0.012, -0.004, 0.014), vec3(0.016, 0.006, -0.012), smoothstep(0.2, 0.8, l));
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
  grade.uniforms.uTexel.value.set(1 / (innerWidth * renderer.getPixelRatio()), 1 / (innerHeight * renderer.getPixelRatio()));
});
grade.uniforms.uTexel.value.set(1 / (innerWidth * renderer.getPixelRatio()), 1 / (innerHeight * renderer.getPixelRatio()));

// ---------------------------------------------------------------- adaptive quality
// Keeps the frame rate smooth on weaker GPUs: when frames run long it steps down render
// resolution and the heaviest effects (AO, light shafts), and steps back up once frames
// are steady again, waiting longer each time a step up didn't hold.
const AQ_STEPS = [
  { s: 1 }, { s: 0.87 }, { s: 0.75 }, { s: 0.75, ao: false }, { s: 0.65, ao: false },
  { s: 0.65, ao: false, rays: false }, { s: 0.55, ao: false, rays: false },
];
const aq = { level: 0, avg: 1 / 60, cool: 3, steady: 0, upWait: 6, base: renderer.getPixelRatio(), off: new URLSearchParams(location.search).get('aq') === '0' };
function adaptQuality(raw) {
  if (aq.off || raw > 0.25) return; // tab was hidden or a hitch: ignore
  aq.avg += (raw - aq.avg) * 0.08;
  aq.cool -= raw;
  aq.steady = aq.avg < 1 / 55 ? aq.steady + raw : 0;
  let next = aq.level;
  if (aq.cool <= 0 && aq.avg > 1 / 48 && aq.level < AQ_STEPS.length - 1) next++;
  else if (aq.level > 0 && aq.steady > aq.upWait) { next--; aq.upWait = Math.min(120, aq.upWait * 2); }
  if (next === aq.level) return;
  aq.level = next; aq.cool = 1.5; aq.steady = 0;
  const st = AQ_STEPS[next], pr = aq.base * st.s;
  renderer.setPixelRatio(pr);
  composer.setPixelRatio(pr);
  if (aoPass) aoPass.enabled = st.ao !== false;
  if (sunPass) sunPass.enabled = st.rays !== false;
  grade.uniforms.uTexel.value.set(1 / (innerWidth * pr), 1 / (innerHeight * pr));
}

// ---------------------------------------------------------------- game state
const audio = new Audio();
const fx = new FX(scene);
const weapon = new Weapon(camera, vmScene, world.lightDir);
let vmLight = 1;
vmPass.camera = weapon.vmCamera;
weapon.loadModels().catch(e => console.warn('weapon models failed to load', e));
const me = new LocalPlayer();
const net = new Net(onEvent);
const cowViews = new Map();
const avatars = new Map();
const dogViews = new Map();
const pickupViews = new Map(); // power-ups on the ground
const nadeViews = new Map();
const flyingPlanks = [];
let view = null;            // latest interpolated world
let mySnap = null;          // my own state from the server
let playing = false;
// loadout: two weapon slots, ammo tracked per gun
const loadout = { weapons: [...START_WEAPONS], cur: 0, ammo: {} };
const curId = () => loadout.weapons[loadout.cur] || 'rifle';
const W = () => WEAPONS[curId()];
function ammo(id = curId()) {
  if (!loadout.ammo[id]) loadout.ammo[id] = { mag: WEAPONS[id].mag, res: WEAPONS[id].reserve };
  return loadout.ammo[id];
}
function refillAll() { for (const id of loadout.weapons) loadout.ammo[id] = { mag: WEAPONS[id].mag, res: WEAPONS[id].reserve }; }
let triggerHeld = false; // semi-auto guns need a fresh click per shot
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
let myChar = 'p1';
try { myChar = localStorage.getItem('rd-char') || 'p1'; } catch {}
if (!CHARACTERS.some(c => c.id === myChar)) myChar = 'p1'; // e.g. a removed duplicate
const picker = $('char-picker');
for (const c of CHARACTERS) {
  const b = document.createElement('button');
  b.type = 'button';
  b.innerHTML = `<img src="/assets/models/people/thumbs/${c.id}.jpg" alt=""><span>${c.label}</span>`;
  b.classList.toggle('sel', c.id === myChar);
  b.onclick = () => {
    myChar = c.id;
    try { localStorage.setItem('rd-char', c.id); } catch {}
    for (const el of picker.children) el.classList.toggle('sel', el === b);
  };
  picker.appendChild(b);
}
try { nameInput.value = localStorage.getItem('rd-name') || ''; } catch {}
const urlRoom = new URLSearchParams(location.search).get('room');
if (urlRoom) roomInput.value = urlRoom;
if (touchMode) {
  $('touch-menu').classList.remove('hidden');
  const sens = $('touch-sens');
  sens.value = getSensitivity();
  sens.oninput = () => { setSensitivity(sens.value); if (touch) touch.sens = +sens.value; };
}

$('play').onclick = async () => {
  const name = nameInput.value.trim() || 'Rancher';
  const room = roomInput.value.trim() || 'ranch';
  try { localStorage.setItem('rd-name', name); } catch {}
  $('play').disabled = true;
  $('menu-status').textContent = 'Connecting...';
  audio.start();
  if (touchMode) touch.goFullscreen(); // right in the tap: full screen isn't allowed after an await
  try {
    await net.connect(name, room, myChar);
    history.replaceState(null, '', `?room=${encodeURIComponent(net.room)}`); // shareable invite link
    $('menu').classList.add('hidden');
    $('hud').classList.remove('hidden');
    playing = true;
    if (touchMode) touch.show(true);
    else lockPointer();
  } catch (e) {
    $('menu-status').textContent = e.message;
    $('play').disabled = false;
  }
};
[nameInput, roomInput].forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') $('play').click(); }));

// ---------------------------------------------------------------- input
function lockPointer() { renderer.domElement.requestPointerLock?.(); }
const locked = () => document.pointerLockElement === renderer.domElement;
// gameplay input is live: pointer locked on desktop, or simply in a game on touch screens
const active = () => locked() || (touchMode && playing);
const KEY_USE = touchMode ? '<kbd>USE</kbd>' : '<kbd>E</kbd>';
const touch = touchMode ? new TouchControls({
  keys,
  fire(down) { mouseDown = down; if (!down) triggerHeld = false; },
  toggleAim() { aiming = !aiming; },
  reload: () => startReload(),
  grenade: () => throwGrenade(),
  melee: () => doMelee(),
  swap: () => switchTo(1 - loadout.cur),
  use(down) { keys.KeyE = down; if (down) tryBuy(); },
  look(dx, dy) { lookDX += dx; lookDY += dy; },
  flashlight() { flashlightOn = !flashlightOn; audio.click(); },
  scores(show) { $('scoreboard').classList.toggle('show', show); if (show) renderScoreboard(); },
}) : null;
document.addEventListener('pointerlockchange', () => {
  $('click-to-play').classList.toggle('hidden', locked() || touchMode);
  if (!locked()) { mouseDown = false; aiming = false; for (const k in keys) keys[k] = false; }
});
renderer.domElement.addEventListener('mousedown', (e) => {
  if (!playing) return;
  if (!locked()) { lockPointer(); return; }
  if (e.button === 0) mouseDown = true;
  if (e.button === 2) aiming = true;
});
addEventListener('mouseup', (e) => { if (e.button === 0) { mouseDown = false; triggerHeld = false; } if (e.button === 2) aiming = false; });
addEventListener('wheel', (e) => { if (locked() && Math.abs(e.deltaY) > 10) switchTo(1 - loadout.cur); });
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
  if (!active()) return;
  keys[e.code] = true;
  if (e.code === 'KeyR') startReload();
  if (e.code === 'Digit1') switchTo(0);
  if (e.code === 'Digit2') switchTo(1);
  if (e.code === 'KeyV') doMelee();
  if (e.code === 'KeyG') throwGrenade();
  if (e.code === 'KeyE') tryBuy();
  if (e.code === 'KeyF') { flashlightOn = !flashlightOn; audio.click(); }
});
addEventListener('keyup', (e) => {
  keys[e.code] = false;
  if (e.code === 'Tab') $('scoreboard').classList.remove('show');
});

// ---------------------------------------------------------------- weapon
function startReload() {
  const am = ammo(), w = W();
  if (reloadT > 0 || am.mag === w.mag || am.res <= 0 || !alive()) return;
  reloadT = w.reload;
  weapon.startReload(w.reload);
  audio.reload(curId());
}

function switchTo(slot) {
  if (!loadout.weapons[slot] || slot === loadout.cur || !alive()) return;
  loadout.cur = slot;
  reloadT = 0;
  weapon.setGun(curId());
  nextFire = Math.max(nextFire, elapsed + 0.45);
  net.send({ t: 'switch', slot });
  audio.click();
}

const alive = () => mySnap && !mySnap.dn && !mySnap.dd;

function fire(time) {
  const w = W(), am = ammo();
  nextFire = time + w.fireInterval;
  am.mag -= 1;
  if (!w.auto) triggerHeld = true;
  const moving = Math.min(1, me.speed / 4);
  const crouchK = me.crouching ? 0.6 : 1;
  const spread = (aiming ? w.ads + moving * 0.006 : w.hip + moving * 0.03 + (me.grounded ? 0 : 0.04)) * crouchK;
  const o = camera.getWorldPosition(new THREE.Vector3());
  const dirs = [];
  for (let i = 0; i < w.pellets; i++) {
    dirs.push(new THREE.Vector3((Math.random() - 0.5) * spread * 2, (Math.random() - 0.5) * spread * 2, -1).normalize().applyQuaternion(camera.quaternion));
  }
  const msg = { t: 'shoot', w: curId(), o: [o.x, o.y, o.z] };
  if (w.pellets > 1) msg.ds = dirs.map(d => [r3(d.x), r3(d.y), r3(d.z)]); else msg.d = [dirs[0].x, dirs[0].y, dirs[0].z];
  net.send(msg);

  // predict hits locally for instant feedback (the server decides damage)
  const oa = [o.x, o.y, o.z];
  dirs.forEach((dir, i) => {
    const da = [dir.x, dir.y, dir.z];
    let dist = raySolids(oa, da, w.range), hitCow = null;
    if (view) for (const [id, c] of view.cows) {
      if (c[3] === 2) continue;
      for (const sp of cowHitSpheres(COW_TYPE_LIST[c[5]], c[0], c[1], c[2], c[4] + heightAt(c[0], c[1]))) {
        const t = raySphere(oa, da, sp.x, sp.y, sp.z, sp.r);
        if (t >= 0 && t < dist) { dist = t; hitCow = id; }
      }
    }
    const hit = o.clone().addScaledVector(dir, dist);
    if (hitCow != null) { fx.blood(hit, dir); cowViews.get(hitCow)?.hit(da); }
    else if (dist < w.range - 1 && (i % 3 === 0)) fx.dust(hit, dir.clone().negate());
    if (i < 3 && Math.random() < 0.6) fx.tracer(weapon.muzzleWorld(tmpV), hit);
  });
  fx.casing(weapon.ejectWorld(tmpV2), new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion));

  const heavy = curId() === 'shotgun' || curId() === 'hunting' ? 2.2 : curId() === 'revolver' ? 1.5 : 1;
  weapon.kick(heavy);
  const kick = (aiming ? 0.006 : 0.011) * heavy * crouchK;
  me.recoil = Math.min(0.2, me.recoil + kick);
  me.pitch += kick * 0.25;
  me.yaw += (Math.random() - 0.5) * kick * 0.8;
  shake = Math.min(1, shake + 0.12 * heavy);
  audio.gunshot(null, insideHouse(me.pos.x, me.pos.z), curId());
  if (am.mag <= 0) startReload();
}
const r3 = (v) => Math.round(v * 1000) / 1000;

function doMelee() {
  if (!alive() || weapon.meleeT > 0) return;
  weapon.melee();
  audio.swish();
  net.send({ t: 'melee' });
  nextFire = Math.max(nextFire, elapsed + 0.4);
}

function throwGrenade() {
  if (!alive() || !mySnap || mySnap.g <= 0 || weapon.throwT > 0) return;
  weapon.throwNade();
  const o = camera.getWorldPosition(new THREE.Vector3());
  const d = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const v = d.multiplyScalar(17).add(new THREE.Vector3(0, 4, 0));
  net.send({ t: 'nade', o: [o.x, o.y - 0.2, o.z], v: [v.x, v.y, v.z] });
  audio.swish();
}

function nearestBuy() {
  let best = null, bd = BUY_RANGE;
  WALL_BUYS.forEach((b, i) => { const d = Math.hypot(me.pos.x - b.x, me.pos.z - b.z); if (d < bd) { bd = d; best = i; } });
  return best;
}
function tryBuy() {
  const i = nearestBuy();
  if (i == null || !alive()) return;
  net.send({ t: 'buy', s: i, slot: loadout.cur });
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
        cowViews.get(m.cow)?.hit(m.d);
      }
      audio.impact(m.p, m.head);
      break;
    }
    case 'bought': {
      const had = loadout.weapons.includes(m.w);
      loadout.weapons = m.weapons;
      if (had && m.ammo) loadout.ammo[m.w] = { mag: WEAPONS[m.w].mag, res: WEAPONS[m.w].reserve };
      else loadout.ammo[m.w] = { mag: WEAPONS[m.w].mag, res: WEAPONS[m.w].reserve };
      loadout.cur = Math.max(0, loadout.weapons.indexOf(m.w));
      weapon.setGun(m.w);
      audio.cash();
      feed(m.ammo ? `Ammo refilled: ${WEAPONS[m.w].name}` : `Bought ${WEAPONS[m.w].name}`);
      break;
    }
    case 'buyfail':
      feed(`Not enough points ($${m.cost} needed)`);
      audio.click();
      break;
    case 'swing':
      audio.swish(avatars.get(m.id)?.group.position.toArray());
      break;
    case 'boom': {
      const p = new THREE.Vector3(...m.p);
      fx.explosion(p);
      audio.explosion(m.p);
      const d = p.distanceTo(me.pos);
      if (d < 25) shake = Math.min(1.5, shake + (25 - d) / 15);
      break;
    }
    case 'powerup': {
      const label = { maxammo: 'MAX AMMO', instakill: 'INSTA-KILL', double: 'DOUBLE POINTS', nuke: 'KABOOM' }[m.type];
      banner(label, `picked up by ${escapeHtml(m.by)}`, 2500);
      audio.powerup(m.type);
      if (m.type === 'maxammo') refillAll();
      if (m.type === 'nuke') { hurtT = 0; shake = 1; }
      break;
    }
    case 'fx': {
      const av = avatars.get(m.id);
      const from = av ? av.muzzleWorld(new THREE.Vector3()) : new THREE.Vector3(...m.o);
      fx.muzzleFlash(from);
      const dist = raySolids(m.o, m.d, WEAPON.range);
      fx.tracer(from, new THREE.Vector3(...m.o).addScaledVector(new THREE.Vector3(...m.d), dist));
      audio.gunshot(m.o, insideHouse(m.o[0], m.o[2]), m.w);
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
      break;
    case 'gameover':
      banner('THE HERD GOT IN', `You held the ranch for ${m.wave - 1} wave${m.wave === 2 ? '' : 's'}. Restarting...`, 8000);
      audio.stinger(false);
      break;
    case 'restart':
      fx.clearPools();
      loadout.weapons = [...START_WEAPONS]; loadout.cur = 0; loadout.ammo = {}; weapon.setGun('rifle');
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
  const am = ammo(), w = W();
  $('ammo-mag').textContent = reloadT > 0 ? '--' : am.mag;
  $('ammo-res').textContent = `/ ${am.res}`;
  $('ammo-mag').classList.toggle('low', am.mag <= Math.ceil(w.mag * 0.25));
  $('weapon-name').textContent = w.name;
  $('nades').textContent = '● '.repeat(mySnap.g || 0).trim();
  $('reload-hint').textContent = reloadT > 0 ? 'RELOADING' : am.mag === 0 && am.res === 0 ? 'NO AMMO' : am.mag <= Math.ceil(w.mag * 0.25) ? (touchMode ? 'RELOAD' : 'R  RELOAD') : '';
  $('powerups').innerHTML = (s.ik ? `<span class="pu ik">INSTA-KILL ${s.ik}</span>` : '') + (s.dp ? `<span class="pu dp">DOUBLE POINTS ${s.dp}</span>` : '');
  const spread = aiming ? 2 : 6 + Math.min(1, me.speed / 4) * 10 + weapon.recoil * 10;
  $('crosshair').style.setProperty('--spread', `${spread}px`);
  $('crosshair').style.opacity = aiming ? 0 : 1;
  $('scope').classList.toggle('show', weapon.scoped && weapon.aim > 0.85 && alive());
  $('damage').style.opacity = Math.max(hurtT, mySnap.hp < 35 ? 0.35 + Math.sin(performance.now() / 300) * 0.1 : 0);
  if ($('scoreboard').classList.contains('show')) renderScoreboard();

  // downed / dead overlays
  const ov = $('downed-overlay');
  if (mySnap.dn) {
    ov.classList.add('show');
    ov.querySelector('.big').textContent = "YOU'RE DOWN";
    $('downed-sub').textContent = mySnap.rv > 0 ? `Being revived... ${mySnap.rv}%` : `Bleeding out in ${mySnap.bl}s. A teammate can hold ${touchMode ? 'USE' : 'E'} next to you to revive.`;
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
        prompt = p.rv > 0 ? `Reviving ${escapeHtml(p.n)}... ${p.rv}%` : `Hold ${KEY_USE} to revive ${escapeHtml(p.n)}`;
        break;
      }
    }
    const bi = !prompt ? nearestBuy() : null;
    if (bi != null) {
      const b = WALL_BUYS[bi], owned = loadout.weapons.includes(b.weapon);
      prompt = `${touchMode ? 'Tap' : 'Press'} ${KEY_USE} to ${owned ? 'buy ammo for' : 'buy'} ${WEAPONS[b.weapon].name} <b>$${owned ? Math.round(b.cost / 2) : b.cost}</b>`;
    }
    if (!prompt) {
      const e = nearestRepairable();
      if (e) prompt = mySnap.rp > 0 ? `Rebuilding... ${'▮'.repeat(s.boards[e.id])}${'▯'.repeat(MAX_BOARDS - s.boards[e.id])}` : `Hold ${KEY_USE} to rebuild barricade`;
    }
  }
  $('revive-prompt').innerHTML = prompt;
  touch?.update({ aiming, crouched: keys.KeyC, prompt: !!prompt, canSwap: loadout.weapons.length > 1, grenades: mySnap.g > 0, flashlight: flashlightOn });
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
  const rawDt = clock.getDelta();
  adaptQuality(rawDt);
  const dt = Math.min(0.05, rawDt);
  elapsed += dt;

  if (playing) {
    view = net.sample();
    mySnap = net.latest?.playerMap.get(net.id) || null;
    stepLocal(dt);
    syncCows(dt);
    syncAvatars(dt);
    syncDogs(dt);
    syncPickups(dt);
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
  camera.updateMatrixWorld();
  sunPass?.setSun(camera, world.sunDir);
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
  me.update(dt, keys, { aiming, downed, canMove: active() && !dead });
  if (keys.KeyC || keys.ControlLeft) { if (!me.crouchHeld) me.startCrouch(); me.crouchHeld = true; } else { me.crouchHeld = false; me.crouching = false; }

  // weapon + firing
  if (reloadT > 0) {
    reloadT -= dt;
    if (reloadT <= 0) { const am = ammo(), take = Math.min(W().mag - am.mag, am.res); am.mag += take; am.res -= take; }
  }
  // keep the loadout in sync with the server (e.g. after a restart)
  if (mySnap.w && mySnap.w.join() !== loadout.weapons.join()) { loadout.weapons = [...mySnap.w]; loadout.cur = Math.min(loadout.cur, loadout.weapons.length - 1); weapon.setGun(curId()); }
  const canShoot = alive() && active() && reloadT <= 0 && !me.sprinting && weapon.meleeT <= 0 && weapon.switchT <= 0;
  const am = ammo();
  if (mouseDown && canShoot && elapsed >= nextFire && am.mag > 0 && (W().auto || !triggerHeld)) fire(elapsed);
  else if (mouseDown && canShoot && am.mag === 0 && !triggerHeld) { startReload(); triggerHeld = true; }

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
  const targetFov = aiming && !downed ? W().zoom : me.sprinting ? 80 : me.sliding ? 82 : 74;
  camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 12);
  camera.updateProjectionMatrix();

  weapon.update(dt, { aiming: aiming && !downed, moveSpeed: me.speed, sprinting: me.sprinting, lookDX, lookDY, time: elapsed, grounded: me.grounded });
  // light the arms/gun like the world around them: dim indoors, under roofs and in the jungle
  {
    let lit = 1;
    if (insideHouse(me.pos.x, me.pos.z)) lit = 0.3;
    else {
      const eye = [me.pos.x, me.pos.y + me.eye, me.pos.z], L = world.lightDir;
      if (raySolids(eye, [L.x, L.y, L.z], 60) < 60) lit = 0.4;
      else if (Math.hypot(me.pos.x, me.pos.z * 1.1) > 92 && me.pos.z < shoreZ(me.pos.x) - SAND_WIDTH) lit = 0.6;
    }
    vmLight += (lit - vmLight) * Math.min(1, dt * 4);
    weapon.setLight(vmLight);
  }
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
    if (!a) { a = new Avatar(id, p.n, scene, p.c); avatars.set(id, a); }
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

const nadeGeo = new THREE.SphereGeometry(0.07, 10, 8), nadeMat = new THREE.MeshStandardMaterial({ color: 0x3a4a2a, roughness: 0.6 });
function syncPickups(dt) {
  const s = net.latest;
  if (!s) return;
  const seen = new Set();
  for (const [id, type, x, z] of s.pu || []) {
    seen.add(id);
    let v = pickupViews.get(id);
    if (!v) {
      v = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.powerIcon(type), transparent: true, depthWrite: false, color: new THREE.Color(2, 2, 2) }));
      v.scale.setScalar(1.1);
      scene.add(v); pickupViews.set(id, v);
    }
    v.position.set(x, heightAt(x, z) + 1.1 + Math.sin(elapsed * 3 + id) * 0.15, z);
    v.material.rotation = Math.sin(elapsed * 2 + id) * 0.2;
  }
  for (const [id, v] of pickupViews) if (!seen.has(id)) { scene.remove(v); v.material.map.dispose(); pickupViews.delete(id); }
  const nseen = new Set();
  for (const [id, x, y, z] of s.nd || []) {
    nseen.add(id);
    let v = nadeViews.get(id);
    if (!v) { v = new THREE.Mesh(nadeGeo, nadeMat); v.castShadow = true; scene.add(v); nadeViews.set(id, v); }
    v.position.lerp(new THREE.Vector3(x, y, z), v.position.lengthSq() ? Math.min(1, dt * 15) : 1);
  }
  for (const [id, v] of nadeViews) if (!nseen.has(id)) { scene.remove(v); nadeViews.delete(id); }
}

function syncBoards() {
  const s = net.latest;
  if (!s) return;
  s.boards.forEach((n, i) => {
    if (n === boardsShown[i]) return;
    const list = world.boards[i];
    if (world.grilles?.[i]) world.grilles[i].visible = n > 0; // torn out with the last board
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
window.__rd = { net, me, scene, camera, cowViews, renderer, CowView, DogView, Avatar, weapon, world, vmScene };
