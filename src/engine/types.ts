/**
 * Core types for the loan engine. It knows nothing about loan types: a
 * mortgage, a car loan and a personal loan are the same amortizing loan with
 * different optional modules (PMI, escrow) turned on.
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
 * - `untilRemoved`: PMI stays on every payment until a PMI change of zero
 *   is recorded, however far the balance falls. For a servicer that keeps
 *   charging it past the milestones, insurance that runs for the life of
 *   the loan, or removal on a new appraisal.
 *
 * For the first three rules, the federal automatic date and the loan
 * midpoint act as a backstop: PMI never stays on the schedule past either
 * of them, unless a PMI change recorded after that point says otherwise.
 */
export type PmiRemovalRule = 'auto78Scheduled' | 'auto78Actual' | 'request80' | 'untilRemoved';

/**
 * Where tracking starts on a loan that was already under way when it was set
 * up. Payments 1 to `payment` count as made, with the original schedule's
 * amounts, and are never reconciled. The difference between the original
 * schedule's balance after `payment` and the real `balance` is extra
 * principal paid at some unknown point before tracking began; it is
 * recorded on that last payment.
 */
export interface StartingPoint {
  /** The last payment made before tracking began. */
  payment: number;
  /** Principal balance right after that payment, from a statement. */
  balance: Cents;
}

/** Optional parts of a loan. Mortgages have both; car and personal loans usually neither. */
export interface LoanModules {
  /** Private mortgage insurance, with its federal removal rules. */
  pmi: boolean;
  /** Tax and insurance collected with each payment and paid from an escrow account. */
  escrow: boolean;
}

/**
 * How interest is worked out for each payment.
 *
 * - `monthly`: balance x rate / 12. How most mortgages are serviced.
 * - `daily`: simple interest, balance x rate / 365 x the days since the
 *   previous payment (from the loan open date for the first one). Once a
 *   payment is matched to a bank transaction, its real date is used, so an
 *   early or late payment changes the split between interest and principal.
 *   How many car and personal loans work.
 */
export type InterestMethod = 'monthly' | 'daily';

/**
 * A cost charged once, such as a processing fee, credit insurance or a
 * late charge. Without a date it was paid when the loan was opened.
 *
 * - `financed`: added to the amount borrowed when the loan was opened, so
 *   it's already in `originalAmount`. Informational.
 * - `addedToBalance` (needs a date after the open date): added to the
 *   balance on that date; interest accrues on it and it's paid off with the
 *   regular payments, so the loan runs a little longer.
 * - neither: paid separately, up front or on its date. Shown on the
 *   schedule and in the totals, but never part of the balance or of the
 *   payment the bank transaction is matched against.
 */
export interface OneOffFee {
  label: string;
  amount: Cents;
  financed: boolean;
  /** When it was charged. Missing or null: when the loan was opened. */
  date?: ISODate | null;
  addedToBalance?: boolean;
}

/** A one-off fee that falls inside the schedule, as applied to a row. */
export interface DatedFee {
  label: string;
  date: ISODate;
  amount: Cents;
  addedToBalance: boolean;
}

/**
 * A fee charged once a year with the first payment of each loan year
 * (payments 1, 13, 25 and so on), as a percent of the original amount or of
 * the balance at that payment.
 */
export interface YearlyFee {
  basis: 'original' | 'balance';
  percent: number;
  /**
   * `payment` (missing = this): part of the payment total, so the bank
   * transaction includes it. `separately`: charged on its own; on the
   * schedule and in the totals, but not expected in the payment.
   */
  collect?: 'payment' | 'separately';
}

/** A payoff amount quoted by the lender, used instead of the estimate until it expires. */
export interface PayoffQuote {
  amount: Cents;
  goodThrough: ISODate;
}

export interface LoanSetup {
  /** Original loan amount (principal borrowed). */
  originalAmount: Cents;
  /** Annual interest rate as a percent, e.g. 6.5 for 6.5%. */
  annualRatePercent: number;
  termYears: number;
  /** Term in months, for terms that aren't whole years. When set, it wins over `termYears`. */
  termMonths?: number | null;
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

  /**
   * Original property value for the PMI rules: usually the lower of purchase
   * price and appraisal. Only used when the PMI module is on.
   */
  originalHomeValue: Cents;
  pmiMonthly: Cents;
  /** Payments due on or after this date carry PMI. Null = from the first payment. */
  pmiStartDate: ISODate | null;
  pmiRemovalRule: PmiRemovalRule;

  escrowMonthly: Cents;
  /** Standing extra principal added to every payment. */
  extraPrincipal: Cents;
  /** Set for a loan that was already under way. Missing or null = tracked from payment 1. */
  startingPoint?: StartingPoint | null;

  /** Missing = both on, as every loan saved before modules existed was a mortgage. */
  modules?: LoanModules;
  /** Missing = monthly. */
  interestMethod?: InterestMethod;
  /** Paid up front toward the purchase. Informational; equity uses the asset's value. */
  downPayment?: Cents | null;
  fees?: OneOffFee[];
  yearlyFee?: YearlyFee | null;
  payoffQuote?: PayoffQuote | null;
}

