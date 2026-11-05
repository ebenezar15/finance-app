import { config, exchange, readJson, sameOrigin, send } from './_shared.js';

/** Exchanges the one-time code from Google sign-in for access + refresh tokens. */
export default async function handler(req, res, fetchImpl = fetch) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  if (!sameOrigin(req)) return send(res, 403, { error: 'forbidden' });
  const c = config();
  if (!c.ready) return send(res, 503, { error: 'not_configured' });
  const { code } = await readJson(req).catch(() => ({}));
  if (typeof code !== 'string' || !code) return send(res, 400, { error: 'missing_code' });
  const out = await exchange({ code, client_id: c.id, client_secret: c.secret, redirect_uri: 'postmessage', grant_type: 'authorization_code' }, fetchImpl);
  return out.ok ? send(res, 200, out.body) : send(res, out.status, { error: out.error });
}
