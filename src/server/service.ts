import {
  addDays,
  analyzeEquity,
  compareToSchedule,
  escrowReport,
  isEscrowKind,
  isValidISODate,
  periodBreakouts,
  generateSchedule,
  homeAssetFor,
  modulesOf,
  ASSET_KINDS,
  VALUE_TRENDS,
  MAX_TERM_MONTHS,
  lockRow,
  MAX_PENNY_OFFSET,
  PMI_REMOVAL_RULES,
  resolutionToAdjustment,
  ResolutionError,
  SetupError,
  summarize,
  validateSetup,
  type Asset,
  type AssetKind,
  type InterestMethod,
  type LoanModules,
  type OneOffFee,
  type PayoffQuote,
  type ValueTrend,
  type YearlyFee,
  type Cents,
  type EquityAnalysis,
  type EscrowReport,
  type ISODate,
  type LoanSetup,
  type LockedPayment,
  type LoanSummary,
  type PeriodBreakouts,
  type PmiInfo,
  type PmiRemovalRule,
  type Resolution,
  type Schedule,
  type ScheduleRow,
  type SkipMode,
  type StartingPoint,
} from '../engine/index.js';
import type { BudgetSource, BudgetTransaction, CategoryGroup, SourceStatus } from './actual.js';
import { BackupError, exportBackup, restoreBackup, type Backup, type RestoreResult } from './backup.js';
import {
  LOAN_DETAIL_FIELDS,
  LOAN_TYPES,
  type AssetInput,
  type AssetRecord,
  type LoanDetails,
  type LoanRecord,
  type LoanStore,
  type LoanType,
  type MonthRecord,
  type Settings,
  type Store,
  type StoredAdjustment,
} from './db.js';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

/** `history`: made before tracking began, so never reconciled. */
export type RowStatus = 'scheduled' | 'flagged' | 'paid' | 'skipped' | 'history';

export interface MonthView extends ScheduleRow {
  status: RowStatus;
  match: Pick<MonthRecord, 'transactionId' | 'transactionDate' | 'transactionAmount' | 'transactionPayee' | 'difference' | 'resolution'> | null;
}

export interface StateView {
  loan: LoanRecord;
  /** What the loan paid for, if recorded. Equity is measured against it. */
  asset: AssetRecord | null;
  setup: LoanSetup | null;
  settings: Settings;
  source: SourceStatus;
  today: ISODate;
  schedule: {
    piPayment: Cents;
    calculatedPiPayment: Cents;
    totals: Schedule['totals'];
    pmi: PmiInfo;
    rows: MonthView[];
    /** The month to open by default: the first one not yet paid. */
    currentPayment: number | null;
  } | null;
  summary: LoanSummary | null;
  adjustments: StoredAdjustment[];
  details: LoanDetails;
  analysis: {
    /** Null when the loan has no asset. */
    equity: EquityAnalysis | null;
    periods: Record<'paid' | 'scheduled', PeriodBreakouts>;
    escrow: EscrowReport;
  } | null;
}

export interface Candidate extends BudgetTransaction {
  /** Positive cents that left the account. */
  paid: Cents;
  matchesSchedule: boolean;
  difference: Cents;
  /** Another month already matched to this transaction. */
  usedByPayment: number | null;
}

export interface MatchResult {
  status: RowStatus;
  payment: number;
  scheduled: Cents;
  actual: Cents;
  difference: Cents;
  /** For a flagged month: the likeliest explanations first. */
  suggestions: Resolution[];
}

/** How far around the due date to look for the payment. */
const WINDOW_BEFORE = 25;
const WINDOW_AFTER = 20;
const WIDE_WINDOW = 60;

const SKIP_MODES: SkipMode[] = ['catchUp', 'capitalize', 'defer'];
/** Longest catch-up plan accepted, in payments. */
const MAX_CATCH_UP_MONTHS = 120;
/** Upper bound for any amount typed in: $1 billion, in cents. */
const MAX_AMOUNT = 100_000_000_000;

function bodyOf(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Expected a JSON object');
  return body as Record<string, unknown>;
}

function dateField(b: Record<string, unknown>, key: string): ISODate {
  if (!isValidISODate(b[key])) throw new HttpError(400, `${key} must be a date like 2026-11-01`);
  return b[key] as ISODate;
}

function amountField(b: Record<string, unknown>, key: string, { allowZero = false } = {}): Cents {
  const v = b[key];
  if (!Number.isInteger(v) || (v as number) < (allowZero ? 0 : 1) || (v as number) > MAX_AMOUNT) {
    throw new HttpError(400, `${key} must be ${allowZero ? 'zero or more' : 'a positive amount'}, in cents`);
  }
  return v as Cents;
}

function textField(b: Record<string, unknown>, key: string, max: number): string {
  const v = b[key] ?? '';
  if (typeof v !== 'string') throw new HttpError(400, `${key} must be text`);
  if (v.length > max) throw new HttpError(400, `${key} is too long (max ${max} characters)`);
  return v.trim();
}

