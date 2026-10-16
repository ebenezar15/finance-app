import { describe, expect, it } from 'vitest';
import { guessColumns, parseCSV, parseDate, parseOFX, toCSV } from '../csv';
import { parseVoice } from '../voice';
import { suggestCategory } from '../categorize';
import { DEFAULT_CATEGORIES } from '../../db/seed';

describe('csv', () => {
  it('parses quotes, escaped quotes and CRLF', () => {
    const rows = parseCSV('Date,Description,Amount\r\n2026-03-01,"Coffee, large",-4.50\r\n2026-03-02,"Say ""hi""",10\r\n');
    expect(rows).toEqual([['Date', 'Description', 'Amount'], ['2026-03-01', 'Coffee, large', '-4.50'], ['2026-03-02', 'Say "hi"', '10']]);
    expect(parseCSV(toCSV(rows))).toEqual(rows);
  });
  it('guesses debit/credit columns', () => {
    expect(guessColumns(['Txn Date', 'Narration', 'Withdrawal Amt', 'Deposit Amt', 'Balance'])).toMatchObject({ date: 0, description: 1, debit: 2, credit: 3 });
  });
  it('reads day-first and month-first dates', () => {
    expect(parseDate('04/03/2026')).toBe('2026-03-04');
    expect(parseDate('04/03/2026', false)).toBe('2026-04-03');
    expect(parseDate('2026-3-4')).toBe('2026-03-04');
  });
  it('reads OFX', () => {
    const ofx = '<OFX><STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260305120000<TRNAMT>-42.17<FITID>abc1<NAME>WHOLE FOODS</STMTTRN></OFX>';
    expect(parseOFX(ofx)).toEqual([{ date: '2026-03-05', amount: -4217, name: 'WHOLE FOODS', fitid: 'abc1' }]);
  });
});

describe('voice', () => {
  it('parses a spoken expense', () => {
    const d = parseVoice('Spent 450 on groceries at Whole Foods yesterday', new Date(2026, 2, 10));
    expect(d).toMatchObject({ amount: 45000, payee: 'Whole Foods', categoryHint: 'groceries', date: '2026-03-09', type: 'expense' });
  });
  it('detects income', () => expect(parseVoice('received 1.5k from client').type).toBe('income'));
});

describe('auto-categorisation', () => {
  it('prefers learned rules, explains why', () => {
    const s = suggestCategory('STARBUCKS #123', DEFAULT_CATEGORIES, [{ id: 'r', pattern: 'starbucks', categoryId: 'groceries', hits: 3 }]);
    expect(s).toMatchObject({ categoryId: 'groceries' });
    expect(s!.reason).toContain('3×');
    expect(suggestCategory('Starbucks', DEFAULT_CATEGORIES, [])!.categoryId).toBe('dining');
  });
});
