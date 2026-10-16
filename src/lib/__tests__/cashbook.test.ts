import { describe, expect, it } from 'vitest';
import { parseCSV } from '../csv';
import { detectTable, modeToMethod, openingBalance, parseCashbook, totals } from '../cashbook';
import { readXlsx } from '../xlsx';

/** Builds a real .xlsx (zip of XML, deflate-compressed) like Excel/CashBook produce. */
async function makeXlsx(rows: (string | number)[][]) {
  const shared: string[] = [];
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const col = (i: number) => String.fromCharCode(65 + i);
  const sheetRows = rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => {
    if (v === '') return '';
    const ref = `${col(ci)}${ri + 1}`;
    if (typeof v === 'number') return `<c r="${ref}"><v>${v}</v></c>`;
    shared.push(v);
    return `<c r="${ref}" t="s"><v>${shared.length - 1}</v></c>`;
  }).join('')}</row>`).join('');
  const files: Record<string, string> = {
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    'xl/workbook.xml': '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Entries" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/sharedStrings.xml': `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${shared.map((s) => `<si><t>${esc(s)}</t></si>`).join('')}</sst>`,
    'xl/worksheets/sheet1.xml': `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`,
  };
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = enc.encode(text);
    const comp = new Uint8Array(await new Response(new Response(raw).body!.pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
    const nameB = enc.encode(name);
    const local = new Uint8Array(30 + nameB.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(8, 8, true); lv.setUint32(18, comp.length, true); lv.setUint32(22, raw.length, true); lv.setUint16(26, nameB.length, true);
    local.set(nameB, 30);
    const cen = new Uint8Array(46 + nameB.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(10, 8, true); cv.setUint32(20, comp.length, true); cv.setUint32(24, raw.length, true); cv.setUint16(28, nameB.length, true); cv.setUint32(42, offset, true);
    cen.set(nameB, 46);
    parts.push(local, comp); central.push(cen);
    offset += local.length + comp.length;
  }
  const cenSize = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, central.length, true); ev.setUint16(10, central.length, true); ev.setUint32(12, cenSize, true); ev.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end] as BlobPart[]);
}

// Shaped like a CashBook "All entries" Excel report: title rows, then the table, newest first.
const CASHBOOK_ROWS: (string | number)[][] = [
  ['Household Expenses'],
  ['Duration: 01 Mar 2026 - 31 Mar 2026'],
  ['Total Cash In', 'Total Cash Out', 'Final Balance'],
  [50000, 3070, 51930],
  [],
  ['Date', 'Time', 'Remark', 'Category', 'Mode', 'Entry by', 'Cash In', 'Cash Out', 'Balance'],
  ['15 Mar 2026', '07:45 PM', 'Vegetables & fruits', 'Groceries', 'Cash', 'Ebenezar', '', 320, 51930],
  [46091, 0.4375, 'Electricity bill', 'Utilities', 'Online', 'Ebenezar', '', 1450, 52250], // Excel date serial + time fraction (10 Mar 2026 10:30)
  ['05/03/2026', '9:00 AM', 'School van', 'Transport', 'UPI', 'Priya', '', 1300, 53700],
  ['01/03/2026', '10:00 AM', 'Salary', 'Salary', 'Bank Transfer', 'Ebenezar', 50000, '', 55000],
  ['', '', 'Total', '', '', '', 50000, 3070, ''],
];

describe('CashBook import', () => {
  it('reads a real .xlsx export (zip + shared strings + Excel dates)', async () => {
    const rows = await readXlsx(await makeXlsx(CASHBOOK_ROWS));
    expect(rows[0][0]).toBe('Household Expenses');
    const t = detectTable(rows)!;
    expect(rows[t.headerRow][0]).toBe('Date');
    expect(t.bookName).toBe('Household Expenses');
    expect(t.cols).toMatchObject({ date: 0, time: 1, remark: 2, category: 3, mode: 4, entryBy: 5, cashIn: 6, cashOut: 7, balance: 8 });
    const { entries, skipped } = parseCashbook(rows, t.headerRow, t.cols);
    expect(skipped).toBe(1); // the Total row
    expect(entries.map((e) => e.remark)).toEqual(['Salary', 'School van', 'Electricity bill', 'Vegetables & fruits']);
    const bill = entries[2];
    expect([bill.date.getFullYear(), bill.date.getMonth(), bill.date.getDate(), bill.date.getHours(), bill.date.getMinutes()]).toEqual([2026, 2, 10, 10, 30]);
    expect(entries[3].date.getHours()).toBe(19); // 07:45 PM
    expect(totals(entries)).toEqual({ cashIn: 5000000, cashOut: 307000, net: 4693000 });
    // Opening balance so the account ends exactly on CashBook's final balance (51,930)
    expect(openingBalance(entries)).toBe(500000);
    expect((openingBalance(entries)! + totals(entries).net) / 100).toBe(51930);
  });

  it('reads CSV exports and single amount + type layouts', () => {
    const csv = 'My Shop Book\nDate,Remarks,Category,Payment Mode,Amount,Type,Balance\n2026-03-02,Sale,Sales,UPI,"1,200.00",Cash In,1200\n2026-03-03,Rent,Rent,Cash,800,Cash Out,400\n';
    const rows = parseCSV(csv);
    const t = detectTable(rows)!;
    expect(t.cols).toMatchObject({ date: 0, remark: 1, category: 2, mode: 3, amount: 4, type: 5, balance: 6 });
    const { entries } = parseCashbook(rows, t.headerRow, t.cols);
    expect(entries.map((e) => [e.direction, e.amount])).toEqual([['in', 120000], ['out', 80000]]);
    expect(openingBalance(entries)).toBe(0);
  });

  it('maps payment modes', () => {
    expect(['Cash', 'Online', 'UPI', 'GPay', 'NEFT', 'Bank Transfer', 'Cheque', 'Credit Card', 'Debit Card', 'Paytm Wallet', 'Barter', ''].map(modeToMethod))
      .toEqual(['cash', 'online', 'online', 'online', 'transfer', 'transfer', 'cheque', 'credit', 'debit', 'wallet', 'other', 'cash']);
  });

  it('refuses files that are not spreadsheets with a clear message', async () => {
    await expect(readXlsx(new Blob([new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 1, 2, 3])]))).rejects.toThrow(/old-style \.xls/);
    await expect(readXlsx(new Blob(['%PDF-1.7 not a zip']))).rejects.toThrow(/valid Excel/);
  });
});