/** Coerce untrusted JSON into LoanDetails, dropping unknown fields and empty values. */
export function parseDetails(body: unknown): LoanDetails {
  const b = bodyOf(body);
  const fieldsIn = b.fields && typeof b.fields === 'object' ? (b.fields as Record<string, unknown>) : {};
  const fields: LoanDetails['fields'] = {};
  for (const key of LOAN_DETAIL_FIELDS) {
    const v = textField(fieldsIn, key, key === 'notes' ? 4000 : 500);
    if (v) fields[key] = v;
  }
  const customIn = Array.isArray(b.custom) ? b.custom : [];
  if (customIn.length > 30) throw new HttpError(400, 'Keep it to 30 extra fields or fewer');
  const custom = customIn
    .map((c) => {
      const o = c && typeof c === 'object' ? (c as Record<string, unknown>) : {};
      return { label: textField(o, 'label', 80), value: textField(o, 'value', 500) };
    })
    .filter((c) => c.label || c.value);
  return { fields, custom };
}

function parseStartingPoint(v: unknown): StartingPoint | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'object' || Array.isArray(v)) throw new HttpError(400, 'startingPoint must be an object or null');
  const o = v as Record<string, unknown>;
  const int = (k: string) => (typeof o[k] === 'number' ? Math.round(o[k] as number) : Number.NaN);
  return { payment: int('payment'), balance: int('balance') };
}

/** Coerce untrusted JSON into a LoanSetup. Validation happens in the engine. */
export function parseSetup(body: unknown): LoanSetup {
  if (!body || typeof body !== 'object') throw new HttpError(400, 'Expected a JSON object');
  const b = body as Record<string, unknown>;
  const int = (k: string) => (typeof b[k] === 'number' ? Math.round(b[k] as number) : Number.NaN);
  const nullableInt = (k: string) => (b[k] === null || b[k] === undefined || b[k] === '' ? null : int(k));
  const str = (k: string) => (typeof b[k] === 'string' ? (b[k] as string) : '');
  const setup: LoanSetup = {
    originalAmount: int('originalAmount'),
    annualRatePercent: typeof b.annualRatePercent === 'number' ? b.annualRatePercent : Number.NaN,
    termYears: int('termYears'),
    openDate: str('openDate'),
    firstPaymentDate: str('firstPaymentDate'),
    paymentDay: int('paymentDay'),
    piPaymentOverride: nullableInt('piPaymentOverride'),
    originalHomeValue: int('originalHomeValue'),
    pmiMonthly: int('pmiMonthly'),
    pmiStartDate: b.pmiStartDate ? str('pmiStartDate') : null,
    pmiRemovalRule: PMI_REMOVAL_RULES.includes(b.pmiRemovalRule as PmiRemovalRule) ? (b.pmiRemovalRule as PmiRemovalRule) : 'auto78Scheduled',
    escrowMonthly: int('escrowMonthly'),
    extraPrincipal: int('extraPrincipal'),
    startingPoint: parseStartingPoint(b.startingPoint),
  };
  // Optional fields are only written when given, so a mortgage saved by an
  // older UI keeps exactly the shape it always had.
  if (b.termMonths !== undefined && b.termMonths !== null && b.termMonths !== '') {
    setup.termMonths = int('termMonths');
    if (Number.isInteger(setup.termMonths) && setup.termMonths >= 1 && setup.termMonths <= MAX_TERM_MONTHS) {
      setup.termYears = Math.ceil(setup.termMonths / 12);
    }
  }
  if (b.modules !== undefined) setup.modules = parseModules(b.modules);
  if (b.interestMethod !== undefined) setup.interestMethod = b.interestMethod as InterestMethod;
  if (b.downPayment !== undefined) setup.downPayment = nullableInt('downPayment');
  if (b.fees !== undefined) setup.fees = parseFees(b.fees);
  if (b.yearlyFee !== undefined) setup.yearlyFee = parseYearlyFee(b.yearlyFee);
  if (b.payoffQuote !== undefined) setup.payoffQuote = parsePayoffQuote(b.payoffQuote);
  const problems = validateSetup(setup);
  if (problems.length) throw new HttpError(400, 'Please fix the loan setup', { problems });
  return setup;
}

function parseModules(v: unknown): LoanModules {
  const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  return { pmi: o.pmi === true, escrow: o.escrow === true };
}

function parseFees(v: unknown): OneOffFee[] {
  if (!Array.isArray(v)) throw new HttpError(400, 'fees must be a list');
  return v.map((f) => {
    const o = f && typeof f === 'object' ? (f as Record<string, unknown>) : {};
    return {
      label: typeof o.label === 'string' ? o.label.trim() : '',
      amount: typeof o.amount === 'number' ? Math.round(o.amount) : Number.NaN,
      financed: o.financed === true,
    };
  });
}

function parseYearlyFee(v: unknown): YearlyFee | null {
  if (v === null || v === '') return null;
  const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  return { basis: o.basis as YearlyFee['basis'], percent: typeof o.percent === 'number' ? o.percent : Number.NaN };
}

function parsePayoffQuote(v: unknown): PayoffQuote | null {
  if (v === null || v === '') return null;
  const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  return {
    amount: typeof o.amount === 'number' ? Math.round(o.amount) : Number.NaN,
    goodThrough: typeof o.goodThrough === 'string' ? o.goodThrough : '',
  };
}

