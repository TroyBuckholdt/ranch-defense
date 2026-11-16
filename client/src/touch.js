// Phone / tablet controls: a floating move stick on the left, drag-to-look on the right,
// and a thumb arc of buttons around a big fire button. main.js only sees a few callbacks.
import './touch.css';

const params = new URLSearchParams(location.search);

// Touch mode: forced with ?touch=1 / off with ?touch=0, otherwise auto on touch-first devices.
export function detectTouch() {
  const p = params.get('touch');
  if (p === '1') return true;
  if (p === '0') return false;
  const coarse = matchMedia('(pointer: coarse)').matches;
  const fine = matchMedia('(any-pointer: fine)').matches;
  return coarse || (navigator.maxTouchPoints > 0 && !fine);
}

// small screen (phone) vs tablet, for picking a graphics preset
export const isPhone = () => Math.min(screen.width, screen.height) < 560;

const SENS_KEY = 'rd-touch-sens';
export function getSensitivity() {
  let v = 1.3;
  try { v = parseFloat(localStorage.getItem(SENS_KEY)) || v; } catch {}
  return Math.min(3, Math.max(0.3, v));
}
export function setSensitivity(v) { try { localStorage.setItem(SENS_KEY, String(v)); } catch {} }

const canFullscreen = () => !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
const isFullscreen = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
export function enterFullscreen() {
  const el = document.documentElement;
  const p = (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el, { navigationUI: 'hide' });
  Promise.resolve(p).then(() => screen.orientation?.lock?.('landscape')).catch(() => {});
}
function toggleFullscreen() {
  if (isFullscreen()) (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
  else enterFullscreen();
}

// Buttons: [id, label, kind]. kind 'hold' gets down+up, 'tap' fires once on press.
const BUTTONS = [
  ['fire', 'FIRE', 'hold'],
  ['aim', 'AIM', 'tap'],
  ['jump', 'JUMP', 'hold'],
  ['crouch', 'CROUCH', 'tap'],
  ['reload', 'RELOAD', 'tap'],
  ['nade', 'NADE', 'tap'],
  ['melee', 'MELEE', 'tap'],
  ['swap', 'SWAP', 'tap'],
  ['use', 'USE', 'hold'],
  ['full', '⛶', 'tap'],
  ['light', 'LIGHT', 'tap'],
  ['scores', 'SCORES', 'hold'],
];

export class TouchControls {
  // api: { keys, fire(down), toggleAim(), reload(), grenade(), melee(), swap(), use(down),
  //        look(dx, dy), flashlight(), scores(show) }
  constructor(api) {
    this.api = api;
    this.sens = getSensitivity();
    this.touches = new Map(); // touch identifier -> { role, x, y, ... }
    this.stick = { id: null, x: 0, y: 0, cx: 0, cy: 0, sprint: false };

    document.body.classList.add('touch');
    const root = this.root = document.createElement('div');
    root.id = 'touch-ui';
    root.className = 'hidden';
    root.innerHTML = `
      <div class="stick-base"><div class="stick-knob"></div></div>
      ${BUTTONS.map(([id, label]) => `<div class="tbtn tb-${id}" data-act="${id}"><span>${label}</span></div>`).join('')}`;
    document.body.appendChild(root);
    const rot = document.createElement('div');
    rot.id = 'rotate-prompt';
    rot.innerHTML = '<div class="phone-icon"></div><div>Turn your phone sideways to play</div>';
    document.body.appendChild(rot);

    this.base = root.querySelector('.stick-base');
    this.knob = root.querySelector('.stick-knob');
    this.btn = {};
    for (const el of root.querySelectorAll('.tbtn')) this.btn[el.dataset.act] = el;
    if (!canFullscreen()) this.btn.full.classList.add('hidden');

    const opt = { passive: false };
    root.addEventListener('touchstart', (e) => this.onStart(e), opt);
    root.addEventListener('touchmove', (e) => this.onMove(e), opt);
    root.addEventListener('touchend', (e) => this.onEnd(e), opt);
    root.addEventListener('touchcancel', (e) => this.onEnd(e), opt);
    // no page scrolling, pinch zoom or double-tap zoom while playing
    document.addEventListener('touchmove', (e) => { if (this.visible && e.cancelable) e.preventDefault(); }, opt);
    for (const ev of ['gesturestart', 'gesturechange', 'dblclick']) document.addEventListener(ev, (e) => { if (this.visible) e.preventDefault(); }, opt);
    addEventListener('blur', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.releaseAll(); });
    addEventListener('resize', () => this.layout());
    this.layout();
  }

  show(on) {
    this.visible = on;
    this.root.classList.toggle('hidden', !on);
    document.body.classList.toggle('in-game', on);
    if (!on) this.releaseAll();
    this.layout();
  }

  // size and place the thumb arc for this screen
  layout() {
    const W = innerWidth, H = innerHeight, vmin = Math.min(W, H);
    const b = Math.round(Math.min(72, Math.max(44, vmin * 0.13)));
    const fire = Math.round(b * 1.5);
    const gap = Math.max(8, b * 0.16);
    this.root.style.setProperty('--b', `${b}px`);
    this.root.style.setProperty('--fire', `${fire}px`);
    const fx = Math.max(12, vmin * 0.04) + fire / 2; // fire centre, from the right edge
    const fy = Math.max(10, vmin * 0.05) + fire / 2; // ... and from the bottom
    const place = (id, ang, r, size = b) => {
      const a = ang * Math.PI / 180;
      const el = this.btn[id];
      el.style.right = `${fx - Math.cos(a) * r - size / 2}px`;
      el.style.bottom = `${fy + Math.sin(a) * r - size / 2}px`;
    };
    // lay buttons along an arc around fire, spaced so neighbours never overlap
    const arc = (ids, r, start) => {
      const step = 2 * Math.asin(Math.min(1, (b + gap) / 2 / r)) * 180 / Math.PI;
      ids.forEach((id, i) => place(id, start + i * step, r));
    };
    const r1 = fire / 2 + gap + b / 2, r2 = r1 + b + gap;
    place('fire', 0, 0, fire);
    arc(['jump', 'aim', 'crouch'], r1, 84);
    arc(['swap', 'reload', 'nade', 'melee'], r2, 82);
    place('use', 150, r2 + b * 1.1 + gap, b * 1.2);
    // stick resting spot (it follows the thumb once touched)
    this.stickR = Math.round(Math.min(70, Math.max(46, vmin * 0.15)));
    this.root.style.setProperty('--stick', `${this.stickR * 2}px`);
    this.rest = { x: Math.max(16, vmin * 0.05) + this.stickR + 8, y: H - (Math.max(14, vmin * 0.06) + this.stickR + 8) };
    if (this.stick.id == null) this.setStick(this.rest.x, this.rest.y, 0, 0);
  }

  setStick(cx, cy, dx, dy) {
    this.base.style.transform = `translate(${cx - this.stickR}px, ${cy - this.stickR}px)`;
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  onStart(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      const el = document.elementFromPoint(t.clientX, t.clientY)?.closest?.('.tbtn');
      if (el && this.root.contains(el)) { this.press(t, el.dataset.act); continue; }
      if (t.clientX < innerWidth * 0.45 && this.stick.id == null) {
        // floating stick: centre it under the thumb (kept on screen)
        const r = this.stickR;
        const cx = Math.max(r + 4, Math.min(innerWidth * 0.45 - r, t.clientX));
        const cy = Math.max(r + 4, Math.min(innerHeight - r - 4, t.clientY));
        Object.assign(this.stick, { id: t.identifier, cx, cy, x: 0, y: 0, sprint: false });
        this.base.classList.add('on');
        this.moveStick(t);
        this.touches.set(t.identifier, { role: 'stick' });
      } else {
        this.touches.set(t.identifier, { role: 'look', x: t.clientX, y: t.clientY });
      }
    }
  }

  onMove(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      const s = this.touches.get(t.identifier);
      if (!s) continue;
      if (s.role === 'stick') this.moveStick(t);
      else if (s.role === 'look' || s.act === 'fire') {
        // dragging on the fire button also aims, so you can shoot and track at once
        const dx = t.clientX - s.x, dy = t.clientY - s.y;
        s.x = t.clientX; s.y = t.clientY;
        // a touch pixel covers more of the view than a mouse count, so scale by screen size
        const k = this.sens * 900 / Math.max(600, innerWidth);
        this.api.look(dx * k, dy * k);
      }
    }
  }

  onEnd(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      const s = this.touches.get(t.identifier);
      if (!s) continue;
      this.touches.delete(t.identifier);
      if (s.role === 'stick') this.endStick();
      else if (s.role === 'btn') this.release(s.act);
    }
  }

  moveStick(t) {
    const st = this.stick, r = this.stickR;
    let dx = t.clientX - st.cx, dy = t.clientY - st.cy;
    const len = Math.hypot(dx, dy);
    if (len > r) { dx *= r / len; dy *= r / len; }
    // small dead zone, then a linear response up to the rim
    const m = Math.min(1, len / r), dz = 0.12;
    const k = m < dz ? 0 : (m - dz) / (1 - dz) / (m || 1);
    st.x = dx / r * k; st.y = dy / r * k;
    const keys = this.api.keys;
    keys.axisX = st.x; keys.axisY = st.y;
    // pushed to the rim, mostly forward = sprint (not while holding fire: you can't shoot on the run)
    const sprint = m > 0.92 && st.y < -0.55 && !this.firing;
    if (sprint && !st.sprint && keys.KeyC) { keys.KeyC = false; this.btn.crouch.classList.remove('on'); } // stand up to run
    st.sprint = sprint;
    keys.ShiftLeft = sprint;
    this.base.classList.toggle('sprint', sprint);
    this.setStick(st.cx, st.cy, dx, dy);
  }

  endStick() {
    const keys = this.api.keys;
    keys.axisX = keys.axisY = 0;
    keys.ShiftLeft = false;
    this.stick.id = null;
    this.stick.sprint = false;
    this.base.classList.remove('on', 'sprint');
    this.setStick(this.rest.x, this.rest.y, 0, 0);
  }

  press(t, act) {
    const kind = BUTTONS.find(b => b[0] === act)[2];
    this.touches.set(t.identifier, { role: 'btn', act, x: t.clientX, y: t.clientY });
    const api = this.api, keys = api.keys;
    if (kind === 'hold') this.btn[act].classList.add('on');
    else { this.btn[act].classList.add('flash'); setTimeout(() => this.btn[act].classList.remove('flash'), 140); }
    navigator.vibrate?.(8);
    switch (act) {
      case 'fire': this.firing = true; keys.ShiftLeft = false; this.base.classList.remove('sprint'); api.fire(true); break;
      case 'jump': keys.Space = true; break;
      case 'use': api.use(true); break;
      case 'scores': api.scores(true); break;
      case 'aim': api.toggleAim(); break;
      case 'crouch': keys.KeyC = !keys.KeyC; break;
      case 'reload': api.reload(); break;
      case 'nade': api.grenade(); break;
      case 'melee': api.melee(); break;
      case 'swap': api.swap(); break;
      case 'light': api.flashlight(); break;
      case 'full': toggleFullscreen(); break;
    }
  }

  release(act) {
    const api = this.api, keys = api.keys;
    this.btn[act]?.classList.remove('on');
    if (act === 'fire') { this.firing = false; api.fire(false); }
    if (act === 'jump') keys.Space = false;
    if (act === 'use') api.use(false);
    if (act === 'scores') api.scores(false);
  }

  releaseAll() {
    for (const [, s] of this.touches) if (s.role === 'btn') this.release(s.act);
    this.touches.clear();
    if (this.stick.id != null || this.api.keys.axisX || this.api.keys.axisY) this.endStick();
  }

  // per-frame visual state from the game
  update({ aiming, crouched, prompt, canSwap, grenades, flashlight }) {
    if (!this.visible) return;
    this.btn.aim.classList.toggle('on', !!aiming);
    this.btn.crouch.classList.toggle('on', !!crouched);
    this.btn.use.classList.toggle('ready', !!prompt);
    this.btn.swap.classList.toggle('dim', !canSwap);
    this.btn.nade.classList.toggle('dim', !grenades);
    this.btn.light.classList.toggle('on', !!flashlight);
  }
}
