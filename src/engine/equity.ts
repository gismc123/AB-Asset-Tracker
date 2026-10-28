import { latestHomeValue, settledRows, type HomeValueEstimate } from './summary.js';
import type { Cents, ISODate, LoanSetup, Schedule } from './types.js';

export interface EquityMilestone {
  /** Equity as a percent of the home value. */
  percent: number;
  reached: boolean;
  /** First scheduled payment that gets there, if not reached yet. */
  payment: number | null;
  dueDate: ISODate | null;
}

export interface EquityPoint {
  payment: number;
  dueDate: ISODate;
  /** Balance plus any deferred amount still owed after this payment. */
  owed: Cents;
  equity: Cents;
}

export interface EquityAnalysis {
  /** Latest estimate, or the original home value when there is none. */
  homeValue: Cents;
  homeValueAsOf: ISODate | null;
  homeValueSource: string;
  isEstimate: boolean;
  balance: Cents;
  deferredBalance: Cents;
  /** Missed payments not yet caught up. */
  pastDue: Cents;
  owed: Cents;
  equity: Cents;
  equityPercent: number;
  /** Loan-to-value against `homeValue`, in percent. */
  ltv: number;
  /** How the equity was built. The parts add up to `equity`. */
  parts: {
    /** Down payment: original home value minus the amount borrowed. */
    startingEquity: Cents;
    /** Regular principal paid so far. */
    principalPaid: Cents;
    extraPrincipal: Cents;
    /**
     * Extra principal paid before tracking began, at times unknown: the gap
     * between the original schedule and the starting balance. Negative when
     * the real balance was higher.
     */
    extraBeforeTracking: Cents;
    /** Skipped payments: interest added, or payments deferred or past due (zero or negative). */
    skipped: Cents;
    /** Home value change since purchase (zero without an estimate). */
    marketChange: Cents;
  };
  milestones: EquityMilestone[];
  /** Equity after every payment on the schedule, at today's home value. */
  projection: EquityPoint[];
  /** Index into `projection` of the last settled payment, or -1. */
  settledIndex: number;
}

const MILESTONES = [20, 22, 25, 50, 75, 100];
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 10_000) / 100 : 0);

/**
 * Equity today and how it was built, plus when the schedule reaches common
 * equity milestones. Future points assume the home keeps today's value.
 */
export function analyzeEquity(
  setup: LoanSetup,
  schedule: Schedule,
  paid: ReadonlySet<number>,
  today: ISODate,
  homeValues: readonly HomeValueEstimate[] = [],
): EquityAnalysis {
  const estimate = latestHomeValue(homeValues);
  const homeValue = estimate?.value ?? setup.originalHomeValue;
  const settled = settledRows(schedule.rows, paid, today);
  const settledSet = new Set(settled.map((r) => r.payment));

  let deferred = 0;
  let pastDue = 0;
  let settledIndex = -1;
  const owedExtra: { deferred: number; pastDue: number }[] = [];
  const projection: EquityPoint[] = schedule.rows.map((r, i) => {
    deferred += r.deferred - r.deferredRepaid;
    pastDue += r.pastDue - (r.catchUp?.total ?? 0);
    owedExtra.push({ deferred, pastDue });
    if (settledSet.has(r.payment)) settledIndex = i;
    const owed = r.endingBalance + deferred + pastDue;
    return { payment: r.payment, dueDate: r.dueDate, owed, equity: homeValue - owed };
  });

  const last = settledIndex >= 0 ? projection[settledIndex]! : null;
  const balance = settledIndex >= 0 ? schedule.rows[settledIndex]!.endingBalance : setup.originalAmount;
  const owed = last ? last.owed : setup.originalAmount;
  const equity = homeValue - owed;

  let principalPaid = 0;
  let extraPrincipal = 0;
  let extraBeforeTracking = 0;
  for (const r of settled) {
    principalPaid += r.catchUp?.principal ?? 0;
    if (r.skipped) continue;
    principalPaid += r.scheduledPrincipal + r.pennyOffset;
    if (r.beforeTracking) extraBeforeTracking += r.extraPrincipal;
    else extraPrincipal += r.extraPrincipal;
  }
  const startingEquity = setup.originalHomeValue - setup.originalAmount;
  const marketChange = homeValue - setup.originalHomeValue;
  // Whatever the paid principal doesn't explain comes from skipped months.
  const skipped = equity - (startingEquity + principalPaid + extraPrincipal + extraBeforeTracking + marketChange);

  const equityPercent = pct(equity, homeValue);
  const milestones = MILESTONES.map((percent): EquityMilestone => {
    if (equityPercent >= percent) return { percent, reached: true, payment: null, dueDate: null };
    const target = homeValue * (percent / 100);
    const hit = projection.slice(settledIndex + 1).find((p) => p.equity >= target - 0.5);
    return { percent, reached: false, payment: hit?.payment ?? null, dueDate: hit?.dueDate ?? null };
  });

  return {
    homeValue,
    homeValueAsOf: estimate?.date ?? null,
    homeValueSource: estimate?.source ?? 'Original home value',
    isEstimate: estimate !== null,
    balance,
    deferredBalance: settledIndex >= 0 ? owedExtra[settledIndex]!.deferred : 0,
    pastDue: settledIndex >= 0 ? owedExtra[settledIndex]!.pastDue : 0,
    owed,
    equity,
    equityPercent,
    ltv: pct(owed, homeValue),
    parts: { startingEquity, principalPaid, extraPrincipal, extraBeforeTracking, skipped, marketChange },
    milestones,
    projection,
    settledIndex,
  };
}
