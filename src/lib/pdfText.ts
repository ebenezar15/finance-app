/**
 * Reads the entries table out of a CashBook PDF report, producing the same string[][] grid the
 * Excel/CSV path does, so detectTable → parseCashbook work unchanged.
 *
 * A PDF has no table structure, only text drawn at coordinates. We take pdf.js's text items,
 * group them into visual lines, find the header line (Date, Cash In, Cash Out, Balance…) and use
 * the header cells' positions as column boundaries for every line below it.
 *
 * pdf.js is large (~0.4 MB + 1.4 MB worker), so it's loaded with a dynamic import only when a PDF
 * is chosen. The legacy build is used everywhere: it runs on older Android WebViews and in Node
 * (tests), so the app and the tests share one code path.
 */
import { detectTable, type CbColumns } from './cashbook';

export interface PdfItem {
  page: number;
  /** Left edge, in PDF points. */
  x: number;
  /** Baseline, top-down, with earlier pages' heights added so lines stay in reading order. */
  y: number;
  width: number;
  /** Font size; used for the line tolerance. */
  height?: number;
  str: string;
}

type Pdfjs = Pick<typeof import('pdfjs-dist'), 'getDocument'>;

const NO_TEXT = 'This PDF is a scanned image, so its text can’t be read. In CashBook, download the report as Excel instead.';
const NO_TABLE = 'Couldn’t find the entries table in this PDF. It should have a Date column and Cash In / Cash Out (or Amount) columns. In CashBook, you can also download the report as Excel.';

let loading: Promise<Pdfjs> | undefined;

/**
 * Loads pdf.js on first use. The PWA build runs it in a module worker (emitted as an .mjs asset
 * and precached). The single-file embed build can't ship a separate worker file, so there the
 * worker code is imported onto the main thread, which pdf.js picks up as its "fake worker".
 */
function loadPdfjs(): Promise<Pdfjs> {
  return (loading ??= (async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    if (import.meta.env.VITE_EMBED) {
      // @ts-ignore -- the worker bundle has no type declarations; it registers globalThis.pdfjsWorker.
      await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs');
    } else {
      pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
    }
    return pdfjs;
  })().catch((e) => { loading = undefined; throw e; }));
}

/** Every non-blank text item on every page, top-down. */
export async function extractPdfItems(data: ArrayBuffer | Uint8Array, pdfjs?: Pdfjs): Promise<PdfItem[]> {
  const lib = pdfjs ?? (await loadPdfjs());
  const doc = await lib.getDocument({ data: data instanceof Uint8Array ? data : new Uint8Array(data), isEvalSupported: false, verbosity: 0 }).promise;
  const items: PdfItem[] = [];
  try {
    let offset = 0;
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const vp = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      for (const it of content.items) {
        if (!('str' in it) || !it.str.trim()) continue;
        const [x, y] = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
        const size = Math.hypot(it.transform[2], it.transform[3]) || it.height;
        items.push({ page: p, x, y: y + offset, width: it.width, height: size, str: it.str });
      }
      offset += vp.height + 20;
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }
  return items;
}

// ---- Grid building (pure) ----

interface Phrase { page: number; x0: number; x1: number; y: number; text: string; parts: PdfItem[] }
interface Line { page: number; y: number; phrases: Phrase[] }

const DATE_RE = /\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{1,2}[\s-]+[a-z]{3,9}[\s,-]+\d{2,4}|[a-z]{3,9}\s+\d{1,2},?\s+\d{4}/i;
const TIME_ONLY = /^\d{1,2}:\d{2}(?::\d{2})?\s*(?:[ap]\.?\s?m\.?)?$/i;
const AMOUNT = /^[-–(]?\s*(?:₹|rs\.?|inr)?\s*[-–(]?\s*\d[\d,]*(?:\.\d+)?\s*\)?\s*(?:cr|dr)?$/i;
/** Page furniture repeated on every page; never part of the table. */
const NOISE = /^page \d+(?:\s*(?:of|\/)\s*\d+)?$|\bpage \d+ of \d+\b|^(?:report )?generated (?:on|by|at|from)\b|^(?:downloaded|printed) (?:on|from)\b|cashbook\.in|^powered by\b|^(?:made|created) (?:with|using|by) cashbook|^download (?:the )?cashbook/i;

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : 0; };
const lineText = (l: Line) => l.phrases.map((p) => p.text).join(' ');

