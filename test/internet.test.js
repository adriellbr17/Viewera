import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { deploymentConfig } from '../server/deployment.js';
import { createServer } from '../server/index.js';

const env = {
  NODE_ENV: 'production', PUBLIC_ORIGIN: 'https://group.example',
  ACCESS_KEY: 'test-group-access-key-123456789',
  TWILIO_ACCOUNT_SID: 'AC' + 'a'.repeat(32), TWILIO_AUTH_TOKEN: 'private-test-token',
  ICE_RELAY_ONLY: 'true',
};
test('produção exige configuração; TURN temporário só chega após autenticar', async t => {
  assert.throws(() => deploymentConfig({NODE_ENV:'production'}), /Configure/);
  assert.throws(() => deploymentConfig({...env,PUBLIC_ORIGIN:'http://group.example'}), /HTTPS/);
  let calls = 0;
  const config = deploymentConfig(env, async (url, options) => {
    calls++;
    assert.match(url, /^https:\/\/api.twilio.com\//);
    assert.equal(options.body, 'Ttl=86400');
    return { ok: true, json: async () => ({ice_servers:[
      {url:'stun:relay.example:3478'},
      {url:'turn:relay.example:3478?transport=udp',username:'temporary-user',credential:'temporary-password'},
    ]}) };
  });
  const app = createServer(config);
  app.server.listen(0,'127.0.0.1'); await once(app.server,'listening');
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  assert.equal(await (await fetch(base+'/healthz')).text(),'ok');
  assert.equal((await fetch(base+'/.env')).status,404);
  const ws = new WebSocket(base.replace('http:','ws:')+'/signal',{origin:env.PUBLIC_ORIGIN});
  await once(ws,'open');
  async function exchange(m) {
    const response=once(ws,'message'); ws.send(JSON.stringify(m));
    return JSON.parse((await response)[0]);
  }
  assert.equal((await exchange({type:'ice-config'})).type,'error');
  assert.equal((await exchange({type:'create',name:'Amigo',accessKey:'wrong'})).type,'error');
  assert.equal(calls,0); assert.equal(app.rooms.size,0);
  const joined=await exchange({type:'create',name:'Amigo',accessKey:env.ACCESS_KEY});
  assert.equal(joined.type,'joined'); assert.equal(joined.iceTransportPolicy,'relay');
  assert.equal(joined.iceServers[1].credential,'temporary-password');
  assert.ok(!JSON.stringify(joined).includes(env.TWILIO_AUTH_TOKEN));
  assert.ok(!JSON.stringify(joined).includes(env.ACCESS_KEY));
  const renewed=await exchange({type:'ice-config'});
  assert.deepEqual(renewed.iceServers,joined.iceServers); assert.equal(calls,1);
});

test('falha do provedor não expõe segredos nem aceita sala sem TURN', async () => {
  const config=deploymentConfig(env, async () => {throw Error(env.TWILIO_AUTH_TOKEN);});
  await assert.rejects(config.iceProvider(), /Verifique o serviço TURN/);
});

