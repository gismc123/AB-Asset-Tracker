import { parseISODate } from '../engine/dates.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function money(cents: number, opts: { whole?: boolean; sign?: boolean } = {}): string {
  const sign = cents < 0 ? '−' : opts.sign && cents > 0 ? '+' : '';
  const abs = Math.abs(cents);
  if (opts.whole) return `${sign}$${Math.round(abs / 100).toLocaleString('en-US')}`;
  return `${sign}$${Math.floor(abs / 100).toLocaleString('en-US')}.${String(abs % 100).padStart(2, '0')}`;
}

export function date(iso: string | null | undefined, style: 'short' | 'month' = 'short'): string {
  if (!iso) return '—';
  const { y, m, d } = parseISODate(iso);
  return style === 'month' ? `${MONTHS[m - 1]} ${y}` : `${MONTHS[m - 1]} ${d}, ${y}`;
}

export function percent(n: number, digits = 1): string {
  return `${n.toFixed(digits)}%`;
}

/** "3 years, 2 months" from a payment count. */
export function duration(payments: number): string {
  if (payments <= 0) return 'now';
  const y = Math.floor(payments / 12);
  const m = payments % 12;
  const parts = [y && `${y} year${y === 1 ? '' : 's'}`, m && `${m} month${m === 1 ? '' : 's'}`].filter(Boolean);
  return parts.join(', ');
}

/** Dollars typed in a form field to cents (null when blank / invalid). */
export function parseDollars(text: string): number | null {
  const t = text.replace(/[$,\s]/g, '');
  if (!t || !/^-?\d*(\.\d{0,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}

export function centsToInput(cents: number | null | undefined): string {
  return cents === null || cents === undefined ? '' : (cents / 100).toFixed(2);
}
