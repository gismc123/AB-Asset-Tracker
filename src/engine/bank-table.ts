import { formatISODate, isValidISODate } from './dates.js';
import type { Cents, ISODate } from './types.js';

/**
 * Reading a lender's amortization table from a CSV file: the lender's own
 * interest and principal for each month, used instead of the calculated
 * ones (see `BankRow`). Pure functions, shared by the browser, which reads
 * the file, and the server, which checks what it's sent.
 */

/** One month of the lender's table, matched to a payment on the schedule. */
export interface BankRow {
  payment: number;
  /** The date in the file, when it had one. */
  dueDate: ISODate | null;
  /** The payment column (P&I as the lender shows it), when the file had one. */
  paymentAmount: Cents | null;
  principal: Cents;
  interest: Cents;
  /** The balance after this payment, when the file had one. Used to check the import, never to set the balance. */
  balance: Cents | null;
}

export type BankColumn = 'date' | 'number' | 'payment' | 'principal' | 'interest' | 'balance';
export const BANK_COLUMNS: BankColumn[] = ['date', 'number', 'payment', 'principal', 'interest', 'balance'];

/** Which column of the file holds each field (0-based), or undefined when it isn't there. */
export type BankMapping = Partial<Record<BankColumn, number>>;

export type DateFormat = 'ymd' | 'mdy' | 'dmy';
/** `dot`: 1,234.56. `comma`: 1.234,56. */
export type NumberFormat = 'dot' | 'comma';

export interface BankTableOptions {
  /** The first row holds column names. */
  header: boolean;
  dateFormat: DateFormat;
  numberFormat: NumberFormat;
}

/** Split CSV text into rows of cells. Detects comma, semicolon or tab; handles quotes, doubled quotes and line breaks in quotes. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const counts = [',', ';', '\t'].map((d) => ({ d, n: firstLine.split(d).length }));
  const delimiter = counts.sort((a, b) => b.n - a.n)[0]!.d;

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell.trim() === '') {
      quoted = true;
      cell = '';
    } else if (c === delimiter) {
      row.push(cell.trim());
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell.trim());
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c !== ''));
}

/**
 * Text to cents: "$1,234.56", "1234.5", "(12.34)", "12.34-", "1.234,56" with
 * `comma`. Null when it isn't an amount.
 */
export function parseAmountText(text: string, format: NumberFormat = 'dot'): Cents | null {
  let t = text.trim();
  if (!t) return null;
  let negative = false;
  if (/^\(.*\)$/.test(t)) {
    negative = true;
    t = t.slice(1, -1);
  }
  if (t.endsWith('-')) {
    negative = true;
    t = t.slice(0, -1);
  }
  if (t.startsWith('-')) {
    negative = !negative;
    t = t.slice(1);
  }
  t = t.replace(/[^\d.,]/g, '');
  if (format === 'comma') t = t.replace(/\./g, '').replace(',', '.');
  else t = t.replace(/,/g, '');
  if (!/^\d*(\.\d+)?$/.test(t) || t === '' || t === '.') return null;
  const cents = Math.round(Number(t) * 100);
  return negative ? -cents : cents;
}

/** Text to a date: 2026-03-01, 03/01/2026 (mdy), 01.03.2026 (dmy), 3/1/26. Null when it isn't one. */
export function parseDateText(text: string, format: DateFormat): ISODate | null {
  const parts = text.trim().split(/[\s/.\-]+/).filter(Boolean);
  if (parts.length !== 3 || !parts.every((p) => /^\d+$/.test(p))) return null;
  const nums = parts.map(Number) as [number, number, number];
  // A four-digit first part is always year-month-day.
  const order = parts[0]!.length === 4 ? 'ymd' : format;
  let [y, m, d] = order === 'ymd' ? nums : order === 'mdy' ? [nums[2], nums[0], nums[1]] : [nums[2], nums[1], nums[0]];
  if (y < 100) y += 2000;
  const iso = formatISODate(y, m, d);
  return isValidISODate(iso) ? iso : null;
}

