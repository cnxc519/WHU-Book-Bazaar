// WebSocket 实时推送：连接鉴权 + 按用户广播
const jwt = require('jsonwebtoken');
const { WebSocketServer } = require('ws');
const { cfg } = require('./config');

const clients = new Map(); // uid -> Set<ws>

function initWs(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (ws, req) => {
    let uid = null;
    try {
      const url = new URL(req.url, 'http://x');
      const t = url.searchParams.get('token') || '';
      const payload = jwt.verify(t, cfg.jwt_secret);
      if (payload.role === 'user') uid = payload.uid;
    } catch {}
    if (!uid) { ws.close(4001, 'unauthorized'); return; }
    ws.uid = uid;
    if (!clients.has(uid)) clients.set(uid, new Set());
    clients.get(uid).add(ws);
    ws.on('close', () => {
      const set = clients.get(uid);
      if (set) { set.delete(ws); if (set.size === 0) clients.delete(uid); }
    });
    ws.on('error', () => {});
  });
}

// 给单个用户推送事件
function pushToUser(uid, event) {
  const set = clients.get(uid);
  if (!set) return;
  const data = JSON.stringify(event);
  for (const ws of set) if (ws.readyState === ws.OPEN) ws.send(data);
}

module.exports = { initWs, pushToUser };
