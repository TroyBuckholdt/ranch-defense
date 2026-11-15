// One server does everything: serves the built game files and runs multiplayer over
// WebSockets on the same port. That keeps hosting to a single free web service.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
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
  '.splat': 'application/octet-stream', '.mp4': 'video/mp4', '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/health') { res.end('ok'); return; }
  let file = path.normalize(path.join(DIST, decodeURIComponent(url.pathname)));
  if (!file.startsWith(DIST)) { res.writeHead(403); res.end(); return; }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404); res.end('Run `npm run build` first.'); return; }
  const ext = path.extname(file).toLowerCase();
  const cache = file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache';
  res.writeHead(200, { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': cache });
  fs.createReadStream(file).pipe(res);
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
      player = room.addPlayer(nextId++, name, send);
      send(JSON.stringify({ t: 'welcome', id: player.id, room: code }));
      return;
    }
    if (!player) return;
    if (m.t === 'state') room.onState(player, m);
    else if (m.t === 'shoot') room.onShoot(player, m);
    else if (m.t === 'ping') send(JSON.stringify({ t: 'pong', c: m.c }));
  });

  ws.on('close', () => { if (room && player) room.removePlayer(player.id); });
});

// keep idle connections from being dropped by hosting proxies
setInterval(() => wss.clients.forEach(c => c.ping()), 25000);

server.listen(PORT, () => console.log(`Ranch Defense running on http://localhost:${PORT}`));
