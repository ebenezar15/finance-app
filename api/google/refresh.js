import { config, exchange, readJson, sameOrigin, send } from './_shared.js';

/** Turns the stored refresh token into a fresh access token, so backups run without a sign-in prompt. */
export default async function handler(req, res, fetchImpl = fetch) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  if (!sameOrigin(req)) return send(res, 403, { error: 'forbidden' });
  const c = config();
  if (!c.ready) return send(res, 503, { error: 'not_configured' });
  const { refresh_token } = await readJson(req).catch(() => ({}));
  if (typeof refresh_token !== 'string' || !refresh_token) return send(res, 400, { error: 'missing_refresh_token' });
  const out = await exchange({ refresh_token, client_id: c.id, client_secret: c.secret, grant_type: 'refresh_token' }, fetchImpl);
  return out.ok ? send(res, 200, out.body) : send(res, out.status, { error: out.error });
}
