import { describe, expect, it } from 'vitest';
import { bestScore, fuzzyFilter, fuzzyMatch, fuzzyScore } from '../fuzzy';

describe('fuzzy', () => {
  it('matches subsequences in order, case-insensitively', () => {
    expect(fuzzyScore('grc', 'Groceries')).not.toBeNull();
    expect(fuzzyScore('GRC', 'groceries')).not.toBeNull();
    expect(fuzzyScore('rgc', 'Groceries')).toBeNull();
    expect(fuzzyScore('xyz', 'Groceries')).toBeNull();
    expect(fuzzyScore('groceriesx', 'Groceries')).toBeNull();
  });

  it('treats an empty query as matching everything', () => {
    expect(fuzzyScore('', 'Anything')).toBe(0);
    expect(fuzzyScore('   ', 'Anything')).toBe(0);
  });

  it('ignores accents', () => {
    expect(fuzzyScore('cafe', 'Café Nero')).not.toBeNull();
  });

  it('reports matched positions', () => {
    expect(fuzzyMatch('grc', 'Groceries')?.positions).toEqual([0, 1, 3]);
    expect(fuzzyMatch('cer', 'Groceries')?.positions).toEqual([3, 4, 5]);
  });

  it('ranks prefixes above substrings above scattered matches', () => {
    const prefix = fuzzyScore('gro', 'Groceries')!;
    const inner = fuzzyScore('cer', 'Groceries')!;
    const scattered = fuzzyScore('gis', 'Groceries')!;
    expect(prefix).toBeGreaterThan(inner);
    expect(inner).toBeGreaterThan(scattered);
  });

  it('rewards word starts', () => {
    expect(fuzzyScore('ne', 'New expense')!).toBeGreaterThan(fuzzyScore('ne', 'Phone bill')!);
    expect(fuzzyScore('ne', 'New expense')!).toBeGreaterThan(fuzzyScore('nx', 'New expense')!);
    expect(fuzzyScore('nx', 'New expense')).not.toBeNull();
  });

  it('prefers shorter texts for the same match', () => {
    expect(fuzzyScore('gas', 'Gas')!).toBeGreaterThan(fuzzyScore('gas', 'Gas and electricity')!);
  });

  it('never drops a real subsequence while preferring word starts', () => {
    // The word-start "a" at index 5 leaves no "c" after it, so the earlier "a" must be kept.
    expect(fuzzyMatch('ac', 'xabc a')?.positions).toEqual([1, 3]);
    // When the rest still fits, the word start wins.
    expect(fuzzyMatch('ac', 'xab ac')?.positions).toEqual([4, 5]);
  });

  it('takes the best field of an item', () => {
    expect(bestScore('dark', ['Switch theme', undefined, 'dark mode'])).not.toBeNull();
    expect(bestScore('zzz', ['Switch theme', 'dark mode'])).toBeNull();
  });

  it('filters and sorts, keeping order for ties and for an empty query', () => {
    const items = ['Settings', 'Groceries', 'Goals', 'Gas'];
    expect(fuzzyFilter(items, '', (s) => [s])).toEqual(items);
    const out = fuzzyFilter(items, 'g', (s) => [s]);
    expect(out).toEqual(['Gas', 'Goals', 'Groceries', 'Settings']);
    expect(fuzzyFilter(items, 'xq', (s) => [s])).toEqual([]);
    expect(fuzzyFilter(items, 'grc', (s) => [s])).toEqual(['Groceries']);
  });
});
