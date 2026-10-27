import { useCallback, useEffect, useState } from 'react';
import { MAX_PENNY_OFFSET, type Resolution } from '../../engine/index.js';
import type { MonthView, StateView } from '../../server/service.js';
import type { Candidate, CategoryGroup, MortgageClient } from '../api.js';
import { date, money } from '../format.js';
import { PaymentBreakdown } from './PaymentBreakdown.js';
import { StatusPill } from './ScheduleView.js';

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

  useEffect(() => {
    client.categories().then(setGroups, (e: Error) => setError(e.message));
  }, [client]);

  const loadCandidates = useCallback(async () => {
    if (!categoryId || !row || row.status === 'paid') {
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
                Matched to {money(row.match.transactionAmount)} on {date(row.match.transactionDate)}
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

          {row.status === 'flagged' && row.match && (
            <>
              <h3>Doesn't match. What's the difference?</h3>
              <div className="mt-row" style={{ alignItems: 'baseline' }}>
                <span className="mt-diff">{money(diff, { sign: true })}</span>
                <span style={{ color: 'var(--muted)' }}>
                  bank {money(row.match.transactionAmount)} vs schedule {money(row.total)}
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
                  If it's extra principal, keep paying {money(diff)} extra every month
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
                        <div className="amt">{money(t.paid)}</div>
                        <div className="meta" style={{ textAlign: 'right' }}>
                          {t.matchesSchedule ? '✓ matches schedule' : `${money(t.difference, { sign: true })} vs schedule`}
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
            </>
          )}

          {error && (
            <div className="mt-note bad" style={{ marginTop: 12 }} role="alert">
              {error}
            </div>
          )}
        </div>

        <div className="mt-card">
          <PaymentBreakdown row={row} title={row.status === 'paid' ? 'Locked amounts' : 'Scheduled'} />
          <div className="mt-gap" />
          <dl className="mt-kv">
            <dt>Balance before</dt>
            <dd>{money(row.beginningBalance)}</dd>
            <dt>Balance after</dt>
            <dd>{money(row.endingBalance)}</dd>
          </dl>
        </div>
      </div>
    </div>
  );
}
