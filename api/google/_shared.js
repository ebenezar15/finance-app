// Shared helpers for the Google Drive backup endpoints (Vercel Node functions).
// GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set in the Vercel project's environment variables.

export const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export function config() {
  const id = process.env.GOOGLE_CLIENT_ID;
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  return { id, secret, ready: Boolean(id && secret) };
}

/** Only the app's own pages may call these endpoints. */
export function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // same-origin fetches from some browsers omit it
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  try { return new URL(origin).host === host; } catch { return false; }
}

export async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

export function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

/** Calls Google's token endpoint and returns only what the app needs. */
export async function exchange(params, fetchImpl = fetch) {
  const r = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return { ok: false, status: r.status === 400 || r.status === 401 ? 401 : 502, error: j.error || 'google_error' };
  return {
    ok: true,
    body: { access_token: j.access_token, expires_in: j.expires_in, refresh_token: j.refresh_token, id_token: j.id_token },
  };
}
