/**
 * Backups stored as files on the phone, outside the browser's own storage, so they survive the
 * browser clearing site data.
 *
 * Where the browser supports choosing a folder (Chrome on Android and desktop), Tandem writes a
 * dated file there automatically. Everywhere else, the person saves a copy (download / share)
 * and can pick it later. Either way, a fresh install can find the newest backup and restore it.
 */
import { asSnapshot, type Snapshot } from '../db/backup';
import { db } from '../db/db';
import type { Envelope } from './crypto';

const NAME = /^tandem(-backup)?-.*\.(json|tandem)$/i;
const KEEP = 14;

type DirHandle = FileSystemDirectoryHandle & {
  queryPermission?(o: { mode: 'readwrite' | 'read' }): Promise<PermissionState>;
  requestPermission?(o: { mode: 'readwrite' | 'read' }): Promise<PermissionState>;
  values(): AsyncIterable<FileSystemHandle>;
};
type Picker = (o?: { id?: string; mode?: 'read' | 'readwrite'; startIn?: string }) => Promise<DirHandle>;

export const folderSupported = () => typeof window !== 'undefined' && typeof (window as unknown as { showDirectoryPicker?: Picker }).showDirectoryPicker === 'function';

export async function getFolder(): Promise<{ handle: DirHandle; name: string } | null> {
  return ((await db.settings.get('backupFolder'))?.value as { handle: DirHandle; name: string } | undefined) ?? null;
}

/** Asks the person to choose (or create) a folder for automatic backups. */
export async function chooseFolder() {
  const pick = (window as unknown as { showDirectoryPicker: Picker }).showDirectoryPicker;
  const handle = await pick({ id: 'tandem-backups', mode: 'readwrite', startIn: 'documents' });
  await db.settings.put({ key: 'backupFolder', value: { handle, name: handle.name } });
  return handle.name;
}

export async function forgetFolder() { await db.settings.delete('backupFolder'); }

/** 'granted' when Tandem can write without asking; 'prompt' needs a tap (browsers require one). */
export async function folderPermission(handle: DirHandle, ask = false): Promise<PermissionState> {
  try {
    const q = (await handle.queryPermission?.({ mode: 'readwrite' })) ?? 'granted';
    if (q === 'granted' || !ask) return q;
    return (await handle.requestPermission?.({ mode: 'readwrite' })) ?? 'denied';
  } catch { return 'denied'; }
}

export interface FoundBackup { name: string; modified: number; file: File }

export async function scanFolder(handle: DirHandle): Promise<FoundBackup[]> {
  const out: FoundBackup[] = [];
  for await (const entry of handle.values()) {
    if (entry.kind !== 'file' || !NAME.test(entry.name)) continue;
    const file = await (entry as FileSystemFileHandle).getFile();
    out.push({ name: entry.name, modified: file.lastModified, file });
  }
  return out.sort((a, b) => b.modified - a.modified);
}

/** Writes today's file into the chosen folder and keeps the newest 14. */
export async function writeToFolder(handle: DirHandle, json: string, today = new Date()) {
  const name = `tandem-backup-${today.toISOString().slice(0, 10)}.json`;
  const fh = await handle.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(json);
  await w.close();
  const all = (await scanFolder(handle)).filter((f) => /^tandem-backup-\d{4}-\d{2}-\d{2}\.json$/.test(f.name));
  for (const f of all.slice(KEEP)) await handle.removeEntry(f.name).catch(() => {});
  return name;
}

/** Lets the person point at a folder (e.g. Downloads) and finds the newest Tandem backup in it. */
export async function findNewestInFolder(): Promise<FoundBackup | null> {
  const pick = (window as unknown as { showDirectoryPicker: Picker }).showDirectoryPicker;
  const handle = await pick({ id: 'tandem-backups', mode: 'read', startIn: 'downloads' });
  return (await scanFolder(handle))[0] ?? null;
}

export type ReadBackup =
  | { kind: 'plain'; snap: Snapshot }
  | { kind: 'encrypted'; envelope: Envelope };

/** Recognises a backup file: plain Tandem backups and password-protected .tandem files. */
export async function readBackupFile(file: Blob): Promise<ReadBackup> {
  let value: unknown;
  try { value = JSON.parse(await file.text()); } catch { throw new Error('This file is not a Tandem backup.'); }
  if ((value as Envelope)?.format === 'tandem-backup') return { kind: 'encrypted', envelope: value as Envelope };
  return { kind: 'plain', snap: asSnapshot(value) };
}

export function describeSnapshot(s: Snapshot) {
  const tx = (s.tables.transactions as { deletedAt?: number }[] | undefined)?.filter((t) => !t.deletedAt).length ?? s.counts?.transactions ?? 0;
  const accounts = (s.tables.accounts as unknown[] | undefined)?.length ?? 0;
  return { when: new Date(s.exportedAt), entries: tx, accounts };
}
