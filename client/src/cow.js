// Zombie Brahman cows: look + animation.
//
// The model is a generated Brahman (white, humped, droopy ears, dewlap) auto-rigged by
// tools/blender/rig_quadruped.py: root, spine, neck, head, tail and two bones per leg.
// Everything here is procedural so it costs almost nothing per cow:
//
//  * Locomotion: a gait engine (walk / trot / gallop with their real footfall orders)
//    plans a foot path per leg and solves two-bone IK, so planted hooves stay put on
//    the ground and the stride length always matches the speed (no skating).
//  * States (walk/attack/tear/vault/dead) each produce a full pose and are crossfaded,
//    with spring-driven hit flinches, hump/dewlap jiggle and ear flicks layered on top.
//  * The zombie look is a shader on the hide: mangy bald patches, dark veins, sickly
//    pallor and mud on the legs, plus glowing eyes that the bloom pass picks up.
//    Deliberately no open wounds or gore.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { COW_TYPES, heightAt } from '../../shared/world.js';
import * as T from './textures.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const frac = (x) => x - Math.floor(x);
const lerp = (a, b, k) => a + (b - a) * k;

// ---------------------------------------------------------------------------
// Shared materials / geometry
let shared = null;
function materials() {
  if (shared) return shared;
  shared = {
    hide: new THREE.MeshStandardMaterial({ map: T.brahmanHide(), roughness: 0.85 }),
    darkHide: new THREE.MeshStandardMaterial({ map: T.brahmanHide(), color: 0xa8a49a, roughness: 0.85 }),
    bone: new THREE.MeshStandardMaterial({ color: 0xc8bea4, roughness: 0.6 }),
    hoof: new THREE.MeshStandardMaterial({ color: 0x1a1612, roughness: 0.6 }),
    nose: new THREE.MeshStandardMaterial({ color: 0x4a3a3a, roughness: 0.5 }),
    eye: new THREE.MeshBasicMaterial({ color: new THREE.Color(16, 1.8, 0.2), toneMapped: false }), // far above the bloom threshold
    bull: new THREE.MeshStandardMaterial({ map: T.brahmanHide(), color: 0x8a8680, roughness: 0.8 }),
    switchHair: new THREE.MeshStandardMaterial({ color: 0x1c1a18, roughness: 1 }),
  };
  return shared;
}

const EYE_GEO = new THREE.SphereGeometry(0.035, 8, 6);

// ---------------------------------------------------------------------------
// Zombie hide. All the zombie detail (mange, veins, pallor, grime, mud, a ragged ear) is
// driven by the mesh's rest-pose position (metres, feet at y=0, nose toward +z), so it
// sticks to the hide. It is baked ONCE at load into a few texture variants by rendering
// the mesh in UV space, so in game the cows use a plain textured material: no noise is
// evaluated per pixel per frame. Only the cheap soft-body wobble (hump, dewlap, ears)
// and the hit flash stay in the live shader.
const HIDE_NOISE = /* glsl */`
float zh(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float zn(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(zh(i), zh(i + vec3(1, 0, 0)), f.x), mix(zh(i + vec3(0, 1, 0)), zh(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(zh(i + vec3(0, 0, 1)), zh(i + vec3(1, 0, 1)), f.x), mix(zh(i + vec3(0, 1, 1)), zh(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float zfbm(vec3 p) { return 0.55 * zn(p) + 0.3 * zn(p * 2.03 + 7.1) + 0.15 * zn(p * 4.1 + 3.3); }
`;
const BAKE_VERT = /* glsl */`
uniform vec2 uOff;
varying vec3 vObj;
varying vec2 vUv;
void main() { vObj = position; vUv = uv; gl_Position = vec4((uv + uOff) * 2.0 - 1.0, 0.0, 1.0); }
`;
const BAKE_FRAG = /* glsl */`
uniform sampler2D uMap, uOrm;
uniform vec3 uSeed;
uniform float uRagged, uRough;
varying vec3 vObj;
varying vec2 vUv;
${HIDE_NOISE}
void main() {
  vec3 col = texture2D(uMap, vUv).rgb; // sRGB texture: the GPU hands us linear colour
  vec3 zp = vObj + uSeed;
  // ragged notch out of one ear (alpha-tested away in game)
  float alpha = 1.0;
  if (uRagged > 0.5 && vObj.x < -0.27 && vObj.y > 1.24 && vObj.y < 1.6 && vObj.z > 1.36 && zn(zp * 9.0) > 0.58) alpha = 0.0;
  // mange: bald, greyish-pink patches where the white coat has fallen out, with a darker rim
  float m = zfbm(zp * 3.3) + 0.12 * zn(zp * 24.0);
  float body = smoothstep(0.42, 0.62, vObj.y);
  float mange = smoothstep(0.6, 0.64, m) * body;
  float rim = smoothstep(0.53, 0.59, m) * (1.0 - mange) * body;
  col *= 1.0 - 0.3 * rim;
  col = mix(col, vec3(0.4, 0.3, 0.28) * (0.7 + 0.5 * zn(zp * 31.0)), mange * 0.9);
  // sickly pallor: drained, faintly yellow-green
  float l = dot(col, vec3(0.3, 0.59, 0.11));
  col = mix(col, l * vec3(0.86, 0.95, 0.72), 0.5);
  // grime and caked dust, darker toward the belly
  col *= (0.62 + 0.42 * zfbm(zp * 1.6)) * (0.72 + 0.28 * smoothstep(0.55, 1.15, vObj.y));
  // dark veins, thickest around the bald patches and up the neck and face
  float v = abs(zn(zp * 10.0) - 0.5) + 0.35 * abs(zn(zp * 23.0) - 0.5);
  float veins = (1.0 - smoothstep(0.0, 0.055, v)) * clamp(0.25 + 0.75 * smoothstep(0.85, 1.35, vObj.z) + mange, 0.0, 1.0)
              * smoothstep(0.55, 0.85, vObj.y);
  col = mix(col, vec3(0.14, 0.1, 0.18), veins * 0.75);
  // mud: caked up the legs with a ragged line, splashes on the belly, wet near the hooves
  float mh = 0.44 + 0.2 * zn(zp * 4.6);
  float mud = 1.0 - smoothstep(mh - 0.07, mh + 0.05, vObj.y);
  mud = max(mud, smoothstep(0.64, 0.72, zn(zp * 7.5)) * (1.0 - smoothstep(0.6, 1.05, vObj.y)));
  float wet = 1.0 - smoothstep(0.04, 0.2, vObj.y);
  vec3 mudCol = mix(vec3(0.1, 0.065, 0.04), vec3(0.2, 0.14, 0.08), zn(zp * 13.0)) * (1.0 - 0.4 * wet);
  col = mix(col, mudCol, mud * 0.92);
  if (uRough > 0.5) {
    float r = 0.85 * texture2D(uOrm, vUv).g;
    r = mix(r, 0.97, mange * 0.8);
    r = mix(r, mix(0.9, 0.42, wet), mud);
    gl_FragColor = vec4(0.0, r, 0.0, 1.0);
  } else {
    gl_FragColor = vec4(col, alpha);
  }
}
`;

