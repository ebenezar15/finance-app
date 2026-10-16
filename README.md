# Tandem

An offline-first money app for households: budgets, bills, goals, debts, net worth and the whole family's spending in one place. Everything is stored on the device; nothing leaves it unless you turn on an online feature.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (money math, parsers, backup round-trip)
npm run e2e        # browser checks: offline, no third-party requests, 5-second entry
npm run build      # production PWA in dist/ (installable, works offline)
npm run preview    # serve the production build
npm run build:embed  # one self-contained page (dist-embed/tandem.html) for single-page hosts
```

## Phones (iPhone and Android)

Tandem is an installable web app: one codebase that runs full screen from the home screen on both platforms, works offline, and asks the browser to keep its data rather than clear it.

- **iPhone or iPad:** open it in Safari → Share → **Add to Home Screen**.
- **Android:** open it in Chrome → ⋮ → **Install app**. Chrome may also offer it on its own.
- **"Can't install" on Android?** Make sure the link is open in Chrome itself. Browsers built into WhatsApp, Gmail, Instagram and similar apps can't install apps, and Tandem now detects them and explains how to switch. A claude.ai link can't be installed either; use your own web address.
- **Hosting your own install link:** merge to `main` and turn on GitHub Pages (Settings → Pages → Source: GitHub Actions). The `pages.yml` workflow publishes it at `https://<you>.github.io/finance-app/`.

## Memory, sign-in and sync

- **On the device:** everything is saved in the browser's database (IndexedDB) and survives restarts. Data is never reset unless you choose **Erase everything**.
- **Shared Claude link:** your Claude account is the sign-in. Your household is saved privately under your account, so it follows you to any phone or computer where you open the link. Nobody else can read it, including the person who shared the link.
- **Ask about your money outside Claude:** paste your own Claude API key (console.anthropic.com) in Insights. It's stored only on the device; questions go straight from the phone to the Claude API, and only aggregated totals are sent.
- **Moving data from the standalone app:** Settings → Data and backup → **Send to email or Drive** shares an encrypted backup through the phone's share sheet. Restore it on the new device with your passphrase.

## Currencies

Tandem works in any ISO 4217 currency the browser knows (about 300). Pick one during setup or in Settings; the default comes from your device's region.

- Amounts show with each currency's own decimals (JPY has none, KWD has three) and its usual digit grouping (INR shows 1,00,000).
- Dates stay in English but follow your region's order.
- The quick-add calculator and imports accept any currency symbol or code (`€12`, `CHF 9.50`, `120 SEK`).
- The bank-alert parser recognises every ISO code plus common symbols (₦ ₱ ₺ ฿ ₩ R$ zł…). A bare `$` or `¥` is read as your own currency.

On first launch, pick **Explore with demo data** to get a realistic four-person household with 12 months of history, or **Set up my household** for the two-minute onboarding.

Shortcuts on desktop: `N` adds an entry, `/` jumps to search.

## What's in it

| Area | Highlights |
|---|---|
| Home | Safe-to-spend today, an interactive cash-flow river (income → categories → kept), cards you can reorder or hide, a kid-friendly home with savings jars |
| Quick add | Keypad-first sheet with a built-in calculator (`250+120×2`), "For what?" notes, how you paid (cash, card, online/UPI, transfer, wallet, cheque), tags, suggestions by time of day, favourites, per-member splits, undo |
| Activity | Instant search, filters, bulk edit, CSV export, a 30-day trash |
| Budgets | Envelope, zero-based, 50/30/20 or simple caps; rollover; burn-rate warnings; event budgets |
| Bills | Calendar, recurring rules with auto-post, subscription detector with price-change alerts, reminders |
| Goals & debts | Goal projections, emergency-fund calculator, EMI and amortisation, prepayment simulator, snowball vs avalanche, IOUs |
| Net worth | Holdings, allocation, reconcile mode, credit utilisation |
| Insights | Ask about your money (Claude, from aggregated totals only), a year-in-spending heatmap with no-spend streaks, health score (0–100) with its parts shown, 30/60/90-day forecast, what-if sliders, anomalies, a shareable monthly story |
| Inbox & import | Review inbox, bank-alert/SMS parser, CSV and OFX import with duplicate detection, voice entry |
| Family | Roles, who-spent-what, pocket money and chores, split and settle |
| Settings | Six colour schemes × light/dark (plus high contrast), PIN lock, account sync status, install guide, encrypted backup, restore and share-to-email |

## Architecture

- **React 18 + TypeScript + Vite**, Tailwind with a CSS-variable token layer (`src/index.css`).
- **Dexie (IndexedDB)** for storage (`src/db/db.ts`). Every schema change adds a new `version()` with an upgrade; old versions are never edited.
- **Pure money engine** in `src/lib/finance.ts`. It has no database or UI imports, so every rule is unit-tested. All amounts are integer minor units (cents or paise); floats never touch stored money.
- **PWA** via `vite-plugin-pwa` (Workbox). The app shell and the self-hosted font are precached, so the app opens in airplane mode.
- Encrypted backups use WebCrypto: PBKDF2-SHA256 (310k iterations) and AES-GCM-256 (`src/lib/crypto.ts`).

```
src/
  db/         schema, types, live hooks, demo-data generator, backup
  lib/        money, dates, finance engine, sms, csv/ofx, voice, categorise, crypto
  components/ layout, quick add, cash-flow river, shared UI
  pages/      one file per screen (lazy-loaded)
```

## Adding a bank alert (SMS) template

Templates live in `TEMPLATES` in `src/lib/sms.ts`. Each one has a `match` regex and an `extract` function that returns the fields it is sure about, plus a confidence score. The generic parser fills in last-4, merchant, balance and reference number afterwards.

1. Add a fixture for the new message to `src/lib/__tests__/sms.fixtures.ts`.
2. Add or adjust a template.
3. Run `npm test`. The suite requires at least 90% accuracy, and any wrong amount or direction must score below the review threshold, so it lands in the review inbox instead of being posted.

## Mobile builds

The web code is ready to wrap with Capacitor for Android and iOS. That phase adds SMS and notification reading, biometric unlock and background reminders. See `docs/PLAN.md`.

Not professional financial advice.
