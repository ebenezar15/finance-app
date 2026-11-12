/**
 * Automatic payment capture, client side.
 *
 * Three ways a payment message reaches Tandem without typing:
 *   1. The phone's automation app (MacroDroid, Tasker, iOS Shortcuts) posts each payment
 *      notification / bank SMS to the account's private capture link; Tandem collects them
 *      here whenever it's open.
 *   2. "Share" from any app to Tandem (installed app on Android).
 *   3. A link that carries the text: /?capture=<text>.
 */
import { create } from 'zustand';
import { db, getSetting, setSetting } from '../db/db';
import { captureDisable, captureEnable, capturePull, getAccount } from './account';
import { capturePayments, captureSummary, type CaptureResult, type CaptureSource } from './capture';
import { formatMoney } from './money';

export const CAPTURE_SETTING = 'captureLink';
export interface CaptureLink { link: string; createdAt: number }
export const TEST_MARK = 'TANDEM-TEST';

interface State { busy: boolean; lastChecked?: number; lastResult?: string; testSeenAt?: number }
export const useCapture = create<State>(() => ({ busy: false }));

export const captureUrl = (link: string) => `${location.origin}/api/capture?k=${link}`;

async function fmt() {
  const cur = ((await db.settings.get('profile'))?.value as { currency?: string } | undefined)?.currency ?? 'USD';
  return (m: number) => formatMoney(m, cur);
}
const toast = async (t: string) => (await import('../store/ui')).useUI.getState().toast(t);

export async function turnOnCapture(): Promise<CaptureLink> {
  const v = { link: await captureEnable(), createdAt: Date.now() };
  await setSetting(CAPTURE_SETTING, v);
  return v;
}
export async function turnOffCapture() {
  await captureDisable().catch(() => {});
  await db.settings.delete(CAPTURE_SETTING);
}

let running: Promise<CaptureResult[]> | null = null;

/** Collects forwarded messages from the account and records them. Quiet when there's nothing new. */
export function collectCaptured(): Promise<CaptureResult[]> {
  if (running) return running;
  running = (async () => {
    const out: CaptureResult[] = [];
    if (!(await getSetting<CaptureLink | null>(CAPTURE_SETTING, null)) || !(await getAccount())) return out;
    useCapture.setState({ busy: true });
    try {
      let ack: string[] = [];
      for (let round = 0; round < 4; round++) {
        const r = await capturePull(ack);
        if (!r.enabled) { await db.settings.delete(CAPTURE_SETTING); break; } // turned off on another device
        if (!r.items.length) break;
        ack = [];
        for (const m of r.items) {
          if (m.text.startsWith(TEST_MARK)) useCapture.setState({ testSeenAt: Date.now() });
          else if (m.text) out.push(...(await capturePayments(m.text, { source: 'sms', receivedAt: m.at })));
          ack.push(m.id);
        }
      }
      if (ack.length) await capturePull(ack).catch(() => {});
      const worth = out.filter((x) => x.status === 'added' || x.status === 'review');
      const summary = worth.length ? captureSummary(out.filter((x) => x.status !== 'ignored'), await fmt()) : undefined;
      useCapture.setState({ lastChecked: Date.now(), ...(summary ? { lastResult: summary } : {}) });
      if (summary) await toast(summary);
    } catch { /* offline or signed out: try again next time */ } finally { useCapture.setState({ busy: false }); }
    return out;
  })().finally(() => { running = null; });
  return running;
}

let started = false;
/** Checks for forwarded payments when the app opens, when it comes back to the front, and every minute while open. */
export function startAutoCapture() {
  if (started || import.meta.env.VITE_EMBED === '1') return;
  started = true;
  const check = () => { if (!document.hidden) collectCaptured(); };
  check();
  document.addEventListener('visibilitychange', check);
  window.addEventListener('online', check);
  window.setInterval(check, 60_000);
}

/** Text shared into Tandem or carried on a link. Always tells the person what happened. */
export async function captureIncoming(text: string, source: CaptureSource = 'share') {
  const clean = text.trim();
  if (!clean) return;
  const results = await capturePayments(clean, { source });
  await toast(captureSummary(results, await fmt()));
  return results;
}

/** Sends a harmless test message to the person's own link, to prove the round trip works. */
export async function sendCaptureTest(link: string) {
  const r = await fetch(captureUrl(link), { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: `${TEST_MARK} You paid 1.00 to Test` });
  if (!r.ok) throw new Error(r.status === 404 ? 'This link is no longer active. Get a new link.' : 'The test couldn’t be sent. Try again in a moment.');
  await collectCaptured();
  return !!useCapture.getState().testSeenAt && Date.now() - useCapture.getState().testSeenAt! < 30_000;
}