const HIDE_VERT_HEAD = /* glsl */`
uniform vec3 uHump, uDewlap;
uniform vec2 uEars;
`;
const HIDE_VERT_BODY = /* glsl */`
#include <begin_vertex>
{
  vec3 p = position;
  // the hump over the shoulders and the loose dewlap under the neck wobble on springs
  float hw = smoothstep(1.42, 1.66, p.y) * (1.0 - smoothstep(0.22, 0.5, abs(p.z - 0.72)));
  transformed += uHump * hw;
  float dw = (1.0 - smoothstep(0.86, 1.12, p.y)) * smoothstep(0.82, 1.0, p.z) * (1.0 - smoothstep(1.22, 1.36, p.z))
           * (1.0 - smoothstep(0.1, 0.2, abs(p.x)));
  transformed += uDewlap * dw;
  // long droopy ears hinge at the side of the skull
  float sx = p.x < 0.0 ? -1.0 : 1.0;
  float ew = smoothstep(0.15, 0.22, abs(p.x)) * smoothstep(1.18, 1.26, p.y) * (1.0 - smoothstep(1.58, 1.64, p.y))
           * smoothstep(1.32, 1.4, p.z) * (1.0 - smoothstep(1.7, 1.76, p.z));
  float a = (sx < 0.0 ? uEars.x : uEars.y) * sx * ew;
  vec2 piv = vec2(sx * 0.15, 1.43);
  vec2 d = transformed.xy - piv;
  float ca = cos(a), sa = sin(a);
  transformed.xy = piv + vec2(d.x * ca - d.y * sa, d.x * sa + d.y * ca);
}
`;

function zombieHide(mat, uniforms) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = HIDE_VERT_HEAD + sh.vertexShader.replace('#include <begin_vertex>', HIDE_VERT_BODY);
    sh.fragmentShader = 'uniform float uFlash;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(0.5, 0.03, 0.0) * uFlash;');
  };
  mat.customProgramCacheKey = () => 'zombie-hide-2'; // every cow shares one shader program
}

// Render the hide in UV space into a texture. Each pass is drawn nudged by a couple of
// texels in 8 directions first, then centred, which pads the UV islands so mip-mapping
// never pulls in the empty background along the seams.
function bakeHide(renderer, geo, map, orm, seed, ragged, rough, size) {
  const rt = new THREE.WebGLRenderTarget(size, size, {
    generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
    colorSpace: rough ? THREE.NoColorSpace : THREE.SRGBColorSpace, depthBuffer: false,
  });
  const mat = new THREE.ShaderMaterial({
    vertexShader: BAKE_VERT, fragmentShader: BAKE_FRAG, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    uniforms: {
      uMap: { value: map }, uOrm: { value: orm }, uSeed: { value: seed }, uRagged: { value: ragged ? 1 : 0 },
      uRough: { value: rough ? 1 : 0 }, uOff: { value: new THREE.Vector2() },
    },
  });
  const scene = new THREE.Scene(), cam = new THREE.Camera();
  const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false;
  scene.add(mesh);
  const prevRT = renderer.getRenderTarget(), prevAuto = renderer.autoClear;
  const prevClear = renderer.getClearColor(new THREE.Color()), prevAlpha = renderer.getClearAlpha();
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x000000, 0); renderer.clear();
  renderer.autoClear = false;
  const px = 2.5 / size;
  for (const [dx, dy] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1], [0, 0]]) {
    mat.uniforms.uOff.value.set(dx * px, dy * px);
    renderer.render(scene, cam);
  }
  renderer.autoClear = prevAuto;
  renderer.setRenderTarget(prevRT);
  renderer.setClearColor(prevClear, prevAlpha);
  mat.dispose();
  return rt.texture;
}

// ---------------------------------------------------------------------------
// The old primitive cow, kept as a fallback if the model can't load.
const G = {};
function geos() {
  if (G.body) return G;
  G.body = new THREE.CapsuleGeometry(0.58, 1.3, 6, 14).rotateX(Math.PI / 2);
  G.belly = new THREE.SphereGeometry(0.6, 14, 10);
  G.neck = new THREE.CylinderGeometry(0.28, 0.42, 0.7, 10);
  G.head = new THREE.BoxGeometry(0.36, 0.4, 0.68);
  G.snout = new THREE.BoxGeometry(0.32, 0.28, 0.2);
  G.hump = new THREE.SphereGeometry(0.42, 14, 10);
  G.dewlap = new THREE.SphereGeometry(0.4, 10, 8);
  G.longEar = new THREE.BoxGeometry(0.11, 0.04, 0.42).translate(0, 0, 0.19);
  G.switch = new THREE.ConeGeometry(0.07, 0.3, 6);
  G.jaw = new THREE.BoxGeometry(0.34, 0.1, 0.42);
  G.horn = new THREE.ConeGeometry(0.06, 0.38, 8);
  G.upperLeg = new THREE.CylinderGeometry(0.13, 0.1, 0.5, 8).translate(0, -0.25, 0);
  G.lowerLeg = new THREE.CylinderGeometry(0.09, 0.08, 0.42, 8).translate(0, -0.21, 0);
  G.hoof = new THREE.CylinderGeometry(0.1, 0.11, 0.1, 8);
  G.tail = new THREE.CylinderGeometry(0.03, 0.02, 0.7, 5).translate(0, -0.35, 0);
  return G;
}