const GUESSES: [BankColumn, RegExp][] = [
  ['number', /^((pmt|payment|period)\s*)?(#|no\.?|num(ber)?)$/i],
  ['date', /date|due|period|month/i],
  ['principal', /princ/i],
  ['interest', /interest|int\b/i],
  ['balance', /balance|remaining|outstanding|ending/i],
  ['payment', /payment|installment|amount|p\s*&\s*i|pmt/i],
];

/** Guess which column holds what from the header row. */
export function guessMapping(header: readonly string[]): BankMapping {
  const mapping: BankMapping = {};
  const used = new Set<number>();
  for (const [field, re] of GUESSES) {
    const i = header.findIndex((h, k) => !used.has(k) && re.test(h.trim()));
    if (i >= 0) {
      mapping[field] = i;
      used.add(i);
    }
  }
  return mapping;
}

/** Guess the date format from the date column: a first part over 12 means day first; a second part over 12 means month first. */
export function guessDateFormat(values: readonly string[]): DateFormat {
  for (const v of values) {
    const p = v.trim().split(/[\s/.\-]+/);
    if (p[0]?.length === 4) return 'ymd';
    if (Number(p[0]) > 12) return 'dmy';
    if (Number(p[1]) > 12) return 'mdy';
  }
  return 'mdy';
}

/** Guess the number format: a comma followed by exactly two digits at the end means decimal comma. */
export function guessNumberFormat(values: readonly string[]): NumberFormat {
  return values.some((v) => /,\d{2}\)?-?$/.test(v.trim()) && !/\.\d{2}\)?-?$/.test(v.trim())) ? 'comma' : 'dot';
}

export interface BankTableResult {
  rows: BankRow[];
  /** Lines that were left out, and why (1-based line numbers in the file). */
  skipped: { line: number; reason: string }[];
}

/**
 * Turn the file's rows into months of the schedule. A row is matched by its
 * payment number when that column is mapped, otherwise by the month of its
 * date. Rows without interest (an opening-balance or totals line) are left
 * out, with the reason. Principal comes from its column, or the payment
 * minus interest.
 */
export function readBankTable(
  cells: readonly (readonly string[])[],
  mapping: BankMapping,
  options: BankTableOptions,
  schedule: readonly { payment: number; dueDate: ISODate }[],
): BankTableResult {
  const rows: BankRow[] = [];
  const skipped: BankTableResult['skipped'] = [];
  const byMonth = new Map(schedule.map((r) => [r.dueDate.slice(0, 7), r.payment]));
  const seen = new Set<number>();
  const cell = (row: readonly string[], field: BankColumn) => (mapping[field] === undefined ? '' : (row[mapping[field]!] ?? ''));
  const amount = (row: readonly string[], field: BankColumn) => parseAmountText(cell(row, field), options.numberFormat);

  cells.forEach((row, i) => {
    if (options.header && i === 0) return;
    const line = i + 1;
    const skip = (reason: string) => skipped.push({ line, reason });
    const date = mapping.date === undefined ? null : parseDateText(cell(row, 'date'), options.dateFormat);
    let payment: number | null = null;
    if (mapping.number !== undefined) {
      const n = Number(cell(row, 'number').replace(/[^\d]/g, ''));
      payment = Number.isInteger(n) && n >= 1 ? n : null;
    } else if (date) payment = byMonth.get(date.slice(0, 7)) ?? null;
    const interest = amount(row, 'interest');
    if (interest === null) return skip('No interest amount');
    if (payment === null) return skip(mapping.number !== undefined ? 'No payment number' : date ? 'Its date is not on the schedule' : 'No date');
    const paymentAmount = amount(row, 'payment');
    const principal = amount(row, 'principal') ?? (paymentAmount !== null ? paymentAmount - interest : null);
    if (principal === null) return skip('No principal or payment amount');
    if (interest < 0 || principal < 0) return skip('Negative interest or principal');
    if (seen.has(payment)) return skip(`Payment ${payment} appears twice`);
    seen.add(payment);
    rows.push({ payment, dueDate: date, paymentAmount, principal, interest, balance: amount(row, 'balance') });
  });
  return { rows: rows.sort((a, b) => a.payment - b.payment), skipped };
}
