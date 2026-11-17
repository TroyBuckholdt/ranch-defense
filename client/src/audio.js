// Game audio. Recorded-style sound effects (assets/sfx: guns, reloads, zombie moos, the dogs,
// footsteps, the ranch and the sea) load in the background after the ranch is ready; until a
// clip has arrived, or if one fails, the synthesized WebAudio version below plays instead.
const SFX = ['rifle', 'revolver', 'shotgun', 'hunting', 'lmg', 'magout', 'magin', 'bolt', 'shell', 'pump', 'dry',
  'moo_a', 'moo_b', 'moo_c', 'moo_d', 'moo_e', 'moo_f', 'moo_run1', 'moo_run2', 'moo_bull', 'barkbig', 'barklittle', 'growl', 'yelp', 'impact', 'swish', 'explosion',
  'boardtear', 'hammer', 'bang', 'cash', 'wave', 'step_grass', 'step_tile', 'amb_day', 'amb_sea', 'music_wave'];

export class Audio {
  constructor() {
    this.ctx = null;
    this.listenerPos = [0, 0, 0];
    this.raw = new Map();  // name -> ArrayBuffer (downloaded, not yet decoded)
    this.buf = new Map();  // name -> AudioBuffer
    this.env = { indoor: false, sea: 0 };
    this.musicLevel = 0.32;
  }

  // download the clips (no AudioContext needed yet); decoded once start() has one
  preload() {
    if (this.preloading) return;
    this.preloading = true;
    for (const n of SFX) {
      fetch(`/assets/sfx/${n}.mp3`).then(r => (r.ok ? r.arrayBuffer() : null)).then((ab) => {
        if (!ab) return;
        this.raw.set(n, ab);
        if (this.ctx) this.decode(n);
      }).catch(() => {});
    }
  }

  decode(n) {
    const ab = this.raw.get(n);
    if (!ab) return;
    this.raw.delete(n);
    const done = (b) => {
      this.buf.set(n, b);
      if (n.startsWith('amb_')) this.startBeds();
      if (n === 'music_wave' && this.musicOn) this.music(true);
    };
    try {
      const p = this.ctx.decodeAudioData(ab, done, () => {});
      if (p && p.catch) p.catch(() => {});
    } catch {}
  }

  // play a clip; returns null if it isn't loaded so the caller can fall back to synthesis
  play(name, { pos = null, gain = 1, rate = 1, ref = 4, start = 0, verb = false, vary = 0.04 } = {}) {
    const b = this.buf.get(name);
    if (!this.ctx || !b) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = b;
    src.playbackRate.value = rate * (1 + (Math.random() * 2 - 1) * vary);
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(this.out(pos, ref));
    if (verb) g.connect(this.verb);
    src.start(this.ctx.currentTime + start);
    return src;
  }

  // looping ranch and surf beds; the surf swells near the beach, everything is muffled indoors
  startBeds() {
    if (this.beds || !this.buf.has('amb_day') || !this.buf.has('amb_sea')) return;
    const ctx = this.ctx;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 18000;
    lp.connect(this.master);
    const bed = (name, gain) => {
      const src = ctx.createBufferSource(); src.buffer = this.buf.get(name); src.loop = true;
      src.loopStart = 0.03; src.loopEnd = src.buffer.duration - 0.03;
      const g = ctx.createGain(); g.gain.value = gain;
      src.connect(g).connect(lp); src.start(ctx.currentTime, Math.random() * src.buffer.duration * 0.9);
      return g;
    };
    this.beds = { lp, day: bed('amb_day', 0.55), sea: bed('amb_sea', 0) };
    if (this.synthAmb) this.synthAmb.gain.setTargetAtTime(0, ctx.currentTime, 1.5);
  }

  // called every frame: indoors muffles the outside, the surf follows distance to the shore
  setEnv(indoor, shoreDist) {
    if (!this.beds) return;
    const t = this.ctx.currentTime;
    this.beds.lp.frequency.setTargetAtTime(indoor ? 900 : 18000, t, 0.25);
    const sea = Math.max(0, Math.min(1, 1 - (shoreDist - 6) / 70));
    this.beds.sea.gain.setTargetAtTime(0.05 + sea * 0.85, t, 0.5);
    this.beds.day.gain.setTargetAtTime(indoor ? 0.4 : 0.55 - sea * 0.25, t, 0.5);
  }

