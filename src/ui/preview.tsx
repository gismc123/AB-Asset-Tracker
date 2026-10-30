/**
 * Stand-alone preview of the loan screens with an in-memory mock backend and
 * made-up sample data. Built to dist/ui/preview.html; no Actual needed.
 * Useful for design review and for anyone evaluating the components.
 *
 *   ?theme=dark   Actual's dark theme
 *   ?empty        first run, no loans yet
 *   ?privacy      privacy mode
 *   ?loan=2       open the car loan (1 mortgage, 2 car, 3 personal, 4 student)
 */
import {
  addDays,
  analyzeEquity,
  compareToSchedule,
  effectiveRate,
  escrowReport,
  generateSchedule,
  lockRow,
  periodBreakouts,
  resolutionToAdjustment,
  standingExtraAt,
  checkBalance,
  summarize,
  whatIf,
  withAccountValue,
  type AccountReading,
  type Adjustment,
  type EscrowEntry,
  type LoanSetup,
  type LockedPayment,
} from '../engine/index.js';
import type { AssetRecord, LoanDetails, LoanRecord, StoredBankRow, StoredExtraPayment } from '../server/db.js';
import type { MonthView, StateView } from '../server/service.js';
import { ApiError, type BudgetAccount, type Candidate, type CategoryGroup, type LoanClient, type LoanListItem, type TrackerClient } from './api.js';
import { mountTrackerApp } from './mount.js';
import { mountSidebarLoans } from './sidebar.js';

const TODAY = '2025-10-12';

// --- made-up sample loans ----------------------------------------------------------

const MORTGAGE: LoanSetup = {
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
  modules: { pmi: true, escrow: true },
  downPayment: 3_550_000,
};

const CAR: LoanSetup = {
  originalAmount: 3_000_000,
  annualRatePercent: 6.9,
  termYears: 5,
  termMonths: 60,
  openDate: '2025-03-10',
  firstPaymentDate: '2025-04-10',
  paymentDay: 10,
  piPaymentOverride: null,
  originalHomeValue: 0,
  pmiMonthly: 0,
  pmiStartDate: null,
  pmiRemovalRule: 'auto78Scheduled',
  escrowMonthly: 0,
  extraPrincipal: 0,
  modules: { pmi: false, escrow: false },
  interestMethod: 'daily',
  downPayment: 600_000,
  fees: [
    { label: 'Processing fee', amount: 29_900, financed: false },
    { label: 'Late charge', amount: 2_500, financed: false, date: '2025-06-14' },
  ],
};

const PERSONAL: LoanSetup = {
  ...CAR,
  originalAmount: 1_200_000,
  annualRatePercent: 11.5,
  termYears: 3,
  termMonths: 36,
  openDate: '2025-01-20',
  firstPaymentDate: '2025-02-20',
  paymentDay: 20,
  interestMethod: 'monthly',
  downPayment: null,
  fees: [{ label: 'Credit insurance', amount: 18_000, financed: false, date: '2025-07-25', addedToBalance: true }],
  yearlyFee: { basis: 'balance', percent: 0.5, collect: 'separately' },
};

const STUDENT: LoanSetup = {
  ...CAR,
  originalAmount: 2_700_000,
  annualRatePercent: 5.5,
  termYears: 10,
  termMonths: 120,
  openDate: '2024-11-15',
  firstPaymentDate: '2024-12-15',
  paymentDay: 15,
  interestMethod: 'daily',
  downPayment: null,
  fees: [],
};

interface Seed {
  loan: LoanRecord;
  setup: LoanSetup;
  asset: Omit<AssetRecord, 'id' | 'loanId'> | null;
  categoryId: string;
  /** Payments already reconciled. */
  paid: number;
  /** Payment whose bank amount includes $250 of extra principal (left unreconciled). */
  extraOn: number | null;
  /** Extra principal paid in transactions of their own, already recorded: [date, amount]. */
  extras: [string, number][];
  /** A payment of its own in the bank, not recorded yet, to try adding: [date, amount]. */
  spareExtra: [string, number] | null;
  /** Payments whose interest comes from a made-up lender's table (a few cents off the calculation): [first, last]. */
  bankTable?: [number, number];
  /** An account in the mock budget that tracks the loan's balance, for the cross-check. */
  balanceAccountId?: string;
  escrow: EscrowEntry[];
  details: LoanDetails;
}

