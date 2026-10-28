import type { LoanSummary, Schedule } from '../../engine/index.js';
import { date, duration } from '../format.js';
import { Amt } from './Amt.js';

/** For loans without PMI: when the loan ends, what it costs, and what it takes to pay it off today. */
export function PayoffCard({ summary, totals }: { summary: LoanSummary; totals: Schedule['totals'] }) {
  const left = summary.nextPayment ? summary.totalPayments - summary.nextPayment.payment + 1 : 0;
  const p = summary.payoff;
  return (
    <div className="mt-card">
      <h3>Payoff</h3>
      <div className="mt-count">
        <span className="mt-count-big">{left}</span>
        <span>payments left</span>
      </div>
      <div className="mt-kpi-note">
        {summary.payoffDate ? <>Last payment {date(summary.payoffDate)}{left > 0 && <> · about {duration(left)}</>}</> : 'Paid off'}
      </div>
      <dl className="mt-kv" style={{ marginTop: 14 }}>
        {p && (
          <>
            <dt>{p.source === 'quote' ? `Payoff quote, good through ${date(p.asOf)}` : 'Payoff today (estimate)'}</dt>
            <dd><Amt cents={p.amount} /></dd>
          </>
        )}
        <dt>Interest over the life of the loan</dt>
        <dd><Amt cents={totals.interest} /></dd>
        {totals.fees > 0 && (
          <>
            <dt>Yearly fees</dt>
            <dd><Amt cents={totals.fees} /></dd>
          </>
        )}
        {summary.oneOffFees > 0 && (
          <>
            <dt>One-off fees</dt>
            <dd><Amt cents={summary.oneOffFees} /></dd>
          </>
        )}
      </dl>
      {p?.source === 'estimate' && (
        <p className="mt-kpi-note" style={{ marginBottom: 0 }}>
          What you owe plus about <Amt cents={p.perDiem} /> a day of interest since the last payment.
          {p.expiredQuote && <> Your payoff quote expired {date(p.expiredQuote)}.</>} Ask your lender for an exact quote.
        </p>
      )}
    </div>
  );
}
