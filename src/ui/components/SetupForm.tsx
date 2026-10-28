import { useMemo, useState } from 'react';
import {
  dueDateFor,
  generateSchedule,
  isValidISODate,
  standardPayment,
  validateSetup,
  type LoanSetup,
  type PmiRemovalRule,
} from '../../engine/index.js';
import { centsToInput, date, money, parseDollars } from '../format.js';
import { Amt } from './Amt.js';

interface Props {
  initial: LoanSetup | null;
  /** True once months are reconciled: they keep their locked amounts. */
  hasReconciled: boolean;
  onSave(setup: LoanSetup): Promise<void>;
}

type Draft = Record<
  | 'originalAmount' | 'annualRatePercent' | 'termYears' | 'openDate' | 'firstPaymentDate' | 'paymentDay'
  | 'piPaymentOverride' | 'originalHomeValue' | 'pmiMonthly' | 'pmiStartDate' | 'escrowMonthly' | 'extraPrincipal'
  | 'startDate' | 'startBalance',
  string
> & { pmiRemovalRule: PmiRemovalRule; underway: boolean };

const canDate = (first: string, day: number) => isValidISODate(first) && Number.isInteger(day) && day >= 1 && day <= 31;

/** How many payments fall due on or before `date`. */
function paymentsDueBy(first: string, day: number, date: string, max: number): number {
  let n = 0;
  while (n < max && dueDateFor(first, day, n + 1) <= date) n++;
  return n;
}

function toDraft(s: LoanSetup | null): Draft {
  const start = s?.startingPoint;
  return {
    underway: !!start,
    startDate: start && canDate(s.firstPaymentDate, s.paymentDay) ? dueDateFor(s.firstPaymentDate, s.paymentDay, start.payment) : '',
    startBalance: centsToInput(start?.balance),
    originalAmount: centsToInput(s?.originalAmount),
    annualRatePercent: s ? String(s.annualRatePercent) : '',
    termYears: s ? String(s.termYears) : '30',
    openDate: s?.openDate ?? '',
    firstPaymentDate: s?.firstPaymentDate ?? '',
    paymentDay: s ? String(s.paymentDay) : '1',
    piPaymentOverride: centsToInput(s?.piPaymentOverride),
    originalHomeValue: centsToInput(s?.originalHomeValue),
    pmiMonthly: centsToInput(s?.pmiMonthly ?? 0),
    pmiStartDate: s?.pmiStartDate ?? '',
    pmiRemovalRule: s?.pmiRemovalRule ?? 'auto78Scheduled',
    escrowMonthly: centsToInput(s?.escrowMonthly ?? 0),
    extraPrincipal: centsToInput(s?.extraPrincipal ?? 0),
  };
}