export function buildCowModel(type) {
  const M = materials(), g = geos();
  const hideMat = type === 'bull' ? M.bull : type === 'runner' ? M.darkHide : M.hide;
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const torso = new THREE.Mesh(g.body, hideMat);
  torso.position.set(0, 1.05, 0);
  const belly = new THREE.Mesh(g.belly, hideMat);
  belly.position.set(0, 0.92, -0.1); belly.scale.set(1, 0.85, 1.4);
  const hump = new THREE.Mesh(g.hump, hideMat);
  hump.position.set(0, 1.55, 0.5); hump.scale.set(0.85, type === 'bull' ? 1.2 : 0.85, 1.05);
  const dewlap = new THREE.Mesh(g.dewlap, hideMat);
  dewlap.position.set(0, 0.92, 0.95); dewlap.scale.set(0.32, 0.85, 0.8);
  body.add(torso, belly, hump, dewlap);

  const neckPivot = new THREE.Group();
  neckPivot.position.set(0, 1.25, 0.75);
  body.add(neckPivot);
  const neck = new THREE.Mesh(g.neck, hideMat);
  neck.rotation.x = 1.0; neck.position.set(0, 0.05, 0.2);
  neckPivot.add(neck);
  const head = new THREE.Group();
  head.position.set(0, 0.12, 0.55);
  neckPivot.add(head);
  head.add(new THREE.Mesh(g.head, hideMat));
  const snout = new THREE.Mesh(g.snout, M.nose);
  snout.position.set(0, -0.08, 0.38);
  const jaw = new THREE.Mesh(g.jaw, M.nose);
  jaw.position.set(0, -0.26, 0.3);
  head.add(snout, jaw);
  for (const sx of [-1, 1]) {
    const horn = new THREE.Mesh(g.horn, M.bone);
    horn.position.set(sx * 0.17, 0.24, -0.22);
    horn.rotation.set(-0.5, 0, -sx * (type === 'bull' ? 0.5 : 0.25));
    const ear = new THREE.Mesh(g.longEar, hideMat);
    ear.position.set(sx * 0.2, 0.1, -0.18);
    ear.rotation.set(1.25, sx * 0.35, sx * 0.25);
    const eye = new THREE.Mesh(EYE_GEO, M.eye);
    eye.position.set(sx * 0.2, 0.06, 0.17); eye.scale.setScalar(1.6);
    head.add(horn, ear, eye);
  }
  const legs = [];
  for (const [lx, lz] of [[-0.3, 0.6], [0.3, 0.6], [-0.3, -0.65], [0.3, -0.65]]) {
    const hip = new THREE.Group();
    hip.position.set(lx, 0.95, lz);
    hip.add(new THREE.Mesh(g.upperLeg, hideMat));
    const knee = new THREE.Group();
    knee.position.y = -0.5;
    hip.add(knee);
    knee.add(new THREE.Mesh(g.lowerLeg, hideMat));
    const hoof = new THREE.Mesh(g.hoof, M.hoof);
    hoof.position.y = -0.44;
    knee.add(hoof);
    body.add(hip);
    legs.push({ hip, knee });
  }
  const tail = new THREE.Mesh(g.tail, hideMat);
  tail.position.set(0, 1.35, -1.25); tail.rotation.x = 0.3;
  const sw = new THREE.Mesh(g.switch, M.switchHair);
  sw.position.y = -0.75; sw.rotation.x = Math.PI;
  tail.add(sw);
  body.add(tail);
  root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
  return { root, body, neckPivot, head, legs, tail, hideMat };
}

// ---------------------------------------------------------------------------
// The real model
let ASSET = null;
const HIDE_VARIANTS = 3;
export async function loadCowAsset(renderer) {
  try {
    const gltf = await new GLTFLoader().loadAsync('/assets/models/brahman/brahman.glb');
    const meta = await (await fetch('/assets/models/brahman/brahman.json')).json();
    const hides = [];
    gltf.scene.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = true; o.receiveShadow = true;
      const m = o.material;
      if (m.map?.image) m.map = T.zombify(m.map.image);
      m.roughness = 0.85; m.metalness = 0;
      if (!renderer || !m.map) return;
      // a few differently-patterned zombie hides; every cow picks one at random
      const size = Math.min(1024, renderer.capabilities.maxTextureSize);
      for (let i = 0; i < HIDE_VARIANTS; i++) {
        const seed = new THREE.Vector3(i * 7.31 + 0.4, i * 3.17 + 1.3, i * 5.53 + 2.1);
        const map = bakeHide(renderer, o.geometry, m.map, m.roughnessMap || m.map, seed, i !== 1, false, size);
        const rough = m.roughnessMap ? bakeHide(renderer, o.geometry, m.map, m.roughnessMap, seed, false, true, size / 2) : null;
        hides.push({ map, rough });
      }
    });
    ASSET = { scene: gltf.scene, meta, hides };
  } catch (e) {
    console.warn('Brahman model failed to load; using the simple cow.', e);
  }
}

// The game camera's position, picked up as the cows are drawn (used to drop shadows and
// fine motion on far-away cows).
const CAM = new THREE.Vector3(0, 0, 0);
let camSeen = false;
function noteCamera(renderer, scene, camera) { if (camera.isPerspectiveCamera) { CAM.setFromMatrixPosition(camera.matrixWorld); camSeen = true; } }

// Rig measurements (model metres, from the skeleton in brahman.glb)
const HIP_Y = 1.061;               // hip/shoulder joint height
const L1 = 0.531, L2 = 0.53;       // upper and lower leg (to the sole)
const LEGS = [                      // name, hip x, hip z, front?
  ['FL', -0.14, 0.725, true], ['FR', 0.14, 0.725, true],
  ['BL', -0.136, -0.599, false], ['BR', 0.135, -0.599, false],
];

const TINT = { walker: 0xd8d4c8, runner: 0xc4bfb2, bull: 0x8a857e };
const qTmp = new THREE.Quaternion(), eTmp = new THREE.Euler();

class BrahmanRig {
  constructor(type) {
    const M = materials();
    const s = COW_TYPES[type].scale;
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    this.model = SkeletonUtils.clone(ASSET.scene);
    this.model.scale.setScalar(s);
    this.body.add(this.model);
    this.uniforms = {
      uFlash: { value: 0 },
      uHump: { value: new THREE.Vector3() }, uDewlap: { value: new THREE.Vector3() }, uEars: { value: new THREE.Vector2() },
    };
    const hide = ASSET.hides.length ? ASSET.hides[Math.floor(Math.random() * ASSET.hides.length)] : null;
    this.mats = [];
    this.meshes = [];
    this.model.traverse(o => {
      if (!o.isMesh) return;
      o.material = o.material.clone();
      o.material.color.set(TINT[type]);
      if (hide) {
        o.material.map = hide.map;
        o.material.alphaTest = 0.5; // the ragged ear notch
        if (hide.rough) { o.material.roughnessMap = hide.rough; o.material.roughness = 1; }
        o.material.metalnessMap = null;
      }
      zombieHide(o.material, this.uniforms);
      this.mats.push(o.material);
      this.meshes.push(o);
      // a fixed bound around the animated cow, so off-screen cows are culled
      o.frustumCulled = true;
      o.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0.2), 2.3);
      o.onBeforeRender = noteCamera;
    });
    this.bones = {};
    this.model.traverse(o => { if (o.isBone) this.bones[o.name] = { bone: o, rest: o.quaternion.clone() }; });
    // glowing eyes ride on the head bone; they are far brighter than the bloom threshold
    const head = this.bones.head?.bone;
    if (head) {
      this.model.updateMatrixWorld(true);
      const meta = ASSET.meta;
      const hx = meta.head[0], hy = meta.head[1] + 0.05, hz = meta.head[2] + 0.08;
      for (const sx of [-1, 1]) {
        const wp = this.model.localToWorld(new THREE.Vector3(hx + sx * 0.13, hy, hz));
        const eye = new THREE.Mesh(EYE_GEO, M.eye);
        head.add(eye);
        eye.position.copy(head.worldToLocal(wp));
        eye.scale.setScalar(1.25 / s);
      }
    }
  }
  set(name, x = 0, y = 0, z = 0) {
    const b = this.bones[name];
    if (!b) return;
    b.bone.quaternion.copy(b.rest).multiply(qTmp.setFromEuler(eTmp.set(x, y, z)));
  }
  flash(v) { this.uniforms.uFlash.value = v; }
  soft(hump, dewlap, earL, earR) {
    this.uniforms.uHump.value.copy(hump);
    this.uniforms.uDewlap.value.copy(dewlap);
    this.uniforms.uEars.value.set(earL, earR);
  }
  shadows(on) { for (const m of this.meshes) m.castShadow = on; }
  dispose() { for (const m of this.mats) m.dispose(); }
}

