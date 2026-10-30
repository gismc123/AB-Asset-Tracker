import type { ISODate } from './types.js';

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseISODate(date: ISODate): { y: number; m: number; d: number } {
  const match = ISO.exec(date);
  if (!match) throw new Error(`Invalid date "${date}", expected YYYY-MM-DD`);
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) {
    throw new Error(`Invalid date "${date}"`);
  }
  return { y, m, d };
}

export function isValidISODate(date: unknown): date is ISODate {
  if (typeof date !== 'string') return false;
  try {
    parseISODate(date);
    return true;
  } catch {
    return false;
  }
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function formatISODate(y: number, m: number, d: number): ISODate {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Due date of payment number `n` (1-based): the month of the first payment
 * plus n-1 months, on `paymentDay` clamped to that month's length.
 */
export function dueDateFor(firstPaymentDate: ISODate, paymentDay: number, n: number): ISODate {
  const { y, m } = parseISODate(firstPaymentDate);
  const index = y * 12 + (m - 1) + (n - 1);
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return formatISODate(year, month, Math.min(paymentDay, daysInMonth(year, month)));
}

/** Whole days from a to b (b - a). */
export function daysBetween(a: ISODate, b: ISODate): number {
  const pa = parseISODate(a);
  const pb = parseISODate(b);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86_400_000);
}

export function addDays(date: ISODate, days: number): ISODate {
  const { y, m, d } = parseISODate(date);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return formatISODate(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** The same day `years` later (Feb 29 becomes Feb 28 in a common year). */
export function addYears(date: ISODate, years: number): ISODate {
  const { y, m, d } = parseISODate(date);
  return formatISODate(y + years, m, Math.min(d, daysInMonth(y + years, m)));
}

/** Today's date in the process timezone (set TZ in Docker). */
export function todayISO(now: Date = new Date()): ISODate {
  return formatISODate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}
