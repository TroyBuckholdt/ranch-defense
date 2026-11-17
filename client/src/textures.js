// Procedural textures drawn on canvases, so the prototype needs no downloaded art.
// Each one gets swapped for real photo-based textures once the ranch footage is in.
import * as THREE from 'three';
import { texURL } from './gltf.js';

let anisotropy = 4;
export function setAnisotropy(a) { anisotropy = a; }

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function tex(c, repeat = [1, 1], color = true) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  t.anisotropy = anisotropy;
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// deterministic random so textures look the same on every machine
function rand(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function speckle(g, w, h, n, colors, rmin, rmax, r) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = colors[Math.floor(r() * colors.length)];
    g.globalAlpha = 0.25 + r() * 0.5;
    const s = rmin + r() * (rmax - rmin);
    g.fillRect(r() * w, r() * h, s, s * (0.5 + r()));
  }
  g.globalAlpha = 1;
}

const cache = {};
const once = (k, f) => cache[k] || (cache[k] = f());

export const grass = () => once('grass', () => {
  const [c, g] = canvas(512); const r = rand(1);
  g.fillStyle = '#4a5a2a'; g.fillRect(0, 0, 512, 512);
  // big patches of dry / lush
  for (let i = 0; i < 60; i++) {
    const x = r() * 512, y = r() * 512, rad = 30 + r() * 90;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    const col = r() < 0.5 ? '120,110,60' : '50,75,30';
    gr.addColorStop(0, `rgba(${col},0.45)`); gr.addColorStop(1, `rgba(${col},0)`);
    g.fillStyle = gr; g.fillRect(0, 0, 512, 512);
  }
  speckle(g, 512, 512, 9000, ['#5f7134', '#3b4a20', '#7a7a3e', '#2f3d18', '#8b8450'], 1, 3, r);
  return tex(c, [60, 60]);
});

export const dirt = () => once('dirt', () => {
  const [c, g] = canvas(256); const r = rand(2);
  g.fillStyle = '#6b5a43'; g.fillRect(0, 0, 256, 256);
  speckle(g, 256, 256, 4000, ['#7d6a50', '#5a4a36', '#8a785c', '#4a3d2c'], 1, 4, r);
  return tex(c, [4, 4]);
});

function boards(w, h, n, base, vertical, r, gap = '#00000088') {
  const [c, g] = canvas(w, h);
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  const size = (vertical ? w : h) / n;
  for (let i = 0; i < n; i++) {
    const shade = (r() - 0.5) * 30;
    g.fillStyle = `rgba(${shade > 0 ? '255,255,255' : '0,0,0'},${Math.abs(shade) / 255 * 2})`;
    if (vertical) g.fillRect(i * size, 0, size, h); else g.fillRect(0, i * size, w, size);
    // grain
    g.strokeStyle = 'rgba(0,0,0,0.12)';
    for (let k = 0; k < 6; k++) {
      g.beginPath();
      const o = i * size + r() * size;
      if (vertical) { g.moveTo(o, 0); g.bezierCurveTo(o + r() * 6 - 3, h * 0.3, o + r() * 6 - 3, h * 0.7, o, h); }
      else { g.moveTo(0, o); g.bezierCurveTo(w * 0.3, o + r() * 6 - 3, w * 0.7, o + r() * 6 - 3, w, o); }
      g.stroke();
    }
    g.fillStyle = gap;
    if (vertical) g.fillRect(i * size, 0, 2, h); else g.fillRect(0, i * size, w, 2);
  }
  return [c, g];
}

export const siding = () => once('siding', () => {
  const r = rand(3);
  const [c, g] = boards(256, 256, 10, '#d8d2c2', false, r, '#5a544a');
  // weathering + peeling paint
  speckle(g, 256, 256, 1600, ['#a59d8a', '#8a8070', '#efe9dc'], 1, 4, r);
  for (let i = 0; i < 30; i++) {
    g.fillStyle = 'rgba(80,60,40,0.25)';
    g.fillRect(r() * 256, r() * 256, 4 + r() * 18, 2 + r() * 4);
  }
  return tex(c, [1, 1]);
});

export const barnWood = () => once('barnWood', () => {
  const r = rand(4);
  const [c, g] = boards(256, 256, 8, '#7a2a1e', true, r, '#2a0d08');
  speckle(g, 256, 256, 2000, ['#5e1f15', '#8f3a2b', '#4a1a12', '#9a6b55'], 1, 4, r);
  return tex(c, [1, 1]);
});

export const floorWood = () => once('floorWood', () => {
  const r = rand(5);
  const [c, g] = boards(256, 256, 8, '#6e4a2c', true, r, '#2a1a0e');
  for (let i = 0; i < 8; i++) { // board ends
    g.fillStyle = '#2a1a0e';
    g.fillRect(i * 32, r() * 256, 32, 2);
  }
  speckle(g, 256, 256, 1500, ['#5a3a22', '#7e5838', '#4a3020'], 1, 3, r);
  return tex(c, [6, 4]);
});

export const plank = () => once('plank', () => {
  const r = rand(6);
  const [c, g] = boards(256, 64, 1, '#8a6a48', false, r, '#00000000');
  speckle(g, 256, 64, 600, ['#6d5236', '#a07e58', '#5a4430'], 1, 3, r);
  g.fillStyle = '#222'; // nails
  for (const x of [10, 246]) { g.beginPath(); g.arc(x, 20, 3, 0, 7); g.arc(x, 44, 3, 0, 7); g.fill(); }
  return tex(c, [1, 1]);
});

