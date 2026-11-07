// Server side of Tandem accounts. Zero-knowledge by design: the server stores only a hash of a
// key *derived* from the password (never the password), the person's data key wrapped by their
// password and by their recovery key, and their household data encrypted on the phone. It can
// check who is signing in, but it can never read anyone's finances.
//
// Storage: Upstash Redis over REST (Vercel → Storage → Upstash for Redis sets these env vars).
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb);
const SESSION_TTL = 180 * 24 * 3600; // seconds
export const MAX_VAULT_BYTES = 900_000; // stays under Upstash's 1 MB request limit

export function redisFromEnv(env = process.env, fetchImpl = fetch) {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  const cmd = async (...args) => {
    const r = await fetchImpl(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error(`redis: ${j.error || r.status}`);
    return j.result;
  };
  return {
    get: async (k) => { const v = await cmd('GET', k); return v == null ? null : JSON.parse(v); },
    set: (k, v, ttl) => (ttl ? cmd('SET', k, JSON.stringify(v), 'EX', String(ttl)) : cmd('SET', k, JSON.stringify(v))),
    del: (k) => cmd('DEL', k),
    incr: async (k, ttl) => { const n = await cmd('INCR', k); if (n === 1) await cmd('EXPIRE', k, String(ttl)); return n; },
  };
}

const b64 = (buf) => Buffer.from(buf).toString('base64');
const normEmail = (e) => String(e || '').trim().toLowerCase();
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254;
const isB64 = (s, min = 16, max = 4096) => typeof s === 'string' && s.length >= min && s.length <= max && /^[A-Za-z0-9+/=_-]+$/.test(s);
const isWrapped = (w) => w && isB64(w.iv, 8, 64) && isB64(w.ct, 16, 512);

async function hashSecret(secret, salt = randomBytes(16)) {
  const h = await scrypt(Buffer.from(secret, 'base64'), salt, 32, { N: 16384, r: 8, p: 1 });
  return { salt: b64(salt), hash: b64(h) };
}
async function checkSecret(secret, rec) {
  const h = await scrypt(Buffer.from(secret, 'base64'), Buffer.from(rec.salt, 'base64'), 32, { N: 16384, r: 8, p: 1 });
  const want = Buffer.from(rec.hash, 'base64');
  return want.length === h.length && timingSafeEqual(want, h);
}

const fail = (status, error, message) => ({ status, body: { error, message } });
const ok = (body) => ({ status: 200, body });

async function newSession(redis, email) {
  const token = randomBytes(32).toString('base64url');
  await redis.set(`session:${token}`, { email, at: Date.now() }, SESSION_TTL);
  return token;
}
async function sessionEmail(redis, token) {
  if (typeof token !== 'string' || token.length < 20) return null;
  return (await redis.get(`session:${token}`))?.email ?? null;
}
/** Slows down password guessing: 10 attempts per account (and per address) every 15 minutes. */
async function tooMany(redis, key) {
  return (await redis.incr(`rl:${key}`, 900)) > 10;
}

/** One entry point for all account actions; `ip` comes from the request for rate limiting. */
export async function handleAccount(body, { redis, ip = 'unknown' }) {
  if (!redis) return body?.action === 'status' ? ok({ enabled: false }) : fail(503, 'not_configured', 'Accounts aren’t switched on for this app yet.');
  const action = body?.action;
  const email = normEmail(body?.email);

  switch (action) {
    case 'status':
      return ok({ enabled: true });

    case 'signup': {
      if (!validEmail(email)) return fail(400, 'bad_email', 'Enter a valid email address.');
      if (!isB64(body.authKey, 40, 100) || !isB64(body.recoveryAuth, 40, 100) || !isWrapped(body.wrappedByPass) || !isWrapped(body.wrappedByRecovery)) return fail(400, 'bad_request', 'Something went wrong. Try again.');
      if (await tooMany(redis, `signup:${ip}`)) return fail(429, 'rate_limited', 'Too many attempts. Wait 15 minutes and try again.');
      if (await redis.get(`user:${email}`)) return fail(409, 'exists', 'An account with this email already exists. Sign in instead.');
      const auth = await hashSecret(body.authKey);
      const rec = await hashSecret(body.recoveryAuth);
      await redis.set(`user:${email}`, {
        email, name: String(body.name || '').slice(0, 80), auth, rec,
        wrappedByPass: body.wrappedByPass, wrappedByRecovery: body.wrappedByRecovery, createdAt: Date.now(),
      });
      return ok({ token: await newSession(redis, email), email });
    }

    case 'login': {
      if (!validEmail(email) || !isB64(body.authKey, 40, 100)) return fail(400, 'bad_request', 'Enter your email and password.');
      if ((await tooMany(redis, `login:${email}`)) || (await tooMany(redis, `login-ip:${ip}`))) return fail(429, 'rate_limited', 'Too many attempts. Wait 15 minutes and try again.');
      const user = await redis.get(`user:${email}`);
      // Same message whether the email exists or not, so accounts can't be discovered.
      if (!user || !(await checkSecret(body.authKey, user.auth))) return fail(401, 'bad_credentials', 'That email and password don’t match.');
      return ok({ token: await newSession(redis, email), email, name: user.name, wrappedByPass: user.wrappedByPass });
    }

    case 'logout':
      if (typeof body.token === 'string') await redis.del(`session:${body.token}`);
      return ok({});

    case 'recover-start': {
      if (!validEmail(email) || !isB64(body.recoveryAuth, 40, 100)) return fail(400, 'bad_request', 'Enter your email and recovery key.');
      if (await tooMany(redis, `recover:${email}`)) return fail(429, 'rate_limited', 'Too many attempts. Wait 15 minutes and try again.');
      const user = await redis.get(`user:${email}`);
      if (!user || !(await checkSecret(body.recoveryAuth, user.rec))) return fail(401, 'bad_recovery', 'That recovery key doesn’t match this email.');
      return ok({ wrappedByRecovery: user.wrappedByRecovery });
    }

    case 'recover-finish': {
      if (!isB64(body.recoveryAuth, 40, 100) || !isB64(body.newAuthKey, 40, 100) || !isWrapped(body.newWrappedByPass)) return fail(400, 'bad_request', 'Something went wrong. Try again.');
      const user = await redis.get(`user:${email}`);
      if (!user || !(await checkSecret(body.recoveryAuth, user.rec))) return fail(401, 'bad_recovery', 'That recovery key doesn’t match this email.');
      await redis.set(`user:${email}`, { ...user, auth: await hashSecret(body.newAuthKey), wrappedByPass: body.newWrappedByPass });
      return ok({ token: await newSession(redis, email), email, name: user.name });
    }

    case 'change-password': {
      const who = await sessionEmail(redis, body.token);
      if (!who) return fail(401, 'signed_out', 'Sign in again to change your password.');
      const user = await redis.get(`user:${who}`);
      if (!user || !isB64(body.oldAuthKey, 40, 100) || !(await checkSecret(body.oldAuthKey, user.auth))) return fail(401, 'bad_credentials', 'Your current password isn’t right.');
      if (!isB64(body.newAuthKey, 40, 100) || !isWrapped(body.newWrappedByPass)) return fail(400, 'bad_request', 'Something went wrong. Try again.');
      await redis.set(`user:${who}`, { ...user, auth: await hashSecret(body.newAuthKey), wrappedByPass: body.newWrappedByPass });
      return ok({});
    }

    case 'vault-meta':
    case 'vault-get': {
      const who = await sessionEmail(redis, body.token);
      if (!who) return fail(401, 'signed_out', 'Your session ended. Sign in again.');
      const v = await redis.get(`vault:${who}`);
      if (!v) return ok({ exists: false });
      return ok(action === 'vault-meta'
        ? { exists: true, version: v.version, updatedAt: v.updatedAt, device: v.device }
        : { exists: true, version: v.version, updatedAt: v.updatedAt, device: v.device, blob: v.blob });
    }

    case 'vault-put': {
      const who = await sessionEmail(redis, body.token);
      if (!who) return fail(401, 'signed_out', 'Your session ended. Sign in again.');
      if (typeof body.blob !== 'string' || !body.blob) return fail(400, 'bad_request', 'Nothing to save.');
      if (body.blob.length > MAX_VAULT_BYTES) return fail(413, 'too_large', 'Your data is too large to sync. Use Google Drive or phone backups instead.');
      const cur = await redis.get(`vault:${who}`);
      // Optimistic concurrency: refuse to overwrite a newer copy from another device unless forced.
      if (cur && body.baseVersion !== undefined && body.baseVersion !== cur.version && !body.force) {
        return { status: 409, body: { error: 'conflict', version: cur.version, updatedAt: cur.updatedAt, device: cur.device } };
      }
      const version = (cur?.version ?? 0) + 1;
      await redis.set(`vault:${who}`, { blob: body.blob, version, updatedAt: Number(body.updatedAt) || Date.now(), device: String(body.device || '').slice(0, 40) });
      return ok({ version });
    }

    case 'delete-account': {
      const who = await sessionEmail(redis, body.token);
      if (!who) return fail(401, 'signed_out', 'Sign in again to delete your account.');
      const user = await redis.get(`user:${who}`);
      if (!user || !isB64(body.authKey, 40, 100) || !(await checkSecret(body.authKey, user.auth))) return fail(401, 'bad_credentials', 'Your password isn’t right.');
      await redis.del(`user:${who}`); await redis.del(`vault:${who}`); await redis.del(`session:${body.token}`);
      return ok({ deleted: true });
    }

    default:
      return fail(400, 'unknown_action', 'Unknown request.');
  }
}
