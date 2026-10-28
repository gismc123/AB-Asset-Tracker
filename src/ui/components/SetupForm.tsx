import { useMemo, useState } from 'react';
import {
  dueDateFor,
  generateSchedule,
  isValidISODate,
  modulesOf,
  standardPayment,
  termMonthsOf,
  validateSetup,
  type InterestMethod,
  type LoanSetup,
  type PmiRemovalRule,
} from '../../engine/index.js';
import type { LoanType } from '../api.js';
import { centsToInput, date, parseDollars } from '../format.js';
import { Amt } from './Amt.js';

interface Props {
  type: LoanType;
  initial: LoanSetup | null;
  /** True once months are reconciled: they keep their locked amounts. */
  hasReconciled: boolean;
  onSave(setup: LoanSetup): Promise<void>;
  /** Extra fields shown first, inside the same form (the add-loan wizard's name and asset). */
  header?: React.ReactNode;
  /** Problems with the header's fields, checked along with the setup's. */
  headerProblems?: string[];
  /**
   * For a new mortgage: the home's purchase price, used as the original
   * home value for PMI instead of asking twice. Edit it later under Setup.
   */
  homeValueFromAsset?: number | null;
  submitLabel?: string;
}

type Draft = Record<
  | 'originalAmount' | 'annualRatePercent' | 'termYears' | 'termMonths' | 'openDate' | 'firstPaymentDate' | 'paymentDay'
  | 'piPaymentOverride' | 'originalHomeValue' | 'pmiMonthly' | 'pmiStartDate' | 'escrowMonthly' | 'extraPrincipal'
  | 'startDate' | 'startBalance' | 'downPayment' | 'yearlyFeePercent' | 'quoteAmount' | 'quoteDate',
  string
> & {
  pmiRemovalRule: PmiRemovalRule;
  underway: boolean;
  pmiOn: boolean;
  escrowOn: boolean;
  interestMethod: InterestMethod;
  yearlyFeeBasis: 'none' | 'original' | 'balance';
  fees: { label: string; amount: string; financed: boolean }[];
};

const canDate = (first: string, day: number) => isValidISODate(first) && Number.isInteger(day) && day >= 1 && day <= 31;

/** How many payments fall due on or before `date`. */
function paymentsDueBy(first: string, day: number, date: string, max: number): number {
  let n = 0;
  while (n < max && dueDateFor(first, day, n + 1) <= date) n++;
  return n;
}

function toDraft(s: LoanSetup | null, type: LoanType): Draft {
  const start = s?.startingPoint;
  const mortgage = type === 'mortgage';
  const modules = s ? modulesOf(s) : { pmi: mortgage, escrow: mortgage };
  return {
    underway: !!start,
    startDate: start && canDate(s.firstPaymentDate, s.paymentDay) ? dueDateFor(s.firstPaymentDate, s.paymentDay, start.payment) : '',
    startBalance: centsToInput(start?.balance),
    originalAmount: centsToInput(s?.originalAmount),
    annualRatePercent: s ? String(s.annualRatePercent) : '',
    termYears: s ? String(s.termYears) : '30',
    termMonths: s ? String(termMonthsOf(s)) : type === 'auto' ? '60' : '36',
    openDate: s?.openDate ?? '',
    firstPaymentDate: s?.firstPaymentDate ?? '',
    paymentDay: s ? String(s.paymentDay) : '1',
    piPaymentOverride: centsToInput(s?.piPaymentOverride),
    originalHomeValue: s?.originalHomeValue ? centsToInput(s.originalHomeValue) : '',
    pmiMonthly: centsToInput(s?.pmiMonthly ?? 0),
    pmiStartDate: s?.pmiStartDate ?? '',
    pmiRemovalRule: s?.pmiRemovalRule ?? 'auto78Scheduled',
    escrowMonthly: centsToInput(s?.escrowMonthly ?? 0),
    extraPrincipal: centsToInput(s?.extraPrincipal ?? 0),
    pmiOn: modules.pmi,
    escrowOn: modules.escrow,
    interestMethod: s?.interestMethod ?? 'monthly',
    downPayment: centsToInput(s?.downPayment),
    fees: (s?.fees ?? []).map((f) => ({ label: f.label, amount: centsToInput(f.amount), financed: f.financed })),
    yearlyFeeBasis: s?.yearlyFee ? s.yearlyFee.basis : 'none',
    yearlyFeePercent: s?.yearlyFee ? String(s.yearlyFee.percent) : '',
    quoteAmount: centsToInput(s?.payoffQuote?.amount),
    quoteDate: s?.payoffQuote?.goodThrough ?? '',
  };
}

