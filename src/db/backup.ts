import { encryptJSON, decryptJSON, type Envelope } from '../lib/crypto';
import { ALL_TABLES, db } from './db';

export interface Snapshot { app: 'tandem'; schema: number; exportedAt: string; tables: Record<string, unknown[]> }

export async function snapshot(): Promise<Snapshot> {
  const tables: Record<string, unknown[]> = {};
  for (const name of ALL_TABLES) tables[name] = await db.table(name).toArray();
  return { app: 'tandem', schema: db.verno, exportedAt: new Date().toISOString(), tables };
}

/** Replaces all local data with the snapshot, atomically. */
export async function restore(snap: Snapshot) {
  if (snap.app !== 'tandem') throw new Error('This file is not a Tandem backup.');
  await db.transaction('rw', ALL_TABLES.map((n) => db.table(n)), async () => {
    for (const name of ALL_TABLES) {
      const t = db.table(name);
      await t.clear();
      if (snap.tables[name]?.length) await t.bulkPut(snap.tables[name]);
    }
  });
}

export async function exportEncrypted(pass: string, iterations?: number) {
  return encryptJSON(await snapshot(), pass, iterations);
}

export async function importEncrypted(env: Envelope, pass: string) {
  await restore(await decryptJSON<Snapshot>(env, pass));
}
