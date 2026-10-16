# Privacy

- No analytics, no trackers, no ads, no account.
- All data lives in this browser's IndexedDB, or on the phone in the native app.
- The app makes no network requests apart from loading its own files. Online features (price refresh, "ask about my money") are off by default and labelled as online-only.
- Backups are encrypted on-device with a passphrase only you know. If you lose the passphrase, the backup cannot be recovered.
- An app PIN is stored as a salted PBKDF2 hash, never in plain text.
