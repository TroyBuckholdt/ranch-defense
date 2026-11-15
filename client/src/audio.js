// All sound is synthesized with WebAudio so there are no files to download yet.
// Real recordings (the actual cows on the ranch!) can be dropped in later.
export class Audio {
  constructor() {
    this.ctx = null;
    this.listenerPos = [0, 0, 0];
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

  gunshot(pos = null, indoor = true) {
    if (!this.ctx) return;
    const out = this.out(pos, 8);
    const crack = this.noise(out, { dur: 0.09, type: 'highpass', freq: 1800, gain: 1.1 });
    this.noise(out, { dur: 0.35, type: 'lowpass', freq: 2400, freqEnd: 300, gain: 1.4 });
    this.tone(out, { dur: 0.18, type: 'sine', freq: 150, freqEnd: 45, gain: 1.6 });
    if (indoor) { crack.connect(this.verb); }
    // tail
    this.noise(out, { dur: 0.9, type: 'lowpass', freq: 600, freqEnd: 120, gain: 0.25, attack: 0.02, start: 0.03 });
  }

  click() {
    if (!this.ctx) return;
    this.noise(this.master, { dur: 0.03, type: 'highpass', freq: 3500, gain: 0.5 });
  }

  reload() {
    if (!this.ctx) return;
    this.noise(this.master, { dur: 0.05, type: 'bandpass', freq: 2200, q: 4, gain: 0.6, start: 0.25 });  // mag out
    this.noise(this.master, { dur: 0.06, type: 'bandpass', freq: 1500, q: 3, gain: 0.7, start: 1.15 }); // mag in
    this.noise(this.master, { dur: 0.04, type: 'highpass', freq: 3000, gain: 0.8, start: 1.6 });          // bolt
    this.noise(this.master, { dur: 0.05, type: 'bandpass', freq: 2600, q: 5, gain: 0.7, start: 1.72 });
  }

  // fleshy impact; headshots get a nasty crack on top
  impact(pos, head) {
    if (!this.ctx) return;
    const out = this.out(pos, 3);
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
    const out = this.out(pos, 4);
    this.tone(out, { dur: 0.25, type: 'triangle', freq: little ? 900 : 600, freqEnd: little ? 1500 : 1000, gain: 0.3 });
  }

  boardTear(pos) {
    if (!this.ctx) return;
    const out = this.out(pos, 5);
    this.noise(out, { dur: 0.25, type: 'bandpass', freq: 1200, q: 1.5, gain: 1.4 }); // crack
    this.noise(out, { dur: 0.4, type: 'lowpass', freq: 400, gain: 1.0, start: 0.05 }); // thud
    this.tone(out, { dur: 0.3, freq: 90, freqEnd: 50, gain: 0.7, start: 0.05 });
  }

  hammer(pos) {
    if (!this.ctx) return;
    const out = this.out(pos, 3);
    for (let i = 0; i < 3; i++) {
      this.tone(out, { dur: 0.08, type: 'triangle', freq: 1800 + Math.random() * 400, gain: 0.35, start: i * 0.13 });
      this.noise(out, { dur: 0.06, type: 'bandpass', freq: 2500, q: 3, gain: 0.5, start: i * 0.13 });
    }
  }

  bang(pos) { // cows thumping on walls
    if (!this.ctx) return;
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
    const notes = good ? [392, 494, 587] : [110, 104, 98];
    notes.forEach((f, i) => this.tone(this.master, { dur: good ? 0.5 : 1.8, type: good ? 'triangle' : 'sawtooth', freq: f, gain: good ? 0.12 : 0.1, start: i * (good ? 0.12 : 0.02), attack: 0.02 }));
    if (!good) this.noise(this.master, { dur: 2.2, type: 'lowpass', freq: 180, gain: 0.5, attack: 0.3 });
  }

  ambience() {
    const ctx = this.ctx;
    // wind
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 420;
    const g = ctx.createGain(); g.gain.value = 0.07;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.09;
    const lg = ctx.createGain(); lg.gain.value = 0.04;
    lfo.connect(lg).connect(g.gain);
    src.connect(f).connect(g).connect(this.master);
    src.start(); lfo.start();
    // crickets
    const chirp = () => {
      if (!this.ctx) return;
      for (let i = 0; i < 3; i++) this.tone(this.master, { dur: 0.04, type: 'sine', freq: 4200 + Math.random() * 300, gain: 0.012, start: i * 0.07 });
      setTimeout(chirp, 400 + Math.random() * 1600);
    };
    chirp();
  }
}
