import { handleAccount, redisFromEnv } from './_account-lib.js';
import { readJson, sameOrigin, send } from './google/_shared.js';

/** POST /api/account { action, ... } — see _account-lib.js for the actions. */
export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  if (!sameOrigin(req)) return send(res, 403, { error: 'forbidden' });
  let body;
  try { body = await readJson(req); } catch { return send(res, 400, { error: 'bad_json' }); }
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  try {
    const out = await handleAccount(body, { redis: redisFromEnv(), ip });
    return send(res, out.status, out.body);
  } catch (e) {
    console.error('account error', e);
    return send(res, 500, { error: 'server_error', message: 'The account service had a problem. Try again in a moment.' });
  }
}