const SEEDS: Seed[] = [
  {
    loan: { id: 1, nickname: 'Mortgage', type: 'mortgage', createdAt: '', archived: false },
    setup: MORTGAGE,
    asset: {
      name: 'Home', kind: 'home', originalValue: 35_500_000, valueTrend: 'manual', trendRatePercent: null, acquiredDate: '2025-02-14', actualAccountId: null,
      values: [{ id: 1, date: '2025-09-01', value: 36_800_000, source: 'Online estimate' }],
    },
    categoryId: 'cat-mortgage',
    paid: 4,
    extraOn: 5,
    extras: [['2025-06-18', 100_000]],
    spareExtra: ['2025-08-08', 50_000],
    balanceAccountId: 'acct-mortgage',
    escrow: [
      { id: 1, date: '2025-02-14', kind: 'deposit', amount: 164_000, note: 'Initial deposit at closing' },
      { id: 2, date: '2025-06-20', kind: 'homeownersInsurance', amount: 216_000, note: 'Annual premium' },
    ],
    details: { fields: { servicerName: 'Sample Home Loans', loanNumber: '0000123456', loanType: 'Conventional' }, custom: [] },
  },
  {
    loan: { id: 2, nickname: 'Hatchback', type: 'auto', createdAt: '', archived: false },
    setup: CAR,
    asset: {
      name: 'Sample hatchback', kind: 'vehicle', originalValue: 3_600_000, valueTrend: 'depreciating', trendRatePercent: 15, acquiredDate: '2025-03-10',
      actualAccountId: 'acct-car-value',
      values: [{ id: 2, date: '2025-09-15', value: 3_250_000, source: 'Pricing guide' }],
    },
    categoryId: 'cat-car',
    paid: 6,
    extraOn: null,
    extras: [['2025-07-22', 75_000]],
    spareExtra: null,
    escrow: [],
    details: { fields: { servicerName: 'Sample Auto Finance', licensePlate: 'SAMPLE 1' }, custom: [] },
  },
  {
    loan: { id: 3, nickname: 'Kitchen loan', type: 'personal', createdAt: '', archived: false },
    setup: PERSONAL,
    asset: null,
    categoryId: 'cat-loans',
    paid: 8,
    extraOn: null,
    extras: [],
    spareExtra: null,
    bankTable: [9, 14],
    escrow: [],
    details: { fields: { servicerName: 'Sample Credit Union' }, custom: [] },
  },
];

SEEDS.push({
  loan: { id: 4, nickname: 'Student loan', type: 'student', createdAt: '', archived: false },
  setup: STUDENT,
  asset: null,
  categoryId: 'cat-loans',
  paid: 10,
  extraOn: null,
  extras: [['2025-06-02', 50_000]],
  spareExtra: null,
  details: { fields: { servicerName: 'Sample Student Loan Servicing' }, custom: [] },
  escrow: [],
});

const CATEGORIES: CategoryGroup[] = [
  { id: 'g1', name: 'Housing', categories: [{ id: 'cat-mortgage', name: 'Mortgage' }, { id: 'cat-util', name: 'Utilities' }] },
  { id: 'g2', name: 'Transportation', categories: [{ id: 'cat-car', name: 'Car payment' }] },
  { id: 'g3', name: 'Debt', categories: [{ id: 'cat-loans', name: 'Loan payments' }] },
];

/** Made-up accounts in the mock budget, with their balances in cents. */
const ACCOUNTS: (BudgetAccount & { balance: number })[] = [
  { id: 'acct-checking', name: 'Checking', offBudget: false, closed: false, balance: 412_300 },
  { id: 'acct-home-value', name: 'Home value', offBudget: true, closed: false, balance: 36_900_000 },
  { id: 'acct-car-value', name: 'Hatchback value', offBudget: true, closed: false, balance: 3_190_000 },
  { id: 'acct-mortgage', name: 'Mortgage balance', offBudget: true, closed: false, balance: -31_782_800 },
];

