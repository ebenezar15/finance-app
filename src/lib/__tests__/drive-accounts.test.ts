import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../db/db';
import { seedDemo, wipeAll } from '../../db/seed';
import { _setFetch, connectDrive, getLink, listDriveBackups, switchDriveAccount, disconnectDrive } from '../gdrive';
import { backupNow } from '../autoBackup';

/**
 * Two people, two Google accounts. Each account's sign-in yields its own tokens, and the fake
 * Drive keeps a separate file store per account (as Google does), so we can check that every
 * backup lands only in the signed-in person's own Drive.
 */
function googleWithAccounts() {
  const drives: Record<string, { name: string; content?: string; parents?: string[]; id: string; mimeType?: string; modifiedTime: string }[]> = { 'asha@gmail.com': [], 'ravi@gmail.com': [] };
  let chooserShown: string[] = [];
  let next = 'asha@gmail.com';
  const revoked: string[] = [];
  let n = 0;
  const who = (auth?: string) => auth?.replace('Bearer at-', '') ?? '';
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
  (window as unknown as { google: unknown }).google = {
    accounts: { oauth2: { initCodeClient: (o: { prompt?: string; callback: (r: { code: string }) => void }) => ({ requestCode: () => { chooserShown.push(o.prompt ?? ''); setTimeout(() => o.callback({ code: `code-${next}` }), 0); } }) } },
  };
  const f = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), 'https://app.test');
    if (url.pathname === '/api/google/config') return json({ enabled: true, clientId: 'cid' });
    if (url.pathname === '/api/google/token') {
      const email = String(JSON.parse(String(init.body)).code).replace('code-', '');
      const idToken = `h.${btoa(JSON.stringify({ email }))}.s`;
      return json({ access_token: `at-${email}`, refresh_token: `rt-${email}`, expires_in: 3600, id_token: idToken });
    }
    if (url.pathname === '/api/google/refresh') return json({ access_token: `at-${String(JSON.parse(String(init.body)).refresh_token).replace('rt-', '')}`, expires_in: 3600 });
    if (url.hostname === 'oauth2.googleapis.com' && url.pathname === '/revoke') { revoked.push(url.searchParams.get('token')!); return json({}); }
    const account = who((init.headers as Record<string, string>)?.Authorization);
    const store = drives[account];
    if (!store) return json({ error: 'unauthenticated' }, 401);
    const method = init.method ?? 'GET';
    if (url.pathname.endsWith('/drive/v3/files') && !url.pathname.startsWith('/upload') && method === 'GET') {
      const q = url.searchParams.get('q') ?? '';
      const name = /name='([^']+)'/.exec(q)?.[1]; const parent = /'([^']+)' in parents/.exec(q)?.[1];
      return json({ files: store.filter((x) => (!name || x.name === name) && (!parent || x.parents?.includes(parent))) });
    }
    if (url.pathname.endsWith('/drive/v3/files') && !url.pathname.startsWith('/upload') && method === 'POST') {
      const meta = JSON.parse(String(init.body)); const id = `${account}-f${++n}`; store.push({ id, ...meta, modifiedTime: new Date().toISOString() }); return json({ id });
    }
    if (url.pathname.startsWith('/upload') && method === 'POST') {
      const body = String(init.body); const b = body.split('\r\n')[0];
      const [meta, content] = body.split(b).slice(1, 3).map((p) => p.split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n$/, ''));
      const id = `${account}-f${++n}`; store.push({ id, ...JSON.parse(meta), content, modifiedTime: new Date().toISOString() }); return json({ id });
    }
    return json({ error: 'unhandled' }, 500);
  };
  return { drives, revoked, chooser: () => chooserShown, pick: (email: string) => { next = email; }, reset: () => { chooserShown = []; }, fetch: f as typeof fetch };
}

describe('each person signs in with their own Google account', () => {
  let g: ReturnType<typeof googleWithAccounts>;
  beforeEach(async () => {
    g = googleWithAccounts();
    _setFetch(g.fetch);
    await wipeAll();
    await seedDemo('INR');
  });

  it('always shows Google’s account chooser and backs up only to the chosen account', async () => {
    g.pick('asha@gmail.com');
    expect(await connectDrive()).toBe('asha@gmail.com');
    expect(g.chooser()[0]).toContain('select_account');
    await backupNow(true);
    expect(g.drives['asha@gmail.com'].some((f) => f.name.startsWith('tandem-backup-'))).toBe(true);
    expect(g.drives['ravi@gmail.com']).toHaveLength(0);
  });

  it('switching accounts revokes the old one and sends new backups to the new Drive only', async () => {
    g.pick('asha@gmail.com');
    await connectDrive();
    await backupNow(true);
    const ashaFiles = g.drives['asha@gmail.com'].length;
    g.pick('ravi@gmail.com');
    await db.transactions.update((await db.transactions.toCollection().first())!.id, { notes: 'changed after switching' });
    expect(await switchDriveAccount()).toBe('ravi@gmail.com');
    expect(g.revoked).toEqual(['rt-asha@gmail.com']);
    expect((await getLink())?.email).toBe('ravi@gmail.com');
    await backupNow(true);
    expect((await listDriveBackups()).length).toBe(1); // Ravi's Drive now has its own backup
    expect(g.drives['ravi@gmail.com'].some((f) => f.content?.includes('changed after switching'))).toBe(true);
    expect(g.drives['asha@gmail.com'].length).toBe(ashaFiles); // nothing new went to Asha's Drive
  });

  it('signing out forgets the account on this phone and revokes it with Google', async () => {
    g.pick('ravi@gmail.com');
    await connectDrive();
    await disconnectDrive();
    expect(await getLink()).toBeNull();
    expect(g.revoked).toEqual(['rt-ravi@gmail.com']);
  });
});
