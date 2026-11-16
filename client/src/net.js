// WebSocket connection + snapshot interpolation. The server sends the whole room 20x a
// second; we render everyone ~100ms in the past and blend between snapshots so motion
// stays smooth even on a bumpy connection.
const INTERP_DELAY = 110;

export class Net {
  constructor(onEvent) {
    this.onEvent = onEvent;
    this.buf = [];
    this.offset = null;
    this.latest = null;
    this.id = null;
    this.ws = null;
  }

  connect(name, room, char) {
    return new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      this.ws = ws;
      let welcomed = false;
      const timer = setTimeout(() => { if (!welcomed) { ws.close(); reject(new Error('Could not reach the game server.')); } }, 15000);
      ws.onopen = () => ws.send(JSON.stringify({ t: 'join', name, room, char }));
      ws.onerror = () => { if (!welcomed) { clearTimeout(timer); reject(new Error('Could not reach the game server.')); } };
      ws.onclose = () => { if (welcomed) this.onEvent({ t: 'disconnected' }); };
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.t === 'welcome') { welcomed = true; clearTimeout(timer); this.id = m.id; this.room = m.room; resolve(m); return; }
        if (m.t === 'full') { clearTimeout(timer); reject(new Error('That room is full (8 players max). Try another room code.')); return; }
        if (m.t === 'snap') { this.onSnap(m); return; }
        this.onEvent(m);
      };
    });
  }

  send(obj) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(obj)); }

  onSnap(s) {
    const now = performance.now();
    const sample = s.ts - now;
    // track the "fastest" arrival; drift down slowly in case clocks wander
    if (this.offset === null || sample > this.offset) this.offset = sample;
    else this.offset += (sample - this.offset) * 0.02;
    // index for quick lookups
    s.cowMap = new Map(s.cows.map(c => [c[0], c]));
    s.playerMap = new Map(s.players.map(p => [p.id, p]));
    s.dogMap = new Map((s.dogs || []).map(d => [d[0], d]));
    s.vehMap = new Map((s.veh || []).map(v => [v[0], v]));
    this.buf.push(s);
    if (this.buf.length > 30) this.buf.shift();
    this.latest = s;
  }

  // Interpolated view of the world for rendering.
  sample() {
    if (!this.buf.length) return null;
    const t = performance.now() + this.offset - INTERP_DELAY;
    let a = this.buf[0], b = this.buf[0];
    for (let i = this.buf.length - 1; i >= 0; i--) {
      if (this.buf[i].ts <= t) { a = this.buf[i]; b = this.buf[i + 1] || a; break; }
    }
    const k = b === a ? 0 : Math.max(0, Math.min(1, (t - a.ts) / (b.ts - a.ts)));

    const cows = new Map();
    for (const cb of b.cows) {
      const ca = a.cowMap.get(cb[0]);
      // [x, z, yaw, state, y, type, hp]
      cows.set(cb[0], ca
        ? [lerp(ca[2], cb[2], k), lerp(ca[3], cb[3], k), lerpAngle(ca[4], cb[4], k), cb[6], lerp(ca[7], cb[7], k), cb[1], cb[5]]
        : [cb[2], cb[3], cb[4], cb[6], cb[7], cb[1], cb[5]]);
    }
    const players = new Map();
    for (const pb of b.players) {
      const pa = a.playerMap.get(pb.id);
      players.set(pb.id, pa ? {
        ...pb, x: lerp(pa.x, pb.x, k), y: lerp(pa.y, pb.y, k), z: lerp(pa.z, pb.z, k),
        yaw: lerpAngle(pa.yaw, pb.yaw, k), pitch: lerp(pa.pitch, pb.pitch, k),
      } : pb);
    }
    const dogs = new Map();
    for (const db of b.dogs || []) {
      const da = a.dogMap?.get(db[0]);
      dogs.set(db[0], da ? [lerp(da[2], db[2], k), lerp(da[3], db[3], k), lerpAngle(da[4], db[4], k), db[5], db[1]] : [db[2], db[3], db[4], db[5], db[1]]);
    }
    const veh = new Map();
    for (const vb of b.veh || []) {
      const va = a.vehMap?.get(vb[0]);
      veh.set(vb[0], va
        ? { x: lerp(va[1], vb[1], k), z: lerp(va[2], vb[2], k), yaw: lerpAngle(va[3], vb[3], k), speed: lerp(va[4], vb[4], k), steer: lerp(va[5], vb[5], k) }
        : { x: vb[1], z: vb[2], yaw: vb[3], speed: vb[4], steer: vb[5] });
    }
    return { cows, players, dogs, veh };
  }
}

const lerp = (a, b, k) => a + (b - a) * k;
function lerpAngle(a, b, k) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}