function suggestionsFor(difference: Cents, modules: LoanModules): Resolution[] {
  const out: Resolution[] = [];
  if (Math.abs(difference) <= MAX_PENNY_OFFSET) out.push('rounding');
  if (difference > 0) out.push('extraPrincipal');
  if (modules.escrow) out.push('escrow');
  if (modules.pmi) out.push('pmi');
  return out;
}

/**
 * Everything about one loan: its schedule, reconciliation, skips, escrow
 * and details. Every read and write goes through a store scoped to the loan.
 */
export class LoanService {
  private readonly store: LoanStore;

  constructor(
    private readonly root: Store,
    private readonly source: BudgetSource,
    private readonly today: () => ISODate,
    readonly loan: LoanRecord,
  ) {
    this.store = root.loan(loan.id);
  }

  /**
   * The asset equity is measured against. A mortgage always has a home, so
   * one without a recorded asset uses the home described by its setup.
   */
  private asset(setup: LoanSetup): Asset | null {
    return this.root.assetForLoan(this.loan.id) ?? (this.loan.type === 'mortgage' ? homeAssetFor(setup) : null);
  }

  /** When each matched payment really left the bank, for daily-interest loans. */
  private paidDates(extra?: [number, ISODate]): Map<number, ISODate> {
    const dates = new Map(this.store.listMonths().map((m) => [m.payment, m.transactionDate]));
    if (extra) dates.set(extra[0], extra[1]);
    return dates;
  }

  private requireSetup(): LoanSetup {
    const setup = this.store.getSetup();
    if (!setup) throw new HttpError(409, 'Set up the loan first');
    return setup;
  }

  private build(setup: LoanSetup, paidOn?: [number, ISODate]): Schedule {
    const adjustments = this.store.listAdjustments().map((a) => a.adjustment);
    const locked = new Map<number, LockedPayment>();
    for (const m of this.store.listMonths()) if (m.status === 'paid' && m.locked) locked.set(m.payment, m.locked);
    try {
      return generateSchedule(setup, { adjustments, locked, paidDates: this.paidDates(paidOn) });
    } catch (e) {
      if (e instanceof SetupError) throw new HttpError(400, e.message, { problems: e.problems });
      throw e;
    }
  }

  private row(schedule: Schedule, payment: number): ScheduleRow {
    const row = schedule.rows[payment - 1];
    if (!row || !Number.isInteger(payment)) throw new HttpError(404, `Payment ${payment} is not on the schedule`);
    return row;
  }

  /** Months before tracking have no bank transaction and can't be changed. */
  private tracked(row: ScheduleRow): ScheduleRow {
    if (row.beforeTracking) {
      throw new HttpError(409, `Payment ${row.payment} was made before tracking began, so there's nothing to reconcile or change`);
    }
    return row;
  }

  private paidSet(): Set<number> {
    return new Set(this.store.listMonths().filter((m) => m.status === 'paid').map((m) => m.payment));
  }

  state(): StateView {
    const setup = this.store.getSetup();
    const base = {
      loan: this.root.getLoan(this.loan.id) ?? this.loan,
      asset: this.root.assetForLoan(this.loan.id),
      setup,
      settings: this.store.getSettings(),
      source: this.source.status(),
      today: this.today(),
      adjustments: this.store.listAdjustments(),
      details: this.store.getDetails(),
    };
    if (!setup) return { ...base, schedule: null, summary: null, analysis: null };

    const schedule = this.build(setup);
    const months = new Map(this.store.listMonths().map((m) => [m.payment, m]));
    const today = this.today();
    const paid = this.paidSet();
    const asset = this.asset(setup);
    const paidOn = new Map([...months.values()].filter((m) => m.status === 'paid').map((m) => [m.payment, m.transactionDate]));
    const rows: MonthView[] = schedule.rows.map((r) => {
      const m = months.get(r.payment);
      return {
        ...r,
        status: m?.status ?? (r.beforeTracking ? 'history' : r.skipped ? 'skipped' : 'scheduled'),
        match: m
          ? {
              transactionId: m.transactionId,
              transactionDate: m.transactionDate,
              transactionAmount: m.transactionAmount,
              transactionPayee: m.transactionPayee,
              difference: m.difference,
              resolution: m.resolution,
            }
          : null,
      };
    });
    return {
      ...base,
      schedule: {
        piPayment: schedule.piPayment,
        calculatedPiPayment: schedule.calculatedPiPayment,
        totals: schedule.totals,
        pmi: schedule.pmi,
        rows,
        currentPayment: rows.find((r) => r.status === 'scheduled' || r.status === 'flagged')?.payment ?? null,
      },
      summary: summarize(setup, schedule, paid, today, asset),
      analysis: {
        equity: asset ? analyzeEquity(setup, schedule, paid, today, asset) : null,
        periods: {
          paid: periodBreakouts(schedule.rows, paidOn, today, 'paid'),
          scheduled: periodBreakouts(schedule.rows, paidOn, today, 'scheduled'),
        },
        escrow: escrowReport(schedule.rows, paidOn, this.store.listEscrowEntries(), today),
      },
    };
  }

  /** Read-only snapshot for dashboards. Null when the loan is not set up. */
  summary(): LoanSummary | null {
    const setup = this.store.getSetup();
    return setup ? summarize(setup, this.build(setup), this.paidSet(), this.today(), this.asset(setup)) : null;
  }

