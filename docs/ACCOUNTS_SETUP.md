# Tandem accounts: one-time setup

Tandem accounts let a person sign in with an email and password on any phone or computer and get their household back. After that, the phone's fingerprint, Face ID or passcode unlocks the app.

## How it works

- **End-to-end encrypted.** The password never leaves the phone. It is stretched (PBKDF2, 310,000 rounds) into two keys:
  - a sign-in key, which the server stores only as a scrypt hash;
  - an unlock key, which wraps the household's random data key.
- **Encrypted before upload.** The household is compressed and encrypted (AES-GCM) on the phone, then uploaded. The server can't read any of it.
- **Recovery key.** Each account gets a recovery key at sign-up. Because the server can't read anything, there is **no email password reset**. If someone forgets their password, only the recovery key gets them back in.
- **Fingerprint / Face ID / passcode.** These use the phone's built-in passkeys (WebAuthn). Each phone sets them up separately in Settings → Account & unlock. The fingerprint itself never reaches Tandem.
- **Sync.** Changes sync about 30 seconds after you make them, and again when the app goes to the background. When the app opens, a phone with no changes of its own updates quietly. If both devices changed the data, Tandem asks which copy to keep.

## Switch it on (Vercel, about 2 minutes)

1. Open the **tandem-money** project on vercel.com, then go to **Storage**.
2. Choose **Create Database** → **Upstash for Redis** (the free plan is enough). Connect it to the project for all environments.
   - Vercel adds `KV_REST_API_URL` and `KV_REST_API_TOKEN` to the project. `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` also work.
3. Go to **Deployments**, open the latest deployment's ⋯ menu, and choose **Redeploy**.

To check it worked: open the app's welcome screen. It now shows **Create an account** and **Sign in**. Until the database is connected, Tandem works as before and only offers the fingerprint / Face ID lock.

## Limits

- Rate limit: 10 sign-in attempts per email per 15 minutes.
- Sessions last 180 days.
- Encrypted households up to about 900 KB compressed, which is tens of thousands of entries.
