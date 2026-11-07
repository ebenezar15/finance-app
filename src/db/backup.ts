import { encryptJSON, decryptJSON, type Envelope } from '../lib/crypto';
import { ALL_TABLES, db } from './db';

export interface Snapshot {
  app: 'tandem'; schema: number; exportedAt: string; tables: Record<string, unknown[]>;
  device?: string; counts?: { transactions: number; accounts: number };
}

/**
 * Settings that belong to this device only: sign-in tokens, the chosen backup folder, the
 * device's own backup bookkeeping. They are never written into a backup, and restoring a
 * backup keeps this device's values.
 */
export const LOCAL_ONLY_SETTINGS = ['gdrive', 'backupFolder', 'backupState', 'account', 'passkey', 'lockPrefs', 'accountPromptDone'];

export async function snapshot(): Promise<Snapshot> {
  const tables: Record<string, unknown[]> = {};
  for (const name of ALL_TABLES) tables[name] = await db.table(name).toArray();
  tables.settings = (tables.settings as { key: string }[]).filter((s) => !LOCAL_ONLY_SETTINGS.includes(s.key));
  return {
    app: 'tandem', schema: db.verno, exportedAt: new Date().toISOString(), tables,
    device: deviceId(),
    counts: { transactions: tables.transactions.length, accounts: tables.accounts.length },
  };
}

/** A stable id for this browser, so backups from other devices can be told apart. */
export function deviceId() {
  try {
    let id = localStorage.getItem('tandem-device');
    if (!id) { id = Math.random().toString(36).slice(2, 10); localStorage.setItem('tandem-device', id); }
    return id;
  } catch { return 'unknown'; }
}

/** Accepts anything that looks like a Tandem backup (plain snapshot), else explains why not. */
export function asSnapshot(value: unknown): Snapshot {
  const v = value as Partial<Snapshot> | null;
  if (!v || v.app !== 'tandem' || typeof v.tables !== 'object') throw new Error('This file is not a Tandem backup.');
  return v as Snapshot;
}

/** Replaces all local data with the snapshot, atomically. */
export async function restore(snap: Snapshot) {
  if (snap.app !== 'tandem') throw new Error('This file is not a Tandem backup.');
  await db.transaction('rw', ALL_TABLES.map((n) => db.table(n)), async () => {
    const keep = (await db.settings.bulkGet(LOCAL_ONLY_SETTINGS)).filter(Boolean);
    for (const name of ALL_TABLES) {
      const t = db.table(name);
      await t.clear();
      const rows = name === 'settings'
        ? ((snap.tables.settings ?? []) as { key: string }[]).filter((s) => !LOCAL_ONLY_SETTINGS.includes(s.key))
        : snap.tables[name];
      if (rows?.length) await t.bulkPut(rows);
    }
    if (keep.length) await db.settings.bulkPut(keep as { key: string; value: unknown }[]);
  });
}

export async function exportEncrypted(pass: string, iterations?: number) {
  return encryptJSON(await snapshot(), pass, iterations);
}

export async function importEncrypted(env: Envelope, pass: string) {
  await restore(await decryptJSON<Snapshot>(env, pass));
}
