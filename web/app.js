import { PeerTransport } from './transport.js';
const $ = id => document.getElementById(id);
let socket, room, local, busy = false, generation = 0, claimTimer;
const members = new Map(), memberAccounts = new Map(), streams = new Map(), videos = new Map();
let account, groups = [], currentGroup, authMode = 'login';
let chatMessages = [];
const invitedGroup = new URLSearchParams(location.search).get('invite')?.trim();
const isDesktop = !!window.__TAURI__;
if (!isDesktop) $('server').value = new URL('/signal', location.href).href.replace(/^http/, 'ws');
if (!isDesktop && location.protocol === 'https:') $('connection-settings').hidden = true;
const status = message => { $('status').textContent = message; };
const send = message => {
  if (socket?.readyState !== WebSocket.OPEN) throw Error('Servidor desconectado');
  socket.send(JSON.stringify(message));
};
function renderChat() {
  if (!chatMessages.length) { const empty = document.createElement('p'); empty.className = 'chat-empty'; empty.textContent = 'Nenhuma mensagem ainda. Comece a conversa.'; $('messages').replaceChildren(empty); return; }
  $('messages').replaceChildren(...chatMessages.map(message => {
    const row = document.createElement('article'); row.className = 'message';
    const avatar = document.createElement('div'); avatar.className = 'avatar'; avatar.textContent = message.name.slice(0, 2).toUpperCase();
    const title = document.createElement('div'), name = document.createElement('b'), time = document.createElement('time'), text = document.createElement('p');
    name.textContent = message.name; time.textContent = new Date(message.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); text.textContent = message.text;
    title.append(name, time); row.append(avatar, title, text); return row;
  }));
  $('messages').scrollTop = $('messages').scrollHeight;
}
function showVideo(stream, id, streamId) {
  if (!videos.has(streamId)) {
    const card = document.createElement('div'); card.className = 'video-card';
    const label = document.createElement('p'); label.textContent = `${members.get(id) || 'Amigo'}${id === room?.id ? ' · sua tela' : ''}`;
    const video = document.createElement('video');
    video.autoplay = video.playsInline = video.controls = true; video.muted = id === room?.id;
    video.setAttribute('aria-label', `Transmissão de ${members.get(id) || 'Amigo'}`);
    card.append(label, video); $('videos').append(card); videos.set(streamId, { card, video });
  }
  const video = videos.get(streamId).video; video.srcObject = stream;
  video.play().catch(() => status('Use reproduzir no vídeo para assistir e ouvir.'));
  render();
}
function removeVideo(streamId) {
  const item = videos.get(streamId);
  if (item) { item.video.srcObject = null; item.card.remove(); videos.delete(streamId); }
  transport.remove(null, streamId);
}
const transport = new PeerTransport((to, data, streamId) => send({ type: 'signal', to, data, streamId }), showVideo,
  (id, state) => status(`${members.get(id) || 'Amigo'}: ${({connected:'conectado',connecting:'conectando',disconnected:'conexão interrompida',failed:'conexão falhou — entre novamente; outra rede pode exigir TURN'})[state] || state}`));
