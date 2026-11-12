import { ingestCapture, redisFromEnv } from './_account-lib.js';
import { send } from './google/_shared.js';

/**
 * POST (or GET) /api/capture?k=<private link>
 * Called by the person's own phone automation (MacroDroid, Tasker, iOS Shortcuts) with the text
 * of a payment notification or bank SMS. Accepts the text as the raw body, as JSON { text },
 * as a form field `text`, or as a `text` query parameter.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' });
  const url = new URL(req.url, 'http://x');
  const link = url.searchParams.get('k') || String(req.headers['x-tandem-key'] || '');
  let text = url.searchParams.get('text') || '';
  let at = url.searchParams.get('at') || '';
  if (req.method === 'POST') {
    try {
      const type = String(req.headers['content-type'] || '');
      let raw = '';
      let parsed = null;
      // Vercel may have read the body already (object for JSON/forms, string or Buffer otherwise).
      if (Buffer.isBuffer(req.body)) raw = req.body.toString('utf8');
      else if (typeof req.body === 'string') raw = req.body;
      else if (req.body && typeof req.body === 'object') parsed = req.body;
      else {
        const chunks = []; let size = 0;
        for await (const c of req) { size += c.length; if (size > 8192) break; chunks.push(c); }
        raw = Buffer.concat(chunks).toString('utf8');
      }
      if (!parsed && type.includes('json')) parsed = JSON.parse(raw || '{}');
      if (!parsed && type.includes('x-www-form-urlencoded')) parsed = Object.fromEntries(new URLSearchParams(raw));
      if (parsed) { text = String(parsed.text ?? parsed.message ?? parsed.body ?? text); at = String(parsed.at ?? at); }
      else if (raw.trim()) text = raw;
    } catch { return send(res, 400, { error: 'bad_request' }); }
  }
  try {
    const out = await ingestCapture({ link, text, at }, { redis: redisFromEnv() });
    return send(res, out.status, out.body);
  } catch (e) {
    console.error('capture error', e);
    return send(res, 500, { error: 'server_error' });
  }
}