/** Visual lines: items whose baselines are within ~40% of the font size, sorted left to right. */
function toLines(items: PdfItem[], h: number): Line[] {
  const sorted = items.filter((i) => i.str.trim()).sort((a, b) => a.y - b.y || a.x - b.x);
  const groups: { page: number; y: number; items: PdfItem[] }[] = [];
  for (const it of sorted) {
    const g = groups[groups.length - 1];
    if (g && g.page === it.page && Math.abs(it.y - g.y) <= h * 0.4) g.items.push(it);
    else groups.push({ page: it.page, y: it.y, items: [it] });
  }
  return groups.map((g) => {
    const row = g.items.sort((a, b) => a.x - b.x);
    // Neighbouring items closer than about a space apart belong to one phrase ("Cash" + "In").
    const phrases: Phrase[] = [];
    for (const it of row) {
      const last = phrases[phrases.length - 1];
      const end = it.x + it.width;
      if (last && it.x - last.x1 < h * 0.5) {
        last.text += (it.x - last.x1 > h * 0.1 && !/\s$/.test(last.text) && !/^\s/.test(it.str) ? ' ' : '') + it.str;
        last.x1 = Math.max(last.x1, end);
        last.parts.push(it);
      } else phrases.push({ page: it.page, x0: it.x, x1: end, y: it.y, text: it.str, parts: [it] });
    }
    for (const p of phrases) p.text = p.text.replace(/\s+/g, ' ').trim();
    return { page: g.page, y: g.y, phrases };
  });
}

/** A line that on its own reads as a table header (a Date column plus a money column). */
const isHeader = (l: Line) => detectTable([l.phrases.map((p) => p.text)]);

/**
 * Turns positioned text into a table grid. Lines above the header (book name, period, totals)
 * are kept as rows so detectTable still finds the book name; page numbers and app branding are
 * dropped; repeated headers are skipped; lines with no date and no amount are wrapped text and
 * are merged into the row they belong to.
 */
