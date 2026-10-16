import { ArrowUp, Eye, MessageCircleQuestion, Square } from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useData, useProfile } from '../db/hooks';
import { buildSummary } from '../lib/moneySummary';
import { Panel, Sheet } from './ui';

type SampleFn = ((input: string | { role: 'user' | 'assistant'; content: string }[], opts?: Record<string, unknown>) => Promise<{ text: string; truncated: boolean }>);
type Host = { use?: (name: string) => Promise<unknown> };

const STARTERS = [
  'Where could we realistically save 10% next month?',
  'Are we on track for our goals? What should we change?',
  'Which subscriptions or bills look worth reviewing?',
  'Should we prepay the loan or build the emergency fund first?',
];

/** Renders plain-text answers with paragraphs, bullet lists and **bold** — never raw HTML. */
function Rich({ text }: { text: string }) {
  const bold = (s: string) => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith('**') && p.endsWith('**') ? <b key={i}>{p.slice(2, -2)}</b> : <Fragment key={i}>{p}</Fragment>));
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => { if (list.length) { blocks.push(<ul key={blocks.length} className="list-disc pl-5 space-y-1">{list.map((l, i) => <li key={i}>{bold(l)}</li>)}</ul>); list = []; } };
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const item = /^([-*•]|\d+[.)])\s+(.*)/.exec(line);
    if (item) { list.push(item[2]); continue; }
    flush();
    if (!line) continue;
    const h = /^#{1,4}\s+(.*)/.exec(line);
    blocks.push(h ? <p key={blocks.length} className="font-bold">{bold(h[1])}</p> : <p key={blocks.length}>{bold(line)}</p>);
  }
  flush();
  return <div className="space-y-2.5 text-[15px] leading-relaxed">{blocks}</div>;
}

const ERRORS: Record<string, string> = {
  not_granted: 'Asking needs your permission. Allow it from the page’s permissions menu to use this.',
  sampling_disabled: 'Asking Claude is turned off for this account.',
  rate_limited: 'You’ve asked a lot just now. Wait a minute and try again.',
  session_expired: 'Your session expired. Reload the page and try again.',
  refused: 'Claude couldn’t answer that one. Try asking it differently.',
  prompt_too_large: 'Your household summary is too large to send. Ask about a single area instead.',
};

/**
 * "Ask about my money": a conversation with Claude grounded in an aggregated summary of the
 * household. Available in the shared build, where the viewer's own Claude account answers.
 */
export function AskMoney() {
  const data = useData();
  const profile = useProfile();
  const [sample, setSample] = useState<SampleFn | null | undefined>(undefined);
  const [q, setQ] = useState('');
  const [chat, setChat] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [peek, setPeek] = useState(false);
  const ctl = useRef<AbortController | null>(null);
  const summary = useMemo(() => (data && profile ? buildSummary(data, profile.currency) : null), [data, profile]);

  useEffect(() => {
    if (import.meta.env.VITE_EMBED !== '1') { setSample(null); return; }
    const host = (window as unknown as { claude?: Host }).claude;
    Promise.resolve(host?.use?.('sample')).then((s) => setSample(() => (s as SampleFn) ?? null)) // wrap: a bare function would be treated as a state updater.catch(() => setSample(null));
  }, []);

  if (sample === null || !summary) return null;

  const ask = async (question: string) => {
    if (!question.trim() || busy || !sample) return;
    const history = [...chat, { role: 'user' as const, content: question.trim() }];
    setChat([...history, { role: 'assistant', content: '' }]);
    setQ(''); setErr(''); setBusy(true);
    ctl.current = new AbortController();
    const brief = `You are a calm, practical money coach for one household. Use ONLY the JSON summary below (amounts in ${summary.currency}). ` +
      'Be specific with numbers from the data, suggest 2–4 concrete actions, keep it under 200 words, use short paragraphs or bullets, and be encouraging, never judgmental. ' +
      'If the data cannot answer, say what is missing. End with one line: "Not professional financial advice."\n\nHousehold summary:\n' + JSON.stringify(summary);
    const input = history.map((m, i) => (i === 0 ? { role: m.role, content: `${brief}\n\nQuestion: ${m.content}` } : m));
    try {
      await sample(input, {
        cache: false, signal: ctl.current.signal, modelTier: 'default',
        onText: ({ text }: { text: string }) => setChat((c) => [...c.slice(0, -1), { role: 'assistant', content: text }]),
      });
    } catch (e) {
      const { code, text } = (e ?? {}) as { code?: string; text?: string };
      setChat((c) => (text ? [...c.slice(0, -1), { role: 'assistant', content: text }] : c.slice(0, -1)));
      if (code !== 'cancelled') setErr(ERRORS[code ?? ''] ?? 'Couldn’t get an answer right now. Try again in a moment.');
    } finally { setBusy(false); }
  };

  return (
    <Panel title={<span className="flex items-center gap-2"><MessageCircleQuestion size={18} className="text-primary" /> Ask about your money</span>}
      action={<button className="btn-ghost h-9 text-sm text-muted" onClick={() => setPeek(true)}><Eye size={15} /> See what’s sent</button>}>
      {chat.length === 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {STARTERS.map((s) => <button key={s} className="chip h-auto py-1.5 text-left" onClick={() => ask(s)} disabled={sample === undefined}>{s}</button>)}
        </div>
      )}
      {chat.length > 0 && (
        <div className="space-y-4 mb-4 max-h-[60vh] overflow-y-auto pr-1" aria-live="polite">
          {chat.map((m, i) => m.role === 'user'
            ? <p key={i} className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-primary text-onprimary px-4 py-2.5 text-[15px]">{m.content}</p>
            : <div key={i} className="max-w-[95%] rounded-2xl rounded-bl-md bg-sunk px-4 py-3">{m.content ? <Rich text={m.content} /> : <span className="text-muted text-sm">Thinking…</span>}</div>)}
        </div>
      )}
      {err && <p className="text-sm text-bad mb-3" role="alert">{err}</p>}
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); ask(q); }}>
        <label htmlFor="ask-q" className="sr-only">Your question</label>
        <input id="ask-q" className="field" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask anything about your spending, budgets or goals" maxLength={400} />
        {busy
          ? <button type="button" className="btn-soft w-11 p-0 shrink-0" aria-label="Stop" onClick={() => ctl.current?.abort()}><Square size={16} /></button>
          : <button type="submit" className="btn-primary w-11 p-0 shrink-0" aria-label="Ask" disabled={!q.trim() || sample === undefined}><ArrowUp size={18} /></button>}
      </form>
      <p className="text-xs text-muted mt-2">Answers come from Claude using your own account. Only totals are sent: no shop names, notes or people’s names.</p>
      <Sheet open={peek} onOpenChange={setPeek} title="What gets sent" description="This summary is all Claude sees. It’s rebuilt from your data each time you ask." wide>
        <pre className="text-xs bg-sunk rounded-xl p-3 overflow-auto max-h-[60vh] whitespace-pre-wrap">{JSON.stringify(summary, null, 2)}</pre>
      </Sheet>
    </Panel>
  );
}
