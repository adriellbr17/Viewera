import test from 'node:test';
import assert from 'node:assert/strict';
import { PeerTransport } from '../web/transport.js';

test('conexões de três telas isoladas; parar uma preserva as outras', async t => {
  const original = globalThis.RTCPeerConnection;
  const instances = [];
  globalThis.RTCPeerConnection = class {
    constructor() { instances.push(this); this.candidates = []; }
    async setRemoteDescription(d) { this.remoteDescription = d; }
    async createAnswer() { return { type: 'answer', sdp: 'v=0' }; }
    async setLocalDescription(d) { this.localDescription = { ...d, toJSON: () => d }; }
    async addIceCandidate(c) { this.candidates.push(c); }
    close() { this.closed = true; }
  };
  t.after(() => { globalThis.RTCPeerConnection = original; });
  const sent = [];
  const transport = new PeerTransport((...args) => sent.push(args), () => {}, () => {});
  const offer = { description: { type: 'offer', sdp: 'v=0' } };
  const candidate = { candidate: 'candidate:test' };
  await transport.receive('alice', { candidate }, 'screen-1');
  await transport.receive('alice', offer, 'screen-1');
  await transport.receive('alice', offer, 'screen-2');
  await transport.receive('bob', offer, 'screen-3');
  assert.equal(transport.peers.size, 3);
  assert.deepEqual(instances[0].candidates, [candidate]);
  assert.deepEqual(sent.map(x => x[2]), ['screen-1', 'screen-2', 'screen-3']);
  const oldSend = transport.peers.get('screen-1:alice').send;
  transport.remove(null, 'screen-1');
  oldSend({ candidate }); // Nada de ICE atrasado depois de parar.
  assert.equal(sent.length, 3);
  assert.equal(instances[0].closed, true);
  assert.equal(instances[1].closed, undefined);
  assert.equal(transport.peers.size, 2);
  transport.remove('alice');
  assert.equal(transport.peers.size, 1);
  assert.equal(instances[2].closed, undefined);
  transport.close(); assert.equal(transport.peers.size, 0);
});

