# Tandem

An offline-first money app for households: budgets, bills, goals, debts, net worth and the whole family's spending in one place. Everything is stored on the device; nothing leaves it unless you turn on an online feature.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (money math, parsers, backup round-trip)
npm run build      # production PWA in dist/ (installable, works offline)
npm run preview    # serve the production build
```

On first launch, pick **Explore with demo data** to get a realistic four-person household with 12 months of history, or **Set up my household** for the two-minute onboarding.

Shortcuts on desktop: `N` adds an entry, `/` jumps to search.

## What's in it

| Area | Highlights |
|---|---|
| Home | Safe-to-spend today, an interactive cash-flow river (income → categories → kept), cards you can reorder or hide, a kid-friendly home with savings jars |
| Quick add | Keypad-first sheet with a built-in calculator (`250+120×2`), suggestions by time of day and history, favourites, per-member splits, undo |
| Activity | Instant search, filters, bulk edit, CSV export, a 30-day trash |
| Budgets | Envelope, zero-based, 50/30/20 or simple caps; rollover; burn-rate warnings; event budgets |
| Bills | Calendar, recurring rules with auto-post, subscription detector with price-change alerts, reminders |
| Goals & debts | Goal projections, emergency-fund calculator, EMI and amortisation, prepayment simulator, snowball vs avalanche, IOUs |
| Net worth | Holdings, allocation, reconcile mode, credit utilisation |
| Insights | Health score (0–100) with its parts shown, 30/60/90-day forecast, what-if sliders, anomalies, a shareable monthly story |
| Inbox & import | Review inbox, bank-alert/SMS parser, CSV and OFX import with duplicate detection, voice entry |
| Family | Roles, who-spent-what, pocket money and chores, split and settle |
| Settings | Themes (light, dark, high contrast), accent colour, PIN lock, encrypted backup and restore |

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
