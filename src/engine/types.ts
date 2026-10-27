/**
 * Core types for the mortgage engine.
 *
 * All money is stored as integer cents, the same unit Actual uses for
 * transaction amounts, so nothing ever drifts from floating point math.
 * Dates are plain `YYYY-MM-DD` strings.
 */

export type Cents = number;
export type ISODate = string;

/**
 * Which event removes PMI from the schedule.
 *
 * - `auto78Scheduled`: the federal automatic-termination date for a
 *   conventional loan, when the *original* amortization schedule reaches
 *   78% of the original value. Extra principal does not move this date.
 * - `auto78Actual`: when the real balance (including extra principal)
 *   reaches 78%. Some servicers act on this; confirm with yours.
 * - `request80`: when the real balance reaches 80% and you plan to ask the
 *   servicer to cancel PMI.
 *
 * Whatever the rule, the federal automatic date and the loan midpoint act as
 * a backstop: PMI never stays on the schedule past either of them.
 */
export type PmiRemovalRule = 'auto78Scheduled' | 'auto78Actual' | 'request80';

export interface LoanSetup {
  /** Original loan amount (principal borrowed). */
  originalAmount: Cents;
  /** Annual interest rate as a percent, e.g. 6.5 for 6.5%. */
  annualRatePercent: number;
  termYears: number;
  /** Closing / note date. Informational, and must not be after the first payment. */
  openDate: ISODate;
  firstPaymentDate: ISODate;
  /** Day of month each payment is due (1–31, clamped to the month's length). */
  paymentDay: number;
  /**
   * Required principal and interest payment. Leave null to use the
   * calculated value; set it to match the bank statement exactly.
   */
  piPaymentOverride: Cents | null;

  /** Original home value for PMI: usually the lower of purchase price and appraisal. */
  originalHomeValue: Cents;
  pmiMonthly: Cents;
  /** Payments due on or after this date carry PMI. Null = from the first payment. */
  pmiStartDate: ISODate | null;
  pmiRemovalRule: PmiRemovalRule;

  escrowMonthly: Cents;
  /** Standing extra principal added to every payment. */
  extraPrincipal: Cents;
}

/**
 * How a skipped payment is handled. Servicers differ, so confirm yours:
 *
 * - `capitalize`: nothing is paid; the month's interest is added to the
 *   balance and the same monthly payment continues, so the loan runs longer.
 *   Typical of "skip-a-payment" programs.
 * - `defer`: nothing is paid; the missed principal and interest move to a
 *   separate, interest-free balance due in one lump sum when the loan is paid
 *   off. Typical of payment deferral after forbearance.
 *
 * Either way no PMI or escrow is collected that month.
 */
export type SkipMode = 'capitalize' | 'defer';

/**
 * A change recorded against the schedule. Adjustments come from the
 * reconciliation flow (or are entered by hand) and are replayed every time
 * the schedule is generated, so later months always recalculate.
 */
export type Adjustment =
  /** Rounding difference on one payment, applied to that month's principal. */
  | { kind: 'pennyOffset'; payment: number; amount: Cents }
  /** One-time extra principal on one payment. */
  | { kind: 'extraPrincipal'; payment: number; amount: Cents }
  /** New standing extra principal from this payment onward. */
  | { kind: 'standingExtra'; fromPayment: number; amount: Cents }
  /** New monthly escrow amount from this payment onward. */
  | { kind: 'escrow'; fromPayment: number; amount: Cents }
  /** New monthly PMI amount from this payment onward (0 = servicer stopped PMI). */
  | { kind: 'pmi'; fromPayment: number; amount: Cents }
  /** This payment is skipped, with the servicer's approval. */
  | { kind: 'skip'; payment: number; mode: SkipMode };

export type AdjustmentKind = Adjustment['kind'];

export interface ScheduleRow {
  payment: number;
  dueDate: ISODate;
  beginningBalance: Cents;
  interest: Cents;
  /** Principal portion of the required P&I payment. */
  scheduledPrincipal: Cents;
  extraPrincipal: Cents;
  pennyOffset: Cents;
  /** Total principal paid this month: scheduled + extra + offset. */
  principal: Cents;
  /** Required P&I for this month (the last payment is usually smaller). */
  principalAndInterest: Cents;
  pmi: Cents;
  escrow: Cents;
  /** Everything that leaves your account: P&I + extra + offset + PMI + escrow. */
  total: Cents;
  endingBalance: Cents;
  /** True when the row came from locked, reconciled actual amounts. */
  locked: boolean;
  /** Set when this payment is skipped. A skipped row has `total` 0. */
  skipped: SkipMode | null;
  /** Interest added to the balance by a `capitalize` skip (not paid that month). */
  capitalizedInterest: Cents;
  /** Principal and interest moved to the deferred balance by a `defer` skip. */
  deferred: Cents;
  /** On the final payment: the deferred balance repaid as a lump sum (included in `total`). */
  deferredRepaid: Cents;
}

/** Amounts frozen when a month is reconciled as paid. */
export type LockedPayment = Omit<ScheduleRow, 'beginningBalance' | 'endingBalance' | 'locked' | 'dueDate'>;

export interface PmiMilestone {
  /** Balance at or below which the milestone is reached. */
  thresholdBalance: Cents;
  /** First payment whose ending balance is at or below the threshold. */
  payment: number | null;
  dueDate: ISODate | null;
}

export interface PmiInfo {
  /** False when the schedule never charges PMI (no PMI amount, or low loan-to-value). */
  hasPmi: boolean;
  /** Borrower may request cancellation: real balance (with extras) reaches 80%. */
  request80: PmiMilestone;
  /** Real balance (with extras) reaches 78%. */
  auto78Actual: PmiMilestone;
  /** Original schedule (no extras) reaches 78%: federal automatic termination. */
  auto78Scheduled: PmiMilestone;
  /** Original schedule reaches 80%, for comparison with request80. */
  request80Scheduled: PmiMilestone;
  /** Midpoint of the amortization period: federal final termination. */
  midpoint: { payment: number; dueDate: ISODate };
  /** First payment with no PMI, or null if PMI never drops within the schedule. */
  dropPayment: number | null;
  dropDate: ISODate | null;
  /** How many payments sooner extra principal reaches 80% than the original schedule. */
  paymentsSavedByExtra: number;
}

export interface Schedule {
  piPayment: Cents;
  calculatedPiPayment: Cents;
  rows: ScheduleRow[];
  pmi: PmiInfo;
  /**
   * Interest, principal, PMI and escrow actually collected (skipped months
   * contribute nothing), plus what the skips cost.
   */
  totals: {
    interest: Cents;
    principal: Cents;
    pmi: Cents;
    escrow: Cents;
    payments: number;
    capitalizedInterest: Cents;
    deferred: Cents;
  };
}