export const wallpaper = () => once('wallpaper', () => {
  const [c, g] = canvas(256); const r = rand(7);
  g.fillStyle = '#7d6f55'; g.fillRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(60,45,30,0.35)'; g.lineWidth = 2;
  for (let x = 0; x < 256; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 256); g.stroke(); }
  g.fillStyle = 'rgba(120,40,30,0.25)';
  for (let x = 16; x < 256; x += 32) for (let y = 16; y < 256; y += 40) { g.beginPath(); g.arc(x, y, 5, 0, 7); g.fill(); }
  // water stains
  for (let i = 0; i < 8; i++) {
    const x = r() * 256, y = r() * 256, rad = 20 + r() * 60;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, 'rgba(40,30,15,0.35)'); gr.addColorStop(1, 'rgba(40,30,15,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  }
  return tex(c, [1, 1]);
});

export const shingles = () => once('shingles', () => {
  const [c, g] = canvas(256); const r = rand(8);
  g.fillStyle = '#3a3633'; g.fillRect(0, 0, 256, 256);
  for (let row = 0; row < 16; row++) {
    const off = (row % 2) * 16;
    for (let x = -32; x < 256; x += 32) {
      const s = 40 + r() * 30;
      g.fillStyle = `rgb(${s},${s * 0.95},${s * 0.9})`;
      g.fillRect(x + off + 1, row * 16 + 1, 30, 14);
    }
  }
  return tex(c, [6, 3]);
});