class SimpleRig {
  constructor(type) {
    const m = buildCowModel(type);
    Object.assign(this, { root: m.root, body: m.body, m });
    this.mat = m.hideMat.clone();
    m.root.traverse(o => { if (o.isMesh && o.material === m.hideMat) o.material = this.mat; });
    m.body.scale.setScalar(COW_TYPES[type].scale);
  }
  set(name, x = 0, y = 0, z = 0) {
    const { m } = this;
    const legIdx = { FL: 0, FR: 1, BL: 2, BR: 3 };
    const lm = name.match(/^leg_(\w\w)_(up|lo)$/);
    if (lm) { const l = m.legs[legIdx[lm[1]]]; (lm[2] === 'up' ? l.hip : l.knee).rotation.x = -x; return; }
    if (name === 'neck') m.neckPivot.rotation.set(x, -z, y);
    if (name === 'head') m.head.rotation.x = x;
    if (name === 'tail') m.tail.rotation.set(0.3 - x, 0, z);
  }
  flash(v) { this.mat.emissive.setRGB(v * 0.6, 0, 0); }
  soft() {}
  shadows() {}
  dispose() { this.mat.dispose(); }
}

// ---------------------------------------------------------------------------
// Pose channels. Every state writes a full pose; poses are crossfaded by state weight.
const BY = 0, BX = 1, BZ = 2, PITCH = 3, ROLL = 4, YAW = 5;   // body offset (model m) and rotation
const NX = 6, NY = 7, NZ = 8;                                  // neck pitch (+down), yaw (+left), roll
const HX = 9, HY = 10, HZ = 11;                                // head pitch, yaw, roll
const TX = 12, TZ = 13;                                        // tail lift, swish
const LEG = 14;                                                // 4 x (upper, lower) bone angles
const ABD = 22;                                                // 4 x leg sideways lean (bone z)
const NCH = 26;

// Gaits: footfall phase per leg [FL, FR, BL, BR], duty factor (share of the cycle a hoof
// is on the ground), cadence (cycles/s at model speed v'), stride cap, hoof lift.
const GAITS = [
  { off: [0.25, 0.75, 0.0, 0.5], duty: 0.64, f0: 0.7, f1: 0.32, smax: 0.72, lift: 0.13 },  // walk (4-beat lateral)
  { off: [0.0, 0.5, 0.5, 0.0], duty: 0.46, f0: 1.2, f1: 0.16, smax: 0.74, lift: 0.17 },     // trot (diagonal pairs)
  { off: [0.52, 0.62, 0.0, 0.1], duty: 0.32, f0: 1.65, f1: 0.09, smax: 0.8, lift: 0.24 }, // gallop (rotary)
];
// Character per cow type: gait thresholds (model speed), how it carries itself.
const STYLE = {
  walker: { walkTo: 1.7, gallopAt: 9, headLow: 0.22, lurch: 1.0, bounce: 0.035, stomp: 0.02, limp: true, frantic: 0 },
  runner: { walkTo: 1.2, gallopAt: 4.6, headLow: 0.1, lurch: 0.35, bounce: 0.05, stomp: 0.015, limp: false, frantic: 1 },
  bull: { walkTo: 2.8, gallopAt: 9, headLow: 0.32, lurch: 0.25, bounce: 0.02, stomp: 0.06, limp: false, frantic: 0 },
};

// Damped spring (for flinches and soft-body wobble)
class Spring {
  constructor(w = 16, z = 0.3) { this.x = 0; this.v = 0; this.w = w; this.z = z; }
  step(dt, target = 0) {
    const n = Math.max(1, Math.ceil(dt / 0.012)), h = dt / n;
    for (let i = 0; i < n; i++) {
      const a = -this.w * this.w * (this.x - target) - 2 * this.z * this.w * this.v;
      this.v += a * h; this.x += this.v * h;
    }
    return this.x;
  }
  kick(v) { this.v += v; }
}

const tmpHump = new THREE.Vector3(), tmpDew = new THREE.Vector3();
const HIP = [0, 0, 0], FZ = [0, 0, 0, 0], FY = [0, 0, 0, 0];
const STATE_N = 5;

// One cow on screen. `apply` takes the interpolated server state each frame:
// [x, z, yaw, state(0 walk,1 attack,2 dead,3 tear,4 vault), y, type, hp%]
export class CowView {
  constructor(id, type, scene) {
    this.id = id;
    this.type = type;
    this.style = STYLE[type] || STYLE.walker;
    this.rig = ASSET ? new BrahmanRig(type) : new SimpleRig(type);
    this.root = this.rig.root;
    this.body = this.rig.body;
    this.scene = scene;
    scene.add(this.root);
    const r = Math.random;
    this.seed = r() * 100;
    this.cycle = r();
    this.limpLeg = r() < 0.7 ? 2 + (r() < 0.5 ? 0 : 1) : (r() < 0.5 ? 0 : 1); // usually a hind leg
    this.limp = this.style.limp ? 0.55 + r() * 0.45 : 0.15 * r();
    this.tilt = (r() - 0.5) * 0.5;          // permanent head cock
    this.gaitW = [1, 0, 0];
    this.speed = 0;
    this.yawRate = 0;
    this.lastPos = null;
    this.lastYaw = null;
    this.state = 0;
    this.stateT = 0;
    this.w = new Float32Array(STATE_N); this.w[0] = 1;
    this.pose = new Float32Array(NCH);
    this.tmp = new Float32Array(NCH);
    this.prevU = new Float32Array(4);
    this.impact = 0;
    this.flashV = 0;
    this.deathT = 0;
    this.deathSide = r() < 0.5 ? -1 : 1;
    this.attackT = 0;
    // springs: hit flinch (pitch, roll, neck yaw, neck pitch, shove), soft tissue
    this.fPitch = new Spring(14, 0.32); this.fRoll = new Spring(13, 0.3);
    this.fNeckY = new Spring(16, 0.28); this.fNeckX = new Spring(16, 0.3); this.fShove = new Spring(11, 0.45);
    this.humpY = new Spring(22, 0.18); this.humpX = new Spring(20, 0.2);
    this.dewY = new Spring(17, 0.15); this.dewX = new Spring(15, 0.15);
    this.ears = [new Spring(30, 0.25), new Spring(30, 0.25)];
    this.earTimer = 1 + r() * 4;
    this.twitchTimer = 1 + r() * 3;
    this.prevBody = [0, 0];           // body height / roll last frame (soft-body drive)
    this.prevBodyV = [0, 0];
  }

