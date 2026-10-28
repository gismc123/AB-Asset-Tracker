import { currentValue, hasProjection, homeAssetFor, projectedValue, type Asset } from './assets.js';
import { settledRows } from './summary.js';
import type { Cents, ISODate, LoanSetup, Schedule } from './types.js';

export interface EquityMilestone {
  /** Equity as a percent of the asset's value. 0 means owing less than it's worth. */
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
  /** The asset's value at that point: today's value, or the projected curve when the asset has one. */
  value: Cents;
  equity: Cents;
}

export interface EquityAnalysis {
  /** Latest value entered, or the asset's original value when there is none. */
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
    /** The asset's original value minus the amount borrowed (the down payment, for most loans). */
    startingEquity: Cents;
    /** The down payment from the setup, when entered. Part of `startingEquity`. */
    downPayment: Cents | null;
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
    /** Value change since purchase (zero without an estimate). */
    marketChange: Cents;
  };
  /** True when every point follows the asset's projected value curve rather than today's value. */
  projected: boolean;
  milestones: EquityMilestone[];
  /** Equity after every payment on the schedule, at today's home value. */
  projection: EquityPoint[];
  /** Index into `projection` of the last settled payment, or -1. */
  settledIndex: number;
}

/** Homes: the PMI-related lines and round numbers. Anything else: owing less than it's worth, then round numbers. */
const HOME_MILESTONES = [20, 22, 25, 50, 75, 100];
const OTHER_MILESTONES = [0, 25, 50, 75, 100];
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 10_000) / 100 : 0);

/**
 * Equity today and how it was built, plus when the schedule reaches common
 * equity milestones. Every point keeps today's value, or, when the asset
 * has a projected curve, follows that curve (anchored on the values entered)
 * so the line has no jump at today. `asset` defaults to the home described
 * by the setup (how every loan worked before assets).
 */
export function analyzeEquity(
  setup: LoanSetup,
  schedule: Schedule,
  paid: ReadonlySet<number>,
  today: ISODate,
  asset: Asset = homeAssetFor(setup),
): EquityAnalysis {
  const current = currentValue(asset);
  const estimate = current.entered ? current : null;
  const homeValue = current.value;
  const projected = hasProjection(asset);
  const valueAt = (date: ISODate) => (projected ? projectedValue(asset, date, setup.openDate) : homeValue);
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
    const value = valueAt(r.dueDate);
    return { payment: r.payment, dueDate: r.dueDate, owed, value, equity: value - owed };
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
  const startingEquity = asset.originalValue - setup.originalAmount;
  const marketChange = homeValue - asset.originalValue;
  // Whatever the paid principal doesn't explain comes from skipped months.
  const skipped = equity - (startingEquity + principalPaid + extraPrincipal + extraBeforeTracking + marketChange);

  const equityPercent = pct(equity, homeValue);
  const milestones = (asset.kind === 'home' ? HOME_MILESTONES : OTHER_MILESTONES).map((percent): EquityMilestone => {
    if (equityPercent >= percent) return { percent, reached: true, payment: null, dueDate: null };
    const hit = projection.slice(settledIndex + 1).find((p) => p.equity >= p.value * (percent / 100) - 0.5);
    return { percent, reached: false, payment: hit?.payment ?? null, dueDate: hit?.dueDate ?? null };
  });

  return {
    homeValue,
    homeValueAsOf: estimate?.date ?? null,
    homeValueSource: estimate?.source ?? (asset.kind === 'home' ? 'Original home value' : 'Original value'),
    isEstimate: estimate !== null,
    balance,
    deferredBalance: settledIndex >= 0 ? owedExtra[settledIndex]!.deferred : 0,
    pastDue: settledIndex >= 0 ? owedExtra[settledIndex]!.pastDue : 0,
    owed,
    equity,
    equityPercent,
    ltv: pct(owed, homeValue),
    parts: { startingEquity, downPayment: setup.downPayment ?? null, principalPaid, extraPrincipal, extraBeforeTracking, skipped, marketChange },
    projected,
    milestones,
    projection,
    settledIndex,
  };
}
