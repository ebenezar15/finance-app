import type { Category, MerchantRule, Transaction } from '../db/types';

/** Built-in keyword hints, used only when the user has not taught a rule yet. */
const KEYWORDS: Record<string, string[]> = {
  groceries: ['grocery', 'groceries', 'supermarket', 'whole foods', 'tesco', 'aldi', 'lidl', 'walmart', 'costco', 'bigbasket', 'trader joe', 'safeway', 'kroger', 'carrefour', 'dmart', 'blinkit'],
  dining: ['restaurant', 'cafe', 'coffee', 'starbucks', 'pizza', 'burger', 'dining', 'swiggy', 'zomato', 'uber eats', 'doordash', 'deliveroo', 'mcdonald', 'kfc', 'lunch', 'dinner'],
  transport: ['uber', 'lyft', 'ola', 'taxi', 'metro', 'train', 'bus', 'fuel', 'petrol', 'gas station', 'shell', 'parking', 'toll'],
  shopping: ['amazon', 'flipkart', 'target', 'ikea', 'zara', 'h&m', 'mall', 'store', 'shop'],
  utilities: ['electric', 'electricity', 'water', 'gas bill', 'internet', 'broadband', 'mobile', 'phone bill', 'airtel', 'jio', 'verizon', 'comcast'],
  subscriptions: ['netflix', 'spotify', 'prime', 'disney', 'youtube', 'icloud', 'apple.com', 'adobe', 'hotstar', 'chatgpt'],
  health: ['pharmacy', 'chemist', 'doctor', 'clinic', 'hospital', 'dental', 'medic', 'cvs', 'walgreens', 'apollo'],
  housing: ['rent', 'landlord', 'mortgage', 'maintenance', 'hoa'],
  education: ['school', 'tuition', 'college', 'university', 'course', 'udemy', 'books'],
  entertainment: ['movie', 'cinema', 'concert', 'game', 'steam', 'playstation', 'bookmyshow'],
  travel: ['airline', 'flight', 'hotel', 'airbnb', 'booking.com', 'expedia', 'makemytrip'],
  salary: ['salary', 'payroll', 'wages'],
};

export interface Suggestion { categoryId: string; reason: string; score: number }

export function suggestCategory(
  text: string, categories: Category[], rules: MerchantRule[], history: Transaction[] = [],
): Suggestion | null {
  const t = text.toLowerCase().trim();
  if (!t) return null;
  const rule = rules
    .filter((r) => t.includes(r.pattern))
    .sort((a, b) => b.pattern.length - a.pattern.length || b.hits - a.hits)[0];
  if (rule) return { categoryId: rule.categoryId, reason: `You filed “${rule.pattern}” here ${rule.hits}×`, score: 0.95 };

  const past = history.filter((h) => h.payee?.toLowerCase() === t && h.categoryId);
  if (past.length) {
    const counts = new Map<string, number>();
    for (const p of past) counts.set(p.categoryId!, (counts.get(p.categoryId!) ?? 0) + 1);
    const [id, n] = [...counts].sort((a, b) => b[1] - a[1])[0];
    return { categoryId: id, reason: `Matches ${n} past ${n > 1 ? 'entries' : 'entry'} for this payee`, score: 0.85 };
  }
  for (const [catId, words] of Object.entries(KEYWORDS)) {
    const w = words.find((k) => t.includes(k));
    if (w && categories.some((c) => c.id === catId)) return { categoryId: catId, reason: `Keyword “${w}”`, score: 0.7 };
  }
  const byName = categories.find((c) => t.includes(c.name.toLowerCase()));
  if (byName) return { categoryId: byName.id, reason: `Mentions “${byName.name}”`, score: 0.65 };
  return null;
}

/** The key we remember when the user corrects a category. */
export const ruleKey = (payee: string) => payee.toLowerCase().replace(/[^a-z0-9& ]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 3).join(' ');

/** Time-of-day / weekday aware suggestions for the quick-add sheet. */
export function quickSuggestions(history: Transaction[], now: Date, limit = 5) {
  const hour = now.getHours();
  const scores = new Map<string, { payee: string; categoryId?: string; amount: number; score: number }>();
  for (const t of history) {
    if (t.type !== 'expense' || !t.payee || t.deletedAt) continue;
    const d = new Date(t.date);
    const ageDays = (now.getTime() - d.getTime()) / 86400_000;
    if (ageDays > 120) continue;
    const near = Math.abs(d.getHours() - hour) <= 2 ? 2 : 1;
    const sameDow = d.getDay() === now.getDay() ? 1.5 : 1;
    const k = t.payee.toLowerCase();
    const cur = scores.get(k) ?? { payee: t.payee, categoryId: t.categoryId, amount: t.amount, score: 0 };
    cur.score += (near * sameDow) / (1 + ageDays / 30);
    scores.set(k, cur);
  }
  return [...scores.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}