  apply(s, dt, t) {
    dt = Math.min(dt, 0.05);
    this._dt = dt;
    const { root, body } = this;
    const [x, z, yaw, state, y] = s;
    const sc = COW_TYPES[this.type].scale;

    // measured ground speed along the facing direction, and turn rate
    if (this.lastPos && dt > 0) {
      const vx = (x - this.lastPos[0]) / dt, vz = (z - this.lastPos[1]) / dt;
      const fwd = vx * Math.sin(yaw) + vz * Math.cos(yaw);
      this.speed += (clamp(fwd, -3, 9) - this.speed) * Math.min(1, dt * 7);
      let dy = yaw - this.lastYaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      this.yawRate += (clamp(dy / dt, -6, 6) - this.yawRate) * Math.min(1, dt * 6);
    }
    this.lastPos = [x, z]; this.lastYaw = yaw;
    root.position.set(x, (y || 0) + heightAt(x, z), z);
    root.rotation.y = yaw;

    // level of detail: far cows drop their shadow, skip the soft-body wobble, and pose
    // every other frame (their position still updates every frame, so nothing stutters)
    const far2 = camSeen ? root.position.distanceToSquared(CAM) : 0;
    const shadowOn = far2 < 45 * 45;
    if (shadowOn !== this.shadowOn) { this.rig.shadows(shadowOn); this.shadowOn = shadowOn; }
    this.near = far2 < 30 * 30;
    if (far2 > 55 * 55 && state === this.state) {
      this.skipDt = (this.skipDt || 0) + dt;
      if ((this.tick = (this.tick || 0) + 1) % 2) return;
      dt = this.skipDt;
    }
    this.skipDt = 0;

    // state crossfade
    if (state !== this.state) { this.prevState = this.state; this.state = state; this.stateT = 0; if (state === 1) this.attackT = 0.4 * this.attackPeriod(); }
    this.stateT += dt;
    const rate = state === 2 ? 7 : 5;
    let sum = 0;
    for (let i = 0; i < STATE_N; i++) { this.w[i] += ((i === state ? 1 : 0) - this.w[i]) * Math.min(1, dt * rate); sum += this.w[i]; }

    const P = this.pose; P.fill(0);
    const v = this.speed / sc; // model-space speed
    this.advanceGait(v, dt, sc);
    for (let i = 0; i < STATE_N; i++) {
      const wi = this.w[i] / sum;
      if (wi < 0.002) continue;
      const Q = this.tmp; Q.fill(0);
      if (i === 0) this.poseLoco(Q, v, t);
      else if (i === 1) this.poseAttack(Q, dt, t);
      else if (i === 2) this.poseDead(Q, dt);
      else if (i === 3) this.poseTear(Q, t);
      else this.poseVault(Q);
      for (let c = 0; c < NCH; c++) P[c] += Q[c] * wi;
    }
    if (state !== 2) this.deathT = 0;

    // additive layers: flinch springs and zombie twitches
    const alive = 1 - this.w[2];
    const fp = this.fPitch.step(dt), fr = this.fRoll.step(dt), fs = this.fShove.step(dt);
    const fny = this.fNeckY.step(dt), fnx = this.fNeckX.step(dt);
    this.twitchTimer -= dt;
    if (this.twitchTimer < 0 && alive > 0.5) {
      this.twitchTimer = 0.8 + Math.random() * 3.5;
      this.fNeckY.kick((Math.random() - 0.5) * 7); this.fNeckX.kick((Math.random() - 0.3) * 4);
    }
    P[PITCH] += fp * alive; P[ROLL] += fr * alive; P[BZ] += fs * alive;
    P[NY] += fny; P[NX] += fnx; P[HZ] += fny * 0.5;

    // write to the rig
    body.position.set(P[BX] * sc, P[BY] * sc, P[BZ] * sc);
    body.rotation.set(P[PITCH], P[YAW], P[ROLL]);
    const rig = this.rig;
    rig.set('neck', P[NX], P[NZ], -P[NY]);
    rig.set('head', P[HX], P[HZ], -P[HY]);
    rig.set('tail', P[TX], 0, P[TZ]);
    for (let l = 0; l < 4; l++) {
      rig.set(`leg_${LEGS[l][0]}_up`, P[LEG + l * 2], 0, P[ABD + l]);
      rig.set(`leg_${LEGS[l][0]}_lo`, P[LEG + l * 2 + 1]);
    }

    this.flashV = Math.max(0, this.flashV - dt * 6);
    rig.flash(this.flashV);
    if (!this.near) return;

    // soft tissue: the hump and dewlap lag behind body bounce and sway, ears flick
    const ay = (P[BY] - this.prevBody[0]) / Math.max(dt, 1e-3), ar = (P[ROLL] - this.prevBody[1]) / Math.max(dt, 1e-3);
    const accY = (ay - this.prevBodyV[0]) / Math.max(dt, 1e-3), accR = (ar - this.prevBodyV[1]) / Math.max(dt, 1e-3);
    this.prevBody[0] = P[BY]; this.prevBody[1] = P[ROLL]; this.prevBodyV[0] = ay; this.prevBodyV[1] = ar;
    const hy = this.humpY.step(dt, clamp(-accY * 0.0035, -0.06, 0.06));
    const hx = this.humpX.step(dt, clamp(-accR * 0.004 - this.yawRate * 0.01, -0.06, 0.06));
    const dy = this.dewY.step(dt, clamp(-accY * 0.006, -0.08, 0.08));
    const dx = this.dewX.step(dt, clamp(accR * 0.01 + P[NY] * 0.05, -0.1, 0.1));
    this.earTimer -= dt;
    if (this.earTimer < 0 && alive > 0.5) {
      this.earTimer = 0.6 + Math.random() * (this.state === 0 ? 3 : 1.5);
      this.ears[Math.random() < 0.5 ? 0 : 1].kick(7 + Math.random() * 6);
    }
    const droop = -0.15 * this.w[2]; // ears go limp in death
    const eL = this.ears[0].step(dt, droop + accY * 0.0008), eR = this.ears[1].step(dt, droop + accY * 0.0008);
    rig.soft(tmpHump.set(hx, hy, 0), tmpDew.set(dx, dy, dy * 0.3), eL, eR);
  }

  // Advance the stride cycle at a cadence that matches the ground speed.
  advanceGait(v, dt, sc) {
    const st = this.style, av = Math.abs(v);
    const tw = smooth(st.walkTo * 0.8, st.walkTo * 1.15, av), gw = smooth(st.gallopAt * 0.85, st.gallopAt * 1.1, av);
    const target = [1 - tw, tw * (1 - gw), gw];
    for (let i = 0; i < 3; i++) this.gaitW[i] += (target[i] - this.gaitW[i]) * Math.min(1, dt * 4);
    let f = 0;
    for (let i = 0; i < 3; i++) {
      const g = GAITS[i];
      // natural cadence, but never so slow that the stride would overreach (feet would skate)
      const fi = Math.max((g.f0 + g.f1 * av) / Math.sqrt(sc), (av * g.duty) / g.smax);
      f += fi * this.gaitW[i];
    }
    f *= 1 + this.style.frantic * 0.08;
    this.freq = f;
    this.cycle = frac(this.cycle + f * dt * Math.sign(v || 1));
  }

