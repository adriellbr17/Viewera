import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes, randomUUID, timingSafeEqual, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { deploymentConfig } from './deployment.js';
import { createAccounts } from './accounts.js';

const files = new Map([
  ['/', ['index.html', 'text/html']],
  ['/app.js', ['app.js', 'text/javascript']],
  ['/transport.js', ['transport.js', 'text/javascript']],
  ['/style.css', ['style.css', 'text/css']],
  ['/auth.css', ['auth.css', 'text/css']],
  ['/assets/symbol.svg', ['assets/symbol.svg', 'image/svg+xml']],
  ['/assets/logo.svg', ['assets/logo.svg', 'image/svg+xml']],
  ['/assets/wordmark.svg', ['assets/wordmark.svg', 'image/svg+xml']],
  ['/assets/icon.svg', ['assets/icon.svg', 'image/svg+xml']],
]);
const send = (ws, message) => {
  if (ws.readyState !== WebSocket.OPEN) return;
  if (ws.bufferedAmount > 1024 * 1024) return ws.terminate();
  ws.send(JSON.stringify(message));
};

export function createServer({ origins = ['http://127.0.0.1:8787', 'http://localhost:8787', 'http://tauri.localhost', 'https://tauri.localhost', 'tauri://localhost'], accessKey = '', iceProvider = async () => [], relayOnly = false, accounts = null } = {}) {
  // ponytail: salas em memória, limitadas a 100; persistência só quando houver múltiplos servidores.
  const rooms = new Map();
  let attempts = 0, attemptWindow = Date.now();
  const digest = value => createHash('sha256').update(value).digest();
  const sidOf = req => /(?:^|;\s*)sid=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
  const json = (res, status, value, headers = {}) => res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }).end(JSON.stringify(value));
  const body = async req => {
    let text = ''; for await (const chunk of req) { text += chunk; if (text.length > 16_384) throw Error('Requisição muito grande.'); }
    try { return JSON.parse(text || '{}'); } catch { throw Error('JSON inválido.'); }
  };
  async function api(req, res, path) {
    try {
      if (!accounts) return json(res, 503, { error: 'Contas indisponíveis.' });
      const user = accounts.userFor(sidOf(req));
      if (req.method === 'GET' && path === '/api/me') return user ? json(res, 200, { user: { id: user.id, name: user.name, email: user.email }, groups: accounts.groupsFor(user) }) : json(res, 401, { error: 'Faça login.' });
      if (req.method !== 'POST') return json(res, 404, { error: 'Não encontrado.' });
      if (req.headers.origin && !origins.includes(req.headers.origin)) return json(res, 403, { error: 'Origem não permitida.' });
      const input = await body(req);
      if (path === '/api/register' || path === '/api/login') {
        const account = path.endsWith('register') ? await accounts.register(input.name, input.email, input.password) : await accounts.login(input.email, input.password);
        const sid = accounts.start(account);
        return json(res, 200, { user: { id: account.id, name: account.name, email: account.email }, groups: accounts.groupsFor(account) }, { 'Set-Cookie': `sid=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000` });
      }
      if (path === '/api/logout') { const sid = sidOf(req); if (sid) accounts.sessions.delete(sid); return json(res, 200, { ok: true }, { 'Set-Cookie': 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' }); }
      if (!user) return json(res, 401, { error: 'Faça login.' });
      if (path === '/api/groups') { const group = await accounts.createGroup(user, input.name); return json(res, 200, { group: { id: group.id, name: group.name, invite: group.invite, members: 1 } }); }
      if (path === '/api/groups/join') { const group = await accounts.joinGroup(user, input.invite); return json(res, 200, { group: { id: group.id, name: group.name, invite: group.invite, members: group.members.length } }); }
      return json(res, 404, { error: 'Não encontrado.' });
    } catch (e) { return json(res, 400, { error: e.message }); }
  }
  const server = http.createServer(async (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok'); return; }
    if (path.startsWith('/api/')) return api(req, res, path);
    const file = files.get(path);
    if (!file || req.method !== 'GET') { res.writeHead(404).end(); return; }
    try {
      const body = await readFile(new URL(`../web/${file[0]}`, import.meta.url));
      res.writeHead(200, {
        'Content-Type': `${file[1]}; charset=utf-8`,
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' ipc: http://ipc.localhost ws: wss:; media-src 'self' blob:; frame-ancestors 'none'",
      }).end(body);
    } catch { res.writeHead(500).end(); }
  });
  const wss = new WebSocketServer({ server, path: '/signal', maxPayload: 64 * 1024,
    verifyClient: ({ origin }) => origins.includes(origin),
  });
  function broadcast(room, message, except) {
    for (const [id, peer] of room.members) if (id !== except) send(peer, message);
  }
  function leave(ws) {
    const room = rooms.get(ws.room);
    if (!room) return;
    room.members.delete(ws.id);
    const streamId = room.streams.get(ws.id);
    if (streamId) {
      room.streams.delete(ws.id);
      broadcast(room, { type: 'stream-stopped', from: ws.id, streamId });
    }
    broadcast(room, { type: 'peer-left', id: ws.id });
    if (!room.members.size) rooms.delete(ws.room);
    ws.room = null;
  }
  wss.on('connection', (ws, req) => {
    if (wss.clients.size > 500) { ws.close(1013, 'Servidor cheio'); return; }
    Object.assign(ws, { id: randomUUID(), room: null, user: accounts?.userFor(sidOf(req)), alive: true, count: 0, window: Date.now() });
    ws.on('error', () => ws.terminate());
    ws.on('pong', () => { ws.alive = true; });
    ws.on('close', () => leave(ws));
    let queue = Promise.resolve(), queued = 0;
    ws.on('message', (raw, binary) => {
      if (++queued > 100) { ws.close(1008, 'Fila excedida'); return; }
      queue = queue.then(() => handle(raw, binary)).finally(() => { queued--; });
    });
    async function handle(raw, binary) {
      if (ws.readyState !== WebSocket.OPEN) return;
      try {
        if (Date.now() - ws.window > 1000) { ws.window = Date.now(); ws.count = 0; }
        if (++ws.count > 100) { ws.close(1008, 'Muitas mensagens'); return; }
        if (binary) throw Error('Mensagem inválida');
        const m = JSON.parse(raw.toString());
        if (!m || typeof m !== 'object' || Array.isArray(m)) throw Error('Mensagem inválida');
        if (m.type === 'leave') { leave(ws); send(ws, { type: 'left' }); return; }
        if (m.type === 'create' || m.type === 'join') {
          if (ws.room) throw Error('Saia da sala atual primeiro');
          if (accounts && !ws.user) throw Error('Faça login para entrar.');
          if (!accounts && (typeof m.name !== 'string' || !m.name.trim() || m.name.length > 32)) throw Error('Nome inválido (1–32 caracteres)');
          if (Date.now() - attemptWindow > 60_000) { attempts = 0; attemptWindow = Date.now(); }
          if (++attempts > 100) throw Error('Muitas tentativas. Aguarde um minuto.');
          if (!accounts && accessKey && (typeof m.accessKey !== 'string' || m.accessKey.length > 256 || !timingSafeEqual(digest(m.accessKey), digest(accessKey)))) {
            throw Error('Chave do grupo inválida.');
          }
          const iceServers = await iceProvider();
          if (ws.readyState !== WebSocket.OPEN) return;
          let code, room;
          if (accounts) {
            if (m.type !== 'join' || typeof m.code !== 'string') throw Error('Escolha um grupo.');
            const group = accounts.group(m.code);
            if (!group || !group.members.includes(ws.user.id)) throw Error('Você não participa deste grupo.');
            code = group.id; room = rooms.get(code);
            if (!room) { room = { streams: new Map(), members: new Map() }; rooms.set(code, room); }
            if (room.members.size >= 20) throw Error('Sala cheia (máximo 20 pessoas).');
          } else if (m.type === 'create') {
            if (rooms.size >= 100) throw Error('Servidor cheio');
            do { code = randomBytes(4).toString('hex').toUpperCase(); } while (rooms.has(code));
            room = { streams: new Map(), members: new Map() };
            rooms.set(code, room);
          } else {
            if (typeof m.code !== 'string' || !/^[A-F0-9]{8}$/.test(m.code)) throw Error('Código inválido');
            code = m.code; room = rooms.get(code);
            if (!room) throw Error('Sala não encontrada');
            if (room.members.size >= 10) throw Error('Sala cheia (máximo 10 pessoas)');
          }
          ws.room = code; ws.name = accounts ? ws.user.name : m.name.trim(); room.members.set(ws.id, ws);
          send(ws, { type: 'joined', id: ws.id, code, iceServers, iceTransportPolicy: relayOnly ? 'relay' : 'all', streams: [...room.streams].map(([id, streamId]) => ({ id, streamId })),
            peers: [...room.members.values()].map(p => ({ id: p.id, name: p.name })) });
          broadcast(room, { type: 'peer-joined', id: ws.id, name: ws.name }, ws.id);
          return;
        }
        const room = rooms.get(ws.room);
        if (!room) throw Error('Entre em uma sala');
        if (m.type === 'ice-config') {
          send(ws, { type: 'ice-config', iceServers: await iceProvider(), iceTransportPolicy: relayOnly ? 'relay' : 'all' }); return;
        }
        if (m.type === 'start-stream') {
          if (room.streams.has(ws.id) || room.streams.size >= 3) {
            send(ws, { type: 'stream-denied', message: 'Limite de 3 transmissões simultâneas; uma por pessoa. Aguarde uma vaga.' }); return;
          }
          const streamId = randomUUID(); room.streams.set(ws.id, streamId);
          broadcast(room, { type: 'stream-started', from: ws.id, streamId }); return;
        }
        if (m.type === 'stream-stopped') {
          if (!room.streams.has(ws.id)) throw Error('Você não está transmitindo');
          if (m.streamId !== room.streams.get(ws.id)) throw Error('Transmissão inválida');
          room.streams.delete(ws.id);
          broadcast(room, { type: 'stream-stopped', from: ws.id, streamId: m.streamId }); return;
        }
        if (m.type !== 'signal' || typeof m.to !== 'string') throw Error('Tipo inválido');
        const owner = [...room.streams].find(([, streamId]) => streamId === m.streamId)?.[0];
        if (!owner) return; // Descarta SDP/ICE atrasados de transmissões encerradas.
        const target = room.members.get(m.to);
        if (!target || target === ws || (ws.id !== owner && target.id !== owner)) throw Error('Destino inválido');
        const d = m.data;
        if (!d || typeof d !== 'object') throw Error('Sinal inválido');
        if (d.description) {
          const { type, sdp } = d.description;
          if (typeof sdp !== 'string' || sdp.length > 60000 || type !== (ws.id === owner ? 'offer' : 'answer')) throw Error('SDP inválido');
          send(target, { type: 'signal', from: ws.id, streamId: m.streamId, data: { description: { type, sdp } } });
        } else if (d.candidate && typeof d.candidate.candidate === 'string' && d.candidate.candidate.length < 8192) {
          const c = d.candidate;
          if ((c.sdpMid != null && typeof c.sdpMid !== 'string') || (c.sdpMLineIndex != null && (!Number.isInteger(c.sdpMLineIndex) || c.sdpMLineIndex < 0))) throw Error('ICE inválido');
          send(target, { type: 'signal', from: ws.id, streamId: m.streamId, data: { candidate: { candidate: c.candidate, sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex } } });
        } else throw Error('Sinal inválido');
      } catch (e) { send(ws, { type: 'error', message: e instanceof SyntaxError ? 'JSON inválido' : e.message }); }
    }
  });
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.alive) ws.terminate();
      else { ws.alive = false; ws.ping(); }
    }
  }, 15000);
  heartbeat.unref();
  return { server, rooms, close: async () => {
    clearInterval(heartbeat);
    for (const ws of wss.clients) ws.terminate();
    await new Promise(resolve => wss.close(resolve));
    await new Promise(resolve => server.close(resolve));
  } };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const config = deploymentConfig();
  if (process.env.ALLOWED_ORIGINS) config.origins = process.env.ALLOWED_ORIGINS.split(',');
  config.accounts = await createAccounts(new URL('./data.json', import.meta.url));
  const app = createServer(config);
  const host = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
  const port = Number(process.env.PORT || 8787);
  app.server.on('error', e => { console.error(e.message); process.exitCode = 1; });
  app.server.listen(port, host, () => console.log(`Viewera: http://${host}:${port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await app.close(); });
}