export const metal = () => once('metal', () => {
  const [c, g] = canvas(256); const r = rand(9);
  const gr = g.createLinearGradient(0, 0, 32, 0);
  gr.addColorStop(0, '#8d9296'); gr.addColorStop(0.5, '#c2c6c8'); gr.addColorStop(1, '#8d9296');
  g.fillStyle = gr;
  for (let x = 0; x < 256; x += 32) { g.save(); g.translate(x, 0); g.fillRect(0, 0, 32, 256); g.restore(); }
  // rust streaks
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(${120 + r() * 40},${50 + r() * 20},20,${0.15 + r() * 0.3})`;
    g.fillRect(r() * 256, r() * 256, 2 + r() * 6, 10 + r() * 60);
  }
  return tex(c, [4, 2]);
});

export const hay = () => once('hay', () => {
  const [c, g] = canvas(256); const r = rand(10);
  g.fillStyle = '#b0904a'; g.fillRect(0, 0, 256, 256);
  g.lineWidth = 1.5;
  for (let i = 0; i < 1800; i++) {
    g.strokeStyle = ['#d2b066', '#8a6a30', '#c8a458', '#7a5c28'][Math.floor(r() * 4)];
    const x = r() * 256, y = r() * 256, a = r() * 0.6 - 0.3;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * 20, y + Math.sin(a) * 20); g.stroke();
  }
  return tex(c, [2, 1]);
});

export const bark = () => once('bark', () => {
  const [c, g] = canvas(128); const r = rand(11);
  g.fillStyle = '#3d2f22'; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 70; i++) {
    g.fillStyle = ['#2a2018', '#4e3d2c', '#33271c'][Math.floor(r() * 3)];
    g.fillRect(r() * 128, 0, 2 + r() * 5, 128);
  }
  return tex(c, [1, 2]);
});

export const foliage = () => once('foliage', () => {
  const [c, g] = canvas(128); const r = rand(12);
  g.fillStyle = '#2c3d1c'; g.fillRect(0, 0, 128, 128);
  speckle(g, 128, 128, 1400, ['#3d5226', '#1f2c13', '#4f6430', '#283a18'], 2, 6, r);
  return tex(c, [2, 2]);
});

// Zombie Holstein hide: white with black patches, rot, sores and blood.
export const cowHide = () => once('cowHide', () => {
  const [c, g] = canvas(512); const r = rand(13);
  g.fillStyle = '#c9c4b0'; g.fillRect(0, 0, 512, 512);
  // black patches (blobby)
  for (let i = 0; i < 14; i++) {
    const cx = r() * 512, cy = r() * 512, rad = 30 + r() * 70;
    g.fillStyle = '#1a1816';
    g.beginPath();
    for (let a = 0; a < Math.PI * 2; a += 0.3) {
      const rr = rad * (0.7 + r() * 0.5);
      const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr;
      a === 0 ? g.moveTo(px, py) : g.lineTo(px, py);
    }
    g.closePath(); g.fill();
  }
  // sickly green-grey rot over everything
  for (let i = 0; i < 40; i++) {
    const x = r() * 512, y = r() * 512, rad = 20 + r() * 80;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, 'rgba(90,110,50,0.55)'); gr.addColorStop(1, 'rgba(90,110,50,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 512, 512);
  }
  // open wounds
  for (let i = 0; i < 18; i++) {
    const x = r() * 512, y = r() * 512, rad = 6 + r() * 22;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, 'rgba(70,0,0,1)'); gr.addColorStop(0.5, 'rgba(130,15,15,0.9)'); gr.addColorStop(1, 'rgba(90,20,10,0)');
    g.fillStyle = gr; g.beginPath(); g.ellipse(x, y, rad, rad * 0.6, r() * 3, 0, 7); g.fill();
  }
  // dripping blood
  for (let i = 0; i < 25; i++) {
    g.fillStyle = `rgba(${100 + r() * 50},5,5,0.7)`;
    g.fillRect(r() * 512, r() * 512, 2 + r() * 3, 20 + r() * 60);
  }
  speckle(g, 512, 512, 3000, ['#00000040', '#ffffff30', '#40501f50'], 1, 3, r);
  return tex(c, [1, 1]);
});

export const blood = () => once('blood', () => {
  const [c, g] = canvas(128); const r = rand(14);
  g.clearRect(0, 0, 128, 128);
  for (let i = 0; i < 14; i++) {
    const x = 64 + (r() - 0.5) * 70, y = 64 + (r() - 0.5) * 70, rad = 6 + r() * 26;
    g.fillStyle = `rgba(${70 + r() * 40},0,0,${0.7 + r() * 0.3})`;
    g.beginPath(); g.arc(x, y, rad, 0, 7); g.fill();
  }
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
});

export const flare = () => once('flare', () => {
  const [c, g] = canvas(128);
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,230,1)'); gr.addColorStop(0.2, 'rgba(255,200,90,0.9)');
  gr.addColorStop(0.5, 'rgba(255,120,20,0.35)'); gr.addColorStop(1, 'rgba(255,80,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  // star spikes
  g.globalCompositeOperation = 'lighter';
  g.fillStyle = 'rgba(255,230,160,0.8)';
  for (let i = 0; i < 6; i++) {
    g.save(); g.translate(64, 64); g.rotate((i / 6) * Math.PI * 2 + 0.3);
    g.beginPath(); g.moveTo(0, -3); g.lineTo(62, 0); g.lineTo(0, 3); g.fill(); g.restore();
  }
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
});

export const smoke = () => once('smoke', () => {
  const [c, g] = canvas(64);
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,0.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
});

export function nameTag(text, color = '#ffffff') {
  const [c, g] = canvas(256, 64);
  g.font = 'bold 34px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,0.85)';
  g.strokeText(text, 128, 32);
  g.fillStyle = color; g.fillText(text, 128, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------------------
// Hacienda set, matched to the ranch photos: white stucco, terracotta, ochre
// floor tiles with a black/white encaustic border, clay barrel roof tiles,
// white Brahman hide.

export const stucco = () => once('stucco', () => {
  const [c, g] = canvas(256); const r = rand(21);
  g.fillStyle = '#ece8df'; g.fillRect(0, 0, 256, 256);
  speckle(g, 256, 256, 5000, ['#ddd8cc', '#f6f3ec', '#d2ccbe', '#e4dfd2'], 1, 3, r);
  // tropical grime: faint streaks running down
  for (let i = 0; i < 25; i++) {
    const x = r() * 256;
    const gr = g.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, 'rgba(120,110,90,0)'); gr.addColorStop(1, `rgba(120,110,90,${0.05 + r() * 0.08})`);
    g.fillStyle = gr; g.fillRect(x, r() * 100, 2 + r() * 8, 256);
  }
  return tex(c, [1, 1]);
});

export const terracotta = () => once('terracotta', () => {
  const [c, g] = canvas(256); const r = rand(22);
  g.fillStyle = '#7a4a36'; g.fillRect(0, 0, 256, 256);
  const n = 4, s = 256 / n;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const v = r();
    g.fillStyle = `rgb(${150 + v * 35},${78 + v * 22},${55 + v * 15})`;
    g.fillRect(x * s + 2, y * s + 2, s - 4, s - 4);
    // worn sheen
    const gr = g.createRadialGradient(x * s + s / 2, y * s + s / 2, 2, x * s + s / 2, y * s + s / 2, s * 0.7);
    gr.addColorStop(0, 'rgba(255,220,190,0.12)'); gr.addColorStop(1, 'rgba(0,0,0,0.08)');
    g.fillStyle = gr; g.fillRect(x * s + 2, y * s + 2, s - 4, s - 4);
  }
  speckle(g, 256, 256, 1500, ['#5a3020', '#b0705a', '#8a5040'], 1, 2, r);
  return tex(c, [1, 1]);
});

export const ochreTile = () => once('ochreTile', () => {
  const [c, g] = canvas(256); const r = rand(23);
  g.fillStyle = '#9a7a4a'; g.fillRect(0, 0, 256, 256);
  const n = 4, s = 256 / n;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const v = r();
    g.fillStyle = `rgb(${205 + v * 25},${150 + v * 20},${62 + v * 18})`;
    g.fillRect(x * s + 1.5, y * s + 1.5, s - 3, s - 3);
  }
  speckle(g, 256, 256, 900, ['#c08a40', '#e8b870', '#b88040'], 1, 2, r);
  return tex(c, [1, 1]);
});

// the black / white / grey geometric border running around the rooms
export const tileBorder = () => once('tileBorder', () => {
  const [c, g] = canvas(256, 64);
  g.fillStyle = '#e9e3d6'; g.fillRect(0, 0, 256, 64);
  g.fillStyle = '#1e1e22';
  g.fillRect(0, 0, 256, 6); g.fillRect(0, 58, 256, 6);
  for (let x = 0; x < 256; x += 32) {
    g.fillStyle = '#1e1e22';
    g.beginPath(); g.moveTo(x, 32); g.lineTo(x + 16, 10); g.lineTo(x + 32, 32); g.lineTo(x + 16, 54); g.closePath(); g.fill();
    g.fillStyle = '#e9e3d6';
    g.beginPath(); g.moveTo(x + 8, 32); g.lineTo(x + 16, 20); g.lineTo(x + 24, 32); g.lineTo(x + 16, 44); g.closePath(); g.fill();
    g.fillStyle = '#d0a040';
    g.fillRect(x + 14, 30, 4, 4);
    g.fillStyle = '#6a6a70';
    g.beginPath(); g.moveTo(x, 6); g.lineTo(x + 8, 6); g.lineTo(x, 16); g.fill();
    g.beginPath(); g.moveTo(x + 32, 58); g.lineTo(x + 24, 58); g.lineTo(x + 32, 48); g.fill();
  }
  return tex(c, [1, 1]);
});

export const clayRoof = () => once('clayRoof', () => {
  const [c, g] = canvas(256); const r = rand(24);
  g.fillStyle = '#5a2a1a'; g.fillRect(0, 0, 256, 256);
  for (let row = 0; row < 8; row++) {
    for (let x = 0; x < 256; x += 21) {
      const v = r();
      const gr = g.createLinearGradient(x, 0, x + 21, 0);
      const base = `${150 + v * 40},${70 + v * 25},${45 + v * 15}`;
      gr.addColorStop(0, `rgb(${base})`); gr.addColorStop(0.5, `rgba(235,150,110,1)`); gr.addColorStop(1, `rgb(${base})`);
      g.fillStyle = gr;
      g.fillRect(x + 1, row * 32, 19, 30);
      g.fillStyle = 'rgba(30,10,5,0.45)';
      g.fillRect(x + 1, row * 32 + 26, 19, 4);
    }
  }
  speckle(g, 256, 256, 1600, ['#3a2a1a80', '#2a3a1a60', '#00000050'], 1, 4, r); // lichen + grime
  return tex(c, [1, 1]);
});

// dark-stained ceiling: beams with terracotta between (like the veranda photo)
export const beamCeiling = () => once('beamCeiling', () => {
  const [c, g] = canvas(256); const r = rand(25);
  g.fillStyle = '#b0785a'; g.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 16) { g.fillStyle = `rgba(60,25,10,${0.2 + r() * 0.2})`; g.fillRect(0, y, 256, 2); }
  return tex(c, [1, 1]);
});

export const darkWood = () => once('darkWood', () => {
  const r = rand(26);
  const [c, g] = boards(256, 256, 4, '#3a2416', true, r, '#1a0e06');
  speckle(g, 256, 256, 800, ['#2a180e', '#4a301e'], 1, 3, r);
  return tex(c, [1, 1]);
});

// Real Brahman hide (from the ranch's cattle video) with zombie rot, wounds and blood on top.
export const brahmanHide = () => once('brahmanHide', () => {
  const [c, g] = canvas(1024);
  const t = tex(c, [1, 1]);
  const decorate = () => {
    const r = rand(27);
    for (let i = 0; i < 40; i++) { // rot: mottled grey-green and bruising
      const x = r() * 1024, y = r() * 1024, rad = 30 + r() * 120;
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      const col = r() < 0.6 ? '80,100,60' : '80,50,70';
      gr.addColorStop(0, `rgba(${col},0.42)`); gr.addColorStop(1, `rgba(${col},0)`);
      g.fillStyle = gr; g.fillRect(0, 0, 1024, 1024);
    }
    g.strokeStyle = 'rgba(40,30,25,0.75)'; g.lineWidth = 9; // the ranch brand
    g.font = 'bold 96px serif'; g.strokeText('JE', 600, 280);
    t.needsUpdate = true;
  };
  g.fillStyle = '#cfcabe'; g.fillRect(0, 0, 1024, 1024);
  const img = new Image();
  img.onload = () => {
    for (let x = 0; x < 2; x++) for (let y = 0; y < 2; y++) g.drawImage(img, x * 512, y * 512, 512, 512);
    decorate();
  };
  img.onerror = decorate;
  img.src = texURL('brahman_hide.jpg');
  return t;
});

export const palmBark = () => once('palmBark', () => {
  const [c, g] = canvas(64, 256); const r = rand(28);
  g.fillStyle = '#7a6a58'; g.fillRect(0, 0, 64, 256);
  for (let y = 0; y < 256; y += 10) {
    g.fillStyle = `rgba(40,30,20,${0.35 + r() * 0.3})`; g.fillRect(0, y, 64, 3);
    g.fillStyle = 'rgba(200,190,170,0.15)'; g.fillRect(0, y + 3, 64, 2);
  }
  return tex(c, [1, 3]);
});

// a single palm frond with leaflets, drawn with transparency
export const frond = () => once('frond', () => {
  const [c, g] = canvas(512, 128); const r = rand(29);
  g.clearRect(0, 0, 512, 128);
  for (let x = 6; x < 506; x += 4) {
    const k = x / 512, len = 52 * Math.sin(k * Math.PI) ** 0.7 + 6;
    for (const s of [-1, 1]) {
      const shade = 0.75 + r() * 0.35, dry = k > 0.85 && r() < 0.5;
      g.strokeStyle = dry ? `rgb(${140 * shade},${120 * shade},${60 * shade})` : `rgb(${50 * shade},${88 * shade},${32 * shade})`;
      g.lineWidth = 2.6;
      g.beginPath(); g.moveTo(x, 64); g.quadraticCurveTo(x + 8, 64 + s * len * 0.6, x + 16, 64 + s * len); g.stroke();
    }
  }
  g.strokeStyle = '#6a6a3a'; g.lineWidth = 4;
  g.beginPath(); g.moveTo(0, 64); g.lineTo(512, 64); g.stroke();
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
});

export const lushGrass = () => once('lushGrass', () => {
  const [c, g] = canvas(512); const r = rand(30);
  g.fillStyle = '#4f6a2a'; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 60; i++) {
    const x = r() * 512, y = r() * 512, rad = 30 + r() * 90;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    const col = r() < 0.4 ? '110,120,50' : '45,85,30';
    gr.addColorStop(0, `rgba(${col},0.45)`); gr.addColorStop(1, `rgba(${col},0)`);
    g.fillStyle = gr; g.fillRect(0, 0, 512, 512);
  }
  speckle(g, 512, 512, 9000, ['#5f8034', '#3b5a20', '#7a8a3e', '#2f4d18', '#6a8a40'], 1, 3, r);
  return tex(c, [60, 60]);
});

export const sand = () => once('sand', () => {
  const [c, g] = canvas(256); const r = rand(31);
  g.fillStyle = '#b8a07a'; g.fillRect(0, 0, 256, 256);
  speckle(g, 256, 256, 5000, ['#a89070', '#c8b08a', '#9a8264', '#d0bc98'], 1, 3, r);
  return tex(c, [4, 4]);
});

export const waterNormals = () => once('waterNormals', () => {
  const N = 256; const [c, g] = canvas(N); const r = rand(40);
  const h = new Float32Array(N * N);
  for (let o = 0; o < 5; o++) { // sum of wrapped sine waves = seamless
    const kx = 1 + Math.floor(r() * 6), kz = 1 + Math.floor(r() * 6), ph = r() * 6.28, amp = 1 / (o + 1);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) h[y * N + x] += Math.sin((x * kx + y * kz) / N * 6.283 * (o + 1) + ph) * amp;
  }
  const img = g.createImageData(N, N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = h[y * N + (x + 1) % N] - h[y * N + (x + N - 1) % N], dy = h[((y + 1) % N) * N + x] - h[((y + N - 1) % N) * N + x];
    const nx = -dx * 2, ny = -dy * 2, nz = 1, l = Math.hypot(nx, ny, nz), i = (y * N + x) * 4;
    img.data[i] = (nx / l * 0.5 + 0.5) * 255; img.data[i + 1] = (ny / l * 0.5 + 0.5) * 255; img.data[i + 2] = (nz / l * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return tex(c, [1, 1], false);
});

// soft low-frequency noise used to break up texture tiling on the terrain
export const macroNoise = () => once('macroNoise', () => {
  const [c, g] = canvas(256); const r = rand(41);
  g.fillStyle = '#808080'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 220; i++) {
    const x = r() * 256, y = r() * 256, rad = 10 + r() * 50, v = r() < 0.5 ? 255 : 0;
    for (const [ox, oy] of [[0, 0], [256, 0], [-256, 0], [0, 256], [0, -256]]) {
      const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad);
      gr.addColorStop(0, `rgba(${v},${v},${v},0.18)`); gr.addColorStop(1, `rgba(${v},${v},${v},0)`);
      g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
    }
  }
  return tex(c, [1, 1], false);
});

// Paint zombie rot, wounds, blood runs and the ranch brand onto a real hide texture.
export function zombify(image) {
  // Sickly and filthy, but no wounds: the zombie detail (mange, veins, mud) is added by
  // the hide shader in cow.js, so this only dulls and grimes the clean white coat.
  const S = 1024;
  const [c, g] = canvas(S);
  g.drawImage(image, 0, 0, S, S);
  const r = rand(77);
  for (let i = 0; i < 46; i++) { // blotchy grey-green pallor and dull bruise-grey patches
    const x = r() * S, y = r() * S, rad = 25 + r() * 110;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    const col = r() < 0.7 ? '96,104,72' : '86,78,92';
    gr.addColorStop(0, `rgba(${col},0.32)`); gr.addColorStop(1, `rgba(${col},0)`);
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
  }
  for (let i = 0; i < 30; i++) { // dried dirt smears
    const x = r() * S, y = r() * S, rad = 10 + r() * 34;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, 'rgba(70,56,40,0.55)'); gr.addColorStop(1, 'rgba(70,56,40,0)');
    g.fillStyle = gr; g.beginPath(); g.ellipse(x, y, rad * 1.8, rad * 0.5, r() * 3, 0, 7); g.fill();
  }
  speckle(g, S, S, 5000, ['#00000028', '#3a4a2040', '#4a3a2840'], 1, 3, r);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.flipY = false; // glTF texture convention
  t.anisotropy = anisotropy;
  return t;
}

// Chalk-on-wood sign for a wall-buy station
export function buySign(name, cost) {
  const [c, g] = canvas(512, 256);
  g.fillStyle = '#2a1a10'; g.fillRect(0, 0, 512, 256);
  const r = rand(name.length * 7);
  for (let i = 0; i < 9; i++) { g.fillStyle = `rgba(${60 + r() * 30},${35 + r() * 20},20,0.6)`; g.fillRect(0, i * 29, 512, 26); }
  g.strokeStyle = 'rgba(240,235,220,0.9)'; g.lineWidth = 5; g.strokeRect(14, 14, 484, 228);
  g.fillStyle = '#f2ecd8'; g.textAlign = 'center';
  g.font = 'bold 52px Impact, Arial Narrow, sans-serif'; g.fillText(name, 256, 108);
  g.fillStyle = '#c8ff4d'; g.font = 'bold 64px Impact, Arial Narrow, sans-serif'; g.fillText('$' + cost, 256, 196);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// The round pebble mosaic in the front walk: white river pebbles set on edge, the ranch's
// brand picked out in black pebbles (a wide arc with a stem rising from its middle to a hook,
// and a cross hanging below), like the photo of the real one.
export function pebbleBrand() {
  const S = 1024, [c, g] = canvas(S, S);
  g.fillStyle = '#8b8378'; g.fillRect(0, 0, S, S);               // mortar
  const r = rand(5);
  // the brand as a mask: pebbles inside it are black
  const [mc, mg] = canvas(S, S);
  mg.fillStyle = '#000'; mg.fillRect(0, 0, S, S);
  mg.strokeStyle = '#fff'; mg.lineCap = 'round'; mg.lineWidth = 46;
  mg.beginPath(); mg.arc(S / 2, S * 0.18, S * 0.43, Math.PI * 0.22, Math.PI * 0.78); mg.stroke();      // the arc
  mg.beginPath(); mg.moveTo(S / 2, S * 0.61); mg.bezierCurveTo(S * 0.5, S * 0.45, S * 0.56, S * 0.33, S * 0.66, S * 0.27); mg.stroke();  // stem and hook
  mg.beginPath(); mg.moveTo(S / 2, S * 0.61); mg.lineTo(S / 2, S * 0.86); mg.stroke();                 // the cross below
  mg.beginPath(); mg.moveTo(S * 0.43, S * 0.75); mg.lineTo(S * 0.57, S * 0.75); mg.stroke();
  for (const sx of [-1, 1]) { mg.beginPath(); mg.moveTo(S / 2 + sx * S * 0.33, S * 0.47); mg.lineTo(S / 2 + sx * S * 0.4, S * 0.38); mg.stroke(); }   // flicks at the arc's ends
  const mask = mg.getImageData(0, 0, S, S).data;
  for (let i = 0; i < 26000; i++) {
    const x = r() * S, y = r() * S;
    const rx = 7 + r() * 9, ry = 4 + r() * 5, a = r() * Math.PI;
    const dark = mask[((y | 0) * S + (x | 0)) * 4] > 128;
    const v = dark ? 20 + r() * 30 : 205 + r() * 45;
    g.fillStyle = `rgb(${v | 0},${(v * (dark ? 1 : 0.98)) | 0},${(v * (dark ? 1 : 0.94)) | 0})`;
    g.beginPath(); g.ellipse(x, y, rx, ry, a, 0, Math.PI * 2); g.fill();
    g.fillStyle = dark ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.35)';
    g.beginPath(); g.ellipse(x - rx * 0.3, y - ry * 0.3, rx * 0.35, ry * 0.3, a, 0, Math.PI * 2); g.fill();
  }
  // a ring of black pebbles round the edge
  g.strokeStyle = '#2a2622'; g.lineWidth = 16; g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 12, 0, Math.PI * 2); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

// The ranch's name on a hand-painted Talavera tile plaque (by the front door): white glaze,
// a cobalt border with yellow flowers at the corners, an emerald, the name in cobalt script.
export function ranchPlaque() {
  const [c, g] = canvas(768, 384);
  g.fillStyle = '#f3efe4'; g.fillRect(0, 0, 768, 384);
  const r = rand(77);
  for (let i = 0; i < 260; i++) { g.strokeStyle = `rgba(150,140,120,${0.05 + r() * 0.08})`; g.lineWidth = 1; g.beginPath(); const x = r() * 768, y = r() * 384; g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 40, y + (r() - 0.5) * 40); g.stroke(); }
  g.strokeStyle = 'rgba(120,115,105,0.55)'; g.lineWidth = 3;                    // the tile joints
  for (const x of [192, 384, 576]) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 384); g.stroke(); }
  g.beginPath(); g.moveTo(0, 192); g.lineTo(768, 192); g.stroke();
  g.strokeStyle = '#1f3c8c'; g.lineWidth = 16; g.strokeRect(14, 14, 740, 356);
  g.strokeStyle = '#d9a520'; g.lineWidth = 4; g.strokeRect(30, 30, 708, 324);
  for (const [x, y] of [[44, 44], [724, 44], [44, 340], [724, 340]]) {          // corner flowers
    for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; g.fillStyle = '#1f3c8c'; g.beginPath(); g.ellipse(x + Math.cos(a) * 14, y + Math.sin(a) * 14, 9, 6, a, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = '#e8b31c'; g.beginPath(); g.arc(x, y, 8, 0, Math.PI * 2); g.fill();
  }
  g.fillStyle = '#1f3c8c'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = 'italic bold 58px Georgia, "DejaVu Serif", serif'; g.fillText('Rancho', 384, 118);
  g.font = 'italic bold 96px Georgia, "DejaVu Serif", serif'; g.fillText('La Esmeralda', 384, 238, 700);
  // the emerald: a cut green gem under the name
  const ex = 384, ey = 322;
  g.fillStyle = '#138a52'; g.beginPath(); g.moveTo(ex - 34, ey - 10); g.lineTo(ex - 18, ey - 24); g.lineTo(ex + 18, ey - 24); g.lineTo(ex + 34, ey - 10); g.lineTo(ex, ey + 26); g.closePath(); g.fill();
  g.fillStyle = '#3fd08a'; g.beginPath(); g.moveTo(ex - 18, ey - 24); g.lineTo(ex, ey - 10); g.lineTo(ex + 18, ey - 24); g.closePath(); g.fill();
  g.strokeStyle = '#0b5c35'; g.lineWidth = 2; g.beginPath(); g.moveTo(ex - 34, ey - 10); g.lineTo(ex + 34, ey - 10); g.moveTo(ex, ey - 10); g.lineTo(ex, ey + 26); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

// The ranch's name burnt into a board of dark planks (the sign over the gate), with the
// brand, an E in a diamond, at each end.
export function ranchSign() {
  const [c, g] = canvas(1024, 192);
  const r = rand(91);
  for (let i = 0; i < 3; i++) {
    const base = 70 + r() * 18;
    for (let y = i * 64; y < (i + 1) * 64; y++) for (let x = 0; x < 1024; x += 4) {
      const v = base + 14 * Math.sin(x * 0.02 + y * 0.31 + i * 5) + r() * 10;
      g.fillStyle = `rgb(${v | 0},${(v * 0.62) | 0},${(v * 0.38) | 0})`; g.fillRect(x, y, 4, 1);
    }
    g.fillStyle = 'rgba(20,10,5,0.8)'; g.fillRect(0, (i + 1) * 64 - 2, 1024, 2);
  }
  g.fillStyle = '#f0dfb8'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = 'bold 92px Georgia, "DejaVu Serif", serif'; g.fillText('RANCHO LA ESMERALDA', 512, 100, 820);   // squeezed to fit between the diamonds whatever the font
  for (const x of [52, 972]) {
    g.strokeStyle = '#f0dfb8'; g.lineWidth = 7; g.beginPath(); g.moveTo(x, 50); g.lineTo(x + 34, 96); g.lineTo(x, 142); g.lineTo(x - 34, 96); g.closePath(); g.stroke();
    g.font = 'bold 50px Georgia, "DejaVu Serif", serif'; g.fillText('E', x, 100);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

// Floating power-up icon
export function powerIcon(type) {
  const [c, g] = canvas(256);
  const col = { maxammo: '#7cff6b', instakill: '#ff5050', double: '#ffd84a', nuke: '#ffa040', carpenter: '#5ab4ff', firesale: '#ff6ad5' }[type];
  const label = { maxammo: 'AMMO', instakill: 'SKULL', double: 'x2', nuke: 'NUKE', carpenter: 'FIX', firesale: 'SALE' }[type];
  const gr = g.createRadialGradient(128, 128, 10, 128, 128, 128);
  gr.addColorStop(0, col); gr.addColorStop(0.45, col + 'aa'); gr.addColorStop(1, col + '00');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#111'; g.font = 'bold 54px Impact, Arial Narrow, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(label, 128, 132);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// Polished brown marble (the living-room table tops): warm base, soft clouds and fine veins.
export const marble = () => once('marble', () => {
  const [c, g] = canvas(512); const r = rand(77);
  g.fillStyle = '#5b3a28'; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 40; i++) {
    const x = r() * 512, y = r() * 512, rad = 40 + r() * 120;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    const col = r() < 0.5 ? '120,80,55' : '45,26,18';
    gr.addColorStop(0, `rgba(${col},0.5)`); gr.addColorStop(1, `rgba(${col},0)`);
    g.fillStyle = gr; g.fillRect(0, 0, 512, 512);
  }
  g.lineCap = 'round';
  for (let i = 0; i < 26; i++) {
    let x = r() * 512, y = r() * 512, a = r() * Math.PI * 2;
    g.strokeStyle = r() < 0.6 ? `rgba(225,195,160,${0.15 + r() * 0.35})` : `rgba(25,12,8,${0.2 + r() * 0.3})`;
    g.lineWidth = 0.6 + r() * 2.2;
    g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 30; k++) { a += (r() - 0.5) * 0.7; x += Math.cos(a) * 12; y += Math.sin(a) * 12; g.lineTo(x, y); }
    g.stroke();
  }
  return tex(c);
});

// The veranda tablecloth: white leaves on dark green, like the one in the garden photo.
export const leafCloth = () => once('leafCloth', () => {
  const [c, g] = canvas(512); const r = rand(31);
  g.fillStyle = '#25433a'; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 140; i++) {
    const x = r() * 512, y = r() * 512, a = r() * Math.PI * 2, L = 16 + r() * 26;
    g.save(); g.translate(x, y); g.rotate(a);
    g.fillStyle = r() < 0.55 ? 'rgba(225,235,228,0.85)' : 'rgba(95,140,120,0.7)';
    g.beginPath(); g.moveTo(-L, 0); g.quadraticCurveTo(0, -L * 0.42, L, 0); g.quadraticCurveTo(0, L * 0.42, -L, 0); g.fill();
    g.strokeStyle = 'rgba(37,67,58,0.7)'; g.lineWidth = 1; g.beginPath(); g.moveTo(-L, 0); g.lineTo(L, 0); g.stroke();
    g.restore();
  }
  return tex(c, [2, 2]);
});

// Plain white linen tablecloth with a faint weave.
export const linen = () => once('linen', () => {
  const [c, g] = canvas(256); const r = rand(12);
  g.fillStyle = '#f1efe9'; g.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 2) { g.fillStyle = `rgba(0,0,0,${0.015 + r() * 0.02})`; g.fillRect(0, y, 256, 1); }
  for (let x = 0; x < 256; x += 2) { g.fillStyle = `rgba(0,0,0,${0.01 + r() * 0.015})`; g.fillRect(x, 0, 1, 256); }
  return tex(c, [3, 3]);
});

// Woven rugs: 'living' = the charcoal and ivory geometric rug, 'oriental' = the red runner in the den
export const rug = (style) => once('rug-' + style, () => {
  const W = 512, H = style === 'oriental' ? 1024 : 768;
  const [c, g] = canvas(W, H); const r = rand(style.length * 7);
  const pal = style === 'oriental'
    ? { bg: '#7a1f1c', band: '#1f2a44', line: '#d9b77a', motif: '#c8862f', dark: '#3a0f0e' }
    : { bg: '#2c2c2e', band: '#d8d2c4', line: '#8a8478', motif: '#e6e0d2', dark: '#151516' };
  g.fillStyle = pal.bg; g.fillRect(0, 0, W, H);
  // borders
  for (const [inset, col, wdt] of [[10, pal.dark, 14], [30, pal.band, 34], [70, pal.line, 6]]) {
    g.strokeStyle = col; g.lineWidth = wdt; g.strokeRect(inset, inset, W - inset * 2, H - inset * 2);
  }
  // repeating diamonds / medallions in the field
  g.save(); g.beginPath(); g.rect(80, 80, W - 160, H - 160); g.clip();
  const step = style === 'oriental' ? 88 : 64;
  for (let y = 80; y < H - 40; y += step) for (let x = 80; x < W - 40; x += step) {
    const cx = x + step / 2, cy = y + step / 2, s = step * 0.42;
    g.fillStyle = pal.motif; g.beginPath(); g.moveTo(cx, cy - s); g.lineTo(cx + s, cy); g.lineTo(cx, cy + s); g.lineTo(cx - s, cy); g.fill();
    g.fillStyle = pal.bg; g.beginPath(); g.moveTo(cx, cy - s * 0.55); g.lineTo(cx + s * 0.55, cy); g.lineTo(cx, cy + s * 0.55); g.lineTo(cx - s * 0.55, cy); g.fill();
    g.fillStyle = style === 'oriental' ? pal.band : pal.line; g.fillRect(cx - s * 0.16, cy - s * 0.16, s * 0.32, s * 0.32);
  }
  g.restore();
  // border motif: little chevrons
  g.fillStyle = style === 'oriental' ? pal.motif : pal.bg;
  for (let x = 40; x < W - 40; x += 24) for (const y of [36, H - 52]) { g.beginPath(); g.moveTo(x, y + 8); g.lineTo(x + 8, y); g.lineTo(x + 16, y + 8); g.lineTo(x + 8, y + 16); g.fill(); }
  // wear and fibre noise
  for (let i = 0; i < 26000; i++) { g.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '0,0,0'},${r() * 0.06})`; g.fillRect(r() * W, r() * H, 2, 1); }
  const t = tex(c); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t;
});

