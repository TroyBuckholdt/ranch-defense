import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { SunPass, ViewmodelPass } from './post.js';
import {
  ENTRIES, HOUSE, MAX_BOARDS, COW_TYPE_LIST, COW_TYPES, LOCALS_WAVE, BOSS_WAVE, FOG_DENSITY, GOLD, BOTTLE, VEHICLES, VEHICLE_SEATS, ENTER_RANGE, vehicleGap, pushOutOfVehicle, vehicleWorld,
  STATIONS, stationSpot, USE_RANGE, PERKS, PERK_MACHINES, MAX_PERKS, BOX, PAP, TRAP, weaponStats, WEAPON, WEAPONS, START_WEAPONS, WALL_BUYS, BUY_RANGE, MELEE, REPAIR_RANGE, raySolids, raySphere, cowHitSpheres, insideHouse, heightAt, shoreZ, SAND_WIDTH,
} from '../../shared/world.js';
import { buildWorld } from './world.js';
import { CowView, loadCowAsset, COW_LOOK } from './cow.js';
import { HumanView, preloadHumans, bottleMesh } from './humanoid.js';
import { tauntLine } from './taunts.js';
import { tr, lang, translateDom } from './i18n.js';
import { Driving, VehicleView, CAB } from './vehicle.js';
import { Machines } from './machines.js';
import { DogView, loadDogAssets } from './dog.js';
import { Avatar, CHARACTERS, loadCharacter } from './avatar.js';
import { Weapon } from './weapon.js';
import { FX } from './fx.js';
import { Audio } from './audio.js';
import { Net } from './net.js';
import { LocalPlayer } from './player.js';
import { setAnisotropy } from './textures.js';
import { setLowDetail } from './gltf.js';
import * as T from './textures.js';
import { detectTouch, isPhone, TouchControls, getSensitivity, setSensitivity } from './touch.js';

const $ = (id) => document.getElementById(id);
translateDom(); // English or Spanish, before anything else is shown
const myUpg = (id) => !!mySnap?.up?.includes(id);
const myPerks = () => mySnap?.pk || [];
// a gun's name: its El Taller name once upgraded (those stay in Spanish), translated otherwise
const wname = (id) => (myUpg(id) ? PAP.names[id] : tr(WEAPONS[id].name));
const fullAmmo = (id) => { const st = weaponStats(id, myUpg(id)); return { mag: st.mag, res: st.reserve }; };
const touchMode = detectTouch(); // phone / tablet: on-screen controls instead of pointer lock

// ---------------------------------------------------------------- quality
const PRESETS = {
  ultra: { pr: 2, shadows: 4096, msaa: 4, bloom: true, ao: true, rays: 48, grass: 50000, crowns: 2 },
  high: { pr: 1.25, shadows: 4096, msaa: 4, bloom: true, ao: false, rays: 24, grass: 22000, crowns: 1 },
  medium: { pr: 1, shadows: 2048, msaa: 2, bloom: true, ao: false, rays: 0, grass: 12000, crowns: 1 },
  low: { pr: 0.75, shadows: 0, msaa: 0, bloom: false, ao: false, rays: 0, grass: 4000, crowns: 1, lowTex: true },
};
// Default by graphics chip: built-in laptop/phone graphics start on Medium/Low, only
// dedicated gaming cards get High. (Players can always change it on the menu.)
function guessQuality() {
  const phone = matchMedia('(pointer: coarse)').matches;
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = String(gl ? gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) : '');
    if (phone || /Mali|Adreno|PowerVR|SwiftShader|llvmpipe|Software/i.test(gpu)) return 'low';
    if (/RTX|GTX 1[0-9]{3}|GTX 9[6-9]0|RX ?[5-9][0-9]{2,3}|Radeon (Pro|VII)|Arc A[57]|Apple M[1-9] (Pro|Max|Ultra)/i.test(gpu)) return 'high';
    return 'medium';
  } catch { return phone ? 'low' : 'medium'; }
}
let qName = new URLSearchParams(location.search).get('q');
try { qName = qName || localStorage.getItem('rd-quality'); } catch {}
if (!PRESETS[qName]) qName = touchMode ? (isPhone() ? 'low' : 'medium') : guessQuality();
const Q = PRESETS[qName];
setLowDetail(Q.lowTex);
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

// ---------------------------------------------------------------- menu
// built before anything heavy loads, so the characters show up straight away
const nameInput = $('name'), roomInput = $('room');
let myChar = 'p1';
try { myChar = localStorage.getItem('rd-char') || 'p1'; } catch {}
if (!CHARACTERS.some(c => c.id === myChar)) myChar = 'p1'; // e.g. a removed duplicate
const picker = $('char-picker');
// (?v= on the pictures: bump it when one changes, or browsers keep showing the old one for an hour)
for (const c of CHARACTERS) {
  const b = document.createElement('button');
  b.type = 'button';
  b.innerHTML = `<img src="/assets/models/people/thumbs/${c.id}.jpg?v=2" alt=""><span>${c.label}</span>`;
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

$('play').disabled = true;
// loading readout: what's happening plus how many of the files have arrived
let loadMsg = 'Waking the herd...', loadPct = 0, loading = true;
const showLoad = () => { if (loading) $('menu-status').textContent = `${tr(loadMsg)} ${loadPct}%`; };
THREE.DefaultLoadingManager.onProgress = (url, done, total) => { loadPct = Math.max(loadPct, Math.min(99, Math.round((done / total) * 100))); showLoad(); };
showLoad();
await Promise.all([loadCowAsset(renderer), loadDogAssets()]);
const world = await buildWorld(renderer, Q, (msg) => { loadMsg = msg; showLoad(); });
loading = false;
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

function resize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(innerWidth, innerHeight);
  grade.uniforms.uTexel.value.set(1 / (innerWidth * renderer.getPixelRatio()), 1 / (innerHeight * renderer.getPixelRatio()));
}
addEventListener('resize', resize);

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
audio.preload(); // sound effects download in the background now the ranch is in
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
const flyingBottles = [];
// the trucks: one view each; `ride` is the truck and seat I'm in, `driving` my own simulation of it
const truckViews = new Map(world.trucks.map(t => [t.def.id, new VehicleView(t.def, t.model, scene)]));
for (const v of truckViews.values()) v.apply({ ...v.def, speed: 0, steer: 0 }, 0);
let ride = null, driving = null, camSwing = 0, camSwingIdle = 0, dustT = 0;
const CAB_EYE = CAB.eye - VEHICLE_SEATS[1][2];   // a front passenger's eye above the seat's foot height
const machines = new Machines(scene, world.machineModel, weapon);
machines.onStrike = (p) => audio.hammer([p.x, 1.2, p.z]);
const shellViews = new Map();
const shellGeo = new THREE.SphereGeometry(0.13, 12, 10), shellMat = new THREE.MeshStandardMaterial({ color: 0x4e3218, roughness: 0.95 });
let perkKey = '';
const chase = { pos: new THREE.Vector3(), ready: false };
let view = null;            // latest interpolated world
let mySnap = null;          // my own state from the server
let playing = false;
// loadout: two weapon slots, ammo tracked per gun
const loadout = { weapons: [...START_WEAPONS], cur: 0, ammo: {} };
const curId = () => loadout.weapons[loadout.cur] || 'rifle';
const W = () => weaponStats(curId(), myUpg(curId()), myPerks());
function ammo(id = curId()) {
  if (!loadout.ammo[id]) loadout.ammo[id] = fullAmmo(id);
  return loadout.ammo[id];
}
function refillAll() { for (const id of loadout.weapons) loadout.ammo[id] = fullAmmo(id); }
let triggerHeld = false; // semi-auto guns need a fresh click per shot
let reloadT = 0;
let nextFire = 0;
let mouseDown = false, aiming = false;
let lookDX = 0, lookDY = 0;
let hurtT = 0, shake = 0;
let boardsShown = ENTRIES.map(() => MAX_BOARDS);
let lastStateSend = 0;
let mooTimer = 2, heartbeatT = 0, stepDist = 0;
const keys = {};
const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3();