function render() {
  $('room').hidden = !room;
  $('room-title').textContent = currentGroup?.name || 'Escolha um grupo';
  $('profile-name').textContent = account?.name || 'Você';
  $('count').textContent = `${members.size} / 20`;
  $('stream-count').textContent = `${streams.size} / 3 transmitindo`;
  $('empty').hidden = videos.size > 0;
  $('share-big').disabled = !room || streams.size >= 3 || streams.has(room?.id) || !!local || busy;
  $('create').disabled = $('join').disabled = !!room || busy;
  $('name').disabled = $('server').disabled = $('access-key').disabled = !!room || busy;
  $('share').disabled = !room || streams.size >= 3 || streams.has(room?.id) || !!local || busy;
  $('stop').disabled = !local;
  $('audio').disabled = $('quality').disabled = !!local || busy;
  const onlineAccounts = new Set(memberAccounts.values());
  const online = [...members].map(([id, name]) => {
    const li = document.createElement('li'); li.className = 'member online-member';
    const state = document.createElement('span'); state.className = streams.has(id) ? 'streaming-badge' : 'watching'; state.textContent = streams.has(id) ? 'TRANSMITINDO' : ''; state.title = streams.has(id) ? 'Transmitindo' : 'Assistindo'; state.setAttribute('aria-label', state.title);
    const label = document.createElement('span'); label.textContent = `${name}${id === room?.id ? ' · você' : ''}`; li.append(label, state); return li;
  });
  const offline = (currentGroup?.people || []).filter(person => !onlineAccounts.has(person.id)).map(person => {
    const li = document.createElement('li'); li.className = 'member offline-member'; li.textContent = person.name; return li;
  });
  const offlineTitle = document.createElement('li'); offlineTitle.className = 'member-section'; offlineTitle.textContent = `OFFLINE — ${offline.length}`;
  $('peers').replaceChildren(...online, offlineTitle, ...offline);
}
function stop(notify = true) {
  generation++; clearTimeout(claimTimer); busy = false;
  if (local) for (const track of local.getTracks()) { track.onended = null; track.stop(); }
  local = null;
  const streamId = streams.get(room?.id);
  if (streamId) {
    removeVideo(streamId);
    if (notify && socket?.readyState === WebSocket.OPEN) send({ type: 'stream-stopped', streamId });
  }
  render();
}
function reset() {
  stop(false); transport.close();
  for (const streamId of videos.keys()) removeVideo(streamId);
  room = null; members.clear(); memberAccounts.clear(); streams.clear(); chatMessages = []; renderChat(); render();
  $('stats').textContent = 'Qualidade e áudio dependem do dispositivo e da conexão.';
}
async function connect() {
  if (socket?.readyState === WebSocket.OPEN && socket.url === new URL($('server').value).href) return;
  if (socket) { const old = socket; socket = null; old.close(); }
  const url = new URL($('server').value);
  if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password) throw Error('Use ws:// ou wss:// sem credenciais.');
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.protocol !== 'wss:') throw Error('Para acessar pela internet use wss://.');
  const current = new WebSocket(url); socket = current;
  let queue = Promise.resolve();
  current.onmessage = ({ data }) => {
    queue = queue.then(async () => { if (socket === current) await handle(JSON.parse(data)); })
      .catch(e => { status(e.message); });
  };
  current.onclose = () => { if (socket === current) { socket = null; reset(); status('Servidor desconectado. Crie ou entre novamente.'); } };
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { current.close(); reject(Error('Tempo de conexão esgotado')); }, 5000);
    current.onopen = () => { clearTimeout(timer); resolve(); };
    current.onerror = () => { clearTimeout(timer); reject(Error('Não foi possível conectar. Confira o servidor.')); };
  });
}
async function publishTo(id, streamId) {
  const stream = local;
  if (!stream || streams.get(room?.id) !== streamId || !members.has(id)) return;
  try { await transport.publish(id, stream, Number($('bitrate').value), streamId); }
  catch (e) { if (local === stream) { stop(); status(e.message); } }
}
async function handle(m) {
  if (m.type === 'error') { busy = false; render(); status(m.message); }
  if (m.type === 'ice-config') transport.configure(m.iceServers, m.iceTransportPolicy);
  if (m.type === 'joined') {
    transport.configure(m.iceServers || [], m.iceTransportPolicy);
    room = m; members.clear(); memberAccounts.clear(); streams.clear();
    chatMessages = Array.isArray(m.messages) ? m.messages : []; renderChat();
    for (const p of m.peers) { members.set(p.id, p.name); if (p.accountId) memberAccounts.set(p.id, p.accountId); }
    for (const s of m.streams) streams.set(s.id, s.streamId);
    busy = false; render(); status('Você está na sala. Assista ou compartilhe sua tela.');
  }
  if (m.type === 'peer-joined' && room) {
    members.set(m.id, m.name); if (m.accountId) memberAccounts.set(m.id, m.accountId); render();
    const streamId = streams.get(room.id);
    if (streamId) await publishTo(m.id, streamId);
  }
  if (m.type === 'peer-left') { members.delete(m.id); memberAccounts.delete(m.id); transport.remove(m.id); render(); }
  if (m.type === 'chat') { chatMessages.push(m); if (chatMessages.length > 100) chatMessages.shift(); renderChat(); }
  if (m.type === 'stream-started' && room) {
    streams.set(m.from, m.streamId); render();
    if (m.from === room.id) {
      clearTimeout(claimTimer);
      if (!local) { send({ type: 'stream-stopped', streamId: m.streamId }); return; }
      busy = false; showVideo(local, room.id, m.streamId);
      status('Sua tela está compartilhada. Você também pode assistir às outras.');
      for (const id of members.keys()) if (id !== room?.id) await publishTo(id, m.streamId);
    } else status(`${members.get(m.from) || 'Amigo'} começou a transmitir.`);
  }
  if (m.type === 'stream-denied') { stop(false); status(m.message); }
  if (m.type === 'signal' && room && members.has(m.from) && [...streams.values()].includes(m.streamId)) {
    await transport.receive(m.from, m.data, m.streamId);
  }
  if (m.type === 'stream-stopped') {
    if (streams.get(m.from) !== m.streamId) return;
    if (m.from === room?.id) stop(false);
    streams.delete(m.from); removeVideo(m.streamId); render();
    status('Uma transmissão terminou. A sala continua aberta e há vaga para compartilhar.');
  }
  if (m.type === 'left') { reset(); status('Você saiu. A sala continua enquanto houver participantes.'); }
}
async function join(type) {
  if (busy || room) return;
  busy = true; render();
  try {
    const name = $('name').value.trim(), code = $('code').value.trim().toUpperCase();
    if (!name || name.length > 32) throw Error('Informe seu nome (até 32 caracteres).');
    if (type === 'join' && !/^[A-F0-9]{8}$/.test(code)) throw Error('Digite os 8 caracteres do código.');
    await connect(); send({ type, name, code, accessKey: $('access-key').value });
  } catch (e) { busy = false; render(); status(e.message); }
}
$('create').onclick = () => join('create'); $('join').onclick = () => join('join');
$('leave').onclick = () => { try { send({ type: 'leave' }); reset(); } catch (e) { reset(); status(e.message); } };
$('copy').onclick = async () => {
  const link = `${location.origin}${location.pathname}?invite=${encodeURIComponent(currentGroup.invite)}`;
  try { await navigator.clipboard.writeText(link); status('Link de convite copiado. Envie aos seus amigos.'); }
  catch { status(`Envie este link: ${link}`); }
};
$('share-big').onclick = () => $('share').click();
$('share').onclick = async () => {
  if (!room || streams.size >= 3 || streams.has(room?.id) || local || busy) return;
  busy = true; render(); const current = ++generation;
  try {
    if (!navigator.mediaDevices?.getDisplayMedia) throw Error('Captura indisponível neste runtime. Abra http://127.0.0.1:8787 no Edge.');
    const hd = $('quality').value === '1080';
    $('bitrate').value = hd ? '8' : '4';
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { width: { ideal: hd ? 1920 : 1280, max: hd ? 1920 : 1280 }, height: { ideal: hd ? 1080 : 720, max: hd ? 1080 : 720 }, frameRate: { ideal: hd ? 60 : 30, max: hd ? 60 : 30 } }, audio: $('audio').checked,
    });
    if (current !== generation || !room) { stream.getTracks().forEach(t => t.stop()); return; }
    local = stream;
    const track = stream.getVideoTracks()[0]; track.contentHint = 'motion';
    track.onended = () => { stop(); status('Sua transmissão foi encerrada. Você continua na sala.'); };
    // O servidor decide a vaga atomicamente. Nenhum frame sai antes da confirmação.
    send({ type: 'start-stream' });
    claimTimer = setTimeout(() => { if (busy && local) { stop(); status('Sem confirmação do servidor. Tente novamente.'); } }, 5000);
    status(`Preparando sua transmissão. ${stream.getAudioTracks().length ? 'Áudio incluído.' : 'Sem áudio do sistema.'}`);
  } catch (e) {
    if (current === generation) { stop(false); status(e.name === 'NotAllowedError' ? 'Seleção cancelada ou permissão negada.' : e.message); }
  }
};
$('stop').onclick = () => { stop(); status('Você parou de transmitir e continua assistindo.'); };
$('probe').onclick = async () => {
  if (!window.__TAURI__) { $('native-status').textContent = 'Este teste exige o aplicativo Tauri no Windows.'; return; }
  $('probe').disabled = true; $('native-status').textContent = 'Escolha uma tela ou janela no seletor do Windows…';
  try { $('native-status').textContent = await window.__TAURI__.core.invoke('capture_probe'); }
  catch (e) { $('native-status').textContent = String(e); }
  finally { $('probe').disabled = false; }
};
let statsBusy = false;
setInterval(async () => {
  if (statsBusy) return;
  statsBusy = true;
  try { const text = await transport.stats(); $('stats').textContent = text || 'Aguardando vídeo. Use os controles de cada tela para áudio e tela cheia.'; }
  catch { /* Uma conexão pode fechar durante a leitura. */ }
  finally { statsBusy = false; }
}, 2000);
setInterval(() => { if (room && socket?.readyState === WebSocket.OPEN) send({ type: 'ice-config' }); }, 10 * 60_000);
window.addEventListener('beforeunload', () => { reset(); socket?.close(); });
render();

