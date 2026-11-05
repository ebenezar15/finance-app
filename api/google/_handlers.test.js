import { afterEach, describe, expect, it, vi } from 'vitest';
import config from './config.js';
import refresh from './refresh.js';
import token from './token.js';

function res() {
  return { statusCode: 0, headers: {}, body: '', setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; }, json() { return JSON.parse(this.body); } };
}
const req = (body, extra = {}) => ({ method: 'POST', headers: { host: 'tandem-money.vercel.app', origin: 'https://tandem-money.vercel.app', ...extra }, body });

afterEach(() => { delete process.env.GOOGLE_CLIENT_ID; delete process.env.GOOGLE_CLIENT_SECRET; });

describe('Google backup endpoints', () => {
  it('reports not configured until both env vars exist, and never exposes the secret', async () => {
    let r = res(); config({}, r);
    expect(r.json()).toEqual({ enabled: false, clientId: null });
    process.env.GOOGLE_CLIENT_ID = 'cid.apps.googleusercontent.com'; process.env.GOOGLE_CLIENT_SECRET = 'shh';
    r = res(); config({}, r);
    expect(r.json()).toEqual({ enabled: true, clientId: 'cid.apps.googleusercontent.com' });
    expect(r.body).not.toContain('shh');
  });

  it('exchanges a code with the server-side secret and postmessage redirect', async () => {
    process.env.GOOGLE_CLIENT_ID = 'cid'; process.env.GOOGLE_CLIENT_SECRET = 'shh';
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ access_token: 'at', refresh_token: 'rt', expires_in: 3599, id_token: 'x.y.z', scope: 'drive.file' }), { status: 200 }));
    const r = res();
    await token(req({ code: 'c0de' }), r, fetchImpl);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ access_token: 'at', refresh_token: 'rt', expires_in: 3599, id_token: 'x.y.z' });
    const sent = new URLSearchParams(fetchImpl.mock.calls[0][1].body);
    expect(Object.fromEntries(sent)).toEqual({ code: 'c0de', client_id: 'cid', client_secret: 'shh', redirect_uri: 'postmessage', grant_type: 'authorization_code' });
  });

  it('refreshes, and maps a revoked token to 401', async () => {
    process.env.GOOGLE_CLIENT_ID = 'cid'; process.env.GOOGLE_CLIENT_SECRET = 'shh';
    let r = res();
    await refresh(req({ refresh_token: 'rt' }), r, async () => new Response(JSON.stringify({ access_token: 'at2', expires_in: 3599 })));
    expect(r.json()).toMatchObject({ access_token: 'at2' });
    r = res();
    await refresh(req({ refresh_token: 'bad' }), r, async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }));
    expect(r.statusCode).toBe(401);
    expect(r.json()).toEqual({ error: 'invalid_grant' });
  });

  it('rejects other websites, wrong methods and missing config', async () => {
    process.env.GOOGLE_CLIENT_ID = 'cid'; process.env.GOOGLE_CLIENT_SECRET = 'shh';
    let r = res(); await token(req({ code: 'c' }, { origin: 'https://evil.example' }), r, vi.fn());
    expect(r.statusCode).toBe(403);
    r = res(); await refresh({ method: 'GET', headers: {} }, r);
    expect(r.statusCode).toBe(405);
    delete process.env.GOOGLE_CLIENT_SECRET;
    r = res(); await token(req({ code: 'c' }), r, vi.fn());
    expect(r.statusCode).toBe(503);
  });
});