  /** `createHome`: record a mortgage's home from the setup when it has no asset yet. */
  saveSetup(body: unknown, { createHome = true } = {}) {
    const setup = parseSetup(body);
    const start = setup.startingPoint;
    if (start) {
      const matched = this.store.listMonths().find((m) => m.payment <= start.payment);
      if (matched) {
        throw new HttpError(409, `Payment ${matched.payment} is already matched to a bank transaction. Undo it first, or start tracking before it.`);
      }
      const changed = this.store.listAdjustments().find(({ adjustment: a }) => 'payment' in a && a.payment <= start.payment);
      if (changed && 'payment' in changed.adjustment) {
        throw new HttpError(
          409,
          `Payment ${changed.adjustment.payment} has a skip, extra principal or penny offset recorded. Undo it first, or start tracking before it.`,
        );
      }
    }
    this.build(setup); // throws a readable 400 if the schedule cannot be generated
    this.root.transaction(() => {
      this.store.saveSetup(setup);
      // A mortgage is always on a home: record it the first time, from the setup.
      if (createHome && this.loan.type === 'mortgage' && !this.root.assetForLoan(this.loan.id)) {
        this.root.createAsset({
          loanId: this.loan.id, name: 'Home', kind: 'home', originalValue: setup.originalHomeValue,
          valueTrend: 'manual', trendRatePercent: null, acquiredDate: setup.openDate,
        });
      }
    });
    return this.state();
  }

  saveSettings(body: unknown) {
    const b = (body ?? {}) as Record<string, unknown>;
    const categoryId = typeof b.categoryId === 'string' && b.categoryId ? b.categoryId : null;
    this.store.saveSettings({ ...this.store.getSettings(), categoryId });
    return this.store.getSettings();
  }

  private async fetchAround(categoryId: string, due: ISODate, before: number, after: number) {
    return this.source.getTransactionsInCategory(categoryId, addDays(due, -before), addDays(due, after));
  }

  private categoryOrThrow(categoryId: unknown): string {
    const id = typeof categoryId === 'string' && categoryId ? categoryId : this.store.getSettings().categoryId;
    if (!id) throw new HttpError(400, `Pick the category for ${this.loan.nickname}'s payments first`);
    return id;
  }

  async candidates(payment: number, categoryId: unknown, wide = false): Promise<Candidate[]> {
    const setup = this.requireSetup();
    const row = this.tracked(this.row(this.build(setup), payment));
    const cat = this.categoryOrThrow(categoryId);
    const txns = await this.fetchAround(cat, row.dueDate, wide ? WIDE_WINDOW : WINDOW_BEFORE, wide ? WIDE_WINDOW : WINDOW_AFTER);
    return txns
      .filter((t) => t.amount < 0)
      .map((t) => {
        const cmp = compareToSchedule(row, t.amount);
        const usedBy = this.store.monthForTransaction(t.id);
        return {
          ...t,
          paid: cmp.actual,
          matchesSchedule: cmp.matches,
          difference: cmp.difference,
          usedByPayment: usedBy === payment ? null : usedBy,
        };
      })
      .sort((a, b) => Number(b.matchesSchedule) - Number(a.matchesSchedule) || a.date.localeCompare(b.date));
  }

  async match(payment: number, body: unknown): Promise<MatchResult> {
    const b = (body ?? {}) as Record<string, unknown>;
    const transactionId = typeof b.transactionId === 'string' ? b.transactionId : '';
    if (!transactionId) throw new HttpError(400, 'transactionId is required');

    const setup = this.requireSetup();
    const scheduled = this.tracked(this.row(this.build(setup), payment));
    if (scheduled.skipped) throw new HttpError(409, `Payment ${payment} is marked as skipped. Undo the skip first.`);
    const existing = this.store.getMonth(payment);
    if (existing?.status === 'paid') throw new HttpError(409, `Payment ${payment} is already reconciled. Undo it first.`);
    const usedBy = this.store.monthForTransaction(transactionId);
    if (usedBy !== null && usedBy !== payment) {
      throw new HttpError(409, `That transaction is already matched to payment ${usedBy}`);
    }

    const cat = this.categoryOrThrow(b.categoryId);
    const txn = (await this.fetchAround(cat, scheduled.dueDate, WIDE_WINDOW, WIDE_WINDOW)).find((t) => t.id === transactionId);
    if (!txn) throw new HttpError(404, "That transaction was not found in this loan's category near this due date");
    if (txn.amount >= 0) throw new HttpError(400, 'That transaction is a deposit, not a payment');
    // Daily-interest loans accrue up to the day the payment really left the bank.
    const row = setup.interestMethod === 'daily' ? this.row(this.build(setup, [payment, txn.date]), payment) : scheduled;

    const cmp = compareToSchedule(row, txn.amount);
    // Re-matching a flagged month to a different transaction starts it over.
    this.root.transaction(() => {
      this.store.deleteAdjustmentsFrom(payment);
      this.store.saveMonth({
        payment,
        status: cmp.matches ? 'paid' : 'flagged',
        transactionId: txn.id,
        transactionDate: txn.date,
        transactionAmount: cmp.actual,
        transactionPayee: txn.payee,
        difference: cmp.difference,
        resolution: null,
        locked: cmp.matches ? lockRow(row) : null,
      });
    });

    return {
      status: cmp.matches ? 'paid' : 'flagged',
      payment,
      scheduled: cmp.scheduled,
      actual: cmp.actual,
      difference: cmp.difference,
      suggestions: cmp.matches ? [] : suggestionsFor(cmp.difference, modulesOf(setup)),
    };
  }

