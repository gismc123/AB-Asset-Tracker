/**
 * Stand-alone preview of the Mortgage screens with an in-memory mock backend
 * and made-up sample data. Built to dist/ui/preview.html; no Actual needed.
 * Useful for design review and for anyone evaluating the components.
 */
import {
  addDays,
  compareToSchedule,
  generateSchedule,
  lockRow,
  resolutionToAdjustment,
  summarize,
  type Adjustment,
  type LoanSetup,
  type LockedPayment,
} from '../engine/index.js';
import type { MonthView, StateView } from '../server/service.js';
import { ApiError, type Candidate, type MortgageClient } from './api.js';
import { mountMortgageApp } from './mount.js';

const TODAY = '2025-10-12';
const SAMPLE: LoanSetup = {
  originalAmount: 32_000_000,
  annualRatePercent: 6.5,
  termYears: 30,
  openDate: '2025-02-14',
  firstPaymentDate: '2025-04-01',
  paymentDay: 1,
  piPaymentOverride: null,
  originalHomeValue: 35_500_000,
  pmiMonthly: 14_800,
  pmiStartDate: null,
  pmiRemovalRule: 'auto78Scheduled',
  escrowMonthly: 41_250,
  extraPrincipal: 0,
};

interface Month {
  status: 'flagged' | 'paid';
  txn: Candidate;
  locked: LockedPayment | null;
  resolution: StateView['adjustments'][number]['adjustment']['kind'] | string | null;
}

function mockClient(empty: boolean): MortgageClient {
  let setup: LoanSetup | null = empty ? null : SAMPLE;
  let categoryId: string | null = empty ? null : 'cat-mortgage';
  const adjustments: { adj: Adjustment; source: number | null }[] = [];
  const months = new Map<number, Month>();
  const txns: Candidate[] = [];

  const build = () => {
    const locked = new Map([...months].filter(([, m]) => m.locked).map(([k, m]) => [k, m.locked!]));
    return generateSchedule(setup!, { adjustments: adjustments.map((a) => a.adj), locked });
  };

  // Seed six made-up bank payments; month 5 includes $250 extra principal.
  if (!empty) {
    const s = generateSchedule(SAMPLE);
    for (let k = 1; k <= 7; k++) {
      const r = s.rows[k - 1]!;
      txns.push({
        id: `t${k}`, date: addDays(r.dueDate, -2), amount: -(r.total + (k === 5 ? 25_000 : 0)), payee: 'Sample Home Loans',
        account: 'Checking', notes: null, isSplitPart: false, paid: 0, matchesSchedule: false, difference: 0, usedByPayment: null,
      });
    }
    for (let k = 1; k <= 4; k++) {
      months.set(k, { status: 'paid', txn: txns[k - 1]!, locked: lockRow(s.rows[k - 1]!), resolution: null });
    }
  }

  const state = (): StateView => {
    const base = { setup, settings: { categoryId }, source: { connected: true, lastSync: null, error: null }, today: TODAY, adjustments: [] };
    if (!setup) return { ...base, schedule: null, summary: null };
    const s = build();
    const rows: MonthView[] = s.rows.map((r) => {
      const m = months.get(r.payment);
      return {
        ...r,
        status: m?.status ?? 'scheduled',
        match: m
          ? { transactionId: m.txn.id, transactionDate: m.txn.date, transactionAmount: -m.txn.amount, transactionPayee: m.txn.payee,
              difference: -m.txn.amount - r.total, resolution: (m.resolution as never) ?? null }
          : null,
      };
    });
    const paid = new Set([...months].filter(([, m]) => m.status === 'paid').map(([k]) => k));
    return {
      ...base,
      schedule: { piPayment: s.piPayment, calculatedPiPayment: s.calculatedPiPayment, totals: s.totals, pmi: s.pmi, rows,
        currentPayment: rows.find((r) => r.status !== 'paid')?.payment ?? null },
      summary: summarize(setup, s, paid, TODAY),
    };
  };

  const later = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 150));
  return {
    state: () => later(state()),
    async saveSetup(next) { setup = next; return later(state()); },
    async saveSettings(id) { categoryId = id; return later({ categoryId }); },
    categories: () => later([{ id: 'g', name: 'Housing', categories: [{ id: 'cat-mortgage', name: 'Mortgage' }, { id: 'cat-util', name: 'Utilities' }] }]),
    async candidates(n) {
      const row = build().rows[n - 1]!;
      const used = new Map([...months].map(([k, m]) => [m.txn.id, k]));
      return later(txns
        .filter((t) => Math.abs(Date.parse(t.date) - Date.parse(row.dueDate)) < 25 * 864e5)
        .map((t) => { const c = compareToSchedule(row, t.amount); const u = used.get(t.id);
          return { ...t, paid: c.actual, matchesSchedule: c.matches, difference: c.difference, usedByPayment: u && u !== n ? u : null }; }));
    },
    async match(n, id) {
      const row = build().rows[n - 1]!;
      const txn = txns.find((t) => t.id === id)!;
      const c = compareToSchedule(row, txn.amount);
      months.set(n, { status: c.matches ? 'paid' : 'flagged', txn, locked: c.matches ? lockRow(row) : null, resolution: null });
      return later({ status: c.matches ? 'paid' : 'flagged', payment: n, scheduled: c.scheduled, actual: c.actual, difference: c.difference, suggestions: [] });
    },
    async resolve(n, resolution, standing) {
      const m = months.get(n)!;
      const row = build().rows[n - 1]!;
      try {
        const adj = resolutionToAdjustment(setup!, adjustments.map((a) => a.adj), row, -m.txn.amount - row.total, resolution, { standing });
        adjustments.push({ adj, source: n });
      } catch (e) { throw new ApiError(400, (e as Error).message); }
      months.set(n, { ...m, status: 'paid', resolution, locked: lockRow(build().rows[n - 1]!) });
      return later(state());
    },
    async unmatch(n) {
      months.delete(n);
      for (let i = adjustments.length - 1; i >= 0; i--) if (adjustments[i]!.source === n) adjustments.splice(i, 1);
      return later(state());
    },
    async setOffset(n, amount) {
      for (let i = adjustments.length - 1; i >= 0; i--) { const a = adjustments[i]!; if (a.source === null && a.adj.kind === 'pennyOffset' && a.adj.payment === n) adjustments.splice(i, 1); }
      if (amount) adjustments.push({ adj: { kind: 'pennyOffset', payment: n, amount }, source: null });
      return later(state());
    },
  };
}

const params = new URLSearchParams(location.search);
if (params.get('theme') === 'dark') document.documentElement.classList.add('dark');
const host = document.getElementById('app')!;
mountMortgageApp(host, mockClient(params.has('empty')));
