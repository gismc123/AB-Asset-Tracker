import { useState } from 'react';
import type { PmiRemovalRule } from '../../engine/index.js';
import type { LoanClient, StateView } from '../api.js';
import { date, duration } from '../format.js';
import { Amt } from './Amt.js';

const RULE_TEXT: Record<PmiRemovalRule, string> = {
  auto78Scheduled: 'Schedule drops PMI at the automatic 78% date (original schedule).',
  auto78Actual: 'Schedule drops PMI when your real balance reaches 78%.',
  request80: 'Schedule drops PMI when your real balance reaches 80% and you request removal.',
  untilRemoved: 'Schedule keeps PMI until you record that it was removed; the dates above are for reference.',
};

interface Props {
  state: StateView;
  client: LoanClient;
  onState(next: StateView): void;
}

/** Countdown to PMI removal plus the 80% / 78% / midpoint milestones, and recording the real removal. */
export function PmiCountdown({ state, client, onState }: Props) {
  const s = state.schedule!;
  const pmi = s.pmi;
  const status = state.summary!.pmi;
  const rule = state.setup!.pmiRemovalRule;
  const next = s.currentPayment ?? Infinity;
  // A PMI change of zero entered by hand, not from reconciling a month.
  const recorded = state.adjustments.find((a) => a.sourcePayment === null && a.adjustment.kind === 'pmi' && a.adjustment.amount === 0);
  const removedFrom = recorded && 'fromPayment' in recorded.adjustment ? recorded.adjustment.fromPayment : null;

  const [recording, setRecording] = useState(false);
  const [from, setFrom] = useState(String(s.currentPayment ?? ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<StateView>) => {
    setBusy(true);
    setError(null);
    try {
      onState(await fn());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const fromRow = s.rows[Number(from) - 1];
  const record = (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!fromRow) return setError(`Enter a payment number from 1 to ${s.rows.length}`);
    void run(async () => {
      const next = await client.setPmiRemoval(fromRow.payment);
      setRecording(false);
      return next;
    });
  };

  const removal =
    removedFrom !== null ? (
      <div className="mt-note" style={{ marginTop: 12 }}>
        PMI recorded as removed from payment #{removedFrom}
        {s.rows[removedFrom - 1] && <> ({date(s.rows[removedFrom - 1]!.dueDate)})</>}.{' '}
        <button type="button" className="mt-btn link" disabled={busy} onClick={() => run(() => client.clearPmiRemoval())}>
          Undo
        </button>
      </div>
    ) : status.active && !recording ? (
      <div style={{ marginTop: 8 }}>
        <button type="button" className="mt-btn link" style={{ paddingLeft: 0 }} onClick={() => setRecording(true)}>
          PMI was removed? Record it
        </button>
      </div>
    ) : status.active ? (
      <form className="mt-inline-form" style={{ marginTop: 12 }} onSubmit={record}>
        <div className="mt-field">
          <label htmlFor="mt-pmi-removed">PMI removed? First payment without it</label>
          <input id="mt-pmi-removed" type="number" min={1} max={s.rows.length} className="mt-input" value={from} onChange={(ev) => setFrom(ev.target.value)} />
        </div>
        <button type="submit" className="mt-btn small" disabled={busy}>
          Record removal
        </button>
        <button type="button" className="mt-btn link" disabled={busy} onClick={() => setRecording(false)}>
          Cancel
        </button>
        {fromRow && <span className="mt-kpi-note">due {date(fromRow.dueDate)}</span>}
      </form>
    ) : null;
  const errorNote = error && (
    <div className="mt-note bad" style={{ marginTop: 10 }}>
      {error}
    </div>
  );

  if (!pmi.hasPmi) {
    return (
      <div className="mt-card">
        <h3>PMI</h3>
        <div className="mt-note good">No PMI on this schedule.</div>
        {removal}
        {errorNote}
      </div>
    );
  }

  const milestones = [
    {
      key: 'r80',
      title: 'Request removal (80%)',
      detail: <>Balance ≤ <Amt cents={pmi.request80.thresholdBalance} whole />, including extra principal</>,
      payment: pmi.request80.payment,
      due: pmi.request80.dueDate,
    },
    {
      key: 'a78',
      title: 'Automatic removal (78%)',
      detail: <>Original schedule reaches <Amt cents={pmi.auto78Scheduled.thresholdBalance} whole /></>,
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
  const past80 = pmi.request80.payment !== null && pmi.request80.payment < next;

  return (
    <div className="mt-card">
      <h3>PMI countdown</h3>
      {!status.active ? (
        <div className="mt-note good">PMI has dropped off. It's no longer in your monthly total.</div>
      ) : status.dropPayment === null ? (
        <>
          <div className="mt-count">
            <span className="mt-count-big">
              <Amt cents={status.monthly} />
            </span>
            <span>a month, until it's removed</span>
          </div>
          <div className="mt-kpi-note">
            PMI stays in every payment until you record that it was removed.
            {past80 && ' Your balance is past 80% of the original value, so you can ask your servicer to cancel it.'}
          </div>
        </>
      ) : (
        <>
          <div className="mt-count">
            <span className="mt-count-big">{status.paymentsUntilDrop ?? 0}</span>
            <span>payments left with PMI</span>
          </div>
          <div className="mt-kpi-note">
            {status.dropDate ? `Drops ${date(status.dropDate)} · about ${duration(status.paymentsUntilDrop ?? 0)}` : ''} ·{' '}
            <Amt cents={status.monthly} />/mo now
          </div>
        </>
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
      {removal}
      {errorNote}
      <div className="mt-kpi-note" style={{ marginTop: 10 }}>
        {RULE_TEXT[rule]} Confirm your loan's PMI terms with your servicer.
      </div>
    </div>
  );
}
