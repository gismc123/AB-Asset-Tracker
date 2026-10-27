import { useCallback, useEffect, useState } from 'react';
import { MAX_PENNY_OFFSET, type Resolution, type SkipMode } from '../../engine/index.js';
import type { MonthView, StateView } from '../../server/service.js';
import type { Candidate, CategoryGroup, MortgageClient } from '../api.js';
import { date, money } from '../format.js';
import { PaymentBreakdown } from './PaymentBreakdown.js';
import { StatusPill } from './ScheduleView.js';
import { Amt } from './Amt.js';

interface Props {
  client: MortgageClient;
  rows: MonthView[];
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
function ordered(diff: number) {
  const order: Resolution[] =
    diff > 0 ? ['rounding', 'extraPrincipal', 'escrow', 'pmi'] : ['rounding', 'escrow', 'pmi', 'extraPrincipal'];
  return order.map((v) => ANSWERS.find((a) => a.value === v)!);
}

function possible(answer: Resolution, diff: number, row: MonthView): boolean {
  if (answer === 'rounding') return Math.abs(diff) <= MAX_PENNY_OFFSET;
  if (answer === 'extraPrincipal') return diff > 0;
  if (answer === 'escrow') return row.escrow + diff >= 0;
  return row.pmi + diff >= 0;
}

/** One month: pick the category, click the bank transaction, answer if flagged. */
export function ReconcileView({ client, rows, payment, onPaymentChange, categoryId, onCategoryChange, onState, onRefresh }: Props) {
  const row = rows[payment - 1];
  const [groups, setGroups] = useState<CategoryGroup[] | null>(null);
  const [cands, setCands] = useState<Candidate[] | null>(null);
  const [wide, setWide] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [standing, setStanding] = useState(false);
  const [offset, setOffset] = useState('');
  const [skipMode, setSkipMode] = useState<SkipMode>('capitalize');

  useEffect(() => {
    client.categories().then(setGroups, (e: Error) => setError(e.message));
  }, [client]);

  const loadCandidates = useCallback(async () => {
    if (!categoryId || !row || row.status === 'paid' || row.status === 'skipped') {
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

          {row.status === 'skipped' && (
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
                {ordered(diff).map((a, i, all) => {
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
                  aria-label="Mortgage category"
                  value={categoryId ?? ''}
                  onChange={(e) => onCategoryChange(e.target.value || null)}
                >
                  <option value="">Choose your mortgage category…</option>
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

              {!categoryId && <div className="mt-empty">Pick the category you use for mortgage payments.</div>}
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
                  Only with your servicer's approval (a skip-a-payment offer, forbearance, or a deferral). How do they handle it?
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
                  <span style={{ color: 'var(--muted)', fontSize: 12 }}>No PMI or escrow is collected for a skipped month.</span>
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
          <PaymentBreakdown row={row} title={row.status === 'paid' ? 'Locked amounts' : row.status === 'skipped' ? 'This month' : 'Scheduled'} />
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