  resolve(payment: number, body: unknown) {
    const b = (body ?? {}) as Record<string, unknown>;
    const resolution = b.resolution as Resolution;
    if (!['rounding', 'escrow', 'pmi', 'extraPrincipal'].includes(resolution)) {
      throw new HttpError(400, 'resolution must be rounding, escrow, pmi, or extraPrincipal');
    }
    const setup = this.requireSetup();
    const month = this.store.getMonth(payment);
    if (!month || month.status !== 'flagged') throw new HttpError(409, `Payment ${payment} is not flagged`);

    this.root.transaction(() => {
      const before = this.build(setup);
      const row = this.row(before, payment);
      const difference = month.transactionAmount - row.total;

      if (difference !== 0) {
        const existing = this.store.listAdjustments().map((a) => a.adjustment);
        try {
          const adj = resolutionToAdjustment(setup, existing, row, difference, resolution, { standing: b.standing === true });
          this.store.addAdjustment(adj, payment);
        } catch (e) {
          if (e instanceof ResolutionError) throw new HttpError(400, e.message);
          throw e;
        }
      }

      const after = this.row(this.build(setup), payment);
      if (after.total !== month.transactionAmount) {
        // Throwing rolls back the adjustment, so the month stays flagged.
        throw new HttpError(
          400,
          `That answer doesn't account for the whole difference ` +
            `(schedule would be ${after.total / 100}, bank shows ${month.transactionAmount / 100}). Try another answer.`,
        );
      }
      this.store.saveMonth({ ...month, status: 'paid', resolution, locked: lockRow(after) });
    });
    return this.state();
  }

  unmatch(payment: number) {
    this.root.transaction(() => {
      this.store.deleteAdjustmentsFrom(payment);
      this.store.deleteMonth(payment);
    });
    return this.state();
  }

  setOffset(payment: number, body: unknown) {
    const amount = (body as Record<string, unknown> | null)?.amount;
    if (!Number.isInteger(amount) || Math.abs(amount as number) > MAX_PENNY_OFFSET) {
      throw new HttpError(400, `The offset must be whole cents between -${MAX_PENNY_OFFSET} and ${MAX_PENNY_OFFSET}`);
    }
    const setup = this.requireSetup();
    this.tracked(this.row(this.build(setup), payment));
    if (this.store.getMonth(payment)?.status === 'paid') {
      throw new HttpError(409, `Payment ${payment} is reconciled and locked. Undo it first.`);
    }
    this.root.transaction(() => {
      this.store.deleteManualOffset(payment);
      if (amount !== 0) this.store.addAdjustment({ kind: 'pennyOffset', payment, amount: amount as number }, null);
    });
    return this.state();
  }

  // --- skipped payments -----------------------------------------------------------

  skip(payment: number, body: unknown) {
    const mode = bodyOf(body).mode as SkipMode;
    if (!SKIP_MODES.includes(mode)) throw new HttpError(400, 'mode must be catchUp, capitalize or defer');
    const setup = this.requireSetup();
    this.tracked(this.row(this.build(setup), payment));
    if (this.store.getMonth(payment)) {
      throw new HttpError(409, `Payment ${payment} is already matched to a bank transaction. Undo that first.`);
    }
    this.root.transaction(() => {
      this.store.setSkip(payment, mode);
      this.dropUnusedCatchUpPlans();
    });
    return this.state();
  }

  unskip(payment: number) {
    this.root.transaction(() => {
      this.store.setSkip(payment, null);
      this.dropUnusedCatchUpPlans();
    });
    return this.state();
  }

  /**
   * The plan that pays back a catch-up skip at `payment`: the first plan
   * starting after it (a plan repays everything past due when it starts).
   */
  private coveringPlan(payment: number): { id: number; fromPayment: number } | null {
    let best: { id: number; fromPayment: number } | null = null;
    for (const { id, adjustment: a } of this.store.listAdjustments()) {
      if (a.kind !== 'catchUpPlan' || a.fromPayment <= payment) continue;
      if (!best || a.fromPayment < best.fromPayment) best = { id, fromPayment: a.fromPayment };
    }
    return best;
  }

  /** Remove plans that no longer have a catch-up skip to repay. */
  private dropUnusedCatchUpPlans() {
    const used = new Set<number>();
    for (const a of this.store.listAdjustments()) {
      if (a.adjustment.kind === 'skip' && a.adjustment.mode === 'catchUp') {
        const plan = this.coveringPlan(a.adjustment.payment);
        if (plan) used.add(plan.id);
      }
    }
    for (const a of this.store.listAdjustments()) {
      if (a.adjustment.kind === 'catchUpPlan' && !used.has(a.id)) this.store.deleteAdjustment(a.id);
    }
  }

