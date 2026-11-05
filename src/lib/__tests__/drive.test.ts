import { beforeEach, describe, expect, it } from 'vitest';
import { db, setSetting } from '../../db/db';
import { seedDemo, wipeAll } from '../../db/seed';
import { snapshot } from '../../db/backup';
import { _setFetch, listDriveBackups, uploadDriveBackup } from '../gdrive';
import { backupNow, checkForNewer, restoreFromDrive, useBackup } from '../autoBackup';

/** A small in-memory stand-in for the Google Drive v3 API and the app's token endpoint. */
function fakeDrive() {
  const files = new Map<string, { id: string; name: string; mimeType?: string; parents?: string[]; content?: string; modifiedTime: string; appProperties?: Record<string, string> }>();
  let n = 0;
  let clock = Date.parse('2026-11-01T10:00:00Z');
  const tick = () => new Date((clock += 1000)).toISOString();
  const calls: string[] = [];
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
  const parseMultipart = (body: string) => {
    const boundary = body.split('\r\n')[0];
    const [meta, content] = body.split(boundary).slice(1, 3).map((p) => p.split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n$/, ''));
    return { meta: JSON.parse(meta), content };
  };
  const f = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), 'https://app.test');
    const method = init.method ?? 'GET';
    calls.push(`${method} ${url.pathname}`);
    if (url.pathname === '/api/google/config') return json({ enabled: true, clientId: 'cid' });
    if (url.pathname === '/api/google/refresh') return json({ access_token: 'at', expires_in: 3600 });
    if ((init.headers as Record<string, string>)?.Authorization !== 'Bearer at') return json({ error: 'unauth' }, 401);
    const idMatch = /\/files\/([^/?]+)/.exec(url.pathname);
    const isUpload = url.pathname.startsWith('/upload/');
    if (!isUpload && url.pathname.endsWith('/drive/v3/files') && method === 'GET') {
      const q = url.searchParams.get('q') ?? '';
      let list = [...files.values()];
      const name = /name='([^']+)'/.exec(q)?.[1];
      const parent = /'([^']+)' in parents/.exec(q)?.[1];
      const contains = /name contains '([^']+)'/.exec(q)?.[1];
      if (name) list = list.filter((x) => x.name === name);
      if (parent) list = list.filter((x) => x.parents?.includes(parent));
      if (contains) list = list.filter((x) => x.name.includes(contains));
      list.sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime));
      return json({ files: list.map(({ content: _c, ...rest }) => rest) });
    }
    if (!isUpload && url.pathname.endsWith('/drive/v3/files') && method === 'POST') {
      const meta = JSON.parse(String(init.body));
      const id = `f${++n}`;
      files.set(id, { id, ...meta, modifiedTime: tick() });
      return json({ id });
    }
    if (url.pathname.endsWith('/upload/drive/v3/files') && method === 'POST') {
      const { meta, content } = parseMultipart(String(init.body));
      const id = `f${++n}`;
      files.set(id, { id, ...meta, content, modifiedTime: tick() });
      return json({ id, modifiedTime: files.get(id)!.modifiedTime });
    }
    if (idMatch && url.pathname.includes('/upload/') && method === 'PATCH') {
      const { meta, content } = parseMultipart(String(init.body));
      const cur = files.get(idMatch[1])!;
      files.set(cur.id, { ...cur, ...meta, content, modifiedTime: tick() });
      return json({ id: cur.id });
    }
    if (idMatch && method === 'DELETE') { files.delete(idMatch[1]); return new Response(null, { status: 204 }); }
    if (idMatch && url.searchParams.get('alt') === 'media') return new Response(files.get(idMatch[1])!.content);
    return json({ error: 'unhandled ' + method + ' ' + url.pathname }, 500);
  };
  const safe = async (i: RequestInfo | URL, init?: RequestInit) => { try { return await f(i, init); } catch (e) { console.error('FAKE DRIVE ERROR', String(i), (e as Error).stack); throw e; } };
  return { files, calls, fetch: safe as typeof fetch };
}

describe('Google Drive backup', () => {
  let drive: ReturnType<typeof fakeDrive>;
  beforeEach(async () => {
    drive = fakeDrive();
    _setFetch(drive.fetch);
    await wipeAll();
    localStorage.setItem('tandem-device', 'phone-A');
    await setSetting('gdrive', { refreshToken: 'rt', email: 'me@gmail.com', connectedAt: 1 });
  });

  it('never uploads an empty household (a wiped phone cannot overwrite a good backup)', async () => {
    await backupNow(true);
    expect(drive.files.size).toBe(0);
  });

  it('creates the Tandem backups folder and one file per day, updated in place', async () => {
    await seedDemo('INR');
    await backupNow(true);
    await db.transactions.update((await db.transactions.toCollection().first())!.id, { notes: 'edited' });
    await backupNow();
    const all = [...drive.files.values()];
    expect(all.filter((f) => f.mimeType === 'application/vnd.google-apps.folder').map((f) => f.name)).toEqual(['Tandem backups']);
    const backups = await listDriveBackups();
    expect(backups).toHaveLength(1);
    expect(backups[0].name).toMatch(/^tandem-backup-\d{4}-\d{2}-\d{2}\.json$/);
    expect(backups[0].appProperties).toMatchObject({ tandem: '1', device: 'phone-A' });
    expect(useBackup.getState().drive).toMatchObject({ status: 'ok', email: 'me@gmail.com' });
    // the backup holds the data but never the Google token
    const content = [...drive.files.values()].find((f) => f.content)!.content!;
    expect(content).toContain('edited');
    expect(content).not.toContain('"refreshToken"');
  });

  it('skips the upload when nothing changed', async () => {
    await seedDemo('USD');
    await backupNow(true);
    const before = drive.calls.filter((c) => c.includes('/upload/')).length;
    await backupNow();
    expect(drive.calls.filter((c) => c.includes('/upload/')).length).toBe(before);
  });

  it('keeps 30 days of history and removes older copies', async () => {
    await seedDemo('USD');
    const json = JSON.stringify(await snapshot());
    for (let d = 1; d <= 33; d++) await uploadDriveBackup(json, { device: 'phone-A', updatedAt: d, transactions: 1 }, new Date(Date.UTC(2026, 9, d)));
    const names = (await listDriveBackups()).map((f) => f.name);
    expect(names).toHaveLength(30);
    expect(names).not.toContain('tandem-backup-2026-10-01.json');
  });

  it('restores a wiped phone from Drive, and spots newer data from another device', async () => {
    await seedDemo('INR');
    await backupNow(true);
    const count = await db.transactions.count();
    await wipeAll();
    await setSetting('gdrive', { refreshToken: 'rt', email: 'me@gmail.com', connectedAt: 1 });
    await restoreFromDrive();
    expect(await db.transactions.count()).toBe(count);
    expect((await db.settings.get('gdrive'))?.value).toMatchObject({ refreshToken: 'rt' }); // still connected after restore

    // another device uploads later → this device is offered an update
    const other = JSON.stringify({ ...(await snapshot()), device: 'laptop-B' });
    await uploadDriveBackup(other, { device: 'laptop-B', updatedAt: Date.now() + 60_000, transactions: count }, new Date(Date.now() + 86400_000));
    const newer = await checkForNewer();
    expect(newer).toBeDefined();
    expect(useBackup.getState().newer?.id).toBe(newer!.id);
    await restoreFromDrive(newer!.id);
    expect(useBackup.getState().newer).toBeUndefined();
  });
});
