// @vitest-environment node
import { PDFDocument, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { detectTable, openingBalance, parseCashbook, totals } from '../cashbook';
import { readCashbookPdf } from '../pdfText';

const pdfBlob = (b: Uint8Array) => new Blob([b as BlobPart], { type: 'application/pdf' });
type Cell = { text: string; right?: boolean };
interface Entry { date: string; time: string; remark: string[]; category: string; mode: string; cashIn: string; cashOut: string; balance: string }

// Newest first, as CashBook prints them. Opening balance 5,000 → final 53,930.
const ENTRIES: Entry[] = [
  { date: '15 Mar 2026', time: '07:45 PM', remark: ['Vegetables & fruits'], category: 'Groceries', mode: 'Cash', cashIn: '', cashOut: '320', balance: '53,930' },
  { date: '12 Mar 2026', time: '06:15 PM', remark: ['Birthday gift for Anu', 'from grandparents'], category: 'Gifts', mode: 'Cash', cashIn: '2,000', cashOut: '', balance: '54,250' },
  { date: '10 Mar 2026', time: '10:30 AM', remark: ['Electricity bill'], category: 'Utilities', mode: 'Online', cashIn: '', cashOut: '1,450.00', balance: '52,250' },
  { date: '05 Mar 2026', time: '09:00 AM', remark: ['School van'], category: 'Transport', mode: 'UPI', cashIn: '', cashOut: '1,300', balance: '53,700' },
  { date: '01 Mar 2026', time: '12:05 AM', remark: ['Salary'], category: 'Salary', mode: 'Bank Transfer', cashIn: '50,000', cashOut: '', balance: '55,000' },
];

/** A CashBook-style PDF report: title block, a table that runs onto a second page, footers. */
async function makeCashbookPdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const H = 842;
  const COLS = [{ x: 30 }, { x: 100 }, { x: 240 }, { x: 320 }, { x: 440, right: true }, { x: 500, right: true }, { x: 565, right: true }];
  const draw = (page: PDFPage, text: string, x: number, top: number, f: PDFFont = font, size = 9, right = false) =>
    page.drawText(text, { x: right ? x - f.widthOfTextAtSize(text, size) : x, y: H - top, size, font: f });
  const header = (page: PDFPage, top: number) =>
    ['Date', 'Remark', 'Category', 'Mode', 'Cash In', 'Cash Out', 'Balance'].forEach((t, i) => draw(page, t, COLS[i].x, top, bold, 9, COLS[i].right));
  const row = (page: PDFPage, top: number, cells: Cell[]) => cells.forEach((c, i) => c.text && draw(page, c.text, COLS[i].x, top, font, 9, COLS[i].right));
  const footer = (page: PDFPage, n: number) => {
    draw(page, 'Generated on 07 Nov 2026, 10:12 AM', 30, 820, font, 7);
    draw(page, `Page ${n} of 2`, 565, 820, font, 7, true);
  };
  const entryRows = (page: PDFPage, list: Entry[], top: number) => {
    for (const e of list) {
      row(page, top, [{ text: e.date }, { text: e.remark[0] }, { text: e.category }, { text: e.mode }, { text: e.cashIn }, { text: e.cashOut }, { text: e.balance }]);
      draw(page, e.time, 30, top + 11, font, 7); // time printed under the date
      if (e.remark[1]) draw(page, e.remark[1], 100, top + 11);
      top += 30;
    }
    return top;
  };

  const p1 = doc.addPage([595, H]);
  draw(p1, 'Household Expenses', 30, 40, bold, 16);
  draw(p1, 'Duration: 01 Mar 2026 - 15 Mar 2026', 30, 60);
  draw(p1, 'Total Cash In', 30, 85); draw(p1, 'Total Cash Out', 200, 85); draw(p1, 'Final Balance', 370, 85);
  draw(p1, 'Rs. 52,000', 30, 99, bold); draw(p1, 'Rs. 3,070', 200, 99, bold); draw(p1, 'Rs. 53,930', 370, 99, bold);
  header(p1, 140);
  entryRows(p1, ENTRIES.slice(0, 3), 160);
  footer(p1, 1);

  const p2 = doc.addPage([595, H]);
  draw(p2, 'Household Expenses', 30, 30, bold, 10);
  header(p2, 60);
  const top = entryRows(p2, ENTRIES.slice(3), 80);
  row(p2, top, [{ text: '' }, { text: 'Total' }, { text: '' }, { text: '' }, { text: '52,000' }, { text: '3,070' }, { text: '' }]);
  footer(p2, 2);
  return doc.save();
}

describe('CashBook PDF import', () => {
  it('reads a real two-page PDF report into entries that match CashBook’s balance', async () => {
    const bytes = await makeCashbookPdf();
    const grid = await readCashbookPdf(pdfBlob(bytes), pdfjs);
    const t = detectTable(grid)!;
    expect(t).toBeTruthy();
    expect(t.bookName).toBe('Household Expenses');
    expect(grid[t.headerRow]).toEqual(['Date', 'Remark', 'Category', 'Mode', 'Cash In', 'Cash Out', 'Balance']);
    expect(t.cols).toMatchObject({ date: 0, remark: 1, category: 2, mode: 3, cashIn: 4, cashOut: 5, balance: 6 });
    expect(grid.flat().join('|')).not.toMatch(/Page \d of 2|Generated on/);

    const { entries, skipped } = parseCashbook(grid, t.headerRow, t.cols);
    expect(skipped).toBe(1); // the Total row
    expect(entries.map((e) => e.remark)).toEqual(['Salary', 'School van', 'Electricity bill', 'Birthday gift for Anu from grandparents', 'Vegetables & fruits']);
    expect(entries.map((e) => [e.direction, e.amount])).toEqual([['in', 5000000], ['out', 130000], ['out', 145000], ['in', 200000], ['out', 32000]]);
    expect(entries.map((e) => [e.date.getFullYear(), e.date.getMonth(), e.date.getDate(), e.date.getHours(), e.date.getMinutes()])).toEqual([
      [2026, 2, 1, 0, 5], [2026, 2, 5, 9, 0], [2026, 2, 10, 10, 30], [2026, 2, 12, 18, 15], [2026, 2, 15, 19, 45],
    ]);
    expect(entries.map((e) => e.mode)).toEqual(['Bank Transfer', 'UPI', 'Online', 'Cash', 'Cash']);
    expect(totals(entries)).toEqual({ cashIn: 5200000, cashOut: 307000, net: 4893000 });
    expect(openingBalance(entries)).toBe(500000);
    expect(openingBalance(entries)! + totals(entries).net).toBe(5393000); // "Final Balance Rs. 53,930"
  });

  it('explains scanned PDFs (no text layer) and PDFs without a table', async () => {
    const blank = await PDFDocument.create();
    blank.addPage([595, 842]);
    await expect(readCashbookPdf(pdfBlob(await blank.save()), pdfjs)).rejects.toThrow(/scanned image/);

    const letter = await PDFDocument.create();
    letter.addPage([595, 842]).drawText('Dear customer, thank you.', { x: 40, y: 800, size: 12, font: await letter.embedFont(StandardFonts.Helvetica) });
    await expect(readCashbookPdf(pdfBlob(await letter.save()), pdfjs)).rejects.toThrow(/entries table/);

    await expect(readCashbookPdf(new Blob(['not a pdf']), pdfjs)).rejects.toThrow(/couldn’t be opened/);
  });
});
