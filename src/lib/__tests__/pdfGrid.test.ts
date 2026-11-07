import { describe, expect, it } from 'vitest';
import { detectTable, parseCashbook } from '../cashbook';
import { itemsToGrid, type PdfItem } from '../pdfText';

/** Text items for one visual line: [x, text] pairs at baseline y, ~5 pt per character at 10 pt. */
const line = (y: number, cells: [number, string][], page = 1): PdfItem[] =>
  cells.map(([x, str]) => ({ page, x, y, width: str.length * 5, height: 10, str }));

// Column x positions: Date | Remark | Category | Mode | Cash In | Cash Out | Balance
const X = { date: 40, remark: 110, cat: 230, mode: 300, in: 360, out: 420, bal: 480 };
const HEADER = (y: number, page = 1) => line(y, [[X.date, 'Date'], [X.remark, 'Remark'], [X.cat, 'Category'], [X.mode, 'Mode'], [X.in, 'Cash In'], [X.out, 'Cash Out'], [X.bal, 'Balance']], page);

describe('itemsToGrid', () => {
  it('finds the header, assigns columns and keeps the title block', () => {
    const grid = itemsToGrid([
      ...line(20, [[40, 'Household Expenses']]),
      ...line(36, [[40, 'Duration: 01 Mar 2026 - 31 Mar 2026']]),
      ...line(52, [[40, 'Total Cash In'], [200, 'Total Cash Out'], [360, 'Final Balance']]),
      ...line(66, [[40, '₹ 50,000'], [200, '₹ 1,770'], [360, '₹ 48,230']]),
      ...HEADER(100),
      ...line(120, [[X.date, '10 Mar 2026'], [X.remark, 'Electricity bill'], [X.cat, 'Utilities'], [X.mode, 'Online'], [X.out + 10, '1,450.00'], [X.bal, '48,550']]),
      ...line(150, [[X.date, '01/03/2026'], [X.remark, 'Salary'], [X.mode, 'Bank'], [X.in, '₹ 50,000'], [X.bal, '50,000']]),
    ]);
    const t = detectTable(grid)!;
    expect(t.bookName).toBe('Household Expenses');
    expect(grid[t.headerRow]).toEqual(['Date', 'Remark', 'Category', 'Mode', 'Cash In', 'Cash Out', 'Balance']);
    expect(grid.every((r) => r.length === 7)).toBe(true);
    expect(grid[t.headerRow + 1]).toEqual(['10 Mar 2026', 'Electricity bill', 'Utilities', 'Online', '', '1,450.00', '48,550']);
    expect(grid[t.headerRow + 2]).toEqual(['01/03/2026', 'Salary', '', 'Bank', '₹ 50,000', '', '50,000']);
  });

  it('merges wrapped remarks and times printed under the date', () => {
    const grid = itemsToGrid([
      ...HEADER(100),
      ...line(120, [[X.date, '15 Mar 2026'], [X.remark, 'Vegetables, fruits'], [X.cat, 'Groceries'], [X.mode, 'Cash'], [X.out, '320'], [X.bal, '51,930']]),
      ...line(132, [[X.date, '07:45 PM'], [X.remark, 'and milk'], [X.cat, 'Entry by Priya']]),
      ...line(156, [[X.date, '14 Mar 2026'], [X.remark, 'Tea'], [X.out, '- 50'], [X.bal, '52,250']]),
      ...line(168, [[X.date, '10:30 AM']]),
    ]);
    const t = detectTable(grid)!;
    const body = grid.slice(t.headerRow + 1);
    expect(body).toHaveLength(2);
    expect(body[0].slice(0, 3)).toEqual(['15 Mar 2026 07:45 PM', 'Vegetables, fruits and milk', 'Groceries Entry by Priya']);
    expect(body[1][0]).toBe('14 Mar 2026 10:30 AM');
    const { entries } = parseCashbook(grid, t.headerRow, t.cols);
    expect(entries.map((e) => [e.date.getDate(), e.date.getHours(), e.date.getMinutes(), e.amount])).toEqual([[14, 10, 30, 5000], [15, 19, 45, 32000]]);
  });

  it('joins a remark line printed above a vertically centred row to that row', () => {
    const grid = itemsToGrid([
      ...HEADER(100),
      ...line(120, [[X.date, '02 Mar 2026'], [X.remark, 'Rent'], [X.out, '8,000'], [X.bal, '1,000']]),
      ...line(146, [[X.remark, 'School fees for']]),
      ...line(152, [[X.date, '01 Mar 2026'], [X.out, '1,000'], [X.bal, '9,000']]),
      ...line(158, [[X.remark, 'March and April']]),
    ]);
    const t = detectTable(grid)!;
    expect(grid.slice(t.headerRow + 1).map((r) => r[1])).toEqual(['Rent', 'School fees for March and April']);
  });

  it('skips repeated headers, page furniture and the next page’s title block', () => {
    const grid = itemsToGrid([
      ...line(10, [[40, 'CashBook']]),
      ...line(20, [[40, 'Shop Book']]),
      ...HEADER(100),
      ...line(120, [[X.date, '02 Mar 2026'], [X.remark, 'Sale'], [X.in, '500'], [X.bal, '1,500']]),
      ...line(800, [[40, 'Generated on 07 Nov 2026'], [450, 'Page 1 of 2']]),
      ...line(880, [[40, 'Shop Book']], 2),
      ...HEADER(900, 2),
      ...line(920, [[X.date, '01 Mar 2026'], [X.remark, 'Opening stock sale'], [X.in, '1,000'], [X.bal, '1,000']], 2),
      ...line(940, [[X.remark, 'Total'], [X.in, '1,500'], [X.out, '0']], 2),
      ...line(1600, [[450, 'Page 2 of 2']], 2),
    ]);
    expect(grid.flat()).not.toContain('Page 1 of 2');
    expect(grid.flat().join(' ')).not.toMatch(/Generated|Page 2/);
    const t = detectTable(grid)!;
    expect(t.bookName).toBe('Shop Book');
    const body = grid.slice(t.headerRow + 1);
    expect(body.map((r) => r[1])).toEqual(['Sale', 'Opening stock sale', 'Total']);
    const { entries, skipped } = parseCashbook(grid, t.headerRow, t.cols);
    expect(entries).toHaveLength(2);
    expect(skipped).toBe(1);
  });

  it('puts a labelled book name first and reads bracketed / signed amounts', () => {
    const grid = itemsToGrid([
      ...line(10, [[40, 'Cash Book Report']]),
      ...line(24, [[40, 'Book: Petty Cash']]),
      ...line(100, [[40, 'Date'], [150, 'Details'], [300, 'Amount'], [380, 'Balance']]),
      ...line(120, [[40, '3 Mar 2026'], [150, 'Courier'], [300, '(1,200)'], [380, '800']]),
      ...line(140, [[40, '2 Mar 2026'], [150, 'Float'], [300, '2,000'], [380, '2,000']]),
    ]);
    expect(grid[0]).toEqual(['Petty Cash', '', '', '']);
    const t = detectTable(grid)!;
    expect(t.bookName).toBe('Petty Cash');
    const { entries } = parseCashbook(grid, t.headerRow, t.cols);
    expect(entries.map((e) => [e.direction, e.amount])).toEqual([['in', 200000], ['out', 120000]]);
  });

  it('returns nothing when there is no table', () => {
    expect(itemsToGrid(line(10, [[40, 'Just a letter'], [200, 'nothing tabular']]))).toEqual([]);
  });
});