  // wave music: fades in when a wave starts, out when it's cleared (keeps its place in the loop)
  music(on) {
    this.musicOn = on;
    if (!this.ctx) return;
    const b = this.buf.get('music_wave');
    if (!b) return; // still downloading: decode() starts it if a wave is on by then
    if (!this.musicGain) {
      this.musicGain = this.ctx.createGain(); this.musicGain.gain.value = 0;
      this.musicGain.connect(this.master);
      const src = this.ctx.createBufferSource(); src.buffer = b; src.loop = true;
      src.connect(this.musicGain); src.start();
    }
    this.musicGain.gain.setTargetAtTime(on ? this.musicLevel : 0, this.ctx.currentTime, on ? 1.2 : 2.5);
  }

  step(tile, pos = null) {
    if (!this.ctx) return;
    this.play(tile ? 'step_tile' : 'step_grass', { pos, gain: tile ? 0.22 : 0.28, rate: 1, vary: 0.12, ref: 2 });
  }

  // must be called from a user gesture (the PLAY click)
  start() {
    if (this.ctx) return;
    // wake the speech voice inside the click too (iOS only lets it talk after a gesture), and
    // load the voice list now: Chrome returns none on the first ask
    try {
      const synth = window.speechSynthesis;
      if (synth && window.SpeechSynthesisUtterance) {
        synth.getVoices(); synth.addEventListener?.('voiceschanged', () => synth.getVoices());
        const u = new SpeechSynthesisUtterance(' '); u.volume = 0; synth.speak(u);
      }
    } catch {}
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 6;
    this.master.connect(comp).connect(ctx.destination);
    // short reverb for indoor gunfire
    this.verb = ctx.createConvolver();
    this.verb.buffer = this.impulse(1.4, 2.5);
    this.verbGain = ctx.createGain();
    this.verbGain.gain.value = 0.25;
    this.verb.connect(this.verbGain).connect(this.master);
    this.noiseBuf = this.makeNoise(2);
    this.ambience();
    for (const n of [...this.raw.keys()]) this.decode(n);
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  }