/**
 * How a skipped payment is handled. Servicers differ, so confirm yours:
 *
 * - `catchUp`: a hardship grace period. Nothing is paid now; the whole
 *   missed payment (P&I, PMI and escrow) becomes past due and is paid back in
 *   later months, per a catch-up plan. Nothing is forgiven, no interest is
 *   added, and the loan's length doesn't change.
 * - `capitalize`: nothing is paid; the month's interest is added to the
 *   balance and the same monthly payment continues, so the loan runs longer.
 *   Typical of "skip-a-payment" programs.
 * - `defer`: nothing is paid; the missed principal and interest move to a
 *   separate, interest-free balance due in one lump sum when the loan is paid
 *   off. Typical of payment deferral after forbearance.
 *
 * Either way no PMI or escrow is collected that month.
 */
export type SkipMode = 'catchUp' | 'capitalize' | 'defer';

/** The parts of a missed payment, or of a catch-up amount paid back later. */
export interface PaymentParts {
  principal: Cents;
  interest: Cents;
  pmi: Cents;
  escrow: Cents;
  total: Cents;
}

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
  | { kind: 'skip'; payment: number; mode: SkipMode }
  /**
   * Pay back everything past due from `catchUp` skips, spread evenly over
   * `months` payments starting with `fromPayment`.
   */
  | { kind: 'catchUpPlan'; fromPayment: number; months: number };

export type AdjustmentKind = Adjustment['kind'];

/**
 * Extra principal paid in a transaction of its own, on its own date, apart
 * from the regular payment. It lowers the balance from that date: on a
 * monthly-interest loan from the next payment's interest, on a
 * daily-interest loan from the day it was paid.
 */
export interface ExtraPayment {
  /** Its id in the database; null for a hypothetical one (what-if). */
  id: number | null;
  date: ISODate;
  amount: Cents;
}

export interface ScheduleRow {
  payment: number;
  dueDate: ISODate;
  beginningBalance: Cents;
  interest: Cents;
  /** Principal portion of the required P&I payment. */
  scheduledPrincipal: Cents;
  /**
   * Extra principal paid this month. On the last payment before tracking it
   * holds the extra paid before tracking began, and can be negative when the
   * real balance is higher than the original schedule's.
   */
  extraPrincipal: Cents;
  pennyOffset: Cents;
  /**
   * Extra principal paid in transactions of their own and applied with this
   * row: on a monthly-interest loan, those dated from this due date up to
   * the next; on a daily-interest loan, those dated in this interest period.
   * Part of `principal`, not of `total` (they are separate transactions).
   */
  extraPayments: Cents;
  /** Each of those payments, with the amount applied (less than paid only when it would overpay the loan). */
  extraPaymentList: ExtraPayment[];
  /** Total principal paid this month: scheduled + extra + offset + extra payments. */
  principal: Cents;
  /** Required P&I for this month (the last payment is usually smaller). */
  principalAndInterest: Cents;
  pmi: Cents;
  escrow: Cents;
  /** Yearly fee charged with this payment (see `YearlyFee`). */
  fee: Cents;
  /** Yearly fee charged separately at this payment. Not part of `total`. */
  separateFee: Cents;
  /** One-off fees dated in this row and paid separately. Not part of `total` or the balance. */
  oneOffFees: Cents;
  /** One-off fees dated in this row and added to the balance. */
  feesAdded: Cents;
  /** Each dated one-off fee in this row. */
  oneOffFeeList: DatedFee[];
  /** The payment the bank transaction should match: P&I + extra + offset + PMI + escrow + fee. */
  total: Cents;
  endingBalance: Cents;
  /** True when the row came from locked, reconciled actual amounts. */
  locked: boolean;
  /** Made before tracking began (see `StartingPoint`): amounts are the original schedule's. */
  beforeTracking: boolean;
  /** Set when this payment is skipped. A skipped row has `total` 0. */
  skipped: SkipMode | null;
  /** Interest added to the balance by a `capitalize` skip (not paid that month). */
  capitalizedInterest: Cents;
  /** Principal and interest moved to the deferred balance by a `defer` skip. */
  deferred: Cents;
  /** On the final payment: the deferred balance repaid as a lump sum (included in `total`). */
  deferredRepaid: Cents;
  /** On a `catchUp` skip: the whole missed payment, now past due. */
  pastDue: Cents;
  /** Past-due amounts paid back with this payment (included in `total`). */
  catchUp: PaymentParts | null;
}

/**
 * Amounts frozen when a month is reconciled as paid: the regular payment
 * only. Extra payments of their own are applied on top, so adding or
 * removing one never touches a reconciled month.
 */
export type LockedPayment = Omit<
  ScheduleRow,
  | 'beginningBalance' | 'endingBalance' | 'locked' | 'dueDate' | 'beforeTracking'
  | 'extraPayments' | 'extraPaymentList' | 'separateFee' | 'oneOffFees' | 'feesAdded' | 'oneOffFeeList'
>;

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
    /** Yearly fees on the schedule, in the payment or charged separately. */
    fees: Cents;
    /** Dated one-off fees on the schedule paid separately (undated ones are in the setup). */
    oneOffFees: Cents;
    /** Dated one-off fees added to the balance. */
    feesAdded: Cents;
    payments: number;
    capitalizedInterest: Cents;
    deferred: Cents;
    pastDue: Cents;
  };
}