function fromDraft(d: Draft): LoanSetup {
  const cents = (v: string) => parseDollars(v) ?? Number.NaN;
  const day = Number(d.paymentDay);
  const startPayment =
    canDate(d.firstPaymentDate, day) && isValidISODate(d.startDate)
      ? paymentsDueBy(d.firstPaymentDate, day, d.startDate, Number(d.termYears) * 12)
      : Number.NaN;
  return {
    originalAmount: cents(d.originalAmount),
    annualRatePercent: d.annualRatePercent.trim() === '' ? Number.NaN : Number(d.annualRatePercent),
    termYears: Number(d.termYears),
    openDate: d.openDate,
    firstPaymentDate: d.firstPaymentDate,
    paymentDay: Number(d.paymentDay),
    piPaymentOverride: d.piPaymentOverride.trim() ? cents(d.piPaymentOverride) : null,
    originalHomeValue: cents(d.originalHomeValue),
    pmiMonthly: d.pmiMonthly.trim() ? cents(d.pmiMonthly) : 0,
    pmiStartDate: d.pmiStartDate || null,
    pmiRemovalRule: d.pmiRemovalRule,
    escrowMonthly: d.escrowMonthly.trim() ? cents(d.escrowMonthly) : 0,
    extraPrincipal: d.extraPrincipal.trim() ? cents(d.extraPrincipal) : 0,
    startingPoint: d.underway ? { payment: startPayment, balance: cents(d.startBalance) } : null,
  };
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
  id: keyof Draft; label: string; hint?: React.ReactNode; value: string; onChange(v: string): void; placeholder?: string;
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

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="mt-field">
      <label htmlFor={`mt-${id}`}>{label}</label>
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

/** One-time loan setup. Previews the payment and PMI dates as you type. */
export function SetupForm({ initial, hasReconciled, onSave }: Props) {
  const [d, setD] = useState<Draft>(() => toDraft(initial));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ message: string; problems: string[] } | null>(null);
  const [saved, setSaved] = useState(false);
  const set = (k: keyof Draft) => (v: string) => {
    setSaved(false);
    setD((prev) => ({ ...prev, [k]: v }));
  };

  const setup = useMemo(() => fromDraft(d), [d]);
  const problems = useMemo(() => validateSetup(setup), [setup]);
  const preview = useMemo(() => {
    if (problems.length) return null;
    try {
      return generateSchedule(setup);
    } catch {
      return null;
    }
  }, [setup, problems]);
  const calculated = useMemo(() => {
    const ok = setup.originalAmount > 0 && setup.annualRatePercent >= 0 && setup.termYears > 0;
    return ok ? standardPayment(setup.originalAmount, setup.annualRatePercent, setup.termYears * 12) : null;
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

  return (
    <form onSubmit={submit} noValidate>
      {!initial && (
        <div className="mt-note" style={{ marginBottom: 14 }}>
          Enter your loan once, straight from your closing documents. You can change anything later. Been paying on it for a
          while? Enter the original terms anyway, then where the loan stands today under <b>Already paying on this loan?</b>
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
          <Money id="originalAmount" label="Original loan amount" value={d.originalAmount} onChange={set('originalAmount')} placeholder="320,000.00" />
          <Field id="annualRatePercent" label="Interest rate">
            <div className="mt-suffix">
              <input id="mt-annualRatePercent" className="mt-input" inputMode="decimal" value={d.annualRatePercent} placeholder="6.5" onChange={(e) => set('annualRatePercent')(e.target.value)} />
              <span>%</span>
            </div>
          </Field>
          <Field id="termYears" label="Term">
            <select id="mt-termYears" className="mt-select" style={{ width: '100%' }} value={d.termYears} onChange={(e) => set('termYears')(e.target.value)}>
              {[10, 15, 20, 25, 30, 40].map((y) => (
                <option key={y} value={y}>{y} years</option>
              ))}
            </select>
          </Field>
          <Field id="openDate" label="Loan open (closing) date">
            <input id="mt-openDate" type="date" className="mt-input" value={d.openDate} onChange={(e) => set('openDate')(e.target.value)} />
          </Field>
          <Field id="firstPaymentDate" label="First payment date">
            <input id="mt-firstPaymentDate" type="date" className="mt-input" value={d.firstPaymentDate} onChange={(e) => set('firstPaymentDate')(e.target.value)} />
          </Field>
          <Field id="paymentDay" label="Payment due day" hint="Day of the month. 29–31 move to the last day in short months.">
            <input id="mt-paymentDay" type="number" min={1} max={31} className="mt-input" value={d.paymentDay} onChange={(e) => set('paymentDay')(e.target.value)} />
          </Field>
          <Money
            id="piPaymentOverride"
            label="Principal & interest payment"
            value={d.piPaymentOverride}
            onChange={set('piPaymentOverride')}
            placeholder={calculated !== null ? centsToInput(calculated) : 'calculated'}
            hint={
              calculated !== null
                ? <>Calculated: <Amt cents={calculated} />. Leave blank to use it, or type your statement's exact amount.</>
                : 'Calculated from the amount, rate, and term.'
            }
          />
        </div>
      </div>

      <div className="mt-gap" />
      <StartingPointCard d={d} setD={setD} set={set} setup={setup} preview={preview} />

      <div className="mt-gap" />
      <div className="mt-card">
        <h3>Home &amp; PMI</h3>
        <div className="mt-form-section">
          <Money id="originalHomeValue" label="Original home value" value={d.originalHomeValue} onChange={set('originalHomeValue')} placeholder="355,000.00" hint="Lenders usually use the lower of the purchase price and the appraisal." />
          <Money id="pmiMonthly" label="Monthly PMI" value={d.pmiMonthly} onChange={set('pmiMonthly')} hint="0 if your loan has no PMI." />
          <Field id="pmiStartDate" label="PMI start date" hint="Blank = from the first payment.">
            <input id="mt-pmiStartDate" type="date" className="mt-input" value={d.pmiStartDate} onChange={(e) => set('pmiStartDate')(e.target.value)} />
          </Field>
        </div>
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
      </div>

      <div className="mt-gap" />
      <div className="mt-card">
        <h3>Escrow &amp; extras</h3>
        <div className="mt-form-section">
          <Money id="escrowMonthly" label="Monthly escrow" value={d.escrowMonthly} onChange={set('escrowMonthly')} hint="Property tax and insurance collected with the payment." />
          <Money id="extraPrincipal" label="Standing extra principal" value={d.extraPrincipal} onChange={set('extraPrincipal')} hint="Added to every payment. 0 if none." />
        </div>
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
          </span>
        )}
        <span className="mt-spacer" />
        {saved && <span style={{ color: 'var(--good)', fontWeight: 600 }}>Saved</span>}
        <button type="submit" className="mt-btn primary" disabled={saving}>
          {saving ? 'Saving…' : initial ? 'Save changes' : 'Create schedule'}
        </button>
      </div>
    </form>
  );
}

/** For a loan that was already under way: where tracking starts, from a recent statement. */
function StartingPointCard({ d, setD, set, setup, preview }: {
  d: Draft;
  setD: React.Dispatch<React.SetStateAction<Draft>>;
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
        <input type="checkbox" checked={d.underway} onChange={(e) => setD((p) => ({ ...p, underway: e.target.checked }))} />
        I've been making payments since before I started tracking it here
      </label>
      {d.underway && (
        <>
          <p style={{ color: 'var(--muted)' }}>
            Keep the original terms above, from your closing documents. Then enter the most recent payment and balance from a
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