if (touchMode) {
  $('touch-menu').classList.remove('hidden');
  const sens = $('touch-sens');
  sens.value = getSensitivity();
  sens.oninput = () => { setSensitivity(sens.value); if (touch) touch.sens = +sens.value; };
}

$('play').onclick = async () => {
  const name = nameInput.value.trim() || tr('Rancher');
  const room = roomInput.value.trim() || 'ranch';
  try { localStorage.setItem('rd-name', name); } catch {}
  $('play').disabled = true;
  $('menu-status').textContent = tr('Connecting...');
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
    $('menu-status').textContent = tr(e.message);
    $('play').disabled = false;
  }
};
[nameInput, roomInput].forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') $('play').click(); }));

// ---------------------------------------------------------------- input
function lockPointer() {
  const el = renderer.domElement;
  // raw mouse input where supported (no OS acceleration, avoids Chrome's jump bug)
  try { const p = el.requestPointerLock?.({ unadjustedMovement: true }); if (p?.catch) p.catch(() => el.requestPointerLock?.()); }
  catch { el.requestPointerLock?.(); }
}
const locked = () => document.pointerLockElement === renderer.domElement;
// gameplay input is live: pointer locked on desktop, or simply in a game on touch screens
const active = () => locked() || (touchMode && playing);
const KEY_USE = touchMode ? `<kbd>${tr('USE')}</kbd>` : '<kbd>E</kbd>';
const touch = touchMode ? new TouchControls({
  keys,
  fire(down) { mouseDown = down; if (!down) triggerHeld = false; },
  toggleAim() { aiming = !aiming; },
  reload: () => startReload(),
  grenade: () => throwGrenade(),
  melee: () => doMelee(),
  swap: () => switchTo(1 - loadout.cur),
  use(down) { keys.KeyE = down; if (down) useKey(); },
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
  // Chrome sometimes reports one bogus jump right after locking (or a rare huge spike);
  // ignore only those. At low frame rates Chrome batches a whole frame of real motion into
  // one event, so ordinary large movements must be kept or turning stalls.
  if (performance.now() - lockedAt < 150 || Math.abs(e.movementX) > 900 || Math.abs(e.movementY) > 900) return;
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
  if (e.code === 'KeyE') useKey();
  if (e.code === 'KeyF') { flashlightOn = !flashlightOn; audio.click(); }
  // secret: type "boss" to call Rafael out
  secretKeys = (secretKeys + e.key.toLowerCase()).slice(-4);
  if (secretKeys === 'boss') { secretKeys = ''; net.send({ t: 'summon' }); }
});
let secretKeys = '';
// same secret on a phone: tap the wave number five times within two seconds
let secretTaps = [];
$('wave-label').style.pointerEvents = 'auto';
$('wave-label').addEventListener('pointerdown', () => {
  const now = performance.now();
  secretTaps = secretTaps.filter(t => now - t < 2000);
  secretTaps.push(now);
  if (secretTaps.length >= 5 && playing) { secretTaps = []; net.send({ t: 'summon' }); }
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
  if (!w.projectile) dirs.forEach((dir, i) => {
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
  if (!w.projectile) fx.casing(weapon.ejectWorld(tmpV2), new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion));

  const heavy = w.projectile || curId() === 'shotgun' || curId() === 'hunting' ? 2.2 : curId() === 'revolver' ? 1.5 : 1;
  weapon.kick(heavy);
  const kick = (aiming ? 0.006 : 0.011) * heavy * crouchK;
  me.recoil = Math.min(0.2, me.recoil + kick);
  me.pitch += kick * 0.25;
  me.yaw += (Math.random() - 0.5) * kick * 0.8;
  shake = Math.min(1, shake + 0.12 * heavy);
  audio.gunshot(null, insideHouse(me.pos.x, me.pos.z, me.pos.y), curId());
  if (am.mag <= 0) startReload();
}
const r3 = (v) => Math.round(v * 1000) / 1000;

function doMelee() {
  if (!alive() || weapon.meleeT > 0 || driving) return;
  weapon.melee();
  audio.swish();
  net.send({ t: 'melee' });
  nextFire = Math.max(nextFire, elapsed + 0.4);
}

function throwGrenade() {
  if (!alive() || !mySnap || mySnap.g <= 0 || weapon.throwT > 0 || driving) return;
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

// ---------------------------------------------------------------- trucks
// E: buy from a wall if one is in reach, otherwise get into (or out of) a truck
function useKey() {
  if (!alive()) return;
  if (ride) { net.send({ t: 'veh', a: 'out' }); return; }
  if (nearestBuy() != null) { tryBuy(); return; }
  const st = nearestStation();
  if (st) {
    if (st.kind === 'power') net.send({ t: 'power' });
    if (st.kind === 'perk') net.send({ t: 'perk', i: st.i });
    if (st.kind === 'box') net.send({ t: 'box', slot: loadout.cur });
    if (st.kind === 'pap') net.send({ t: 'pap', w: curId() });
    if (st.kind === 'trap') net.send({ t: 'trap' });
    return;
  }
  const t = nearestTruck();
  if (t) net.send({ t: 'veh', a: 'in', id: t.id });
}
// the machine in front of me, if any (the box only where it currently is)
function nearestStation() {
  let best = null, bd = USE_RANGE;
  const boxAt = net.latest?.bx?.[0] ?? 0;
  for (const m of STATIONS) {
    if (m.kind === 'box' && m.i !== boxAt) continue;
    const [x, z] = stationSpot(m), d = Math.hypot(me.pos.x - x, me.pos.z - z);
    if (d < bd) { bd = d; best = m; }
  }
  return best;
}

// what pressing E at a machine would do, for the prompt
function stationPrompt(m, s) {
  const press = tr(touchMode ? 'Tap' : 'Press'), cost = (c) => ` <b>$${c}</b>`;
  if (m.kind === 'power') return s.pw ? '' : tr('{0} {1} to turn on the power', press, KEY_USE);
  if (m.kind === 'perk') {
    const def = PERKS[m.perk];
    if (myPerks().includes(m.perk)) return tr('You have {0}', tr(def.name));
    if (!s.pw) return tr('{0}: needs power', tr(def.name));
    if (myPerks().length >= MAX_PERKS) return tr('You can only hold four perks');
    return tr('{0} {1} to drink {2}', press, KEY_USE, tr(def.name)) + cost(def.cost);
  }
  if (m.kind === 'box') {
    const [, st, w, , by] = s.bx;
    if (st === 2 && by === net.id) return tr('{0} {1} to take {2}', press, KEY_USE, tr(WEAPONS[w].name));
    if (st !== 0) return '';
    return tr('{0} {1} for a random gun', press, KEY_USE) + cost(s.fs ? BOX.fireSaleCost : BOX.cost);
  }
  if (m.kind === 'pap') {
    if (!s.pw) return tr('El Taller: needs power');
    if (s.pp[0]) return s.pp[2] === net.id ? tr('Upgrading...') : tr("It's busy");
    if (myUpg(curId())) return tr('That gun is already upgraded');
    return tr('{0} {1} to upgrade {2}', press, KEY_USE, wname(curId())) + cost(PAP.cost);
  }
  if (m.kind === 'trap') {
    if (s.tr[0] > 0) return tr('The fence is live');
    if (s.tr[1] > 0) return tr('The fence is recharging: {0}s', s.tr[1]);
    return tr('{0} {1} to electrify the gate', press, KEY_USE) + cost(TRAP.cost);
  }
  return '';
}

function nearestTruck() {
  let best = null, bd = ENTER_RANGE;
  for (const v of truckViews.values()) {
    const d = vehicleGap(v, v.def, me.pos.x, me.pos.z);
    if (d < bd) { bd = d; best = v.def; }
  }
  if (!best) return null;
  const seats = net.latest?.vehMap?.get(best.id)?.slice(6) || [0, 0, 0, 0];
  return seats.includes(0) ? { ...best, free: seats.indexOf(0) } : null;
}

// Where every truck is this frame: mine from my own driving, the rest from the server.
function syncTrucks(dt) {
  const s = net.latest;
  if (!s?.veh) return;
  // which truck am I in, if any?
  let now = null;
  for (const v of s.veh) { const seat = v.slice(6).indexOf(net.id); if (seat >= 0) now = { id: v[0], seat }; }
  if (now && (!ride || ride.id !== now.id || ride.seat !== now.seat)) {
    ride = now;
    const v = s.vehMap.get(now.id);
    driving = now.seat === 0 ? new Driving({ x: v[1], z: v[2], yaw: v[3] }) : null;
    chase.ready = false; camSwing = 0;
    aiming = false; mouseDown = false;
    audio.click();
  } else if (!now && ride) { // got out (or was thrown out): the server says where I'm standing
    ride = null; driving = null;
    if (mySnap) { me.teleport(mySnap.x, mySnap.y, mySnap.z); }
    audio.click();
  }
  for (const [id, view_] of truckViews) {
    // the cab interior is drawn only for me, sat up front in first person (the driver sees the truck from behind)
    view_.setCabin(!!ride && ride.id === id && ride.seat === 1 && !mySnap?.dn && !mySnap?.dd);
    if (driving && ride.id === id) { view_.apply(driving, dt); continue; }
    const v = view?.veh?.get(id);
    if (v) view_.apply(v, dt);
  }
}

// The driver: W/S (or the stick) for throttle and brake/reverse, A/D to steer, Space handbrake.
function stepDriving(dt) {
  const v = truckViews.get(ride.id);
  let throttle = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
  let steer = (keys.KeyA || keys.ArrowLeft ? 1 : 0) - (keys.KeyD || keys.ArrowRight ? 1 : 0);
  if (keys.axisX || keys.axisY) { throttle = -keys.axisY || 0; steer = -keys.axisX || 0; }
  if (!active()) throttle = steer = 0;
  const bump = driving.step(dt, { throttle, steer, handbrake: !!keys.Space });
  if (bump > 2) { audio.thud([driving.x, 1, driving.z], Math.min(1, bump / 9)); shake = Math.min(1.2, shake + bump / 12); }
  // dust off the back wheels on dirt and sand
  dustT -= dt * Math.abs(driving.speed);
  if (dustT < 0 && Math.abs(driving.speed) > 4) {
    dustT = 2.2;
    const [dx, dz] = vehicleWorld(driving, (Math.random() - 0.5) * 1.6, -2.4 * Math.sign(driving.speed));
    fx.puff(new THREE.Vector3(dx, heightAt(dx, dz) + 0.25, dz), 0xcfc4ae, 1.6 + Math.abs(driving.speed) * 0.08, 1.1);
  }
  v.seatWorld(0, me.pos);
  me.vel.set(Math.sin(driving.yaw) * driving.speed, 0, Math.cos(driving.yaw) * driving.speed);
  me.speed = 0; me.grounded = true; me.sprinting = false;
  // mouse swings the chase camera round; it drifts back behind the truck when left alone
  camSwing -= lookDX * 0.0022;
  camSwingIdle = lookDX ? 0 : camSwingIdle + dt;
  if (camSwingIdle > 1.2) camSwing -= camSwing * Math.min(1, dt * 2.5);
  camSwing = Math.max(-2.6, Math.min(2.6, camSwing));
  const a = driving.yaw + camSwing + (driving.speed < -1 && Math.abs(camSwing) < 0.1 ? 0 : 0);
  const back = 7.4 + Math.abs(driving.speed) * 0.12, up = 3.1;
  const target = tmpV.set(driving.x, v.y + 1.5, driving.z);
  const want = tmpV2.set(driving.x - Math.sin(a) * back, v.y + up, driving.z - Math.cos(a) * back);
  // don't let a wall or a tree come between the camera and the truck
  const dir = want.clone().sub(target), len = dir.length(); dir.divideScalar(len);
  const clear = raySolids([target.x, target.y, target.z], [dir.x, dir.y, dir.z], len);
  if (clear < len) want.copy(target).addScaledVector(dir, Math.max(1.5, clear - 0.4));
  want.y = Math.max(want.y, heightAt(want.x, want.z) + 1.0);
  if (!chase.ready) { chase.pos.copy(want); chase.ready = true; }
  chase.pos.lerp(want, Math.min(1, dt * 7));
  camera.position.copy(chase.pos);
  camera.lookAt(driving.x + Math.sin(driving.yaw) * 2.5, v.y + 1.3, driving.z + Math.cos(driving.yaw) * 2.5);
  camera.rotateZ((Math.random() - 0.5) * shake * 0.01);
  me.yaw = driving.yaw + Math.PI; me.pitch = 0;   // facing forward when they step out
  weapon.root.visible = false;
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
      loadout.ammo[m.w] = fullAmmo(m.w);
      loadout.cur = Math.max(0, loadout.weapons.indexOf(m.w));
      weapon.setGun(m.w);
      audio.cash();
      feed(m.ammo ? tr('Ammo refilled: {0}', wname(m.w)) : tr('Bought {0}', wname(m.w)));
      break;
    }
    case 'buyfail':
      feed(tr('Not enough points (${0} needed)', m.cost));
      audio.click();
      break;
    case 'swing':
      audio.swish(avatars.get(m.id)?.group.position.toArray());
      break;
    case 'boom': {
      const p = new THREE.Vector3(...m.p);
      fx.explosion(p);
      if (m.coco) fx.spawn(30, p, { spread: 2, up: 1.4, speed: 7, life: 1.2, size: 0.07, color: 0x5a3a1e, grav: 12, bounce: 0.3 }); // shell pieces
      if (m.gas) { // a bloated cow bursting: green-brown muck and a sickly cloud
        fx.spawn(40, p, { spread: 1.5, up: 2.2, speed: 8, life: 1.3, size: 0.08, color: 0x5d6b26, grav: 13, bounce: 0.2 });
        for (let i = 0; i < 5; i++) fx.puff(p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2.5, Math.random() * 1.2, (Math.random() - 0.5) * 2.5)), 0x8fa04a, 3.5, 2.2);
      }
      audio.explosion(m.p);
      const d = p.distanceTo(me.pos);
      if (d < 25) shake = Math.min(1.5, shake + (25 - d) / 15);
      break;
    }
    case 'powerup': {
      const label = tr({ maxammo: 'MAX AMMO', instakill: 'INSTA-KILL', double: 'DOUBLE POINTS', nuke: 'KABOOM', carpenter: 'CARPENTER', firesale: 'FIRE SALE' }[m.type]);
      banner(label, tr('picked up by {0}', escapeHtml(m.by)), 2500);
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
      if (!WEAPONS[m.w]?.projectile) fx.tracer(from, new THREE.Vector3(...m.o).addScaledVector(new THREE.Vector3(...m.d), dist));
      audio.gunshot(m.o, insideHouse(m.o[0], m.o[2], m.o[1] - 1.5), m.w);
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
    case 'taunt': { // Rafael mouthing off: subtitle under his health bar, and a slurred voice
      const [es, en] = tauntLine(m.k, m.i);
      const el = $('boss-line');
      el.innerHTML = `<b>${escapeHtml(es)}</b>${lang === 'es' ? '' : `<small>${escapeHtml(en)}</small>`}`; // he only speaks Spanish; English players get the gloss
      el.classList.add('show');
      clearTimeout(tauntTimer);
      tauntTimer = setTimeout(() => el.classList.remove('show'), m.k === 'death' ? 6000 : 4200);
      const c = view?.cows.get(m.cow);
      const dist = c ? Math.hypot(c[0] - me.pos.x, c[1] - me.pos.z) : 30;
      audio.say(es, Math.max(0.85, 1 - dist / 200), m.k === 'death');   // a 4.75 m drunk carries: loud from anywhere
      break;
    }
    case 'bottle': { // Rafael throws his empty: it arcs over and lands at m.to after m.time seconds
      const v = cowViews.get(m.cow);
      const from = v?.startThrow ? v.startThrow(new THREE.Vector3()) : new THREE.Vector3(m.to[0], 6, m.to[1]);
      const mesh = bottleMesh();
      mesh.scale.setScalar(COW_TYPES.rafael.scale * 1.5);
      scene.add(mesh);
      const to = new THREE.Vector3(m.to[0], heightAt(m.to[0], m.to[1]) + 0.1, m.to[1]);
      flyingBottles.push({ mesh, from, to, t: 0, time: m.time, arc: 5 + from.distanceTo(to) * 0.16 });
      audio.swish([from.x, from.y, from.z]);
      break;
    }
    case 'smash': {
      const p = new THREE.Vector3(m.p[0], heightAt(m.p[0], m.p[1]) + 0.15, m.p[1]);
      fx.spawn(46, p, { spread: 2, up: 1.6, speed: 9, life: 1.1, size: 0.05, color: 0x4f8a36, grav: 12, bounce: 0.3, stretch: 2 });
      fx.puff(p, 0xb8c8a0, 2.2, 0.8);
      audio.smash([p.x, p.y, p.z]);
      const d = p.distanceTo(me.pos);
      if (d < 12) shake = Math.min(1.5, shake + (12 - d) / 14);
      break;
    }
    case 'power':
      banner(tr('THE POWER IS ON'), tr('{0} started the generator. Perks and El Taller are working.', escapeHtml(m.by)), 4000);
      audio.powerOn();
      break;
    case 'perk': // I drank one
      banner(tr(PERKS[m.perk].name), tr(PERKS[m.perk].desc), 2600);
      audio.drink(true);
      break;
    case 'drink': { const a = avatars.get(m.id); audio.drink(false, a?.group.position.toArray()); break; }
    case 'perks':
      if (!m.perks.length) feed(tr('You lost your perks'));
      break;
    case 'denied':
      feed(tr({ points: 'Not enough points (${0} needed)', power: 'Turn the power on first: the generator behind the house', have: 'You already have that perk', full: 'You can only hold four perks', busy: "It's busy", done: 'That gun is already upgraded' }[m.why] || '', m.cost));
      audio.click();
      break;
    case 'box': {
      const sp = BOX.spots[net.latest?.bx?.[0] ?? 0];
      if (m.s === 'roll') audio.musicBox([sp.x, 1, sp.z]);
      if (m.s === 'teddy') { feed(tr('The box is moving!')); audio.laugh([sp.x, 1, sp.z]); }
      if (m.s === 'moved') feed(tr('The mystery box has moved. Look for the light.'));
      break;
    }
    case 'pap':
      if (m.s === 'done' && m.by === net.id) {
        loadout.ammo[m.w] = fullAmmo(m.w);
        banner(PAP.names[m.w], tr('Upgraded at El Taller'), 3000);
        audio.powerup('double');
      }
      break;
    case 'trap':
      if (m.on) { feed(tr('{0} electrified the south gate', escapeHtml(m.by))); audio.zap([TRAP.zone.x, 1, TRAP.zone.z]); }
      break;
    case 'ram': // my truck hit something alive: it costs speed
      if (driving) { driving.speed *= m.k; shake = Math.min(1.5, shake + 0.6); audio.thud([driving.x, 1, driving.z], 0.9); }
      break;
    case 'hurt':
      hurtT = 1; shake = 1;
      audio.hurt();
      break;
    case 'wave':
      if (m.kind === 'boss') { banner(tr('WAVE {0}: RAFAEL', m.wave), tr("He's huge, he's drunk, and he's throwing bottles. Keep moving."), 6000); preloadHumans(); }
      else if (m.kind === 'locals') { banner(tr('WAVE {0}: THE LOCALS', m.wave), tr('{0} locals with machetes are coming instead of the herd', m.count), 5000); preloadHumans(['local']); }
      else if (m.twist === 'gold') banner(tr('WAVE {0}: THE GOLDEN COW', m.wave), tr("Rafael's prize cow is loose in the herd. Catch her before she gets away: points for everyone."), 6000);
      else if (m.twist === 'stampede') { banner(tr('WAVE {0}: STAMPEDE!', m.wave), tr('{0} cows charging at once, all from one side. Get behind something.', m.count), 5500); audio.rumble(); }
      else if (m.twist === 'bomb') banner(tr('WAVE {0}: BLOATED COWS', m.wave), tr('They burst a moment after they die. Kill them away from you, and from each other... or not.'), 6000);
      else if (m.twist === 'fog') banner(tr('WAVE {0}: MARSH FOG', m.wave), tr("Fog is rolling in off the pond. Listen for them."), 5500);
      else banner(tr('WAVE {0}', m.wave), tr('{0} zombie cows are coming for the house', m.count));
      setTwist(m.twist);
      // have the people-enemies downloaded before the rounds that need them
      if (m.wave >= LOCALS_WAVE - 2 && m.wave < BOSS_WAVE) preloadHumans(['local']);
      if (m.wave >= BOSS_WAVE - 2 && m.wave < BOSS_WAVE) preloadHumans();
      audio.stinger(false);
      audio.music(true);
      break;
    case 'gold':
      if (m.k === 'loose') audio.powerup('double');
      else if (m.k === 'caught') { banner(tr('THE GOLDEN COW IS DOWN'), m.by ? tr('{0} got her. {1} points each, and a prize.', escapeHtml(m.by), GOLD.reward) : tr('{0} points each, and a prize.', GOLD.reward), 4000); audio.cash(); }
      else if (m.k === 'gone') banner(tr('THE GOLDEN COW GOT AWAY'), tr('Rafael will never forgive you.'), 3500);
      break;
    case 'waveclear':
      setTwist('');
      banner(tr('WAVE {0} SURVIVED', m.wave), tr('Fix the barricades. Hold {0} at a window.', touchMode ? tr('USE') : 'E'));
      audio.stinger(true);
      audio.music(false);
      break;
    case 'gameover':
      for (const b of flyingBottles.splice(0)) scene.remove(b.mesh);
      banner(tr('THE HERD GOT IN'), m.wave === 2 ? tr('You held the ranch for 1 wave. Restarting...') : tr('You held the ranch for {0} waves. Restarting...', m.wave - 1), 8000);
      audio.stinger(false);
      audio.music(false);
      break;
    case 'restart':
      fx.clearPools();
      ride = null; driving = null;
      loadout.weapons = [...START_WEAPONS]; loadout.cur = 0; loadout.ammo = {}; weapon.setGun('rifle');
      break;
    case 'summon':
      banner(tr('RAFAEL'), tr('{0} called him out. He\'s huge, he\'s drunk, and he\'s throwing bottles.', escapeHtml(m.by)), 6000);
      preloadHumans();
      break;
    case 'chat':
      feed(m.k ? tr(m.k, ...(m.a || [])) : m.msg);
      break;
    case 'disconnected':
      feed(tr('Lost connection to the server. Refresh to rejoin.'));
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
    m: clone, age: 0, floor: e.y,
    v: new THREE.Vector3(e.nx * (3 + Math.random() * 2), 2 + Math.random() * 2, e.nz * (3 + Math.random() * 2)),
    spin: new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8),
  });
  fx.splinters(clone.position.clone(), new THREE.Vector3(-e.nx, 0.3, -e.nz));
}

