/**
 * Stand-alone preview of the loan screens with an in-memory mock backend and
 * made-up sample data. Built to dist/ui/preview.html; no Actual needed.
 * Useful for design review and for anyone evaluating the components.
 *
 *   ?theme=dark   Actual's dark theme
 *   ?empty        first run, no loans yet
 *   ?privacy      privacy mode
 *   ?loan=2       open the car loan (1 mortgage, 2 car, 3 personal)
 */
import {
  addDays,
  analyzeEquity,
  compareToSchedule,
  escrowReport,
  generateSchedule,
  lockRow,
  periodBreakouts,
  resolutionToAdjustment,
  summarize,
  type Adjustment,
  type EscrowEntry,
  type LoanSetup,
  type LockedPayment,
} from '../engine/index.js';
import type { AssetRecord, LoanDetails, LoanRecord } from '../server/db.js';
import type { MonthView, StateView } from '../server/service.js';
import { ApiError, type Candidate, type CategoryGroup, type LoanClient, type LoanListItem, type TrackerClient } from './api.js';
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
  fees: [{ label: 'Processing fee', amount: 29_900, financed: false }],
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
  fees: [],
  yearlyFee: { basis: 'balance', percent: 0.5 },
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
  escrow: EscrowEntry[];
  details: LoanDetails;
}

const SEEDS: Seed[] = [
  {
    loan: { id: 1, nickname: 'Mortgage', type: 'mortgage', createdAt: '', archived: false },
    setup: MORTGAGE,
    asset: {
      name: 'Home', kind: 'home', originalValue: 35_500_000, valueTrend: 'manual', trendRatePercent: null, acquiredDate: '2025-02-14',
      values: [{ id: 1, date: '2025-09-01', value: 36_800_000, source: 'Online estimate' }],
    },
    categoryId: 'cat-mortgage',
    paid: 4,
    extraOn: 5,
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
      values: [{ id: 2, date: '2025-09-15', value: 3_250_000, source: 'Pricing guide' }],
    },
    categoryId: 'cat-car',
    paid: 6,
    extraOn: null,
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
    escrow: [],
    details: { fields: { servicerName: 'Sample Credit Union' }, custom: [] },
  },
];

const CATEGORIES: CategoryGroup[] = [
  { id: 'g1', name: 'Housing', categories: [{ id: 'cat-mortgage', name: 'Mortgage' }, { id: 'cat-util', name: 'Utilities' }] },
  { id: 'g2', name: 'Transportation', categories: [{ id: 'cat-car', name: 'Car payment' }] },
  { id: 'g3', name: 'Debt', categories: [{ id: 'cat-loans', name: 'Loan payments' }] },
];

// --- mock backend ---------------------------------------------------------------------

interface Month {
  status: 'flagged' | 'paid';
  txn: Candidate;
  locked: LockedPayment | null;
  resolution: string | null;
}

const later = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 150));
let nextId = 100;

/** One loan held in memory, answering like the real backend. */
class MockLoan {
  loan: LoanRecord;
  setup: LoanSetup | null;
  asset: AssetRecord | null;
  categoryId: string | null;
  adjustments: { adj: Adjustment; source: number | null }[] = [];
  months = new Map<number, Month>();
  txns: Candidate[] = [];
  escrow: EscrowEntry[];
  details: LoanDetails;

  constructor(seed: Seed | { loan: LoanRecord; setup: LoanSetup; asset: Omit<AssetRecord, 'id' | 'loanId'> | null }) {
    this.loan = seed.loan;
    this.setup = seed.setup;
    this.asset = seed.asset ? { ...seed.asset, id: nextId++, loanId: seed.loan.id } : null;
    this.categoryId = 'categoryId' in seed ? seed.categoryId : null;
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
        paid: 0, matchesSchedule: false, difference: 0, usedByPayment: null,
      });
    }
    for (let k = 1; k <= seed.paid; k++) {
      const txn = this.txns[k - 1]!;
      const row = this.build([k, txn.date]).rows[k - 1]!;
      this.months.set(k, { status: 'paid', txn, locked: lockRow(row), resolution: null });
    }
  }

  build(paidOn?: [number, string]) {
    const locked = new Map([...this.months].filter(([, m]) => m.locked).map(([k, m]) => [k, m.locked!]));
    const paidDates = new Map([...this.months].map(([k, m]) => [k, m.txn.date]));
    if (paidOn) paidDates.set(paidOn[0], paidOn[1]);
    return generateSchedule(this.setup!, { adjustments: this.adjustments.map((a) => a.adj), locked, paidDates });
  }

  state(): StateView {
    const base = {
      loan: this.loan, asset: this.asset, setup: this.setup, settings: { categoryId: this.categoryId },
      source: { connected: true, lastSync: null, error: null }, today: TODAY, details: this.details,
      adjustments: this.adjustments.map((a, i) => ({ id: i + 1, adjustment: a.adj, sourcePayment: a.source, createdAt: '' })),
    };
    if (!this.setup) return { ...base, schedule: null, summary: null, analysis: null };
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
    const asset = this.asset;
    return {
      ...base,
      schedule: { piPayment: s.piPayment, calculatedPiPayment: s.calculatedPiPayment, totals: s.totals, pmi: s.pmi, rows,
        currentPayment: rows.find((r) => r.status === 'scheduled' || r.status === 'flagged')?.payment ?? null },
      summary: summarize(this.setup, s, paid, TODAY, asset),
      analysis: {
        equity: asset ? analyzeEquity(this.setup, s, paid, TODAY, asset) : null,
        periods: { paid: periodBreakouts(s.rows, paidOn, TODAY, 'paid'), scheduled: periodBreakouts(s.rows, paidOn, TODAY, 'scheduled') },
        escrow: escrowReport(s.rows, paidOn, this.escrow, TODAY),
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
      async saveSettings(id) { self.categoryId = id; return later({ categoryId: id }); },
      categories: () => later(CATEGORIES),
      async candidates(n) {
        const row = self.build().rows[n - 1]!;
        const used = new Map([...self.months].map(([k, m]) => [m.txn.id, k]));
        return later(self.txns
          .filter((t) => Math.abs(Date.parse(t.date) - Date.parse(row.dueDate)) < 25 * 864e5)
          .map((t) => { const c = compareToSchedule(row, t.amount); const u = used.get(t.id);
            return { ...t, paid: c.actual, matchesSchedule: c.matches, difference: c.difference, usedByPayment: u && u !== n ? u : null }; }));
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
      async clearCatchUpPlan(n) {
        const covering = self.coveringPlan(n);
        if (covering) self.adjustments.splice(self.adjustments.indexOf(covering), 1);
        return state();
      },
      async saveAsset(a) {
        self.asset = { ...a, id: self.asset?.id ?? nextId++, loanId: self.loan.id, values: self.asset?.values ?? [] };
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
      const m = new MockLoan({ loan, setup, asset: home ? { ...home, values: [] } : null });
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
