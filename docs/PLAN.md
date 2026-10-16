# Plan

## Phases

| # | Phase | Status |
|---|---|---|
| 1 | Foundation: PWA, tokens and themes, routing, Dexie schema, app lock, onboarding, demo data | Done |
| 2 | Core money: accounts, quick add (calculator, splits, transfers), categories, search, dashboard | Done |
| 3 | Budgets & bills: styles, rollover, recurring auto-post, calendar, reminders, subscription detector | Done |
| 4 | Auto entry: alert/SMS parser, CSV + OFX import, voice, auto-categorisation, review inbox | Done (web). Next: Capacitor Android SMS and notification listener, on-device OCR (Tesseract.js), XLSX and PDF import |
| 5 | Goals, debts, investments, net worth, family roles, kids' view, splitting | Done |
| 6 | Insights: trends, anomalies, health score, forecast, what-if, monthly story | Done |
| 7 | Vault, tax organiser, insurance, reports & exports, encrypted backup/restore | Backup, restore and CSV export done. Next: document vault, tax summary per FY, insurance tracker, PDF reports |
| 8 | Sync (E2E encrypted, CRDT) | Not started. Interim: move data with an encrypted backup file |
| 9 | Polish: Lighthouse, a11y audit, offline e2e suite, Capacitor builds, store assets | Partly done |

## Data model

See `src/db/types.ts`, which is the source of truth. Main entities: Member, Account, Transaction (with splits, source, confidence, soft delete), Category, Budget, RecurringRule, Goal, Loan, Holding, IOU, MerchantRule, Setting, AuditEntry.