// ---------------------------------------------------------------- HUD
let bannerTimer = null, tauntTimer = null;
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
    `<tr class="${p.id === net.id ? 'me' : ''}"><td>${escapeHtml(p.n)}${p.dn ? ' ' + tr('(down)') : p.dd ? ' ' + tr('(out)') : ''}</td><td>${p.k}</td><td>${p.s}</td></tr>`).join('');
  $('scoreboard').innerHTML = `<div style="margin-bottom:8px;opacity:.7">${tr('Room')} <b>${escapeHtml(net.room)}</b> · ${tr('invite link:')} ${escapeHtml(location.href)}</div>
    <table><tr><th>${tr('Player')}</th><th>${tr('Kills')}</th><th>${tr('Score')}</th></tr>${rows}</table>`;
}
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// what the round's enemies are called in the counter under the wave number
function leftWord(wave, n) {
  if (wave === LOCALS_WAVE) return tr(n === 1 ? 'local' : 'locals');
  if (wave === BOSS_WAVE) return tr(n === 1 ? 'enemy' : 'enemies');
  return tr(n === 1 ? 'cow' : 'cows');
}

function updateHud(dt) {
  const s = net.latest;
  if (!s || !mySnap) return;
  if ((s.tw || '') !== twist) setTwist(s.tw);
  $('wave-num').textContent = s.wave;
  if ((s.phase === 'wave') !== !!audio.musicOn) audio.music(s.phase === 'wave'); // e.g. joined mid-wave
  $('wave-sub').textContent = s.phase === 'intermission' ? tr('Next wave in {0}s', s.timer)
    : s.phase === 'wave' ? tr('{0} left', `${s.left} ${leftWord(s.wave, s.left)}`) : tr('Game over');
  // boss health bar
  let bossHp = -1;
  for (const c of s.cows) if (COW_TYPES[COW_TYPE_LIST[c[1]]].boss && c[6] !== 2) bossHp = c[5];
  $('boss-bar').classList.toggle('show', bossHp >= 0);
  if (bossHp >= 0) $('boss-fill').style.width = `${bossHp}%`;
  $('hp-fill').style.width = `${(mySnap.hp / (mySnap.mh || 100)) * 100}%`;
  const pk = myPerks().join();
  if (pk !== perkKey) {
    perkKey = pk;
    $('perks').innerHTML = myPerks().map(id => `<span style="--c:${PERKS[id].color}" title="${escapeHtml(tr(PERKS[id].name))}">${escapeHtml(tr(PERKS[id].name).split(' ').map(w => w[0]).join(''))}</span>`).join('');
  }
  weapon.setUpgraded(mySnap.up || []);
  $('hp-fill').classList.toggle('low', mySnap.hp < 35);
  $('score').textContent = mySnap.s;
  const am = ammo(), w = W();
  $('ammo-mag').textContent = reloadT > 0 ? '--' : am.mag;
  $('ammo-res').textContent = `/ ${am.res}`;
  $('ammo-mag').classList.toggle('low', am.mag <= Math.ceil(w.mag * 0.25));
  $('weapon-name').textContent = wname(curId());
  $('nades').textContent = '● '.repeat(mySnap.g || 0).trim();
  $('reload-hint').textContent = reloadT > 0 ? tr('RELOADING') : am.mag === 0 && am.res === 0 ? tr('NO AMMO') : am.mag <= Math.ceil(w.mag * 0.25) ? tr(touchMode ? 'RELOAD' : 'R  RELOAD') : '';
  $('powerups').innerHTML = (s.ik ? `<span class="pu ik">${tr('INSTA-KILL')} ${s.ik}</span>` : '') + (s.dp ? `<span class="pu dp">${tr('DOUBLE POINTS')} ${s.dp}</span>` : '') + (s.fs ? `<span class="pu fs">${tr('FIRE SALE')} ${s.fs}</span>` : '');
  const spread = aiming ? 2 : 6 + Math.min(1, me.speed / 4) * 10 + weapon.recoil * 10;
  $('crosshair').style.setProperty('--spread', `${spread}px`);
  $('crosshair').style.opacity = aiming || driving ? 0 : 1;
  $('scope').classList.toggle('show', weapon.scoped && weapon.aim > 0.85 && alive());
  $('damage').style.opacity = Math.max(hurtT, mySnap.hp < 35 ? 0.35 + Math.sin(performance.now() / 300) * 0.1 : 0);
  if ($('scoreboard').classList.contains('show')) renderScoreboard();

  // downed / dead overlays
  const ov = $('downed-overlay');
  if (mySnap.dn) {
    ov.classList.add('show');
    ov.querySelector('.big').textContent = mySnap.sr ? tr('SECOND WIND') : tr("YOU'RE DOWN");
    $('downed-sub').textContent = mySnap.sr ? tr('Getting back up... {0}%', mySnap.rv) : mySnap.rv > 0 ? tr('Being revived... {0}%', mySnap.rv) : tr('Bleeding out in {0}s. A teammate can hold {1} next to you to revive.', mySnap.bl, touchMode ? tr('USE') : 'E');
  } else if (mySnap.dd && s.phase !== 'gameover') {
    ov.classList.add('show');
    ov.querySelector('.big').textContent = tr('SPECTATING');
    $('downed-sub').textContent = tr('You come back when this wave is cleared.');
  } else ov.classList.remove('show');

  // context prompt: revive > repair
  let prompt = '';
  if (alive() && view) {
    for (const [id, p] of view.players) {
      if (id !== net.id && p.dn && Math.hypot(p.x - me.pos.x, p.z - me.pos.z) < 2.6) {
        prompt = p.rv > 0 ? tr('Reviving {0}... {1}%', escapeHtml(p.n), p.rv) : tr('Hold {0} to revive {1}', KEY_USE, escapeHtml(p.n));
        break;
      }
    }
    if (ride) {
      const kmh = driving ? Math.round(Math.abs(driving.speed) * 3.6) : 0;
      prompt = driving ? `<b>${kmh} km/h</b> &nbsp; ${tr(touchMode ? 'stick to drive, JUMP handbrake,' : 'WASD drive, Space handbrake,')} ${tr('{0} get out', KEY_USE)}`
        : tr('{0} to get out', KEY_USE);
    }
    if (!prompt) { const m = nearestStation(); if (m) prompt = stationPrompt(m, s); }
    const bi = !prompt ? nearestBuy() : null;
    if (bi != null) {
      const b = WALL_BUYS[bi], owned = loadout.weapons.includes(b.weapon);
      prompt = `${tr(owned ? '{0} {1} to buy ammo for {2}' : '{0} {1} to buy {2}', tr(touchMode ? 'Tap' : 'Press'), KEY_USE, wname(b.weapon))} <b>$${owned ? Math.round(b.cost / 2) : b.cost}</b>`;
    }
    if (!prompt) {
      const t = nearestTruck();
      if (t) prompt = tr(t.free === 0 ? '{0} {1} to drive the {2}' : t.free === 1 ? '{0} {1} to ride in the {2}' : '{0} {1} to ride in the back of the {2}', tr(touchMode ? 'Tap' : 'Press'), KEY_USE, t.name);
    }
    if (!prompt) {
      const e = nearestRepairable();
      if (e) prompt = mySnap.rp > 0 ? `${tr('Rebuilding...')} ${'▮'.repeat(s.boards[e.id])}${'▯'.repeat(MAX_BOARDS - s.boards[e.id])}` : tr('Hold {0} to rebuild barricade', KEY_USE);
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
    if (Math.abs(me.pos.y - e.y) > 1.5) continue;
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

// ---------------------------------------------------------------- frame loop
const clock = new THREE.Timer();
let elapsed = 0;

// The round's twist (see roundTwist in shared/world.js): fog, bloated cows. Set by the wave
// event, and from the snapshot for anyone who joins mid-round.
let twist = '';
const BASE_FOG = world.scene.fog ? world.scene.fog.density : 0.0034;
function setTwist(t) {
  twist = t || '';
  COW_LOOK.bloat = twist === 'bomb';
}
function stepTwist(dt) {
  const f = world.scene.fog;
  if (!f) return;
  const want = twist === 'fog' ? FOG_DENSITY : BASE_FOG;
  f.density += (want - f.density) * Math.min(1, dt * 0.35);   // rolls in over a few seconds
}

function frame() {
  requestAnimationFrame(frame);
  clock.update();
  const rawDt = clock.getDelta();
  if (playing) adaptQuality(rawDt);
  const dt = Math.min(0.05, rawDt);
  elapsed += dt;

  if (playing) {
    view = net.sample();
    mySnap = net.latest?.playerMap.get(net.id) || null;
    syncTrucks(dt);
    stepLocal(dt);
    syncCows(dt);
    stepTwist(dt);
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
    if (p.m.position.y < p.floor + 0.05) { p.m.position.y = p.floor + 0.05; p.v.multiplyScalar(0.3); p.spin.multiplyScalar(0.2); }
    p.m.rotation.x += p.spin.x * dt; p.m.rotation.y += p.spin.y * dt; p.m.rotation.z += p.spin.z * dt;
    if (p.age > 6) { scene.remove(p.m); flyingPlanks.splice(i, 1); }
  }

  for (let i = flyingBottles.length - 1; i >= 0; i--) {
    const b = flyingBottles[i];
    b.t += dt;
    const k = Math.min(1, b.t / b.time);
    b.mesh.position.lerpVectors(b.from, b.to, k);
    b.mesh.position.y += Math.sin(k * Math.PI) * b.arc;
    b.mesh.rotation.x += dt * 9; b.mesh.rotation.z += dt * 4;
    if (k >= 1) { scene.remove(b.mesh); flyingBottles.splice(i, 1); }
  }

  machines.update(net.latest, dt, elapsed, fx);
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
  if (Math.hypot(s.x - me.pos.x, s.z - me.pos.z) > 4 && !dead && !ride) me.teleport(s.x, s.y, s.z);

  const sens = 0.0022 * (aiming ? 0.6 : 1);
  if (!dead) me.look(lookDX, lookDY, sens);
  const px = me.pos.x, pz = me.pos.z;
  const riding = ride && !downed && !dead;
  if (riding && driving) stepDriving(dt);
  else if (riding) { // passenger: carried along, free to look around and shoot
    truckViews.get(ride.id).seatWorld(ride.seat, me.pos);
    me.vel.set(0, 0, 0); me.speed = 0; me.grounded = true; me.sprinting = false;
  } else {
    me.update(dt, keys, { aiming, downed, canMove: active() && !dead, speedMul: myPerks().includes('stamin') ? 1.25 : 1 });
    // parked or passing trucks are solid
    for (const v of truckViews.values()) {
      if (me.pos.y - heightAt(me.pos.x, me.pos.z) > v.def.h - 0.3) continue;
      const out = pushOutOfVehicle(v, v.def, me.pos.x, me.pos.z, 0.38);
      if (out) { me.pos.x = out[0]; me.pos.z = out[1]; }
    }
  }
  // footsteps: one every stride while on the ground (tile indoors and on the porch, grass outside)
  if (me.grounded && !downed && !dead && !riding) {
    stepDist += Math.hypot(me.pos.x - px, me.pos.z - pz);
    const stride = me.sprinting ? 1.45 : me.crouching ? 0.7 : 1.0;
    if (stepDist > stride) {
      stepDist = 0;
      const tile = insideHouse(me.pos.x, me.pos.z, me.pos.y) || me.pos.y > 0.15 || (Math.abs(me.pos.x - HOUSE.x) < HOUSE.w / 2 + 1 && me.pos.z > HOUSE.z && me.pos.z < HOUSE.z + HOUSE.d / 2 + 4.8);
      if (!me.crouching) audio.step(tile);
    }
  } else stepDist = 0.6;
  if (keys.KeyC || keys.ControlLeft) { if (!me.crouchHeld) me.startCrouch(); me.crouchHeld = true; } else { me.crouchHeld = false; me.crouching = false; }

  // weapon + firing
  if (reloadT > 0) {
    reloadT -= dt;
    if (reloadT <= 0) { const am = ammo(), take = Math.min(W().mag - am.mag, am.res); am.mag += take; am.res -= take; }
  }
  // keep the loadout in sync with the server (e.g. after a restart)
  if (mySnap.w && mySnap.w.join() !== loadout.weapons.join()) { loadout.weapons = [...mySnap.w]; loadout.cur = Math.min(loadout.cur, loadout.weapons.length - 1); weapon.setGun(curId()); }
  const canShoot = alive() && active() && reloadT <= 0 && !me.sprinting && weapon.meleeT <= 0 && weapon.switchT <= 0 && !driving;
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
  } else if (riding && driving) {
    shake = Math.max(0, shake - dt * 4); // (the chase camera was placed by stepDriving)
  } else {
    shake = Math.max(0, shake - dt * 4);
    const bob = me.grounded ? Math.sin(weapon.bob) * 0.03 * Math.min(1, me.speed / 4) * (1 - weapon.aim * 0.8) : 0;
    // seated up front the eye is lower than standing; in the bed you stand
    const eye = riding ? (ride.seat < 2 ? CAB_EYE : 1.62) : me.eye;
    camera.position.set(me.pos.x, me.pos.y + eye - me.landDip + Math.abs(bob), me.pos.z);
    camera.rotation.set(
      Math.min(1.5, me.pitch + me.recoil) + (Math.random() - 0.5) * shake * 0.01,
      me.yaw + (Math.random() - 0.5) * shake * 0.01,
      downed ? 0.35 : Math.sin(weapon.bob * 0.5) * 0.004 * me.speed,
      'YXZ');
    weapon.root.visible = !downed;
  }
  const targetFov = driving ? 70 + Math.min(14, Math.abs(driving.speed) * 0.8) : aiming && !downed ? W().zoom : me.sprinting ? 80 : me.sliding ? 82 : 74;
  camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 12);
  camera.updateProjectionMatrix();

  weapon.update(dt, { aiming: aiming && !downed, moveSpeed: me.speed, sprinting: me.sprinting, lookDX, lookDY, time: elapsed, grounded: me.grounded });
  // light the arms/gun like the world around them: dim indoors, under roofs and in the jungle
  {
    let lit = 1;
    if (insideHouse(me.pos.x, me.pos.z, me.pos.y)) lit = 0.3;
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
  audio.setEnv(insideHouse(me.pos.x, me.pos.z, me.pos.y), shoreZ(me.pos.x) - me.pos.z);

  // low health heartbeat
  heartbeatT -= dt;
  if (alive() && s.hp < 35 && heartbeatT <= 0) { audio.heartbeat(); heartbeatT = 0.9; }

  // tell the server where we are
  if (elapsed - lastStateSend > 0.05 && !dead) {
    lastStateSend = elapsed;
    const st = { t: 'state', p: [r2(me.pos.x), r2(me.pos.y), r2(me.pos.z)], yaw: r2(me.yaw), pitch: r2(me.pitch), use: !!keys.KeyE && !ride };
    if (driving) st.v = [r2(driving.x), r2(driving.z), r3(driving.yaw), r2(driving.speed), r2(driving.steer)];
    net.send(st);
  }
}
const r2 = (v) => Math.round(v * 100) / 100;

// sounds and shakes the people-enemies ask for as they animate
const humanHooks = {
  swing(pos) { audio.swish([pos.x, pos.y + 1.2, pos.z]); },
  stomp(pos, hard, fell) {
    const d = pos.distanceTo(me.pos);
    audio.thud([pos.x, pos.y, pos.z], hard ? 1 : 0.5);
    if (d < 40) shake = Math.min(1.5, shake + (hard ? 0.9 : 0.35) * (1 - d / 40));
    if (hard) for (let i = 0; i < (fell ? 10 : 4); i++) fx.puff(pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * (fell ? 6 : 3), 0.3, (Math.random() - 0.5) * (fell ? 6 : 3))), 0xa89880, 3, 1.6);
  },
};

