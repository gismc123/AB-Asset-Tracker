import { addDays } from './dates.js';
import type { Cents, ISODate, ScheduleRow } from './types.js';

/**
 * The escrow account the servicer keeps for you. Money comes in with each
 * mortgage payment (the escrow part) and goes out when the servicer pays
 * your property tax and insurance bills. Your bank never sees those bills,
 * so you enter them from the servicer's statements or escrow analysis.
 */
export type EscrowKind =
  | 'propertyTax'
  | 'homeownersInsurance'
  | 'floodInsurance'
  | 'hoa'
  | 'otherDisbursement'
  | 'refund'
  | 'deposit';

/** `label` names a ledger line; `option` describes the kind in a picker. */
export const ESCROW_KINDS: { kind: EscrowKind; label: string; option?: string; direction: 1 | -1 }[] = [
  { kind: 'propertyTax', label: 'Property tax', direction: -1 },
  { kind: 'homeownersInsurance', label: 'Homeowners insurance', direction: -1 },
  { kind: 'floodInsurance', label: 'Flood insurance', direction: -1 },
  { kind: 'hoa', label: 'HOA dues', direction: -1 },
  { kind: 'otherDisbursement', label: 'Other bill', option: 'Other bill paid from escrow', direction: -1 },
  { kind: 'refund', label: 'Surplus refund', option: 'Surplus refund to you', direction: -1 },
  { kind: 'deposit', label: 'Deposit', option: 'Deposit (at closing, or a shortage payment)', direction: 1 },
];

export const isEscrowKind = (k: unknown): k is EscrowKind => ESCROW_KINDS.some((e) => e.kind === k);
const kindInfo = (k: EscrowKind) => ESCROW_KINDS.find((e) => e.kind === k)!;

export interface EscrowEntry {
  id: number;
  date: ISODate;
  kind: EscrowKind;
  /** Always positive; the kind says which way it moves. */
  amount: Cents;
  note: string;
}

export interface EscrowLine {
  date: ISODate;
  kind: EscrowKind | 'payment';
  label: string;
  note: string;
  /** Signed: positive into escrow, negative out. */
  amount: Cents;
  balance: Cents;
  payment: number | null;
  entryId: number | null;
}

export interface EscrowYear {
  year: string;
  /** Escrow collected with mortgage payments. */
  collected: Cents;
  /** Other money put in (closing deposit, shortage payments). */
  deposited: Cents;
  /** Paid out, by kind (refunds included). */
  paidOut: Partial<Record<EscrowKind, Cents>>;
  paidOutTotal: Cents;
  endBalance: Cents;
}

export interface EscrowReport {
  /** Oldest first. */
  lines: EscrowLine[];
  balance: Cents;
  years: EscrowYear[];
  /** Escrow part of the next payment due. */
  monthly: Cents;
  /** What the servicer collects in a year at the current monthly amount. */
  annualCollection: Cents;
  /** Bills paid from escrow in the last 12 months (refunds excluded). */
  billsLast12: Cents;
  /** annualCollection - billsLast12; negative points to a coming escrow increase. */
  cushion: Cents;
}

/**
 * Build the escrow ledger from reconciled payments (dated by when the bank
 * paid) and the entries you've recorded.
 */
export function escrowReport(
  rows: readonly ScheduleRow[],
  paidOn: ReadonlyMap<number, ISODate>,
  entries: readonly EscrowEntry[],
  today: ISODate,
): EscrowReport {
  const raw: Omit<EscrowLine, 'balance'>[] = [];
  for (const r of rows) {
    const when = paidOn.get(r.payment);
    if (!when || r.skipped || r.escrow <= 0) continue;
    raw.push({ date: when, kind: 'payment', label: `Payment #${r.payment}`, note: '', amount: r.escrow, payment: r.payment, entryId: null });
  }
  for (const e of entries) {
    const info = kindInfo(e.kind);
    raw.push({ date: e.date, kind: e.kind, label: info.label, note: e.note, amount: info.direction * e.amount, payment: null, entryId: e.id });
  }
  // Same day: money in before money out, so the running balance doesn't dip falsely.
  raw.sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount);

  let balance = 0;
  const lines: EscrowLine[] = raw.map((l) => ({ ...l, balance: (balance += l.amount) }));

  const years = new Map<string, EscrowYear>();
  for (const l of lines) {
    const year = l.date.slice(0, 4);
    const y = years.get(year) ?? { year, collected: 0, deposited: 0, paidOut: {}, paidOutTotal: 0, endBalance: 0 };
    if (l.kind === 'payment') y.collected += l.amount;
    else if (l.amount > 0) y.deposited += l.amount;
    else {
      y.paidOut[l.kind] = (y.paidOut[l.kind] ?? 0) - l.amount;
      y.paidOutTotal -= l.amount;
    }
    y.endBalance = l.balance;
    years.set(year, y);
  }

  const next = rows.find((r) => !paidOn.has(r.payment) && !r.skipped) ?? rows.at(-1);
  const monthly = next?.escrow ?? 0;
  const yearAgo = addDays(today, -365);
  const billsLast12 = lines
    .filter((l) => l.amount < 0 && l.kind !== 'refund' && l.date > yearAgo && l.date <= today)
    .reduce((s, l) => s - l.amount, 0);

  return {
    lines,
    balance,
    years: [...years.values()],
    monthly,
    annualCollection: monthly * 12,
    billsLast12,
    cushion: monthly * 12 - billsLast12,
  };
}
