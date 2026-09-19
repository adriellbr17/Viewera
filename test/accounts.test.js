import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccounts } from '../server/accounts.js';

test('contas, convites e limite de 20 membros', async () => {
  const accounts = await createAccounts();
  const owner = await accounts.register('Dono', 'dono@example.com', 'senha-segura');
  assert.equal((await accounts.login('dono@example.com', 'senha-segura')).id, owner.id);
  const sid = await accounts.start(owner, true); assert.equal(accounts.userFor(sid).id, owner.id);
  await accounts.end(sid); assert.equal(accounts.userFor(sid), undefined);
  await assert.rejects(accounts.login('dono@example.com', 'errada123'));
  const group = await accounts.createGroup(owner, 'Amigos');
  for (let i = 1; i < 20; i++) {
    const user = await accounts.register(`Pessoa ${i}`, `p${i}@example.com`, 'senha-segura');
    await accounts.joinGroup(user, group.invite);
  }
  const extra = await accounts.register('Extra', 'extra@example.com', 'senha-segura');
  await assert.rejects(accounts.joinGroup(extra, group.invite), /máximo 20/);
  assert.equal(accounts.groupsFor(owner)[0].members, 20);
});

