import type { LoanSummary } from '../../engine/index.js';
import { date, money, percent } from '../format.js';
import { Amt } from './Amt.js';

/** The four headline numbers: payment number, balance, percent paid, equity. */
export function SummaryCards({ summary }: { summary: LoanSummary }) {
  const n = summary.lastPaidPayment ?? 0;
  return (
    <div className="mt-grid mt-kpis">
      <div className="mt-card">
        <div className="mt-kpi-label">Payment number</div>
        <div className="mt-kpi-value">
          {n} <span style={{ fontSize: 15, color: 'var(--muted)', fontWeight: 600 }}>of {summary.totalPayments}</span>
        </div>
        <div className="mt-kpi-note">
          {summary.nextPayment ? `Next: #${summary.nextPayment.payment} due ${date(summary.nextPayment.dueDate)}` : 'Paid off'}
        </div>
      </div>
      <div className="mt-card">
        <div className="mt-kpi-label">Balance</div>
        <div className="mt-kpi-value"><Amt cents={summary.balance} /></div>
        <div className="mt-kpi-note">
          {summary.scheduledBalance !== summary.balance ? (
            <>
              Schedule expects <Amt cents={summary.scheduledBalance} /> by today
            </>
          ) : (
            'After your last reconciled payment'
          )}
        </div>
      </div>
      <div className="mt-card">
        <div className="mt-kpi-label">Paid off</div>
        <div className="mt-kpi-value">{percent(summary.percentPaid)}</div>
        <div className="mt-meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={summary.percentPaid} aria-label="Percent of loan paid">
          <span style={{ width: `${Math.min(100, summary.percentPaid)}%` }} />
        </div>
      </div>
      <div className="mt-card">
        <div className="mt-kpi-label">Equity</div>
        {summary.homeValue && summary.marketEquity !== null ? (
          <>
            <div className="mt-kpi-value"><Amt cents={summary.marketEquity} whole /></div>
            <div className="mt-kpi-note">
              {percent(summary.marketEquityPercent ?? 0)} of <Amt cents={summary.homeValue.value} whole /> ({date(summary.homeValue.date, 'month')} estimate)
            </div>
          </>
        ) : (
          <>
            <div className="mt-kpi-value"><Amt cents={summary.equity} whole /></div>
            <div className="mt-kpi-note">{percent(summary.equityPercent)} of original home value</div>
          </>
        )}
      </div>
    </div>
  );
}
