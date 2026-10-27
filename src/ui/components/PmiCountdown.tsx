import type { LoanSummary, PmiInfo, PmiRemovalRule } from '../../engine/index.js';
import { date, duration, money } from '../format.js';

const RULE_TEXT: Record<PmiRemovalRule, string> = {
  auto78Scheduled: 'Schedule drops PMI at the automatic 78% date (original schedule).',
  auto78Actual: 'Schedule drops PMI when your real balance reaches 78%.',
  request80: 'Schedule drops PMI when your real balance reaches 80% and you request removal.',
};

interface Props {
  pmi: PmiInfo;
  status: LoanSummary['pmi'];
  nextPayment: number | null;
  rule: PmiRemovalRule;
}

/** Countdown to PMI removal plus the 80% / 78% / midpoint milestones. */
export function PmiCountdown({ pmi, status, nextPayment, rule }: Props) {
  if (!pmi.hasPmi) {
    return (
      <div className="mt-card">
        <h3>PMI</h3>
        <div className="mt-note good">No PMI on this schedule.</div>
      </div>
    );
  }

  const next = nextPayment ?? Infinity;
  const milestones = [
    {
      key: 'r80',
      title: 'Request removal (80%)',
      detail: `Balance ≤ ${money(pmi.request80.thresholdBalance, { whole: true })}, including extra principal`,
      payment: pmi.request80.payment,
      due: pmi.request80.dueDate,
    },
    {
      key: 'a78',
      title: 'Automatic removal (78%)',
      detail: `Original schedule reaches ${money(pmi.auto78Scheduled.thresholdBalance, { whole: true })}`,
      payment: pmi.auto78Scheduled.payment,
      due: pmi.auto78Scheduled.dueDate,
    },
    {
      key: 'mid',
      title: 'Final termination (midpoint)',
      detail: 'PMI must end by the middle of the loan term',
      payment: pmi.midpoint.payment,
      due: pmi.midpoint.dueDate,
    },
  ];
  const nextKey = milestones.find((m) => m.payment !== null && m.payment >= next)?.key;

  return (
    <div className="mt-card">
      <h3>PMI countdown</h3>
      {status.active ? (
        <>
          <div className="mt-count">
            <span className="mt-count-big">{status.paymentsUntilDrop ?? '—'}</span>
            <span>payments left with PMI</span>
          </div>
          <div className="mt-kpi-note">
            {status.dropDate ? `Drops ${date(status.dropDate)} · about ${duration(status.paymentsUntilDrop ?? 0)}` : ''} ·{' '}
            {money(status.monthly)}/mo now
          </div>
        </>
      ) : (
        <div className="mt-note good">PMI has dropped off. It's no longer in your monthly total.</div>
      )}

      <div className="mt-milestones">
        {milestones.map((m) => {
          const done = m.payment !== null && m.payment < next;
          return (
            <div className="mt-milestone" key={m.key}>
              <span className={`mt-dot ${done ? 'done' : m.key === nextKey ? 'next' : ''}`} aria-hidden="true" />
              <div>
                <div className="t">{m.title}</div>
                <div className="d">{m.detail}</div>
              </div>
              <div className="r">
                {date(m.due)}
                <div className="d">{m.payment ? `payment #${m.payment}` : ''}</div>
              </div>
            </div>
          );
        })}
      </div>

      {pmi.paymentsSavedByExtra > 0 && (
        <div className="mt-note good" style={{ marginTop: 12 }}>
          Extra principal reaches 80% {pmi.paymentsSavedByExtra} payments sooner than the original schedule.
        </div>
      )}
      <div className="mt-kpi-note" style={{ marginTop: 10 }}>
        {RULE_TEXT[rule]} Confirm your loan's PMI terms with your servicer.
      </div>
    </div>
  );
}