  // Foot path for one leg in one gait: returns [forward offset, lift] (model m)
  foot(g, u, stride, lift) {
    if (u < g.duty) return [stride * (0.5 - u / g.duty), 0];
    const s = (u - g.duty) / (1 - g.duty);
    // the hoof eases from still to still *in the world* (it leaves and lands without
    // sliding), so relative to the moving body it starts and ends at body speed
    const e = s * s * s * (s * (s * 6 - 15) + 10); // smootherstep
    const W = stride / g.duty;                     // ground covered per stride cycle
    return [stride * -0.5 + W * (e - (1 - g.duty) * s), lift * Math.pow(Math.sin(Math.PI * s), 0.8)];
  }

  // Where a hip/shoulder joint is in the ground frame (model m), for the body pose in Q.
  // Body rotation is an XYZ euler: roll, then yaw, then pitch.
  hipAt(Q, l, out) {
    const hx = LEGS[l][1], hz = LEGS[l][2];
    const cr = Math.cos(Q[ROLL]), sr = Math.sin(Q[ROLL]), cw = Math.cos(Q[YAW]), sw = Math.sin(Q[YAW]);
    const cp = Math.cos(Q[PITCH]), sp = Math.sin(Q[PITCH]);
    const x1 = hx * cr - HIP_Y * sr, y1 = hx * sr + HIP_Y * cr;
    const x2 = x1 * cw + hz * sw, z2 = -x1 * sw + hz * cw;
    out[0] = x2 + Q[BX]; out[1] = y1 * cp - z2 * sp + Q[BY]; out[2] = y1 * sp + z2 * cp + Q[BZ];
    return out;
  }

  // Two-bone leg IK. Foot target in the ground frame (model m, relative to the root),
  // directly under the hip's rest position sideways. Writes the upper/lower bend and the
  // sideways lean of the leg (so hooves stay planted while the body rolls and sways).
  ik(Q, l, fz, fy) {
    const front = LEGS[l][3];
    const h = this.hipAt(Q, l, HIP);
    let dx = LEGS[l][1] - h[0], dy = fy - h[1], dz = fz - h[2];
    // into the body frame: undo pitch, then yaw, then roll
    const cp = Math.cos(Q[PITCH]), sp = Math.sin(Q[PITCH]);
    let t = dy * cp + dz * sp; dz = -dy * sp + dz * cp; dy = t;
    const cw = Math.cos(Q[YAW]), sw = Math.sin(Q[YAW]);
    t = dx * cw - dz * sw; dz = dx * sw + dz * cw; dx = t;
    const cr = Math.cos(Q[ROLL]), sr = Math.sin(Q[ROLL]);
    t = dx * cr + dy * sr; dy = -dx * sr + dy * cr; dx = t;
    const lean = Math.atan2(dx, -dy);
    dy = -Math.hypot(dx, dy);
    const D = clamp(Math.hypot(dy, dz), 0.25, (L1 + L2) * 0.999);
    const phi = Math.atan2(dz, -dy);
    const a = Math.acos(clamp((L1 * L1 + D * D - L2 * L2) / (2 * L1 * D), -1, 1));
    const bend = Math.PI - Math.acos(clamp((L1 * L1 + L2 * L2 - D * D) / (2 * L1 * L2), -1, 1));
    if (front) { Q[LEG + l * 2] = -(phi + a); Q[LEG + l * 2 + 1] = bend; }   // knee (carpus) bends back
    else { Q[LEG + l * 2] = -(phi - a); Q[LEG + l * 2 + 1] = -bend; }       // hock points back
    Q[ABD + l] = -lean;
  }

  // Lower the body just enough that every hoof on the ground can still reach it.
  settle(Q, fz, fy) {
    const R = (L1 + L2) * 0.985;
    let ex = 0;
    for (let l = 0; l < 4; l++) {
      if (fy[l] > 0.02) continue;
      const h = this.hipAt(Q, l, HIP);
      const dx = LEGS[l][1] - h[0], dz = fz[l] - h[2];
      const need = Math.sqrt(Math.max(0, R * R - dx * dx - dz * dz));
      ex = Math.max(ex, h[1] - fy[l] - need);
    }
    Q[BY] -= ex;
  }

  // Stand with all four hooves planted where they are, whatever the body does.
  plant(Q, spreadF = 0, spreadB = 0) {
    for (let l = 0; l < 4; l++) this.ik(Q, l, LEGS[l][2] + (LEGS[l][3] ? spreadF : -spreadB), 0);
  }

  poseLoco(Q, v, t) {
    const st = this.style;
    const av = Math.abs(v), moving = smooth(0.05, 0.6, av);
    const c = this.cycle, f = this.freq || 1;
    const id = this.seed;
    const gw = this.gaitW;
    const gallop = gw[2];

    // body: bounce twice a stride (once in the gallop), roll with the stepping legs,
    // lurch side to side, lean into turns, nose down a touch when moving fast
    const bob2 = Math.cos(c * TAU * 2);
    Q[BY] = -(0.05 + 0.03 * gallop) * moving - st.bounce * moving * lerp(0.5 + 0.5 * bob2, 0.5 + 0.5 * Math.cos((c - 0.15) * TAU), gallop);
    Q[ROLL] = Math.sin(c * TAU) * (0.035 + 0.04 * st.lurch) * moving * (1 - gallop) - this.yawRate * 0.05 * moving;
    Q[YAW] = Math.sin(c * TAU + 0.6) * 0.045 * st.lurch * moving;
    Q[PITCH] = 0.03 * moving + gallop * Math.sin((c + 0.1) * TAU) * 0.075 * moving;
    // idle: slow breathing and weight shifts
    const idle = 1 - moving;
    Q[BY] += idle * Math.sin(t * 1.6 + id) * 0.006;
    Q[ROLL] += idle * Math.sin(t * 0.35 + id) * 0.02;

    // footfalls: a short jolt each time a hoof lands (heavy on the bull)
    const g0 = GAITS[gw[0] > gw[1] ? (gw[0] > gw[2] ? 0 : 2) : (gw[1] > gw[2] ? 1 : 2)];
    for (let l = 0; l < 4; l++) {
      const u = frac(c + g0.off[l]);
      if (u < this.prevU[l] && moving > 0.3) this.impact += st.stomp * (l === this.limpLeg ? 1 + this.limp : 1);
      this.prevU[l] = u;
    }
    this.impact *= Math.exp(-(this._dt || 1 / 60) * 14);
    Q[BY] -= this.impact;

    // the limp: the body drops and rolls toward the bad leg while it bears weight
    if (this.limp > 0.05) {
      let bad = 0;
      for (let i = 0; i < 3; i++) {
        const g = GAITS[i], u = frac(c + g.off[this.limpLeg]);
        bad += gw[i] * (u < g.duty ? Math.sin(Math.PI * u / g.duty) : 0);
      }
      bad *= this.limp * moving;
      Q[BY] -= bad * 0.045;
      Q[ROLL] += bad * 0.07 * (LEGS[this.limpLeg][1] < 0 ? -1 : 1);
      Q[PITCH] += bad * 0.04 * (LEGS[this.limpLeg][3] ? 1 : -1);
    }

    // legs: per-gait foot paths, blended, then IK
    const strideOf = (g) => (av * g.duty) / f;
    for (let l = 0; l < 4; l++) {
      let fz = 0, fy = 0;
      for (let i = 0; i < 3; i++) {
        if (gw[i] < 0.002) continue;
        const g = GAITS[i];
        let lift = g.lift * smooth(0, 0.35, strideOf(g));
        if (l === this.limpLeg) lift *= 1 - 0.7 * this.limp; // the bad leg barely lifts: hoof drags
        const [dz, ly] = this.foot(g, frac(c + g.off[l]), strideOf(g), lift);
        fz += dz * gw[i] * Math.sign(v || 1); fy += ly * gw[i];
      }
      FZ[l] = LEGS[l][2] + fz; FY[l] = fy;
    }
    this.settle(Q, FZ, FY);
    for (let l = 0; l < 4; l++) {
      this.ik(Q, l, FZ[l], FY[l]);
      // legs splay a touch; swinging legs flick outward on the frantic runner
      Q[ABD + l] += (0.03 + st.frantic * 0.2 * FY[l]) * (LEGS[l][1] < 0 ? 1 : -1);
    }

    // head: low and lolling, bobbing with the front footfalls, an odd cocked angle
    const nod = Math.sin((c + 0.1) * TAU * 2) * 0.07 * moving;
    Q[NX] = st.headLow + 0.06 * moving + nod + gallop * Math.sin((c + 0.35) * TAU) * 0.12 + idle * (0.12 + Math.sin(t * 0.4 + id) * 0.1);
    Q[NY] = Math.sin(t * 0.6 + id) * 0.18 * (0.4 + idle) + Math.sin(c * TAU) * 0.06 * st.lurch * moving + this.yawRate * 0.12;
    Q[NZ] = this.tilt * 0.6 + Math.sin(c * TAU + 1) * 0.08 * st.lurch * moving;
    Q[HX] = 0.05 - nod * 0.6;
    Q[HZ] = this.tilt * 0.4;
    if (st.frantic) { // runners thrash their heads
      Q[NY] += Math.sin(t * 9.3 + id) * 0.12 * moving;
      Q[HZ] += Math.sin(t * 7.1 + id * 2) * 0.15 * moving;
    }
    // tail: lazy swish, held out stiff at a gallop
    Q[TX] = 0.15 + gallop * 0.55 + moving * 0.1;
    Q[TZ] = Math.sin(t * 2.3 + id) * 0.32 * (1 - gallop * 0.6) + Math.sin(c * TAU) * 0.15 * moving;
  }

