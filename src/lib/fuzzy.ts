/**
 * Small subsequence fuzzy matcher for the command palette.
 *
 * Every character of the query must appear in the text, in order ("grc" matches "Groceries").
 * Matches score higher when they are consecutive, start a word, or start the text, and lower
 * when they are spread out. Returns null when the query is not a subsequence of the text.
 */

const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const isBoundary = (text: string, i: number) => i === 0 || /[\s\-_/.,&()#]/.test(text[i - 1]);

/** Whether q[qi..] is a subsequence of t[ti..]. */
function restMatches(q: string, qi: number, t: string, ti: number) {
  for (; qi < q.length; qi++) {
    ti = t.indexOf(q[qi], ti);
    if (ti === -1) return false;
    ti++;
  }
  return true;
}

export interface FuzzyMatch {
  score: number;
  /** Indexes into the text of each matched character, for highlighting. */
  positions: number[];
}

export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const q = fold(query.trim());
  if (!q) return { score: 0, positions: [] };
  const t = fold(text);
  if (q.length > t.length) return null;

  // Exact substring is always the best kind of match; a prefix even more so.
  const sub = t.indexOf(q);
  if (sub !== -1) {
    const positions = Array.from({ length: q.length }, (_, k) => sub + k);
    const score = 100 + q.length * 10 + (sub === 0 ? 50 : isBoundary(t, sub) ? 25 : 0) - Math.min(t.length - q.length, 20);
    return { score, positions };
  }

  // Greedy left-to-right subsequence, preferring a word-start occurrence of each character when
  // one exists before the next plain occurrence would be needed.
  const positions: number[] = [];
  let score = 0;
  let ti = 0;
  let prev = -2;
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi];
    let found = -1;
    for (let j = ti; j < t.length; j++) {
      if (t[j] !== ch) continue;
      if (found === -1) found = j;
      // Stay on a consecutive run if possible; otherwise jump to a word start if one is ahead,
      // but only when the rest of the query can still match after it.
      if (j === prev + 1 || isBoundary(t, j)) {
        if (j === found || restMatches(q, qi + 1, t, j + 1)) found = j;
        break;
      }
    }
    if (found === -1) return null;
    if (found === prev + 1) score += 15;
    else if (prev >= 0) score -= Math.min(found - prev - 1, 10);
    if (isBoundary(t, found)) score += found === 0 ? 20 : 12;
    score += 5;
    positions.push(found);
    prev = found;
    ti = found + 1;
  }
  // Shorter texts are tighter matches.
  score -= Math.min(t.length - q.length, 20) / 2;
  return { score, positions };
}

/** Score only; null when there is no match. */
export const fuzzyScore = (query: string, text: string) => fuzzyMatch(query, text)?.score ?? null;

/** Best score across several fields of one item (e.g. a label plus keywords). */
export function bestScore(query: string, texts: (string | undefined)[]): number | null {
  let best: number | null = null;
  for (const t of texts) {
    if (!t) continue;
    const s = fuzzyScore(query, t);
    if (s !== null && (best === null || s > best)) best = s;
  }
  return best;
}

/** Filters and sorts items by best score; ties keep their original order. */
export function fuzzyFilter<T>(items: T[], query: string, fields: (item: T) => (string | undefined)[]): T[] {
  if (!query.trim()) return items.slice();
  return items
    .map((item, i) => ({ item, i, s: bestScore(query, fields(item)) }))
    .filter((x): x is { item: T; i: number; s: number } => x.s !== null)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.item);
}