  makeNoise(sec) {
    const b = this.ctx.createBuffer(1, this.ctx.sampleRate * sec, this.ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  impulse(sec, decay) {
    const rate = this.ctx.sampleRate, len = rate * sec;
    const b = this.ctx.createBuffer(2, len, rate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return b;
  }

  setListener(pos, fwd) {
    if (!this.ctx) return;
    const l = this.ctx.listener, t = this.ctx.currentTime;
    this.listenerPos = [pos.x, pos.y, pos.z];
    if (l.positionX) {
      l.positionX.setValueAtTime(pos.x, t); l.positionY.setValueAtTime(pos.y, t); l.positionZ.setValueAtTime(pos.z, t);
      l.forwardX.setValueAtTime(fwd.x, t); l.forwardY.setValueAtTime(fwd.y, t); l.forwardZ.setValueAtTime(fwd.z, t);
      l.upX.setValueAtTime(0, t); l.upY.setValueAtTime(1, t); l.upZ.setValueAtTime(0, t);
    } else {
      l.setPosition(pos.x, pos.y, pos.z);
      l.setOrientation(fwd.x, fwd.y, fwd.z, 0, 1, 0);
    }
  }

  // output node: 3D-positioned if `pos` is given, otherwise straight to the ears
  out(pos, refDist = 4) {
    if (!pos) return this.master;
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = refDist;
    p.rolloffFactor = 1.1;
    p.positionX ? (p.positionX.value = pos[0], p.positionY.value = pos[1], p.positionZ.value = pos[2]) : p.setPosition(...pos);
    p.connect(this.master);
    return p;
  }

  noise(dest, { dur, type = 'bandpass', freq = 1000, q = 1, gain = 1, attack = 0.002, start = 0, freqEnd }) {
    const ctx = this.ctx, t = ctx.currentTime + start;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random()); src.stop(t + dur + 0.05);
    return g;
  }

  tone(dest, { dur, type = 'sine', freq, freqEnd, gain = 1, attack = 0.005, start = 0 }) {
    const ctx = this.ctx, t = ctx.currentTime + start;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(dest);
    o.start(t); o.stop(t + dur + 0.05);
  }

  gunshot(pos = null, indoor = true, w = 'rifle') {
    if (!this.ctx) return;
    const own = !pos;
    if (this.play(this.buf.has(w) ? w : 'rifle', { pos, gain: own ? 0.95 : 1.2, ref: 10, verb: indoor, vary: 0.035 })) {
      // a little extra low-end punch for your own gun
      if (own) this.tone(this.master, { dur: 0.14, type: 'sine', freq: w === 'shotgun' ? 70 : 110, freqEnd: 40, gain: 0.55 });
      return;
    }
    const out = this.out(pos, 8);
    const P = { rifle: [1, 1, 150], revolver: [1.2, 1.3, 120], shotgun: [0.8, 2.0, 70], hunting: [1.4, 2.2, 90], lmg: [1, 1.2, 130] }[w] || [1, 1, 150];
    const crack = this.noise(out, { dur: 0.09 * P[0], type: 'highpass', freq: 1800, gain: 1.1 * P[0] });
    this.noise(out, { dur: 0.35 * P[1], type: 'lowpass', freq: 2400, freqEnd: 300, gain: 1.4 });
    this.tone(out, { dur: 0.18 * P[1], type: 'sine', freq: P[2], freqEnd: 40, gain: 1.6 });
    if (indoor) { crack.connect(this.verb); }
    // tail
    this.noise(out, { dur: 0.9, type: 'lowpass', freq: 600, freqEnd: 120, gain: 0.25, attack: 0.02, start: 0.03 });
  }

  click() {
    if (!this.ctx) return;
    if (this.play('dry', { gain: 0.6, vary: 0.08 })) return;
    this.noise(this.master, { dur: 0.03, type: 'highpass', freq: 3500, gain: 0.5 });
  }

  reload(w = 'rifle') {
    if (!this.ctx) return;
    if (this.buf.has('magin')) {
      if (w === 'shotgun') {
        for (let i = 0; i < 5; i++) this.play('shell', { gain: 0.55, start: 0.3 + i * 0.45, vary: 0.06 });
        this.play('pump', { gain: 0.8, start: 2.6 });
        return;
      }
      this.play('magout', { gain: 0.6, start: 0.25 });
      this.play('magin', { gain: 0.7, start: 1.1 });
      this.play('bolt', { gain: 0.6, start: 1.55 });
      return;
    }
    if (w === 'shotgun') { // shells one at a time, then a pump
      for (let i = 0; i < 5; i++) this.noise(this.master, { dur: 0.05, type: 'bandpass', freq: 1800, q: 4, gain: 0.6, start: 0.3 + i * 0.45 });
      this.noise(this.master, { dur: 0.12, type: 'bandpass', freq: 900, q: 2, gain: 0.9, start: 2.6 });
      return;
    }
    this.noise(this.master, { dur: 0.05, type: 'bandpass', freq: 2200, q: 4, gain: 0.6, start: 0.25 });  // mag out
    this.noise(this.master, { dur: 0.06, type: 'bandpass', freq: 1500, q: 3, gain: 0.7, start: 1.15 }); // mag in
    this.noise(this.master, { dur: 0.04, type: 'highpass', freq: 3000, gain: 0.8, start: 1.6 });          // bolt
    this.noise(this.master, { dur: 0.05, type: 'bandpass', freq: 2600, q: 5, gain: 0.7, start: 1.72 });
  }

  // fleshy impact; headshots get a nasty crack on top
  impact(pos, head) {
    if (!this.ctx) return;
    const out = this.out(pos, 3);
    if (this.play('impact', { pos, gain: 0.7, ref: 3, vary: 0.1 })) {
      if (head) this.noise(out, { dur: 0.08, type: 'bandpass', freq: 3000, q: 2, gain: 0.7 });
      return;
    }
    this.noise(out, { dur: 0.12, type: 'lowpass', freq: 900, gain: 1.2 });
    this.tone(out, { dur: 0.1, freq: 120, freqEnd: 60, gain: 0.6 });
    if (head) this.noise(out, { dur: 0.08, type: 'bandpass', freq: 3000, q: 2, gain: 0.9 });
  }

  hitmarker(kill) {
    if (!this.ctx) return;
    this.tone(this.master, { dur: 0.06, type: 'square', freq: kill ? 1400 : 2200, gain: 0.07 });
  }

  moo(pos, type = 'walker') {
    if (!this.ctx) return;
    // real cattle moos (six regular, two agitated for runners, a deep bellow for bulls);
    // never the same clip twice in a row, and bulls also use the regular moos pitched down
    const WALK = ['moo_a', 'moo_b', 'moo_c', 'moo_d', 'moo_e', 'moo_f'];
    const pool = type === 'runner' ? ['moo_run1', 'moo_run2'] : type === 'bull' ? ['moo_bull', 'moo_b', 'moo_d', 'moo_e'] : WALK;
    let clip = pool[Math.floor(Math.random() * pool.length)];
    if (clip === this.lastMoo) clip = pool[(pool.indexOf(clip) + 1) % pool.length];
    this.lastMoo = clip;
    const rate = type === 'bull' ? (clip === 'moo_bull' ? 0.9 : 0.78) : type === 'runner' ? 1.0 + Math.random() * 0.08 : 0.94 + Math.random() * 0.1;
    this.play(clip, { pos, gain: type === 'bull' ? 1.0 : type === 'runner' ? 0.85 : 0.75, ref: type === 'bull' ? 8 : 5, rate, vary: 0 });
  }

  // dog bark: a short voiced burst through a mouth-like formant; little dog is higher
  bark(pos, little = false, growl = false) {
    if (!this.ctx) return;
    if (growl ? this.play('growl', { pos, gain: 0.6, ref: 4, rate: little ? 1.3 : 1 })
      : this.play(little ? 'barklittle' : 'barkbig', { pos, gain: 0.75, ref: little ? 3 : 5, vary: 0.08 })) {
      if (!growl && Math.random() < 0.5) this.play(little ? 'barklittle' : 'barkbig', { pos, gain: 0.65, ref: little ? 3 : 5, start: 0.3 + Math.random() * 0.1, vary: 0.08 });
      return;
    }
    const out = this.out(pos, little ? 3 : 5);
    const base = little ? 520 : 260;
    const n = growl ? 1 : 1 + Math.floor(Math.random() * 2);
    for (let i = 0; i < n; i++) {
      const st = i * 0.18;
      this.tone(out, { dur: 0.12, type: 'sawtooth', freq: base * 1.3, freqEnd: base * 0.8, gain: 0.35, start: st, attack: 0.008 });
      this.noise(out, { dur: 0.1, type: 'bandpass', freq: base * 3, q: 3, gain: 0.6, start: st });
    }
    if (growl) this.noise(out, { dur: 0.35, type: 'lowpass', freq: little ? 600 : 300, gain: 0.5, attack: 0.03 });
  }

  yelp(pos, little = false) {
    if (!this.ctx) return;
    if (this.play('yelp', { pos, gain: 0.6, ref: 4, rate: little ? 1.2 : 0.95 })) return;
    const out = this.out(pos, 4);
    this.tone(out, { dur: 0.25, type: 'triangle', freq: little ? 900 : 600, freqEnd: little ? 1500 : 1000, gain: 0.3 });
  }

  // Rafael's voice: the browser's own Spanish speech, pitched down and slowed to a drunk
  // slur. Not every device has a Spanish voice; the subtitle is always shown either way.
  say(text, volume = 1, slow = false) {
    const synth = window.speechSynthesis;
    if (!synth || !window.SpeechSynthesisUtterance) return;
    try {
      const voices = synth.getVoices();
      if (synth.paused) synth.resume();
      const voice = voices.find(v => /^es[-_]MX/i.test(v.lang)) || voices.find(v => /^es[-_](US|419)/i.test(v.lang)) || voices.find(v => /^es/i.test(v.lang));
      synth.cancel(); // he interrupts himself
      const u = new SpeechSynthesisUtterance(text.replace(/[¡¿]/g, ''));
      u.lang = voice?.lang || 'es-MX';
      if (voice) u.voice = voice;
      u.pitch = 0.25; u.rate = slow ? 0.6 : 0.82; u.volume = Math.max(0, Math.min(1, volume));
      synth.speak(u);
    } catch {}
  }

  // truck engine: two detuned saws through a low-pass, pitch and brightness follow speed
  engine(on, speed = 0, gain = 1) {
    if (!this.ctx) return;
    if (!this.eng) {
      if (!on) return;
      const g = this.ctx.createGain(); g.gain.value = 0;
      const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 300; lp.Q.value = 1.2;
      const o1 = this.ctx.createOscillator(), o2 = this.ctx.createOscillator(), sub = this.ctx.createOscillator();
      o1.type = 'sawtooth'; o2.type = 'sawtooth'; sub.type = 'square';
      const sg = this.ctx.createGain(); sg.gain.value = 0.5;
      o1.connect(lp); o2.connect(lp); sub.connect(sg).connect(lp);
      lp.connect(g).connect(this.master);
      o1.start(); o2.start(); sub.start();
      this.eng = { g, lp, o1, o2, sub };
    }
    const t = this.ctx.currentTime, e = this.eng;
    const rev = 0.25 + (speed % 7.5) / 7.5 * 0.5 + Math.min(1, speed / 19) * 0.25; // climbs through the gears
    const f = 38 + rev * 70;
    e.o1.frequency.setTargetAtTime(f, t, 0.08); e.o2.frequency.setTargetAtTime(f * 1.505, t, 0.08); e.sub.frequency.setTargetAtTime(f * 0.5, t, 0.08);
    e.lp.frequency.setTargetAtTime(220 + rev * 700, t, 0.1);
    e.g.gain.setTargetAtTime(on ? 0.11 * gain : 0, t, 0.15);
  }

  // the generator catching: a starter whine, a thump, then a hum that fades
  powerOn() {
    if (!this.ctx) return;
    const o = this.master;
    this.tone(o, { dur: 0.6, type: 'sawtooth', freq: 60, freqEnd: 180, gain: 0.25, attack: 0.05 });
    this.noise(o, { dur: 0.25, type: 'lowpass', freq: 400, gain: 0.8, start: 0.55 });
    this.tone(o, { dur: 2.4, type: 'square', freq: 55, gain: 0.08, start: 0.6, attack: 0.2 });
    this.tone(o, { dur: 2.4, type: 'sine', freq: 110, gain: 0.12, start: 0.6, attack: 0.2 });
  }

  // a perk: cap off, glug glug, and (if it's mine) a little four-note jingle
  drink(mine, pos = null) {
    if (!this.ctx) return;
    const o = this.out(pos, 4);
    this.noise(o, { dur: 0.08, type: 'highpass', freq: 3000, gain: 0.5 });
    for (let i = 0; i < 3; i++) this.tone(o, { dur: 0.12, type: 'sine', freq: 180, freqEnd: 120, gain: 0.35, start: 0.25 + i * 0.22 });
    if (mine) [523, 659, 784, 1047].forEach((f, i) => this.tone(this.master, { dur: 0.25, type: 'triangle', freq: f, gain: 0.12, start: 1.0 + i * 0.13 }));
  }

  // the mystery box's music box, while the guns spin
  musicBox(pos) {
    if (!this.ctx) return;
    const o = this.out(pos, 6);
    const tune = [784, 659, 587, 659, 784, 880, 784, 659, 523, 587, 659, 587, 523, 494, 523];
    tune.forEach((f, i) => { this.tone(o, { dur: 0.5, type: 'sine', freq: f, gain: 0.16, start: i * 0.27 }); this.tone(o, { dur: 0.3, type: 'sine', freq: f * 2, gain: 0.04, start: i * 0.27 }); });
  }

  // the toy cow's laugh when the box moves
  laugh(pos) {
    if (!this.ctx) return;
    const o = this.out(pos, 8);
    for (let i = 0; i < 5; i++) this.tone(o, { dur: 0.16, type: 'sawtooth', freq: 300 - i * 18, freqEnd: 220 - i * 15, gain: 0.18, start: i * 0.19, attack: 0.02 });
    this.play('moo_b', { pos, gain: 0.6, rate: 1.6, start: 1.0 });
  }

  // the electric fence: crackling bursts
  zap(pos) {
    if (!this.ctx) return;
    const o = this.out(pos, 10);
    for (let i = 0; i < 12; i++) this.noise(o, { dur: 0.06 + Math.random() * 0.1, type: 'bandpass', freq: 2500 + Math.random() * 3000, q: 2, gain: 0.6, start: i * 0.09 + Math.random() * 0.05 });
    this.tone(o, { dur: 1.3, type: 'sawtooth', freq: 120, gain: 0.08 });
  }

  // heavy footfall / body hitting the ground (the boss)
  thud(pos, power = 1) {
    if (!this.ctx) return;
    const out = this.out(pos, 14);
    this.tone(out, { dur: 0.35, freq: 70, freqEnd: 28, gain: 1.1 * power, attack: 0.004 });
    this.noise(out, { dur: 0.22, type: 'lowpass', freq: 260, freqEnd: 60, gain: 0.9 * power, attack: 0.004 });
  }

  // a bottle bursting on the ground
  smash(pos) {
    if (!this.ctx) return;
    const out = this.out(pos, 8);
    this.noise(out, { dur: 0.09, type: 'highpass', freq: 3200, gain: 1.3, attack: 0.001 });
    this.noise(out, { dur: 0.5, type: 'bandpass', freq: 6200, q: 2.5, gain: 0.7, attack: 0.002, start: 0.02 });
    for (let i = 0; i < 5; i++) this.tone(out, { dur: 0.12 + Math.random() * 0.2, type: 'triangle', freq: 2400 + Math.random() * 4200, gain: 0.14, start: 0.03 + Math.random() * 0.25 });
  }

  // the giant's slurred bellow: the dog growl and the bull, slowed right down
  bossRoar(pos) {
    if (!this.ctx) return;
    const a = this.play('growl', { pos, gain: 1.5, ref: 18, rate: 0.36, vary: 0.06 });
    this.play('moo_bull', { pos, gain: 0.9, ref: 18, rate: 0.5, vary: 0.05, start: 0.15 });
    if (!a) this.tone(this.out(pos, 18), { dur: 1.2, type: 'sawtooth', freq: 90, freqEnd: 55, gain: 0.6, attack: 0.1 });
  }

  // a far-off whoop from the locals as they come through the trees
  shout(pos) {
    if (!this.ctx) return;
    const out = this.out(pos, 7);
    const f = 380 + Math.random() * 160;
    this.tone(out, { dur: 0.32, type: 'sawtooth', freq: f, freqEnd: f * (1.5 + Math.random() * 0.4), gain: 0.16, attack: 0.03 });
    this.noise(out, { dur: 0.3, type: 'bandpass', freq: f * 3, q: 4, gain: 0.25, attack: 0.03 });
  }

  swish(pos = null) {
    if (!this.ctx) return;
    if (this.play('swish', { pos, gain: 0.5, ref: 3, vary: 0.1 })) return;
    this.noise(this.out(pos, 3), { dur: 0.22, type: 'bandpass', freq: 2500, freqEnd: 600, q: 1.5, gain: 0.5, attack: 0.04 });
  }

  // a stampede: a long low rumble of hooves that swells and fades
  rumble() {
    if (!this.ctx) return;
    const out = this.out(null);
    this.noise(out, { dur: 4.5, type: 'lowpass', freq: 160, freqEnd: 90, gain: 1.6, attack: 1.2 });
    for (let i = 0; i < 24; i++) this.noise(out, { dur: 0.12, type: 'lowpass', freq: 240, gain: 0.5 + Math.random() * 0.5, start: 0.3 + i * 0.16 + Math.random() * 0.08 });
  }

  explosion(pos) {
    if (!this.ctx) return;
    const out = this.out(pos, 15);
    if (this.play('explosion', { pos, gain: 1.4, ref: 15 })) { this.tone(out, { dur: 0.8, freq: 60, freqEnd: 25, gain: 1.2 }); return; }
    this.noise(out, { dur: 1.6, type: 'lowpass', freq: 1200, freqEnd: 80, gain: 2.2, attack: 0.005 });
    this.tone(out, { dur: 0.8, freq: 70, freqEnd: 25, gain: 2.0 });
    this.noise(out, { dur: 0.15, type: 'highpass', freq: 2500, gain: 1.0 });
  }

  cash() {
    if (!this.ctx) return;
    if (this.play('cash', { gain: 0.35, vary: 0.02 })) return;
    [880, 1320, 1760].forEach((f, i) => this.tone(this.master, { dur: 0.12, type: 'triangle', freq: f, gain: 0.12, start: i * 0.06 }));
  }

  powerup(type) {
    if (!this.ctx) return;
    const notes = type === 'nuke' ? [220, 165, 110] : [523, 659, 784, 1046];
    notes.forEach((f, i) => this.tone(this.master, { dur: 0.35, type: 'square', freq: f, gain: 0.06, start: i * 0.09, attack: 0.01 }));
  }

  boardTear(pos) {
    if (!this.ctx) return;
    if (this.play('boardtear', { pos, gain: 1.0, ref: 5, vary: 0.08 })) return;
    const out = this.out(pos, 5);
    this.noise(out, { dur: 0.25, type: 'bandpass', freq: 1200, q: 1.5, gain: 1.4 }); // crack
    this.noise(out, { dur: 0.4, type: 'lowpass', freq: 400, gain: 1.0, start: 0.05 }); // thud
    this.tone(out, { dur: 0.3, freq: 90, freqEnd: 50, gain: 0.7, start: 0.05 });
  }

  hammer(pos) {
    if (!this.ctx) return;
    if (this.play('hammer', { pos, gain: 0.6, ref: 3, vary: 0.05 })) return;
    const out = this.out(pos, 3);
    for (let i = 0; i < 3; i++) {
      this.tone(out, { dur: 0.08, type: 'triangle', freq: 1800 + Math.random() * 400, gain: 0.35, start: i * 0.13 });
      this.noise(out, { dur: 0.06, type: 'bandpass', freq: 2500, q: 3, gain: 0.5, start: i * 0.13 });
    }
  }

  bang(pos) { // cows thumping on walls
    if (!this.ctx) return;
    if (this.play('bang', { pos, gain: 0.9, ref: 5, vary: 0.1 })) return;
    const out = this.out(pos, 5);
    this.noise(out, { dur: 0.3, type: 'lowpass', freq: 250, gain: 1.4 });
    this.tone(out, { dur: 0.25, freq: 70, freqEnd: 40, gain: 0.8 });
  }

  hurt() {
    if (!this.ctx) return;
    this.noise(this.master, { dur: 0.25, type: 'lowpass', freq: 500, gain: 1.2 });
    this.tone(this.master, { dur: 0.3, type: 'sawtooth', freq: 160, freqEnd: 90, gain: 0.15 });
  }

  heartbeat() {
    if (!this.ctx) return;
    this.tone(this.master, { dur: 0.12, freq: 60, freqEnd: 40, gain: 0.9 });
    this.tone(this.master, { dur: 0.12, freq: 55, freqEnd: 38, gain: 0.7, start: 0.22 });
  }

  stinger(good) { // wave start / wave clear
    if (!this.ctx) return;
    if (!good && this.play('wave', { gain: 0.8, vary: 0 })) return;
    const notes = good ? [392, 494, 587] : [110, 104, 98];
    notes.forEach((f, i) => this.tone(this.master, { dur: good ? 0.5 : 1.8, type: good ? 'triangle' : 'sawtooth', freq: f, gain: good ? 0.12 : 0.1, start: i * (good ? 0.12 : 0.02), attack: 0.02 }));
    if (!good) this.noise(this.master, { dur: 2.2, type: 'lowpass', freq: 180, gain: 0.5, attack: 0.3 });
  }

  ambience() {
    const ctx = this.ctx;
    const amb = this.synthAmb = ctx.createGain();
    amb.connect(this.master);
    // wind
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 420;
    const g = ctx.createGain(); g.gain.value = 0.07;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.09;
    const lg = ctx.createGain(); lg.gain.value = 0.04;
    lfo.connect(lg).connect(g.gain);
    src.connect(f).connect(g).connect(amb);
    src.start(); lfo.start();
    // crickets (until the recorded ranch bed takes over)
    const chirp = () => {
      if (!this.ctx || this.beds) return;
      for (let i = 0; i < 3; i++) this.tone(amb, { dur: 0.04, type: 'sine', freq: 4200 + Math.random() * 300, gain: 0.012, start: i * 0.07 });
      setTimeout(chirp, 400 + Math.random() * 1600);
    };
    chirp();
  }
}