  attackPeriod() { return this.type === 'bull' ? 1.6 : 1.1; } // server attack cooldowns

  // Horn swing / head butt, timed to the server's swing cadence. The server lands the
  // first blow as soon as the cow is in reach, so the swing starts just before the lunge.
  poseAttack(Q, dt, t) {
    const st = this.style;
    const period = this.attackPeriod();
    this.attackT += dt;
    const a = frac(this.attackT / period);
    // 0-0.45 wind up (rear back, head high, paw), 0.45-0.58 lunge + hook, then recover
    const wind = smooth(0.0, 0.42, a) * (1 - smooth(0.45, 0.52, a));
    const strike = smooth(0.44, 0.53, a) * (1 - smooth(0.62, 0.95, a));
    const hook = Math.sin(clamp((a - 0.47) / 0.18, 0, 1) * Math.PI);
    const side = Math.sin(Math.floor(this.attackT / period) * 2.7 + this.seed) > 0 ? 1 : -1;
    Q[BZ] = -0.2 * wind + 0.32 * strike;
    Q[BY] = -0.02 + 0.05 * wind - 0.07 * strike;
    Q[PITCH] = -0.13 * wind + 0.14 * strike;
    Q[ROLL] = side * 0.05 * hook;
    Q[YAW] = -side * 0.06 * wind + side * 0.12 * hook;
    Q[NX] = st.headLow - 0.45 * wind + 0.95 * strike;
    Q[NY] = -side * 0.2 * wind + side * 0.55 * hook;
    Q[NZ] = side * 0.35 * hook + this.tilt * 0.3;
    Q[HX] = -0.15 * wind + 0.25 * strike;
    Q[HZ] = side * 0.3 * hook;
    Q[TX] = 0.3 + 0.3 * wind; Q[TZ] = Math.sin(t * 7 + this.seed) * 0.4;
    this.plant(Q, 0.05, 0.08);
    // paw the ground with a front hoof during the wind-up
    const paw = Math.max(0, Math.sin(a * TAU * 2.2)) * wind;
    if (paw > 0.01) {
      const l = side > 0 ? 0 : 1;
      this.ik(Q, l, LEGS[l][2] + 0.05 - 0.25 * paw, 0.18 * paw);
    }
  }

  // Tearing the boards off a window: rear up, batter with the front hooves, then grab
  // a board in the teeth and wrench it loose with a twist of the neck. Bulls ram instead.
  poseTear(Q, t) {
    const st = this.style, id = this.seed;
    const bull = this.type === 'bull';
    const tearT = COW_TYPES[this.type].tear;
    const k = smooth(0, 0.35, this.stateT);                  // ease into the rear
    if (bull) {
      const a = frac(this.stateT / Math.max(0.6, tearT * 2));
      const ram = Math.pow(Math.sin(Math.PI * smooth(0.55, 0.75, a)), 2);
      const back = smooth(0, 0.5, a) * (1 - smooth(0.55, 0.62, a));
      Q[BZ] = -0.18 * back + 0.25 * ram; Q[PITCH] = -0.05 * back + 0.08 * ram; Q[BY] = -0.04;
      Q[NX] = 0.55 + 0.25 * ram - 0.2 * back; Q[NY] = Math.sin(t * 3 + id) * 0.2; Q[NZ] = Math.sin(t * 5 + id) * 0.25 * ram;
      Q[HX] = 0.2;
      Q[TX] = 0.35; Q[TZ] = Math.sin(t * 6 + id) * 0.5;
      this.plant(Q, 0.1, 0.1);
      return;
    }
    const fast = this.type === 'runner' ? 1.35 : 1;
    const pa = t * 2.3 * TAU * 0.5 * fast + id;          // hoof batter cadence
    const yank = frac(this.stateT / tearT);               // one board per tear interval
    const grab = smooth(0.55, 0.72, yank) * (1 - smooth(0.78, 0.84, yank));
    const wrench = smooth(0.78, 0.88, yank) * (1 - smooth(0.92, 1.0, yank));
    const wside = Math.sin(Math.floor(this.stateT / tearT) * 1.9 + id) > 0 ? 1 : -1;
    const rear = k * (1 - 0.6 * grab);
    // the boards are ~1.95 m ahead of the tear spot: step in and rear up against them
    const zWall = 1.95 / COW_TYPES[this.type].scale;
    const lean = clamp(zWall - 1.5, 0, 0.7);
    Q[PITCH] = -0.3 * rear + 0.1 * grab - 0.12 * wrench + Math.sin(pa) * 0.03 * rear;
    Q[BY] = 0.14 * rear;
    Q[BZ] = lean * rear + 0.12 * grab - 0.22 * wrench;
    Q[ROLL] = Math.sin(pa) * 0.05 * rear + wside * 0.08 * wrench;
    Q[YAW] = wside * 0.12 * wrench;
    Q[NX] = 0.15 - 0.15 * rear + 0.55 * grab - 0.4 * wrench;
    Q[NY] = wside * 0.5 * wrench + Math.sin(t * 2 + id) * 0.1;
    Q[NZ] = wside * 0.55 * wrench + this.tilt * 0.4;
    Q[HX] = 0.2 * grab - 0.25 * wrench;
    Q[HZ] = wside * 0.3 * wrench;
    Q[TX] = 0.35 + 0.2 * wrench; Q[TZ] = Math.sin(t * 5 + id) * 0.45;
    // hind legs braced; front hooves hammer the boards in turn
    for (let l = 2; l < 4; l++) this.ik(Q, l, LEGS[l][2] - 0.06, 0);
    for (let l = 0; l < 2; l++) {
      const s = Math.sin(pa + l * Math.PI);
      const up = rear * (1 - grab * 0.8);
      const fz = lerp(LEGS[l][2] + 0.05, zWall - 0.16 - 0.12 * Math.max(0, -s), up);
      const fy = lerp(0, 0.75 + 0.35 * s, up);
      this.ik(Q, l, fz, fy);
    }
  }