async function api(path, options) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...options?.headers } });
  const data = await response.json(); if (!response.ok) throw Error(data.error || 'Falha no servidor.'); return data;
}
function drawGroups() {
  $('groups').replaceChildren(...groups.map(group => {
    const button = document.createElement('button'); button.className = `server${group.id === currentGroup?.id ? ' active' : ''}`;
    button.textContent = group.name.split(/\s+/).slice(0, 2).map(x => x[0]).join('').toUpperCase(); button.title = `${group.name} · ${group.members}/20`;
    button.onclick = () => enterGroup(group); return button;
  }));
}
async function enterGroup(group) {
  if (currentGroup?.id === group.id && room) return;
  if (room) { try { send({ type: 'leave' }); } catch {} reset(); }
  currentGroup = group; $('name').value = account.name; $('code').value = group.id; drawGroups(); render(); await join('join');
}
async function loadAccount(data) {
  account = data.user; groups = data.groups; $('auth').hidden = true; $('name').value = account.name; drawGroups(); render();
  if (invitedGroup) {
    try { const joined = await api('/api/groups/join', { method: 'POST', body: JSON.stringify({ invite: invitedGroup }) }); if (!groups.some(g => g.id === joined.group.id)) groups.push(joined.group); history.replaceState(null, '', location.pathname); drawGroups(); await enterGroup(joined.group); }
    catch (e) { status(e.message); }
  } else if (groups[0]) await enterGroup(groups[0]);
  else $('group-form').hidden = false;
}
function setAuthMode(mode) {
  authMode = mode; $('login-tab').classList.toggle('active', mode === 'login'); $('register-tab').classList.toggle('active', mode === 'register');
  $('auth-name-label').hidden = mode === 'login'; $('auth-submit').textContent = mode === 'login' ? 'Entrar' : 'Criar conta'; $('auth-password').autocomplete = mode === 'login' ? 'current-password' : 'new-password'; $('auth-error').textContent = '';
}
$('login-tab').onclick = () => setAuthMode('login'); $('register-tab').onclick = () => setAuthMode('register');
$('auth-form').onsubmit = async event => { event.preventDefault(); $('auth-error').textContent = ''; try { await loadAccount(await api(`/api/${authMode}`, { method: 'POST', body: JSON.stringify({ name: $('auth-name').value, email: $('auth-email').value, password: $('auth-password').value, remember: $('remember').checked }) })); } catch (e) { $('auth-error').textContent = e.message; } };
$('show-group-form').onclick = () => { $('group-form').hidden = !$('group-form').hidden; };
$('create-group').onclick = async () => { try { const { group } = await api('/api/groups', { method: 'POST', body: JSON.stringify({ name: $('group-name').value }) }); groups.push(group); $('group-name').value = ''; $('group-form').hidden = true; drawGroups(); await enterGroup(group); } catch (e) { status(e.message); } };
$('join-group').onclick = async () => { try { const raw = $('invite-code').value.trim(); const invite = new URL(raw, location.href).searchParams.get('invite') || raw; const { group } = await api('/api/groups/join', { method: 'POST', body: JSON.stringify({ invite }) }); if (!groups.some(g => g.id === group.id)) groups.push(group); $('invite-code').value = ''; $('group-form').hidden = true; drawGroups(); await enterGroup(group); } catch (e) { status(e.message); } };
$('chat-channel').onclick = () => { $('live-view').hidden = true; $('chat-view').hidden = false; $('chat-channel').classList.add('active'); $('voice-channel').classList.remove('active'); $('chat-input').focus(); };
$('voice-channel').onclick = () => { $('chat-view').hidden = true; $('live-view').hidden = false; $('voice-channel').classList.add('active'); $('chat-channel').classList.remove('active'); };
$('chat-form').onsubmit = event => { event.preventDefault(); const text = $('chat-input').value.trim(); if (!room || !text) return; try { send({ type: 'chat', text }); $('chat-input').value = ''; } catch (e) { status(e.message); } };
api('/api/me').then(loadAccount).catch(() => { $('auth').hidden = false; });