  /**
   * Plan how to pay back the past-due amount from the catch-up skip at
   * `payment`: spread over `months` payments starting with `fromPayment`.
   * Replaces the plan that currently covers it.
   */
  setCatchUpPlan(payment: number, body: unknown) {
    const b = bodyOf(body);
    const fromPayment = b.fromPayment;
    const months = b.months;
    const setup = this.requireSetup();
    const schedule = this.build(setup);
    const row = this.row(schedule, payment);
    if (row.skipped !== 'catchUp') throw new HttpError(409, `Payment ${payment} isn't a missed payment to catch up`);
    if (!Number.isInteger(fromPayment) || (fromPayment as number) <= payment) {
      throw new HttpError(400, 'The catch-up has to start with a payment after the missed one');
    }
    if (!Number.isInteger(months) || (months as number) < 1 || (months as number) > MAX_CATCH_UP_MONTHS) {
      throw new HttpError(400, `Spread the catch-up over 1 to ${MAX_CATCH_UP_MONTHS} payments`);
    }
    const from = fromPayment as number;
    const n = months as number;
    if (from + n - 1 > schedule.rows.length) throw new HttpError(400, 'That plan runs past the end of the loan');
    const months_ = new Map(this.store.listMonths().map((m) => [m.payment, m]));
    for (let k = from; k < from + n; k++) {
      if (months_.has(k)) throw new HttpError(409, `Payment ${k} is already matched to a bank transaction, so the plan can't include it`);
      if (schedule.rows[k - 1]!.skipped) throw new HttpError(409, `Payment ${k} is skipped, so the plan can't include it`);
    }
    this.root.transaction(() => {
      const existing = this.coveringPlan(payment);
      if (existing) this.store.deleteAdjustment(existing.id);
      for (const a of this.store.listAdjustments()) {
        if (a.adjustment.kind === 'catchUpPlan' && a.adjustment.fromPayment === from) this.store.deleteAdjustment(a.id);
      }
      this.store.addAdjustment({ kind: 'catchUpPlan', fromPayment: from, months: n }, null);
    });
    return this.state();
  }

  clearCatchUpPlan(payment: number) {
    const row = this.row(this.build(this.requireSetup()), payment);
    if (row.skipped !== 'catchUp') throw new HttpError(409, `Payment ${payment} isn't a missed payment to catch up`);
    const plan = this.coveringPlan(payment);
    if (plan) this.store.deleteAdjustment(plan.id);
    return this.state();
  }

  // --- PMI removal ------------------------------------------------------------------

  /**
   * Record that the servicer stopped charging PMI from `fromPayment` on, as a
   * PMI change of zero. Replaces an earlier record. Works with every removal
   * rule, and is the only way PMI ends under `untilRemoved`.
   */
  setPmiRemoval(body: unknown) {
    const from = bodyOf(body).fromPayment;
    if (!Number.isInteger(from) || (from as number) < 1) throw new HttpError(400, 'fromPayment must be a payment number');
    const setup = this.requireSetup();
    if (!modulesOf(setup).pmi) throw new HttpError(409, 'PMI is turned off for this loan');
    const fromPayment = from as number;
    this.tracked(this.row(this.build(setup), fromPayment));
    // A reconciled month keeps the PMI it really paid, so removal can't start on or before one.
    const reconciled = this.store.listMonths().find((m) => m.status === 'paid' && m.payment >= fromPayment);
    if (reconciled) {
      throw new HttpError(
        409,
        `Payment ${reconciled.payment} is already reconciled with the PMI it paid. Pick a payment after it, or undo that month first.`,
      );
    }
    this.root.transaction(() => {
      this.store.deletePmiRemoval();
      this.store.addAdjustment({ kind: 'pmi', fromPayment, amount: 0 }, null);
    });
    return this.state();
  }

  clearPmiRemoval() {
    this.store.deletePmiRemoval();
    return this.state();
  }

  // --- escrow ---------------------------------------------------------------------

  addEscrowEntry(body: unknown) {
    const b = bodyOf(body);
    if (!isEscrowKind(b.kind)) throw new HttpError(400, 'Unknown escrow entry kind');
    const setup = this.store.getSetup();
    if (setup && !modulesOf(setup).escrow) throw new HttpError(409, 'Escrow is turned off for this loan');
    this.store.addEscrowEntry({ date: dateField(b, 'date'), kind: b.kind, amount: amountField(b, 'amount'), note: textField(b, 'note', 200) });
    return this.state();
  }

  deleteEscrowEntry(id: number) {
    if (!this.store.deleteEscrowEntry(id)) throw new HttpError(404, 'That escrow entry is not on file');
    return this.state();
  }

  // --- loan details ------------------------------------------------------------------

  saveDetails(body: unknown) {
    this.store.saveDetails(parseDetails(body));
    return this.state();
  }
}

/** One row of the loan list: enough for the picker and the sidebar. */
export interface LoanListItem {
  loan: LoanRecord;
  configured: boolean;
  asset: Pick<AssetRecord, 'id' | 'name' | 'kind'> | null;
  /** Balance + deferred + past due. Null until the loan is set up. */
  owed: Cents | null;
  /** The asset's current value minus what's owed. Null without an asset or setup. */
  equity: Cents | null;
  assetValue: Cents | null;
  nextPayment: { payment: number; dueDate: ISODate; total: Cents } | null;
  /** Set when the schedule can't be built (an invalid saved setup). */
  error: string | null;
}