function syncCows(dt) {
  if (!view) return;
  for (const [id, c] of view.cows) {
    let v = cowViews.get(id);
    if (!v) {
      const type = COW_TYPE_LIST[c[5]];
      v = COW_TYPES[type].human ? new HumanView(id, type, scene, humanHooks) : new CowView(id, type, scene);
      cowViews.set(id, v);
    }
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
    // riders sit facing the way their truck points
    const truck = p.rd ? [...truckViews.values()].find(v => net.latest?.vehMap?.get(v.def.id)?.slice(6).includes(id)) : null;
    a.apply(p, dt, truck?.yaw);
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
  const cseen = new Set();
  for (const [id, x, y, z] of s.sh || []) { // coconuts in flight
    cseen.add(id);
    let v = shellViews.get(id);
    if (!v) { v = new THREE.Mesh(shellGeo, shellMat); v.scale.set(1, 1.15, 1); scene.add(v); shellViews.set(id, v); v.position.set(x, y, z); }
    v.position.lerp(tmpV.set(x, y, z), Math.min(1, dt * 20));
    v.rotation.x += dt * 12;
  }
  for (const [id, v] of shellViews) if (!cseen.has(id)) { scene.remove(v); shellViews.delete(id); }
}

function syncBoards() {
  const s = net.latest;
  if (!s) return;
  s.boards.forEach((n, i) => {
    if (n === boardsShown[i]) return;
    const list = world.boards[i];
    if (world.grilles?.[i]) world.grilles[i].visible = n > 0; // torn out with the last board
    if (world.leaves?.[i]) world.leaves[i].open = n === 0;     // and the glass doors burst in
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
  // engine: my own truck, or the nearest one that somebody is driving
  let eng = null;
  if (ride) { const v = truckViews.get(ride.id); eng = { speed: v.speed, d: 0, on: true }; }
  else for (const [id, v] of truckViews) {
    const occupied = (net.latest?.vehMap?.get(id)?.[6] || 0) !== 0;
    const d = Math.hypot(v.x - me.pos.x, v.z - me.pos.z);
    if (occupied && d < 70 && (!eng || d < eng.d)) eng = { speed: v.speed, d, on: true };
  }
  audio.engine(!!eng, eng ? Math.abs(eng.speed) : 0, eng ? Math.max(0.12, 1 - eng.d / 70) : 0);
  mooTimer -= dt;
  if (mooTimer <= 0) {
    const live = [...view.cows.entries()].filter(([, c]) => c[3] !== 2);
    // a moo every few seconds, a little more often with a big herd; nearer cows speak up more
    mooTimer = (2.2 + Math.random() * 3) / (1 + Math.min(live.length, 12) / 12);
    if (live.length) {
      const pick = () => live[Math.floor(Math.random() * live.length)][1];
      const a = pick(), b = pick();
      const d2 = (c) => (c[0] - me.pos.x) ** 2 + (c[1] - me.pos.z) ** 2;
      const c = d2(a) < d2(b) ? a : b;
      const type = COW_TYPE_LIST[c[5]];
      if (type === 'rafael') audio.bossRoar([c[0], 4, c[1]]);
      else if (type === 'local') audio.shout([c[0], 1.5, c[1]]);
      else audio.moo([c[0], 1.4, c[1]], type);
      // cows tearing at a window also bang on it
      if (c[3] === 3 && Math.random() < 0.6) audio.bang([c[0], 1.2, c[1]]);
    }
  }
}

frame();

// expose a little for automated testing / debugging
window.__rd = { machines, net, me, scene, camera, cowViews, renderer, CowView, COW_LOOK, HumanView, DogView, Avatar, weapon, world, vmScene, audio, fx, keys, truckViews, get driving() { return driving; }, get ride() { return ride; } };
