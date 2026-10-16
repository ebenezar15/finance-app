/** RFC-4180-ish CSV parser (quotes, escaped quotes, CRLF). */
export function parseCSV(text: string, delimiter?: string): string[][] {
  const d = delimiter ?? (text.split('\n')[0].split(';').length > text.split('\n')[0].split(',').length ? ';' : ',');
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === d) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

export function toCSV(rows: (string | number)[][]) {
  return rows.map((r) => r.map((c) => {
    const s = String(c ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\n');
}

export interface ColumnMap { date: number; description: number; amount?: number; debit?: number; credit?: number }

/** Guess which columns hold date / description / amount from header names. */
export function guessColumns(header: string[]): ColumnMap {
  const h = header.map((x) => x.toLowerCase().trim());
  const find = (...keys: string[]) => h.findIndex((x) => keys.some((k) => x.includes(k)));
  const debit = find('debit', 'withdrawal', 'paid out', 'money out');
  const credit = find('credit', 'deposit', 'paid in', 'money in');
  const amount = find('amount', 'value');
  return {
    date: Math.max(0, find('date', 'posted')),
    description: Math.max(0, find('description', 'narration', 'details', 'memo', 'payee', 'particulars')),
    amount: amount >= 0 ? amount : undefined,
    debit: debit >= 0 ? debit : undefined,
    credit: credit >= 0 ? credit : undefined,
  };
}

/** Accepts 2026-03-04, 04/03/2026 (day-first by default), 4 Mar 2026, Mar 4, 2026. */
export function parseDate(s: string, dayFirst = true): string | null {
  const t = s.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(t);
  if (m) {
    const [a, b] = dayFirst ? [m[1], m[2]] : [m[2], m[1]];
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${b.padStart(2, '0')}-${a.padStart(2, '0')}`;
  }
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** Minimal OFX/QFX reader: pulls STMTTRN blocks (works for SGML and XML flavours). */
export function parseOFX(text: string) {
  const out: { date: string; amount: number; name: string; fitid?: string }[] = [];
  const blocks = text.split(/<STMTTRN>/i).slice(1);
  for (const b of blocks) {
    const tag = (n: string) => new RegExp(`<${n}>([^<\\r\\n]+)`, 'i').exec(b)?.[1]?.trim();
    const dt = tag('DTPOSTED');
    const amt = tag('TRNAMT');
    if (!dt || !amt) continue;
    out.push({
      date: `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)}`,
      amount: Math.round(parseFloat(amt) * 100),
      name: tag('NAME') ?? tag('MEMO') ?? 'Imported',
      fitid: tag('FITID'),
    });
  }
  return out;
}