function reading(id: string | null): AccountReading | null {
  const a = ACCOUNTS.find((x) => x.id === id);
  if (!id) return null;
  return a ? { id, name: a.name, balance: a.balance, asOf: TODAY, error: null } : { id, name: null, balance: null, asOf: null, error: "That account isn't in the budget any more" };
}

// --- mock backend ---------------------------------------------------------------------

interface Month {
  status: 'flagged' | 'paid';
  txn: Candidate;
  locked: LockedPayment | null;
  resolution: string | null;
}

const isPmiRemoval = (a: { adj: Adjustment; source: number | null }) => a.source === null && a.adj.kind === 'pmi' && a.adj.amount === 0;
const later = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 150));
let nextId = 100;

/** One loan held in memory, answering like the real backend. */
class MockLoan {
  loan: LoanRecord;
  setup: LoanSetup | null;
  asset: AssetRecord | null;
  categoryId: string | null;
  balanceAccountId: string | null = null;
  adjustments: { adj: Adjustment; source: number | null }[] = [];
  months = new Map<number, Month>();
  txns: Candidate[] = [];
  escrow: EscrowEntry[];
  details: LoanDetails;
  extras: StoredExtraPayment[] = [];
  bank: StoredBankRow[] = [];

  constructor(seed: Seed | { loan: LoanRecord; setup: LoanSetup; asset: Omit<AssetRecord, 'id' | 'loanId'> | null }) {
    this.loan = seed.loan;
    this.setup = seed.setup;
    this.asset = seed.asset ? { ...seed.asset, id: nextId++, loanId: seed.loan.id } : null;
    this.categoryId = 'categoryId' in seed ? seed.categoryId : null;
    this.balanceAccountId = 'balanceAccountId' in seed ? (seed.balanceAccountId ?? null) : null;
    this.escrow = 'escrow' in seed ? [...seed.escrow] : [];
    this.details = 'details' in seed ? seed.details : { fields: {}, custom: [] };
    if (!('paid' in seed)) return;
    // Made-up bank payments, two days before each due date.
    const s = generateSchedule(seed.setup);
    for (let k = 1; k <= seed.paid + 3 && k <= s.rows.length; k++) {
      const r = s.rows[k - 1]!;
      this.txns.push({
        id: `l${seed.loan.id}-t${k}`, date: addDays(r.dueDate, -2), amount: -(r.total + (k === seed.extraOn ? 25_000 : 0)),
        payee: seed.details.fields.servicerName ?? 'Sample Lender', account: 'Checking', notes: null, isSplitPart: false,
        paid: 0, matchesSchedule: false, difference: 0, usedByPayment: null, usedByExtra: null,
      });
    }
    const payee = seed.details.fields.servicerName ?? 'Sample Lender';
    seed.extras.forEach(([date, amount], i) => {
      const id = `l${seed.loan.id}-x${i}`;
      this.txns.push({ id, date, amount: -amount, payee, account: 'Savings', notes: null, isSplitPart: false, paid: 0, matchesSchedule: false, difference: 0, usedByPayment: null, usedByExtra: null });
      this.extras.push({ id: nextId++, date, amount, transactionId: id, transactionPayee: payee, note: '', createdAt: '' });
    });
    if (seed.spareExtra) {
      const [date, amount] = seed.spareExtra;
      this.txns.push({ id: `l${seed.loan.id}-spare`, date, amount: -amount, payee, account: 'Savings', notes: null, isSplitPart: false, paid: 0, matchesSchedule: false, difference: 0, usedByPayment: null, usedByExtra: null });
    }
    for (let k = 1; k <= seed.paid; k++) {
      const txn = this.txns[k - 1]!;
      const row = this.build([k, txn.date]).rows[k - 1]!;
      this.months.set(k, { status: 'paid', txn, locked: lockRow(row), resolution: null });
    }
    if (seed.bankTable) {
      const [from, to] = seed.bankTable;
      let balance: number | null = null;
      this.bank = this.build().rows.slice(from - 1, to).map((r) => {
        balance = (balance ?? r.beginningBalance) - (r.scheduledPrincipal - 3);
        return { payment: r.payment, dueDate: r.dueDate, paymentAmount: r.principalAndInterest, principal: r.scheduledPrincipal - 3, interest: r.interest + 3, balance, importedAt: '' };
      });
    }
  }

