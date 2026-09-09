// Uma conexão por transmissão/receptor: duas pessoas podem publicar entre si sem colisão de ofertas.
export class PeerTransport {
  constructor(send, onStream, onState) {
    this.send = send; this.onStream = onStream; this.onState = onState;
    this.peers = new Map();
    this.iceServers = []; this.iceTransportPolicy = 'all';
  }
  configure(iceServers, iceTransportPolicy = 'all') {
    this.iceServers = iceServers; this.iceTransportPolicy = iceTransportPolicy;
    for (const { pc } of this.peers.values()) pc.setConfiguration({ iceServers, iceTransportPolicy });
  }
  peer(id, streamId) {
    const key = `${streamId}:${id}`;
    if (this.peers.has(key)) return this.peers.get(key);
    const pc = new RTCPeerConnection({ iceServers: this.iceServers, iceTransportPolicy: this.iceTransportPolicy });
    const entry = { pc, id, streamId, pending: [] };
    this.peers.set(key, entry);
    entry.active = () => this.peers.get(key) === entry;
    entry.send = data => { if (entry.active()) this.send(id, data, streamId); };
    pc.onicecandidate = ({ candidate }) => { if (candidate) entry.send({ candidate: candidate.toJSON() }); };
    pc.ontrack = ({ streams, track }) => {
      if (!entry.active()) return;
      entry.stream ??= streams[0] || new MediaStream();
      if (!entry.stream.getTracks().includes(track)) entry.stream.addTrack(track);
      this.onStream(entry.stream, id, streamId);
    };
    pc.onconnectionstatechange = () => this.onState(id, pc.connectionState);
    return entry;
  }
  async publish(id, stream, mbps, streamId) {
    if (this.peers.has(`${streamId}:${id}`)) return;
    const entry = this.peer(id, streamId), { pc } = entry;
    try {
      for (const track of stream.getTracks()) {
        const sender = pc.addTrack(track, stream);
        if (track.kind === 'video') {
          const transceiver = pc.getTransceivers().find(t => t.sender === sender);
          const codecs = RTCRtpSender.getCapabilities('video')?.codecs.filter(c => c.mimeType.toLowerCase() === 'video/h264');
          if (!codecs?.length || !transceiver.setCodecPreferences) throw Error('H.264 indisponível neste runtime. Teste no Edge atualizado.');
          transceiver.setCodecPreferences(codecs);
        }
      }
      await pc.setLocalDescription(await pc.createOffer());
      if (!entry.active()) return;
      for (const sender of pc.getSenders()) {
        if (sender.track?.kind !== 'video') continue;
        const p = sender.getParameters();
        if (p.encodings?.length) {
          p.encodings[0].maxBitrate = mbps * 1_000_000;
          p.encodings[0].maxFramerate = 60;
          await sender.setParameters(p);
        }
      }
      if (entry.active()) entry.send({ description: pc.localDescription.toJSON() });
    } catch (e) { if (entry.active()) { this.remove(id, streamId); throw e; } }
  }
  async receive(id, data, streamId) {
    const entry = this.peer(id, streamId);
    try {
      if (data.description) {
        await entry.pc.setRemoteDescription(data.description);
        if (!entry.active()) return;
        for (const c of entry.pending.splice(0)) await entry.pc.addIceCandidate(c);
        if (data.description.type === 'offer' && entry.active()) {
          await entry.pc.setLocalDescription(await entry.pc.createAnswer());
          if (entry.active()) entry.send({ description: entry.pc.localDescription.toJSON() });
        }
      } else if (data.candidate) {
        if (entry.pc.remoteDescription) await entry.pc.addIceCandidate(data.candidate);
        else {
          if (entry.pending.length >= 128) throw Error('Fila ICE excedida');
          entry.pending.push(data.candidate);
        }
      }
    } catch (e) { if (entry.active()) throw e; }
  }
  remove(id, streamId) {
    for (const [key, entry] of this.peers) {
      if ((id && entry.id !== id) || (streamId && entry.streamId !== streamId)) continue;
      entry.pc.onconnectionstatechange = entry.pc.onicecandidate = entry.pc.ontrack = null;
      entry.pc.close(); this.peers.delete(key);
    }
  }
  close() { this.remove(); }
  async stats() {
    const rows = [];
    for (const { id, pc } of this.peers.values()) {
      const report = await pc.getStats();
      const pair = [...report.values()].find(s => s.type === 'candidate-pair' && s.state === 'succeeded' && s.nominated);
      const route = pair ? ([report.get(pair.localCandidateId), report.get(pair.remoteCandidateId)].some(c => c?.candidateType === 'relay') ? 'TURN' : 'direta') : 'conectando';
      for (const s of report.values()) {
        if (!['outbound-rtp', 'inbound-rtp'].includes(s.type) || s.kind !== 'video') continue;
        const codec = report.get(s.codecId)?.mimeType || 'negociando';
        rows.push(`${id.slice(0, 4)}: ${codec} · ${s.frameWidth || '?'}×${s.frameHeight || '?'} · ${s.framesPerSecond ?? '?'} fps · ${route}`);
      }
    }
    return rows.join(' | ');
  }
}

