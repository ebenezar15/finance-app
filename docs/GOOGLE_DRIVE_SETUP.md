# Switch on Google Drive backup (one-time, about 10 minutes)

This registers the **app** with Google. It does not create a shared Drive. Every person who uses
Tandem taps **Sign in with Google**, picks **their own** Google account on Google's chooser, and
their backups go only to **their own** Drive. Nobody else, including you as the owner of this
Google Cloud project, can see their files. You do this once; users never see these settings.

## 1. Create a Google Cloud project
1. Open https://console.cloud.google.com and sign in with your Gmail account.
2. Top bar → project picker → **New project** → name it `Tandem` → **Create**, then select it.

## 2. Turn on the Drive API
**APIs & Services → Library** → search **Google Drive API** → **Enable**.

## 3. Describe the app to Google (consent screen)
**APIs & Services → OAuth consent screen** (shown as **Google Auth Platform** in newer consoles):
- **App name:** Tandem · **User support email:** your Gmail · **Audience:** External.
- **Data access / Scopes:** add `.../auth/drive.file`, `openid` and `.../auth/userinfo.email`.
  These are non-sensitive scopes: Tandem can only see files it creates itself, so Google does
  not require a review.
- **Audience → Publish app** (status *In production*). Leave it in *Testing* only if you add
  every user under *Test users*, and note that Google then signs people out after 7 days.

## 4. Create the sign-in key
**APIs & Services → Credentials** (or **Clients**) → **Create credentials → OAuth client ID**:
- **Application type:** Web application · **Name:** Tandem web
- **Authorized JavaScript origins:** your app's address, e.g. `https://tandem-money.vercel.app`
  (add every domain you use, one per line, no trailing slash)
- **Authorized redirect URIs:** leave empty
- **Create** → copy the **Client ID** and **Client secret**.

## 5. Give the keys to the Vercel site
Vercel → project **tandem-money** → **Settings → Environment Variables** → add, for *Production*
(and *Preview* if you use it):

| Name | Value |
|---|---|
| `GOOGLE_CLIENT_ID` | the Client ID (ends in `.apps.googleusercontent.com`) |
| `GOOGLE_CLIENT_SECRET` | the Client secret |

Then **Deployments → … → Redeploy** the latest deployment.

## 6. Check it
Open the app → **Settings → Automatic backup → Sign in with Google**. After signing in you
should see "Backing up to your@gmail.com", and a **Tandem backups** folder appears in Drive.

The client secret stays on the server (Vercel). The phone only ever holds its own sign-in token,
which is never written into backups.