export function itemsToGrid(items: PdfItem[]): string[][] {
  const h = median(items.map((i) => i.height ?? 0).filter((x) => x > 0)) || 10;
  const lines = toLines(items, h).filter((l) => !NOISE.test(lineText(l).trim()));

  const hi = lines.findIndex((l) => isHeader(l));
  if (hi < 0) return [];
  const header = lines[hi];
  const cols: CbColumns = isHeader(header)!.cols;
  const heads = header.phrases;
  const n = heads.length;
  // Column i spans from the midpoint with the previous header's centre to the midpoint with the next.
  const centres = heads.map((p) => (p.x0 + p.x1) / 2);
  const bounds = centres.slice(1).map((c, i) => (centres[i] + c) / 2);
  const colOf = (x: number) => { let i = 0; while (i < bounds.length && x >= bounds[i]) i++; return i; };
  const toCells = (l: Line) => {
    const cells: string[][] = Array.from({ length: n }, () => []);
    for (const p of l.phrases) {
      const c = colOf((p.x0 + p.x1) / 2);
      // A phrase that crosses a column boundary is two cells that happened to sit close together.
      if (p.parts.length > 1 && colOf(p.x0) !== colOf(p.x1)) {
        for (const it of p.parts) cells[colOf(it.x + it.width / 2)].push(it.str.trim());
      } else cells[c].push(p.text);
    }
    return cells.map((c) => c.filter(Boolean).join(' '));
  };

  let above = lines.slice(0, hi).map((l) => l.phrases.map((p) => p.text));
  // The app's own logo text isn't the book's name (unless it's the only title there is).
  const brand = (r: string[]) => /^cash ?book(?: app)?$/i.test(r.join(' ').trim());
  if (above.some((r) => !brand(r))) above = above.filter((r) => !brand(r));
  // "Book: Household Expenses" → put the bare name first, where detectTable looks for it.
  const named = above.findIndex((r) => /^book(?: name)?\s*[:–-]\s*\S/i.test(r.join(' ')));
  if (named > 0) above.unshift(above.splice(named, 1)[0]);
  if (named >= 0) above[0] = [above[0].join(' ').replace(/^book(?: name)?\s*[:–-]\s*/i, '')];

  // On later pages, anything above the repeated header is that page's title block.
  const repeatAt = new Map<number, number>();
  lines.forEach((l, i) => { if (i > hi && l.page !== header.page && !repeatAt.has(l.page) && isHeader(l)) repeatAt.set(l.page, i); });

  const money = [cols.cashIn, cols.cashOut, cols.amount, cols.balance].filter((c): c is number => c !== undefined);
  type Row = { cells: string[]; page: number; y: number };
  const rows: Row[] = [];
  const pending: { cells: string[]; line: Line; prev?: Row; timeOnly: boolean }[] = [];
  lines.slice(hi + 1).forEach((l, k) => {
    const i = hi + 1 + k;
    const rep = repeatAt.get(l.page);
    if (rep !== undefined && i <= rep) return;
    if (isHeader(l)) return;
    const cells = toCells(l);
    const dateCell = cols.date !== undefined ? cells[cols.date] : '';
    const anchored = DATE_RE.test(dateCell) || money.some((c) => AMOUNT.test(cells[c]));
    if (anchored) { rows.push({ cells, page: l.page, y: l.y }); return; }
    const others = cells.filter((c, ci) => c && ci !== cols.date);
    pending.push({ cells, line: l, prev: rows[rows.length - 1], timeOnly: TIME_ONLY.test(dateCell) && !others.length });
  });

  // Wrapped lines join the nearest row on the same page (rows are often vertically centred, so
  // part of a long remark can sit above its date). A time on its own goes with the date above it.
  for (const p of pending) {
    const next: Row | undefined = rows[p.prev ? rows.indexOf(p.prev) + 1 : 0];
    const near = (r?: Row) => (r && r.page === p.line.page && Math.abs(r.y - p.line.y) <= h * 2.6 ? Math.abs(r.y - p.line.y) : Infinity);
    const dPrev = near(p.prev), dNext = p.timeOnly ? Infinity : near(next);
    const target = dPrev === Infinity && dNext === Infinity ? undefined : dPrev <= dNext ? p.prev : next;
    if (!target) continue;
    const before = target === next;
    p.cells.forEach((c, ci) => {
      if (!c) return;
      const cur = target.cells[ci];
      target.cells[ci] = !cur ? c : before ? `${c} ${cur}` : `${cur} ${c}`;
    });
  }

  const pad = (r: string[]) => (r.length >= n ? r : [...r, ...Array(n - r.length).fill('')]);
  return [...above.map(pad), heads.map((p) => p.text), ...rows.map((r) => r.cells)];
}

/** Reads a CashBook PDF report into a grid for detectTable/parseCashbook. */
export async function readCashbookPdf(file: Blob, pdfjs?: Pdfjs): Promise<string[][]> {
  let items: PdfItem[];
  try {
    items = await extractPdfItems(await file.arrayBuffer(), pdfjs);
  } catch (e) {
    if (e instanceof Error && /password/i.test(e.name + e.message)) throw new Error('This PDF is password-protected. Remove the password, or download the report from CashBook as Excel.');
    throw new Error('This PDF couldn’t be opened. In CashBook, download the report again, or as Excel.');
  }
  if (!items.length) throw new Error(NO_TEXT);
  const grid = itemsToGrid(items);
  if (!grid.length) throw new Error(NO_TABLE);
  return grid;
}