// The compass-rose medallion set into the front path (seen in the drone photo)
export const compass = () => once('compass', () => {
  const S = 512, [c, g] = canvas(S); const m = S / 2;
  g.fillStyle = '#b4573a'; g.fillRect(0, 0, S, S);
  const ring = (rad, col, w) => { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.arc(m, m, rad, 0, Math.PI * 2); g.stroke(); };
  g.fillStyle = '#e9dcc4'; g.beginPath(); g.arc(m, m, 240, 0, Math.PI * 2); g.fill();
  ring(236, '#7a3a26', 10); ring(214, '#7a3a26', 4); ring(120, '#7a3a26', 3);
  const star = (n, outer, inner, rot, a, b) => {
    for (let i = 0; i < n; i++) {
      const ang = rot + (i / n) * Math.PI * 2;
      for (const [side, col] of [[-1, a], [1, b]]) {
        g.fillStyle = col; g.beginPath(); g.moveTo(m, m);
        g.lineTo(m + Math.cos(ang) * outer, m + Math.sin(ang) * outer);
        const s2 = ang + side * Math.PI / n;
        g.lineTo(m + Math.cos(s2) * inner, m + Math.sin(s2) * inner); g.fill();
      }
    }
  };
  star(8, 150, 46, Math.PI / 8 - Math.PI / 2, '#9c4a30', '#5e2c1d');
  star(4, 205, 52, -Math.PI / 2, '#c9a77a', '#7a3a26');
  g.fillStyle = '#5e2c1d'; g.beginPath(); g.arc(m, m, 14, 0, Math.PI * 2); g.fill();
  return tex(c);
});

