/**
 * Encrypted backup format (.tandem): JSON envelope with PBKDF2-SHA256 (310k iterations) →
 * AES-GCM-256. Everything happens in WebCrypto on-device.
 */
const enc = new TextEncoder();
const dec = new TextDecoder();
const ITER = 310_000;

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function key(pass: string, salt: Uint8Array, iterations: number) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' }, base,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}

export interface Envelope { format: 'tandem-backup'; v: 1; kdf: 'PBKDF2-SHA256'; iter: number; salt: string; iv: string; data: string }

export async function encryptJSON(obj: unknown, pass: string, iterations = ITER): Promise<Envelope> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const k = await key(pass, salt, iterations);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, enc.encode(JSON.stringify(obj))));
  // chunked base64 so large backups don't blow the call stack
  let data = '';
  for (let i = 0; i < ct.length; i += 0x8000) data += String.fromCharCode(...ct.subarray(i, i + 0x8000));
  return { format: 'tandem-backup', v: 1, kdf: 'PBKDF2-SHA256', iter: iterations, salt: b64(salt), iv: b64(iv), data: btoa(data) };
}

export async function decryptJSON<T>(env: Envelope, pass: string): Promise<T> {
  if (env.format !== 'tandem-backup') throw new Error('This file is not a Tandem backup.');
  const k = await key(pass, unb64(env.salt), env.iter);
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(env.iv) as BufferSource }, k, unb64(env.data) as BufferSource);
    return JSON.parse(dec.decode(pt));
  } catch {
    throw new Error('Wrong passphrase, or the file is damaged.');
  }
}

/** PIN hashing for the app lock (salted PBKDF2; never stored in plain text). */
export async function hashPin(pin: string, saltB64?: string) {
  const salt = saltB64 ? unb64(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const base = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: salt as BufferSource, iterations: 100_000, hash: 'SHA-256' }, base, 256);
  return { salt: b64(salt), hash: b64(new Uint8Array(bits)) };
}
