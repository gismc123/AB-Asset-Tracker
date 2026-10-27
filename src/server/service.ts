import {
  addDays,
  compareToSchedule,
  generateSchedule,
  lockRow,
  MAX_PENNY_OFFSET,
  resolutionToAdjustment,
  ResolutionError,
  SetupError,
  summarize,
  validateSetup,
  type Cents,
  type ISODate,
  type LoanSetup,
  type LockedPayment,
  type LoanSummary,
  type PmiInfo,
  type PmiRemovalRule,
  type Resolution,
  type Schedule,
  type ScheduleRow,
} from '../engine/index.js';
import type { BudgetSource, BudgetTransaction, CategoryGroup, SourceStatus } from './actual.js';
import type { MonthRecord, Settings, Store, StoredAdjustment } from './db.js';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export type RowStatus = 'scheduled' | 'flagged' | 'paid';

export interface MonthView extends ScheduleRow {
  status: RowStatus;
  match: Pick<MonthRecord, 'transactionId' | 'transactionDate' | 'transactionAmount' | 'transactionPayee' | 'difference' | 'resolution'> | null;
}

export interface StateView {
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

const RULES: PmiRemovalRule[] = ['auto78Scheduled', 'auto78Actual', 'request80'];

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
    pmiRemovalRule: RULES.includes(b.pmiRemovalRule as PmiRemovalRule) ? (b.pmiRemovalRule as PmiRemovalRule) : 'auto78Scheduled',
    escrowMonthly: int('escrowMonthly'),
    extraPrincipal: int('extraPrincipal'),
  };
  const problems = validateSetup(setup);
  if (problems.length) throw new HttpError(400, 'Please fix the loan setup', { problems });
  return setup;
}

function suggestionsFor(difference: Cents): Resolution[] {
  const out: Resolution[] = [];
  if (Math.abs(difference) <= MAX_PENNY_OFFSET) out.push('rounding');
  if (difference > 0) out.push('extraPrincipal', 'escrow', 'pmi');
  else out.push('escrow', 'pmi');
  return out;
}

export class MortgageService {
  constructor(
    private readonly store: Store,
    private readonly source: BudgetSource,
    private readonly today: () => ISODate,
  ) {}

  private requireSetup(): LoanSetup {
    const setup = this.store.getSetup();
    if (!setup) throw new HttpError(409, 'Set up the loan first');
    return setup;
  }

  private build(setup: LoanSetup): Schedule {
    const adjustments = this.store.listAdjustments().map((a) => a.adjustment);
    const locked = new Map<number, LockedPayment>();
    for (const m of this.store.listMonths()) if (m.status === 'paid' && m.locked) locked.set(m.payment, m.locked);
    try {
      return generateSchedule(setup, { adjustments, locked });
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

  private paidSet(): Set<number> {
    return new Set(this.store.listMonths().filter((m) => m.status === 'paid').map((m) => m.payment));
  }

  state(): StateView {
    const setup = this.store.getSetup();
    const base = {
      setup,
      settings: this.store.getSettings(),
      source: this.source.status(),
      today: this.today(),
      adjustments: this.store.listAdjustments(),
    };
    if (!setup) return { ...base, schedule: null, summary: null };

    const schedule = this.build(setup);
    const months = new Map(this.store.listMonths().map((m) => [m.payment, m]));
    const rows: MonthView[] = schedule.rows.map((r) => {
      const m = months.get(r.payment);
      return {
        ...r,
        status: m?.status ?? 'scheduled',
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
        currentPayment: rows.find((r) => r.status !== 'paid')?.payment ?? null,
      },
      summary: summarize(setup, schedule, this.paidSet(), this.today()),
    };
  }

  sourceStatus(): SourceStatus {
    return this.source.status();
  }

  /** Read-only snapshot for dashboards. Null when the loan is not set up. */
  summary(): LoanSummary | null {
    const setup = this.store.getSetup();
    return setup ? summarize(setup, this.build(setup), this.paidSet(), this.today()) : null;
  }

  saveSetup(body: unknown) {
    const setup = parseSetup(body);
    this.build(setup); // throws a readable 400 if the schedule cannot be generated
    this.store.saveSetup(setup);
    return this.state();
  }

  saveSettings(body: unknown) {
    const b = (body ?? {}) as Record<string, unknown>;
    const categoryId = typeof b.categoryId === 'string' && b.categoryId ? b.categoryId : null;
    this.store.saveSettings({ ...this.store.getSettings(), categoryId });
    return this.store.getSettings();
  }

  categories(): Promise<CategoryGroup[]> {
    return this.source.getCategories();
  }

  private async fetchAround(categoryId: string, due: ISODate, before: number, after: number) {
    return this.source.getTransactionsInCategory(categoryId, addDays(due, -before), addDays(due, after));
  }

  private categoryOrThrow(categoryId: unknown): string {
    const id = typeof categoryId === 'string' && categoryId ? categoryId : this.store.getSettings().categoryId;
    if (!id) throw new HttpError(400, 'Pick the mortgage category first');
    return id;
  }

  async candidates(payment: number, categoryId: unknown, wide = false): Promise<Candidate[]> {
    const setup = this.requireSetup();
    const row = this.row(this.build(setup), payment);
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
    const row = this.row(this.build(setup), payment);
    const existing = this.store.getMonth(payment);
    if (existing?.status === 'paid') throw new HttpError(409, `Payment ${payment} is already reconciled. Undo it first.`);
    const usedBy = this.store.monthForTransaction(transactionId);
    if (usedBy !== null && usedBy !== payment) {
      throw new HttpError(409, `That transaction is already matched to payment ${usedBy}`);
    }

    const cat = this.categoryOrThrow(b.categoryId);
    const txn = (await this.fetchAround(cat, row.dueDate, WIDE_WINDOW, WIDE_WINDOW)).find((t) => t.id === transactionId);
    if (!txn) throw new HttpError(404, 'That transaction was not found in the mortgage category near this due date');
    if (txn.amount >= 0) throw new HttpError(400, 'That transaction is a deposit, not a payment');

    const cmp = compareToSchedule(row, txn.amount);
    // Re-matching a flagged month to a different transaction starts it over.
    this.store.transaction(() => {
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
      suggestions: cmp.matches ? [] : suggestionsFor(cmp.difference),
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

    this.store.transaction(() => {
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
    this.store.transaction(() => {
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
    this.row(this.build(setup), payment);
    if (this.store.getMonth(payment)?.status === 'paid') {
      throw new HttpError(409, `Payment ${payment} is reconciled and locked. Undo it first.`);
    }
    this.store.transaction(() => {
      this.store.deleteManualOffset(payment);
      if (amount !== 0) this.store.addAdjustment({ kind: 'pennyOffset', payment, amount: amount as number }, null);
    });
    return this.state();
  }
}
