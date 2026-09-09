import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createServer } from '../server/index.js';

async function client(url) {
  const ws = new WebSocket(url, { origin: 'http://127.0.0.1:8787' });
  const messages = []; let wake;
  ws.on('message', raw => { messages.push(JSON.parse(raw)); wake?.(); });
  await once(ws, 'open');
  return { ws, send: data => ws.send(JSON.stringify(data)), next: async (type, match = () => true) => {
    const deadline = Date.now() + 3000;
    while (true) {
      const index = messages.findIndex(m => m.type === type && match(m));
      if (index >= 0) return messages.splice(index, 1)[0];
      if (Date.now() >= deadline) throw Error(`Sem resposta ${type}`);
      await new Promise(resolve => { const timer = setTimeout(resolve, 50); wake = () => { clearTimeout(timer); resolve(); }; });
    }
  } };
}

test('10 participantes, 3 transmissões, isolamento, troca e saída independente', { timeout: 15000 }, async t => {
  const app = createServer();
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  assert.equal((await fetch(base)).status, 200);
  assert.equal((await fetch(`${base}/../package.json`)).status, 404);
  const url = base.replace('http:', 'ws:') + '/signal';
  const denied = new WebSocket(url, { origin: 'https://evil.invalid' });
  const [error] = await once(denied, 'error'); assert.match(error.message, /401/);
  const creator = await client(url);
  creator.send({ type: 'create', name: 'Criador' });
  const room = await creator.next('joined');
  assert.match(room.code, /^[A-F0-9]{8}$/); assert.deepEqual(room.streams, []);
  const peers = [];
  for (let i = 0; i < 9; i++) {
    const peer = await client(url);
    peer.send({ type: 'join', code: room.code, name: `Amigo ${i}` });
    peer.info = await peer.next('joined'); peers.push(peer);
  }
  assert.equal(peers[8].info.peers.length, 10);
  const extra = await client(url);
  extra.send({ type: 'join', code: room.code, name: 'Extra' });
  assert.match((await extra.next('error')).message, /cheia/);

  // Quatro pessoas disputam três vagas, sem depender do criador.
  for (const p of peers.slice(0, 4)) p.send({ type: 'start-stream' });
  const started = [];
  for (let i = 0; i < 3; i++) started.push(await creator.next('stream-started'));
  assert.equal(new Set(started.map(s => s.streamId)).size, 3);
  const rejected = peers.slice(0, 4).find(p => !started.some(s => s.from === p.info.id));
  await rejected.next('stream-denied');
  assert.equal(app.rooms.get(room.code).streams.size, 3);
  const a = peers.find(p => p.info.id === started[0].from);
  const b = peers.find(p => p.info.id === started[1].from);
  const sA = started[0].streamId, sB = started[1].streamId;
  a.send({ type: 'start-stream' }); await a.next('stream-denied');
  const offer = { description: { type: 'offer', sdp: 'v=0\r\n' } };
  a.send({ type: 'signal', to: b.info.id, streamId: sA, data: offer });
  assert.deepEqual((await b.next('signal')).data, offer);
  // B também publica para A: ofertas distintas não compartilham a mesma sessão.
  b.send({ type: 'signal', to: a.info.id, streamId: sB, data: offer });
  assert.equal((await a.next('signal')).streamId, sB);
  b.send({ type: 'signal', to: a.info.id, streamId: sA, data: { description: { type: 'answer', sdp: 'v=0\r\n' } } });
  assert.equal((await a.next('signal')).data.description.type, 'answer');
  b.send({ type: 'signal', to: a.info.id, streamId: sA, data: offer });
  assert.match((await b.next('error')).message, /SDP/);
  creator.send({ type: 'stream-stopped', streamId: sA });
  assert.match((await creator.next('error')).message, /não está transmitindo/);
  b.send({ type: 'stream-stopped', streamId: sA });
  assert.match((await b.next('error')).message, /inválida/);
  extra.send({ type: 'create', name: 'Outra sala' });
  const other = await extra.next('joined');
  a.send({ type: 'signal', to: other.id, streamId: sA, data: offer });
  assert.match((await a.next('error')).message, /Destino/);
  creator.ws.send('{'); assert.match((await creator.next('error')).message, /JSON/);

  a.send({ type: 'stream-stopped', streamId: sA });
  await creator.next('stream-stopped', m => m.streamId === sA);
  assert.equal(app.rooms.get(room.code).streams.size, 2);
  assert.equal(app.rooms.get(room.code).streams.get(b.info.id), sB);
  rejected.send({ type: 'start-stream' });
  const replacement = await creator.next('stream-started', m => m.from === rejected.info.id);
  assert.notEqual(replacement.streamId, sA);
  // Entrar depois já informa as três transmissões ativas.
  peers[8].send({ type: 'leave' }); await peers[8].next('left');
  peers[8].send({ type: 'join', code: room.code, name: 'Voltou' });
  assert.equal((await peers[8].next('joined')).streams.length, 3);
  // Sair do criador preserva a sala e todas as transmissões dos amigos.
  creator.ws.close(); await peers[8].next('peer-left', m => m.id === room.id);
  assert.equal(app.rooms.get(room.code).streams.size, 3);
  b.ws.close(); await peers[8].next('stream-stopped', m => m.streamId === sB);
  assert.equal(app.rooms.get(room.code).streams.size, 2);
  // Só o último participante apaga a sala.
  for (const p of peers) {
    if (p === b) continue;
    p.send({ type: 'leave' }); await p.next('left');
  }
  assert.equal(app.rooms.has(room.code), false);
  extra.send({ type: 'leave' }); await extra.next('left');
  assert.equal(app.rooms.has(other.code), false);
});