  options(paidOn?: [number, string]) {
    const locked = new Map([...this.months].filter(([, m]) => m.locked).map(([k, m]) => [k, m.locked!]));
    const paidDates = new Map([...this.months].map(([k, m]) => [k, m.txn.date]));
    if (paidOn) paidDates.set(paidOn[0], paidOn[1]);
    const extraPayments = this.extras.map((e) => ({ id: e.id, date: e.date, amount: e.amount }));
    const bankRows = new Map(this.bank.map((r) => [r.payment, { principal: r.principal, interest: r.interest }]));
    return { adjustments: this.adjustments.map((a) => a.adj), locked, paidDates, extraPayments, bankRows };
  }

  build(paidOn?: [number, string]) {
    return generateSchedule(this.setup!, this.options(paidOn));
  }

  nextUnpaid() {
    return this.build().rows.find((r) => !r.beforeTracking && !r.skipped && !this.months.has(r.payment))?.payment ?? 1;
  }

  valuedAsset() {
    return this.asset ? withAccountValue(this.asset, reading(this.asset.actualAccountId)).asset : null;
  }

  state(): StateView {
    const linked = this.asset ? withAccountValue(this.asset, reading(this.asset.actualAccountId)) : null;
    const base = {
      loan: this.loan, asset: this.asset, assetValue: linked?.source ?? null, setup: this.setup,
      settings: { categoryId: this.categoryId, balanceAccountId: this.balanceAccountId },
      source: { connected: true, lastSync: null, error: null }, today: TODAY, details: this.details, extraPayments: this.extras, bankSchedule: this.bank,
      adjustments: this.adjustments.map((a, i) => ({ id: i + 1, adjustment: a.adj, sourcePayment: a.source, createdAt: '' })),
    };
    if (!this.setup) return { ...base, balanceCheck: null, schedule: null, summary: null, analysis: null };
    const s = this.build();
    const rows: MonthView[] = s.rows.map((r) => {
      const m = this.months.get(r.payment);
      return {
        ...r,
        status: m?.status ?? (r.beforeTracking ? 'history' : r.skipped ? 'skipped' : 'scheduled'),
        match: m
          ? { transactionId: m.txn.id, transactionDate: m.txn.date, transactionAmount: -m.txn.amount, transactionPayee: m.txn.payee,
              difference: -m.txn.amount - r.total, resolution: (m.resolution as never) ?? null }
          : null,
      };
    });
    const paid = new Set([...this.months].filter(([, m]) => m.status === 'paid').map(([k]) => k));
    const paidOn = new Map([...this.months].filter(([, m]) => m.status === 'paid').map(([k, m]) => [k, m.txn.date]));
    const asset = linked?.asset ?? null;
    const summary = summarize(this.setup, s, paid, TODAY, asset);
    return {
      ...base,
      balanceCheck: this.balanceAccountId ? checkBalance(summary.balance, reading(this.balanceAccountId)!) : null,
      schedule: { piPayment: s.piPayment, calculatedPiPayment: s.calculatedPiPayment, totals: s.totals, pmi: s.pmi, rows,
        currentPayment: rows.find((r) => r.status === 'scheduled' || r.status === 'flagged')?.payment ?? null },
      summary,
      analysis: {
        equity: asset ? analyzeEquity(this.setup, s, paid, TODAY, asset) : null,
        periods: { paid: periodBreakouts(s.rows, paidOn, TODAY, 'paid'), scheduled: periodBreakouts(s.rows, paidOn, TODAY, 'scheduled') },
        escrow: escrowReport(s.rows, paidOn, this.escrow, TODAY),
        effectiveRate: effectiveRate(this.setup),
      },
    };
  }

  listItem(): LoanListItem {
    const st = this.state();
    const sm = st.summary;
    return {
      loan: this.loan, configured: !!this.setup, error: null,
      asset: this.asset ? { id: this.asset.id, name: this.asset.name, kind: this.asset.kind } : null,
      owed: sm?.owed ?? null, equity: sm?.asset?.equity ?? null, assetValue: sm?.asset?.value ?? null,
      nextPayment: sm?.nextPayment ? { payment: sm.nextPayment.payment, dueDate: sm.nextPayment.dueDate, total: sm.nextPayment.total } : null,
    };
  }

