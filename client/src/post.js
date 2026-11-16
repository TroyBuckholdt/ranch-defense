// Custom post-processing passes.
//  SunPass:       volumetric-looking light shafts through leaves and around the house (screen-space
//                 radial march over the sky mask from the depth buffer), a soft glare around the sun
//                 and a subtle lens flare that fades when the sun is blocked.
//  ViewmodelPass: draws the first-person arms and gun from their own scene on top of the world with
//                 a cleared depth buffer, so the gun never clips into walls, cows or trees.
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

export class SunPass extends Pass {
  constructor(samples = 40) {
    super();
    this.uniforms = {
      tDiffuse: { value: null }, tDepth: { value: null },
      uSun: { value: new THREE.Vector2(0.5, 0.5) }, uVis: { value: 0 }, uAspect: { value: 1 },
      uColor: { value: new THREE.Color(1.0, 0.82, 0.6) }, uStrength: { value: 0.22 },
    };
    this.quad = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      defines: { N: samples },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse, tDepth;
        uniform vec2 uSun; uniform float uVis, uAspect, uStrength; uniform vec3 uColor;
        varying vec2 vUv;
        float sky(vec2 uv) {
          if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 0.0;
          return step(0.999999, texture2D(tDepth, uv).x);
        }
        float disc(vec2 p, float r, float soft) { return 1.0 - smoothstep(r * (1.0 - soft), r, length(p)); }
        void main() {
          vec4 base = texture2D(tDiffuse, vUv);
          if (uVis <= 0.001) { gl_FragColor = base; return; }
          vec2 asp = vec2(uAspect, 1.0);

          // how much of the sun disc is unblocked (drives glare and flare)
          float occ = 0.0;
          for (int i = 0; i < 8; i++) {
            float a = float(i) * 0.7853982;
            occ += sky(uSun + vec2(cos(a), sin(a)) * 0.012 / asp);
          }
          occ = (occ + sky(uSun) * 2.0) / 10.0;

          // light shafts: march toward the sun accumulating open sky, weighted toward the sun
          vec2 stepv = (vUv - uSun) / float(N) * 0.9;
          float jitter = fract(sin(dot(vUv * 913.17, vec2(12.9898, 78.233))) * 43758.5453);
          vec2 uv = vUv - stepv * jitter;
          float acc = 0.0, w = 1.0;
          for (int i = 0; i < N; i++) {
            uv -= stepv;
            vec2 r = (uv - uSun) * asp;
            acc += sky(uv) * exp(-dot(r, r) * 5.0) * w;
            w *= 0.97;
          }
          acc /= float(N);
          vec3 col = base.rgb + uColor * acc * uStrength * uVis;

          // wide glare around the sun
          vec2 rs = (vUv - uSun) * asp;
          col += uColor * exp(-length(rs) * 9.0) * 0.1 * occ * uVis;

          // lens flare: faint ghosts mirrored through the screen centre
          vec2 axis = vec2(0.5) - uSun;
          vec3 fl = vec3(0.0);
          fl += vec3(0.25, 0.45, 0.9) * disc((vUv - (uSun + axis * 0.55)) * asp, 0.035, 0.6) * 0.07;
          fl += vec3(0.9, 0.6, 0.3) * disc((vUv - (uSun + axis * 0.95)) * asp, 0.06, 0.4) * 0.05;
          fl += vec3(0.4, 0.9, 0.5) * disc((vUv - (uSun + axis * 1.3)) * asp, 0.025, 0.7) * 0.08;
          fl += vec3(0.7, 0.5, 1.0) * disc((vUv - (uSun + axis * 1.75)) * asp, 0.11, 0.25) * 0.035;
          float ringR = length((vUv - (uSun + axis * 2.1)) * asp);
          fl += vec3(0.5, 0.75, 1.0) * smoothstep(0.17, 0.19, ringR) * (1.0 - smoothstep(0.19, 0.215, ringR)) * 0.03;
          col += fl * occ * uVis;

          gl_FragColor = vec4(col, base.a);
        }`,
      depthTest: false, depthWrite: false,
    }));
  }

  render(renderer, writeBuffer, readBuffer) {
    this.uniforms.tDiffuse.value = readBuffer.texture;
    this.uniforms.tDepth.value = readBuffer.depthTexture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  // place the sun on screen; fades out as it leaves the view
  setSun(camera, sunDir) {
    const fwd = camera.getWorldDirection(_v);
    const facing = fwd.dot(sunDir);
    if (facing <= 0.05) { this.uniforms.uVis.value = 0; return; }
    _p.copy(sunDir).multiplyScalar(1000).add(camera.position).project(camera);
    this.uniforms.uSun.value.set(_p.x * 0.5 + 0.5, _p.y * 0.5 + 0.5);
    const edge = Math.max(Math.abs(_p.x), Math.abs(_p.y));
    this.uniforms.uVis.value = THREE.MathUtils.smoothstep(facing, 0.05, 0.35) * (1 - THREE.MathUtils.smoothstep(edge, 1.0, 1.8));
    this.uniforms.uAspect.value = camera.aspect;
  }

  dispose() { this.quad.dispose(); }
}
const _v = new THREE.Vector3(), _p = new THREE.Vector3();

export class ViewmodelPass extends Pass {
  constructor(scene, camera) {
    super();
    this.scene = scene; this.camera = camera;
    this.needsSwap = false;
  }
  render(renderer, writeBuffer, readBuffer) {
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = auto;
  }
}
