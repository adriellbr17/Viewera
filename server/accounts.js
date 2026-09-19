import { readFile, writeFile } from 'node:fs/promises';
import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const clean = value => String(value || '').trim();

export async function createAccounts(file) {
  let data = { users: [], groups: [], sessions: [] };
  if (file) try { data = JSON.parse(await readFile(file, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  data.sessions ||= [];
  const save = async () => { if (file) await writeFile(file, JSON.stringify(data, null, 2)); };
  const sessionHash = sid => createHash('sha256').update(String(sid || '')).digest('hex');
  const userFor = sid => { const session = data.sessions.find(s => s.hash === sessionHash(sid) && s.expires > Date.now()); return data.users.find(u => u.id === session?.userId); };
  const viewGroup = group => ({ id: group.id, name: group.name, invite: group.invite, members: group.members.length, people: group.members.map(id => { const user = data.users.find(u => u.id === id); return { id, name: user?.name || 'Membro' }; }) });
  const groupsFor = user => data.groups.filter(g => g.members.includes(user.id)).map(viewGroup);
  async function register(name, email, password) {
    name = clean(name); email = clean(email).toLowerCase();
    if (name.length < 2 || name.length > 24) throw Error('Nome deve ter entre 2 e 24 caracteres.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) throw Error('E-mail inválido.');
    if (typeof password !== 'string' || password.length < 8 || password.length > 72) throw Error('A senha deve ter entre 8 e 72 caracteres.');
    if (data.users.some(u => u.email === email)) throw Error('Este e-mail já possui conta.');
    const salt = randomBytes(16).toString('hex');
    const hash = (await scrypt(password, salt, 32)).toString('hex');
    const user = { id: randomUUID(), name, email, salt, hash }; data.users.push(user); await save(); return user;
  }
  async function login(email, password) {
    const user = data.users.find(u => u.email === clean(email).toLowerCase());
    if (!user || typeof password !== 'string') throw Error('E-mail ou senha incorretos.');
    const hash = await scrypt(password, user.salt, 32);
    if (!timingSafeEqual(hash, Buffer.from(user.hash, 'hex'))) throw Error('E-mail ou senha incorretos.');
    return user;
  }
  async function start(user, remember = false) { const sid = randomBytes(32).toString('hex'); data.sessions = data.sessions.filter(s => s.expires > Date.now()); data.sessions.push({ hash: sessionHash(sid), userId: user.id, expires: Date.now() + (remember ? 30 : 1) * 86_400_000 }); await save(); return sid; }
  async function end(sid) { data.sessions = data.sessions.filter(s => s.hash !== sessionHash(sid)); await save(); }
  async function createGroup(user, name) {
    name = clean(name); if (name.length < 2 || name.length > 32) throw Error('Nome do grupo deve ter entre 2 e 32 caracteres.');
    const group = { id: randomBytes(4).toString('hex').toUpperCase(), name, invite: randomBytes(8).toString('hex'), owner: user.id, members: [user.id] };
    data.groups.push(group); await save(); return group;
  }
  async function joinGroup(user, invite) {
    const group = data.groups.find(g => g.invite === clean(invite)); if (!group) throw Error('Convite inválido.');
    if (!group.members.includes(user.id)) { if (group.members.length >= 20) throw Error('Grupo cheio (máximo 20 membros).'); group.members.push(user.id); await save(); }
    return group;
  }
  return { userFor, groupsFor, viewGroup, register, login, start, end, createGroup, joinGroup, group: id => data.groups.find(g => g.id === id) };
}

