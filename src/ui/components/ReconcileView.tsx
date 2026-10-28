import { useCallback, useEffect, useState } from 'react';
import { MAX_PENNY_OFFSET, type LoanModules, type Resolution, type SkipMode } from '../../engine/index.js';
import type { MonthView, StateView } from '../../server/service.js';
import type { Candidate, CategoryGroup, LoanClient } from '../api.js';
import { date, money } from '../format.js';
import { PaymentBreakdown } from './PaymentBreakdown.js';
import { StatusPill } from './ScheduleView.js';
import { Amt } from './Amt.js';

interface Props {
  client: LoanClient;
  rows: MonthView[];
  /** Recorded adjustments, to find the catch-up plan for a missed month. */
  adjustments: StateView['adjustments'];
  /** Escrow and PMI answers only make sense when the loan has them. */
  modules: LoanModules;
  payment: number;
  onPaymentChange(payment: number): void;
  categoryId: string | null;
  onCategoryChange(categoryId: string | null): void;
  /** Called with fresh state after anything changes the schedule. */
  onState(state: StateView): void;
  /** Reload state after a match (the match endpoint returns a result, not state). */
  onRefresh(): Promise<void>;
}

const ANSWERS: { value: Resolution; title: string; text: string }[] = [
  { value: 'rounding', title: 'Rounding offset', text: `A few cents of bank rounding (up to $${MAX_PENNY_OFFSET / 100}). This month only.` },
  { value: 'escrow', title: 'Escrow changed', text: 'Taxes or insurance changed. New escrow from this month on.' },
  { value: 'pmi', title: 'PMI changed', text: 'The PMI premium changed or stopped. New PMI from this month on.' },
  { value: 'extraPrincipal', title: 'Extra principal', text: 'You paid extra toward the balance. Later months recalculate.' },
];

const SKIP_MODES: { value: SkipMode; title: string; text: string }[] = [
  {
    value: 'catchUp',
    title: 'Missed now, caught up later',
    text: 'A hardship grace period. Nothing is forgiven: the whole missed payment is paid back in later months. No interest is added and the loan doesn’t get longer.',
  },
  {
    value: 'capitalize',
    title: 'Interest is added to the balance',
    text: 'Typical skip-a-payment offer. The month’s interest is added to what you owe; the loan runs longer.',
  },
  {
    value: 'defer',
    title: 'Payment is deferred to payoff',
    text: 'Typical after forbearance. The missed payment is due, interest-free, when the loan is paid off or sold.',
  },
];

/** Likeliest explanations first, matching the backend's suggestions. */
function ordered(diff: number, modules: LoanModules) {
  const order: Resolution[] =
    diff > 0 ? ['rounding', 'extraPrincipal', 'escrow', 'pmi'] : ['rounding', 'escrow', 'pmi', 'extraPrincipal'];
  return order.filter((v) => (v === 'escrow' ? modules.escrow : v === 'pmi' ? modules.pmi : true)).map((v) => ANSWERS.find((a) => a.value === v)!);
}

function possible(answer: Resolution, diff: number, row: MonthView): boolean {
  if (answer === 'rounding') return Math.abs(diff) <= MAX_PENNY_OFFSET;
  if (answer === 'extraPrincipal') return diff > 0;
  if (answer === 'escrow') return row.escrow + diff >= 0;
  return row.pmi + diff >= 0;
}