const MAX_NICKNAME = 60;

function nicknameField(b: Record<string, unknown>): string {
  const v = textField(b, 'nickname', MAX_NICKNAME);
  if (!v) throw new HttpError(400, 'Give the loan a nickname');
  return v;
}

function loanTypeField(v: unknown): LoanType {
  if (!LOAN_TYPES.includes(v as LoanType)) throw new HttpError(400, 'type must be mortgage, auto, personal or student');
  return v as LoanType;
}

/** Coerce untrusted JSON into an asset. `loanId` is handled by the caller. */
export function parseAsset(body: unknown, current?: AssetInput): Omit<AssetInput, 'loanId'> {
  const b = bodyOf(body);
  const merged = { ...current, ...b } as Record<string, unknown>;
  const name = textField(merged, 'name', 80);
  if (!name) throw new HttpError(400, 'Give the asset a name');
  if (!ASSET_KINDS.includes(merged.kind as AssetKind)) throw new HttpError(400, 'kind must be home, vehicle or other');
  const original = merged.originalValue;
  if (!Number.isInteger(original) || (original as number) < 0 || (original as number) > MAX_AMOUNT) {
    throw new HttpError(400, 'originalValue must be zero or more, in cents');
  }
  const trend = (merged.valueTrend ?? 'manual') as ValueTrend;
  if (!VALUE_TRENDS.includes(trend)) throw new HttpError(400, 'valueTrend must be appreciating, depreciating or manual');
  const rate = merged.trendRatePercent ?? null;
  if (rate !== null && !(typeof rate === 'number' && rate >= 0 && rate <= 100)) {
    throw new HttpError(400, 'trendRatePercent must be 0 to 100, or null');
  }
  const acquired = merged.acquiredDate ?? null;
  if (acquired !== null && !isValidISODate(acquired)) throw new HttpError(400, 'acquiredDate must be a date like 2026-11-01, or null');
  return {
    name,
    kind: merged.kind as AssetKind,
    originalValue: original as Cents,
    valueTrend: trend,
    trendRatePercent: trend === 'manual' ? null : (rate as number | null),
    acquiredDate: acquired as ISODate | null,
  };
}

/**
 * The tracker as a whole: the list of loans, assets and their values, and
 * the read-only summaries. Per-loan work is done by `LoanService`.
 */
export class TrackerService {
  constructor(
    private readonly store: Store,
    private readonly source: BudgetSource,
    private readonly today: () => ISODate,
  ) {}

  sourceStatus(): SourceStatus {
    return this.source.status();
  }

  /** Today, as the schedules see it. */
  asOf(): ISODate {
    return this.today();
  }

  categories(): Promise<CategoryGroup[]> {
    return this.source.getCategories();
  }

  // --- loans --------------------------------------------------------------------------

  /** The loan with this id, or a 404. */
  loan(id: number): LoanService {
    const loan = this.store.getLoan(id);
    if (!loan) throw new HttpError(404, `There is no loan ${id}`);
    return new LoanService(this.store, this.source, this.today, loan);
  }

  loans(): LoanListItem[] {
    return this.store.listLoans().map((loan) => {
      const svc = new LoanService(this.store, this.source, this.today, loan);
      const asset = this.store.assetForLoan(loan.id);
      const item: LoanListItem = {
        loan,
        configured: false,
        asset: asset ? { id: asset.id, name: asset.name, kind: asset.kind } : null,
        owed: null,
        equity: null,
        assetValue: null,
        nextPayment: null,
        error: null,
      };
      try {
        const s = svc.summary();
        if (!s) return item;
        return {
          ...item,
          configured: true,
          owed: s.owed,
          equity: s.asset?.equity ?? null,
          assetValue: s.asset?.value ?? null,
          nextPayment: s.nextPayment ? { payment: s.nextPayment.payment, dueDate: s.nextPayment.dueDate, total: s.nextPayment.total } : null,
        };
      } catch (e) {
        return { ...item, configured: true, error: (e as Error).message };
      }
    });
  }

  /**
   * Create a loan: `{ nickname, type, setup?, asset? }`. A mortgage gets a
   * home asset from its setup unless `asset` says otherwise; `asset: null`
   * means none.
   */
  createLoan(body: unknown): { loan: LoanRecord; state: StateView } {
    const b = bodyOf(body);
    const nickname = nicknameField(b);
    const type = loanTypeField(b.type);
    const setup = b.setup === undefined || b.setup === null ? null : parseSetup(b.setup);
    const asset = b.asset === undefined || b.asset === null ? null : parseAsset(b.asset);
    const loan = this.store.transaction(() => {
      const created = this.store.createLoan({ nickname, type });
      if (asset) this.store.createAsset({ ...asset, loanId: created.id });
      if (setup) {
        const svc = new LoanService(this.store, this.source, this.today, created);
        // Builds the schedule first, so a setup that can't be scheduled rolls everything back.
        svc.saveSetup(setup, { createHome: b.asset !== null });
      }
      if (typeof b.categoryId === 'string' && b.categoryId) this.store.loan(created.id).saveSettings({ categoryId: b.categoryId });
      return created;
    });
    return { loan, state: this.loan(loan.id).state() };
  }

