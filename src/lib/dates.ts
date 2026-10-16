export const DAY = 86400_000;

export const isoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const monthKey = (d: Date | string) => {
  const x = typeof d === 'string' ? new Date(d) : d;
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`;
};

export const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
export const endOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
export const daysInMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());
export const addMonths = (d: Date, n: number) => {
  const day = d.getDate();
  const r = new Date(d.getFullYear(), d.getMonth() + n, 1, d.getHours(), d.getMinutes());
  r.setDate(Math.min(day, daysInMonth(r)));
  return r;
};

export function monthsBetween(a: Date, b: Date) {
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

export function relativeDay(iso: string, now = new Date()) {
  const d = new Date(iso);
  const diff = Math.round((new Date(isoDate(d)).getTime() - new Date(isoDate(now)).getTime()) / DAY);
  if (diff === 0) return 'Today';
  if (diff === -1) return 'Yesterday';
  if (diff === 1) return 'Tomorrow';
  if (diff > 1 && diff < 7) return `In ${diff} days`;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

export const monthLabel = (d: Date) => d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

/** Indian FY label, e.g. FY 2026–27 when fyStart = April (3). */
export function fyRange(d: Date, fyStartMonth = 3) {
  const y = d.getMonth() >= fyStartMonth ? d.getFullYear() : d.getFullYear() - 1;
  const start = new Date(y, fyStartMonth, 1);
  const end = new Date(y + 1, fyStartMonth, 0, 23, 59, 59);
  return { start, end, label: fyStartMonth === 0 ? `${y}` : `FY ${y}–${String(y + 1).slice(2)}` };
}