function fromDraft(d: Draft, type: LoanType, homeValueFromAsset: number | null | undefined): LoanSetup {
  const cents = (v: string) => parseDollars(v) ?? Number.NaN;
  const optional = (v: string) => (v.trim() ? cents(v) : 0);
  const mortgage = type === 'mortgage';
  const day = Number(d.paymentDay);
  const months = mortgage ? Number(d.termYears) * 12 : Number(d.termMonths);
  const startPayment =
    canDate(d.firstPaymentDate, day) && isValidISODate(d.startDate) ? paymentsDueBy(d.firstPaymentDate, day, d.startDate, months) : Number.NaN;
  const pmiOn = mortgage && d.pmiOn;
  const escrowOn = mortgage && d.escrowOn;
  const homeValue = homeValueFromAsset !== undefined ? (homeValueFromAsset ?? Number.NaN) : cents(d.originalHomeValue);
  const setup: LoanSetup = {
    originalAmount: cents(d.originalAmount),
    annualRatePercent: d.annualRatePercent.trim() === '' ? Number.NaN : Number(d.annualRatePercent),
    termYears: mortgage ? Number(d.termYears) : Math.max(1, Math.ceil(months / 12)),
    openDate: d.openDate,
    firstPaymentDate: d.firstPaymentDate,
    paymentDay: day,
    piPaymentOverride: d.piPaymentOverride.trim() ? cents(d.piPaymentOverride) : null,
    originalHomeValue: pmiOn ? homeValue : 0,
    pmiMonthly: pmiOn ? optional(d.pmiMonthly) : 0,
    pmiStartDate: pmiOn ? d.pmiStartDate || null : null,
    pmiRemovalRule: d.pmiRemovalRule,
    escrowMonthly: escrowOn ? optional(d.escrowMonthly) : 0,
    extraPrincipal: optional(d.extraPrincipal),
    startingPoint: d.underway ? { payment: startPayment, balance: cents(d.startBalance) } : null,
    modules: { pmi: pmiOn, escrow: escrowOn },
    interestMethod: d.interestMethod,
    downPayment: d.downPayment.trim() ? cents(d.downPayment) : null,
    fees: d.fees
      .filter((f) => f.label.trim() || f.amount.trim())
      .map((f) => ({ label: f.label.trim(), amount: cents(f.amount), financed: f.financed })),
    yearlyFee: d.yearlyFeeBasis === 'none' ? null : { basis: d.yearlyFeeBasis, percent: d.yearlyFeePercent.trim() ? Number(d.yearlyFeePercent) : Number.NaN },
    payoffQuote: d.quoteAmount.trim() || d.quoteDate ? { amount: cents(d.quoteAmount), goodThrough: d.quoteDate } : null,
  };
  if (!mortgage) setup.termMonths = months;
  return setup;
}

const RULES: { value: PmiRemovalRule; title: string; text: string }[] = [
  {
    value: 'auto78Scheduled',
    title: 'Automatic at 78% (recommended)',
    text: 'The federal automatic-termination date, based on the original schedule. Extra payments don\'t move it.',
  },
  {
    value: 'auto78Actual',
    title: 'Automatic at 78% of my real balance',
    text: 'Use if your servicer confirms it drops PMI based on the actual balance, including extra payments.',
  },
  {
    value: 'request80',
    title: 'I will request removal at 80%',
    text: 'You ask the servicer in writing once the real balance reaches 80%. Extra payments pull this earlier.',
  },
];

