import type { Cents } from './types.js';

/**
 * Round half away from zero, after trimming float noise such as
 * 0.49999999999 that should really be 0.5.
 */
export function roundCents(value: number): Cents {
  const cleaned = Number(value.toFixed(6));
  return Math.sign(cleaned) * Math.round(Math.abs(cleaned));
}

/** Monthly rate as a fraction, from an annual percent. */
export function monthlyRate(annualRatePercent: number): number {
  return annualRatePercent / 1200;
}

/** Interest for one month on a balance, rounded to the cent. */
export function monthlyInterest(balance: Cents, annualRatePercent: number): Cents {
  return roundCents((balance * annualRatePercent) / 1200);
}

/** Simple daily interest: balance x rate / 365 x days, rounded to the cent. */
export function dailyInterest(balance: Cents, annualRatePercent: number, days: number): Cents {
  return roundCents((balance * annualRatePercent * days) / 36_500);
}

/**
 * Standard fully-amortizing payment: P * r / (1 - (1 + r)^-n), rounded to
 * the nearest cent (lenders round, so the final payment absorbs the drift).
 */
export function standardPayment(principal: Cents, annualRatePercent: number, months: number): Cents {
  if (months <= 0) throw new Error('Term must be at least one month');
  const r = monthlyRate(annualRatePercent);
  if (r === 0) return roundCents(principal / months);
  return roundCents((principal * r) / (1 - Math.pow(1 + r, -months)));
}

/** Parse "1,234.56" / "$1234.5" / 1234.56 into cents. Returns null when not a number. */
export function toCents(value: string | number): Cents | null {
  const text = typeof value === 'number' ? String(value) : value.replace(/[$,\s]/g, '');
  if (text === '' || !/^-?\d*(\.\d*)?$/.test(text)) return null;
  const n = Number(text);
  return Number.isFinite(n) ? roundCents(n * 100) : null;
}

export function formatCents(cents: Cents): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toLocaleString('en-US');
  return `${sign}$${dollars}.${String(abs % 100).padStart(2, '0')}`;
}