  dropAdjustments(test: (a: { adj: Adjustment; source: number | null }) => boolean) {
    for (let i = this.adjustments.length - 1; i >= 0; i--) if (test(this.adjustments[i]!)) this.adjustments.splice(i, 1);
  }

  coveringPlan(n: number) {
    return this.adjustments
      .filter((a) => a.adj.kind === 'catchUpPlan' && a.adj.fromPayment > n)
      .sort((a, b) => (a.adj as { fromPayment: number }).fromPayment - (b.adj as { fromPayment: number }).fromPayment)[0];
  }

  client(): LoanClient {
    const self = this;
    const state = () => later(self.state());
    return {
      loanId: self.loan.id,
      state,
      async saveSetup(next) {
        // The real backend refuses this; the preview just forgets matches made before tracking.
        for (const k of self.months.keys()) if (next.startingPoint && k <= next.startingPoint.payment) self.months.delete(k);
        self.setup = next;
        return state();
      },
      async saveSettings(id) { self.categoryId = id; return later({ categoryId: id, balanceAccountId: self.balanceAccountId }); },
      async setBalanceAccount(categoryId, accountId) {
        self.categoryId = categoryId;
        self.balanceAccountId = accountId;
        return state();
      },
      categories: () => later(CATEGORIES),
      async candidates(n) {
        const row = self.build().rows[n - 1]!;
        const used = new Map([...self.months].map(([k, m]) => [m.txn.id, k]));
        return later(self.txns
          .filter((t) => Math.abs(Date.parse(t.date) - Date.parse(row.dueDate)) < 25 * 864e5)
          .map((t) => { const c = compareToSchedule(row, t.amount); const u = used.get(t.id);
            const x = self.extras.find((e) => e.transactionId === t.id)?.id ?? null;
            return { ...t, paid: c.actual, matchesSchedule: c.matches, difference: c.difference, usedByPayment: u && u !== n ? u : null, usedByExtra: x }; }));
      },
      async match(n, id) {
        const txn = self.txns.find((t) => t.id === id)!;
        const row = self.build([n, txn.date]).rows[n - 1]!;
        const c = compareToSchedule(row, txn.amount);
        self.months.set(n, { status: c.matches ? 'paid' : 'flagged', txn, locked: c.matches ? lockRow(row) : null, resolution: null });
        return later({ status: c.matches ? 'paid' : 'flagged', payment: n, scheduled: c.scheduled, actual: c.actual, difference: c.difference, suggestions: [] });
      },
      async resolve(n, resolution, standing) {
        const m = self.months.get(n)!;
        const row = self.build().rows[n - 1]!;
        try {
          const adj = resolutionToAdjustment(self.setup!, self.adjustments.map((a) => a.adj), row, -m.txn.amount - row.total, resolution, { standing });
          self.adjustments.push({ adj, source: n });
        } catch (e) { throw new ApiError(400, (e as Error).message); }
        self.months.set(n, { ...m, status: 'paid', resolution, locked: lockRow(self.build().rows[n - 1]!) });
        return state();
      },
      async unmatch(n) {
        self.months.delete(n);
        self.dropAdjustments((a) => a.source === n);
        return state();
      },
      async setOffset(n, amount) {
        self.dropAdjustments((a) => a.source === null && a.adj.kind === 'pennyOffset' && a.adj.payment === n);
        if (amount) self.adjustments.push({ adj: { kind: 'pennyOffset', payment: n, amount }, source: null });
        return state();
      },
      async skip(n, mode) {
        if (self.months.has(n)) throw new ApiError(409, `Payment ${n} is already matched to a bank transaction. Undo that first.`);
        self.dropAdjustments((a) => a.adj.kind === 'skip' && a.adj.payment === n);
        self.adjustments.push({ adj: { kind: 'skip', payment: n, mode }, source: null });
        return state();
      },
      async unskip(n) {
        self.dropAdjustments((a) => a.adj.kind === 'skip' && a.adj.payment === n);
        return state();
      },
      async setCatchUpPlan(n, fromPayment, months) {
        if (self.build().rows[n - 1]?.skipped !== 'catchUp') throw new ApiError(409, `Payment ${n} isn't a missed payment to catch up`);
        const covering = self.coveringPlan(n);
        if (covering) self.adjustments.splice(self.adjustments.indexOf(covering), 1);
        self.adjustments.push({ adj: { kind: 'catchUpPlan', fromPayment, months }, source: null });
        return state();
      },
      async addExtraPayment(extra) {
        if ('transactionId' in extra) {
          const t = self.txns.find((x) => x.id === extra.transactionId)!;
          self.extras.push({ id: nextId++, date: t.date, amount: -t.amount, transactionId: t.id, transactionPayee: t.payee, note: '', createdAt: '' });
        } else {
          self.extras.push({ id: nextId++, ...extra, transactionId: null, transactionPayee: null, createdAt: '' });
        }
        self.extras.sort((a, b) => a.date.localeCompare(b.date));
        return state();
      },
      async deleteExtraPayment(id) {
        self.extras = self.extras.filter((e) => e.id !== id);
        return state();
      },
      async previewBankSchedule(rows) {
        const before = self.build();
        const options = self.options();
        for (const r of rows) options.bankRows.set(r.payment, { principal: r.principal, interest: r.interest });
        const after = generateSchedule(self.setup!, options);
        const preview = rows.map((r) => {
          const now = before.rows[r.payment - 1];
          const then = after.rows[r.payment - 1];
          const note = !now ? 'Not on the schedule' : self.months.get(r.payment)?.status === 'paid' ? 'Reconciled: keeps what it paid' : now.skipped ? 'Skipped month' : null;
          const split = (x: typeof now) => (x ? { interest: x.interest, principal: x.scheduledPrincipal, endingBalance: x.endingBalance } : null);
          return { payment: r.payment, dueDate: now?.dueDate ?? r.dueDate, bank: r, now: split(now), then: split(then), applies: note === null, note };
        });
        const last = [...preview].reverse().find((p) => p.applies && p.bank.balance !== null && p.then);
        return later({
          rows: preview, applies: preview.filter((p) => p.applies).length,
          balanceCheck: last ? { payment: last.payment, bank: last.bank.balance!, tracker: last.then!.endingBalance } : null,
          payoffDate: { now: before.rows.at(-1)?.dueDate ?? null, then: after.rows.at(-1)?.dueDate ?? null },
        });
      },
      async saveBankSchedule(rows) {
        const keep = self.bank.filter((b) => !rows.some((r) => r.payment === b.payment));
        self.bank = [...keep, ...rows.map((r) => ({ ...r, importedAt: '' }))].sort((a, b) => a.payment - b.payment);
        return state();
      },
      async deleteBankSchedule(n) {
        self.bank = n === undefined ? [] : self.bank.filter((b) => b.payment !== n);
        return state();
      },
      async whatIf(input) {
        return later(whatIf(self.setup!, self.options(), { ...input, fromPayment: self.nextUnpaid() }, self.valuedAsset()));
      },
      async setStandingExtra(amount) {
        const fromPayment = self.nextUnpaid();
        const now = standingExtraAt(self.setup!, self.adjustments.map((a) => a.adj), fromPayment);
        self.adjustments.push({ adj: { kind: 'standingExtra', fromPayment, amount: now + amount }, source: null });
        return state();
      },
      async deleteStandingExtra(id) {
        self.adjustments.splice(id - 1, 1);
        return state();
      },
      async setPmiRemoval(fromPayment) {
        const paid = [...self.months].find(([k, m]) => m.status === 'paid' && k >= fromPayment);
        if (paid) throw new ApiError(409, `Payment ${paid[0]} is already reconciled with the PMI it paid. Pick a payment after it, or undo that month first.`);
        self.dropAdjustments(isPmiRemoval);
        self.adjustments.push({ adj: { kind: 'pmi', fromPayment, amount: 0 }, source: null });
        return state();
      },
      async clearPmiRemoval() {
        self.dropAdjustments(isPmiRemoval);
        return state();
      },
      async clearCatchUpPlan(n) {
        const covering = self.coveringPlan(n);
        if (covering) self.adjustments.splice(self.adjustments.indexOf(covering), 1);
        return state();
      },
      async saveAsset(a) {
        self.asset = {
          ...a, id: self.asset?.id ?? nextId++, loanId: self.loan.id, values: self.asset?.values ?? [],
          actualAccountId: a.actualAccountId === undefined ? (self.asset?.actualAccountId ?? null) : a.actualAccountId,
        };
        return state();
      },
      accounts: () => later(ACCOUNTS.map(({ balance: _b, ...a }) => a)),
      async setAssetAccount(_assetId, accountId) {
        self.asset = { ...self.asset!, actualAccountId: accountId };
        return state();
      },
      async addAssetValue(_assetId, v) {
        self.asset!.values = [...self.asset!.values, { id: nextId++, ...v }].sort((a, b) => a.date.localeCompare(b.date));
        return state();
      },
      async deleteAssetValue(_assetId, id) {
        self.asset!.values = self.asset!.values.filter((v) => v.id !== id);
        return state();
      },
      async addEscrowEntry(e) { self.escrow.push({ id: nextId++, ...e }); return state(); },
      async deleteEscrowEntry(id) { self.escrow.splice(self.escrow.findIndex((e) => e.id === id), 1); return state(); },
      async saveDetails(d) { self.details = d; return state(); },
    };
  }
}