/** One month: pick the category, click the bank transaction, answer if flagged. */
export function ReconcileView({ client, rows, adjustments, modules, payment, onPaymentChange, categoryId, onCategoryChange, onState, onRefresh }: Props) {
  const row = rows[payment - 1];
  const [groups, setGroups] = useState<CategoryGroup[] | null>(null);
  const [cands, setCands] = useState<Candidate[] | null>(null);
  const [wide, setWide] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [standing, setStanding] = useState(false);
  const [offset, setOffset] = useState('');
  const [skipMode, setSkipMode] = useState<SkipMode>('catchUp');

  useEffect(() => {
    client.categories().then(setGroups, (e: Error) => setError(e.message));
  }, [client]);

  const loadCandidates = useCallback(async () => {
    if (!categoryId || !row || row.status === 'paid' || row.status === 'skipped' || row.status === 'history') {
      setCands(null);
      return;
    }
    setCands(null);
    try {
      setCands(await client.candidates(payment, categoryId, wide));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [client, payment, categoryId, wide, row?.status]);

  useEffect(() => {
    setError(null);
    setStanding(false);
    setOffset(row && row.pennyOffset && row.status !== 'paid' ? (row.pennyOffset / 100).toFixed(2) : '');
    void loadCandidates();
  }, [loadCandidates]);

  if (!row) return <div className="mt-empty">That payment isn't on the schedule.</div>;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const match = (t: Candidate) =>
    run(async () => {
      await client.match(payment, t.id, categoryId!);
      await onRefresh();
    });
  const resolve = (answer: Resolution) => run(async () => onState(await client.resolve(payment, answer, standing)));
  const undo = () => run(async () => onState(await client.unmatch(payment)));
  const skip = () => run(async () => onState(await client.skip(payment, skipMode)));
  const unskip = () => run(async () => onState(await client.unskip(payment)));
  const saveOffset = () =>
    run(async () => {
      const cents = Math.round(Number(offset || '0') * 100);
      if (!Number.isFinite(cents)) throw new Error('Enter an amount like 0.01 or -0.02');
      onState(await client.setOffset(payment, cents));
    });

  const diff = row.match ? row.match.transactionAmount - row.total : 0;

  return (
    <div>
      <div className="mt-row" style={{ marginBottom: 14 }}>
        <div className="mt-month-nav">
          <button type="button" className="mt-btn small" disabled={payment <= 1} onClick={() => onPaymentChange(payment - 1)} aria-label="Previous payment">
            ‹
          </button>
          <div className="label">
            #{row.payment} · {date(row.dueDate, 'month')}
          </div>
          <button type="button" className="mt-btn small" disabled={payment >= rows.length} onClick={() => onPaymentChange(payment + 1)} aria-label="Next payment">
            ›
          </button>
        </div>
        <StatusPill status={row.status} />
        <span className="mt-spacer" />
        <span style={{ color: 'var(--muted)' }}>Due {date(row.dueDate)}</span>
      </div>

      <div className="mt-grid mt-two">
        <div className="mt-card">
          {row.status === 'paid' && row.match && (
            <>
              <h3>Reconciled</h3>
              <div className="mt-note good">
                Matched to <Amt cents={row.match.transactionAmount} /> on {date(row.match.transactionDate)}
                {row.match.transactionPayee ? ` · ${row.match.transactionPayee}` : ''}
                {row.match.resolution ? ` · explained as ${ANSWERS.find((a) => a.value === row.match!.resolution)?.title.toLowerCase()}` : ''}.
                These amounts are locked.
              </div>
              <div className="mt-gap" />
              <button type="button" className="mt-btn" disabled={busy} onClick={undo}>
                Undo reconciliation
              </button>
            </>
          )}

          {row.status === 'skipped' && row.skipped === 'catchUp' && (
            <CatchUp key={row.payment} row={row} rows={rows} adjustments={adjustments} busy={busy} onUndo={unskip} run={run} client={client} onState={onState} />
          )}

          {row.status === 'skipped' && row.skipped !== 'catchUp' && (
            <>
              <h3>Skipped</h3>
              <div className="mt-note">
                {row.skipped === 'capitalize' ? (
                  <>
                    No payment this month. <Amt cents={row.capitalizedInterest} /> of interest is added to the balance, and the same
                    monthly payment continues, so the loan runs a little longer.
                  </>
                ) : (
                  <>
                    No payment this month. <Amt cents={row.deferred} /> of principal and interest is deferred, interest-free, and due
                    in one lump sum when the loan is paid off.
                  </>
                )}
              </div>
              <div className="mt-gap" />
              <button type="button" className="mt-btn" disabled={busy} onClick={unskip}>
                Undo skip
              </button>
            </>
          )}

          {row.status === 'history' && <BeforeTracking row={row} rows={rows} onPaymentChange={onPaymentChange} />}

          {row.status === 'flagged' && row.match && (
            <>
              <h3>Doesn't match. What's the difference?</h3>
              <div className="mt-row" style={{ alignItems: 'baseline' }}>
                <span className="mt-diff"><Amt cents={diff} sign /></span>
                <span style={{ color: 'var(--muted)' }}>
                  bank <Amt cents={row.match.transactionAmount} /> vs schedule <Amt cents={row.total} />
                </span>
              </div>
              <div className="mt-answers">
                {ordered(diff, modules).map((a, i, all) => {
                  const ok = possible(a.value, diff, row);
                  const suggested = ok && all.slice(0, i).every((b) => !possible(b.value, diff, row));
                  return (
                    <button key={a.value} type="button" className={`mt-answer ${suggested ? 'suggested' : ''}`} disabled={busy || !ok} onClick={() => resolve(a.value)}>
                      <b>{a.title}</b>
                      <small>{a.text}</small>
                    </button>
                  );
                })}
              </div>
              {diff > 0 && (
                <label className="mt-row" style={{ marginTop: 10, cursor: 'pointer' }}>
                  <input type="checkbox" checked={standing} onChange={(e) => setStanding(e.target.checked)} />
                  If it's extra principal, keep paying <Amt cents={diff} /> extra every month
                </label>
              )}
              <div className="mt-row" style={{ marginTop: 12 }}>
                <button type="button" className="mt-btn link" disabled={busy} onClick={undo}>
                  Wrong transaction? Unmatch
                </button>
              </div>
            </>
          )}

          {row.status === 'scheduled' && (
            <>
              <h3>Find the payment in Actual</h3>
              <div className="mt-row" style={{ marginBottom: 12 }}>
                <select
                  className="mt-select"
                  aria-label="Category for this loan's payments"
                  value={categoryId ?? ''}
                  onChange={(e) => onCategoryChange(e.target.value || null)}
                >
                  <option value="">Choose the category for this loan's payments…</option>
                  {groups?.map((g) => (
                    <optgroup key={g.id} label={g.name}>
                      {g.categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                {categoryId && (
                  <button type="button" className="mt-btn link" onClick={() => setWide((w) => !w)}>
                    {wide ? 'Narrow search' : 'Search ±60 days'}
                  </button>
                )}
              </div>

              {!categoryId && <div className="mt-empty">Pick the category this loan's payments are booked to in Actual.</div>}
              {categoryId && cands === null && !error && <div className="mt-empty">Looking for transactions…</div>}
              {categoryId && cands?.length === 0 && (
                <div className="mt-empty">
                  No payments in this category around {date(row.dueDate)}.
                  <br />
                  Has the bank synced yet? Try again later or widen the search.
                </div>
              )}
              {cands && cands.length > 0 && (
                <div className="mt-cands">
                  {cands.map((t) => (
                    <button key={t.id} type="button" className="mt-cand" disabled={busy || t.usedByPayment !== null} onClick={() => match(t)}>
                      <div>
                        <div style={{ fontWeight: 600 }}>{t.payee ?? 'No payee'}</div>
                        <div className="meta">
                          {date(t.date)} · {t.account ?? ''}
                          {t.isSplitPart ? ' · split' : ''}
                          {t.usedByPayment !== null ? ` · already used for #${t.usedByPayment}` : ''}
                        </div>
                      </div>
                      <div>
                        <div className="amt"><Amt cents={t.paid} /></div>
                        <div className="meta" style={{ textAlign: 'right' }}>
                          {t.matchesSchedule ? '✓ matches schedule' : <><Amt cents={t.difference} sign /> vs schedule</>}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              <details style={{ marginTop: 16 }}>
                <summary style={{ cursor: 'pointer', color: 'var(--muted)' }}>Penny offset (rarely needed)</summary>
                <div className="mt-row" style={{ marginTop: 8 }}>
                  <div className="mt-prefix" style={{ width: 130 }}>
                    <span>$</span>
                    <input className="mt-input" inputMode="decimal" placeholder="0.00" value={offset} onChange={(e) => setOffset(e.target.value)} aria-label="Penny offset" />
                  </div>
                  <button type="button" className="mt-btn small" disabled={busy} onClick={saveOffset}>
                    Apply
                  </button>
                  <span style={{ color: 'var(--muted)', fontSize: 12 }}>Moves up to ±$1.00 into this month's principal.</span>
                </div>
              </details>

              <details style={{ marginTop: 10 }}>
                <summary style={{ cursor: 'pointer', color: 'var(--muted)' }}>Skipping this payment?</summary>
                <p style={{ margin: '8px 0' }}>
                  Only with your servicer's approval (a hardship grace period, a skip-a-payment offer, forbearance, or a deferral).
                  How do they handle it?
                </p>
                <div className="mt-radio" role="radiogroup" aria-label="How the skipped payment is handled">
                  {SKIP_MODES.map((m) => (
                    <label key={m.value}>
                      <input type="radio" name="mt-skip" checked={skipMode === m.value} onChange={() => setSkipMode(m.value)} />
                      <span>
                        <b>{m.title}</b>
                        <small>{m.text}</small>
                      </span>
                    </label>
                  ))}
                </div>
                <div className="mt-row" style={{ marginTop: 10 }}>
                  <button type="button" className="mt-btn" disabled={busy} onClick={skip}>
                    Mark payment #{row.payment} as skipped
                  </button>
                  {(modules.pmi || modules.escrow) && (
                    <span style={{ color: 'var(--muted)', fontSize: 12 }}>
                      No {modules.pmi && modules.escrow ? 'PMI or escrow' : modules.pmi ? 'PMI' : 'escrow'} is collected for a skipped month, except when it's caught up later.
                    </span>
                  )}
                </div>
              </details>
            </>
          )}

          {error && (
            <div className="mt-note bad" style={{ marginTop: 12 }} role="alert">
              {error}
            </div>
          )}
        </div>

        <div className="mt-card">
          <PaymentBreakdown
            row={row}
            title={
              row.status === 'paid' ? 'Locked amounts' : row.status === 'skipped' ? 'This month' : row.status === 'history' ? 'Original schedule' : 'Scheduled'
            }
          />
          <div className="mt-gap" />
          <dl className="mt-kv">
            <dt>Balance before</dt>
            <dd><Amt cents={row.beginningBalance} /></dd>
            <dt>Balance after</dt>
            <dd><Amt cents={row.endingBalance} /></dd>
          </dl>
        </div>
      </div>
    </div>
  );
}

interface CatchUpProps {
  row: MonthView;
  rows: MonthView[];
  adjustments: StateView['adjustments'];
  busy: boolean;
  onUndo(): void;
  run(fn: () => Promise<void>): Promise<void>;
  client: LoanClient;
  onState(state: StateView): void;
}

/** A missed payment to be caught up: what's past due, and the plan to pay it back. */
function CatchUp({ row, rows, adjustments, busy, onUndo, run, client, onState }: CatchUpProps) {
  // The plan covering this month is the first one that starts after it.
  const plan = adjustments
    .map((a) => a.adjustment)
    .filter((a): a is Extract<typeof a, { kind: 'catchUpPlan' }> => a.kind === 'catchUpPlan' && a.fromPayment > row.payment)
    .sort((a, b) => a.fromPayment - b.fromPayment)[0];
  // Every missed month this plan repays (consecutive misses share one plan).
  const pool = rows.filter((r) => r.skipped === 'catchUp' && r.payment <= (plan?.fromPayment ?? Infinity) && coveredBySame(r.payment));
  function coveredBySame(p: number) {
    const first = adjustments
      .map((a) => a.adjustment)
      .filter((a): a is Extract<typeof a, { kind: 'catchUpPlan' }> => a.kind === 'catchUpPlan' && a.fromPayment > p)
      .sort((a, b) => a.fromPayment - b.fromPayment)[0];
    return first?.fromPayment === plan?.fromPayment;
  }
  const owed = pool.reduce((s, r) => s + r.pastDue, 0);
  const eligible = rows.filter((r) => r.payment > row.payment && r.status === 'scheduled' && !r.skipped);
  const [from, setFrom] = useState<number>(plan?.fromPayment ?? eligible.find((r) => !r.skipped)?.payment ?? row.payment + 1);
  const [months, setMonths] = useState<string>(String(plan?.months ?? 3));
  const n = Math.max(1, Math.min(120, Math.floor(Number(months) || 1)));
  const plannedRows = plan ? rows.filter((r) => r.payment >= plan.fromPayment && r.payment < plan.fromPayment + plan.months) : [];

  const save = () => run(async () => onState(await client.setCatchUpPlan(row.payment, from, n)));
  const clear = () => run(async () => onState(await client.clearCatchUpPlan(row.payment)));

  return (
    <>
      <h3>Missed · to be caught up</h3>
      <div className="mt-note warn">
        Nothing paid this month. <Amt cents={row.pastDue} /> is past due (principal and interest <Amt cents={row.principalAndInterest} />
        {row.pmi > 0 && <>, PMI <Amt cents={row.pmi} /></>}
        {row.escrow > 0 && <>, escrow <Amt cents={row.escrow} /></>}). It isn't forgiven: it's paid back in later months.
      </div>
      {pool.length > 1 && (
        <p className="mt-kpi-note">
          Together with the other missed {pool.length === 2 ? 'payment' : 'payments'} ({pool.filter((r) => r.payment !== row.payment).map((r) => `#${r.payment}`).join(', ')}): <Amt cents={owed} /> to catch up.
        </p>
      )}

      <div className="mt-gap" />
      <div className="mt-field">
        <label>Catch-up plan</label>
        {plan ? (
          <div className="mt-note good" style={{ marginBottom: 10 }}>
            Paid back over {plan.months} {plan.months === 1 ? 'payment' : 'payments'} starting with #{plan.fromPayment} ({date(rows[plan.fromPayment - 1]?.dueDate, 'month')}):
            about <Amt cents={plannedRows[0]?.catchUp?.total ?? 0} /> extra each month. Those months now expect the larger amount when you reconcile them.
          </div>
        ) : (
          <div className="mt-kpi-note" style={{ marginTop: 0, marginBottom: 10 }}>
            No plan yet, so the schedule holds it until the final payment. Set one once you know when you can catch up; you can change it any time.
          </div>
        )}
        <div className="mt-inline-form">
          <div className="mt-field">
            <label htmlFor="mt-cu-from">Starting with</label>
            <select id="mt-cu-from" className="mt-select" style={{ width: '100%', minWidth: 0 }} value={from} onChange={(e) => setFrom(Number(e.target.value))}>
              {eligible.slice(0, 60).map((r) => (
                <option key={r.payment} value={r.payment}>
                  #{r.payment} · {date(r.dueDate, 'month')}
                </option>
              ))}
            </select>
          </div>
          <div className="mt-field">
            <label htmlFor="mt-cu-months">Spread over (payments)</label>
            <input id="mt-cu-months" type="number" min={1} max={120} className="mt-input" value={months} onChange={(e) => setMonths(e.target.value)} />
          </div>
          <button type="button" className="mt-btn primary" disabled={busy || eligible.length === 0} onClick={save}>
            {plan ? 'Update plan' : 'Save plan'}
          </button>
        </div>
        <div className="mt-kpi-note">
          About <Amt cents={Math.ceil(owed / n)} /> extra a month. Use 1 to pay it all at once.
        </div>
      </div>

      <div className="mt-row" style={{ marginTop: 12 }}>
        <button type="button" className="mt-btn" disabled={busy} onClick={onUndo}>
          Undo skip
        </button>
        {plan && (
          <button type="button" className="mt-btn link" disabled={busy} onClick={clear}>
            Remove plan
          </button>
        )}
      </div>
      <p className="mt-kpi-note">
        Ask your servicer how long the grace period lasts and confirm in writing that there are no late fees or credit reporting.
      </p>
    </>
  );
}

/** A payment made before tracking began: nothing to match. */
function BeforeTracking({ row, rows, onPaymentChange }: { row: MonthView; rows: MonthView[]; onPaymentChange(payment: number): void }) {
  const first = rows.find((r) => !r.beforeTracking);
  const gap = row.extraPrincipal;
  return (
    <>
      <h3>Before tracking</h3>
      <div className="mt-note">
        This payment was made before you started tracking the loan, so there's no bank transaction to match. Its amounts come
        from the original schedule.
        {gap > 0 && (
          <>
            {' '}
            It also carries <Amt cents={gap} /> of extra principal: the difference between the original schedule and your starting
            balance, paid at some point before tracking began.
          </>
        )}
        {gap < 0 && (
          <>
            {' '}
            Your starting balance is <Amt cents={-gap} /> higher than the original schedule expected, so the balance is raised by
            that much here.
          </>
        )}
      </div>
      {first && (
        <>
          <div className="mt-gap" />
          <button type="button" className="mt-btn" onClick={() => onPaymentChange(first.payment)}>
            Go to payment #{first.payment}, the first one tracked
          </button>
        </>
      )}
    </>
  );
}
