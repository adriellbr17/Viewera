// As credenciais permanentes ficam somente no servidor. O cliente recebe credenciais TURN temporárias.
export function deploymentConfig(env = process.env, request = fetch) {
  const production = env.NODE_ENV === 'production';
  const publicOrigin = env.PUBLIC_ORIGIN?.trim();
  if (publicOrigin && (new URL(publicOrigin).origin !== publicOrigin || new URL(publicOrigin).protocol !== 'https:')) {
    throw Error('PUBLIC_ORIGIN deve ser uma origem HTTPS, sem barra final ou caminho.');
  }
  const accessKey = env.ACCESS_KEY || '';
  const account = env.TWILIO_ACCOUNT_SID || '', token = env.TWILIO_AUTH_TOKEN || '';
  if (production && (!publicOrigin || !account || !token)) {
    throw Error('Configure PUBLIC_ORIGIN, TWILIO_ACCOUNT_SID e TWILIO_AUTH_TOKEN antes de publicar.');
  }
  if (!!account !== !!token) throw Error('Configure as duas credenciais Twilio.');
  if (account && !/^AC[a-f0-9]{32}$/i.test(account)) throw Error('TWILIO_ACCOUNT_SID inválido.');
  let cached, pending, expires = 0;
  async function iceProvider() {
    if (!account) return [];
    if (cached && Date.now() < expires) return cached;
    if (pending) return pending;
    pending = (async () => {
      const response = await request(`https://api.twilio.com/2010-04-01/Accounts/${account}/Tokens.json`, {
        method: 'POST', signal: AbortSignal.timeout(8000),
        headers: { Authorization: `Basic ${Buffer.from(`${account}:${token}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'Ttl=86400',
      });
      if (!response.ok) throw Error('Serviço de conexão indisponível. Confira a configuração TURN no servidor.');
      const data = await response.json();
      if (!Array.isArray(data.ice_servers)) throw Error('Resposta TURN inválida.');
      cached = data.ice_servers.map(s => ({ urls: s.urls || s.url, ...(s.username ? { username: s.username, credential: s.credential } : {}) }));
      if (!cached.some(s => /^(turn|turns):/.test(String(s.urls)))) { cached = null; throw Error('O serviço não retornou servidor TURN.'); }
      expires = Date.now() + 10 * 60_000;
      return cached;
    })();
    try { return await pending; }
    catch { throw Error('Não foi possível preparar a conexão pela internet. Verifique o serviço TURN.'); }
    finally { pending = null; }
  }
  return {
    origins: [publicOrigin, 'http://127.0.0.1:8787', 'http://localhost:8787', 'http://tauri.localhost', 'https://tauri.localhost', 'tauri://localhost'].filter(Boolean),
    accessKey, iceProvider, relayOnly: env.ICE_RELAY_ONLY === 'true',
  };
}