function mockClient(empty: boolean): TrackerClient {
  const loans = empty ? [] : SEEDS.map((s) => new MockLoan(s));
  const find = (id: number) => {
    const l = loans.find((x) => x.loan.id === id);
    if (!l) throw new ApiError(404, `There is no loan ${id}`);
    return l;
  };
  return {
    loans: () => later(loans.map((l) => l.listItem()).sort((a, b) => Number(a.loan.archived) - Number(b.loan.archived))),
    async createLoan({ nickname, type, setup, asset }) {
      const loan: LoanRecord = { id: Math.max(0, ...loans.map((l) => l.loan.id)) + 1, nickname, type, createdAt: '', archived: false };
      const home = type === 'mortgage' && !asset
        ? { name: 'Home', kind: 'home' as const, originalValue: setup.originalHomeValue, valueTrend: 'manual' as const, trendRatePercent: null, acquiredDate: setup.openDate }
        : asset;
      const m = new MockLoan({ loan, setup, asset: home ? { ...home, actualAccountId: home.actualAccountId ?? null, values: [] } : null });
      loans.push(m);
      return later({ loan, state: m.state() });
    },
    async updateLoan(id, patch) {
      const l = find(id);
      l.loan = { ...l.loan, ...patch };
      return later(l.loan);
    },
    async deleteLoan(id) {
      loans.splice(loans.indexOf(find(id)), 1);
      await later(null);
    },
    loan: (id) => find(id).client(),
    backup: () => {
      const tables = {
        loans: loans.map(({ loan: l }) => ({ id: l.id, nickname: l.nickname, type: l.type, created_at: l.createdAt, archived: Number(l.archived) })),
        assets: loans.flatMap((l) => (l.asset ? [{ id: l.loan.id, loan_id: l.loan.id, name: l.asset.name }] : [])),
      };
      const counts = { loans: tables.loans.length, assets: tables.assets.length };
      return later({ format: 'ab-asset-tracker-backup' as const, formatVersion: 1, schemaVersion: 2, exportedAt: new Date().toISOString(), counts, tables });
    },
    restore: () => Promise.reject(new ApiError(0, 'The preview has no server to restore into.')),
  };
}

// --- page --------------------------------------------------------------------------------

const params = new URLSearchParams(location.search);
if (params.get('theme') === 'dark') document.documentElement.classList.add('dark');
const client = mockClient(params.has('empty'));
const privacy = params.has('privacy');
const initial = Number(params.get('loan')) || null;

const sidebarHost = document.getElementById('loans-list')!;
const app = mountTrackerApp(document.getElementById('app')!, {
  client,
  initialLoan: initial,
  onChange: () => sidebar.refresh(),
  onSelect: (id) => sidebar.setCurrent(id),
});
const sidebar = mountSidebarLoans(sidebarHost, client, (id) => app.selectLoan(id));
app.setPrivacy(privacy);
sidebar.setPrivacy(privacy);