  /** `{ nickname?, type?, archived? }` */
  updateLoan(id: number, body: unknown): LoanRecord {
    const b = bodyOf(body);
    this.loan(id);
    const patch: Partial<Pick<LoanRecord, 'nickname' | 'type' | 'archived'>> = {};
    if (b.nickname !== undefined) patch.nickname = nicknameField(b);
    if (b.type !== undefined) patch.type = loanTypeField(b.type);
    if (b.archived !== undefined) {
      if (typeof b.archived !== 'boolean') throw new HttpError(400, 'archived must be true or false');
      patch.archived = b.archived;
    }
    return this.store.updateLoan(id, patch)!;
  }

  setArchived(id: number, archived: boolean): LoanRecord {
    this.loan(id);
    return this.store.updateLoan(id, { archived })!;
  }

  /**
   * Delete a loan and everything recorded for it. Its asset (and the asset's
   * value history) goes too, unless `keepAsset`, which keeps it unlinked.
   * `confirm` has to be the loan's nickname, so a stray request can't do it.
   */
  deleteLoan(id: number, confirm: unknown, keepAsset: boolean) {
    const loan = this.loan(id).loan;
    if (confirm !== loan.nickname) {
      throw new HttpError(400, `To delete "${loan.nickname}", pass confirm with its exact nickname`);
    }
    this.store.transaction(() => {
      const asset = this.store.assetForLoan(id);
      if (asset && !keepAsset) this.store.deleteAsset(asset.id);
      this.store.deleteLoan(id);
    });
    return { deleted: id };
  }

  // --- assets ----------------------------------------------------------------------------

  assets(): AssetRecord[] {
    return this.store.listAssets();
  }

  private assetOr404(id: number): AssetRecord {
    const asset = this.store.getAsset(id);
    if (!asset) throw new HttpError(404, `There is no asset ${id}`);
    return asset;
  }

  private loanIdField(v: unknown, assetId: number | null): number | null {
    if (v === null || v === undefined) return null;
    if (!Number.isInteger(v)) throw new HttpError(400, 'loanId must be a loan id, or null');
    this.loan(v as number);
    const linked = this.store.assetForLoan(v as number);
    if (linked && linked.id !== assetId) throw new HttpError(409, `Loan ${String(v)} already has an asset (${linked.name})`);
    return v as number;
  }

  createAsset(body: unknown): AssetRecord {
    const b = bodyOf(body);
    const loanId = this.loanIdField(b.loanId, null);
    return this.store.createAsset({ ...parseAsset(b), loanId });
  }

  updateAsset(id: number, body: unknown): AssetRecord {
    const current = this.assetOr404(id);
    const b = bodyOf(body);
    const loanId = b.loanId === undefined ? current.loanId : this.loanIdField(b.loanId, id);
    return this.store.updateAsset(id, { ...parseAsset(b, current), loanId })!;
  }

  deleteAsset(id: number) {
    this.assetOr404(id);
    this.store.deleteAsset(id);
    return { deleted: id };
  }

  addAssetValue(assetId: number, body: unknown): AssetRecord {
    this.assetOr404(assetId);
    const b = bodyOf(body);
    this.store.addAssetValue(assetId, {
      date: dateField(b, 'date'),
      // Zero is a real value: a car that was totaled, an asset written off.
      value: amountField(b, 'value', { allowZero: true }),
      source: textField(b, 'source', 100) || 'Estimate',
    });
    return this.store.getAsset(assetId)!;
  }

  deleteAssetValue(assetId: number, valueId: number): AssetRecord {
    this.assetOr404(assetId);
    if (!this.store.deleteAssetValue(assetId, valueId)) throw new HttpError(404, 'That value is not on file');
    return this.store.getAsset(assetId)!;
  }

  // --- backup and restore ------------------------------------------------------------------

  /** Everything the tracker holds, as a backup file's contents. */
  backup(): Backup {
    return exportBackup(this.store.db);
  }

  /**
   * Replace everything in the tracker with a backup. `confirm` has to be
   * "replace", so a stray request can't do it.
   */
  restore(body: unknown, confirm: unknown): RestoreResult {
    if (confirm !== 'replace') throw new HttpError(400, 'Restoring replaces everything in the tracker. Pass confirm=replace to go ahead.');
    try {
      return restoreBackup(this.store, body);
    } catch (e) {
      if (e instanceof BackupError) throw new HttpError(400, e.message);
      throw e;
    }
  }

  // --- read-only summaries ------------------------------------------------------------------

  /** Every active loan that is set up. Archived loans are left out. */
  summaries(): { loan: LoanRecord; summary: LoanSummary }[] {
    return this.store
      .listLoans()
      .filter((l) => !l.archived)
      .flatMap((loan) => {
        const summary = new LoanService(this.store, this.source, this.today, loan).summary();
        return summary ? [{ loan, summary }] : [];
      });
  }

  summaryFor(id: number): { loan: LoanRecord; summary: LoanSummary } {
    const svc = this.loan(id);
    const summary = svc.summary();
    if (!summary) throw new HttpError(409, `Loan ${id} has not been set up yet`);
    return { loan: svc.loan, summary };
  }
}
