/**
 * Unlock with fingerprint, Face ID or the phone's passcode, using the phone's built-in passkey
 * support (WebAuthn with a "platform authenticator"). The phone keeps a private key that only
 * comes out after its own biometric/passcode check; Tandem keeps the public key. To unlock,
 * Tandem sends a fresh random challenge and verifies the phone's signature, so a fake "yes"
 * can't open the app.
 */
import { db } from '../db/db';

export interface PasskeyRecord { credentialId: string; publicKey?: string; alg?: number; createdAt: number }

const b64u = (buf: ArrayBuffer | Uint8Array) => {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = ''; for (const c of u) s += String.fromCharCode(c);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

/** True when this phone/computer has a built-in fingerprint, face or passcode check usable here. */
export async function biometricAvailable(): Promise<boolean> {
  try {
    if (import.meta.env.VITE_EMBED === '1') return false; // not allowed inside the Claude frame
    const P = (window as unknown as { PublicKeyCredential?: { isUserVerifyingPlatformAuthenticatorAvailable?: () => Promise<boolean> } }).PublicKeyCredential;
    return !!(await P?.isUserVerifyingPlatformAuthenticatorAvailable?.());
  } catch { return false; }
}

export async function getPasskey(): Promise<PasskeyRecord | null> {
  return ((await db.settings.get('passkey'))?.value as PasskeyRecord | undefined) ?? null;
}

/** Registers this phone's fingerprint / Face ID / passcode for unlocking Tandem. */
export async function enableBiometric(label: string): Promise<void> {
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: 'Tandem' },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: label || 'Tandem', displayName: label || 'Tandem' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      timeout: 60_000,
      attestation: 'none',
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error('Fingerprint / Face ID setup was cancelled.');
  const resp = cred.response as AuthenticatorAttestationResponse & { getPublicKey?: () => ArrayBuffer | null; getPublicKeyAlgorithm?: () => number };
  const spki = resp.getPublicKey?.();
  await db.settings.put({ key: 'passkey', value: { credentialId: b64u(cred.rawId), publicKey: spki ? b64u(spki) : undefined, alg: resp.getPublicKeyAlgorithm?.(), createdAt: Date.now() } satisfies PasskeyRecord });
}

export async function disableBiometric() { await db.settings.delete('passkey'); }

/** Converts an ASN.1 DER ECDSA signature to the raw r||s form WebCrypto verifies. */
export function derToRaw(der: Uint8Array, size = 32): Uint8Array {
  let i = 2;
  if (der[1] & 0x80) i = 2 + (der[1] & 0x7f);
  const read = () => {
    if (der[i++] !== 0x02) throw new Error('bad signature');
    const len = der[i++];
    let v = der.slice(i, i + len); i += len;
    while (v.length > size && v[0] === 0) v = v.slice(1);
    const out = new Uint8Array(size); out.set(v, size - v.length);
    return out;
  };
  const r = read(); const s = read();
  const raw = new Uint8Array(size * 2); raw.set(r); raw.set(s, size);
  return raw;
}

/**
 * Checks an assertion: right ceremony type, our challenge, our origin, the phone confirmed the
 * person (user-verified flag), and a valid signature from the registered key.
 */
export async function verifyAssertion(rec: PasskeyRecord, challenge: Uint8Array, a: { clientDataJSON: ArrayBuffer; authenticatorData: ArrayBuffer; signature: ArrayBuffer }, origin = location.origin) {
  const client = JSON.parse(new TextDecoder().decode(a.clientDataJSON));
  if (client.type !== 'webauthn.get' || client.challenge !== b64u(challenge) || client.origin !== origin) return false;
  const auth = new Uint8Array(a.authenticatorData);
  const UP = 0x01, UV = 0x04;
  if (!(auth[32] & UP) || !(auth[32] & UV)) return false;
  if (!rec.publicKey) return true; // very old browsers don't expose the key; the platform check above still ran
  const signed = new Uint8Array(auth.length + 32);
  signed.set(auth); signed.set(new Uint8Array(await crypto.subtle.digest('SHA-256', a.clientDataJSON)), auth.length);
  const spki = unb64u(rec.publicKey);
  if ((rec.alg ?? -7) === -7) {
    const key = await crypto.subtle.importKey('spki', spki as BufferSource, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, derToRaw(new Uint8Array(a.signature)) as BufferSource, signed as BufferSource);
  }
  const key = await crypto.subtle.importKey('spki', spki as BufferSource, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  return crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, a.signature as BufferSource, signed as BufferSource);
}

/** Shows the phone's fingerprint / Face ID / passcode prompt. Resolves true only when verified. */
export async function unlockWithBiometric(): Promise<boolean> {
  const rec = await getPasskey();
  if (!rec) return false;
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const cred = (await navigator.credentials.get({
    publicKey: { challenge, allowCredentials: [{ type: 'public-key', id: unb64u(rec.credentialId), transports: ['internal'] }], userVerification: 'required', timeout: 60_000 },
  })) as PublicKeyCredential | null;
  if (!cred) return false;
  const r = cred.response as AuthenticatorAssertionResponse;
  return verifyAssertion(rec, challenge, { clientDataJSON: r.clientDataJSON, authenticatorData: r.authenticatorData, signature: r.signature });
}
