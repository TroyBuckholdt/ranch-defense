// One server does everything: serves the built game files and runs multiplayer over
// WebSockets on the same port. That keeps hosting to a single free web service.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Room } from './game.js';

const PORT = process.env.PORT || 3000;
const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
  '.glb': 'model/gltf-binary', '.spz': 'application/octet-stream', '.ply': 'application/octet-stream',
  '.splat': 'application/octet-stream', '.mp4': 'video/mp4', '.ico': 'image/x-icon', '.wasm': 'application/wasm', '.hdr': 'application/octet-stream',
};

// Files are compressed once (brotli or gzip) and kept in memory: the game's code shrinks
// about 4x, which matters on phones. Built code has hashed names and is cached for good;
// everything else (models, textures) is revalidated after an hour, so updates show up.
const COMPRESS = new Set(['.html', '.js', '.css', '.json', '.svg', '.hdr', '.glb', '.wasm']);
const packed = new Map(); // file|encoding -> { buf, etag }
function getPacked(file, enc, stat) {
  const key = file + '|' + enc;
  const hit = packed.get(key);
  if (hit && hit.mtime === stat.mtimeMs) return hit;
  const raw = fs.readFileSync(file);
  const buf = enc === 'br' ? zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9 } })
    : enc === 'gzip' ? zlib.gzipSync(raw, { level: 9 }) : raw;
  // keep the compressed copy only if it actually helps
  const entry = buf.length < raw.length * 0.92 ? { buf, enc, mtime: stat.mtimeMs } : { buf: null, enc: null, mtime: stat.mtimeMs };
  packed.set(key, entry);
  return entry;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/health') { res.end('ok'); return; }
  let file = path.normalize(path.join(DIST, decodeURIComponent(url.pathname)));
  if (!file.startsWith(DIST)) { res.writeHead(403); res.end(); return; }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404); res.end('Run `npm run build` first.'); return; }
  const stat = fs.statSync(file);
  const ext = path.extname(file).toLowerCase();
  const hashed = /-[A-Za-z0-9_-]{8}\.(js|css)$/.test(file);
  const cache = hashed ? 'public, max-age=31536000, immutable'
    : file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=3600' : 'no-cache';
  const etag = `"${stat.size.toString(36)}-${Math.floor(stat.mtimeMs).toString(36)}"`;
  const headers = { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': cache, ETag: etag, Vary: 'Accept-Encoding' };
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); res.end(); return; }
  const accept = String(req.headers['accept-encoding'] || '');
  const enc = !COMPRESS.has(ext) ? null : /\bbr\b/.test(accept) ? 'br' : /\bgzip\b/.test(accept) ? 'gzip' : null;
  if (!enc) { headers['Content-Length'] = stat.size; res.writeHead(200, headers); fs.createReadStream(file).pipe(res); return; }
  const p = getPacked(file, enc, stat);
  if (!p.enc) { headers['Content-Length'] = stat.size; res.writeHead(200, headers); fs.createReadStream(file).pipe(res); return; }
  headers['Content-Encoding'] = p.enc;
  headers['Content-Length'] = p.buf.length;
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : p.buf);
});

const rooms = new Map();
const getRoom = (code) => {
  if (!rooms.has(code)) rooms.set(code, new Room(code, (c) => rooms.delete(c)));
  return rooms.get(code);
};

const wss = new WebSocketServer({ server, path: '/ws' });
let nextId = 1;

wss.on('connection', (ws) => {
  let room = null, player = null;
  const send = (s) => { if (ws.readyState === 1) ws.send(s); };

  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (m.t === 'join' && !player) {
      const code = String(m.room || 'ranch').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 20) || 'ranch';
      const name = String(m.name || 'Rancher').replace(/[<>]/g, '').trim().slice(0, 16) || 'Rancher';
      room = getRoom(code);
      if (room.players.size >= 8) { send(JSON.stringify({ t: 'full' })); ws.close(); return; }
      const char = /^p[124678]$/.test(m.char) ? m.char : 'p1'; // p3 and p5 were duplicates of Teresa and Maria
      player = room.addPlayer(nextId++, name, send, char);
      send(JSON.stringify({ t: 'welcome', id: player.id, room: code }));
      return;
    }
    if (!player) return;
    if (m.t === 'state') room.onState(player, m);
    else if (m.t === 'shoot') room.onShoot(player, m);
    else if (m.t === 'melee') room.onMelee(player, m);
    else if (m.t === 'nade') room.onNade(player, m);
    else if (m.t === 'buy') room.onBuy(player, m);
    else if (m.t === 'veh') room.onVehicle(player, m);
    else if (m.t === 'switch') { if (player.weapons[m.slot | 0]) player.cur = m.slot | 0; }
    else if (m.t === 'ping') send(JSON.stringify({ t: 'pong', c: m.c }));
  });

  ws.on('close', () => { if (room && player) room.removePlayer(player.id); });
});

// keep idle connections from being dropped by hosting proxies
setInterval(() => wss.clients.forEach(c => c.ping()), 25000);

server.listen(PORT, () => console.log(`Ranch Defense running on http://localhost:${PORT}`));