function Money({ id, label, hint, value, onChange, placeholder }: {
  id: string; label: string; hint?: React.ReactNode; value: string; onChange(v: string): void; placeholder?: string;
}) {
  return (
    <div className="mt-field">
      <label htmlFor={`mt-${id}`}>{label}</label>
      <div className="mt-prefix">
        <span>$</span>
        <input id={`mt-${id}`} className="mt-input" inputMode="decimal" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      </div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mt-field">
      <label htmlFor={`mt-${id}`}>{label}</label>
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

function Toggle({ checked, onChange, children }: { checked: boolean; onChange(v: boolean): void; children: React.ReactNode }) {
  return (
    <label className="mt-row" style={{ cursor: 'pointer', marginBottom: 12 }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  );
}

const PLACEHOLDERS: Record<LoanType, { amount: string; rate: string }> = {
  mortgage: { amount: '320,000.00', rate: '6.5' },
  auto: { amount: '30,000.00', rate: '6.9' },
  personal: { amount: '12,000.00', rate: '11.5' },
};

/** Loan setup for any loan type. Previews the payment (and PMI dates) as you type. */
export function SetupForm({ type, initial, hasReconciled, onSave, header, headerProblems = [], homeValueFromAsset, submitLabel }: Props) {
  const [d, setD] = useState<Draft>(() => toDraft(initial, type));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ message: string; problems: string[] } | null>(null);
  const [saved, setSaved] = useState(false);
  const set = (k: keyof Draft) => (v: string) => {
    setSaved(false);
    setD((prev) => ({ ...prev, [k]: v }));
  };
  const flag = (k: 'pmiOn' | 'escrowOn' | 'underway') => (v: boolean) => {
    setSaved(false);
    setD((prev) => ({ ...prev, [k]: v }));
  };
  const mortgage = type === 'mortgage';

  const setup = useMemo(() => fromDraft(d, type, homeValueFromAsset), [d, type, homeValueFromAsset]);
  const problems = useMemo(() => [...headerProblems, ...validateSetup(setup)], [setup, headerProblems]);
  const preview = useMemo(() => {
    if (validateSetup(setup).length) return null;
    try {
      return generateSchedule(setup);
    } catch {
      return null;
    }
  }, [setup]);
  const calculated = useMemo(() => {
    const months = termMonthsOf(setup);
    const ok = setup.originalAmount > 0 && setup.annualRatePercent >= 0 && months > 0 && Number.isInteger(months);
    return ok ? standardPayment(setup.originalAmount, setup.annualRatePercent, months) : null;
  }, [setup]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (problems.length) {
      setError({ message: 'Please fix these first:', problems });
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(setup);
      setSaved(true);
    } catch (err) {
      const e2 = err as Error & { problems?: string[] };
      setError({ message: e2.message, problems: e2.problems ?? [] });
    } finally {
      setSaving(false);
    }
  };

  const setFee = (i: number, patch: Partial<Draft['fees'][number]>) => {
    setSaved(false);
    setD((p) => ({ ...p, fees: p.fees.map((f, k) => (k === i ? { ...f, ...patch } : f)) }));
  };

  return (
    <form onSubmit={submit} noValidate>
      {header}
      {!initial && !header && (
        <div className="mt-note" style={{ marginBottom: 14 }}>
          Enter the loan once, straight from your loan documents. You can change anything later. Been paying on it for a while?
          Enter the original terms anyway, then where the loan stands today under <b>Already paying on this loan?</b>
        </div>
      )}
      {initial && hasReconciled && (
        <div className="mt-note warn" style={{ marginBottom: 14 }}>
          Months you've already reconciled keep their locked amounts. Changes apply to the rest of the schedule.
        </div>
      )}

      <div className="mt-card">
        <h3>Loan</h3>
        <div className="mt-form-section">
          <Money id="originalAmount" label="Original loan amount" value={d.originalAmount} onChange={set('originalAmount')} placeholder={PLACEHOLDERS[type].amount} />
          <Field id="annualRatePercent" label="Interest rate" hint="The note rate (APR includes fees, so it's usually higher).">
            <div className="mt-suffix">
              <input id="mt-annualRatePercent" className="mt-input" inputMode="decimal" value={d.annualRatePercent} placeholder={PLACEHOLDERS[type].rate} onChange={(e) => set('annualRatePercent')(e.target.value)} />
              <span>%</span>
            </div>
          </Field>
          {mortgage ? (
            <Field id="termYears" label="Term">
              <select id="mt-termYears" className="mt-select" style={{ width: '100%' }} value={d.termYears} onChange={(e) => set('termYears')(e.target.value)}>
                {[10, 15, 20, 25, 30, 40].map((y) => (
                  <option key={y} value={y}>{y} years</option>
                ))}
              </select>
            </Field>
          ) : (
            <Field id="termMonths" label="Term" hint="Number of monthly payments, e.g. 36, 60 or 72.">
              <div className="mt-suffix">
                <input id="mt-termMonths" type="number" min={1} max={600} className="mt-input" value={d.termMonths} onChange={(e) => set('termMonths')(e.target.value)} />
                <span style={{ right: 10 }}>months</span>
              </div>
            </Field>
          )}
          <Field id="openDate" label={mortgage ? 'Loan open (closing) date' : 'Loan start (contract) date'}>
            <input id="mt-openDate" type="date" className="mt-input" value={d.openDate} onChange={(e) => set('openDate')(e.target.value)} />
          </Field>
          <Field id="firstPaymentDate" label="First payment date">
            <input id="mt-firstPaymentDate" type="date" className="mt-input" value={d.firstPaymentDate} onChange={(e) => set('firstPaymentDate')(e.target.value)} />
          </Field>
          <Field id="paymentDay" label="Payment due day" hint="Day of the month. 29 to 31 move to the last day in short months.">
            <input id="mt-paymentDay" type="number" min={1} max={31} className="mt-input" value={d.paymentDay} onChange={(e) => set('paymentDay')(e.target.value)} />
          </Field>
          <Money
            id="piPaymentOverride"
            label={mortgage ? 'Principal & interest payment' : 'Monthly payment'}
            value={d.piPaymentOverride}
            onChange={set('piPaymentOverride')}
            placeholder={calculated !== null ? centsToInput(calculated) : 'calculated'}
            hint={
              calculated !== null
                ? <>Calculated: <Amt cents={calculated} />. Leave blank to use it, or type your statement's exact amount.</>
                : 'Calculated from the amount, rate, and term.'
            }
          />
          <Field id="interestMethod" label="Interest" hint={d.interestMethod === 'daily' ? 'Interest for the days since the last payment, using the date your bank paid.' : 'One twelfth of the yearly rate each month.'}>
            <select id="mt-interestMethod" className="mt-select" style={{ width: '100%' }} value={d.interestMethod} onChange={(e) => setD((p) => ({ ...p, interestMethod: e.target.value as InterestMethod }))}>
              <option value="monthly">Monthly (most mortgages)</option>
              <option value="daily">Daily simple interest (many car and personal loans)</option>
            </select>
          </Field>
        </div>
      </div>

      <div className="mt-gap" />
      <StartingPointCard d={d} flag={flag} set={set} setup={setup} preview={preview} />

      {mortgage && (
        <>
          <div className="mt-gap" />
          <div className="mt-card">
            <h3>PMI</h3>
            <Toggle checked={d.pmiOn} onChange={flag('pmiOn')}>
              This loan has private mortgage insurance (PMI)
            </Toggle>
            {d.pmiOn && (
              <>
                <div className="mt-form-section">
                  {homeValueFromAsset === undefined && (
                    <Money id="originalHomeValue" label="Original home value" value={d.originalHomeValue} onChange={set('originalHomeValue')} placeholder="355,000.00" hint="For the PMI rules. Lenders usually use the lower of the purchase price and the appraisal." />
                  )}
                  <Money id="pmiMonthly" label="Monthly PMI" value={d.pmiMonthly} onChange={set('pmiMonthly')} />
                  <Field id="pmiStartDate" label="PMI start date" hint="Blank = from the first payment.">
                    <input id="mt-pmiStartDate" type="date" className="mt-input" value={d.pmiStartDate} onChange={(e) => set('pmiStartDate')(e.target.value)} />
                  </Field>
                </div>
                {homeValueFromAsset !== undefined && (
                  <p className="mt-kpi-note">
                    The PMI rules use the purchase price above as the original home value. If your lender used a lower appraisal,
                    change it under Setup afterwards.
                  </p>
                )}
                <div className="mt-gap" />
                <div className="mt-field">
                  <label>When should the schedule drop PMI?</label>
                  <div className="mt-radio" role="radiogroup">
                    {RULES.map((r) => (
                      <label key={r.value}>
                        <input type="radio" name="mt-rule" checked={d.pmiRemovalRule === r.value} onChange={() => setD((p) => ({ ...p, pmiRemovalRule: r.value }))} />
                        <span>
                          <b>{r.title}</b>
                          <small>{r.text}</small>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
                {preview && preview.pmi.hasPmi && (
                  <div className="mt-note" style={{ marginTop: 14 }}>
                    80% balance (<Amt cents={preview.pmi.request80.thresholdBalance} whole />) at payment #{preview.pmi.request80.payment} ·{' '}
                    {date(preview.pmi.request80.dueDate)}
                    <br />
                    78% balance (<Amt cents={preview.pmi.auto78Scheduled.thresholdBalance} whole />) at payment #{preview.pmi.auto78Scheduled.payment} ·{' '}
                    {date(preview.pmi.auto78Scheduled.dueDate)}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="mt-gap" />
          <div className="mt-card">
            <h3>Escrow</h3>
            <Toggle checked={d.escrowOn} onChange={flag('escrowOn')}>
              Property tax and insurance are paid through an escrow account
            </Toggle>
            {d.escrowOn && (
              <div className="mt-form-section">
                <Money id="escrowMonthly" label="Monthly escrow" value={d.escrowMonthly} onChange={set('escrowMonthly')} hint="Collected with each payment." />
              </div>
            )}
          </div>
        </>
      )}

      <div className="mt-gap" />
      <div className="mt-card">
        <h3>Extras, fees &amp; payoff</h3>
        <div className="mt-form-section">
          <Money id="extraPrincipal" label="Standing extra principal" value={d.extraPrincipal} onChange={set('extraPrincipal')} hint="Added to every payment. 0 if none." />
          <Money id="downPayment" label="Down payment" value={d.downPayment} onChange={set('downPayment')} hint="Optional. Shown with how your equity was built." />
        </div>
        <details style={{ marginTop: 14 }} open={d.fees.length > 0 || d.yearlyFeeBasis !== 'none' || !!d.quoteAmount}>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Fees and payoff quote (optional)</summary>
          <div className="mt-field" style={{ marginTop: 12 }}>
            <label>One-off fees</label>
            {d.fees.map((f, i) => (
              <div className="mt-inline-form" key={i} style={{ marginBottom: 8 }}>
                <input className="mt-input" aria-label="Fee name" placeholder="e.g. Processing fee" value={f.label} onChange={(e) => setFee(i, { label: e.target.value })} />
                <div className="mt-prefix">
                  <span>$</span>
                  <input className="mt-input" aria-label="Fee amount" inputMode="decimal" value={f.amount} onChange={(e) => setFee(i, { amount: e.target.value })} />
                </div>
                <label className="mt-row" style={{ fontWeight: 400 }}>
                  <input type="checkbox" checked={f.financed} onChange={(e) => setFee(i, { financed: e.target.checked })} />
                  Added to the loan
                </label>
                <button type="button" className="mt-x" aria-label="Remove this fee" onClick={() => setD((p) => ({ ...p, fees: p.fees.filter((_, k) => k !== i) }))}>
                  ✕
                </button>
              </div>
            ))}
            <button type="button" className="mt-btn small" onClick={() => setD((p) => ({ ...p, fees: [...p.fees, { label: '', amount: '', financed: false }] }))}>
              Add a fee
            </button>
            <div className="hint">Processing, origination, credit insurance and the like, paid once. Counted in the cost of the loan.</div>
          </div>
          <div className="mt-form-section" style={{ marginTop: 14 }}>
            <Field id="yearlyFeeBasis" label="Yearly fee" hint="Charged with the first payment of each loan year.">
              <select id="mt-yearlyFeeBasis" className="mt-select" style={{ width: '100%' }} value={d.yearlyFeeBasis} onChange={(e) => setD((p) => ({ ...p, yearlyFeeBasis: e.target.value as Draft['yearlyFeeBasis'] }))}>
                <option value="none">None</option>
                <option value="original">Percent of the original amount</option>
                <option value="balance">Percent of the remaining balance</option>
              </select>
            </Field>
            {d.yearlyFeeBasis !== 'none' && (
              <Field id="yearlyFeePercent" label="Yearly fee rate">
                <div className="mt-suffix">
                  <input id="mt-yearlyFeePercent" className="mt-input" inputMode="decimal" value={d.yearlyFeePercent} placeholder="0.5" onChange={(e) => set('yearlyFeePercent')(e.target.value)} />
                  <span>%</span>
                </div>
              </Field>
            )}
            <Money id="quoteAmount" label="Payoff quote" value={d.quoteAmount} onChange={set('quoteAmount')} hint="From your lender. Used instead of the estimate until it expires." />
            <Field id="quoteDate" label="Quote good through">
              <input id="mt-quoteDate" type="date" className="mt-input" value={d.quoteDate} onChange={(e) => set('quoteDate')(e.target.value)} />
            </Field>
          </div>
        </details>
      </div>

      <div className="mt-gap" />
      {error && (
        <div className="mt-note bad" style={{ marginBottom: 12 }} role="alert">
          {error.message}
          {error.problems.length > 0 && (
            <ul>
              {error.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="mt-row">
        {preview && (
          <span style={{ color: 'var(--muted)' }}>
            {setup.startingPoint ? 'Next payment' : 'First payment'} <Amt cents={preview.rows[setup.startingPoint?.payment ?? 0]!.total} /> ·{' '}
            {preview.rows.length} payments · payoff {date(preview.rows.at(-1)!.dueDate, 'month')}
            {preview.totals.interest > 0 && <> · total interest <Amt cents={preview.totals.interest} whole /></>}
          </span>
        )}
        <span className="mt-spacer" />
        {saved && <span style={{ color: 'var(--good)', fontWeight: 600 }}>Saved</span>}
        <button type="submit" className="mt-btn primary" disabled={saving}>
          {saving ? 'Saving…' : (submitLabel ?? (initial ? 'Save changes' : 'Create schedule'))}
        </button>
      </div>
    </form>
  );
}

/** For a loan that was already under way: where tracking starts, from a recent statement. */
function StartingPointCard({ d, flag, set, setup, preview }: {
  d: Draft;
  flag(k: 'underway'): (v: boolean) => void;
  set(k: keyof Draft): (v: string) => void;
  setup: LoanSetup;
  preview: ReturnType<typeof generateSchedule> | null;
}) {
  const start = setup.startingPoint;
  const last = start && preview ? preview.rows[start.payment - 1] : undefined;
  const gap = last?.extraPrincipal ?? 0;

  return (
    <div className="mt-card">
      <h3>Already paying on this loan?</h3>
      <label className="mt-row" style={{ cursor: 'pointer' }}>
        <input type="checkbox" checked={d.underway} onChange={(e) => flag('underway')(e.target.checked)} />
        I've been making payments since before I started tracking it here
      </label>
      {d.underway && (
        <>
          <p style={{ color: 'var(--muted)' }}>
            Keep the original terms above, from your loan documents. Then enter the most recent payment and balance from a
            statement. Earlier payments count as paid, with nothing to reconcile. You don't need to know when you paid extra: the
            difference from the original schedule is worked out for you.
          </p>
          <div className="mt-form-section">
            <Field id="startDate" label="Due date of your last payment" hint="The most recent payment on the statement.">
              <input id="mt-startDate" type="date" className="mt-input" value={d.startDate} onChange={(e) => set('startDate')(e.target.value)} />
            </Field>
            <Money
              id="startBalance"
              label="Principal balance after it"
              value={d.startBalance}
              onChange={set('startBalance')}
              hint="The unpaid principal on that statement, not the payoff amount."
            />
          </div>
          {last && (
            <div className={`mt-note ${gap < 0 ? 'warn' : ''}`} style={{ marginTop: 14 }}>
              Payments 1–{last.payment} (through {date(last.dueDate)}) count as paid. Tracking starts with payment #{last.payment + 1}.
              <br />
              {gap > 0 && (
                <>
                  The original schedule expected <Amt cents={last.beginningBalance - last.scheduledPrincipal} /> by then, so you've
                  paid about <Amt cents={gap} /> in extra principal before tracking.
                </>
              )}
              {gap === 0 && 'Your balance matches the original schedule exactly.'}
              {gap < 0 && (
                <>
                  Your balance is <Amt cents={-gap} /> higher than the original schedule's{' '}
                  <Amt cents={last.beginningBalance - last.scheduledPrincipal} />. A few dollars is normal rounding; much more
                  usually means the rate, term or P&amp;I payment above doesn't match your note, or the loan was modified.
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
