// Game audio. Recorded-style sound effects (assets/sfx: guns, reloads, zombie moos, the dogs,
// footsteps, the ranch and the sea) load in the background after the ranch is ready; until a
// clip has arrived, or if one fails, the synthesized WebAudio version below plays instead.
const SFX = ['rifle', 'revolver', 'shotgun', 'hunting', 'lmg', 'magout', 'magin', 'bolt', 'shell', 'pump', 'dry',
  'moo1', 'moo2', 'moorun', 'moobull', 'barkbig', 'barklittle', 'growl', 'yelp', 'impact', 'swish', 'explosion',
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

  // zombie moo: a sawtooth through vowel-ish formants with a sick wobble
  moo(pos, type = 'walker') {
    if (!this.ctx) return;
    const clip = type === 'bull' ? 'moobull' : type === 'runner' ? 'moorun' : Math.random() < 0.5 ? 'moo1' : 'moo2';
    if (this.play(clip, { pos, gain: type === 'bull' ? 1.1 : 0.8, ref: type === 'bull' ? 8 : 5, rate: type === 'walker' ? 0.92 + Math.random() * 0.16 : 1, vary: 0.05 })) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const base = type === 'bull' ? 55 : type === 'runner' ? 120 : 85 + Math.random() * 25;
    const dur = type === 'runner' ? 0.6 : 1.1 + Math.random() * 0.7;
    const out = this.out(pos, type === 'bull' ? 8 : 4);
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(base * 1.2, t);
    o.frequency.linearRampToValueAtTime(base * 1.5, t + dur * 0.3);
    o.frequency.exponentialRampToValueAtTime(base * 0.75, t + dur);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 5 + Math.random() * 6;
    const lfoG = ctx.createGain(); lfoG.gain.value = base * 0.08;
    lfo.connect(lfoG).connect(o.frequency);
    const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.Q.value = 5;
    f1.frequency.setValueAtTime(350, t); f1.frequency.linearRampToValueAtTime(750, t + dur * 0.35); f1.frequency.linearRampToValueAtTime(400, t + dur);
    const f2 = ctx.createBiquadFilter(); f2.type = 'lowpass'; f2.frequency.value = 1400;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(type === 'bull' ? 1.6 : 1.1, t + 0.12);
    g.gain.setValueAtTime(type === 'bull' ? 1.4 : 1.0, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(f1).connect(f2).connect(g).connect(out);
    // gargling rasp layered on top
    const rasp = this.noise(out, { dur, type: 'bandpass', freq: 500, q: 2, gain: 0.25, attack: 0.1 });
    void rasp;
    o.start(t); lfo.start(t); o.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05);
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

  swish(pos = null) {
    if (!this.ctx) return;
    if (this.play('swish', { pos, gain: 0.5, ref: 3, vary: 0.1 })) return;
    this.noise(this.out(pos, 3), { dur: 0.22, type: 'bandpass', freq: 2500, freqEnd: 600, q: 1.5, gain: 0.5, attack: 0.04 });
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