  // Climbing in through a window: front up and over, tucked over the sill, reach down.
  poseVault(Q) {
    const dur = 1.1 * (this.type === 'runner' ? 0.7 : 1);
    const k = clamp(this.stateT / dur, 0, 1);
    const up = 1 - smooth(0.25, 0.55, k), over = Math.sin(Math.PI * smooth(0.15, 0.85, k)), down = smooth(0.5, 0.85, k);
    Q[PITCH] = -0.5 * up * smooth(0, 0.15, k) + 0.42 * down * (1 - smooth(0.9, 1, k));
    Q[BY] = 0.05 * over;
    Q[NX] = -0.15 * up + 0.25 * down + 0.1;
    Q[NY] = Math.sin(k * 9 + this.seed) * 0.1;
    Q[HX] = 0.1 * down;
    Q[TX] = 0.5 * over; Q[TZ] = Math.sin(k * 11) * 0.3;
    // front legs: tucked up while going over, then stretched down to land
    const tuckF = smooth(0.0, 0.2, k) * (1 - down);
    Q[LEG + 0] = Q[LEG + 2] = lerp(0, -1.15, tuckF) + lerp(0, -0.45, down);
    Q[LEG + 1] = Q[LEG + 3] = lerp(0, 1.9, tuckF) + lerp(0, 0.15, down);
    // hind legs: push off (extended back), then fold up under to clear the sill
    const push = smooth(0, 0.25, k) * (1 - smooth(0.3, 0.5, k)), tuckB = smooth(0.35, 0.6, k) * (1 - smooth(0.9, 1, k));
    Q[LEG + 4] = Q[LEG + 6] = 0.55 * push - 0.9 * tuckB;
    Q[LEG + 5] = Q[LEG + 7] = -0.2 * push - 1.6 * tuckB;
  }

  // Death: stagger, front knees buckle, hindquarters drop, then topple onto the side
  // with a heavy bounce, legs kick out stiff, and finally sink away.
  poseDead(Q, dt) {
    this.deathT += dt;
    const d = this.deathT, side = this.deathSide;
    const stag = Math.sin(Math.PI * clamp(d / 0.3, 0, 1));
    const kneel = smooth(0.12, 0.6, d);                  // front end drops
    const sit = smooth(0.4, 0.95, d);                    // back end drops
    const r = clamp((d - 0.85) / 0.55, 0, 1);            // topple
    const rollK = r <= 0 ? 0 : 1 + 2.4 * Math.pow(r - 1, 3) + 1.4 * Math.pow(r - 1, 2); // ease-out-back
    const bounce = d > 1.4 ? Math.exp(-(d - 1.4) * 6) * Math.sin((d - 1.4) * 22) * 0.06 : 0;
    const lie = smooth(0.85, 1.4, d);
    Q[ROLL] = side * (1.42 * rollK + bounce);
    Q[PITCH] = -0.12 * stag + 0.32 * kneel * (1 - sit * 0.85) - 0.05 * lie;
    // body height: kneel -> lying on the brisket -> resting on the flank
    Q[BY] = lerp(lerp(-0.04 * stag, -0.3, kneel) - 0.22 * sit, 0.33 - Math.cos(1.42 * rollK) * 0.98, lie);
    Q[BX] = side * 0.35 * lie;
    if (d > 5) Q[BY] -= (d - 5) * 0.5;                   // sink into the dirt once it's settled
    // legs: fold under while kneeling, then stick out stiff with a few dying kicks
    const kick = d > 1.5 ? Math.exp(-(d - 1.5) * 1.3) : 0;
    for (let l = 0; l < 4; l++) {
      const front = LEGS[l][3];
      const tw = kick * Math.sin(d * (11 + l * 3) + l * 2) * 0.35;
      const foldUp = front ? -0.7 * kneel : 0.75 * sit, foldLo = front ? 2.0 * kneel : -1.9 * sit;
      const outUp = (front ? -0.35 : 0.4) + tw + (l % 2) * (front ? -0.25 : 0.2);
      const outLo = (front ? 0.25 : -0.3) + tw * 0.6;
      Q[LEG + l * 2] = lerp(foldUp, outUp, lie);
      Q[LEG + l * 2 + 1] = lerp(foldLo, outLo, lie);
      Q[ABD + l] = 0.15 * lie * (LEGS[l][1] < 0 ? 1 : -1);
    }
    Q[NX] = -0.35 * stag + 0.25 * kneel + lie * 0.15;
    Q[NY] = side * 0.25 * lie;
    Q[NZ] = side * 0.5 * lie;
    Q[HX] = 0.2 * kneel - 0.2 * lie;
    Q[TX] = -0.1 * lie;
    Q[TZ] = Math.sin(d * 3) * 0.2 * (1 - lie);
  }

  // A hit: flash, and a flinch away from the shot (dir = bullet direction, world space).
  hit(dir) {
    this.flashV = 1;
    const k = this.type === 'bull' ? 0.35 : this.type === 'runner' ? 1.15 : 1;
    let fwd = -0.6, lat = (Math.random() - 0.5) * 1.4;
    if (dir) {
      const yaw = this.root.rotation.y, sy = Math.sin(yaw), cy = Math.cos(yaw);
      fwd = dir[0] * sy + dir[2] * cy;                     // + = shot pushes it backward from behind
      lat = dir[0] * cy - dir[2] * sy;                     // + = pushes toward the cow's left
    }
    this.fPitch.kick(-fwd * 1.6 * k);
    this.fRoll.kick(-lat * 3.0 * k);
    this.fShove.kick(fwd * 0.9 * k);
    this.fNeckY.kick(lat * 6 * k + (Math.random() - 0.5) * 3);
    this.fNeckX.kick(-3.5 * k);
    this.ears[0].kick(6); this.ears[1].kick(6);
  }

  dispose() {
    this.scene.remove(this.root);
    this.rig.dispose();
  }
}