// Dense leaf clump for tree crowns: thousands of overlapping leaves with gaps (alpha), seamless.
export const leafClump = () => once('leafClump', () => {
  const S = 512, [c, g] = canvas(S); const r = rand(91);
  g.clearRect(0, 0, S, S);
  for (let i = 0; i < 2400; i++) {
    const x = r() * S, y = r() * S, a = r() * Math.PI * 2, L = 8 + r() * 13, W = L * (0.36 + r() * 0.12);
    const sh = 0.5 + r() * 0.65, warm = r() < 0.15;
    const col = warm ? `rgb(${Math.round(88 * sh)},${Math.round(110 * sh)},${Math.round(36 * sh)})` : `rgb(${Math.round(46 * sh)},${Math.round(96 * sh)},${Math.round(32 * sh)})`;
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
      const px = x + ox, py = y + oy;
      if (px < -30 || px > S + 30 || py < -30 || py > S + 30) continue;
      g.save(); g.translate(px, py); g.rotate(a);
      g.fillStyle = col; g.beginPath(); g.ellipse(0, 0, L, W, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(170,205,110,0.3)'; g.lineWidth = 1; g.beginPath(); g.moveTo(-L * 0.9, 0); g.lineTo(L * 0.9, 0); g.stroke();
      g.restore();
    }
  }
  return tex(c, [2, 1]);
});
